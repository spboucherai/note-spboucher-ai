"use client";
/**
 * file: src/components/canvas/resources.ts
 * description: binary resources of canvas cards, loaded on demand and cached for the session — `spn-ink-1` strokes of drawing cards,
 *   first-page thumbnails of PDF cards (pdf.js, the same same-origin worker as the PDF block of the editor), data: URLs of images for
 *   the SVG / PNG export. Nothing is fetched until a card that needs it is on screen.
 * author: Simon-Pierre Boucher — contact@spboucher.ai
 */
import { parseInk, type InkDoc } from "@/lib/editor/ink";
import { fileUrl } from "@/lib/client/upload";

const inks = new Map<string, InkDoc>(); const inkLoads = new Map<string, Promise<InkDoc>>();
export const peekInk = (id: string) => inks.get(id);
/** Registers strokes that were just uploaded (no round trip to read them back). */
export const putInk = (id: string, doc: InkDoc) => { inks.set(id, doc); };
export function loadInk(id: string): Promise<InkDoc> {
  const hit = inks.get(id); if (hit) return Promise.resolve(hit);
  let p = inkLoads.get(id);
  if (!p) { p = fetch(fileUrl(id), { credentials: "same-origin" }).then(async (r) => { if (!r.ok) throw new Error(`Ink file unavailable (${r.status})`); const d = parseInk(await r.text()); inks.set(id, d); return d; }).finally(() => inkLoads.delete(id)); inkLoads.set(id, p); }
  return p;
}

/** Same-origin copy of pdf.js' worker (scripts/copy-vendor.mjs) — see src/components/editor/nodes/PdfView.tsx. */
const PDFJS_ASSETS = "/vendor/pdfjs";
type PdfJs = typeof import("pdfjs-dist");
let pdfjs: Promise<PdfJs> | null = null;
const loadPdfJs = () => (pdfjs ??= import("pdfjs-dist").then((lib) => { if (!lib.GlobalWorkerOptions.workerSrc) lib.GlobalWorkerOptions.workerSrc = `${PDFJS_ASSETS}/pdf.worker.min.mjs`; return lib; }).catch((e) => { pdfjs = null; throw e; }));
const thumbs = new Map<string, { url: string; pages: number; ratio: number }>(); const thumbLoads = new Map<string, Promise<{ url: string; pages: number; ratio: number }>>();
export const peekPdfThumb = (id: string) => thumbs.get(id);
/** First page of a PDF attachment rendered to a PNG data: URL (longest side ≈ 480 px), with the page count and the page's width / height. */
export function loadPdfThumb(attachmentId: string): Promise<{ url: string; pages: number; ratio: number }> {
  const hit = thumbs.get(attachmentId); if (hit) return Promise.resolve(hit);
  let p = thumbLoads.get(attachmentId);
  if (!p) {
    p = (async () => {
      const lib = await loadPdfJs();
      const task = lib.getDocument({ url: fileUrl(attachmentId), withCredentials: true, enableXfa: false, cMapUrl: `${PDFJS_ASSETS}/cmaps/`, cMapPacked: true, standardFontDataUrl: `${PDFJS_ASSETS}/standard_fonts/` });
      const doc = await task.promise;
      try {
        const page = await doc.getPage(1); const v1 = page.getViewport({ scale: 1 }); const scale = Math.min(2, 480 / Math.max(v1.width, v1.height)); const vp = page.getViewport({ scale });
        const c = document.createElement("canvas"); c.width = Math.max(1, Math.round(vp.width)); c.height = Math.max(1, Math.round(vp.height));
        const ctx = c.getContext("2d"); if (!ctx) throw new Error("No 2D context"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
        await page.render({ canvasContext: ctx, viewport: vp, canvas: c } as Parameters<typeof page.render>[0]).promise;
        const out = { url: c.toDataURL("image/png"), pages: doc.numPages, ratio: v1.width / v1.height }; thumbs.set(attachmentId, out); return out;
      } finally { void task.destroy(); }
    })().finally(() => thumbLoads.delete(attachmentId));
    thumbLoads.set(attachmentId, p);
  }
  return p;
}

/** An attachment as a data: URL (for the SVG / PNG export, which must be self-contained). Null when it cannot be read or is larger than 12 MB. */
export async function attachmentDataUrl(attachmentId: string): Promise<string | null> {
  try {
    const r = await fetch(fileUrl(attachmentId), { credentials: "same-origin" }); if (!r.ok) return null;
    const b = await r.blob(); if (b.size > 12 * 1024 * 1024 || !b.type.startsWith("image/")) return null;
    return await new Promise<string | null>((res) => { const fr = new FileReader(); fr.onload = () => res(typeof fr.result === "string" ? fr.result : null); fr.onerror = () => res(null); fr.readAsDataURL(b); });
  } catch { return null; }
}
/** Natural size of an image file (to give a dropped picture its proportions). */
export function imageSize(file: Blob): Promise<{ w: number; h: number } | null> {
  return new Promise((res) => { const url = URL.createObjectURL(file); const img = new Image(); img.onload = () => { URL.revokeObjectURL(url); res(img.naturalWidth > 0 ? { w: img.naturalWidth, h: img.naturalHeight } : null); }; img.onerror = () => { URL.revokeObjectURL(url); res(null); }; img.src = url; });
}
