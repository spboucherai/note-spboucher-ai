import { handler, HttpError, uuid, optUuid } from "@/lib/api";
import { recordEvent } from "@/lib/events/service";
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
  // Native clients attach files offline under their own UUID (the note already references /api/files/<id>): same id twice → the stored row.
  const givenId = (form.get("id") as string) || null;
  if (givenId) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(givenId)) throw new HttpError(400, "Invalid id");
    const [ex] = await db.select().from(schema.attachments).where(eq(schema.attachments.id, givenId));
    if (ex) { if (ex.workspaceId !== ws.id) throw new HttpError(409, "This id is already in use", "id_taken"); return Response.json({ id: ex.id, url: `/api/files/${ex.id}`, name: ex.filename, size: ex.size, mime: ex.mime, hasText: Boolean(ex.extractedText), pages: ex.pageCount ?? null }, { status: 200, headers: { "x-existing": "1" } }); }
  }
  if (pageId && !/^[0-9a-f-]{36}$/i.test(pageId)) throw new HttpError(400, "Invalid pageId");
  if (file.size > MAX) throw new HttpError(413, "File too large (max 200 MB)");
  const mime = file.type || "application/octet-stream"; if (BLOCKED.has(mime)) throw new HttpError(415, "File type not allowed");
  const buf = Buffer.from(await file.arrayBuffer());
  const { sha256, storagePath } = await storeFile(buf, file.name);
  const ex = await extractText(buf, mime, file.name);
  const pageOk = pageId ? (await db.select({ id: schema.pages.id }).from(schema.pages).where(and(eq(schema.pages.id, pageId), eq(schema.pages.workspaceId, ws.id)))).length > 0 : false;
  const [a] = await db.insert(schema.attachments).values({ ...(givenId ? { id: givenId.toLowerCase() } : {}), workspaceId: ws.id, pageId: pageOk ? pageId : null, filename: file.name.slice(0, 255), mime, size: file.size, sha256, storagePath, extractedText: ex?.text ?? null, pageCount: ex?.pages ?? null }).returning();
  if (ex?.text) await enqueue(QUEUES.index, { sourceType: "attachment", sourceId: a.id, workspaceId: ws.id });
  await recordEvent(db, { workspaceId: ws.id, kind: "attachment.added", pageId: a.pageId, entityKind: "attachment", entityId: a.id, summary: a.filename, data: { mime: a.mime, size: a.size } });
  await audit(user.id, "attachment.upload", { type: "attachment", id: a.id }, { name: a.filename, size: a.size });
  return Response.json({ id: a.id, url: `/api/files/${a.id}`, name: a.filename, size: a.size, mime: a.mime, hasText: Boolean(ex?.text), pages: ex?.pages ?? null }, { status: 201 });
});
export const GET = handler(async ({ req, ws }) => {
  const pageId = optUuid(new URL(req.url).searchParams.get("pageId"));
  const rows = await db.select({ id: schema.attachments.id, filename: schema.attachments.filename, mime: schema.attachments.mime, size: schema.attachments.size, pageId: schema.attachments.pageId, pageCount: schema.attachments.pageCount, createdAt: schema.attachments.createdAt, hasText: schema.attachments.extractedText }).from(schema.attachments).where(and(eq(schema.attachments.workspaceId, ws.id), isNull(schema.attachments.deletedAt), pageId ? eq(schema.attachments.pageId, pageId) : undefined)).orderBy(desc(schema.attachments.createdAt)).limit(200);
  return Response.json(rows.map((r) => ({ ...r, hasText: Boolean(r.hasText), url: `/api/files/${r.id}` })));
});
export const DELETE = handler(async ({ req, ws, user }) => {
  const id = uuid.parse(new URL(req.url).searchParams.get("id")); // missing or malformed → 400
  await db.update(schema.attachments).set({ deletedAt: new Date() }).where(and(eq(schema.attachments.id, id), eq(schema.attachments.workspaceId, ws.id)));
  await db.delete(schema.chunks).where(and(eq(schema.chunks.sourceType, "attachment"), eq(schema.chunks.sourceId, id)));
  await audit(user.id, "attachment.delete", { type: "attachment", id }); return Response.json({ ok: true });
});
