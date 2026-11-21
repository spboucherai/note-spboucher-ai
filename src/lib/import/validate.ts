/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/lib/import/validate.ts
 * Module           : lib
 * Repository       : https://git.spboucher.ai/note-spboucher-ai
 * Project Website  : https://note.spboucher.ai
 * Created          : 2026-11-17
 * Last Modified    : 2026-11-19
 *
 * Author           : Simon-Pierre Boucher
 * Position         : Professor of Finance
 * Institution      : Université du Québec en Outaouais (UQO)
 * Organization     : SP Boucher
 * Website          : https://spboucher.ai
 * Git              : https://git.spboucher.ai
 *
 * Preferred Contact: contact@spboucher.ai
 * Development      : dev@spboucher.ai
 * Support          : support@spboucher.ai
 * Security/Admin   : admin@spboucher.ai
 *
 * Copyright (c) 2026
 * Simon-Pierre Boucher
 * All rights reserved where applicable. This file is governed by the
 * applicable project license, copyright notices and relevant law.
 * Existing third-party rights and notices remain unaffected.
 *
 * License          : None specified (no license file in this repository)
 *
 * Do not embed credentials, private keys, access tokens,
 * certificates or confidential personal information.
 *
 * =============================================================================
 * END OF SP BOUCHER SOURCE HEADER
 * =============================================================================
 */

/**
 * Server-side validation of uploads handed to the importers. Pure (Buffer in, facts out — no database, no filesystem), so it is unit-tested
 * in tests/unit/import-validate.test.ts and reused by the route, the preview and the worker.
 *
 *  - size limits per kind;
 *  - type sniffing by magic bytes (the extension and the browser MIME are hints, never proof);
 *  - ZIP: the central directory is read here, BEFORE any decompression: entry cap, declared uncompressed size cap (zip bomb), compression
 *    ratio cap, zip-slip safe names (no `..`, no absolute path, no drive letter, no NUL), no encryption, no ZIP64.
 */
import { createHash } from "node:crypto";

export class ImportError extends Error { constructor(message: string, public status = 400, public code = "import_invalid") { super(message); } }
/** Thrown inside a run when the job was cancelled or taken over by a newer run: stop quietly, keep what exists. */
export class ImportAborted extends Error { constructor(message = "Import stopped") { super(message); } }

export type ImportKind = "markdown" | "zip" | "docx" | "pdf" | "csv" | "bibtex" | "json";
export const KINDS: ImportKind[] = ["markdown", "zip", "docx", "pdf", "csv", "bibtex", "json"];
export const ACCEPT = ".md,.markdown,.txt,.zip,.docx,.pdf,.csv,.bib,.json";

const MB = 1024 * 1024;
export const LIMITS = {
  /** hard cap of POST /api/import */
  upload: 500 * MB,
  perKind: { markdown: 20 * MB, csv: 100 * MB, bibtex: 20 * MB, docx: 100 * MB, pdf: 200 * MB, json: 500 * MB, zip: 500 * MB } as Record<ImportKind, number>,
  zipEntries: 20_000,
  /** sum of the declared uncompressed sizes */
  zipUncompressed: 2048 * MB,
  /** one entry, uncompressed */
  zipEntry: 250 * MB,
  /** uncompressed / compressed, enforced once the archive expands beyond `zipRatioFloor` */
  zipRatio: 150, zipRatioFloor: 50 * MB,
  zipPath: 1024,
} as const;
export const fmtSize = (n: number) => (n < 1024 ? `${n} B` : n < MB ? `${(n / 1024).toFixed(0)} KB` : n < 1024 * MB ? `${(n / MB).toFixed(n < 10 * MB ? 1 : 0)} MB` : `${(n / (1024 * MB)).toFixed(2)} GB`);

export function detectKind(filename: string, mime = ""): ImportKind {
  const ext = filename.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";
  if (ext === "md" || ext === "markdown" || ext === "txt" || mime === "text/markdown") return "markdown";
  if (ext === "zip" || mime === "application/zip" || mime === "application/x-zip-compressed") return "zip";
  if (ext === "docx" || mime.includes("wordprocessingml")) return "docx";
  if (ext === "pdf" || mime === "application/pdf") return "pdf";
  if (ext === "csv" || mime === "text/csv") return "csv";
  if (ext === "bib" || ext === "bibtex" || mime === "application/x-bibtex") return "bibtex";
  if (ext === "json" || mime === "application/json") return "json";
  throw new ImportError(`Unsupported file type: .${ext || "?"} — accepted: ${ACCEPT}`, 415, "unsupported_type");
}

