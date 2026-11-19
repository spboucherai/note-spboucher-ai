import { z } from "zod";
import { handler, parseBody, uuid } from "@/lib/api";
import { createPage, findPageAnyState } from "@/lib/pages/service";
import { db, schema } from "@/db";
import { and, desc, eq, isNull, isNotNull, sql as dsql } from "drizzle-orm";
import { audit } from "@/lib/audit";
import { assertDoc } from "@/lib/editor/validate";

/** GET ?view=recent|pinned|trash|archived|section:<name>|children:<id> */
export const GET = handler(async ({ req, ws }) => {
  const u = new URL(req.url); const view = u.searchParams.get("view") ?? "recent"; const limit = Math.min(100, Number(u.searchParams.get("limit") ?? 20));
  const base = [eq(schema.pages.workspaceId, ws.id)];
  const cols = { id: schema.pages.id, title: schema.pages.title, icon: schema.pages.icon, section: schema.pages.section, type: schema.pages.type, parentId: schema.pages.parentId, updatedAt: schema.pages.updatedAt, lastOpenedAt: schema.pages.lastOpenedAt, deletedAt: schema.pages.deletedAt, wordCount: schema.pages.wordCount, pinned: schema.pages.pinned, properties: schema.pages.properties, databaseId: schema.pages.databaseId };
  if (view === "trash") return Response.json(await db.select(cols).from(schema.pages).where(and(...base, isNotNull(schema.pages.deletedAt))).orderBy(desc(schema.pages.deletedAt)).limit(limit));
  if (view === "archived") return Response.json(await db.select(cols).from(schema.pages).where(and(...base, isNull(schema.pages.deletedAt), eq(schema.pages.archived, true))).orderBy(desc(schema.pages.updatedAt)).limit(limit));
  const where = [...base, isNull(schema.pages.deletedAt), eq(schema.pages.archived, false)];
  if (view === "recent") where.push(isNull(schema.pages.inboxAt));
  if (view === "pinned") where.push(eq(schema.pages.pinned, true));
  if (view.startsWith("section:")) where.push(eq(schema.pages.section, view.slice(8)), isNull(schema.pages.databaseId));
  if (view.startsWith("children:")) where.push(eq(schema.pages.parentId, uuid.parse(view.slice(9))));
  const order = view === "recent" ? dsql`greatest(coalesce(last_opened_at, 'epoch'), updated_at) desc` : view.startsWith("children:") ? dsql`position asc` : desc(schema.pages.updatedAt);
  return Response.json(await db.select(cols).from(schema.pages).where(and(...where)).orderBy(order).limit(limit));
});
export const POST = handler(async ({ req, ws, user }) => {
  const b = await parseBody(req, z.object({ id: z.string().uuid().optional(), title: z.string().max(500).optional(), parentId: z.string().uuid().nullable().optional(), section: z.enum(["notes", "documents", "databases", "projects", "research"]).optional(), type: z.enum(["page", "database", "research", "canvas"]).optional(), content: z.any().optional(), icon: z.string().max(16).nullable().optional(), properties: z.record(z.string(), z.unknown()).optional() }));
  if (b.content !== undefined) assertDoc(b.content);
  // A native client creates notes offline under its own UUID and sends them later, possibly twice (retry after a lost answer): the
  // second time the stored page is returned as it is — never a duplicate, never an overwrite.
  if (b.id) { const existing = await findPageAnyState(ws.id, b.id); if (existing) return Response.json(existing, { status: 200, headers: { "x-existing": "1" } }); }
  if (b.parentId && !(await findPageAnyState(ws.id, b.parentId))) b.parentId = null; // parent purged meanwhile: the note is kept, at the top level
  const p = await createPage(ws.id, b);
  await audit(user.id, "page.create", { type: "page", id: p.id }, { title: p.title });
  return Response.json(p, { status: 201 });
});
