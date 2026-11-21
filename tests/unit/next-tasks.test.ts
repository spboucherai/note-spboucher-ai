/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : tests/unit/next-tasks.test.ts
 * Module           : tests
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

/**
 * Tasks 3.0 (SPEC §4.2): client-chosen id and idempotent creation, anchors, due dates, soft delete, deltas, journal events, and the
 * link between a `taskItem` of a document and its task. Runs against a *_dev database.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, schema } from "../../src/db/index";
import { workspace, mk, doc, made, cleanup, code, kinds, para } from "../helpers/next";
import { createTask, updateTask, deleteTask, getTask, listTasks, parseDue, restoreTask } from "../../src/lib/tasks/service";
import { taskCreate, taskPatch } from "../../src/lib/tasks/schema";
import { getPage, updatePage } from "../../src/lib/pages/service";
import type { PMNode } from "../../src/lib/editor/text";

let ws: string; const PFX = "nx-task ·";
before(async () => { ws = await workspace(); }); after(() => cleanup(ws, PFX));
const taskRow = async (id: string) => (await db.select().from(schema.tasks).where(eq(schema.tasks.id, id)))[0];
const item = (text: string, attrs: Record<string, unknown>): PMNode => ({ type: "taskItem", attrs: { checked: false, ...attrs }, content: [para(text)] });
const list = (...items: PMNode[]): PMNode => doc({ type: "taskList", content: items }, "autre paragraphe");

test("a client-chosen id creates the task once; a repeat returns the stored task untouched", async () => {
  const id = randomUUID(); made.tasks.push(id); const p = await mk(ws, `${PFX} page`, doc("x"));
  const a = await createTask(ws, { id, title: `${PFX} offline`, priority: "high", dueAt: "2026-12-01", pageId: p.id, blockId: "blk42" });
  assert.equal(a.existing, false); assert.equal(a.task.id, id); assert.equal(a.task.blockId, "blk42"); assert.equal(a.task.priority, "high"); assert.equal(a.task.dueAt?.toISOString(), "2026-12-01T12:00:00.000Z"); assert.ok(a.task.rev > 0);
  await updateTask(ws, id, { status: "done" });
  const b = await createTask(ws, { id, title: "another title", priority: "low" }); assert.equal(b.existing, true); assert.equal(b.task.title, `${PFX} offline`); assert.equal(b.task.status, "done", "never overwritten by a retry");
  await deleteTask(ws, id); const c = await createTask(ws, { id, title: "x" }); assert.equal(c.existing, true); assert.ok(c.task.deletedAt, "a deleted task is not resurrected by a retry");
  assert.equal((await kinds(p.id)).filter((k) => k === "task.created").length, 1, "one journal entry for one creation");
});
test("validation: unknown page → 400 bad_page, bad due date → 400, body schemas", async () => {
  assert.equal(await code(createTask(ws, { title: "x", pageId: randomUUID() })), "bad_page");
  const { task } = await createTask(ws, { title: `${PFX} v` }); made.tasks.push(task.id);
  assert.equal(await code(updateTask(ws, task.id, { pageId: randomUUID() })), "bad_page"); assert.equal(await code(updateTask(ws, randomUUID(), { title: "x" })), "not_found");
  assert.throws(() => parseDue("demain"), /Invalid due date/); assert.equal(parseDue(null), null); assert.equal(parseDue("2026-11-25T09:00:00-05:00")?.toISOString(), "2026-11-25T14:00:00.000Z");
  assert.equal(taskCreate.safeParse({ title: "x", id: "nope" }).success, false); assert.equal(taskCreate.safeParse({ title: "" }).success, false);
  assert.equal(taskCreate.safeParse({ title: "x", due: "2026-11-25", priority: "high", blockId: "abc", pageId: null }).success, true); assert.equal(taskCreate.safeParse({ title: "x", dueAt: "25/11/2026" }).success, false);
  assert.equal(taskPatch.safeParse({ status: "doing" }).success, true); assert.equal(taskPatch.safeParse({ priority: "urgent" }).success, false);
});
test("complete / reopen are journaled once each; delete is soft and shows in a delta", async () => {
  const p = await mk(ws, `${PFX} events`, doc("x")); const { task } = await createTask(ws, { title: `${PFX} e`, pageId: p.id }); made.tasks.push(task.id);
  const r0 = task.rev; const done = await updateTask(ws, task.id, { status: "done" }); assert.ok(done.completedAt); assert.ok(done.rev > r0);
  await updateTask(ws, task.id, { status: "done" }); await updateTask(ws, task.id, { title: `${PFX} e2` }); const re = await updateTask(ws, task.id, { status: "todo" }); assert.equal(re.completedAt, null);
  assert.deepEqual((await kinds(p.id)).filter((k) => k.startsWith("task.")), ["task.created", "task.completed", "task.reopened"]);
  assert.equal(await deleteTask(ws, task.id), true); assert.equal(await deleteTask(ws, task.id), false, "second delete: nothing left to delete");
  assert.equal(await code(getTask(ws, task.id)), "not_found"); assert.ok((await getTask(ws, task.id, { includeDeleted: true })).deletedAt);
  assert.equal((await listTasks(ws)).some((t) => t.id === task.id), false); const delta = await listTasks(ws, { since: re.rev }); assert.ok(delta.find((t) => t.id === task.id)?.deletedAt, "the delta tells clients about the deletion");
  assert.equal((await restoreTask(ws, task.id)).deletedAt, null);
});
test("a taskItem with a new taskId creates its task when the page is saved", async () => {
  const id = randomUUID(); made.tasks.push(id);
  const p = await mk(ws, `${PFX} doc`, list(item("Écrire la section 3", { taskId: id, due: "2026-11-25", priority: "high" }), item("sans lien", {})));
  const t = await taskRow(id); assert.ok(t, "created from the document"); assert.equal(t.title, "Écrire la section 3"); assert.equal(t.pageId, p.id); assert.equal(t.status, "todo"); assert.equal(t.priority, "high"); assert.equal(t.dueAt?.toISOString(), "2026-11-25T12:00:00.000Z");
  const stored = (await getPage(ws, p.id)).content as PMNode; const blockId = stored.content![0].content![0].attrs!.id; assert.match(blockId, /^[\w-]{10}$/); assert.equal(t.blockId, blockId, "anchored to the taskItem block");
  assert.equal((await db.select().from(schema.tasks).where(eq(schema.tasks.pageId, p.id))).length, 1, "an item without taskId creates nothing");
  assert.ok((await kinds(p.id)).includes("task.created"));
});
test("checking the box completes the task; an unrelated save never undoes a task completed elsewhere", async () => {
  const id = randomUUID(); made.tasks.push(id); const p = await mk(ws, `${PFX} sync`, list(item("Tâche liée", { taskId: id })));
  const withChecked = (checked: boolean, text = "Tâche liée", tail = "autre paragraphe") => { const cur = list(item(text, { taskId: id, checked })); cur.content![1] = para(tail); return cur; };
  let v = p.version;
  v = (await updatePage(ws, p.id, { content: withChecked(true) }, { baseVersion: v })).version; assert.equal((await taskRow(id)).status, "done"); assert.ok((await taskRow(id)).completedAt);
  v = (await updatePage(ws, p.id, { content: withChecked(false) }, { baseVersion: v })).version; assert.equal((await taskRow(id)).status, "todo");
  assert.deepEqual((await kinds(p.id)).filter((k) => k === "task.completed" || k === "task.reopened"), ["task.completed", "task.reopened"]);
  // completed from the task list (API), then the page is saved again with an edit elsewhere and the box still unchecked in that copy
  await updateTask(ws, id, { status: "done" });
  v = (await updatePage(ws, p.id, { content: withChecked(false, "Tâche liée", "paragraphe modifié") }, { baseVersion: v })).version; assert.equal((await taskRow(id)).status, "done", "the document did not change that item: the task keeps its state");
  // renaming the item renames the task; removing the item keeps the task
  v = (await updatePage(ws, p.id, { content: withChecked(false, "Tâche renommée", "paragraphe modifié") }, { baseVersion: v })).version; assert.equal((await taskRow(id)).title, "Tâche renommée");
  await updatePage(ws, p.id, { content: doc("plus de liste") }, { baseVersion: v }); const t = await taskRow(id); assert.ok(t && !t.deletedAt, "removing the item does not delete the task");
});
test("a taskId that belongs to a deleted task is left alone", async () => {
  const { task } = await createTask(ws, { title: `${PFX} dead` }); made.tasks.push(task.id); await deleteTask(ws, task.id);
  const p = await mk(ws, `${PFX} dead doc`, list(item("zombie", { taskId: task.id, checked: true })));
  const t = await taskRow(task.id); assert.ok(t.deletedAt); assert.equal(t.status, "todo"); assert.equal(t.pageId, null); assert.equal((await kinds(p.id)).filter((k) => k.startsWith("task.")).length, 0);
});
