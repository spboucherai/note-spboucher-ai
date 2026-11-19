/**
 * file: src/lib/canvas/core.ts
 * description: pure document operations of the `spn-canvas-1` canvas (SPEC §3.4): tolerant reading, structural equality, ids, defaults
 *   per node kind, add / update / remove, z-order, geometry, hit-testing, snapping guides, group move / resize, align / distribute,
 *   clone (copy / paste / duplicate). Every function returns a new document and never rebuilds a node or an edge from its known
 *   fields: objects are spread, so the fields, node kinds and top-level keys this client does not know survive a load → edit → save.
 *   No DOM, no I/O — mirrored natively by SPNotesCore (`Canvas.swift`); see docs/next/CANVAS.md.
 * author: Simon-Pierre Boucher — contact@spboucher.ai
 */
import { CANVAS_FORMAT, type CanvasData, type CanvasEdge, type CanvasNode } from "./format";

export type { CanvasData, CanvasEdge, CanvasNode };
export interface Point { x: number; y: number }
export interface Rect { x: number; y: number; w: number; h: number }
export type NodeKind = "text" | "page" | "image" | "pdf" | "link" | "drawing" | "shape" | "reference" | "math" | "table";
export type ShapeKind = "rect" | "ellipse" | "diamond";

/* ------------------------------------------------------------------ equality, ids, reading ------------------------------------------------------------------ */

/** Structural JSON equality: key order is irrelevant, an `undefined` value equals an absent key, `null` is a value of its own. */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) { const y = b as unknown[]; if (a.length !== y.length) return false; for (let i = 0; i < a.length; i++) if (!jsonEqual(a[i], y[i])) return false; return true; }
  const x = a as Record<string, unknown>, y = b as Record<string, unknown>;
  let n = 0;
  for (const k in x) { if (x[k] === undefined) continue; n++; if (!jsonEqual(x[k], y[k])) return false; }
  for (const k in y) if (y[k] !== undefined) n--;
  return n === 0;
}

/** Order of strings by Unicode scalar value (what Swift's `unicodeScalars.lexicographicallyPrecedes` gives; JS `<` compares UTF-16 units). */
export function compareCodePoints(a: string, b: string): number {
  let i = 0, j = 0;
  while (i < a.length && j < b.length) {
    const x = a.codePointAt(i)!, y = b.codePointAt(j)!;
    if (x !== y) return x - y;
    i += x > 0xffff ? 2 : 1; j += y > 0xffff ? 2 : 1;
  }
  return (a.length - i) - (b.length - j);
}

/** A fresh element id: a lower-case UUID (36 characters; the server accepts 1…64). `random` is injectable for deterministic tests. */
export function newId(random?: () => number): string {
  if (!random && typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID().toLowerCase();
  const r = random ?? Math.random; let s = "";
  for (let i = 0; i < 32; i++) { const v = i === 12 ? 4 : i === 16 ? 8 + Math.floor(r() * 4) : Math.floor(r() * 16); s += v.toString(16); if (i === 7 || i === 11 || i === 15 || i === 19) s += "-"; }
  return s;
}

export const emptyCanvas = (): CanvasData => ({ format: CANVAS_FORMAT, nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } });
const fin = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/**
 * Tolerant reader: whatever arrives becomes a usable document without losing anything. Missing `nodes` / `edges` become `[]`, a
 * missing or invalid viewport becomes `{x:0, y:0, zoom:1}` (unknown viewport keys are kept), elements that are not objects with a
 * string id are dropped (they could not be addressed), everything else — unknown kinds, unknown fields, unknown top-level keys — is kept.
 */
export function readCanvas(input: unknown): CanvasData {
  const o = (input && typeof input === "object" && !Array.isArray(input) ? input : {}) as Record<string, unknown>;
  const ok = (e: unknown) => !!e && typeof e === "object" && typeof (e as { id?: unknown }).id === "string" && (e as { id: string }).id.length > 0;
  const vp = (o.viewport && typeof o.viewport === "object" ? o.viewport : {}) as Record<string, unknown>;
  return {
    ...o, format: CANVAS_FORMAT,
    nodes: (Array.isArray(o.nodes) ? o.nodes.filter(ok) : []) as CanvasNode[],
    edges: (Array.isArray(o.edges) ? o.edges.filter(ok) : []) as CanvasEdge[],
    viewport: { ...vp, x: fin(vp.x) ? vp.x : 0, y: fin(vp.y) ? vp.y : 0, zoom: fin(vp.zoom) && vp.zoom > 0 ? vp.zoom : 1 },
  };
}

