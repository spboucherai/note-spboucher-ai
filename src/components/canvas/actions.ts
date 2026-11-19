"use client";
/**
 * file: src/components/canvas/actions.ts
 * description: what the user can do to a canvas, as functions of the store — shared by the toolbar, the context menu, the keyboard,
 *   the command center and the phone interface, so every entry point behaves the same: add cards, delete, duplicate, clipboard,
 *   z-order, align / distribute, colours, connections, "Tidy up" (animated), zoom, file and page drops, ink, exports.
 * author: Simon-Pierre Boucher — contact@spboucher.ai
 */
import * as M from "@/lib/canvas/model";
import type { CanvasData, CanvasEdge, CanvasNode, NodeKind, Point } from "@/lib/canvas/model";
import { uploadBlob, uploadFile } from "@/lib/client/upload";
import { serializeInk, simplifyStroke, type InkDoc, type InkStroke } from "@/lib/editor/ink";
import { toast } from "@/components/ui/toast";
import type { CanvasStore } from "./store";
import { attachmentDataUrl, imageSize, loadInk, loadPdfThumb, peekInk, peekPdfThumb, putInk } from "./resources";

export const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A place for a new card near `at` that does not cover an existing card: the spot itself when it is free, else the nearest free cell
 * around it (right, below, left, above, then the diagonals, up to 4 rings), else a small cascade.
 */
export function freeSpot(doc: CanvasData, at: Point, w: number, h: number): Point {
  const rects = doc.nodes.map(M.rectOf); const free = (c: Point) => { const r = { x: c.x - w / 2 + 1, y: c.y - h / 2 + 1, w: w - 2, h: h - 2 }; return !rects.some((o) => M.rectsIntersect(r, o)); };
  if (free(at)) return at;
  const sx = w + 32, sy = h + 32;
  for (let ring = 1; ring <= 4; ring++) for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]] as const) { const c = { x: at.x + dx * ring * sx, y: at.y + dy * ring * sy }; if (free(c)) return c; }
  let c = at; for (let i = 0; i < 40 && doc.nodes.some((n) => Math.abs(n.x + n.w / 2 - c.x) < 8 && Math.abs(n.y + n.h / 2 - c.y) < 8); i++) c = { x: c.x + 24, y: c.y + 24 };
  return c;
}
/**
 * Adds a card of `kind`, selects it and returns its id. With `at` the card is centred exactly there (context menu, drop); without,
 * it goes near the pointer when it is over the canvas, else near the centre of the view — on a free spot (`centre: true` = always the view).
 */
export function addCard(store: CanvasStore, kind: NodeKind, extra: Partial<CanvasNode> = {}, at?: Point, opts: { centre?: boolean } = {}): string | null {
  const size = { w: typeof extra.w === "number" ? extra.w : M.DEFAULT_SIZE[kind].w, h: typeof extra.h === "number" ? extra.h : M.DEFAULT_SIZE[kind].h };
  const where = at ?? freeSpot(store.doc, opts.centre ? store.center() : store.dropPoint(), size.w, size.h);
  const node = M.makeNode(kind, where, { ...(kind === "table" ? { text: M.emptyTable(3, 3) } : {}), ...extra });
  if (!store.apply((d) => M.addNode(d, node))) return null;
  store.select([node.id]); return node.id;
}
export function deleteSelection(store: CanvasStore) {
  const { selection, edge } = store.get();
  if (edge) store.apply((d) => M.removeEdges(d, [edge])); else if (selection.length) store.apply((d) => M.removeNodes(d, selection));
}
export function selectAll(store: CanvasStore) { store.select(store.doc.nodes.map((n) => n.id)); }
export function nudge(store: CanvasStore, dx: number, dy: number) { const ids = store.get().selection; if (ids.length) store.apply((d) => M.moveNodes(d, ids, dx, dy)); }
export function setColor(store: CanvasStore, color: string | null) {
  const { selection, edge } = store.get();
  if (edge) store.apply((d) => M.updateEdge(d, edge, { color: color ?? undefined }));
  else if (selection.length) store.apply((d) => selection.reduce((acc, id) => M.updateNode(acc, id, { color: color ?? undefined }), d));
}
export const zOrder = (store: CanvasStore, how: "front" | "back" | "forward" | "backward") => { const ids = store.get().selection; if (!ids.length) return; store.apply((d) => (how === "front" ? M.bringToFront(d, ids) : how === "back" ? M.sendToBack(d, ids) : M.stepZ(d, ids, how === "forward" ? 1 : -1))); };
export const align = (store: CanvasStore, how: M.Alignment) => { const ids = store.get().selection; store.apply((d) => M.alignNodes(d, ids, how)); };
export const distribute = (store: CanvasStore, axis: "horizontal" | "vertical") => { const ids = store.get().selection; store.apply((d) => M.distributeNodes(d, ids, axis)); };
/** Connects two cards (arrow by default). Returns the edge id, or null when the same connection already exists. */
export function connect(store: CanvasStore, from: string, to: string): string | null {
  if (store.doc.edges.some((e) => e.from === from && e.to === to)) return null;
  const edge: CanvasEdge = { id: M.newId(), from, to, kind: "arrow" };
  return store.apply((d) => M.addEdge(d, edge)) ? edge.id : null;
}

