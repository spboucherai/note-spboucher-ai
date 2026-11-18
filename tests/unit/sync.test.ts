/**
 * Change feed for native clients (migration 0002): every write bumps the revision, opening a note does not, permanent deletions leave a
 * tombstone, a client-chosen id is created once. Runs against a *_dev database; everything it creates is purged at the end.
 */
import "../helpers/testdb";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { eq, inArray, and } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db, schema, sql } from "../../src/db/index";
import { createPage, updatePage, softDeletePage, restorePage, purgePage, touchOpened, findPageAnyState } from "../../src/lib/pages/service";
import { setPageTags } from "../../src/lib/inbox/service";
import { deviceLabel } from "../../src/lib/auth/tokens";

let ws: string; const made: string[] = [];
const doc = (t: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: t }] }] });
const rev = async (id: string) => Number((await db.select({ rev: schema.pages.rev }).from(schema.pages).where(eq(schema.pages.id, id)))[0]?.rev ?? -1);
before(async () => { const [w] = await db.select().from(schema.workspaces).limit(1); assert.ok(w, "workspace missing"); ws = w.id; });
after(async () => {
  if (made.length) await db.delete(schema.pages).where(inArray(schema.pages.id, made));
  await db.delete(schema.tags).where(and(eq(schema.tags.workspaceId, ws), inArray(schema.tags.name, ["sync-a", "sync-b"])));
  if (made.length) await db.delete(schema.syncTombstones).where(inArray(schema.syncTombstones.id, made));
  await sql.end();
});

test("every kind of write moves the revision forward; opening a note does not", async () => {
  const p = await createPage(ws, { title: "sync · rev", content: doc("a") }); made.push(p.id);
  const r0 = await rev(p.id); assert.ok(r0 > 0);
  await updatePage(ws, p.id, { content: doc("b") }, { baseVersion: p.version }); const r1 = await rev(p.id); assert.ok(r1 > r0, "content");
  await updatePage(ws, p.id, { pinned: true }); const r2 = await rev(p.id); assert.ok(r2 > r1, "metadata");
  await setPageTags(ws, p.id, ["sync-a", "sync-b"]); const r3 = await rev(p.id); assert.ok(r3 > r2, "tags added");
  await setPageTags(ws, p.id, ["sync-a"]); const r4 = await rev(p.id); assert.ok(r4 > r3, "tag removed");
  await softDeletePage(ws, p.id); const r5 = await rev(p.id); assert.ok(r5 > r4, "trash");
  await restorePage(ws, p.id); const r6 = await rev(p.id); assert.ok(r6 > r5, "restore");
  await touchOpened(p.id); assert.equal(await rev(p.id), r6, "opening is not a change");
  await db.update(schema.pages).set({ title: "sync · rev" }).where(eq(schema.pages.id, p.id)); assert.equal(await rev(p.id), r6, "a write that changes nothing is not a change");
});
test("a permanent deletion leaves a tombstone with a newer revision; children go with it", async () => {
  const parent = await createPage(ws, { title: "sync · parent" }); const child = await createPage(ws, { title: "sync · child", parentId: parent.id }); made.push(parent.id, child.id);
  const before = Math.max(await rev(parent.id), await rev(child.id));
  await softDeletePage(ws, parent.id); await purgePage(ws, parent.id);
  const t = await db.select().from(schema.syncTombstones).where(inArray(schema.syncTombstones.id, [parent.id, child.id]));
  assert.equal(t.filter((x) => x.kind === "page" && x.workspaceId === ws).length, 1, "the purged page has a tombstone (the child row is orphaned by the model, not deleted)");
  assert.ok(t.every((x) => Number(x.rev) > before));
});
test("a client-chosen id creates the page once and never a second time", async () => {
  const id = randomUUID(); made.push(id);
  assert.equal(await findPageAnyState(ws, id), null);
  const p = await createPage(ws, { id, title: "sync · offline note", content: doc("written offline") }); assert.equal(p.id, id);
  const again = await findPageAnyState(ws, id); assert.equal(again?.id, id); assert.equal(again?.title, "sync · offline note");
  await softDeletePage(ws, id); assert.ok((await findPageAnyState(ws, id))?.deletedAt, "found even in the trash");
  await purgePage(ws, id); assert.equal((await db.select().from(schema.syncTombstones).where(eq(schema.syncTombstones.id, id))).length, 1);
  const back = await createPage(ws, { id, title: "sync · offline note (again)" }); assert.equal(back.id, id);
  assert.equal((await db.select().from(schema.syncTombstones).where(eq(schema.syncTombstones.id, id))).length, 0, "re-creating an id clears its tombstone");
});
test("revisions are strictly increasing across concurrent writers", async () => {
  const ps = await Promise.all(Array.from({ length: 12 }, (_, i) => createPage(ws, { title: `sync · burst ${i}` }))); made.push(...ps.map((p) => p.id));
  await Promise.all(ps.map((p, i) => updatePage(ws, p.id, { content: doc(`burst ${i}`) })));
  const revs = await Promise.all(ps.map((p) => rev(p.id))); assert.equal(new Set(revs).size, revs.length);
});
test("native clients get a readable device label", () => {
  assert.equal(deviceLabel("SPNotes/1.0.0 (Macintosh; Mac OS X 27.0) native"), "SP Notes · Mac");
  assert.equal(deviceLabel("SPNotes/1.0 (iPhone; iOS 27.0) native"), "SP Notes · iPhone");
  assert.equal(deviceLabel("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Safari/605.1.15"), "Safari · Mac");
});
