/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/lib/research/tasks.ts
 * Module           : lib
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

/** Research tasks = rows of `tasks` scoped to a research page. */
import { parseDue } from "@/lib/tasks/due";
import { and, asc, eq, isNull, sql as dsql } from "drizzle-orm";
import { db, schema } from "@/db";
import { HttpError } from "@/lib/errors";
import { recordEvent } from "@/lib/events/service";
const T = schema.tasks;
export type TaskRow = typeof T.$inferSelect;
export interface TaskInput { pageId: string; title: string; status?: "todo" | "doing" | "done"; priority?: "low" | "medium" | "high"; dueAt?: string | null; project?: string | null }

export async function listTasks(wsId: string, pageId: string) {
  return db.select().from(T).where(and(eq(T.workspaceId, wsId), eq(T.pageId, pageId), isNull(T.deletedAt))).orderBy(dsql`(${T.status} = 'done') asc`, dsql`${T.dueAt} asc nulls last`, asc(T.createdAt));
}
export async function createTask(wsId: string, input: TaskInput) {
  const [t] = await db.insert(T).values({ workspaceId: wsId, pageId: input.pageId, title: input.title.trim() || "Task", status: input.status ?? "todo", priority: input.priority ?? "medium", dueAt: parseDue(input.dueAt), project: input.project ?? null, completedAt: input.status === "done" ? new Date() : null }).returning();
  await recordEvent(db, { workspaceId: wsId, kind: "task.created", pageId: t.pageId, entityKind: "task", entityId: t.id, summary: t.title, data: { via: "research" } });
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
  if (patch.dueAt !== undefined) set.dueAt = parseDue(patch.dueAt); // a bare date is stored at 12:00 UTC, as /api/tasks does
  if (patch.project !== undefined) set.project = patch.project;
  if (patch.pageId !== undefined) set.pageId = patch.pageId;
  const [t] = await db.update(T).set(set).where(eq(T.id, id)).returning();
  if (patch.status !== undefined && (prev.status === "done") !== (t.status === "done")) await recordEvent(db, { workspaceId: wsId, kind: t.status === "done" ? "task.completed" : "task.reopened", pageId: t.pageId, entityKind: "task", entityId: t.id, summary: t.title, data: { via: "research" } });
  return t;
}
export async function deleteTask(wsId: string, id: string) { await db.update(T).set({ deletedAt: new Date() }).where(and(eq(T.id, id), eq(T.workspaceId, wsId))); }
/** Undo of a delete. */
export async function restoreTask(wsId: string, id: string) { const [t] = await db.update(T).set({ deletedAt: null, updatedAt: new Date() }).where(and(eq(T.id, id), eq(T.workspaceId, wsId))).returning(); if (!t) throw new HttpError(404, "Task not found"); return t; }
