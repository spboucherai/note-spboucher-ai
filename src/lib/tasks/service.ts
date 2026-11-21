/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/lib/tasks/service.ts
 * Description      : tasks (SPEC §4.2). One service for every writer (API,
 *                    inbox triage, research, agents, documents): client-chosen
 *                    id with idempotent creation, page / block anchor checked
 *                    against the workspace, soft delete, journal events in the
 *                    same transaction. The change feed (`rev`, tombstones) is
 *                    maintained by the database triggers of migration 0003.
 * Module           : lib
 * Repository       : https://git.spboucher.ai/note-spboucher-ai
 * Project Website  : https://note.spboucher.ai
 * Created          : 2026-11-19
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

import { and, eq, gt, isNull, sql as dsql } from "drizzle-orm";
import { db, schema } from "@/db";
import { HttpError } from "@/lib/errors";
import { recordEvent, type Executor } from "@/lib/events/service";
import { parseDue } from "./due";
export { parseDue };

const T = schema.tasks;
export type TaskRow = typeof T.$inferSelect;
export type TaskStatus = "todo" | "doing" | "done";
export type TaskPriority = "low" | "medium" | "high";
export interface TaskInput { id?: string; title: string; status?: TaskStatus; priority?: TaskPriority; dueAt?: string | Date | null; project?: string | null; pageId?: string | null; blockId?: string | null }

/** The stored row as the API returns it (2.x shape — every column — plus `blockId` and `rev`). */
export const taskOut = (t: TaskRow) => t;

async function assertPage(ex: Executor, wsId: string, pageId: string) {
  const [p] = await ex.select({ id: schema.pages.id }).from(schema.pages).where(and(eq(schema.pages.id, pageId), eq(schema.pages.workspaceId, wsId)));
  if (!p) throw new HttpError(400, "Unknown page", "bad_page");
}
/** Tasks of the workspace, open first, by due date. `since` (a rev) returns only what changed after it, deleted tasks included. */
export async function listTasks(wsId: string, opts: { done?: boolean; pageId?: string | null; since?: number | null; limit?: number } = {}) {
  const cols = { id: T.id, title: T.title, status: T.status, priority: T.priority, dueAt: T.dueAt, completedAt: T.completedAt, project: T.project, pageId: T.pageId, createdAt: T.createdAt, updatedAt: T.updatedAt, pageTitle: schema.pages.title, pageIcon: schema.pages.icon, blockId: T.blockId, deletedAt: T.deletedAt, rev: T.rev };
  const delta = opts.since != null;
  return db.select(cols).from(T).leftJoin(schema.pages, eq(schema.pages.id, T.pageId))
    .where(and(eq(T.workspaceId, wsId), delta ? gt(T.rev, opts.since!) : isNull(T.deletedAt), delta || opts.done ? undefined : dsql`${T.status} <> 'done'`, opts.pageId ? eq(T.pageId, opts.pageId) : undefined))
    .orderBy(...(delta ? [dsql`${T.rev} asc`] : [dsql`case when ${T.status} = 'done' then 1 else 0 end`, dsql`${T.dueAt} asc nulls last`, dsql`${T.createdAt} desc`])).limit(Math.min(500, opts.limit ?? 500));
}
export async function getTask(wsId: string, id: string, opts: { includeDeleted?: boolean } = {}) {
  const [t] = await db.select().from(T).where(and(eq(T.id, id), eq(T.workspaceId, wsId), opts.includeDeleted ? undefined : isNull(T.deletedAt)));
  if (!t) throw new HttpError(404, "Task not found", "not_found"); return t;
}
/**
 * Create a task. With a client-chosen `id` the call is idempotent: the second time the stored row is returned untouched
 * (`existing: true`), even when it has been completed, edited or deleted since. An id owned by another workspace → 409 `id_taken`.
 */
