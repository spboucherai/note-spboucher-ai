/**
 * file: src/lib/client/capture-logic.ts
 * description: pure rules of quick capture (SPEC §4.12) — which capture kind a text, a set of files, a paste, a drop or a share
 *   becomes; what a shared `?title=&text=&url=` turns into; the size limits and their messages; the kind filters of the inbox.
 *   No DOM, no React, no network: unit-tested in tests/unit/next-p-cv-capture.test.ts.
 * author: Simon-Pierre Boucher — contact@spboucher.ai
 */

/** Kinds `POST /api/capture` accepts (`idea` is stored as a note with the 💡 icon). */
export type ServerKind = "note" | "idea" | "tasks" | "link" | "photo" | "file" | "audio" | "screenshot" | "selection" | "document";
/** The four choices of the capture sheet; everything else is deduced from what was attached, pasted or dropped. */
export type Mode = "note" | "idea" | "tasks" | "link";
/** Where the content of the sheet came from, when it was not typed. */
export type Origin = "selection" | "screenshot" | "share" | "drop" | null;
export interface FileLike { name: string; type: string; size: number }
export interface CapturePrefill { mode?: Mode; text?: string; files?: File[]; origin?: Origin; /** source of a selection: `/p/<id>#block-<id>` or an http(s) address */ sourceUrl?: string; /** shown to the user next to "Selected text" */ sourceTitle?: string }

export const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;
/** Limit of the transcription engine (the API answers 413 `too_large` above it). */
export const MAX_TRANSCRIBE_BYTES = 25 * 1024 * 1024;

