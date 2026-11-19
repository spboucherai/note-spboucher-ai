/**
 * file: src/lib/editor/ink.ts
 * description: the `spn-ink-1` vector ink format of the `drawing` block (SPEC §2) — types, strict parsing that keeps every key it does
 *   not understand (forward compatibility with the native editors), byte-stable serialisation, geometry (bounds, stroke eraser,
 *   Ramer–Douglas–Peucker simplification) and a renderer written against a minimal structural 2D context so it runs in a browser
 *   canvas and in a unit test alike. Pure: no DOM access, nothing happens at import time.
 * author: Simon-Pierre Boucher — contact@spboucher.ai
 */
export const INK_FORMAT = "spn-ink-1";
export type InkTool = "pen" | "marker" | "highlighter";
export const INK_TOOLS: readonly InkTool[] = ["pen", "marker", "highlighter"];
/** `[x, y, pressure 0..1]` in canvas units. Extra numeric components written by a newer editor (tilt, time…) are kept. */
export type InkPoint = [x: number, y: number, pressure: number, ...rest: number[]];
export interface InkStroke { tool: InkTool; /** `#rrggbbaa` */ color: string; /** nominal width in canvas units */ width: number; points: InkPoint[]; [extra: string]: unknown }
export interface InkDoc { format: typeof INK_FORMAT; width: number; height: number; strokes: InkStroke[]; [extra: string]: unknown }
export interface InkBounds { minX: number; minY: number; maxX: number; maxY: number }
export type XY = readonly [number, number, ...number[]];

const DOC_KEYS = ["format", "width", "height", "strokes"]; const STROKE_KEYS = ["tool", "color", "width", "points"];
const r2 = (n: number) => { const v = Math.round(n * 100) / 100; return v === 0 ? 0 : v; };
const r3 = (n: number) => { const v = Math.round(n * 1000) / 1000; return v === 0 ? 0 : v; };
const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const fin = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export function emptyInk(width: number, height: number): InkDoc { return { format: INK_FORMAT, width, height, strokes: [] }; }

/** Unknown keys, in a deterministic (sorted) order, after the known ones. */
function extras(o: Record<string, unknown>, known: string[]) { const out: Record<string, unknown> = {}; for (const k of Object.keys(o).sort()) if (!known.includes(k) && o[k] !== undefined) out[k] = o[k]; return out; }
/**
 * Stable JSON: fixed key order, coordinates rounded to 2 decimals, pressure to 3 (clamped to 0..1), colour lower-cased.
 * `serializeInk(parseInk(serializeInk(d))) === serializeInk(d)` for every valid document.
 */
export function serializeInk(doc: InkDoc): string {
  return JSON.stringify({
    format: INK_FORMAT, width: r2(doc.width), height: r2(doc.height),
    strokes: doc.strokes.map((s) => ({ tool: s.tool, color: s.color.toLowerCase(), width: r2(s.width), points: s.points.map((p) => [r2(p[0]), r2(p[1]), r3(clamp01(p[2])), ...p.slice(3)]), ...extras(s, STROKE_KEYS) })),
    ...extras(doc, DOC_KEYS),
  });
}

const COLOR = /^#[0-9a-f]{8}$/i;
/**
 * Strict reader of an `spn-ink-1` document (JSON text or an already parsed value). Throws an Error that says what is wrong. Unknown
 * keys of the document and of each stroke are kept as they are. Tolerances: a point without pressure gets 1 (the nominal width), `#rrggbb` gets `ff`.
 */
