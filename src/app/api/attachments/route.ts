import { handler, HttpError } from "@/lib/api";
import { db, schema } from "@/db";
import { and, desc, eq, isNull } from "drizzle-orm";
import { storeFile } from "@/lib/files/storage";
import { extractText } from "@/lib/files/extract";
import { enqueue, QUEUES } from "@/lib/jobs";
import { audit } from "@/lib/audit";
const MAX = 200 * 1024 * 1024;
const BLOCKED = new Set(["application/x-msdownload", "application/x-sh", "text/html", "application/javascript"]);
export const POST = handler(async ({ req, ws, user }) => {
  const form = await req.formData(); const file = form.get("file"); const pageId = (form.get("pageId") as string) || null;
  if (!(file instanceof File)) throw new HttpError(400, "file missing");
  if (file.size > MAX) throw new HttpError(413, "File too large (max 200 MB)");
  const mime = file.type || "application/octet-stream"; if (BLOCKED.has(mime)) throw new HttpError(415, "File type not allowed");
  const buf = Buffer.from(await file.arrayBuffer());
  const { sha256, storagePath } = await storeFile(buf, file.name);
  const ex = await extractText(buf, mime, file.name);
  const [a] = await db.insert(schema.attachments).values({ workspaceId: ws.id, pageId, filename: file.name.slice(0, 255), mime, size: file.size, sha256, storagePath, extractedText: ex?.text ?? null, pageCount: ex?.pages ?? null }).returning();
  if (ex?.text) await enqueue(QUEUES.index, { sourceType: "attachment", sourceId: a.id, workspaceId: ws.id });
  await audit(user.id, "attachment.upload", { type: "attachment", id: a.id }, { name: a.filename, size: a.size });
  return Response.json({ id: a.id, url: `/api/files/${a.id}`, name: a.filename, size: a.size, mime: a.mime, hasText: Boolean(ex?.text), pages: ex?.pages ?? null }, { status: 201 });
});
export const GET = handler(async ({ req, ws }) => {
  const pageId = new URL(req.url).searchParams.get("pageId");
  const rows = await db.select({ id: schema.attachments.id, filename: schema.attachments.filename, mime: schema.attachments.mime, size: schema.attachments.size, pageId: schema.attachments.pageId, pageCount: schema.attachments.pageCount, createdAt: schema.attachments.createdAt, hasText: schema.attachments.extractedText }).from(schema.attachments).where(and(eq(schema.attachments.workspaceId, ws.id), isNull(schema.attachments.deletedAt), pageId ? eq(schema.attachments.pageId, pageId) : undefined)).orderBy(desc(schema.attachments.createdAt)).limit(200);
  return Response.json(rows.map((r) => ({ ...r, hasText: Boolean(r.hasText), url: `/api/files/${r.id}` })));
});
export const DELETE = handler(async ({ req, ws, user }) => {
  const id = new URL(req.url).searchParams.get("id")!;
  await db.update(schema.attachments).set({ deletedAt: new Date() }).where(and(eq(schema.attachments.id, id), eq(schema.attachments.workspaceId, ws.id)));
  await db.delete(schema.chunks).where(and(eq(schema.chunks.sourceType, "attachment"), eq(schema.chunks.sourceId, id)));
  await audit(user.id, "attachment.delete", { type: "attachment", id }); return Response.json({ ok: true });
});
