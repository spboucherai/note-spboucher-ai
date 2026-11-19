/**
 * file: src/lib/research/pdf-extracts.ts
 * description: link between the annotations of a `pdf` block and the extracts of a research reference. When the PDF shown by the block
 *   is the file attached to a reference (`references.attachment_id`), each highlight / note is also that reference's extract (quote =
 *   the highlighted text, page, note). The extract id is DERIVED from (attachment id, annotation id), so saving the same annotation
 *   again — a retry, another device, a re-opened page — addresses the same extract and can never create a second one. Pure functions:
 *   the calls themselves (`POST|PATCH|DELETE /api/research/references/<id>/extracts`) are made by the PDF block.
 * author: Simon-Pierre Boucher — contact@spboucher.ai
 */
import { EXTRACT_LIMITS, type Extract } from "./cite";

export interface AnnotationLike { id: string; page?: number; kind?: string; text?: string; note?: string }
export interface ExtractBody { quote: string; page: string | null; note: string | null }

/** cyrb128: 128 bits of a string, synchronous and dependency-free. An identifier, not a secret. */
function hash128(s: string): [number, number, number, number] {
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
  for (let i = 0; i < s.length; i++) { const k = s.charCodeAt(i); h1 = h2 ^ Math.imul(h1 ^ k, 597399067); h2 = h3 ^ Math.imul(h2 ^ k, 2869860233); h3 = h4 ^ Math.imul(h3 ^ k, 951274213); h4 = h1 ^ Math.imul(h4 ^ k, 2716044179); }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067); h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233); h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213); h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4; h2 ^= h1; h3 ^= h1; h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}
/** Deterministic extract id (RFC 4122 layout, version 4 / variant 1 bits so every validator accepts it) of an annotation of a given file. */
export function extractIdFor(attachmentId: string, annotationId: string): string {
  const hex = hash128(`spn-pdf-extract:${attachmentId.toLowerCase()}:${annotationId}`).map((n) => n.toString(16).padStart(8, "0")).join("");
  const v = `${hex.slice(0, 12)}4${hex.slice(13, 16)}${"89ab"[parseInt(hex[16], 16) & 3]}${hex.slice(17)}`;
  return `${v.slice(0, 8)}-${v.slice(8, 12)}-${v.slice(12, 16)}-${v.slice(16, 20)}-${v.slice(20, 32)}`;
}
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s);
/** What an annotation is as an extract; `null` when it cannot be one (ink strokes, or neither text nor note). A note without highlighted text is quoted as the note itself. */
export function extractOfAnnotation(a: AnnotationLike): ExtractBody | null {
  if (!a || typeof a.id !== "string" || a.kind === "ink") return null;
  const text = typeof a.text === "string" ? a.text.trim() : "", note = typeof a.note === "string" ? a.note.trim() : "";
  if (!text && !note) return null;
  const page = Number.isFinite(a.page) && (a.page as number) > 0 ? String(Math.round(a.page as number)) : null;
  return text ? { quote: clip(text, EXTRACT_LIMITS.quote), page, note: note ? clip(note, EXTRACT_LIMITS.note) : null } : { quote: clip(note, EXTRACT_LIMITS.quote), page, note: null };
}
const same = (e: Pick<Extract, "quote" | "page" | "note">, b: ExtractBody) => e.quote === b.quote && (e.page ?? null) === b.page && (e.note ?? null) === b.note;
export interface ExtractPlan {
  /** annotations with no extract yet → POST {id, …} (idempotent on the id) */ create: { id: string; annotationId: string; body: ExtractBody }[];
  /** extract exists but its quote / page / note differs → PATCH */ update: { id: string; annotationId: string; body: ExtractBody }[];
  /** annotation ids whose extract exists and is identical */ linked: string[];
}
/** Compares the annotations of a block with the extracts of the reference its PDF belongs to. Never plans a deletion (see `removedExtractIds`). */
export function planExtractSync(attachmentId: string, annotations: readonly AnnotationLike[], extracts: readonly Extract[]): ExtractPlan {
  const byId = new Map(extracts.map((e) => [e.id, e])); const plan: ExtractPlan = { create: [], update: [], linked: [] }; const seen = new Set<string>();
  for (const a of annotations) {
    const body = extractOfAnnotation(a); if (!body || seen.has(a.id)) continue; seen.add(a.id);
    const id = extractIdFor(attachmentId, a.id), cur = byId.get(id);
    if (!cur) plan.create.push({ id, annotationId: a.id, body }); else if (!same(cur, body)) plan.update.push({ id, annotationId: a.id, body }); else plan.linked.push(a.id);
  }
  return plan;
}
/** Extract ids to delete when the user removes annotations: those present before, absent now (an undo that brings one back re-creates it). */
export function removedExtractIds(attachmentId: string, before: readonly AnnotationLike[], after: readonly AnnotationLike[]): string[] {
  const still = new Set(after.map((a) => a.id)); return before.filter((a) => !still.has(a.id) && extractOfAnnotation(a)).map((a) => extractIdFor(attachmentId, a.id));
}
/** Annotation id → is it one of the reference's extracts (whatever its current content). */
export function linkedAnnotationIds(attachmentId: string, annotations: readonly AnnotationLike[], extracts: readonly Extract[]): Set<string> {
  const ids = new Set(extracts.map((e) => e.id)); return new Set(annotations.filter((a) => ids.has(extractIdFor(attachmentId, a.id))).map((a) => a.id));
}