export function parseInk(input: unknown): InkDoc {
  let v = input;
  if (typeof v === "string") { try { v = JSON.parse(v); } catch { throw new Error("Ink data is not valid JSON"); } }
  if (!isObj(v)) throw new Error("Ink data must be a JSON object");
  if (v.format !== INK_FORMAT) throw new Error(`Unsupported ink format ${typeof v.format === "string" ? `"${v.format}"` : "(missing)"} — expected "${INK_FORMAT}"`);
  if (!fin(v.width) || !fin(v.height) || v.width <= 0 || v.height <= 0) throw new Error("Ink width and height must be positive numbers");
  if (!Array.isArray(v.strokes)) throw new Error("Ink strokes must be an array");
  const strokes = v.strokes.map((s: unknown, i: number): InkStroke => {
    const at = `Ink stroke ${i + 1}`;
    if (!isObj(s)) throw new Error(`${at} must be an object`);
    if (typeof s.tool !== "string" || !(INK_TOOLS as readonly string[]).includes(s.tool)) throw new Error(`${at} has an unknown tool`);
    if (typeof s.color !== "string" || !(COLOR.test(s.color) || /^#[0-9a-f]{6}$/i.test(s.color))) throw new Error(`${at} must have a #rrggbbaa colour`);
    if (!fin(s.width) || s.width <= 0) throw new Error(`${at} must have a positive width`);
    if (!Array.isArray(s.points)) throw new Error(`${at} must have an array of points`);
    const points = s.points.map((p: unknown, j: number): InkPoint => {
      if (!Array.isArray(p) || p.length < 2 || !p.every(fin)) throw new Error(`${at}, point ${j + 1} must be [x, y, pressure]`);
      return [p[0], p[1], p.length > 2 ? clamp01(p[2]) : NO_PRESSURE, ...p.slice(3)];
    });
    return { ...extras(s, STROKE_KEYS), tool: s.tool as InkTool, color: (s.color.length === 7 ? `${s.color}ff` : s.color).toLowerCase(), width: s.width, points };
  });
  return { ...extras(v, DOC_KEYS), format: INK_FORMAT, width: v.width, height: v.height, strokes };
}

/** Bounds of the stroke's ink (half its widest width around the points); null for a stroke without points. */
export function strokeBounds(stroke: InkStroke): InkBounds | null {
  if (!stroke.points.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, maxP = 0;
  for (const p of stroke.points) { if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0]; if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1]; if (p[2] > maxP) maxP = p[2]; }
  const h = strokeWidthAt(stroke, maxP) / 2;
  return { minX: minX - h, minY: minY - h, maxX: maxX + h, maxY: maxY + h };
}
export function inkBounds(doc: InkDoc): InkBounds | null {
  let b: InkBounds | null = null;
  for (const s of doc.strokes) { const x = strokeBounds(s); if (!x) continue; b = b ? { minX: Math.min(b.minX, x.minX), minY: Math.min(b.minY, x.minY), maxX: Math.max(b.maxX, x.maxX), maxY: Math.max(b.maxY, x.maxY) } : x; }
  return b;
}

/**
 * Drawn width for a pressure — ONE law for every platform (lead decision, 3.0 integration: the web adopts the law of the Swift core,
 * so a drawing does not change thickness between devices):
 *   pen          width × (0.35 + 0.65 · p)   → the nominal width at p = 1, 35 % of it at p = 0
 *   marker       width                        (constant)
 *   highlighter  width                        (constant)
 * A point without pressure counts as p = 1; input without a force sensor (mouse, finger) is written with p = 1.
 * Numeric fixture shared with the Swift tests: tests/fixtures/ink/width-law.json.
 */
export const NO_PRESSURE = 1;
export function strokeWidthAt(stroke: Pick<InkStroke, "tool" | "width">, pressure: number): number {
  const p = clamp01(Number.isFinite(pressure) ? pressure : NO_PRESSURE);
  if (stroke.tool === "pen") return stroke.width * (0.35 + 0.65 * p);
  return stroke.width;
}

function distPointSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
const cross = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number) => (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
/** Shortest distance between segments AB and CD (0 when they cross). */
export function segmentDistance(a: XY, b: XY, c: XY, d: XY): number {
  const d1 = cross(c[0], c[1], d[0], d[1], a[0], a[1]), d2 = cross(c[0], c[1], d[0], d[1], b[0], b[1]), d3 = cross(a[0], a[1], b[0], b[1], c[0], c[1]), d4 = cross(a[0], a[1], b[0], b[1], d[0], d[1]);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return 0;
  return Math.min(distPointSeg(a[0], a[1], c[0], c[1], d[0], d[1]), distPointSeg(b[0], b[1], c[0], c[1], d[0], d[1]), distPointSeg(c[0], c[1], a[0], a[1], b[0], b[1]), distPointSeg(d[0], d[1], a[0], a[1], b[0], b[1]));
}
/** True when the eraser path (a polyline, or a single point) passes within `radius` of the stroke's ink. */
export function strokeHit(stroke: InkStroke, path: readonly XY[], radius: number): boolean {
  const b = strokeBounds(stroke); if (!b || !path.length) return false;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of path) { if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0]; if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1]; }
  if (minX - radius > b.maxX || maxX + radius < b.minX || minY - radius > b.maxY || maxY + radius < b.minY) return false;
  const pts = stroke.points, n = pts.length, m = path.length;
  for (let i = 0; i < Math.max(1, n - 1); i++) {
    const a = pts[i], c = pts[Math.min(i + 1, n - 1)], reach = radius + strokeWidthAt(stroke, Math.max(a[2], c[2])) / 2;
    for (let j = 0; j < Math.max(1, m - 1); j++) if (segmentDistance(a, c, path[j], path[Math.min(j + 1, m - 1)]) <= reach) return true;
  }
  return false;
}
/** New document without the strokes the eraser path touches. Returns the same object when nothing is hit (cheap change test). */
export function eraseAt(doc: InkDoc, points: readonly XY[], radius: number): InkDoc {
  if (!points.length) return doc;
  const strokes = doc.strokes.filter((s) => !strokeHit(s, points, Math.max(0, radius)));
  return strokes.length === doc.strokes.length ? doc : { ...doc, strokes };
}