/* ------------------------------------------------------------------ node kinds ------------------------------------------------------------------ */

export const NODE_KINDS: readonly NodeKind[] = ["text", "page", "image", "pdf", "link", "drawing", "shape", "reference", "math", "table"];
export const isKnownKind = (k: string): k is NodeKind => (NODE_KINDS as readonly string[]).includes(k);
export const DEFAULT_SIZE: Record<NodeKind, { w: number; h: number }> = {
  text: { w: 240, h: 120 }, page: { w: 280, h: 132 }, image: { w: 320, h: 240 }, pdf: { w: 240, h: 320 }, link: { w: 280, h: 96 },
  drawing: { w: 360, h: 240 }, shape: { w: 160, h: 120 }, reference: { w: 300, h: 120 }, math: { w: 240, h: 100 }, table: { w: 320, h: 160 },
};
export const MIN_NODE_SIZE = 24;
/** The colours a card can take — the semantic hues of the design system (measured light-theme sRGB, DESIGN-SYSTEM-NEXT §1); stored as `#rrggbb`. */
export const NODE_COLORS: readonly { name: string; hex: string }[] = [
  { name: "Ultramarine", hex: "#2f5ddb" }, { name: "Green", hex: "#008b4e" }, { name: "Amber", hex: "#d98b09" }, { name: "Red", hex: "#cc272e" }, { name: "Graphite", hex: "#535862" },
];

/** A new node of `kind` centred on `at`, with the default size of its kind. `z` is set by `addNode`. */
export function makeNode(kind: NodeKind, at: Point, extra: Partial<CanvasNode> = {}, id: string = newId()): CanvasNode {
  const s = DEFAULT_SIZE[kind]; const w = fin(extra.w) ? extra.w : s.w, h = fin(extra.h) ? extra.h : s.h;
  return { id, kind, x: round2(at.x - w / 2), y: round2(at.y - h / 2), w, h, z: 0, ...(kind === "shape" ? { shape: "rect" } : {}), ...extra };
}
const round2 = (n: number) => { const v = Math.round(n * 100) / 100; return v === 0 ? 0 : v; };

/* ------------------------------------------------------------------ editing ------------------------------------------------------------------ */

export const nodeById = (d: CanvasData, id: string) => d.nodes.find((n) => n.id === id);
export const edgeById = (d: CanvasData, id: string) => d.edges.find((e) => e.id === id);
export const zOf = (n: CanvasNode) => (fin(n.z) ? n.z : 0);
const maxZ = (nodes: readonly CanvasNode[]) => nodes.reduce((m, n) => Math.max(m, zOf(n)), -Infinity);

