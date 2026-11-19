/**
 * file: src/lib/canvas/merge.ts
 * description: three-way merge of canvases by node / edge id (SPEC §3.4, §7), used when `PUT /api/canvases/<id>` answers 409 and when
 *   a draft made offline meets a newer server copy. Same algorithm, same outputs as `CanvasDocument.merge` of SPNotesCore
 *   (Sources/SPNotesDocument/CanvasMerge.swift): the fixtures in tests/fixtures/canvas/merge-*.json are the shared proof.
 *   Edits of different elements combine; an element changed differently on both sides is a conflict that carries every version —
 *   nothing is lost. Pure.
 * author: Simon-Pierre Boucher — contact@spboucher.ai
 */
import { CANVAS_FORMAT, type CanvasData, type CanvasEdge, type CanvasNode } from "./format";
import { compareCodePoints, jsonEqual, removeNodes } from "./core";

export type ConflictKind = "node" | "edge" | "field";
/**
 * bothEdited: changed differently on both sides (or added on both sides with different values) — the merged canvas keeps LOCAL.
 * editedAndDeleted: deleted on one side, edited on the other — the merged canvas keeps the EDITED version (SPEC §7).
 * deletedButReferenced: a node deleted on one side while the other side attached a new or edited edge to it — the node is restored.
 */
export type ConflictReason = "bothEdited" | "editedAndDeleted" | "deletedButReferenced";
/** One element the merge could not settle. `base` / `local` / `remote` are the element in the ancestor, here and on the server; an absent key = absent / deleted. */
export interface CanvasConflict { kind: ConflictKind; id: string; reason: ConflictReason; base?: unknown; local?: unknown; remote?: unknown }
export interface MergeResult { merged: CanvasData; conflicts: CanvasConflict[] }

type El = { id: string; [k: string]: unknown };
const firstById = <T extends El>(list: readonly T[]) => { const m = new Map<string, T>(); for (const e of list) if (!m.has(e.id)) m.set(e.id, e); return m; };
const conflict = (kind: ConflictKind, id: string, reason: ConflictReason, base: unknown, local: unknown, remote: unknown): CanvasConflict => ({ kind, id, reason, ...(base !== undefined ? { base } : {}), ...(local !== undefined ? { local } : {}), ...(remote !== undefined ? { remote } : {}) });

/**
 * Three-way merge by element id.
 *
 *  1. Shortcuts on the whole document: `local = remote` or `remote = base` → local, untouched; `local = base` → remote, untouched.
 *  2. Nodes, then edges, id by id (L, R, B = the element on each side; absent counts as a value):
 *       L = R → that value · L = B → R · R = B → L ·
 *       both present and different → keep L, conflict `bothEdited` ·
 *       one absent → keep the present one (the edited version), conflict `editedAndDeleted`.
 *     Order of the result: base order, then the ids added by either side sorted by Unicode scalar value — so a clean merge gives the
 *     same document whichever side is called local. Stacking is decided by `z`, never by this order.
 *     Duplicate ids inside one canvas: the first occurrence counts.
 *  3. Edges left without an end because a side deleted the node (an end that is not in the merged nodes but was in the base):
 *     the edge is dropped when it is unchanged since the base (it goes with its node); otherwise (created or edited by the other
 *     side) the node is restored from the base, at its base position among the base nodes, with a conflict `deletedButReferenced`.
 *  4. Top-level fields (every key except `nodes` / `edges`), in sorted key order: L = R or R = B → L · L = B → R · else keep L and
 *     report a `field` conflict — except `viewport`, a per-device view state: local wins unless only the remote changed, never a conflict.
 *     `format` is always "spn-canvas-1".
 */