/* ------------------------------------------------------------------ clipboard ------------------------------------------------------------------ */
const CLIP_MARK = "spn-canvas-clip-1";
let memoryClip: M.Clip | null = null; let pasteCount = 0;
export function copySelection(store: CanvasStore): string | null {
  const ids = store.get().selection; if (!ids.length) return null;
  memoryClip = M.copyNodes(store.doc, ids); pasteCount = 0;
  return JSON.stringify({ [CLIP_MARK]: true, ...memoryClip });
}
export function readClip(text: string | null | undefined): M.Clip | null {
  if (!text || !text.includes(CLIP_MARK)) return null;
  try { const v = JSON.parse(text); return v && v[CLIP_MARK] && Array.isArray(v.nodes) ? { nodes: M.readCanvas({ nodes: v.nodes }).nodes, edges: Array.isArray(v.edges) ? v.edges : [] } : null; } catch { return null; }
}
/** Pastes a clip: next to its source the first time (offset 24), further away on each repeat; `at` centres it on a point instead. */
export function pasteClip(store: CanvasStore, clip: M.Clip | null = memoryClip, at?: Point) {
  if (!clip || !clip.nodes.length) return;
  const box = M.unionRects(clip.nodes.map(M.rectOf))!; pasteCount += 1;
  const offset = at ? { x: at.x - (box.x + box.w / 2), y: at.y - (box.y + box.h / 2) } : { x: 24 * pasteCount, y: 24 * pasteCount };
  let ids: string[] = [];
  if (store.apply((d) => { const r = M.pasteClip(d, clip, offset); ids = r.ids; return r.data; })) store.select(ids);
}
export function duplicateSelection(store: CanvasStore) {
  const ids = store.get().selection; if (!ids.length) return; let fresh: string[] = [];
  if (store.apply((d) => { const r = M.pasteClip(d, M.copyNodes(d, ids), { x: 24, y: 24 }); fresh = r.ids; return r.data; })) store.select(fresh);
}

