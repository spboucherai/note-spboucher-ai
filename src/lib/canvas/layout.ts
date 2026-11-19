/**
 * file: src/lib/canvas/layout.ts
 * description: automatic layout of a canvas — a size-aware grid and a deterministic, seeded force-directed layout (repulsion between
 *   cards, springs along edges). Line-for-line port of SPNotesCore `CanvasLayout.swift`: same generator (SplitMix64), same order of
 *   floating-point operations, same rounding (half away from zero, 1/100 unit), so the same canvas + seed gives the same positions on
 *   the web and on the native apps (fixtures: tests/fixtures/canvas/layout-*.json). Pure.
 * author: Simon-Pierre Boucher — contact@spboucher.ai
 */
import type { CanvasData, CanvasNode } from "./format";
import type { Point } from "./core";

const MASK = (1n << 64n) - 1n;
/** SplitMix64: the same seed gives the same sequence on every platform. */
export class LayoutRandom {
  private state: bigint;
  constructor(seed: number | bigint) { this.state = BigInt.asUintN(64, BigInt(seed)); }
  next(): bigint {
    this.state = (this.state + 0x9e3779b97f4a7c15n) & MASK;
    let z = this.state;
    z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK;
    z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MASK;
    return z ^ (z >> 31n);
  }
  /** A value in −1…1. */
  signedUnit(): number { return (Number(this.next() >> 11n) / 9007199254740992) * 2 - 1; }
}

export interface Forces {
  /** Free space wanted between two cards. */ spacing: number;
  /** Strength of the push between cards closer than their sizes plus `spacing`. */ repulsion: number;
  /** Strength of the pull along an edge longer than its rest length. */ attraction: number;
  /** Largest move of a card in one step at temperature 1. */ maxStep: number;
}
export const DEFAULT_FORCES: Forces = { spacing: 48, repulsion: 0.5, attraction: 0.08, maxStep: 120 };

/** Swift's `Double.rounded()`: to nearest, ties away from zero (`Math.round` sends −2.5 to −2). */
export function roundHalfAway(v: number): number { const a = Math.abs(v), f = Math.floor(a); const r = a - f >= 0.5 ? f + 1 : f; return v < 0 ? -r : r; }
const size = (n: CanvasNode): [number, number] => [Math.max(0, n.w), Math.max(0, n.h)];

/**
 * Places the nodes on a grid, in array order, row by row. Each column is as wide as its widest card and each row as tall as its
 * tallest, so cards never overlap. `columns` undefined picks ⌈√n⌉. Sizes, edges and ids are untouched; `pinned` nodes keep their
 * position and take no cell.
 */
export function gridLayout(d: CanvasData, opts: { columns?: number; spacing?: number; origin?: Point; pinned?: ReadonlySet<string> } = {}): CanvasData {
  const pinned = opts.pinned ?? new Set<string>(); const origin = opts.origin ?? { x: 0, y: 0 }; const spacing = opts.spacing ?? 48;
  const movable: number[] = []; d.nodes.forEach((n, i) => { if (!pinned.has(n.id)) movable.push(i); });
  if (!movable.length) return d;
  const cols = Math.max(1, Math.trunc(opts.columns ?? Math.ceil(Math.sqrt(movable.length))));
  const gap = Number.isFinite(spacing) ? Math.max(0, spacing) : 0;
  const rows = Math.floor((movable.length + cols - 1) / cols);
  const colWidth = new Array<number>(cols).fill(0), rowHeight = new Array<number>(rows).fill(0);
  movable.forEach((i, n) => { const [w, h] = size(d.nodes[i]); colWidth[n % cols] = Math.max(colWidth[n % cols], w); rowHeight[Math.floor(n / cols)] = Math.max(rowHeight[Math.floor(n / cols)], h); });
  const colX = new Array<number>(cols).fill(origin.x), rowY = new Array<number>(rows).fill(origin.y);
  for (let c = 1; c < cols; c++) colX[c] = colX[c - 1] + colWidth[c - 1] + gap;
  for (let r = 1; r < rows; r++) rowY[r] = rowY[r - 1] + rowHeight[r - 1] + gap;
  const nodes = d.nodes.slice(); let changed = false;
  movable.forEach((i, n) => { const x = colX[n % cols], y = rowY[Math.floor(n / cols)]; if (nodes[i].x !== x || nodes[i].y !== y) { nodes[i] = { ...nodes[i], x, y }; changed = true; } });
  return changed ? { ...d, nodes } : d;
}