export type Sniffed = "zip" | "pdf" | "ole" | "text" | "binary" | "empty";
/** What the first bytes say the file is. */
export function sniff(buf: Uint8Array): Sniffed {
  if (!buf.length) return "empty";
  const b = (i: number) => buf[i] ?? -1;
  if (b(0) === 0x50 && b(1) === 0x4b && ((b(2) === 3 && b(3) === 4) || (b(2) === 5 && b(3) === 6) || (b(2) === 7 && b(3) === 8))) return "zip";
  const head = Buffer.from(buf.subarray(0, 1024)).toString("latin1");
  if (head.includes("%PDF-")) return "pdf";
  if (b(0) === 0xd0 && b(1) === 0xcf && b(2) === 0x11 && b(3) === 0xe0) return "ole"; // legacy .doc/.xls
  // UTF-16 BOMs and NUL bytes are not text we can import as UTF-8
  if ((b(0) === 0xff && b(1) === 0xfe) || (b(0) === 0xfe && b(1) === 0xff)) return "binary";
  const n = Math.min(buf.length, 8192); for (let i = 0; i < n; i++) if (buf[i] === 0) return "binary";
  return "text";
}

export interface ZipEntryInfo { name: string; compressedSize: number; uncompressedSize: number; dir: boolean; symlink: boolean; encrypted: boolean }
const u16 = (b: Buffer, o: number) => b.readUInt16LE(o); const u32 = (b: Buffer, o: number) => b.readUInt32LE(o);
/** Reads the ZIP central directory (names and declared sizes) without inflating anything. */
export function readZipDirectory(input: Uint8Array, maxEntries: number = LIMITS.zipEntries): ZipEntryInfo[] {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  const bad = (m: string) => new ImportError(`Not a readable ZIP archive: ${m}`, 415, "bad_zip");
  if (buf.length < 22) throw bad("the file is too short");
  let eocd = -1; const stop = Math.max(0, buf.length - 22 - 0xffff);
  for (let i = buf.length - 22; i >= stop; i--) if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 5 && buf[i + 3] === 6) { eocd = i; break; }
  if (eocd < 0) throw bad("the end-of-archive record is missing (truncated download?)");
  const total = u16(buf, eocd + 10); const cdSize = u32(buf, eocd + 12); const cdOffset = u32(buf, eocd + 16);
  if (total === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) throw new ImportError("ZIP64 archives are not supported — split the export into smaller archives (under 4 GB and 65 535 files).", 415, "zip64");
  if (total > maxEntries) throw new ImportError(`The archive holds ${total.toLocaleString("en")} entries; the limit is ${maxEntries.toLocaleString("en")}. Split it into several archives.`, 413, "zip_too_many_entries");
  if (cdOffset + cdSize > eocd) throw bad("its directory points outside the file");
  const out: ZipEntryInfo[] = []; let p = cdOffset;
  for (let i = 0; i < total; i++) {
    if (p + 46 > buf.length || u32(buf, p) !== 0x02014b50) throw bad("its directory is damaged");
    const flags = u16(buf, p + 8); const compressedSize = u32(buf, p + 20); const uncompressedSize = u32(buf, p + 24);
    const nameLen = u16(buf, p + 28); const extraLen = u16(buf, p + 30); const commentLen = u16(buf, p + 32); const external = u32(buf, p + 38);
    if (p + 46 + nameLen > buf.length) throw bad("its directory is damaged");
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff) throw new ImportError("ZIP64 archives are not supported — split the export into smaller archives.", 415, "zip64");
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString("utf8");
    out.push({ name, compressedSize, uncompressedSize, dir: name.endsWith("/") || name.endsWith("\\"), symlink: ((external >>> 16) & 0xf000) === 0xa000, encrypted: (flags & 1) === 1 });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}
/** Why an archive member name is unsafe, or null. Importers never write members to their own path, this is defence in depth. */
export function unsafeZipPath(name: string): string | null {
  if (!name) return "empty name";
  if (name.includes("\0")) return "NUL byte in the name";
  if (name.length > LIMITS.zipPath) return `name longer than ${LIMITS.zipPath} characters`;
  if (/^[\\/]/.test(name)) return "absolute path";
  if (/^[A-Za-z]:/.test(name)) return "drive-letter path";
  if (name.split(/[\\/]/).some((seg) => seg === "..")) return "“..” path segment";
  return null;
}
export interface ZipFacts { entries: ZipEntryInfo[]; files: number; totalUncompressed: number; totalCompressed: number; symlinks: number }
/** Central-directory checks. Throws an ImportError with a sentence the user can act on. */
export function validateZip(buf: Uint8Array, limits: { entries?: number; uncompressed?: number; entry?: number; ratio?: number; ratioFloor?: number } = {}): ZipFacts {
  const L = { entries: limits.entries ?? LIMITS.zipEntries, uncompressed: limits.uncompressed ?? LIMITS.zipUncompressed, entry: limits.entry ?? LIMITS.zipEntry, ratio: limits.ratio ?? LIMITS.zipRatio, ratioFloor: limits.ratioFloor ?? LIMITS.zipRatioFloor };
  const entries = readZipDirectory(buf, L.entries);
  let totalUncompressed = 0, totalCompressed = 0, files = 0, symlinks = 0;
  for (const e of entries) {
    const why = unsafeZipPath(e.name);
    if (why) throw new ImportError(`The archive was refused: an entry has an unsafe path (${why}). Nothing was imported.`, 400, "zip_unsafe_path");
    if (e.encrypted) throw new ImportError("The archive is password-protected. Export it again without a password.", 415, "zip_encrypted");
    if (e.dir) continue;
    if (e.symlink) { symlinks++; continue; }
    if (e.uncompressedSize > L.entry) throw new ImportError(`The archive was refused: one file expands to ${fmtSize(e.uncompressedSize)} (limit ${fmtSize(L.entry)} per file).`, 413, "zip_entry_too_large");
    files++; totalUncompressed += e.uncompressedSize; totalCompressed += e.compressedSize;
    if (totalUncompressed > L.uncompressed) throw new ImportError(`The archive was refused: it expands to more than ${fmtSize(L.uncompressed)}. Split it into several archives.`, 413, "zip_too_large");
  }
  if (totalUncompressed > L.ratioFloor && totalUncompressed / Math.max(1, totalCompressed) > L.ratio) throw new ImportError(`The archive was refused: it expands ${Math.round(totalUncompressed / Math.max(1, totalCompressed))}× (${fmtSize(totalCompressed)} → ${fmtSize(totalUncompressed)}), which looks like a decompression bomb.`, 413, "zip_bomb");
  return { entries, files, totalUncompressed, totalCompressed, symlinks };
}

