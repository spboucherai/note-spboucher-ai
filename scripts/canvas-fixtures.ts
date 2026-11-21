/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : scripts/canvas-fixtures.ts
 * Description      : writes the shared canvas fixtures of
 *                    tests/fixtures/canvas/ (inputs + expected outputs of the
 *                    three-way merge and of the automatic layouts) from the web
 *                    model. The native team checks SPNotesCore against the same
 *                    files; tests/unit/next-canvas-model.test.ts checks that
 *                    the web model still reproduces them. Run:
 *                    `node_modules/.bin/tsx scripts/canvas-fixtures.ts`
 *                    (rewrites the files; review the diff).
 * Module           : scripts
 * Repository       : https://git.spboucher.ai/note-spboucher-ai
 * Project Website  : https://note.spboucher.ai
 * Created          : 2026-11-19
 * Last Modified    : 2026-11-19
 *
 * Author           : Simon-Pierre Boucher
 * Position         : Professor of Finance
 * Institution      : Université du Québec en Outaouais (UQO)
 * Organization     : SP Boucher
 * Website          : https://spboucher.ai
 * Git              : https://git.spboucher.ai
 *
 * Preferred Contact: contact@spboucher.ai
 * Development      : dev@spboucher.ai
 * Support          : support@spboucher.ai
 * Security/Admin   : admin@spboucher.ai
 *
 * Copyright (c) 2026
 * Simon-Pierre Boucher
 * All rights reserved where applicable. This file is governed by the
 * applicable project license, copyright notices and relevant law.
 * Existing third-party rights and notices remain unaffected.
 *
 * License          : None specified (no license file in this repository)
 *
 * Do not embed credentials, private keys, access tokens,
 * certificates or confidential personal information.
 *
 * =============================================================================
 * END OF SP BOUCHER SOURCE HEADER
 * =============================================================================
 */

import fs from "node:fs";
import path from "node:path";
import { mergeCanvas, gridLayout, forceLayout, LayoutRandom, type CanvasData, type CanvasEdge, type CanvasNode } from "../src/lib/canvas/model";

const OUT = path.join(process.cwd(), "tests/fixtures/canvas");
const node = (id: string, x = 0, y = 0, extra: Record<string, unknown> = {}): CanvasNode => ({ id, kind: "text", x, y, w: 100, h: 60, z: 0, text: id, ...extra });
const edge = (id: string, from: string, to: string, extra: Record<string, unknown> = {}): CanvasEdge => ({ id, from, to, ...extra });
const doc = (nodes: CanvasNode[], edges: CanvasEdge[] = [], extra: Record<string, unknown> = {}): CanvasData => ({ format: "spn-canvas-1", nodes, edges, viewport: { x: 0, y: 0, zoom: 1 }, ...extra });
const edit = (d: CanvasData, fn: (d: { nodes: CanvasNode[]; edges: CanvasEdge[]; top: Record<string, unknown> }) => void): CanvasData => {
  const c = JSON.parse(JSON.stringify(d)) as CanvasData; const { nodes, edges, ...top } = c; const box = { nodes, edges, top: top as Record<string, unknown> }; fn(box);
  return { ...box.top, nodes: box.nodes, edges: box.edges } as CanvasData;
};