export function mergeCanvas(base: CanvasData, local: CanvasData, remote: CanvasData): MergeResult {
  if (jsonEqual(local, remote) || jsonEqual(remote, base)) return { merged: local, conflicts: [] };
  if (jsonEqual(local, base)) return { merged: remote, conflicts: [] };
  const conflicts: CanvasConflict[] = [];

  function mergeElements<T extends El>(kind: ConflictKind, b: readonly T[], l: readonly T[], r: readonly T[]): T[] {
    const bm = firstById(b), lm = firstById(l), rm = firstById(r);
    const resolve = (id: string): T | undefined => {
      const bv = bm.get(id), lv = lm.get(id), rv = rm.get(id);
      if (jsonEqual(lv, rv)) return lv;
      if (jsonEqual(lv, bv)) return rv;
      if (jsonEqual(rv, bv)) return lv;
      if (lv && rv) { conflicts.push(conflict(kind, id, "bothEdited", bv, lv, rv)); return lv; }
      conflicts.push(conflict(kind, id, "editedAndDeleted", bv, lv, rv));
      return lv ?? rv;
    };
    const out: T[] = [];
    for (const id of bm.keys()) { const v = resolve(id); if (v) out.push(v); }
    const added = [...new Set([...lm.keys(), ...rm.keys()])].filter((id) => !bm.has(id)).sort(compareCodePoints);
    for (const id of added) { const v = resolve(id); if (v) out.push(v); }
    return out;
  }

  let nodes = mergeElements<CanvasNode>("node", base.nodes, local.nodes, remote.nodes);
  let edges = mergeElements<CanvasEdge>("edge", base.edges, local.edges, remote.edges);

  // edges whose end was deleted by a side
  const baseNodes = firstById(base.nodes), baseEdges = firstById(base.edges);
  const localIds = new Set(local.nodes.map((n) => n.id)), remoteIds = new Set(remote.nodes.map((n) => n.id));
  const present = new Set(nodes.map((n) => n.id)); const restored: string[] = []; const kept: CanvasEdge[] = [];
  for (const e of edges) {
    const ends = [e.from, e.to].filter((x): x is string => typeof x === "string");
    const missing = ends.filter((id) => !present.has(id) && baseNodes.has(id));
    if (!missing.length) { kept.push(e); continue; }
    if (jsonEqual(baseEdges.get(e.id), e)) continue; // untouched edge of a deleted node: goes with it
    for (const id of missing) {
      if (present.has(id)) continue;
      present.add(id); restored.push(id); const b = baseNodes.get(id);
      conflicts.push(conflict("node", id, "deletedButReferenced", b, localIds.has(id) ? b : undefined, remoteIds.has(id) ? b : undefined));
    }
    kept.push(e);
  }
  edges = kept;
  if (restored.length) { // back at their base position among the base elements
    const current = firstById(nodes); const seen = new Set<string>(); const ordered: CanvasNode[] = [];
    for (const n of base.nodes) if (present.has(n.id) && !seen.has(n.id)) { seen.add(n.id); ordered.push(current.get(n.id) ?? n); }
    for (const n of nodes) if (!seen.has(n.id)) { seen.add(n.id); ordered.push(n); }
    nodes = ordered;
  }

  // top-level fields
  const B = base as Record<string, unknown>, L = local as Record<string, unknown>, R = remote as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(B), ...Object.keys(L), ...Object.keys(R)])].filter((k) => k !== "nodes" && k !== "edges").sort(compareCodePoints);
  const fields: Record<string, unknown> = {};
  for (const key of keys) {
    const bv = B[key], lv = L[key], rv = R[key]; let value: unknown;
    if (jsonEqual(lv, rv) || jsonEqual(rv, bv)) value = lv;
    else if (jsonEqual(lv, bv)) value = rv;
    else { value = lv; if (key !== "viewport") conflicts.push(conflict("field", key, lv === undefined || rv === undefined ? "editedAndDeleted" : "bothEdited", bv, lv, rv)); }
    if (value !== undefined) fields[key] = value;
  }
  return { merged: { ...fields, format: CANVAS_FORMAT, nodes, edges } as CanvasData, conflicts };
}

/**
 * The canvas with one conflict settled: `takeRemote` replaces the element by (or removes it like) the conflict's `remote` value;
 * otherwise its `local` value is (re)asserted — which is what the merge already kept, except after later edits.
 * Removing a node removes its edges; `format` cannot be changed.
 */
export function resolveConflict(d: CanvasData, c: CanvasConflict, takeRemote: boolean): CanvasData {
  const value = takeRemote ? c.remote : c.local;
  const valid = value && typeof value === "object" && typeof (value as El).id === "string";
  if (c.kind === "node") {
    if (!valid) return removeNodes(d, [c.id]);
    const v = value as CanvasNode; const i = d.nodes.findIndex((n) => n.id === c.id);
    return { ...d, nodes: i >= 0 ? d.nodes.map((n, k) => (k === i ? v : n)) : [...d.nodes, v] };
  }
  if (c.kind === "edge") {
    if (!valid) return { ...d, edges: d.edges.filter((e) => e.id !== c.id) };
    const v = value as CanvasEdge; const i = d.edges.findIndex((e) => e.id === c.id);
    return { ...d, edges: i >= 0 ? d.edges.map((e, k) => (k === i ? v : e)) : [...d.edges, v] };
  }
  if (c.id === "format" || c.id === "nodes" || c.id === "edges") return d;
  const out: Record<string, unknown> = { ...d }; if (value === undefined) delete out[c.id]; else out[c.id] = value;
  return out as CanvasData;
}