/**
 * One step of the force-directed layout: every movable card is pushed away from the cards it is too close to (closer than the sum of
 * their half-diagonals plus `spacing`) and pulled along its edges (longer than that rest length), then moved by at most
 * `maxStep × temperature`. Cards at the same centre are separated in a direction drawn from `random`. Positions are rounded to 1/100.
 */
export function layoutStep(d: CanvasData, temperature: number, forces: Forces, pinned: ReadonlySet<string>, random: LayoutRandom): CanvasData {
  const count = d.nodes.length; if (!count) return d;
  const cx = new Float64Array(count), cy = new Float64Array(count), radius = new Float64Array(count); const index = new Map<string, number>();
  d.nodes.forEach((node, i) => { const [w, h] = size(node); cx[i] = node.x + w / 2; cy[i] = node.y + h / 2; radius[i] = Math.sqrt(w * w + h * h) / 2; if (!index.has(node.id)) index.set(node.id, i); });
  const spacing = Number.isFinite(forces.spacing) ? Math.max(0, forces.spacing) : 0;
  const fx = new Float64Array(count), fy = new Float64Array(count);
  for (let i = 0; i < count; i++) for (let j = i + 1; j < count; j++) {
    let dx = cx[i] - cx[j], dy = cy[i] - cy[j]; let dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 1e-6) {
      dx = random.signedUnit(); dy = random.signedUnit();
      if (Math.abs(dx) < 1e-3 && Math.abs(dy) < 1e-3) dx = 1;
      dist = Math.sqrt(dx * dx + dy * dy); dx /= dist; dy /= dist; dist = 0;
    } else { dx /= dist; dy /= dist; }
    const rest = radius[i] + radius[j] + spacing; if (!(dist < rest)) continue;
    const push = (rest - dist) * forces.repulsion;
    fx[i] += dx * push; fy[i] += dy * push; fx[j] -= dx * push; fy[j] -= dy * push;
  }
  for (const edge of d.edges) {
    const a = index.get(edge.from), b = index.get(edge.to); if (a === undefined || b === undefined || a === b) continue;
    const dx = cx[b] - cx[a], dy = cy[b] - cy[a]; const dist = Math.sqrt(dx * dx + dy * dy); const rest = radius[a] + radius[b] + spacing;
    if (!(dist > rest && dist > 1e-6)) continue;
    const pull = (dist - rest) * forces.attraction;
    fx[a] += (dx / dist) * pull; fy[a] += (dy / dist) * pull; fx[b] -= (dx / dist) * pull; fy[b] -= (dy / dist) * pull;
  }
  const limit = Math.max(0, Number.isFinite(forces.maxStep) ? forces.maxStep : 0) * Math.min(1, Math.max(0, Number.isFinite(temperature) ? temperature : 0));
  let nodes: CanvasNode[] | null = null;
  for (let i = 0; i < count; i++) {
    const node = d.nodes[i]; if (pinned.has(node.id)) continue;
    let mx = fx[i], my = fy[i]; const m = Math.sqrt(mx * mx + my * my);
    if (!(Number.isFinite(m) && m > 0)) continue;
    if (m > limit) { mx = (mx / m) * limit; my = (my / m) * limit; }
    const nx = roundHalfAway((node.x + mx) * 100) / 100, ny = roundHalfAway((node.y + my) * 100) / 100;
    if (!Number.isFinite(nx) || !Number.isFinite(ny)) continue;
    if (nx !== node.x || ny !== node.y) { nodes ??= d.nodes.slice(); nodes[i] = { ...node, x: nx === 0 ? 0 : nx, y: ny === 0 ? 0 : ny }; }
  }
  return nodes ? { ...d, nodes } : d;
}

/** `iterations` steps with a linearly decreasing temperature (1 → 1/n). Deterministic for a canvas, a seed and parameters. */
export function forceLayout(d: CanvasData, opts: { iterations?: number; seed?: number | bigint; forces?: Partial<Forces>; pinned?: ReadonlySet<string> } = {}): CanvasData {
  const n = Math.max(0, Math.trunc(opts.iterations ?? 200)); const forces = { ...DEFAULT_FORCES, ...(opts.forces ?? {}) }; const pinned = opts.pinned ?? new Set<string>();
  const rng = new LayoutRandom(opts.seed ?? 1); let out = d;
  for (let i = 0; i < n; i++) out = layoutStep(out, 1 - i / n, forces, pinned, rng);
  return out;
}