/** Appends a node in front of the others (its `z` is raised above the current maximum when it is not already). No-op when the id exists. */
export function addNode(d: CanvasData, node: CanvasNode): CanvasData {
  if (nodeById(d, node.id)) return d;
  const top = maxZ(d.nodes); const n = d.nodes.length && zOf(node) <= top ? { ...node, z: top + 1 } : node;
  return { ...d, nodes: [...d.nodes, n] };
}
export function addNodes(d: CanvasData, nodes: readonly CanvasNode[]): CanvasData { return nodes.reduce(addNode, d); }
/** Changes fields of one node (spread: every other field, known or not, is kept). `id` cannot be changed. A patch value of `undefined` removes the key. */
export function updateNode(d: CanvasData, id: string, patch: Partial<CanvasNode>): CanvasData {
  let hit = false;
  const nodes = d.nodes.map((n) => { if (n.id !== id) return n; hit = true; return applyPatch(n, patch); });
  return hit ? { ...d, nodes } : d;
}
function applyPatch<T extends { id: string }>(o: T, patch: Partial<T>): T {
  const out: Record<string, unknown> = { ...o };
  for (const [k, v] of Object.entries(patch)) { if (k === "id") continue; if (v === undefined) delete out[k]; else out[k] = v; }
  return out as T;
}
/** Removes nodes and every edge attached to them. */
export function removeNodes(d: CanvasData, ids: Iterable<string>): CanvasData {
  const gone = new Set(ids); if (!gone.size) return d;
  const nodes = d.nodes.filter((n) => !gone.has(n.id)); if (nodes.length === d.nodes.length) return d;
  return { ...d, nodes, edges: d.edges.filter((e) => !gone.has(e.from) && !gone.has(e.to)) };
}
/** Appends an edge. No-op when the id is used or an end is not a node of the canvas. */
export function addEdge(d: CanvasData, edge: CanvasEdge): CanvasData {
  if (edgeById(d, edge.id) || !nodeById(d, edge.from) || !nodeById(d, edge.to)) return d;
  return { ...d, edges: [...d.edges, edge] };
}
export function updateEdge(d: CanvasData, id: string, patch: Partial<CanvasEdge>): CanvasData {
  let hit = false;
  const edges = d.edges.map((e) => { if (e.id !== id) return e; hit = true; return applyPatch(e, patch); });
  return hit ? { ...d, edges } : d;
}
export function removeEdges(d: CanvasData, ids: Iterable<string>): CanvasData {
  const gone = new Set(ids); const edges = d.edges.filter((e) => !gone.has(e.id));
  return edges.length === d.edges.length ? d : { ...d, edges };
}
/** Edges whose `from` or `to` is not a node of the canvas (the server refuses them). */
export function danglingEdges(d: CanvasData): CanvasEdge[] { const ids = new Set(d.nodes.map((n) => n.id)); return d.edges.filter((e) => !ids.has(e.from) || !ids.has(e.to)); }
/** Moves a node inside the array (the order of the outline / list mode; stacking is decided by `z`, not by this order). */
export function reorderNode(d: CanvasData, id: string, toIndex: number): CanvasData {
  const from = d.nodes.findIndex((n) => n.id === id); if (from < 0) return d;
  const to = Math.max(0, Math.min(d.nodes.length - 1, Math.trunc(toIndex))); if (to === from) return d;
  const nodes = d.nodes.slice(); const [n] = nodes.splice(from, 1); nodes.splice(to, 0, n);
  return { ...d, nodes };
}

/* ------------------------------------------------------------------ z-order ------------------------------------------------------------------ */

/** The nodes in drawing order: ascending `z`, array order breaks ties (a missing `z` counts as 0). */
export function backToFront(d: CanvasData): CanvasNode[] {
  return d.nodes.map((n, i) => ({ n, i })).sort((a, b) => zOf(a.n) - zOf(b.n) || a.i - b.i).map((x) => x.n);
}
/** Puts the nodes in front of every other, keeping their relative order. Only the moved nodes change. */
export function bringToFront(d: CanvasData, ids: Iterable<string>): CanvasData {
  const sel = new Set(ids); const moving = backToFront(d).filter((n) => sel.has(n.id)); if (!moving.length) return d;
  const others = d.nodes.filter((n) => !sel.has(n.id)); if (!others.length) return d;
  let top = maxZ(others); const z = new Map<string, number>();
  for (const n of moving) { top += 1; z.set(n.id, top); }
  if (moving.every((n) => zOf(n) > maxZ(others)) ) return d;
  return { ...d, nodes: d.nodes.map((n) => (z.has(n.id) ? { ...n, z: z.get(n.id)! } : n)) };
}
/** Puts the nodes behind every other, keeping their relative order. */
export function sendToBack(d: CanvasData, ids: Iterable<string>): CanvasData {
  const sel = new Set(ids); const moving = backToFront(d).filter((n) => sel.has(n.id)); if (!moving.length) return d;
  const others = d.nodes.filter((n) => !sel.has(n.id)); if (!others.length) return d;
  const bottom = others.reduce((m, n) => Math.min(m, zOf(n)), Infinity);
  if (moving.every((n) => zOf(n) < bottom)) return d;
  const z = new Map<string, number>(); moving.forEach((n, i) => z.set(n.id, bottom - moving.length + i));
  return { ...d, nodes: d.nodes.map((n) => (z.has(n.id) ? { ...n, z: z.get(n.id)! } : n)) };
}
/** Renumbers `z` to 0, 1, 2… keeping the stacking order. */
export function normalizeZ(d: CanvasData): CanvasData {
  const rank = new Map(backToFront(d).map((n, i) => [n.id, i]));
  return d.nodes.every((n) => n.z === rank.get(n.id)) ? d : { ...d, nodes: d.nodes.map((n) => (n.z === rank.get(n.id) ? n : { ...n, z: rank.get(n.id)! })) };
}
/** One step up (`dir` = 1) or down (−1) in the stacking order: each selected node swaps rank with its unselected neighbour. Renumbers `z`. */
export function stepZ(d: CanvasData, ids: Iterable<string>, dir: 1 | -1): CanvasData {
  const sel = new Set(ids); const order = backToFront(d).map((n) => n.id);
  if (dir === 1) { for (let i = order.length - 2; i >= 0; i--) if (sel.has(order[i]) && !sel.has(order[i + 1])) [order[i], order[i + 1]] = [order[i + 1], order[i]]; }
  else for (let i = 1; i < order.length; i++) if (sel.has(order[i]) && !sel.has(order[i - 1])) [order[i], order[i - 1]] = [order[i - 1], order[i]];
  const rank = new Map(order.map((id, i) => [id, i]));
  if (backToFront(d).every((n, i) => rank.get(n.id) === i)) return d;
  return { ...d, nodes: d.nodes.map((n) => (n.z === rank.get(n.id) ? n : { ...n, z: rank.get(n.id)! })) };
}

