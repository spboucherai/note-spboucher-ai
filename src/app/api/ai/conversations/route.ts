import { z } from "zod";
import { handler, parseBody, uuid, HttpError } from "@/lib/api";
import { db, schema } from "@/db";
import { and, desc, eq, isNull } from "drizzle-orm";
/** GET ?id= → one conversation with its messages (sources carry pageId + blockId for citation chips); GET ?pageId= → list. */
export const GET = handler(async ({ req, ws }) => {
  const sp = new URL(req.url).searchParams; const id = sp.get("id");
  if (id) {
    const [c] = await db.select().from(schema.aiConversations).where(and(eq(schema.aiConversations.id, uuid.parse(id)), eq(schema.aiConversations.workspaceId, ws.id), isNull(schema.aiConversations.deletedAt)));
    if (!c) throw new HttpError(404, "Conversation not found");
    const messages = await db.select().from(schema.aiMessages).where(eq(schema.aiMessages.conversationId, c.id)).orderBy(schema.aiMessages.createdAt);
    return Response.json({ ...c, messages });
  }
  const pageId = sp.get("pageId");
  return Response.json(await db.select().from(schema.aiConversations).where(and(eq(schema.aiConversations.workspaceId, ws.id), isNull(schema.aiConversations.deletedAt), pageId ? eq(schema.aiConversations.pageId, uuid.parse(pageId)) : undefined)).orderBy(desc(schema.aiConversations.pinned), desc(schema.aiConversations.updatedAt)).limit(100));
});
export const PATCH = handler(async ({ req, ws }) => {
  const b = await parseBody(req, z.object({ id: z.string().uuid(), title: z.string().max(200).optional(), pinned: z.boolean().optional(), model: z.string().max(80).nullable().optional() }));
  const { id, ...set } = b; await db.update(schema.aiConversations).set({ ...set, updatedAt: new Date() }).where(and(eq(schema.aiConversations.id, id), eq(schema.aiConversations.workspaceId, ws.id))); return Response.json({ ok: true });
});
/** DELETE ?id= → soft delete (the conversation leaves the history list; `&restore=1` brings it back — used by the Undo toast). */
export const DELETE = handler(async ({ req, ws }) => {
  const sp = new URL(req.url).searchParams; const id = uuid.parse(sp.get("id"));
  await db.update(schema.aiConversations).set({ deletedAt: sp.get("restore") === "1" ? null : new Date() }).where(and(eq(schema.aiConversations.id, id), eq(schema.aiConversations.workspaceId, ws.id))); return Response.json({ ok: true });
});
