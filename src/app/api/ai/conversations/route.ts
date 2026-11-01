import { z } from "zod";
import { handler, parseBody } from "@/lib/api";
import { db, schema } from "@/db";
import { and, desc, eq, isNull } from "drizzle-orm";
export const GET = handler(async ({ req, ws }) => {
  const id = new URL(req.url).searchParams.get("id");
  if (id) { const [c] = await db.select().from(schema.aiConversations).where(and(eq(schema.aiConversations.id, id), eq(schema.aiConversations.workspaceId, ws.id))); if (!c) return Response.json({ error: "not found" }, { status: 404 }); const messages = await db.select().from(schema.aiMessages).where(eq(schema.aiMessages.conversationId, id)).orderBy(schema.aiMessages.createdAt); return Response.json({ ...c, messages }); }
  const pageId = new URL(req.url).searchParams.get("pageId");
  return Response.json(await db.select().from(schema.aiConversations).where(and(eq(schema.aiConversations.workspaceId, ws.id), isNull(schema.aiConversations.deletedAt), pageId ? eq(schema.aiConversations.pageId, pageId) : undefined)).orderBy(desc(schema.aiConversations.pinned), desc(schema.aiConversations.updatedAt)).limit(100));
});
export const PATCH = handler(async ({ req, ws }) => {
  const b = await parseBody(req, z.object({ id: z.string().uuid(), title: z.string().max(200).optional(), pinned: z.boolean().optional(), model: z.string().nullable().optional() }));
  const { id, ...set } = b; await db.update(schema.aiConversations).set({ ...set, updatedAt: new Date() }).where(and(eq(schema.aiConversations.id, id), eq(schema.aiConversations.workspaceId, ws.id))); return Response.json({ ok: true });
});
export const DELETE = handler(async ({ req, ws }) => {
  const id = new URL(req.url).searchParams.get("id")!; await db.update(schema.aiConversations).set({ deletedAt: new Date() }).where(and(eq(schema.aiConversations.id, id), eq(schema.aiConversations.workspaceId, ws.id))); return Response.json({ ok: true });
});