/* ------------------------------------------------------------------ geometry, hit-testing ------------------------------------------------------------------ */

export const rectOf = (n: CanvasNode): Rect => ({ x: n.x, y: n.y, w: Math.max(0, n.w), h: Math.max(0, n.h) });
export const centerOf = (r: Rect): Point => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
export const rectsIntersect = (a: Rect, b: Rect) => a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h;
export const rectContains = (outer: Rect, inner: Rect) => inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;
export const rectFromPoints = (a: Point, b: Point): Rect => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) });
/** Smallest rectangle around the rectangles; null for none. */
export function unionRects(rects: readonly Rect[]): Rect | null {
  if (!rects.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of rects) { if (r.x < x0) x0 = r.x; if (r.y < y0) y0 = r.y; if (r.x + r.w > x1) x1 = r.x + r.w; if (r.y + r.h > y1) y1 = r.y + r.h; }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
/** Bounds of the whole canvas (or of the given nodes); null when empty. */
export function contentBounds(d: CanvasData, ids?: Iterable<string>): Rect | null {
  const sel = ids ? new Set(ids) : null;
  return unionRects(d.nodes.filter((n) => !sel || sel.has(n.id)).map(rectOf));
}
/** Is the point inside the node's outline? Shapes are tested against their real outline (ellipse, diamond); every other kind is its rectangle. */
export function pointInNode(n: CanvasNode, p: Point, tolerance = 0): boolean {
  const r = rectOf(n); const hw = r.w / 2 + tolerance, hh = r.h / 2 + tolerance;
  const dx = p.x - (r.x + r.w / 2), dy = p.y - (r.y + r.h / 2);
  if (Math.abs(dx) > hw || Math.abs(dy) > hh) return false;
  if (n.kind !== "shape" || hw === 0 || hh === 0) return true;
  if (n.shape === "ellipse") return (dx * dx) / (hw * hw) + (dy * dy) / (hh * hh) <= 1;
  if (n.shape === "diamond") return Math.abs(dx) / hw + Math.abs(dy) / hh <= 1;
  return true;
}
/** The front-most node under the point (highest `z`, then last in the array). */
export function nodeAt(d: CanvasData, p: Point, tolerance = 0): CanvasNode | null {
  const order = backToFront(d);
  for (let i = order.length - 1; i >= 0; i--) if (pointInNode(order[i], p, tolerance)) return order[i];
  return null;
}
/** Nodes touched by the rectangle (marquee), back to front. `contain` = only the nodes entirely inside. */
export function nodesInRect(d: CanvasData, r: Rect, contain = false): CanvasNode[] {
  return backToFront(d).filter((n) => (contain ? rectContains(r, rectOf(n)) : rectsIntersect(r, rectOf(n))));
}
/** Distance from a point to a polyline (Infinity for fewer than one point). */
export function distanceToPolyline(p: Point, pts: readonly Point[]): number {
  if (!pts.length) return Infinity; if (pts.length === 1) return Math.hypot(p.x - pts[0].x, p.y - pts[0].y);
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i]; const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
    const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
    const dist = Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)); if (dist < best) best = dist;
  }
  return best;
}