/** Ramer–Douglas–Peucker on x/y; kept points keep their pressure (and extra components). First and last points always survive. */
export function simplifyStroke<P extends XY>(points: readonly P[], tolerance: number): P[] {
  const n = points.length; if (n <= 2 || !(tolerance > 0)) return points.slice();
  const keep = new Uint8Array(n); keep[0] = 1; keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!; let worst = 0, at = -1;
    for (let i = a + 1; i < b; i++) { const d = distPointSeg(points[i][0], points[i][1], points[a][0], points[a][1], points[b][0], points[b][1]); if (d > worst) { worst = d; at = i; } }
    if (at !== -1 && worst > tolerance) { keep[at] = 1; stack.push([a, at], [at, b]); }
  }
  return points.filter((_, i) => keep[i] === 1);
}

/** `#rrggbbaa` (or `#rrggbb`) → opaque `#rrggbb` + alpha 0..1. */
export function splitColor(color: string): { rgb: string; alpha: number } {
  const m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(color);
  if (!m) return { rgb: "#000000", alpha: 1 };
  return { rgb: `#${m[1].toLowerCase()}`, alpha: m[2] ? parseInt(m[2], 16) / 255 : 1 };
}
/** Translucency of a highlighter whose colour was stored opaque. */
export const HIGHLIGHTER_ALPHA = 0.40;
/** Paper colour for a `background` attr: null = transparent ("none"); a hex colour is used as is; any other name is white paper. */
export function backgroundFill(background: string | null | undefined): string | null {
  if (!background || background === "none" || background === "transparent") return null;
  if (/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(background)) return background;
  return background === "black" || background === "dark" ? "#16181d" : "#ffffff";
}

/** The subset of CanvasRenderingContext2D the renderer needs (a real context satisfies it; tests pass a recorder). */
export interface InkContext {
  save(): void; restore(): void; beginPath(): void; moveTo(x: number, y: number): void; lineTo(x: number, y: number): void; stroke(): void;
  arc(x: number, y: number, radius: number, startAngle: number, endAngle: number): void; fill(): void;
  lineWidth: number; lineCap: string; lineJoin: string; strokeStyle: unknown; fillStyle: unknown; globalAlpha: number; globalCompositeOperation: string;
}
/**
 * Draw one stroke. Opaque pen / marker: one round-capped segment per pair of points, its width following pressure. Highlighter (and
 * any translucent stroke, where overlapping segments would bead): a single constant-width path, alpha taken from the colour — the
 * highlighter multiplies with what is under it so ink stays readable through it.
 */
export function drawStroke(ctx: InkContext, stroke: InkStroke, scale = 1): void {
  const pts = stroke.points; if (!pts.length) return;
  const { rgb, alpha } = splitColor(stroke.color), hl = stroke.tool === "highlighter";
  ctx.save();
  ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = rgb; ctx.fillStyle = rgb;
  ctx.globalAlpha = hl && alpha >= 1 ? HIGHLIGHTER_ALPHA : alpha; ctx.globalCompositeOperation = hl ? "multiply" : "source-over";
  if (pts.length === 1) { ctx.beginPath(); ctx.arc(pts[0][0] * scale, pts[0][1] * scale, (strokeWidthAt(stroke, pts[0][2]) * scale) / 2, 0, Math.PI * 2); ctx.fill(); }
  else if (hl || alpha < 1) {
    let sum = 0; for (const p of pts) sum += p[2];
    ctx.lineWidth = strokeWidthAt(stroke, sum / pts.length) * scale; ctx.beginPath(); ctx.moveTo(pts[0][0] * scale, pts[0][1] * scale);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0] * scale, pts[i][1] * scale);
    ctx.stroke();
  } else for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    ctx.lineWidth = strokeWidthAt(stroke, (a[2] + b[2]) / 2) * scale; ctx.beginPath(); ctx.moveTo(a[0] * scale, a[1] * scale); ctx.lineTo(b[0] * scale, b[1] * scale); ctx.stroke();
  }
  ctx.restore();
}
/** Draw every stroke in document order; `scale` = device pixels per canvas unit. The caller clears / paints the background. */
export function drawInk(ctx: InkContext, doc: InkDoc, scale = 1): void { for (const s of doc.strokes) drawStroke(ctx, s, scale); }
