/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : tests/unit/next-sync.test.ts
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
 * 3.0 change feed (SPEC §3.1, migration 0003): the 2.x answer is unchanged without `kinds`; with `kinds` every new entity kind is in
 * the feed (revision on every write, tombstone on permanent deletion, cascade included), windowed with the same cursor rule.
 * Runs against a *_dev database; everything it creates is removed at the end.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "../../src/db/index";
import { workspace, mk, doc, made, cleanup, code } from "../helpers/next";
import { syncFeed } from "../../src/lib/sync/feed";
import { ENTITY_KINDS, ENTITIES } from "../../src/lib/sync/entities";
import { createTask, updateTask, deleteTask } from "../../src/lib/tasks/service";
import { ensureDatabase, createProperty, createView, createRow, updateRow } from "../../src/lib/databases/service";
import { createRelation, updateRelation, deleteRelation } from "../../src/lib/graph/relations";
import { createConcept, updateConcept, deleteConcept } from "../../src/lib/graph/concepts";
import { createReference, updateReference } from "../../src/lib/research/references";
import { getCanvas, putCanvas } from "../../src/lib/canvas/service";
import { purgePage, softDeletePage } from "../../src/lib/pages/service";
import { EMPTY_CANVAS } from "../../src/lib/canvas/format";

let ws: string; let wsRow: { id: string; name: string }; const user = { displayName: "Test" }; const PFX = "nx-sync ·";
const feed = (q: string) => syncFeed(wsRow, user, new URLSearchParams(q)) as Promise<any>;
before(async () => { ws = await workspace(); const [w] = await db.select().from(schema.workspaces).where(eq(schema.workspaces.id, ws)); wsRow = { id: w.id, name: w.name }; });
after(() => cleanup(ws, PFX));

