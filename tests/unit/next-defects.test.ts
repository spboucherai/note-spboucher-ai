/**
 * Regression tests of the defects fixed in 3.0 (audit D-1 … D-12): tag counts, purge (attachments, files, descendants), malformed
 * identifiers, parent cycles, Range parsing, stable block ids after the background back-fill. Runs against a *_dev database.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { and, eq, inArray } from "drizzle-orm";
import { db, schema, sql } from "../../src/db/index";
import { workspace, mk, doc, made, cleanup, code, kinds, para } from "../helpers/next";
import { listTags, setPageTags } from "../../src/lib/inbox/service";
import { createPage, updatePage, softDeletePage, restorePage, purgePage, purgePages, descendants, breadcrumb, getPage } from "../../src/lib/pages/service";
import { storeFile, absPath } from "../../src/lib/files/storage";
import { parseRange } from "../../src/lib/files/range";
import { clientError, uuid, optUuid, optDate } from "../../src/lib/http-input";
import { HttpError } from "../../src/lib/errors";
import { handleIndex } from "../../src/worker/handlers/index-source";
import { createReference } from "../../src/lib/research/references";
import type { PMNode } from "../../src/lib/editor/text";

let ws: string; const PFX = "nx-fix ·";
before(async () => { ws = await workspace(); }); after(async () => { made.tags.push("nx-fix-a", "nx-fix-b", "nx-fix-empty"); await cleanup(ws, PFX); });
const attach = async (pageId: string | null, body: string, name = "note.txt") => { const buf = Buffer.from(body); const f = await storeFile(buf, name); const [a] = await db.insert(schema.attachments).values({ workspaceId: ws, pageId, filename: name, mime: "text/plain", size: buf.length, sha256: f.sha256, storagePath: f.storagePath, extractedText: body }).returning(); made.attachments.push(a.id); return a; };
const exists = async (id: string) => (await db.select({ id: schema.pages.id }).from(schema.pages).where(eq(schema.pages.id, id))).length === 1;

test("D-1: GET /api/tags counts the pages of each tag (it always answered 0)", async () => {
  const a = await mk(ws, `${PFX} tag a`); const b = await mk(ws, `${PFX} tag b`); const c = await mk(ws, `${PFX} tag trashed`);
  await setPageTags(ws, a.id, ["nx-fix-a", "nx-fix-b"]); await setPageTags(ws, b.id, ["nx-fix-a"]); await setPageTags(ws, c.id, ["nx-fix-a", "nx-fix-empty"]); await softDeletePage(ws, c.id);
  const tags = await listTags(ws); const n = (name: string) => tags.find((t) => t.name === name)?.pages;
  assert.equal(n("nx-fix-a"), 2, "two live pages (the trashed one is not counted)"); assert.equal(n("nx-fix-b"), 1); assert.equal(n("nx-fix-empty"), 0);
  assert.deepEqual(Object.keys(tags[0]), ["id", "name", "color", "pages"], "same shape as before");
});
test("D-2: purging a page deletes its attachments — rows, index, and the file on disk", async () => {
  const p = await mk(ws, `${PFX} purge files`, doc("x")); const a = await attach(p.id, `unique body ${randomUUID()}`);
  await db.insert(schema.chunks).values({ workspaceId: ws, sourceType: "attachment", sourceId: a.id, pageId: p.id, ordinal: 0, content: "x", contentHash: "h" });
  const file = absPath(a.storagePath); assert.ok(fs.existsSync(file));
  await softDeletePage(ws, p.id); const r = await purgePage(ws, p.id); assert.deepEqual(r, { purged: 1, attachments: 1, kept: 0 });
  assert.equal((await db.select().from(schema.attachments).where(eq(schema.attachments.id, a.id))).length, 0, "attachment row deleted (2.x left it with page_id = null)");
  assert.equal(fs.existsSync(file), false, "file removed from disk"); assert.equal((await db.select().from(schema.chunks).where(eq(schema.chunks.sourceId, a.id))).length, 0, "its text is no longer searchable");
  const tomb = await db.select().from(schema.syncTombstones).where(inArray(schema.syncTombstones.id, [p.id, a.id])); assert.deepEqual(tomb.map((t) => t.kind).sort(), ["attachment", "page"], "native clients learn about both deletions");
});
test("D-2: an attachment something else still uses is kept; a shared file stays on disk", async () => {
  const body = `shared body ${randomUUID()}`; const p = await mk(ws, `${PFX} purge shared`, doc("x")); const q = await mk(ws, `${PFX} keeper`, doc("y"));
  const used = await attach(p.id, `used elsewhere ${randomUUID()}`); const refPdf = await attach(p.id, `pdf of a reference ${randomUUID()}`); const twin1 = await attach(p.id, body); const twin2 = await attach(q.id, body);
  await updatePage(ws, q.id, { content: doc({ type: "image", attrs: { src: `/api/files/${used.id}`, alt: "copied" } }) });
  const ref = await createReference(ws, { title: `${PFX} ref with pdf`, attachmentId: refPdf.id }); made.references.push(ref.id);
  assert.equal(twin1.storagePath, twin2.storagePath, "content-addressed: two rows, one file");
  await softDeletePage(ws, p.id); const r = await purgePage(ws, p.id); assert.deepEqual(r, { purged: 1, attachments: 1, kept: 2 });
  const left = (await db.select({ id: schema.attachments.id, pageId: schema.attachments.pageId }).from(schema.attachments).where(inArray(schema.attachments.id, [used.id, refPdf.id, twin1.id, twin2.id]))).map((x) => x.id).sort();
  assert.deepEqual(left, [used.id, refPdf.id, twin2.id].sort(), "kept: the image another page shows, the PDF of a reference, the other page's own copy");
  assert.ok(fs.existsSync(absPath(twin2.storagePath)), "the shared file is still needed by the other row"); assert.ok(fs.existsSync(absPath(used.storagePath)));
});
test("D-7: purge takes the sub-pages trashed with their parent — never a live one, never one trashed separately", async () => {
  const parent = await mk(ws, `${PFX} tree parent`); const together = await mk(ws, `${PFX} tree together`, doc("a"), { parentId: parent.id }); const grand = await mk(ws, `${PFX} tree grandchild`, doc("b"), { parentId: together.id });
  const early = await mk(ws, `${PFX} tree trashed earlier`, doc("c"), { parentId: parent.id }); const rescued = await mk(ws, `${PFX} tree restored`, doc("d"), { parentId: parent.id }); const rescuedKid = await mk(ws, `${PFX} tree restored kid`, doc("e"), { parentId: rescued.id });
  await softDeletePage(ws, early.id); await new Promise((r) => setTimeout(r, 15));
  assert.equal(await softDeletePage(ws, parent.id), 5, "parent + its 4 live descendants (the one already in the trash is not counted)"); await new Promise((r) => setTimeout(r, 15));
  await restorePage(ws, rescued.id); // the user takes this branch back out of the trash
  const r = await purgePage(ws, parent.id); assert.equal(r.purged, 3, "parent, the sub-page trashed with it, and its grandchild");
  assert.deepEqual([await exists(parent.id), await exists(together.id), await exists(grand.id)], [false, false, false]);
  assert.deepEqual([await exists(early.id), await exists(rescued.id), await exists(rescuedKid.id)], [true, true, true], "live and separately-trashed sub-pages are kept");
  const e = await getPage(ws, early.id, { includeDeleted: true }); assert.ok(e.deletedAt, "still in the trash, restorable"); assert.equal(e.parentId, null, "re-attached to the top level instead of a parent that no longer exists");
  const live = await getPage(ws, rescued.id); assert.equal(live.parentId, null); assert.equal((await getPage(ws, rescuedKid.id)).parentId, rescued.id, "its own sub-tree is untouched");
  assert.deepEqual((await kinds(together.id)).filter((k) => k === "page.purged"), ["page.purged"]); assert.equal((await kinds(rescued.id)).includes("page.purged"), false);
  assert.deepEqual(await purgePage(ws, randomUUID()), { purged: 0, attachments: 0, kept: 0 }, "purging an unknown id is a no-op");
  assert.deepEqual(await purgePages(ws, []), { purged: 0, attachments: 0, kept: 0 });
});
test("D-3: malformed input is a 400, not a 500 (ZodError and PostgreSQL 22P02 mapped centrally)", async () => {
  let z1: unknown; try { uuid.parse("not-a-uuid"); } catch (e) { z1 = e; } assert.ok(z1 instanceof z.ZodError);
  const mapped = clientError(z1) as HttpError; assert.ok(mapped instanceof HttpError); assert.deepEqual([mapped.status, mapped.code], [400, "bad_request"]); assert.match(mapped.message, /^Validation: /);
  let z2: unknown; try { uuid.parse(null); } catch (e) { z2 = e; } assert.equal((clientError(z2) as HttpError).status, 400, "a missing id too");
  let pg: unknown; try { await db.select().from(schema.pages).where(eq(schema.pages.parentId, "36-hyphens-or-anything-else")); } catch (e) { pg = e; }
  assert.ok(pg, "the database refuses the value"); const m = clientError(pg) as HttpError; assert.ok(m instanceof HttpError, "drizzle wraps the PostgreSQL error: the code is read from the cause"); assert.deepEqual([m.status, m.code], [400, "bad_request"]);
  const other = new Error("boom"); assert.equal(clientError(other), other, "anything else stays a 500"); const http = new HttpError(404, "x"); assert.equal(clientError(http), http);
  let fk: unknown; try { await db.insert(schema.tasks).values({ workspaceId: ws, title: "x", pageId: randomUUID() }); } catch (e) { fk = e; } assert.equal(clientError(fk), fk, "a foreign-key violation is not disguised as a validation error");
  assert.equal(optUuid(null), null); assert.equal(optUuid(""), null); assert.throws(() => optUuid("abc")); assert.equal(optDate(null), null); assert.throws(() => optDate("pas une date"), /Invalid date/); assert.equal(optDate("2026-11-19")?.toISOString(), "2026-11-19T00:00:00.000Z");
});
test("D-4: a page cannot be moved under itself or one of its descendants (409 cycle); an unknown parent is refused", async () => {
  const a = await mk(ws, `${PFX} cyc A`); const b = await mk(ws, `${PFX} cyc B`, undefined, { parentId: a.id }); const c = await mk(ws, `${PFX} cyc C`, undefined, { parentId: b.id });
  assert.equal(await code(updatePage(ws, a.id, { parentId: b.id })), "cycle"); assert.equal(await code(updatePage(ws, a.id, { parentId: c.id })), "cycle", "also through a grandchild");
  let e: any; try { await updatePage(ws, a.id, { parentId: c.id }); } catch (x) { e = x; } assert.equal(e.status, 409);
  assert.equal(await code(updatePage(ws, a.id, { parentId: a.id })), "status-400"); assert.equal(await code(updatePage(ws, a.id, { parentId: randomUUID() })), "bad_parent");
  assert.equal((await getPage(ws, a.id)).parentId, null, "nothing was written");
  const d = await mk(ws, `${PFX} cyc D`); assert.equal((await updatePage(ws, c.id, { parentId: d.id })).parentId, d.id, "an ordinary move still works"); assert.equal((await updatePage(ws, c.id, { parentId: null })).parentId, null);
  assert.equal((await updatePage(ws, b.id, { parentId: a.id, pinned: true })).parentId, a.id, "re-sending the current parent is not checked again");
});
test("D-4: the recursive tree queries end on a cycle already present in the data", async () => {
  const a = await mk(ws, `${PFX} loop A`); const b = await mk(ws, `${PFX} loop B`, undefined, { parentId: a.id }); const c = await mk(ws, `${PFX} loop C`, undefined, { parentId: b.id });
  await db.update(schema.pages).set({ parentId: c.id }).where(eq(schema.pages.id, a.id)); // A → B → C → A, as 2.x allowed
  const timeout = <T>(p: Promise<T>) => Promise.race([p, new Promise<never>((_r, rej) => setTimeout(() => rej(new Error("the query did not end")), 5000))]);
  assert.deepEqual((await timeout(descendants(ws, a.id, true))).sort(), [b.id, c.id].sort(), "each page once, the root excluded");
  assert.ok((await timeout(breadcrumb(ws, a.id))).length <= 21);
  assert.equal(await timeout(softDeletePage(ws, a.id)), 3); await timeout(restorePage(ws, a.id)); await timeout(softDeletePage(ws, a.id)); assert.equal((await timeout(purgePage(ws, a.id))).purged, 3);
});
test("D-9: trashing or restoring an id of nowhere changes nothing and journals nothing", async () => {
  const ghost = randomUUID(); const n = await softDeletePage(ws, ghost); assert.equal(n, 1, "2.x return value kept"); await restorePage(ws, ghost);
  assert.equal((await db.select().from(schema.knowledgeEvents).where(eq(schema.knowledgeEvents.pageId, ghost))).length, 0);
});
test("Range header: single ranges, suffix ranges, unsatisfiable and ignorable forms", () => {
  assert.deepEqual(parseRange("bytes=0-99", 1000), { start: 0, end: 99 }); assert.deepEqual(parseRange("bytes=500-", 1000), { start: 500, end: 999 }); assert.deepEqual(parseRange("bytes=-200", 1000), { start: 800, end: 999 });
  assert.deepEqual(parseRange("bytes=990-5000", 1000), { start: 990, end: 999 }, "the end is clamped"); assert.deepEqual(parseRange("bytes=-5000", 1000), { start: 0, end: 999 }); assert.deepEqual(parseRange("bytes=0-0", 1), { start: 0, end: 0 });
  assert.equal(parseRange("bytes=1000-", 1000), "unsatisfiable"); assert.equal(parseRange("bytes=5-2", 1000), "unsatisfiable"); assert.equal(parseRange("bytes=-0", 1000), "unsatisfiable"); assert.equal(parseRange("bytes=0-", 0), "unsatisfiable");
  for (const h of [null, undefined, "", "bytes=", "bytes=-", "items=0-5", "bytes=0-5,10-15", "bytes=a-b", "0-5"]) assert.equal(parseRange(h, 1000), null, `ignored: ${h}`);
});
test("D-11: the background block-id back-fill bumps the revision, not the version — and the ids survive a save by a client that never saw them", async () => {
  const legacy: PMNode = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "ancien paragraphe" }] }, { type: "bulletList", attrs: { id: "list000001" }, content: [{ type: "listItem", content: [para("élément", "item0000p1")] }] }] };
  const [row] = await db.insert(schema.pages).values({ workspaceId: ws, title: `${PFX} legacy`, content: legacy as any, plainText: "ancien paragraphe\nélément", wordCount: 3 }).returning(); made.pages.push(row.id);
  await handleIndex({ sourceType: "page", sourceId: row.id, workspaceId: ws }).catch(() => {}); // indexing itself may need a provider; the back-fill happens first
  const filled = await getPage(ws, row.id); const ids = (d: PMNode) => { const out: string[] = []; const w = (n: PMNode) => { if (n.attrs?.id) out.push(n.attrs.id); (n.content ?? []).forEach(w); }; w(d); return out; };
  assert.equal(ids(filled.content as PMNode).length, 4, "paragraph + list + list item + its paragraph"); assert.equal(filled.version, row.version, "the version is not bumped: an open editor sees no conflict"); assert.ok(filled.rev > row.rev, "the revision is: native clients receive the ids");
  // a client that still holds the id-less document saves an edit of the first paragraph with the version it knows
  const mine: PMNode = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "ancien paragraphe" }] }, { type: "bulletList", content: [{ type: "listItem", content: [para("élément")] }] }, para("ajout du client")] };
  const saved = await updatePage(ws, row.id, { content: mine }, { baseVersion: row.version }); assert.equal(saved.version, row.version + 1, "accepted: same version as the one the client holds");
  const after = ids(saved.content as PMNode); const before = ids(filled.content as PMNode);
  assert.deepEqual(after.slice(0, 4), before, "the four blocks get back exactly the ids the server had assigned"); assert.equal(after.length, 5); assert.equal(before.includes(after[4]), false, "the new block gets a new id");
});