interface MergeCase { name: string; note: string; base: CanvasData; local: CanvasData; remote: CanvasData }
const base = doc([node("a", 0, 0), node("b", 200, 0), node("c", 400, 0), node("d", 0, 200, { kind: "hologram", payload: { deep: [1, { k: null }] } })], [edge("e1", "a", "b", { label: "cause", kind: "arrow" }), edge("e2", "b", "c"), edge("e3", "c", "d", { weight: 3 })], { theme: { grid: true, step: 8 } });
const cases: MergeCase[] = [
  { name: "different-nodes", note: "each side edits another node: both edits are taken, no conflict", base,
    local: edit(base, (d) => { d.nodes[0].x = 50; d.nodes[0].text = "A (local)"; }), remote: edit(base, (d) => { d.nodes[1].y = 80; d.nodes[1].color = "#2f5ddb"; }) },
  { name: "same-change", note: "the same change on both sides is taken once", base,
    local: edit(base, (d) => { d.nodes[2].text = "same"; d.nodes.splice(1, 1); d.edges = d.edges.filter((e) => e.from !== "b" && e.to !== "b"); }),
    remote: edit(base, (d) => { d.nodes[2].text = "same"; d.nodes.splice(1, 1); d.edges = d.edges.filter((e) => e.from !== "b" && e.to !== "b"); d.nodes[0].w = 180; }) },
  { name: "both-edited", note: "the same node changed differently: local kept, conflict carries base / local / remote", base,
    local: edit(base, (d) => { d.nodes[0].text = "mine"; }), remote: edit(base, (d) => { d.nodes[0].text = "theirs"; d.nodes[2].x = 444; }) },
  { name: "edit-vs-delete-local-edits", note: "local edits a node the remote deleted: the edited node is kept and reported (SPEC §7); its untouched edges come back with it only when they still exist on a side", base,
    local: edit(base, (d) => { d.nodes[1].text = "B edited"; }), remote: edit(base, (d) => { d.nodes.splice(1, 1); d.edges = d.edges.filter((e) => e.from !== "b" && e.to !== "b"); }) },
  { name: "edit-vs-delete-remote-edits", note: "the remote edited a node deleted locally: the remote (edited) version is kept and reported", base,
    local: edit(base, (d) => { d.nodes.splice(2, 1); d.edges = d.edges.filter((e) => e.from !== "c" && e.to !== "c"); }), remote: edit(base, (d) => { d.nodes[2].h = 99; }) },
  { name: "added-both-sides", note: "nodes added by both sides: appended after the base nodes sorted by Unicode scalar value (\"ﬁ\" U+FB01 before \"😀\" U+1F600, the reverse of UTF-16 order); the same id added with different values is a conflict", base,
    local: edit(base, (d) => { d.nodes.push(node("😀", 10, 300), node("z-local", 20, 300), node("twin", 1, 1)); }),
    remote: edit(base, (d) => { d.nodes.push(node("ﬁ", 30, 300), node("Z-remote", 40, 300), node("twin", 2, 2)); d.edges.push(edge("e-new", "ﬁ", "a")); }) },
  { name: "deleted-node-untouched-edge", note: "a node deleted on one side: its edges, unchanged since the base, go with it even though the other side still lists them", base,
    local: edit(base, (d) => { d.nodes[0].text = "A2"; }), remote: edit(base, (d) => { d.nodes.splice(1, 1); d.edges = d.edges.filter((e) => e.from !== "b" && e.to !== "b"); }) },
  { name: "deleted-but-referenced", note: "the remote deleted node c; locally a new edge was attached to c and an existing edge of c was relabelled: c is restored at its base position, conflict deletedButReferenced", base,
    local: edit(base, (d) => { d.edges.push(edge("e9", "a", "c", { label: "new" })); d.edges[1].label = "relabelled"; }), remote: edit(base, (d) => { d.nodes.splice(2, 1); d.edges = d.edges.filter((e) => e.from !== "c" && e.to !== "c"); }) },
  { name: "edges", note: "edge edited on one side, deleted on the other (kept, reported); edge relabelled differently on both sides (local kept, reported)", base,
    local: edit(base, (d) => { d.edges[0].label = "local label"; d.edges.splice(2, 1); }), remote: edit(base, (d) => { d.edges[0].label = "remote label"; d.edges[2].weight = 5; }) },
  { name: "fields-and-viewport", note: "top-level fields: one-sided change taken, two-sided change = field conflict (local kept), field removed vs changed = editedAndDeleted; viewport: local wins, never a conflict", base: { ...base, legacy: "old" },
    local: edit({ ...base, legacy: "old" }, (d) => { d.top.theme = { grid: false, step: 8 }; d.top.viewport = { x: 10, y: 20, zoom: 2 }; delete d.top.legacy; d.top.addedLocal = [1, 2]; }),
    remote: edit({ ...base, legacy: "old" }, (d) => { d.top.theme = { grid: true, step: 16 }; d.top.viewport = { x: -5, y: 0, zoom: 0.5 }; d.top.addedRemote = "r"; d.top.legacy = "new"; }) },
  { name: "viewport-remote-only", note: "only the remote moved the viewport (and local edited a node): the remote viewport is taken", base,
    local: edit(base, (d) => { d.nodes[0].x = 7; }), remote: edit(base, (d) => { d.top.viewport = { x: 100, y: 100, zoom: 1.5 }; }) },
  { name: "unknown-fields", note: "unknown node kinds, unknown fields and explicit nulls travel through a merge untouched", base,
    local: edit(base, (d) => { d.nodes[3].payload = { deep: [2] }; d.nodes[0].future = { a: null }; }), remote: edit(base, (d) => { d.nodes[1].locked = true; d.edges[2].weight = null; }) },
  { name: "duplicate-ids", note: "elements sharing an id inside one canvas: the first occurrence counts",
    base: doc([node("a"), node("a", 9, 9), node("b")]), local: doc([node("a", 1, 1), node("a", 9, 9), node("b")]), remote: doc([node("a"), node("b", 5, 5), node("b", 6, 6)]) },
  { name: "local-equals-base", note: "nothing changed locally: the remote document is returned untouched", base, local: base, remote: edit(base, (d) => { d.nodes.reverse(); d.nodes[0].x = 1; }) },
  { name: "remote-equals-base", note: "nothing changed remotely: the local document is returned untouched (its own order included)", base, local: edit(base, (d) => { d.nodes.reverse(); d.nodes[0].x = 1; }), remote: base },
];

