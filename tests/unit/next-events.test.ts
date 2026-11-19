/**
 * Events journal and time machine (SPEC §3.2, §4.4): every listed event is written by the mutation that causes it, in its transaction;
 * `page.edited` is coalesced; a refused write leaves no event; the journal is paged by a stable cursor; the state at a date is rebuilt
 * from the history only. Runs against a *_dev database.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "../../src/db/index";
import { workspace, mk, doc, made, cleanup, code, kinds, eventsOf, para } from "../helpers/next";
import { createPage, updatePage, softDeletePage, restorePage, purgePage, snapshot, getPage } from "../../src/lib/pages/service";
import { setPageTags, capture, triage } from "../../src/lib/inbox/service";
import { createReference } from "../../src/lib/research/references";
import { EVENT_KINDS, listEvents, recordCoalesced, recordEvent, COALESCE_MS } from "../../src/lib/events/service";
import { withActor, currentActor } from "../../src/lib/events/context";
import { stateAt } from "../../src/lib/timemachine/service";
import { createRelation, deleteRelation } from "../../src/lib/graph/relations";
import type { PMNode } from "../../src/lib/editor/text";

let ws: string; const PFX = "nx-evt ·";
before(async () => { ws = await workspace(); }); after(async () => { made.tags.push("nx-evt-a", "nx-evt-b"); await cleanup(ws, PFX); });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("the catalogue of event kinds is the one of the specification", () => {
  assert.equal(EVENT_KINDS.length, 30); assert.equal(new Set(EVENT_KINDS).size, 30); assert.equal(COALESCE_MS, 600_000);
  for (const k of ["page.created", "page.renamed", "page.edited", "page.moved", "page.archived", "page.unarchived", "page.trashed", "page.restored", "page.purged", "page.version", "tag.added", "tag.removed", "link.added", "link.removed", "relation.created", "relation.accepted", "relation.rejected", "relation.removed", "reference.added", "reference.linked", "attachment.added", "task.created", "task.completed", "task.reopened", "capture.created", "capture.filed", "ai.applied", "agent.applied", "decision.recorded", "canvas.edited"]) assert.ok((EVENT_KINDS as readonly string[]).includes(k), k);
});
test("the life of a page is journaled, each event once, by the mutation itself", async () => {
  const parent = await mk(ws, `${PFX} parent`); const p = await mk(ws, `${PFX} life`, doc("v1"));
  assert.deepEqual(await kinds(p.id), ["page.created"]); assert.equal((await eventsOf(p.id))[0].data.backfilled, undefined, "a real event is never flagged backfilled");
  let v = p.version;
  v = (await updatePage(ws, p.id, { title: `${PFX} life renamed` }, { baseVersion: v })).version;
  v = (await updatePage(ws, p.id, { content: doc("v2") }, { baseVersion: v })).version;
  v = (await updatePage(ws, p.id, { content: doc("v3") }, { baseVersion: v })).version;
  await updatePage(ws, p.id, { content: doc("v3") }); // same content again: not an edit
  await updatePage(ws, p.id, { parentId: parent.id }); await updatePage(ws, p.id, { parentId: parent.id }); // second time: nothing moved
  await updatePage(ws, p.id, { archived: true }); await updatePage(ws, p.id, { archived: false }); await updatePage(ws, p.id, { pinned: true });
  await setPageTags(ws, p.id, ["nx-evt-a", "nx-evt-b"]); await setPageTags(ws, p.id, ["nx-evt-a", "nx-evt-b"]); await setPageTags(ws, p.id, ["nx-evt-b"]);
  await softDeletePage(ws, p.id); await restorePage(ws, p.id);
  const ks = await kinds(p.id); const n = (k: string) => ks.filter((x) => x === k).length;
  assert.equal(n("page.renamed"), 1); assert.equal(n("page.edited"), 1, "three saves in a row are one coalesced page.edited"); assert.equal(n("page.moved"), 1);
  assert.equal(n("page.archived"), 1); assert.equal(n("page.unarchived"), 1); assert.equal(n("tag.added"), 2); assert.equal(n("tag.removed"), 1); assert.equal(n("page.trashed"), 1); assert.equal(n("page.restored"), 1);
  assert.ok(n("page.version") >= 1, "the first change snapshots the previous state");
  const ev = await eventsOf(p.id); const renamed = ev.find((e) => e.kind === "page.renamed")!; assert.deepEqual(renamed.data, { from: `${PFX} life`, to: `${PFX} life renamed` });
  assert.deepEqual(ev.find((e) => e.kind === "page.moved")!.data, { from: { parentId: null, section: "notes" }, to: { parentId: parent.id, section: "notes" } });
  await softDeletePage(ws, p.id); await purgePage(ws, p.id);
  assert.equal((await kinds(p.id)).filter((k) => k === "page.purged").length, 1, "the purge is journaled and the journal survives the page");
});
test("page.edited is coalesced per page over 10 minutes, and concurrent saves cannot both pass", async () => {
  const p = await mk(ws, `${PFX} coalesce`, doc("a")); const q = await mk(ws, `${PFX} coalesce other`, doc("a"));
  const base = { workspaceId: ws, kind: "page.edited" as const, pageId: p.id, summary: `${PFX} coalesce` };
  const r = await Promise.all(Array.from({ length: 8 }, () => recordCoalesced(base))); assert.equal(r.filter(Boolean).length, 1, "exactly one of 8 simultaneous writers records the event");
  assert.equal(await recordCoalesced({ ...base, pageId: q.id }), true, "another page has its own window");
  // an event older than the window no longer blocks a new one
  await db.update(schema.knowledgeEvents).set({ at: new Date(Date.now() - COALESCE_MS - 1000) }).where(and(eq(schema.knowledgeEvents.pageId, p.id), eq(schema.knowledgeEvents.kind, "page.edited")));
  assert.equal(await recordCoalesced(base), true); assert.equal(await recordCoalesced(base), false);
});
test("a refused save and a rolled-back transaction leave no event", async () => {
  const p = await mk(ws, `${PFX} refused`, doc("a")); await updatePage(ws, p.id, { title: `${PFX} refused v2` }, { baseVersion: p.version });
  const before = (await kinds(p.id)).length;
  assert.equal(await code(updatePage(ws, p.id, { title: `${PFX} refused v3` }, { baseVersion: p.version })), "conflict"); assert.equal((await kinds(p.id)).length, before);
  await assert.rejects(db.transaction(async (tx) => { await recordEvent(tx, { workspaceId: ws, kind: "page.renamed", pageId: p.id, summary: `${PFX} ghost` }); throw new Error("rollback"); }));
  assert.equal((await kinds(p.id)).length, before, "the event went away with the transaction");
});
test("links, citations, AI blocks and decisions found in a saved document become events", async () => {
  const target = await mk(ws, `${PFX} target`, doc("t")); const ref = await createReference(ws, { title: `${PFX} paper`, authors: ["Doe, J."], year: 2020 }); made.references.push(ref.id);
  const p = await mk(ws, `${PFX} doc`, doc("start"));
  const content: PMNode = doc(
    { type: "paragraph", content: [{ type: "text", text: "voir " }, { type: "mention", attrs: { id: target.id, label: "target" } }, { type: "citation", attrs: { refId: ref.id, label: "Doe 2020" } }, { type: "citation", attrs: { refId: randomUUID(), label: "Fantôme" } }] },
    { type: "aiBlock", attrs: { model: "model-x", action: "synthesis" }, content: [para("synthèse")] },
    { type: "callout", attrs: { kind: "decision" }, content: [para("On garde la version B.")] }, { type: "callout", attrs: { kind: "note" }, content: [para("note")] });
  const saved = await updatePage(ws, p.id, { content }, { baseVersion: p.version });
  let ev = await eventsOf(p.id); const of = (k: string) => ev.filter((e) => e.kind === k);
  assert.equal(of("link.added").length, 1); assert.equal(of("link.added")[0].data.toId, target.id); assert.equal(of("link.added")[0].data.toTitle, `${PFX} target`); assert.match(String(of("link.added")[0].data.sourceBlockId), /^[\w-]{10}$/);
  assert.equal(of("reference.linked").length, 1, "only the citation of a reference that exists"); assert.equal(of("reference.linked")[0].data.referenceId, ref.id); assert.equal(of("reference.linked")[0].data.via, "citation");
  assert.equal(of("ai.applied").length, 1); assert.equal(of("ai.applied")[0].data.model, "model-x"); assert.equal(of("decision.recorded").length, 1); assert.equal(of("decision.recorded")[0].summary, "On garde la version B.");
  const K = schema.knowledgeEdges; const edges = await db.select().from(K).where(eq(K.fromId, p.id));
  assert.deepEqual(edges.map((e) => `${e.kind}/${e.relType}/${e.targetKind}/${e.origin}`).sort(), ["cites/cites/reference/system", "link/related/page/system"]);
  assert.ok(edges.every((e) => e.sourceBlockId && e.rev > 0));
  // saving the same document again adds nothing; removing the link and the citation is journaled and removes the edges
  const again = await updatePage(ws, p.id, { content: (await getPage(ws, p.id)).content as PMNode, title: `${PFX} doc2` }, { baseVersion: saved.version });
  assert.equal((await eventsOf(p.id)).filter((e) => ["link.added", "reference.linked", "ai.applied", "decision.recorded"].includes(e.kind)).length, 4);
  await updatePage(ws, p.id, { content: doc("plus rien") }, { baseVersion: again.version }); ev = await eventsOf(p.id);
  assert.equal(of("link.removed").length, 1); assert.equal((await db.select().from(K).where(eq(K.fromId, p.id))).length, 0);
  assert.ok((await kinds(ref.pageId ?? p.id)).length > 0); const refEvents = await db.select().from(schema.knowledgeEvents).where(and(eq(schema.knowledgeEvents.entityId, ref.id), eq(schema.knowledgeEvents.kind, "reference.added"))); assert.equal(refEvents.length, 1);
});
test("captures, triage and the acting party are journaled", async () => {
  const c = await capture(ws, { kind: "note", text: `${PFX} capture` }); made.pages.push(c.id);
  assert.deepEqual(await kinds(c.id), ["page.created", "capture.created"]);
  await triage(ws, c.id, { action: "keep", section: "documents" }); const filed = (await eventsOf(c.id)).find((e) => e.kind === "capture.filed")!; assert.equal(filed.data.action, "keep"); assert.equal(filed.data.section, "documents");
  assert.deepEqual(currentActor(), { actor: "system", device: null }, "outside a request the actor is `system`");
  const p = await withActor({ actor: "agent", device: "worker" }, () => createPage(ws, { title: `${PFX} by agent` })); made.pages.push(p.id);
  const e = (await eventsOf(p.id))[0]; assert.equal(e.actor, "agent"); assert.equal(e.device, "worker");
  const u = await withActor({ actor: "user", device: "SP Notes · Mac" }, () => withActor({ actor: "ai" }, () => createPage(ws, { title: `${PFX} nested` }))); made.pages.push(u.id);
  const n = (await eventsOf(u.id))[0]; assert.equal(n.actor, "ai"); assert.equal(n.device, "SP Notes · Mac", "the device is inherited by a nested actor");
});
test("page.version is recorded once per history entry", async () => {
  const p = await mk(ws, `${PFX} versions`, doc("a")); await snapshot(p, "manual"); await snapshot(p, "manual again");
  const ev = (await eventsOf(p.id)).filter((e) => e.kind === "page.version"); assert.equal(ev.length, 1); assert.equal(ev[0].data.version, 1); assert.equal(ev[0].data.reason, "manual"); assert.equal(ev[0].entityKind, "page_version");
});
test("GET /api/events: newest first, stable cursor, filters by page, project, kinds and dates", async () => {
  const root = await mk(ws, `${PFX} project`, undefined, { section: "projects" }); const child = await mk(ws, `${PFX} project child`, doc("c"), { parentId: root.id }); const other = await mk(ws, `${PFX} elsewhere`);
  for (let i = 0; i < 6; i++) await recordEvent(db, { workspaceId: ws, kind: "page.renamed", pageId: child.id, summary: `${PFX} r${i}`, at: new Date(Date.now() - (10 - i) * 1000) });
  const ids = [root.id, child.id]; const all: string[] = []; let cursor: string | null = null; let pages = 0;
  do { const r: Awaited<ReturnType<typeof listEvents>> = await listEvents(ws, { pageIds: ids, limit: 3, cursor }); all.push(...r.events.map((e) => e.id)); cursor = r.nextCursor; pages++; assert.ok(r.events.length <= 3); } while (cursor && pages < 20);
  assert.equal(all.length, 8, "2 creations + 6 renames"); assert.equal(new Set(all).size, 8, "no event twice across pages"); assert.equal(pages, 3);
  const whole = await listEvents(ws, { pageIds: ids, limit: 200 }); assert.deepEqual(whole.events.map((e) => e.id), all, "same order as the paged read"); assert.equal(whole.nextCursor, null);
  for (let i = 1; i < whole.events.length; i++) assert.ok(whole.events[i - 1].at >= whole.events[i].at, "newest first");
  assert.equal(whole.events[0].pageTitle, `${PFX} project child`); assert.ok(whole.events.every((e) => e.pageId !== other.id));
  assert.equal((await listEvents(ws, { pageId: child.id, kinds: ["page.renamed"] })).events.length, 6); assert.equal((await listEvents(ws, { pageId: child.id, kinds: ["page.created"] })).events.length, 1);
  const mid = new Date(Date.now() - 7500); assert.equal((await listEvents(ws, { pageId: child.id, kinds: ["page.renamed"], to: mid })).events.length, 3); assert.equal((await listEvents(ws, { pageId: child.id, kinds: ["page.renamed"], from: mid })).events.length, 3);
  assert.equal(await code(listEvents(ws, { cursor: "not-a-cursor" })), "bad_cursor"); assert.equal((await listEvents(ws, { pageIds: [] })).events.length, 0);
  // a new event arriving while paging does not shift the pages already read
  const first = await listEvents(ws, { pageIds: ids, limit: 4 }); await recordEvent(db, { workspaceId: ws, kind: "page.renamed", pageId: child.id, summary: `${PFX} late` });
  const second = await listEvents(ws, { pageIds: ids, limit: 4, cursor: first.nextCursor }); assert.deepEqual([...first.events, ...second.events].map((e) => e.id), all);
});
test("time machine: the state of a page at a date, with where it comes from", async () => {
  const p = await mk(ws, `${PFX} tm`, doc("état 1")); const t0 = new Date(); await sleep(30);
  const a = await updatePage(ws, p.id, { content: doc("état 2"), title: `${PFX} tm v2` }, { baseVersion: p.version }); await sleep(30); const t1 = new Date(); await sleep(30);
  const b = await updatePage(ws, p.id, { content: doc("état 3") }, { baseVersion: a.version, versionReason: "checkpoint" }); await sleep(30); const t2 = new Date();
  const text = (s: any) => JSON.stringify(s.content);
  const now = (await stateAt(ws, t2, { pageId: p.id })).pages[0]; assert.equal(now.source, "current"); assert.equal(now.exact, true); assert.equal(now.version, b.version); assert.match(text(now), /état 3/); assert.equal(now.changedSince, false);
  const first = (await stateAt(ws, t0, { pageId: p.id })).pages[0]; assert.equal(first.existed, true); assert.equal(first.version, 1); assert.match(text(first), /état 1/); assert.equal(first.title, `${PFX} tm`); assert.equal(first.currentTitle, `${PFX} tm v2`); assert.equal(first.exact, false); assert.ok(["version", "version_after"].includes(first.source)); assert.ok(first.versionId);
  const mid = (await stateAt(ws, t1, { pageId: p.id })).pages[0]; assert.match(text(mid), /état [12]/); assert.equal(mid.changedSince, true);
  const early = (await stateAt(ws, new Date(p.createdAt.getTime() - 60_000), { pageId: p.id })).pages[0]; assert.equal(early.existed, false); assert.equal(early.source, "none"); assert.equal(early.content, undefined);
  assert.equal(await code(stateAt(ws, t0, { pageId: randomUUID() })), "not_found"); assert.equal(await code(stateAt(ws, t0, {})), "bad_request");
});
test("time machine: a project lists its pages, and the relations and references that existed at that date", async () => {
  const root = await mk(ws, `${PFX} tm project`, undefined, { section: "projects" }); const kid = await mk(ws, `${PFX} tm kid`, doc("k"), { parentId: root.id }); const out = await mk(ws, `${PFX} tm outside`, doc("o"));
  const { relation: old } = await createRelation(ws, { fromId: kid.id, toId: out.id, relType: "supports", validTo: new Date(Date.now() + 3600_000) });
  await db.update(schema.knowledgeEdges).set({ createdAt: new Date(Date.now() - 86_400_000), decidedAt: new Date(Date.now() - 86_400_000) }).where(eq(schema.knowledgeEdges.id, old.id));
  const ref = await createReference(ws, { title: `${PFX} tm ref`, pageId: kid.id }); made.references.push(ref.id);
  await sleep(20); const at = new Date(); await sleep(20);
  const { relation: later } = await createRelation(ws, { fromId: root.id, toId: out.id, relType: "extends" }); const late = await mk(ws, `${PFX} tm late kid`, doc("l"), { parentId: root.id });
  const { relation: expired } = await createRelation(ws, { fromId: kid.id, toId: out.id, relType: "contradicts", validTo: new Date(Date.now() - 3 * 86_400_000) });
  await db.update(schema.knowledgeEdges).set({ createdAt: new Date(Date.now() - 5 * 86_400_000), decidedAt: new Date(Date.now() - 5 * 86_400_000) }).where(eq(schema.knowledgeEdges.id, expired.id));
  const s = await stateAt(ws, at, { projectId: root.id });
  assert.deepEqual(s.scope, { projectId: root.id }); assert.deepEqual(s.pages.map((x) => [x.id, x.existed]), [[root.id, true], [kid.id, true], [late.id, false]]); assert.equal(s.pages[0].content, undefined, "no content for a project unless asked");
  assert.deepEqual(s.relations.map((r) => r.id), [old.id], "created by then, accepted by then, valid at that date — not the later one, not the expired one"); assert.equal(s.relations[0].toTitle, `${PFX} tm outside`);
  assert.deepEqual(s.references.map((r) => r.id), [ref.id]);
  assert.equal((await stateAt(ws, at, { projectId: root.id }, { content: true })).pages[1].content !== undefined, true);
  await deleteRelation(ws, old.id); const after = await stateAt(ws, at, { projectId: root.id }); assert.equal(after.relations.length, 0); assert.ok(after.removedSince.some((e) => e.kind === "relation.removed" && (e.data as any).relationId === old.id), "what was removed since is taken from the journal");
  assert.ok(after.journalSince, "the date since which the journal is complete is given"); await db.delete(schema.knowledgeEdges).where(inArray(schema.knowledgeEdges.id, [later.id, expired.id]));
});