export const isUrl = (s: string) => /^(https?:\/\/|www\.)\S+$/i.test(s.trim());
/** First http(s) address of a text, or null. */
export const firstUrl = (s: string): string | null => s.match(/https?:\/\/[^\s<>"']+/i)?.[0]?.replace(/[),.;!?]+$/, "") ?? null;
const ext = (name: string) => (name.match(/\.([a-z0-9]{1,8})$/i)?.[1] ?? "").toLowerCase();
export const isImage = (f: FileLike) => f.type.startsWith("image/") || ["png", "jpg", "jpeg", "gif", "webp", "heic", "heif", "avif"].includes(ext(f.name)) && !f.type;
export const isAudio = (f: FileLike) => f.type.startsWith("audio/") || (!f.type && ["m4a", "mp3", "wav", "ogg", "oga", "opus", "webm", "aac", "flac", "aiff", "aif", "caf"].includes(ext(f.name)));
export const isPdf = (f: FileLike) => f.type === "application/pdf" || ext(f.name) === "pdf";
const DOC_EXT = new Set(["pdf", "doc", "docx", "odt", "rtf", "txt", "md", "markdown", "tex", "ppt", "pptx", "odp", "key", "pages", "xls", "xlsx", "ods", "numbers", "csv", "epub"]);
/** A document in the everyday sense: PDF, text, word processor, slides, spreadsheet, e-book. */
export const isDocument = (f: FileLike) => isPdf(f) || f.type.startsWith("text/") || /(msword|officedocument|opendocument|rtf|epub|ms-excel|ms-powerpoint|iwork)/.test(f.type) || DOC_EXT.has(ext(f.name));

/** Kind of a capture made only of files (no text): all images → photo/screenshot, all audio → audio, all documents → document, else file. */
export function kindOfFiles(files: FileLike[], origin: Origin = null): ServerKind {
  if (!files.length) return "note";
  if (files.every(isImage)) return origin === "screenshot" ? "screenshot" : "photo";
  if (files.every(isAudio)) return "audio";
  if (files.every(isDocument)) return "document";
  return "file";
}
/**
 * The kind sent to the server. A selection stays a selection whatever was added; files without text decide alone; text decides with
 * the chosen mode (a "link" whose first line is not an address is a note); files WITH text keep their own kind when they are all of one
 * family (so a described screenshot stays a screenshot, a commented voice memo a voice note) unless the user chose a to-do or a link.
 */
export function captureKind(input: { mode: Mode; text: string; files: FileLike[]; origin?: Origin }): ServerKind {
  const t = input.text.trim(); const origin = input.origin ?? null;
  if (origin === "selection" && t) return "selection";
  const byText: ServerKind = input.mode === "link" && !isUrl(t.split("\n")[0] ?? "") ? "note" : input.mode;
  if (!input.files.length) return byText;
  const byFiles = kindOfFiles(input.files, origin);
  if (!t) return byFiles;
  return byText === "tasks" || byText === "link" || byText === "idea" ? byText : byFiles;
}

export interface PasteData { text: string; files: FileLike[] }
export type PasteVerdict = { as: "link"; url: string } | { as: "screenshot" } | { as: "document" } | { as: "audio" } | { as: "file" } | { as: "text" } | { as: "nothing" };
/** Smart paste: an image is a screenshot, another file a document (or a voice memo, or a plain file), a lone address a link, the rest text. */
export function classifyPaste(d: PasteData): PasteVerdict {
  if (d.files.length) return d.files.every(isImage) ? { as: "screenshot" } : d.files.every(isAudio) ? { as: "audio" } : d.files.every(isDocument) ? { as: "document" } : { as: "file" };
  const t = d.text.trim(); if (!t) return { as: "nothing" };
  if (isUrl(t)) return { as: "link", url: /^www\./i.test(t) ? `https://${t}` : t };
  return { as: "text" };
}
/** A drop: files win; else the dragged address (`text/uri-list`, first non-comment line), else the dragged text. */
export function prefillFromDrop(d: { files: File[]; uriList?: string; text?: string }): CapturePrefill | null {
  if (d.files.length) return { files: d.files, origin: "drop" };
  const uri = (d.uriList ?? "").split(/\r?\n/).map((l) => l.trim()).find((l) => l && !l.startsWith("#")) ?? ""; const text = (d.text ?? "").trim();
  if (uri && isUrl(uri)) return { mode: "link", text: text && text !== uri ? `${uri}\n${text}` : uri, origin: "drop" };
  if (text) return isUrl(text) ? { mode: "link", text, origin: "drop" } : { mode: "note", text, origin: "drop" };
  return null;
}
/**
 * Web Share Target (`/share?title=&text=&url=`). Android often puts the address in `text`; when an address is found the capture is a
 * link whose first line is the address (the server reads it there), followed by the title and the remaining text. Otherwise a note.
 */
export function prefillFromShare(q: { title?: string | null; text?: string | null; url?: string | null }): CapturePrefill | null {
  const title = (q.title ?? "").trim().slice(0, 300); let text = (q.text ?? "").trim().slice(0, 20_000); let url = (q.url ?? "").trim();
  if (!isUrl(url)) url = "";
  if (!url) { const found = firstUrl(text); if (found) { url = found; text = text.replace(found, "").trim(); } }
  const rest = [title, text].filter((x, i, a) => x && a.indexOf(x) === i);
  if (url) return { mode: "link", text: [url, ...rest].join("\n"), origin: "share" };
  if (!rest.length) return null;
  return { mode: "note", text: rest.join("\n"), origin: "share" };
}

export const formatBytes = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
/** Splits a pick/paste/drop into what can be attached and why the rest cannot. */
export function acceptFiles<T extends FileLike>(files: T[]): { ok: T[]; rejected: { name: string; reason: string }[]; notes: string[] } {
  const ok: T[] = []; const rejected: { name: string; reason: string }[] = []; const notes: string[] = [];
  for (const f of files) {
    if (f.size > MAX_UPLOAD_BYTES) { rejected.push({ name: f.name, reason: `${f.name} is over 200 MB.` }); continue; }
    if (f.size === 0) { rejected.push({ name: f.name, reason: `${f.name} is empty.` }); continue; }
    ok.push(f);
    if (isAudio(f) && f.size > MAX_TRANSCRIBE_BYTES) notes.push(`${f.name} (${formatBytes(f.size)}) is kept, but it is over the 25 MB a transcription accepts.`);
  }
  return { ok, rejected, notes };
}
/** Name given to an image pasted from the clipboard (browsers call them all "image.png"). */
export const screenshotName = (type: string, at = new Date()) => { const p = (n: number) => String(n).padStart(2, "0"); return `screenshot-${at.getFullYear()}${p(at.getMonth() + 1)}${p(at.getDate())}-${p(at.getHours())}${p(at.getMinutes())}${p(at.getSeconds())}.${type === "image/jpeg" ? "jpg" : type === "image/webp" ? "webp" : type === "image/gif" ? "gif" : "png"}`; };

/* ------------------------------------------------------------------ inbox filters ------------------------------------------------------------------ */
export type InboxFilter = "all" | "note" | "idea" | "tasks" | "link" | "image" | "document" | "audio" | "selection";
export const INBOX_FILTERS: { id: InboxFilter; label: string }[] = [
  { id: "all", label: "All" }, { id: "note", label: "Notes" }, { id: "idea", label: "Ideas" }, { id: "tasks", label: "To-dos" }, { id: "link", label: "Links" },
  { id: "image", label: "Images" }, { id: "document", label: "Files" }, { id: "audio", label: "Audio" }, { id: "selection", label: "Selections" },
];
/** Filter an inbox item belongs to. Ideas are notes captured with the 💡 icon; photos and screenshots are images; files and documents are files. */
export function filterOf(item: { kind: string | null; icon?: string | null }): Exclude<InboxFilter, "all"> {
  switch (item.kind) {
    case "tasks": return "tasks"; case "link": return "link"; case "photo": case "screenshot": return "image"; case "file": case "document": return "document";
    case "audio": return "audio"; case "selection": return "selection"; default: return item.icon === "💡" ? "idea" : "note";
  }
}
export function filterCounts(items: { kind: string | null; icon?: string | null }[]): Record<InboxFilter, number> {
  const c = Object.fromEntries(INBOX_FILTERS.map((f) => [f.id, 0])) as Record<InboxFilter, number>; c.all = items.length;
  for (const it of items) c[filterOf(it)] += 1;
  return c;
}
