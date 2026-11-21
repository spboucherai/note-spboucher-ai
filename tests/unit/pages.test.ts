/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : tests/unit/pages.test.ts
 * Module           : tests
 * Repository       : https://git.spboucher.ai/note-spboucher-ai
 * Project Website  : https://note.spboucher.ai
 * Created          : 2026-11-17
 * Last Modified    : 2026-11-17
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
 * Data integrity of pages: optimistic concurrency, conflict resolution (both copies survive), history, inbox triage + undo, tags.
 * Runs against a *_dev database; everything it creates is purged at the end.
 */
import "../helpers/testdb";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { and, eq, inArray } from "drizzle-orm";
import { db, schema, sql } from "../../src/db/index";
import { createPage, getPage, updatePage, resolveConflict, softDeletePage, restorePage } from "../../src/lib/pages/service";
import { capture, listInbox, triage, undoTriage, setPageTags, pageTags } from "../../src/lib/inbox/service";
import { assertDoc } from "../../src/lib/editor/validate";

let ws: string; const made: string[] = [];
const doc = (t: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: t }] }] });
const mk = async (title: string, text = "v1") => { const p = await createPage(ws, { title, content: doc(text) }); made.push(p.id); return p; };
const status = async (p: Promise<unknown>) => { try { await p; return 200; } catch (e: any) { return e.status ?? 500; } };
before(async () => { const [w] = await db.select().from(schema.workspaces).limit(1); assert.ok(w, "workspace missing"); ws = w.id; });
after(async () => {
  const kids = made.length ? await db.select({ id: schema.pages.id }).from(schema.pages).where(inArray(schema.pages.id, made)) : [];
  if (kids.length) { await db.delete(schema.tasks).where(inArray(schema.tasks.pageId, kids.map((k) => k.id))); await db.delete(schema.pages).where(inArray(schema.pages.id, kids.map((k) => k.id))); }
  await db.delete(schema.tags).where(and(eq(schema.tags.workspaceId, ws), inArray(schema.tags.name, ["unit-a", "unit-b"])));
  await sql.end();
});

