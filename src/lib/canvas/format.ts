/**
 * File: src/lib/canvas/format.ts
 * Description: the canvas document `spn-canvas-1` (SPEC §3.4): shape, empty value, structural validation and limits. Pure (shared by
 *   the server, the web client and mirrored by SPNotesCore). Unknown node kinds and unknown fields are kept untouched.
 * Author: Simon-Pierre Boucher · contact@spboucher.ai
 */
export const CANVAS_FORMAT = "spn-canvas-1";
export const CANVAS_NODE_KINDS = ["text", "page", "image", "pdf", "link", "drawing", "shape", "reference", "math", "table"] as const;
export interface CanvasNode { id: string; kind: string; x: number; y: number; w: number; h: number; z?: number; text?: string; pageId?: string; attachmentId?: string; url?: string; refId?: string; latex?: string; color?: string; shape?: string; ink?: string; [k: string]: unknown }
export interface CanvasEdge { id: string; from: string; to: string; label?: string; kind?: string; color?: string; [k: string]: unknown }
export interface CanvasData { format: typeof CANVAS_FORMAT; nodes: CanvasNode[]; edges: CanvasEdge[]; viewport: { x: number; y: number; zoom: number }; [k: string]: unknown }
export const EMPTY_CANVAS = (): CanvasData => ({ format: CANVAS_FORMAT, nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } });
export const CANVAS_LIMITS = { nodes: 5_000, edges: 10_000, bytes: 4 * 1024 * 1024, textChars: 100_000, idChars: 64 } as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const num = (v: unknown) => typeof v === "number" && Number.isFinite(v);
const idOk = (v: unknown) => typeof v === "string" && v.length >= 1 && v.length <= CANVAS_LIMITS.idChars;
/** Returns a human message when `data` is not a valid spn-canvas-1 document, else null. */
export function canvasProblem(data: unknown): string | null {
  const d = data as CanvasData | null;
  if (!d || typeof d !== "object" || d.format !== CANVAS_FORMAT) return `data.format must be "${CANVAS_FORMAT}"`;
  if (!Array.isArray(d.nodes) || !Array.isArray(d.edges)) return "data.nodes and data.edges must be arrays";
  if (d.nodes.length > CANVAS_LIMITS.nodes) return `a canvas holds at most ${CANVAS_LIMITS.nodes} nodes`;
  if (d.edges.length > CANVAS_LIMITS.edges) return `a canvas holds at most ${CANVAS_LIMITS.edges} edges`;
  const v = d.viewport; if (!v || typeof v !== "object" || !num(v.x) || !num(v.y) || !num(v.zoom) || v.zoom <= 0) return "data.viewport must be {x, y, zoom > 0}";
  const ids = new Set<string>();
  for (const n of d.nodes) {
    if (!n || typeof n !== "object" || !idOk(n.id)) return "every node needs a string id (1–64 characters)";
    if (ids.has(n.id)) return `duplicate node id ${n.id}`; ids.add(n.id);
    if (typeof n.kind !== "string" || !n.kind || n.kind.length > 32) return `node ${n.id}: kind must be a short string`;
    if (!num(n.x) || !num(n.y) || !num(n.w) || !num(n.h) || n.w < 0 || n.h < 0) return `node ${n.id}: x, y, w, h must be finite numbers (w, h ≥ 0)`;
    if (n.z !== undefined && !num(n.z)) return `node ${n.id}: z must be a number`;
    for (const k of ["pageId", "attachmentId", "refId", "ink"] as const) if (n[k] !== undefined && n[k] !== null && !(typeof n[k] === "string" && UUID.test(n[k] as string))) return `node ${n.id}: ${k} must be a uuid`;
    for (const k of ["text", "latex"] as const) if (n[k] !== undefined && n[k] !== null && !(typeof n[k] === "string" && (n[k] as string).length <= CANVAS_LIMITS.textChars)) return `node ${n.id}: ${k} must be a string of at most ${CANVAS_LIMITS.textChars} characters`;
    if (n.url !== undefined && n.url !== null && !(typeof n.url === "string" && n.url.length <= 2000 && !/^\s*(javascript|vbscript|data:text\/html)/i.test(n.url))) return `node ${n.id}: unsafe or oversized url`;
  }
  const eids = new Set<string>();
  for (const e of d.edges) {
    if (!e || typeof e !== "object" || !idOk(e.id)) return "every edge needs a string id (1–64 characters)";
    if (eids.has(e.id)) return `duplicate edge id ${e.id}`; eids.add(e.id);
    if (!ids.has(e.from as string) || !ids.has(e.to as string)) return `edge ${e.id}: from and to must be ids of nodes of this canvas`;
    if (e.label !== undefined && e.label !== null && !(typeof e.label === "string" && e.label.length <= 500)) return `edge ${e.id}: label must be a string of at most 500 characters`;
  }
  if (JSON.stringify(d).length > CANVAS_LIMITS.bytes) return "the canvas is too large (4 MB max)";
  return null;
}
/** Pages and references a canvas points to (cards of kind page / reference): used for the graph and the time machine. */
export function canvasRefs(d: CanvasData): { pages: string[]; references: string[]; attachments: string[] } {
  const pick = (k: "pageId" | "refId" | "attachmentId" | "ink") => [...new Set(d.nodes.map((n) => n[k]).filter((x): x is string => typeof x === "string" && UUID.test(x)).map((x) => x.toLowerCase()))];
  return { pages: pick("pageId"), references: pick("refId"), attachments: [...new Set([...pick("attachmentId"), ...pick("ink")])] };
}