/* ------------------------------------------------------------------ move, snap, resize ------------------------------------------------------------------ */

/** Translates the nodes by (dx, dy), rounded to 1/100 of a unit. */
export function moveNodes(d: CanvasData, ids: Iterable<string>, dx: number, dy: number): CanvasData {
  const sel = new Set(ids); if (!sel.size || (dx === 0 && dy === 0)) return d;
  return { ...d, nodes: d.nodes.map((n) => (sel.has(n.id) ? { ...n, x: round2(n.x + dx), y: round2(n.y + dy) } : n)) };
}
export interface Guide { axis: "x" | "y"; /** world coordinate of the line */ at: number; /** extent of the line on the other axis */ from: number; to: number }
export interface Snap { dx: number; dy: number; guides: Guide[] }
/**
 * Alignment snapping for a move. `moving` is the bounding box of what is dragged, already translated by the raw pointer delta;
 * `others` are the rectangles it can align with. On each axis the three lines of the box (start, centre, end) are compared with the
 * three lines of every other rectangle; the smallest correction within `threshold` wins (ties: the first rectangle, then start <
 * centre < end). Returns the correction to ADD to the delta and one guide per snapped axis spanning both rectangles.
 */
export function snapMove(moving: Rect, others: readonly Rect[], threshold: number): Snap {
  const out: Snap = { dx: 0, dy: 0, guides: [] };
  for (const axis of ["x", "y"] as const) {
    const pos = axis === "x" ? moving.x : moving.y, size = axis === "x" ? moving.w : moving.h;
    const mine = [pos, pos + size / 2, pos + size];
    let best: { delta: number; at: number; other: Rect } | null = null;
    for (const o of others) {
      const op = axis === "x" ? o.x : o.y, os = axis === "x" ? o.w : o.h;
      for (const target of [op, op + os / 2, op + os]) for (const m of mine) {
        const delta = target - m;
        if (Math.abs(delta) <= threshold && (!best || Math.abs(delta) < Math.abs(best.delta))) best = { delta, at: target, other: o };
      }
    }
    if (!best) continue;
    if (axis === "x") { out.dx = best.delta; out.guides.push({ axis, at: best.at, from: Math.min(moving.y, best.other.y), to: Math.max(moving.y + moving.h, best.other.y + best.other.h) }); }
    else { out.dy = best.delta; out.guides.push({ axis, at: best.at, from: Math.min(moving.x, best.other.x), to: Math.max(moving.x + moving.w, best.other.x + best.other.w) }); }
  }
  return out;
}
export const snapToGrid = (v: number, step: number) => (step > 0 ? Math.round(v / step) * step : v);

export type Handle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
/**
 * Resizes a group: the bounding box of the nodes is dragged by `handle` by (dx, dy) and every node is scaled with it (positions and
 * sizes proportionally; a single node is simply resized). The box never gets smaller than `min` on a side and never flips.
 * `keepAspect` keeps the proportions of the box (corner handles: the larger scale wins; side handles: the other axis follows, centred).
 */