test("without `kinds` the answer has exactly the 2.x keys, in the 2.x order, and ignores the new kinds", async () => {
  const start = (await feed("since=0&limit=1")).head; // read from here: the scratch workspace may hold more than one window of older changes
  const p = await mk(ws, `${PFX} compat`, doc("x")); const { task } = await createTask(ws, { title: `${PFX} t` }); made.tasks.push(task.id);
  const gone = await createTask(ws, { title: `${PFX} gone` }); await db.delete(schema.tasks).where(eq(schema.tasks.id, gone.task.id)); // leaves a `task` tombstone
  const a = await feed(`since=${start}&limit=500`);
  assert.deepEqual(Object.keys(a), ["cursor", "head", "more", "reset", "serverTime", "workspace", "user", "pages", "attachments", "tombstones", "tags"]);
  const page = a.pages.find((x: any) => x.id === p.id); assert.ok(page);
  assert.deepEqual(Object.keys(page), ["id", "parentId", "databaseId", "type", "section", "title", "icon", "cover", "content", "properties", "position", "pinned", "archived", "version", "wordCount", "createdAt", "updatedAt", "lastOpenedAt", "deletedAt", "inboxAt", "captureKind", "rev", "tags"]);
  assert.ok(a.tombstones.every((t: any) => t.kind === "page" || t.kind === "attachment"), "tombstones of the new kinds are not sent to a 2.x client");
  for (const t of a.tombstones) assert.deepEqual(Object.keys(t), ["id", "kind", "rev", "deletedAt"]);
  assert.equal("entities" in a, false);
  // `head` of the 2.x answer never moves because of a task
  const h0 = (await feed("since=0&limit=1")).head; await updateTask(ws, task.id, { title: `${PFX} t2` }); assert.equal((await feed("since=0&limit=1")).head, h0);
  const reset = await feed(`since=${h0 + 10_000_000}`); assert.deepEqual(Object.keys(reset), ["reset", "cursor", "head", "more", "pages", "attachments", "tombstones", "tags", "workspace", "serverTime"]); assert.equal(reset.reset, true);
});
test("`kinds` is validated; `kinds=all` returns every entity list, in a fixed order", async () => {
  assert.equal(await code(feed("kinds=task,unicorn")), "bad_kinds"); assert.equal(await code(feed("since=-1")), "bad_cursor");
  const a = await feed("kinds=all&limit=1"); assert.deepEqual(Object.keys(a.entities), [...ENTITY_KINDS]);
  const b = await feed("kinds=concept,task&limit=1"); assert.deepEqual(Object.keys(b.entities), ["task", "concept"], "order of the catalogue, not of the query");
  assert.deepEqual(Object.keys(a).slice(-1), ["entities"], "appended after the 2.x keys");
});
test("every entity kind enters the feed on create and on update, with the documented row shape", async () => {
  const start = (await feed("kinds=all&limit=1")).head as number;
  const host = await mk(ws, `${PFX} db`, undefined, { type: "database", section: "databases" });
  const d = await ensureDatabase(ws, host.id); const prop = await createProperty(ws, d.id, { name: "Note", type: "text" }); const view = await createView(ws, d.id, { name: "Board", type: "board" });
  const row = await createRow(ws, d.id, { title: `${PFX} row` }); made.pages.push(row.pageId);
  const a = await mk(ws, `${PFX} a`, doc("a")); const b = await mk(ws, `${PFX} b`, doc("b"));
  const { relation } = await createRelation(ws, { fromId: a.id, toId: b.id, relType: "supports" });
  const ref = await createReference(ws, { title: `${PFX} ref`, authors: ["Doe, J."], year: 2020 }); made.references.push(ref.id);
  const { concept } = await createConcept(ws, { name: `${PFX} concept` }); made.concepts.push(concept.id);
  const canvas = await mk(ws, `${PFX} canvas`, undefined, { type: "canvas" }); await getCanvas(ws, canvas.id);
  const { task } = await createTask(ws, { title: `${PFX} task`, pageId: a.id, blockId: "blk1" }); made.tasks.push(task.id);
  const f = await feed(`kinds=all&since=${start}&limit=500`); const find = (k: string, id: string) => f.entities[k].find((x: any) => x.id === id);
  const expectIds: Record<string, string> = { task: task.id, database: d.id, database_property: prop.id, database_view: view.id, database_row: row.id, edge: relation.id, reference: ref.id, canvas: canvas.id, concept: concept.id };
  for (const k of ENTITY_KINDS) { const e = find(k, expectIds[k]); assert.ok(e, `${k} is in the feed`); assert.deepEqual(Object.keys(e), Object.keys(ENTITIES[k].cols), `${k} row shape`); assert.ok(e.rev > start && e.rev <= f.head); }
  assert.equal(find("canvas", canvas.id).pageId, canvas.id); assert.equal(find("canvas", canvas.id).data.format, "spn-canvas-1");
  assert.equal(find("task", task.id).blockId, "blk1"); assert.equal(find("edge", relation.id).relType, "supports");
  assert.equal(find("database_property", prop.id).databaseId, d.id);
  // an update moves the row forward again
  const mid = f.head as number;
  await updateTask(ws, task.id, { status: "done" }); await db.update(schema.databases).set({ description: "d" }).where(eq(schema.databases.id, d.id)); await db.update(schema.databaseProperties).set({ name: "Note 2" }).where(eq(schema.databaseProperties.id, prop.id));
  await db.update(schema.databaseViews).set({ name: "Board 2" }).where(eq(schema.databaseViews.id, view.id)); await updateRow(ws, d.id, row.id, { [prop.id]: "hello" });
  await updateRelation(ws, relation.id, { note: "why" }); await updateReference(ws, ref.id, { year: 2021 }); await updateConcept(ws, concept.id, { description: "desc" });
  await putCanvas(ws, canvas.id, { ...EMPTY_CANVAS(), nodes: [{ id: "n1", kind: "text", x: 0, y: 0, w: 10, h: 10, text: "hi" }] }, 1);
  const g = await feed(`kinds=all&since=${mid}&limit=500`);
  for (const k of ENTITY_KINDS) assert.ok(g.entities[k].some((x: any) => x.id === expectIds[k] && x.rev > mid), `${k} moved after an update`);
  // a write that changes nothing is not a change
  const r1 = (await db.select({ rev: schema.tasks.rev }).from(schema.tasks).where(eq(schema.tasks.id, task.id)))[0].rev; await db.update(schema.tasks).set({ title: `${PFX} task` }).where(eq(schema.tasks.id, task.id));
  assert.equal((await db.select({ rev: schema.tasks.rev }).from(schema.tasks).where(eq(schema.tasks.id, task.id)))[0].rev, r1);
  // soft delete stays a row (deletedAt); permanent deletions leave tombstones — also through cascades
  const before = g.head as number; await deleteTask(ws, task.id); await deleteRelation(ws, relation.id); await deleteConcept(ws, concept.id);
  await softDeletePage(ws, host.id); await purgePage(ws, host.id); await softDeletePage(ws, canvas.id); await purgePage(ws, canvas.id);
  await db.delete(schema.researchReferences).where(eq(schema.researchReferences.id, ref.id));
  const h = await feed(`kinds=all&since=${before}&limit=500`);
  assert.ok(h.entities.task.find((x: any) => x.id === task.id)?.deletedAt, "a soft-deleted task is still a row, with deletedAt");
  const tomb = (kind: string, id: string) => h.tombstones.some((t: any) => t.kind === kind && t.id === id);
  assert.ok(tomb("edge", relation.id)); assert.ok(tomb("concept", concept.id)); assert.ok(tomb("reference", ref.id)); assert.ok(tomb("canvas", canvas.id), "canvas tombstone carries the page id");
  assert.ok(tomb("database", d.id) && tomb("database_property", prop.id) && tomb("database_view", view.id) && tomb("database_row", row.id), "purging the host page cascades to the database, its properties, views and rows, each with a tombstone");
  assert.ok(tomb("page", host.id), "and the page itself");
  // re-creating an id clears its tombstone
  await createTask(ws, { id: randomUUID(), title: `${PFX} other` }).then((r) => made.tasks.push(r.task.id));
  const t2 = await createConcept(ws, { id: concept.id, name: `${PFX} concept again` }); made.concepts.push(t2.concept.id);
  assert.equal((await db.select().from(schema.syncTombstones).where(and(eq(schema.syncTombstones.kind, "concept"), eq(schema.syncTombstones.id, concept.id)))).length, 0);
});
test("entities are windowed like pages: nothing skipped, nothing twice, whatever the limit", async () => {
  const start = (await feed("kinds=task&limit=1")).head as number; const ids: string[] = [];
  for (let i = 0; i < 7; i++) { const { task } = await createTask(ws, { title: `${PFX} w${i}` }); ids.push(task.id); made.tasks.push(task.id); }
  const p = await mk(ws, `${PFX} window page`, doc("w"));
  for (const limit of [1, 2, 3, 500]) {
    let since = start; const got: string[] = []; const pages: string[] = []; let rounds = 0; let last: any;
    do { last = await feed(`kinds=task&since=${since}&limit=${limit}`); assert.ok(last.cursor > since || !last.more, "the cursor always advances"); for (const t of last.entities.task) { assert.ok(t.rev > since && t.rev <= last.cursor); got.push(t.id); } pages.push(...last.pages.map((x: any) => x.id)); since = last.cursor; rounds++; } while (last.more && rounds < 100);
    assert.deepEqual(got.filter((id) => ids.includes(id)), ids, `limit=${limit}: the 7 tasks, once each, in revision order`); assert.equal(pages.filter((id) => id === p.id).length, 1, `limit=${limit}: the page once`);
    assert.equal(last.cursor, last.head);
  }
  await db.delete(schema.tasks).where(inArray(schema.tasks.id, ids));
});
test("child rows without a workspace column get it from their parent (trigger sync_fill_workspace)", async () => {
  const host = await mk(ws, `${PFX} db2`, undefined, { type: "database", section: "databases" }); const d = await ensureDatabase(ws, host.id);
  const rows = await db.select({ ws: schema.databaseProperties.workspaceId, rev: schema.databaseProperties.rev }).from(schema.databaseProperties).where(eq(schema.databaseProperties.databaseId, d.id));
  assert.ok(rows.length >= 1 && rows.every((r) => r.ws === ws && r.rev > 0));
  const v = await db.select({ ws: schema.databaseViews.workspaceId }).from(schema.databaseViews).where(eq(schema.databaseViews.databaseId, d.id)); assert.ok(v.every((r) => r.ws === ws));
});