/** Random canvases and edits from the shared SplitMix64 generator, so every platform can regenerate the same inputs. */
function randomCase(seed: number): MergeCase {
  const rng = new LayoutRandom(seed); const int = (n: number) => Number(rng.next() % BigInt(n));
  const n = 4 + int(5); const b = doc(Array.from({ length: n }, (_, i) => node(`n${i}`, int(900), int(600))), []);
  for (let i = 1; i < n; i++) if (int(3) > 0) b.edges.push(edge(`e${i}`, `n${int(i)}`, `n${i}`));
  const mutate = (side: string) => edit(b, (d) => {
    const ops = 1 + int(4);
    for (let k = 0; k < ops; k++) {
      const op = int(6); const i = d.nodes.length ? int(d.nodes.length) : 0;
      if (op === 0 && d.nodes.length) { d.nodes[i].x = int(900); d.nodes[i].y = int(600); }
      else if (op === 1 && d.nodes.length) d.nodes[i].text = `${d.nodes[i].id} ${side}${int(3)}`;
      else if (op === 2 && d.nodes.length > 2) { const id = d.nodes[i].id; d.nodes.splice(i, 1); d.edges = d.edges.filter((e) => e.from !== id && e.to !== id); }
      else if (op === 3) d.nodes.push(node(`${side}${int(4)}`, int(900), int(600)));
      else if (op === 4 && d.nodes.length > 1) { const from = d.nodes[i].id, to = d.nodes[int(d.nodes.length)].id; const id = `x${side}${int(3)}`; if (!d.edges.some((e) => e.id === id)) d.edges.push(edge(id, from, to)); }
      else if (d.edges.length) d.edges[int(d.edges.length)].label = `${side}${int(3)}`;
    }
  });
  return { name: `random-${seed}`, note: `generated from SplitMix64 seed ${seed}`, base: b, local: mutate("l"), remote: mutate("r") };
}

