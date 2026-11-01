import fs from "node:fs";
import { handler, HttpError, uuid } from "@/lib/api";
import { db, schema } from "@/db";
import { and, eq } from "drizzle-orm";
import { absPath } from "@/lib/files/storage";
const INLINE = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml", "application/pdf", "text/plain", "video/mp4", "audio/mpeg"]);
/** Authenticated file delivery (never served from a public dir). */
export const GET = handler(async ({ ws, params }) => {
  const id = uuid.parse(params.id);
  const [a] = await db.select().from(schema.attachments).where(and(eq(schema.attachments.id, id), eq(schema.attachments.workspaceId, ws.id)));
  if (!a) throw new HttpError(404, "Not found");
  const p = absPath(a.storagePath); if (!fs.existsSync(p)) throw new HttpError(410, "File missing on disk");
  const stream = fs.createReadStream(p);
  const mime = a.mime === "image/svg+xml" ? "image/svg+xml" : a.mime;
  return new Response(stream as any, { headers: { "content-type": mime, "content-length": String(a.size), "content-disposition": `${INLINE.has(a.mime) ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(a.filename)}`, "cache-control": "private, max-age=31536000, immutable", "x-content-type-options": "nosniff", ...(a.mime === "image/svg+xml" ? { "content-security-policy": "script-src 'none'" } : {}) } });
});