export function resizeNodes(d: CanvasData, ids: Iterable<string>, handle: Handle, dx: number, dy: number, opts: { min?: number; keepAspect?: boolean } = {}): CanvasData {
  const sel = new Set(ids); const box = contentBounds(d, sel); if (!box) return d;
  const next = resizeRect(box, handle, dx, dy, opts.min ?? MIN_NODE_SIZE, opts.keepAspect ?? false);
  if (next.x === box.x && next.y === box.y && next.w === box.w && next.h === box.h) return d;
  const sx = box.w > 0 ? next.w / box.w : 1, sy = box.h > 0 ? next.h / box.h : 1;
  return { ...d, nodes: d.nodes.map((n) => (sel.has(n.id) ? { ...n, x: round2(next.x + (n.x - box.x) * sx), y: round2(next.y + (n.y - box.y) * sy), w: round2(Math.max(0, n.w) * sx), h: round2(Math.max(0, n.h) * sy) } : n)) };
}
export function resizeRect(box: Rect, handle: Handle, dx: number, dy: number, min: number, keepAspect: boolean): Rect {
  let x0 = box.x, y0 = box.y, x1 = box.x + box.w, y1 = box.y + box.h;
  const minW = Math.min(min, box.w || min), minH = Math.min(min, box.h || min);
  if (handle.includes("w")) x0 = Math.min(x0 + dx, x1 - minW);
  if (handle.includes("e")) x1 = Math.max(x1 + dx, x0 + minW);
  if (handle.includes("n")) y0 = Math.min(y0 + dy, y1 - minH);
  if (handle.includes("s")) y1 = Math.max(y1 + dy, y0 + minH);
  if (keepAspect && box.w > 0 && box.h > 0) {
    const sx = (x1 - x0) / box.w, sy = (y1 - y0) / box.h;
    const s = handle.length === 2 ? Math.max(sx, sy) : handle === "e" || handle === "w" ? sx : sy;
    const w = box.w * s, h = box.h * s;
    if (handle.length === 2) { if (handle.includes("w")) x0 = x1 - w; else x1 = x0 + w; if (handle.includes("n")) y0 = y1 - h; else y1 = y0 + h; }
    else if (handle === "e" || handle === "w") { const cy = box.y + box.h / 2; y0 = cy - h / 2; y1 = cy + h / 2; }
    else { const cx = box.x + box.w / 2; x0 = cx - w / 2; x1 = cx + w / 2; }
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/* ------------------------------------------------------------------ align, distribute ------------------------------------------------------------------ */

export type Alignment = "left" | "center" | "right" | "top" | "middle" | "bottom";
/** Aligns the nodes on an edge or the centre line of their common bounding box (needs at least two nodes). */
export function alignNodes(d: CanvasData, ids: Iterable<string>, how: Alignment): CanvasData {
  const sel = new Set(ids); const box = contentBounds(d, sel); if (!box || d.nodes.filter((n) => sel.has(n.id)).length < 2) return d;
  return { ...d, nodes: d.nodes.map((n) => {
    if (!sel.has(n.id)) return n; const w = Math.max(0, n.w), h = Math.max(0, n.h);
    const x = how === "left" ? box.x : how === "center" ? box.x + (box.w - w) / 2 : how === "right" ? box.x + box.w - w : n.x;
    const y = how === "top" ? box.y : how === "middle" ? box.y + (box.h - h) / 2 : how === "bottom" ? box.y + box.h - h : n.y;
    return x === n.x && y === n.y ? n : { ...n, x: round2(x), y: round2(y) };
  }) };
}
/** Equal gaps between the nodes along an axis; the first and the last (by position, then by array order) do not move (needs at least three). */
export function distributeNodes(d: CanvasData, ids: Iterable<string>, axis: "horizontal" | "vertical"): CanvasData {
  const sel = new Set(ids); const h = axis === "horizontal";
  const items = d.nodes.map((n, i) => ({ n, i })).filter((x) => sel.has(x.n.id)).sort((a, b) => (h ? a.n.x - b.n.x : a.n.y - b.n.y) || a.i - b.i).map((x) => x.n);
  if (items.length < 3) return d;
  const size = (n: CanvasNode) => Math.max(0, h ? n.w : n.h), pos = (n: CanvasNode) => (h ? n.x : n.y);
  const first = items[0], last = items[items.length - 1];
  const free = pos(last) + size(last) - pos(first) - items.reduce((s, n) => s + size(n), 0); const gap = free / (items.length - 1);
  const at = new Map<string, number>(); let cursor = pos(first);
  for (const n of items) { at.set(n.id, round2(cursor)); cursor += size(n) + gap; }
  at.set(last.id, pos(last));
  return { ...d, nodes: d.nodes.map((n) => { const v = at.get(n.id); return v === undefined || v === pos(n) ? n : h ? { ...n, x: v } : { ...n, y: v }; }) };
}

/* ------------------------------------------------------------------ copy, paste, duplicate ------------------------------------------------------------------ */

export interface Clip { nodes: CanvasNode[]; edges: CanvasEdge[] }
/** What a copy takes: the selected nodes and the edges whose two ends are selected (verbatim, unknown fields included). */
export function copyNodes(d: CanvasData, ids: Iterable<string>): Clip {
  const sel = new Set(ids);
  return { nodes: d.nodes.filter((n) => sel.has(n.id)), edges: d.edges.filter((e) => sel.has(e.from) && sel.has(e.to)) };
}
/** Pastes a clip with fresh ids, translated by `offset`, in front of everything (relative stacking kept). Returns the new document and the new node ids. */
export function pasteClip(d: CanvasData, clip: Clip, offset: Point, idgen: () => string = newId): { data: CanvasData; ids: string[] } {
  const map = new Map<string, string>(); let top = d.nodes.length ? maxZ(d.nodes) : -1;
  const order = clip.nodes.map((n, i) => ({ n, i })).sort((a, b) => zOf(a.n) - zOf(b.n) || a.i - b.i);
  const z = new Map<string, number>(); for (const { n } of order) { top += 1; z.set(n.id, top); }
  const nodes = clip.nodes.map((n) => { const id = idgen(); map.set(n.id, id); return { ...n, id, x: round2(n.x + offset.x), y: round2(n.y + offset.y), z: z.get(n.id)! }; });
  const edges = clip.edges.filter((e) => map.has(e.from) && map.has(e.to)).map((e) => ({ ...e, id: idgen(), from: map.get(e.from)!, to: map.get(e.to)! }));
  return { data: { ...d, nodes: [...d.nodes, ...nodes], edges: [...d.edges, ...edges] }, ids: nodes.map((n) => n.id) };
}

/* ------------------------------------------------------------------ text of a node ------------------------------------------------------------------ */

/** Cells of a `table` node. Convention (SPEC gives a table no field of its own): `text` holds a GitHub-flavoured Markdown table. */
export function parseTable(text: string | undefined | null): string[][] {
  const rows = String(text ?? "").split("\n").map((l) => l.trim()).filter((l) => l.startsWith("|"));
  const cells = rows.filter((l) => !/^\|\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?$/.test(l)).map((l) => l.replace(/^\|/, "").replace(/\|$/, "").split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|").replace(/<br\s*\/?>/gi, "\n")));
  const width = cells.reduce((m, r) => Math.max(m, r.length), 0);
  return cells.map((r) => (r.length < width ? [...r, ...Array(width - r.length).fill("")] : r));
}
export function serializeTable(cells: readonly (readonly string[])[]): string {
  if (!cells.length) return "";
  const width = cells.reduce((m, r) => Math.max(m, r.length), 1);
  const line = (r: readonly string[]) => `| ${Array.from({ length: width }, (_, i) => String(r[i] ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>")).join(" | ")} |`;
  return [line(cells[0]), `| ${Array.from({ length: width }, () => "---").join(" | ")} |`, ...cells.slice(1).map(line)].join("\n");
}
export const emptyTable = (rows = 3, cols = 3) => serializeTable(Array.from({ length: rows }, () => Array.from({ length: cols }, () => "")));
/** One line that names the node in lists, outlines and exports (never empty). `titles` resolves page / reference ids to their titles. */
export function nodeLabel(n: CanvasNode, titles?: (id: string) => string | undefined): string {
  const first = (s: unknown) => (typeof s === "string" ? s.split("\n").map((l) => l.replace(/^[#>*\-\s]+/, "").trim()).find(Boolean) ?? "" : "");
  const text = first(n.text);
  switch (n.kind) {
    case "page": return (typeof n.pageId === "string" && titles?.(n.pageId)) || text || "Page";
    case "reference": return (typeof n.refId === "string" && titles?.(n.refId)) || text || "Reference";
    case "link": return text || (typeof n.url === "string" ? n.url : "") || "Link";
    case "math": return (typeof n.latex === "string" && n.latex.trim()) || text || "Formula";
    case "image": return text || "Image";
    case "pdf": return text || "PDF";
    case "drawing": return text || "Drawing";
    case "table": { const c = parseTable(n.text as string); return c[0]?.filter(Boolean).join(" · ") || "Table"; }
    case "shape": return text || (typeof n.shape === "string" ? n.shape[0].toUpperCase() + n.shape.slice(1) : "Shape");
    case "text": return text || "Text";
    default: return text || `Card (${n.kind})`;
  }
}