export interface UploadFacts { kind: ImportKind; size: number; sniffed: Sniffed; zip?: ZipFacts }
/** Size + magic bytes + (for ZIP/DOCX) directory checks. `kind` is what the name/MIME or the caller claims; the content has to agree. */
export function validateUpload(input: { kind: ImportKind; buffer: Uint8Array; filename: string }): UploadFacts {
  const { kind, buffer } = input; const name = input.filename.replace(/^.*[\\/]/, "").slice(0, 120) || "file";
  const size = buffer.length; const s = sniff(buffer);
  if (s === "empty") throw new ImportError(`“${name}” is empty.`, 400, "empty_file");
  const max = Math.min(LIMITS.upload, LIMITS.perKind[kind]);
  if (size > max) throw new ImportError(`“${name}” is ${fmtSize(size)}; the limit for ${kind} files is ${fmtSize(max)}.`, 413, "file_too_large");
  const not = (what: string, hint = "") => new ImportError(`“${name}” is not ${what}: its content does not match its name${hint ? ` (${hint})` : ""}.`, 415, "type_mismatch");
  switch (kind) {
    case "zip": { if (s !== "zip") throw not("a ZIP archive", s === "pdf" ? "it is a PDF" : ""); return { kind, size, sniffed: s, zip: validateZip(buffer) }; }
    case "docx": {
      if (s === "ole") throw not("a .docx document", "legacy .doc files are not supported — save it as .docx");
      if (s !== "zip") throw not("a Word .docx document");
      const zip = validateZip(buffer, { entries: 5000, uncompressed: 600 * MB });
      if (!zip.entries.some((e) => e.name === "word/document.xml")) throw not("a Word .docx document", "the archive has no word/document.xml");
      return { kind, size, sniffed: s, zip };
    }
    case "pdf": { if (s !== "pdf") throw not("a PDF", s === "zip" ? "it is a ZIP archive" : ""); return { kind, size, sniffed: s }; }
    default: {
      if (s !== "text") throw not(`a ${kind === "markdown" ? "text/Markdown" : kind === "bibtex" ? "BibTeX" : kind.toUpperCase()} file`, s === "zip" ? "it is a ZIP archive" : s === "pdf" ? "it is a PDF" : "it contains binary data or is not UTF-8");
      if (kind === "json") { const head = Buffer.from(buffer.subarray(0, 64)).toString("utf8").replace(/^﻿/, "").trimStart(); if (!head.startsWith("{")) throw new ImportError(`“${name}” is not a Note SPBoucher AI JSON backup (it should start with “{”).`, 400, "bad_json"); }
      return { kind, size, sniffed: s };
    }
  }
}

/** Normalised text used to recognise a page that already exists: case, punctuation, whitespace and image placeholders do not count. */
export const normText = (s: string) => s.toLowerCase().replace(/\[image:[^\]]*\]/g, " ").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
/** Duplicate key of a page: title + content hash. */
export const contentKey = (title: string, text: string) => createHash("sha256").update(`${title.trim().toLowerCase()}\n${normText(text)}`).digest("hex");
export const sha256Hex = (buf: Uint8Array) => createHash("sha256").update(buf).digest("hex");
/** `parentId` field of the upload form: absent / empty → null, a UUID → that id (lower-case); anything else (malformed text, a file sent under that name) is a 400, never a 500. */
export function parentIdOf(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v.trim())) throw new ImportError("Invalid parentId: expected the id of a page.", 400, "bad_parent");
  return v.trim().toLowerCase();
}
