/** Research tasks = rows of `tasks` scoped to a research page. */
import { and, asc, eq, isNull, sql as dsql } from "drizzle-orm";
import { db, schema } from "@/db";
import { HttpError } from "@/lib/errors";
const T = schema.tasks;
export type TaskRow = typeof T.$inferSelect;
export interface TaskInput { pageId: string; title: string; status?: "todo" | "doing" | "done"; priority?: "low" | "medium" | "high"; dueAt?: string | null; project?: string | null }

export async function listTasks(wsId: string, pageId: string) {
  return db.select().from(T).where(and(eq(T.workspaceId, wsId), eq(T.pageId, pageId), isNull(T.deletedAt))).orderBy(dsql`(${T.status} = 'done') asc`, dsql`${T.dueAt} asc nulls last`, asc(T.createdAt));
}
export async function createTask(wsId: string, input: TaskInput) {
  const [t] = await db.insert(T).values({ workspaceId: wsId, pageId: input.pageId, title: input.title.trim() || "Task", status: input.status ?? "todo", priority: input.priority ?? "medium", dueAt: input.dueAt ? new Date(input.dueAt) : null, project: input.project ?? null, completedAt: input.status === "done" ? new Date() : null }).returning();
  return t;
}
export async function createTasks(wsId: string, pageId: string, items: Omit<TaskInput, "pageId">[]) {
  const out: TaskRow[] = []; for (const it of items) out.push(await createTask(wsId, { ...it, pageId })); return out;
}
export async function updateTask(wsId: string, id: string, patch: Partial<TaskInput>) {
  const [prev] = await db.select().from(T).where(and(eq(T.id, id), eq(T.workspaceId, wsId), isNull(T.deletedAt))); if (!prev) throw new HttpError(404, "Task not found");
  const set: Partial<TaskRow> = { updatedAt: new Date() };
  if (patch.title !== undefined) set.title = patch.title.trim() || prev.title;
  if (patch.status !== undefined) { set.status = patch.status; set.completedAt = patch.status === "done" ? (prev.completedAt ?? new Date()) : null; }
  if (patch.priority !== undefined) set.priority = patch.priority;
  if (patch.dueAt !== undefined) set.dueAt = patch.dueAt ? new Date(patch.dueAt) : null;
  if (patch.project !== undefined) set.project = patch.project;
  if (patch.pageId !== undefined) set.pageId = patch.pageId;
  const [t] = await db.update(T).set(set).where(eq(T.id, id)).returning(); return t;
}
export async function deleteTask(wsId: string, id: string) { await db.update(T).set({ deletedAt: new Date() }).where(and(eq(T.id, id), eq(T.workspaceId, wsId))); }
/** Undo of a delete. */
export async function restoreTask(wsId: string, id: string) { const [t] = await db.update(T).set({ deletedAt: null, updatedAt: new Date() }).where(and(eq(T.id, id), eq(T.workspaceId, wsId))).returning(); if (!t) throw new HttpError(404, "Task not found"); return t; }