/* ------------------------------------------------------------------ viewport, layout ------------------------------------------------------------------ */
let vpAnim = 0;
/** Moves the viewport with a short ease (instant under Reduce Motion). */
export function animateViewport(store: CanvasStore, to: M.Viewport, ms = 240) {
  cancelAnimationFrame(vpAnim);
  if (reducedMotion() || ms <= 0) { store.setViewport(to); return; }
  const from = store.viewport; const t0 = performance.now(); const ease = (t: number) => 1 - Math.pow(1 - t, 3);
  const lz0 = Math.log(from.zoom), lz1 = Math.log(to.zoom);
  // interpolate the centre of the view and the zoom (log scale), so the motion feels straight at every scale
  const c0 = { x: from.x + store.size.w / (2 * from.zoom), y: from.y + store.size.h / (2 * from.zoom) }, c1 = { x: to.x + store.size.w / (2 * to.zoom), y: to.y + store.size.h / (2 * to.zoom) };
  const tick = (now: number) => {
    const t = Math.min(1, (now - t0) / ms), k = ease(t); const zoom = Math.exp(lz0 + (lz1 - lz0) * k);
    store.setViewport(t >= 1 ? to : { ...to, zoom, x: c0.x + (c1.x - c0.x) * k - store.size.w / (2 * zoom), y: c0.y + (c1.y - c0.y) * k - store.size.h / (2 * zoom) });
    if (t < 1) vpAnim = requestAnimationFrame(tick);
  };
  vpAnim = requestAnimationFrame(tick);
}
export function zoomToFit(store: CanvasStore, selectionOnly = false) {
  const ids = selectionOnly ? store.get().selection : undefined;
  animateViewport(store, M.fitToContent(M.contentBounds(store.doc, ids && ids.length ? ids : undefined), store.size, Math.min(64, store.size.w * 0.08), 1));
}
export const zoomStep = (store: CanvasStore, factor: number) => animateViewport(store, M.zoomBy(store.viewport, factor, { x: store.size.w / 2, y: store.size.h / 2 }), 160);
export const zoomReset = (store: CanvasStore) => animateViewport(store, M.zoomTo(store.viewport, 1, { x: store.size.w / 2, y: store.size.h / 2 }), 160);
export function revealNode(store: CanvasStore, id: string) { const n = M.nodeById(store.doc, id); if (n) animateViewport(store, M.centerOn({ ...store.viewport, zoom: Math.max(store.viewport.zoom, 0.6) }, M.centerOf(M.rectOf(n)), store.size)); }

let tidyAnim = 0;
/**
 * "Tidy up": automatic layout of the selection (two cards or more) or of the whole canvas, animated over 420 ms (the cards glide to
 * their place; one undo step). `hold` suspends autosave during the animation. Deterministic: the seed is fixed.
 */
export function tidy(store: CanvasStore, hold: (on: boolean) => void = () => {}) {
  const sel = store.get().selection; const from = store.doc;
  const to = M.tidyLayout(from, { seed: 1, only: sel.length >= 2 ? new Set(sel) : undefined });
  if (to === from) { toast("Nothing to tidy"); return; }
  cancelAnimationFrame(tidyAnim);
  const done = () => { store.apply(() => to, "transient"); store.settle(); hold(false); if (sel.length < 2) zoomToFit(store); };
  if (reducedMotion()) { hold(true); done(); return; }
  hold(true); const t0 = performance.now(); const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const tick = (now: number) => { const t = Math.min(1, (now - t0) / 420); if (t >= 1) { done(); return; } store.apply(() => M.interpolateLayout(from, to, ease(t)), "transient"); tidyAnim = requestAnimationFrame(tick); };
  tidyAnim = requestAnimationFrame(tick);
}

