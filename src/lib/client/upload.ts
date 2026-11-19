"use client";
/**
 * file: src/lib/client/upload.ts
 * description: attachment upload with real progress and cancellation, shared by the editor, its node views (diagram renders, ink,
 *   recordings, PDFs) and the capture outbox. Moved out of Editor.tsx in 3.0 (still re-exported from there).
 * author: Simon-Pierre Boucher — contact@spboucher.ai
 */
import { queueImageUpload } from "./journal";
export interface Uploaded { id: string; url: string; name: string; size: number; mime: string }
/** Upload with real progress and cancellation (XMLHttpRequest: fetch has no upload progress). Rejects with a readable message. */
export function uploadFile(file: File, pageId?: string | null, opts: { onProgress?: (fraction: number) => void; signal?: AbortSignal; /** offline-first (3.0): keep an IMAGE on the device when the server cannot be reached (10 MB per image, 100 MB queued) and upload it later under the same id */ queueOffline?: boolean } = {}): Promise<Uploaded> {
  if (opts.queueOffline && file.type.startsWith("image/")) {
    if (typeof navigator !== "undefined" && !navigator.onLine) return queueImageUpload(file, pageId);
    return sendFile(file, pageId, opts).catch((e) => { if (e instanceof Error && e.message === NETWORK_LOST) return queueImageUpload(file, pageId); throw e; });
  }
  return sendFile(file, pageId, opts);
}
const NETWORK_LOST = "Network lost during upload";
function sendFile(file: File, pageId?: string | null, opts: { onProgress?: (fraction: number) => void; signal?: AbortSignal } = {}): Promise<Uploaded> {
  return new Promise((resolve, reject) => {
    const fd = new FormData(); fd.append("file", file); if (pageId) fd.append("pageId", pageId);
    const x = new XMLHttpRequest(); x.open("POST", "/api/attachments"); x.responseType = "json"; x.withCredentials = true;
    x.upload.onprogress = (e) => { if (e.lengthComputable) opts.onProgress?.(e.loaded / e.total); };
    x.onload = () => { if (x.status === 401) { window.location.assign("/login"); return reject(new Error("Sign-in required")); } if (x.status >= 200 && x.status < 300 && x.response) resolve(x.response as Uploaded); else reject(new Error(x.response?.error ?? (x.status === 413 ? "File too large (200 MB max)" : `Upload failed (${x.status})`))); };
    x.onerror = () => reject(new Error(NETWORK_LOST)); x.onabort = () => reject(new DOMException("Upload cancelled", "AbortError"));
    opts.signal?.addEventListener("abort", () => x.abort());
    x.send(fd);
  });
}
/** Upload in-memory data (a render, an ink file, a recording) as an attachment of the page. */
export const uploadBlob = (data: Blob | string, name: string, mime: string, pageId?: string | null, signal?: AbortSignal) => uploadFile(new File([data], name, { type: mime }), pageId, { signal });
export const fileUrl = (attachmentId: string) => `/api/files/${attachmentId}`;
