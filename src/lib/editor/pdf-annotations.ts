/**
 * file: src/lib/editor/pdf-annotations.ts
 * description: pure geometry and list helpers of the `pdf` block (SPEC §2). Annotation rects are stored relative to the page
 *   (0..1, origin top-left) so they survive zoom, resize and other clients' renderers. Every helper returns new arrays/objects:
 *   ProseMirror shares attrs, nothing is mutated in place; unknown keys of an annotation are always carried over.
 * author: Simon-Pierre Boucher — contact@spboucher.ai
 */
import type { PdfAnnotation } from "./next-node-defs";

export interface BoxLike { left: number; top: number; width: number; height: number }
export type NormRect = [number, number, number, number];

/** The four highlight colours offered by the viewer (`#rrggbb`, SPEC). */
export const HIGHLIGHT_COLORS: { color: string; label: string }[] = [
  { color: "#ffd84d", label: "Yellow" }, { color: "#7bd88f", label: "Green" }, { color: "#6cb8ff", label: "Blue" }, { color: "#ff8fb1", label: "Pink" },
];
export const DEFAULT_HIGHLIGHT_COLOR = HIGHLIGHT_COLORS[0].color;
const HEX = /^#[0-9a-fA-F]{6}$/;
/** A stored colour is only ever used in a style if it is a plain `#rrggbb`. */
export const safeColor = (c: unknown, fallback: string = DEFAULT_HIGHLIGHT_COLOR): string => (typeof c === "string" && HEX.test(c) ? c.toLowerCase() : fallback);

const round4 = (n: number) => Math.round(n * 1e4) / 1e4;
const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);
const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
/** Horizontal gap (fraction of the page width) under which two rects of one line are fused: the space between two words. */
const WORD_GAP = 0.012;

/**
 * Client rects of a text selection → rects relative to the page: 0..1, origin top-left, clamped to the page, zero-size dropped,
 * rects of the same text line merged (overlapping, nested or separated by less than a word gap), rounded to 4 decimals, ordered
 * top→bottom then left→right. Deterministic for a given input set, whatever its order.
 */
export function normaliseRects(clientRects: ArrayLike<BoxLike> | Iterable<BoxLike>, pageRect: BoxLike): NormRect[] {
  if (!pageRect || !finite(pageRect.left) || !finite(pageRect.top) || !finite(pageRect.width) || !finite(pageRect.height) || pageRect.width <= 0 || pageRect.height <= 0) return [];
  const boxes: { x0: number; y0: number; x1: number; y1: number }[] = [];
  for (const r of Array.from(clientRects ?? [])) {
    if (!r || !finite(r.left) || !finite(r.top) || !finite(r.width) || !finite(r.height) || r.width <= 0 || r.height <= 0) continue;
    const x0 = clamp01((r.left - pageRect.left) / pageRect.width), x1 = clamp01((r.left + r.width - pageRect.left) / pageRect.width);
    const y0 = clamp01((r.top - pageRect.top) / pageRect.height), y1 = clamp01((r.top + r.height - pageRect.top) / pageRect.height);
    if (x1 - x0 <= 0 || y1 - y0 <= 0) continue;
    boxes.push({ x0, y0, x1, y1 });
  }
  boxes.sort((a, b) => (a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2 || a.x0 - b.x0 || a.x1 - b.x1 || a.y0 - b.y0);
  // 1. group by text line: a rect joins the current line when it shares at least half of the smaller height with it
  const lines: { y0: number; y1: number; items: { x0: number; y0: number; x1: number; y1: number }[] }[] = [];
  for (const b of boxes) {
    const line = lines[lines.length - 1];
    if (line) {
      const overlap = Math.min(line.y1, b.y1) - Math.max(line.y0, b.y0);
      if (overlap >= 0.5 * Math.min(line.y1 - line.y0, b.y1 - b.y0)) { line.items.push(b); line.y0 = Math.min(line.y0, b.y0); line.y1 = Math.max(line.y1, b.y1); continue; }
    }
    lines.push({ y0: b.y0, y1: b.y1, items: [b] });
  }
  // 2. inside a line, fuse what overlaps or is closer than a word gap
  const out: NormRect[] = [];
  for (const line of lines) {
    line.items.sort((a, b) => a.x0 - b.x0 || a.x1 - b.x1);
    let cur = { ...line.items[0] };
    const push = () => { const x = round4(cur.x0), y = round4(cur.y0), w = round4(cur.x1 - cur.x0), h = round4(cur.y1 - cur.y0); if (w > 0 && h > 0) out.push([x, y, Math.min(w, round4(1 - x)), Math.min(h, round4(1 - y))]); };
    for (let i = 1; i < line.items.length; i++) {
      const b = line.items[i];
      if (b.x0 <= cur.x1 + WORD_GAP) { cur.x1 = Math.max(cur.x1, b.x1); cur.y0 = Math.min(cur.y0, b.y0); cur.y1 = Math.max(cur.y1, b.y1); }
      else { push(); cur = { ...b }; }
    }
    push();
  }
  return out.filter((r) => r[2] > 0 && r[3] > 0).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
}

/** A stored rect → CSS pixels for a page drawn at `pageSize`. */
export function denormaliseRect(rect: readonly number[], pageSize: { width: number; height: number }): BoxLike {
  const [x = 0, y = 0, w = 0, h = 0] = rect ?? [];
  return { left: x * pageSize.width, top: y * pageSize.height, width: w * pageSize.width, height: h * pageSize.height };
}
/** True for a well-formed stored rect (other clients' data is never trusted blindly). */
export const isRect = (r: unknown): r is NormRect => Array.isArray(r) && r.length >= 4 && r.slice(0, 4).every(finite);
export const rectsOf = (a: { rects?: unknown } | null | undefined): NormRect[] => (a && Array.isArray(a.rects) ? (a.rects.filter(isRect) as NormRect[]) : []);
/** Ink points (0..1, like rects) of an `ink` annotation written by another client; malformed points are skipped. */
export const inkPointsOf = (a: { ink?: unknown } | null | undefined): [number, number][] => (a && Array.isArray(a.ink) ? (a.ink.filter((p) => Array.isArray(p) && p.length >= 2 && finite(p[0]) && finite(p[1])) as [number, number][]) : []);

const ID_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";
/** Short random id (10 chars, base 36). */
export function shortId(length = 10): string {
  const bytes = new Uint8Array(length);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) crypto.getRandomValues(bytes); else for (let i = 0; i < length; i++) bytes[i] = Math.floor(Math.random() * 256);
  let id = ""; for (let i = 0; i < length; i++) id += ID_ALPHABET[bytes[i] % 36];
  return id;
}
/** Selected text as stored in `text`: whitespace collapsed, bounded. */
export const cleanSelectionText = (s: string, max = 2000): string => { const t = String(s ?? "").replace(/\s+/g, " ").trim(); return t.length > max ? `${t.slice(0, max - 1)}…` : t; };

