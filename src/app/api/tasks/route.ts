import { z } from "zod";
import { and, eq, isNull, sql as dsql } from "drizzle-orm";
import { handler, parseBody, uuid, HttpError } from "@/lib/api";
import { db, schema } from "@/db";
import { audit } from "@/lib/audit";

const cols = { id: schema.tasks.id, title: schema.tasks.title, status: schema.tasks.status, priority: schema.tasks.priority, dueAt: schema.tasks.dueAt, completedAt: schema.tasks.completedAt, project: schema.tasks.project, pageId: schema.tasks.pageId, createdAt: schema.tasks.createdAt, updatedAt: schema.tasks.updatedAt, pageTitle: schema.pages.title, pageIcon: schema.pages.icon };
const priority = z.enum(["low", "medium", "high"]);
const dueAt = z.string().datetime({ offset: true }).nullable();

/** GET ?done=1 → all open tasks (+ done ones when done=1), with linked page title. */
export const GET = handler(async ({ req, ws }) => {
  const withDone = new URL(req.url).searchParams.get("done") === "1";
  const rows = await db.select(cols).from(schema.tasks).leftJoin(schema.pages, eq(schema.pages.id, schema.tasks.pageId))
    .where(and(eq(schema.tasks.workspaceId, ws.id), isNull(schema.tasks.deletedAt), withDone ? undefined : dsql`${schema.tasks.status} <> 'done'`))
    .orderBy(dsql`case when ${schema.tasks.status} = 'done' then 1 else 0 end`, dsql`${schema.tasks.dueAt} asc nulls last`, dsql`${schema.tasks.createdAt} desc`).limit(500);
  return Response.json(rows);
});
export const POST = handler(async ({ req, ws, user }) => {
  const b = await parseBody(req, z.object({ title: z.string().trim().min(1).max(500), dueAt: dueAt.optional(), priority: priority.optional(), project: z.string().trim().max(100).nullable().optional(), pageId: uuid.nullable().optional() }));
  const [t] = await db.insert(schema.tasks).values({ workspaceId: ws.id, title: b.title, dueAt: b.dueAt ? new Date(b.dueAt) : null, priority: b.priority ?? "medium", project: b.project || null, pageId: b.pageId ?? null }).returning();
  await audit(user.id, "task.create", { type: "task", id: t.id }, { title: t.title });
  return Response.json(t, { status: 201 });
});
export const PATCH = handler(async ({ req, ws, user }) => {
  const b = await parseBody(req, z.object({ id: uuid, title: z.string().trim().min(1).max(500).optional(), dueAt: dueAt.optional(), priority: priority.optional(), project: z.string().trim().max(100).nullable().optional(), pageId: uuid.nullable().optional(), status: z.enum(["todo", "done"]).optional() }));
  const { id, ...patch } = b;
  const set: Partial<typeof schema.tasks.$inferInsert> = { updatedAt: new Date() };
  if (patch.title !== undefined) set.title = patch.title;
  if (patch.dueAt !== undefined) set.dueAt = patch.dueAt ? new Date(patch.dueAt) : null;
  if (patch.priority !== undefined) set.priority = patch.priority;
  if (patch.project !== undefined) set.project = patch.project || null;
  if (patch.pageId !== undefined) set.pageId = patch.pageId;
  if (patch.status !== undefined) { set.status = patch.status; set.completedAt = patch.status === "done" ? new Date() : null; }
  const [t] = await db.update(schema.tasks).set(set).where(and(eq(schema.tasks.id, id), eq(schema.tasks.workspaceId, ws.id), isNull(schema.tasks.deletedAt))).returning();
  if (!t) throw new HttpError(404, "Task not found");
  if (patch.status !== undefined) await audit(user.id, patch.status === "done" ? "task.complete" : "task.reopen", { type: "task", id });
  return Response.json(t);
});
export const DELETE = handler(async ({ req, ws, user }) => {
  const id = uuid.parse(new URL(req.url).searchParams.get("id"));
  const [t] = await db.update(schema.tasks).set({ deletedAt: new Date() }).where(and(eq(schema.tasks.id, id), eq(schema.tasks.workspaceId, ws.id))).returning({ id: schema.tasks.id });
  if (!t) throw new HttpError(404, "Task not found");
  await audit(user.id, "task.delete", { type: "task", id });
  return Response.json({ ok: true });
});