test("a save with the current base version passes and bumps the version", async () => {
  const p = await mk("unit · versions"); const a = await updatePage(ws, p.id, { content: doc("v2") }, { baseVersion: p.version });
  assert.equal(a.version, p.version + 1); assert.equal(a.plainText, "v2");
  const b = await updatePage(ws, p.id, { title: "unit · versions (renamed)" }, { baseVersion: a.version }); assert.equal(b.version, a.version + 1);
  const c = await updatePage(ws, p.id, { pinned: true }, { baseVersion: 0 }); assert.equal(c.version, b.version, "metadata does not bump or check the version");
});
test("a stale save is refused with the server copy and writes nothing", async () => {
  const p = await mk("unit · stale"); await updatePage(ws, p.id, { content: doc("from session A") }, { baseVersion: p.version });
  let err: any; try { await updatePage(ws, p.id, { content: doc("from session B") }, { baseVersion: p.version }); } catch (e) { err = e; }
  assert.equal(err?.status, 409); assert.equal(err?.code, "conflict"); assert.equal(err.extra.server.version, p.version + 1); assert.equal(err.extra.server.content.content[0].content[0].text, "from session A"); assert.ok(err.extra.server.content.content[0].attrs.id, "blocks get a stable id on the server");
  assert.equal((await getPage(ws, p.id)).plainText, "from session A");
});
test("two simultaneous saves on the same base: exactly one wins", async () => {
  const p = await mk("unit · race");
  const r = await Promise.all([status(updatePage(ws, p.id, { content: doc("A") }, { baseVersion: p.version })), status(updatePage(ws, p.id, { content: doc("B") }, { baseVersion: p.version }))]);
  assert.deepEqual([...r].sort(), [200, 409]); assert.equal((await getPage(ws, p.id)).version, p.version + 1);
});
for (const choice of ["mine", "theirs", "both"] as const) test(`conflict resolution "${choice}" keeps both copies`, async () => {
  const p = await mk(`unit · resolve ${choice}`, "base"); const srv = await updatePage(ws, p.id, { content: doc("server text") }, { baseVersion: p.version });
  const r = await resolveConflict(ws, p.id, { choice, serverVersion: srv.version, mine: { title: p.title, content: doc("my text") as any } }); if (r.copyId) made.push(r.copyId);
  const now = await getPage(ws, p.id); const hist = await db.select().from(schema.pageVersions).where(eq(schema.pageVersions.pageId, p.id)); const texts = hist.map((h) => JSON.stringify(h.content));
  if (choice === "mine") { assert.equal(now.plainText, "my text"); assert.ok(texts.some((t) => t.includes("server text")), "server copy is in the history"); }
  if (choice === "theirs") { assert.equal(now.plainText, "server text"); const kept = hist.find((h) => JSON.stringify(h.content).includes("my text")); assert.ok(kept, "my copy is in the history"); assert.ok(kept!.version < 0, "unapplied copies use negative version numbers"); assert.equal(now.version, srv.version, "page untouched"); }
  if (choice === "both") { assert.equal(now.plainText, "server text"); assert.ok(r.copyId); const copy = await getPage(ws, r.copyId!); assert.equal(copy.plainText, "my text"); assert.match(copy.title, /conflict copy/); }
  // a second resolution on an outdated server version is refused, not guessed
  assert.equal(await status(resolveConflict(ws, p.id, { choice: "mine", serverVersion: srv.version - 1, mine: { content: doc("x") as any } })), 409);
});
test("history: a snapshot is taken on first change and prunable copies never exceed 200", async () => {
  const p = await mk("unit · history"); let v = p.version;
  for (let i = 0; i < 3; i++) v = (await updatePage(ws, p.id, { content: doc(`edit ${i}`) }, { baseVersion: v })).version;
  const hist = await db.select().from(schema.pageVersions).where(eq(schema.pageVersions.pageId, p.id)); assert.ok(hist.length >= 1 && hist.length <= 200); assert.equal(hist[0].version, p.version);
});
test("trash and restore keep the page and its descendants", async () => {
  const parent = await mk("unit · parent"); const child = await createPage(ws, { title: "unit · child", parentId: parent.id, content: doc("c") }); made.push(child.id);
  assert.equal(await softDeletePage(ws, parent.id), 2); assert.equal(await status(getPage(ws, child.id)), 404);
  await restorePage(ws, parent.id); assert.equal((await getPage(ws, child.id)).plainText, "c");
});
test("documents are validated before storage", () => {
  assert.throws(() => assertDoc({ type: "paragraph" }), /Invalid document/); assert.throws(() => assertDoc(null)); assert.throws(() => assertDoc({ type: "doc", content: [{ type: 5 }] }));
  assert.throws(() => assertDoc({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "x", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] }] }] }), /Unsafe URL/);
  assert.throws(() => assertDoc({ type: "doc", content: [{ type: "image", attrs: { src: " JavaScript:void(0)" } }] }), /Unsafe URL/);
  let deep: any = { type: "paragraph" }; for (let i = 0; i < 80; i++) deep = { type: "blockquote", content: [deep] }; assert.throws(() => assertDoc({ type: "doc", content: [deep] }), /nested too deeply/);
  assert.doesNotThrow(() => assertDoc(doc("ok")));
});
test("capture lands in the inbox; kinds build the right content", async () => {
  const n = await capture(ws, { kind: "note", text: "unit capture title\nsecond line" }); made.push(n.id); assert.ok(n.inboxAt); assert.equal(n.title, "unit capture title"); assert.equal(n.captureKind, "note");
  const t = await capture(ws, { kind: "tasks", text: "buy milk\ncall Bob" }); made.push(t.id); assert.equal((t.content as any).content[0].type, "taskList"); assert.equal((t.content as any).content[0].content.length, 2);
  const l = await capture(ws, { kind: "link", text: "https://example.org/a?b=1\nworth reading" }); made.push(l.id); assert.equal(l.title, "example.org"); assert.equal((l.content as any).content[0].content[0].marks[0].attrs.href, "https://example.org/a?b=1");
  assert.equal(await status(capture(ws, { kind: "link", text: "javascript:alert(1)" })), 400); assert.equal(await status(capture(ws, { kind: "note", text: "   " })), 400);
  const inbox = await listInbox(ws); const mine = inbox.filter((i) => [n.id, t.id, l.id].includes(i.id)); assert.equal(mine.length, 3); assert.equal(mine.find((i) => i.id === t.id)!.openTasks, 2); assert.equal(mine.find((i) => i.id === l.id)!.url, "https://example.org/a?b=1");
});
test("every triage action can be undone", async () => {
  const state = async (id: string) => { const [p] = await db.select().from(schema.pages).where(eq(schema.pages.id, id)); return { inbox: Boolean(p.inboxAt), archived: p.archived, section: p.section, deleted: Boolean(p.deletedAt) }; };
  const k = await capture(ws, { kind: "note", text: "unit triage keep" }); made.push(k.id);
  const a1 = await triage(ws, k.id, { action: "keep", section: "projects" }); assert.deepEqual(await state(k.id), { inbox: false, archived: false, section: "projects", deleted: false });
  assert.equal(await status(triage(ws, k.id, { action: "archive" })), 409, "an item already filed cannot be triaged twice");
  await undoTriage(ws, a1.actionId); assert.deepEqual(await state(k.id), { inbox: true, archived: false, section: "notes", deleted: false });
  assert.equal((await undoTriage(ws, a1.actionId)).already, true, "undo is idempotent");
  const t = await capture(ws, { kind: "tasks", text: "unit task one\nunit task two" }); made.push(t.id);
  const a2 = await triage(ws, t.id, { action: "task", priority: "high" }); let tasks = await db.select().from(schema.tasks).where(eq(schema.tasks.pageId, t.id)); assert.equal(tasks.filter((x) => !x.deletedAt).length, 2); assert.equal(tasks[0].priority, "high");
  await undoTriage(ws, a2.actionId); tasks = await db.select().from(schema.tasks).where(eq(schema.tasks.pageId, t.id)); assert.equal(tasks.filter((x) => !x.deletedAt).length, 0); assert.equal((await state(t.id)).inbox, true);
  const a3 = await triage(ws, t.id, { action: "archive" }); assert.equal((await state(t.id)).archived, true); await undoTriage(ws, a3.actionId); assert.equal((await state(t.id)).archived, false);
  const a4 = await triage(ws, t.id, { action: "trash" }); assert.equal((await state(t.id)).deleted, true); await undoTriage(ws, a4.actionId); assert.deepEqual(await state(t.id), { inbox: true, archived: false, section: "notes", deleted: false });
});
test("tags are normalised, replaced as a set, and listed", async () => {
  const p = await mk("unit · tags"); assert.deepEqual(await setPageTags(ws, p.id, ["#Unit-A", "unit-b ", "unit-a", ""]), ["unit-a", "unit-b"]);
  assert.deepEqual(await setPageTags(ws, p.id, ["unit-b"]), ["unit-b"]); assert.deepEqual(await pageTags(p.id), ["unit-b"]);
});