/* ------------------------------------------------------------------ drops: files, pages, links, text ------------------------------------------------------------------ */
/** Uploads files as attachments of the canvas page and places a card for each: image, pdf, or a link card to the file for anything else. */
export async function addFiles(store: CanvasStore, pageId: string, files: File[], at?: Point): Promise<string[]> {
  const start = at ?? store.center(); const made: string[] = []; let i = 0;
  for (const file of files) {
    const p = { x: start.x + i * 32, y: start.y + i * 32 }; i++;
    try {
      const isImage = file.type.startsWith("image/"), isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
      const dim = isImage ? await imageSize(file) : null; const up = await uploadFile(file, pageId);
      let id: string | null;
      if (isImage) { const w = Math.min(360, Math.max(120, dim?.w ?? 320)); const h = dim ? Math.min(480, Math.max(60, Math.round((w * dim.h) / dim.w))) : 240; id = addCard(store, "image", { attachmentId: up.id, text: file.name, w, h }, at ? p : freeSpot(store.doc, p, w, h)); }
      else if (isPdf) id = addCard(store, "pdf", { attachmentId: up.id, text: file.name }, at ? p : freeSpot(store.doc, p, M.DEFAULT_SIZE.pdf.w, M.DEFAULT_SIZE.pdf.h));
      else id = addCard(store, "link", { url: up.url || `/api/files/${up.id}`, text: file.name }, at ? p : freeSpot(store.doc, p, M.DEFAULT_SIZE.link.w, M.DEFAULT_SIZE.link.h));
      if (id) made.push(id);
    } catch (e) { toast(`${file.name} was not added`, { description: e instanceof Error ? e.message : "Upload failed", tone: "danger" }); }
  }
  if (made.length) store.select(made);
  return made;
}
/** A page id out of a dropped or pasted address of this app (`/p/<uuid>`), else null. */
export function pageIdFromUrl(text: string): string | null {
  const m = /\/p\/([0-9a-f-]{36})(?:[/?#]|$)/i.exec(text.trim()); if (!m || !UUID.test(m[1])) return null;
  try { const u = new URL(text.trim(), location.origin); return u.origin === location.origin ? m[1].toLowerCase() : null; } catch { return null; }
}
/** Text dropped or pasted on the canvas: a page of this app → page card, an address → link card, anything else → text card. */
export function addFromText(store: CanvasStore, text: string, at?: Point, self?: string): string | null {
  const t = text.trim(); if (!t) return null;
  const first = t.split(/\s+/)[0]; const pid = pageIdFromUrl(first);
  if (pid) { if (pid === self) { toast("A canvas cannot contain itself"); return null; } return addCard(store, "page", { pageId: pid }, at); }
  if (/^https?:\/\/\S+$/i.test(t) && t.length <= 2000) return addCard(store, "link", { url: t }, at);
  return addCard(store, "text", { text: t.slice(0, 20_000) }, at);
}

/* ------------------------------------------------------------------ ink ------------------------------------------------------------------ */
/** Strokes drawn on the canvas, in world units, waiting to become a drawing card. */
export interface InkSession { strokes: InkStroke[]; /** drawing card being re-edited (replaced on commit) */ replaces: string | null }
/**
 * Turns the strokes into a `drawing` card: the card is the bounding box of the ink (plus a margin), the strokes are stored relative
 * to it as an `spn-ink-1` attachment (`ink`), simplified like the drawing block of the editor does. Returns the card id.
 */
export async function commitInk(store: CanvasStore, pageId: string, session: InkSession): Promise<string | null> {
  const strokes = session.strokes.filter((s) => s.points.length); if (!strokes.length) { if (session.replaces) store.apply((d) => M.removeNodes(d, [session.replaces!])); return null; }
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of strokes) for (const p of s.points) { const h = s.width; if (p[0] - h < x0) x0 = p[0] - h; if (p[1] - h < y0) y0 = p[1] - h; if (p[0] + h > x1) x1 = p[0] + h; if (p[1] + h > y1) y1 = p[1] + h; }
  const pad = 8; x0 = Math.floor(x0 - pad); y0 = Math.floor(y0 - pad); const w = Math.max(M.MIN_NODE_SIZE, Math.ceil(x1 + pad - x0)), h = Math.max(M.MIN_NODE_SIZE, Math.ceil(y1 + pad - y0));
  const doc: InkDoc = { format: "spn-ink-1", width: w, height: h, strokes: strokes.map((s) => ({ ...s, points: simplifyStroke(s.points, 0.3).map((p) => [p[0] - x0, p[1] - y0, p[2]] as InkStroke["points"][number]) })) };
  const up = await uploadBlob(serializeInk(doc), `canvas-ink-${Date.now()}.ink.json`, "application/json", pageId);
  putInk(up.id, doc);
  if (session.replaces && M.nodeById(store.doc, session.replaces)) { const id = session.replaces; store.apply((d) => M.updateNode(d, id, { ink: up.id, x: x0, y: y0, w, h })); store.select([id]); return id; }
  return addCard(store, "drawing", { ink: up.id, w, h }, { x: x0 + w / 2, y: y0 + h / 2 });
}
/** The strokes of a drawing card back in world units (to continue the drawing). */
export async function inkOfCard(node: CanvasNode): Promise<InkStroke[]> {
  if (typeof node.ink !== "string") return [];
  const doc = peekInk(node.ink) ?? (await loadInk(node.ink)); const sx = doc.width > 0 ? node.w / doc.width : 1, sy = doc.height > 0 ? node.h / doc.height : 1;
  return doc.strokes.map((s) => ({ ...s, width: s.width * Math.min(sx, sy), points: s.points.map((p) => [node.x + p[0] * sx, node.y + p[1] * sy, p[2]] as InkStroke["points"][number]) }));
}

/* ------------------------------------------------------------------ exports ------------------------------------------------------------------ */
function download(name: string, blob: Blob) { const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000); }
const fileBase = (title: string) => (title.trim() || "canvas").replace(/[\\/:*?"<>|\n\r]+/g, " ").trim().slice(0, 80) || "canvas";
export type TitleMap = ReadonlyMap<string, string>;
/** A standalone SVG of the canvas (images, PDF thumbnails and ink embedded). */
export async function buildSvg(doc: CanvasData, titles: TitleMap, dark = false): Promise<string> {
  const images = new Map<string, string>(); const inks = new Map<string, InkDoc>();
  await Promise.all(doc.nodes.map(async (n) => {
    try {
      if (n.kind === "image" && typeof n.attachmentId === "string") { const u = await attachmentDataUrl(n.attachmentId); if (u) images.set(n.attachmentId, u); }
      else if (n.kind === "pdf" && typeof n.attachmentId === "string") { const t = peekPdfThumb(n.attachmentId) ?? (await loadPdfThumb(n.attachmentId)); images.set(n.attachmentId, t.url); }
      else if (n.kind === "drawing" && typeof n.ink === "string") inks.set(n.ink, peekInk(n.ink) ?? (await loadInk(n.ink)));
    } catch { /* drawn as a placeholder */ }
  }));
  return M.canvasToSvg(doc, { theme: dark ? M.SVG_DARK : M.SVG_LIGHT, titles: (id) => titles.get(id), images, inks });
}
export async function exportSvg(doc: CanvasData, title: string, titles: TitleMap) { download(`${fileBase(title)}.svg`, new Blob([await buildSvg(doc, titles)], { type: "image/svg+xml" })); }
/** PNG at 2× (less for a very large canvas: the bitmap stays under 16 megapixels). */
export async function svgToPng(svg: string): Promise<Blob> {
  const m = /viewBox="([-\d.]+) ([-\d.]+) ([\d.]+) ([\d.]+)"/.exec(svg); const w = m ? Number(m[3]) : 800, h = m ? Number(m[4]) : 600;
  const scale = Math.min(2, Math.sqrt(16_000_000 / Math.max(1, w * h)));
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("The drawing could not be rendered")); i.src = url; });
    const c = document.createElement("canvas"); c.width = Math.max(1, Math.round(w * scale)); c.height = Math.max(1, Math.round(h * scale));
    const ctx = c.getContext("2d"); if (!ctx) throw new Error("No 2D context"); ctx.drawImage(img, 0, 0, c.width, c.height);
    return await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("The image could not be encoded"))), "image/png"));
  } finally { URL.revokeObjectURL(url); }
}
export async function exportPng(doc: CanvasData, title: string, titles: TitleMap) { download(`${fileBase(title)}.png`, await svgToPng(await buildSvg(doc, titles))); }
export function exportMarkdown(doc: CanvasData, title: string, titles: TitleMap) { download(`${fileBase(title)}.md`, new Blob([M.canvasToMarkdown(doc, title, (id) => titles.get(id))], { type: "text/markdown" })); }
