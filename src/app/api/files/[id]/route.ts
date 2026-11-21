/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/app/api/files/[id]/route.ts
 * Module           : app
 * Repository       : https://git.spboucher.ai/note-spboucher-ai
 * Project Website  : https://note.spboucher.ai
 * Created          : 2026-11-01
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

import fs from "node:fs";
import { handler, HttpError, uuid } from "@/lib/api";
import { db, schema } from "@/db";
import { and, eq, isNull } from "drizzle-orm";
import { absPath } from "@/lib/files/storage";
import { parseRange } from "@/lib/files/range";
const INLINE = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml", "application/pdf", "text/plain", "video/mp4", "audio/mpeg", "audio/mp4", "audio/x-m4a", "audio/wav", "audio/webm", "audio/ogg", "application/json"]);
/**
 * Authenticated file delivery (never served from a public dir).
 * 3.0: a soft-deleted attachment answers 404 (it used to stay downloadable, defect D-5), and `Range` is honoured — one range per request
 * (`bytes=a-b`, `bytes=a-`, `bytes=-n`) → 206 with `Content-Range`; an unsatisfiable range → 416; several ranges or a malformed header →
 * the whole file (200), as RFC 9110 allows. `Accept-Ranges: bytes` and a strong `ETag` (the content hash) are always sent; `If-Range`
 * with another ETag falls back to the whole file. Audio, video and large PDFs can therefore be streamed and resumed by AVPlayer / PDFKit.
 */
export const GET = handler(async ({ ws, params, req }) => {
  const id = uuid.parse(params.id);
  const [a] = await db.select().from(schema.attachments).where(and(eq(schema.attachments.id, id), eq(schema.attachments.workspaceId, ws.id), isNull(schema.attachments.deletedAt)));
  if (!a) throw new HttpError(404, "Not found", "not_found");
  const p = absPath(a.storagePath); let size: number;
  try { size = fs.statSync(p).size; } catch { throw new HttpError(410, "File missing on disk", "gone"); }
  const etag = `"${a.sha256}"`;
  const base: Record<string, string> = { "content-type": a.mime, "content-disposition": `${INLINE.has(a.mime) ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(a.filename)}`, "cache-control": "private, max-age=31536000, immutable", "x-content-type-options": "nosniff", "accept-ranges": "bytes", etag, ...(a.mime === "image/svg+xml" ? { "content-security-policy": "script-src 'none'" } : {}) };
  const ifRange = req.headers.get("if-range"); const header = !ifRange || ifRange === etag ? req.headers.get("range") : null;
  const r = parseRange(header, size);
  if (r === "unsatisfiable") return new Response(null, { status: 416, headers: { ...base, "content-range": `bytes */${size}` } });
  if (r) return new Response(fs.createReadStream(p, { start: r.start, end: r.end }) as any, { status: 206, headers: { ...base, "content-range": `bytes ${r.start}-${r.end}/${size}`, "content-length": String(r.end - r.start + 1) } });
  if (size === 0) return new Response(null, { status: 200, headers: { ...base, "content-length": "0" } });
  return new Response(fs.createReadStream(p) as any, { headers: { ...base, "content-length": String(size) } });
});
