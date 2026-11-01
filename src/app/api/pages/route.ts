import { z } from "zod";
import { handler, parseBody } from "@/lib/api";
import { createPage } from "@/lib/pages/service";
import { db, schema } from "@/db";
import { and, desc, eq, isNull, isNotNull, sql as dsql } from "drizzle-orm";
import { audit } from "@/lib/audit";

/** GET ?view=recent|pinned|trash|section:<name>|children:<id> */
export const GET = handler(async ({ req, ws }) => {
  const u = new URL(req.url); const view = u.searchParams.get("view") ?? "recent"; const limit = Math.min(100, Number(u.searchParams.get("limit") ?? 20));
  const base = [eq(schema.pages.workspaceId, ws.id)];
  const cols = { id: schema.pages.id, title: schema.pages.title, icon: schema.pages.icon, section: schema.pages.section, type: schema.pages.type, parentId: schema.pages.parentId, updatedAt: schema.pages.updatedAt, lastOpenedAt: schema.pages.lastOpenedAt, deletedAt: schema.pages.deletedAt, wordCount: schema.pages.wordCount, pinned: schema.pages.pinned, properties: schema.pages.properties, databaseId: schema.pages.databaseId };
  if (view === "trash") return Response.json(await db.select(cols).from(schema.pages).where(and(...base, isNotNull(schema.pages.deletedAt))).orderBy(desc(schema.pages.deletedAt)).limit(limit));
  const where = [...base, isNull(schema.pages.deletedAt)];
  if (view === "pinned") where.push(eq(schema.pages.pinned, true));
  if (view.startsWith("section:")) where.push(eq(schema.pages.section, view.slice(8)), isNull(schema.pages.databaseId));
  if (view.startsWith("children:")) where.push(eq(schema.pages.parentId, view.slice(9)));
  const order = view === "recent" ? dsql`greatest(coalesce(last_opened_at, 'epoch'), updated_at) desc` : view.startsWith("children:") ? dsql`position asc` : desc(schema.pages.updatedAt);
  return Response.json(await db.select(cols).from(schema.pages).where(and(...where)).orderBy(order).limit(limit));
});
export const POST = handler(async ({ req, ws, user }) => {
  const b = await parseBody(req, z.object({ title: z.string().max(500).optional(), parentId: z.string().uuid().nullable().optional(), section: z.enum(["notes", "documents", "databases", "projects", "research"]).optional(), type: z.enum(["page", "database", "research"]).optional(), content: z.any().optional(), icon: z.string().max(16).nullable().optional(), properties: z.record(z.string(), z.unknown()).optional() }));
  const p = await createPage(ws.id, b);
  await audit(user.id, "page.create", { type: "page", id: p.id }, { title: p.title });
  return Response.json(p, { status: 201 });
});