export async function createTask(wsId: string, input: TaskInput, ex?: Executor): Promise<{ task: TaskRow; existing: boolean }> {
  const run = async (tx: Executor) => {
    if (input.id) { const [old] = await tx.select().from(T).where(eq(T.id, input.id)); if (old) { if (old.workspaceId !== wsId) throw new HttpError(409, "This id is already in use", "id_taken"); return { task: old, existing: true }; } }
    if (input.pageId) await assertPage(tx, wsId, input.pageId);
    const status = input.status ?? "todo"; const title = input.title.trim().slice(0, 500) || "Tâche";
    const [t] = await tx.insert(T).values({ ...(input.id ? { id: input.id } : {}), workspaceId: wsId, title, status, completedAt: status === "done" ? new Date() : null, priority: input.priority ?? "medium", dueAt: parseDue(input.dueAt), project: input.project?.trim() || null, pageId: input.pageId ?? null, blockId: input.blockId ?? null }).returning();
    await recordEvent(tx, { workspaceId: wsId, kind: "task.created", pageId: t.pageId, entityKind: "task", entityId: t.id, summary: t.title, data: { priority: t.priority, ...(t.dueAt ? { dueAt: t.dueAt.toISOString() } : {}), ...(t.blockId ? { blockId: t.blockId } : {}) } });
    return { task: t, existing: false };
  };
  return ex ? run(ex) : db.transaction(run);
}
export async function updateTask(wsId: string, id: string, patch: Partial<Omit<TaskInput, "id">>): Promise<TaskRow> {
  return db.transaction(async (tx) => {
    const [prev] = await tx.select().from(T).where(and(eq(T.id, id), eq(T.workspaceId, wsId), isNull(T.deletedAt))); if (!prev) throw new HttpError(404, "Task not found", "not_found");
    if (patch.pageId && patch.pageId !== prev.pageId) await assertPage(tx, wsId, patch.pageId);
    const set: Partial<typeof T.$inferInsert> = { updatedAt: new Date() };
    if (patch.title !== undefined) set.title = patch.title.trim().slice(0, 500) || prev.title;
    if (patch.dueAt !== undefined) set.dueAt = parseDue(patch.dueAt);
    if (patch.priority !== undefined) set.priority = patch.priority;
    if (patch.project !== undefined) set.project = patch.project?.trim() || null;
    if (patch.pageId !== undefined) { set.pageId = patch.pageId; if (patch.pageId === null && patch.blockId === undefined) set.blockId = null; }
    if (patch.blockId !== undefined) set.blockId = patch.blockId;
    const wasDone = prev.status === "done"; const willBeDone = patch.status !== undefined ? patch.status === "done" : wasDone;
    if (patch.status !== undefined) { set.status = patch.status; set.completedAt = willBeDone ? (prev.completedAt ?? new Date()) : null; }
    const [t] = await tx.update(T).set(set).where(eq(T.id, id)).returning();
    if (wasDone !== willBeDone) await recordEvent(tx, { workspaceId: wsId, kind: willBeDone ? "task.completed" : "task.reopened", pageId: t.pageId, entityKind: "task", entityId: t.id, summary: t.title, data: t.blockId ? { blockId: t.blockId } : {} });
    return t;
  });
}
/** Soft delete (the row stays in the change feed with `deletedAt`). Returns false when there was nothing to delete: callers decide between 404 and an idempotent 200. */
export async function deleteTask(wsId: string, id: string): Promise<boolean> {
  const [t] = await db.update(T).set({ deletedAt: new Date(), updatedAt: new Date() }).where(and(eq(T.id, id), eq(T.workspaceId, wsId), isNull(T.deletedAt))).returning({ id: T.id });
  return Boolean(t);
}
export async function restoreTask(wsId: string, id: string): Promise<TaskRow> {
  const [t] = await db.update(T).set({ deletedAt: null, updatedAt: new Date() }).where(and(eq(T.id, id), eq(T.workspaceId, wsId))).returning(); if (!t) throw new HttpError(404, "Task not found", "not_found"); return t;
}