/** Total area shared by pairs of cards (0 = no overlap). */
export function overlapArea(d: CanvasData): number {
  let total = 0; const ns = d.nodes;
  for (let i = 0; i < ns.length; i++) for (let j = i + 1; j < ns.length; j++) {
    const [wi, hi] = size(ns[i]), [wj, hj] = size(ns[j]);
    const w = Math.min(ns[i].x + wi, ns[j].x + wj) - Math.max(ns[i].x, ns[j].x), h = Math.min(ns[i].y + hi, ns[j].y + hj) - Math.max(ns[i].y, ns[j].y);
    if (w > 0 && h > 0) total += w * h;
  }
  return total;
}
/** What the force-directed layout minimises (see `layoutStep`). */
export function layoutEnergy(d: CanvasData, forces: Forces = DEFAULT_FORCES): number {
  const c = d.nodes.map((n) => { const [w, h] = size(n); return [n.x + w / 2, n.y + h / 2, Math.sqrt(w * w + h * h) / 2] as const; });
  let e = 0;
  for (let i = 0; i < c.length; i++) for (let j = i + 1; j < c.length; j++) { const dist = Math.hypot(c[i][0] - c[j][0], c[i][1] - c[j][1]); const rest = c[i][2] + c[j][2] + forces.spacing; if (dist < rest) e += forces.repulsion * (rest - dist) * (rest - dist); }
  const index = new Map<string, number>(); d.nodes.forEach((n, i) => { if (!index.has(n.id)) index.set(n.id, i); });
  for (const edge of d.edges) { const a = index.get(edge.from), b = index.get(edge.to); if (a === undefined || b === undefined || a === b) continue; const dist = Math.hypot(c[a][0] - c[b][0], c[a][1] - c[b][1]); const rest = c[a][2] + c[b][2] + forces.spacing; if (dist > rest) e += forces.attraction * (dist - rest) * (dist - rest); }
  return e;
}

/**
 * "Tidy up" (web UI policy, not a format rule): a canvas with connections gets the force-directed layout (fewer iterations when it is
 * large: the step is quadratic), one without connections gets the grid. The layout is anchored: the result is translated so that the
 * top-left corner of the content stays where it was. `only` restricts the move to those nodes (the others are pinned).
 */
export function tidyLayout(d: CanvasData, opts: { seed?: number; only?: ReadonlySet<string> } = {}): CanvasData {
  if (d.nodes.length < 2) return d;
  const pinned = opts.only ? new Set(d.nodes.filter((n) => !opts.only!.has(n.id)).map((n) => n.id)) : new Set<string>();
  const before = corner(d, pinned); if (!before) return d;
  const linked = d.edges.some((e) => e.from !== e.to && !pinned.has(e.from) && !pinned.has(e.to));
  const n = d.nodes.length - pinned.size;
  let out = linked ? forceLayout(d, { iterations: n > 600 ? 60 : n > 250 ? 120 : 200, seed: opts.seed ?? 1, pinned }) : gridLayout(d, { origin: before, pinned });
  const after = corner(out, pinned);
  if (after && (after.x !== before.x || after.y !== before.y)) {
    const dx = before.x - after.x, dy = before.y - after.y;
    out = { ...out, nodes: out.nodes.map((node) => (pinned.has(node.id) ? node : { ...node, x: roundHalfAway((node.x + dx) * 100) / 100, y: roundHalfAway((node.y + dy) * 100) / 100 })) };
  }
  return out;
}
function corner(d: CanvasData, pinned: ReadonlySet<string>): Point | null {
  let x = Infinity, y = Infinity;
  for (const n of d.nodes) if (!pinned.has(n.id)) { if (n.x < x) x = n.x; if (n.y < y) y = n.y; }
  return Number.isFinite(x) ? { x, y } : null;
}
/** Positions between two layouts of the same nodes at `t` (0…1) — the frames of the "Tidy up" animation. Only x / y are interpolated. */
export function interpolateLayout(from: CanvasData, to: CanvasData, t: number): CanvasData {
  if (t >= 1) return to; if (t <= 0) return from;
  const start = new Map(from.nodes.map((n) => [n.id, n]));
  return { ...to, nodes: to.nodes.map((n) => { const a = start.get(n.id); return a && (a.x !== n.x || a.y !== n.y) ? { ...n, x: a.x + (n.x - a.x) * t, y: a.y + (n.y - a.y) * t } : n; }) };
}
