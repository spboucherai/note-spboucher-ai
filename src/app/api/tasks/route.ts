/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/app/api/tasks/route.ts
 * Module           : app
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

import { handler, parseBody, uuid, HttpError } from "@/lib/api";
import { audit } from "@/lib/audit";
import { createTask, deleteTask, listTasks, taskOut, updateTask } from "@/lib/tasks/service";
import { taskCreate, taskPatch, dueOf } from "@/lib/tasks/schema";

/**
 * GET ?done=1&pageId=&since=<rev> → open tasks (+ done ones when done=1), with the linked page title. `since` turns the answer into a
 * delta: every task whose revision is greater, deleted ones included (`deletedAt`). Shape of 2.x plus `blockId`, `deletedAt`, `rev`.
 */
export const GET = handler(async ({ req, ws }) => {
  const u = new URL(req.url).searchParams; const since = u.get("since");
  if (since !== null && !/^\d{1,15}$/.test(since)) throw new HttpError(400, "since must be a non-negative integer", "bad_cursor");
  const pageId = u.get("pageId"); if (pageId) uuid.parse(pageId);
  return Response.json(await listTasks(ws.id, { done: u.get("done") === "1", pageId, since: since === null ? null : Number(since) }));
});
/** POST → 201 task. With a client-chosen `id` the call is idempotent: a repeat answers 200 + `x-existing: 1` with the stored task. */
export const POST = handler(async ({ req, ws, user }) => {
  const b = await parseBody(req, taskCreate);
  const { task, existing } = await createTask(ws.id, { id: b.id, title: b.title, dueAt: dueOf(b), priority: b.priority, project: b.project, pageId: b.pageId, blockId: b.blockId, status: b.status });
  if (existing) return Response.json(taskOut(task), { status: 200, headers: { "x-existing": "1" } });
  await audit(user.id, "task.create", { type: "task", id: task.id }, { title: task.title });
  return Response.json(taskOut(task), { status: 201 });
});
/** PATCH { id, … } — 2.x form (id in the body), kept for the shipped clients. New clients use PATCH /api/tasks/<id>. */
export const PATCH = handler(async ({ req, ws, user }) => {
  const b = await parseBody(req, taskPatch.extend({ id: uuid }));
  const { id, due: _d, dueAt: _a, ...patch } = b; const d = dueOf(b);
  const t = await updateTask(ws.id, id, { ...patch, ...(d !== undefined ? { dueAt: d } : {}) });
  if (patch.status !== undefined) await audit(user.id, patch.status === "done" ? "task.complete" : "task.reopen", { type: "task", id });
  return Response.json(taskOut(t));
});
/** DELETE ?id= — 2.x form: 404 when the task does not exist or is already deleted. */
export const DELETE = handler(async ({ req, ws, user }) => {
  const id = uuid.parse(new URL(req.url).searchParams.get("id"));
  if (!(await deleteTask(ws.id, id))) throw new HttpError(404, "Task not found", "not_found");
  await audit(user.id, "task.delete", { type: "task", id });
  return Response.json({ ok: true });
});