export function newAnnotation(init: { page: number; kind?: "highlight" | "note"; color?: string; rects?: NormRect[]; text?: string; note?: string }): PdfAnnotation {
  return {
    id: shortId(), page: Math.max(1, Math.floor(Number(init.page)) || 1), kind: init.kind ?? "highlight", color: safeColor(init.color),
    rects: (init.rects ?? []).filter(isRect).map((r) => [r[0], r[1], r[2], r[3]] as NormRect), text: cleanSelectionText(init.text ?? ""), note: init.note ?? "", createdAt: new Date().toISOString(),
  };
}
/** Only the entries that look like annotations (objects with an id): what the viewer can show. The stored array is left as is. */
export const listAnnotations = (annotations: unknown): PdfAnnotation[] => (Array.isArray(annotations) ? (annotations.filter((a) => a && typeof a === "object" && typeof (a as PdfAnnotation).id === "string") as PdfAnnotation[]) : []);

/** Reading order: page, then position on the page (top→bottom, left→right), then creation time. Returns a new array. */
export function sortAnnotations<T extends Partial<PdfAnnotation>>(annotations: readonly T[]): T[] {
  const pos = (a: T) => { const r = rectsOf(a); if (r.length) return [Math.min(...r.map((x) => x[1])), Math.min(...r.map((x) => x[0]))]; const p = inkPointsOf(a); return p.length ? [Math.min(...p.map((x) => x[1])), Math.min(...p.map((x) => x[0]))] : [2, 2]; };
  return annotations.map((a, i) => ({ a, i, p: pos(a) })).sort((x, y) =>
    (Number(x.a.page) || 0) - (Number(y.a.page) || 0) || x.p[0] - y.p[0] || x.p[1] - y.p[1] || String(x.a.createdAt ?? "").localeCompare(String(y.a.createdAt ?? "")) || x.i - y.i).map((x) => x.a);
}
/** Page number as an integer inside 1..pageCount (1 when unknown or not a number). */
export function clampPage(n: unknown, pageCount: number): number {
  const max = Number.isFinite(pageCount) && pageCount >= 1 ? Math.floor(pageCount) : 1;
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return 1;
  return Math.min(max, Math.max(1, v));
}
/** New array where the annotation `id` has `patch` merged in; every other entry (even malformed) and every unknown key is kept. */
export function patchAnnotation(annotations: unknown, id: string, patch: Partial<PdfAnnotation>): unknown[] {
  return (Array.isArray(annotations) ? annotations : []).map((a) => (a && typeof a === "object" && (a as PdfAnnotation).id === id ? { ...a, ...patch } : a));
}
/** New array without the annotation `id`. */
export function removeAnnotation(annotations: unknown, id: string): unknown[] {
  return (Array.isArray(annotations) ? annotations : []).filter((a) => !(a && typeof a === "object" && (a as PdfAnnotation).id === id));
}
/** The topmost (latest) annotation of `page` whose rects contain the point (page-relative 0..1), or null. */
export function annotationAt(annotations: readonly PdfAnnotation[], page: number, x: number, y: number): PdfAnnotation | null {
  for (let i = annotations.length - 1; i >= 0; i--) {
    const a = annotations[i]; if (a.page !== page || a.kind === "ink") continue;
    if (rectsOf(a).some((r) => x >= r[0] && x <= r[0] + r[2] && y >= r[1] && y <= r[1] + r[3])) return a;
  }
  return null;
}
/** List row, same wording as the Markdown export: `p.<page> — <text> — <note>` (empty parts are left out). */
export function annotationLine(a: Partial<PdfAnnotation>): string {
  const text = a.kind === "ink" && !a.text ? "Ink drawing" : String(a.text ?? "").trim(); const note = String(a.note ?? "").trim();
  return [`p.${Number(a.page) || 1}`, text, note].filter((s) => s !== "").join(" — ");
}