fs.mkdirSync(OUT, { recursive: true });
const write = (file: string, value: unknown) => fs.writeFileSync(path.join(OUT, file), JSON.stringify(value, null, 1) + "\n");
const mergeOut = [...cases, ...Array.from({ length: 24 }, (_, i) => randomCase(i + 1))].map((c) => { const r = mergeCanvas(c.base, c.local, c.remote); return { ...c, expected: { merged: r.merged, conflicts: r.conflicts } }; });
write("merge-cases.json", { format: "spn-canvas-fixture-1", about: "Three-way merge by node / edge id. For each case: merge(base, local, remote) must equal expected.merged (JSON equality: key order is irrelevant, array order matters) and report exactly expected.conflicts, in this order. In a conflict an absent base / local / remote key means the element is absent on that side.", cases: mergeOut });

const pile = (n: number, edges = true) => { const d = doc(Array.from({ length: n }, (_, i) => node(`n${i}`, i % 3, i % 2, { w: 80 + (i % 4) * 40, h: 40 + (i % 3) * 30 }))); if (edges) for (let i = 1; i < n; i++) d.edges.push(edge(`e${i}`, `n${Math.floor((i - 1) / 2)}`, `n${i}`)); return d; };
const same = doc(Array.from({ length: 6 }, (_, i) => node(`n${i}`, 50, 50)));
const layouts = [
  { name: "grid-default", op: "grid", params: {}, input: pile(11) },
  { name: "grid-4-columns", op: "grid", params: { columns: 4, spacing: 20, origin: { x: 100, y: -50 } }, input: pile(11) },
  { name: "grid-pinned", op: "grid", params: { pinned: ["n3", "n7"] }, input: pile(11) },
  { name: "force-pile-12-seed-7", op: "forceDirected", params: { iterations: 300, seed: 7 }, input: pile(12) },
  { name: "force-pile-12-seed-7-5-steps", op: "forceDirected", params: { iterations: 5, seed: 7 }, input: pile(12) },
  { name: "force-coincident-seed-1", op: "forceDirected", params: { iterations: 120, seed: 1 }, input: same },
  { name: "force-coincident-seed-2", op: "forceDirected", params: { iterations: 120, seed: 2 }, input: same },
  { name: "force-pinned-forces", op: "forceDirected", params: { iterations: 80, seed: 3, pinned: ["n0"], forces: { spacing: 24, repulsion: 0.4, attraction: 0.1, maxStep: 60 } }, input: pile(9) },
  { name: "force-no-edges", op: "forceDirected", params: { iterations: 60, seed: 11 }, input: pile(8, false) },
].map((c) => {
  const p = c.params as { columns?: number; spacing?: number; origin?: { x: number; y: number }; pinned?: string[]; iterations?: number; seed?: number; forces?: Record<string, number> };
  const pinned = new Set(p.pinned ?? []);
  const expected = c.op === "grid" ? gridLayout(c.input, { columns: p.columns, spacing: p.spacing, origin: p.origin, pinned }) : forceLayout(c.input, { iterations: p.iterations, seed: p.seed, forces: p.forces, pinned });
  return { ...c, expected };
});
const rng = new LayoutRandom(42);
write("layout-cases.json", { format: "spn-canvas-fixture-1", about: "Automatic layouts. op grid = CanvasLayout.grid(input, columns, spacing (default 48), origin (default 0,0), pinned); op forceDirected = CanvasLayout.forceDirected(input, iterations, seed, forces (defaults spacing 48, repulsion 0.5, attraction 0.08, maxStep 120), pinned). expected must match exactly (positions are rounded to 1/100).", random: { about: "first 8 values of SplitMix64(seed 42).next() as decimal strings, then 4 values of signedUnit()", next: Array.from({ length: 8 }, () => rng.next().toString()), signedUnit: Array.from({ length: 4 }, () => rng.signedUnit()) }, cases: layouts });
console.log(`wrote ${mergeOut.length} merge cases and ${layouts.length} layout cases to ${OUT}`);
