/**
 * Knowledge health (§4.5), daily brief (§4.6), living blocks (§4.7) and semantic zoom levels 2–3 (§4.9): all computed from real data,
 * no model (the brief summary is exercised with an injected fake). Runs against a *_dev database.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, schema } from "../../src/db/index";
import { workspace, mk, doc, made, cleanup, code, para } from "../helpers/next";
import { knowledgeHealth } from "../../src/lib/knowledge/health";
import { buildBrief, summariseBrief, dayBounds } from "../../src/lib/knowledge/brief";
import { runQuery } from "../../src/lib/knowledge/query";
import { outlineOf, firstSentence, zoomLevel1, zoomLevel2, zoomLevel3, zoomSynopsis } from "../../src/lib/pages/zoom";
import { createTask, updateTask } from "../../src/lib/tasks/service";
import { createReference, deleteReference } from "../../src/lib/research/references";
import { createRelation } from "../../src/lib/graph/relations";
import { setPageTags, capture } from "../../src/lib/inbox/service";
import { softDeletePage, getPage, updatePage } from "../../src/lib/pages/service";
import { ensureDatabase, createProperty, createRow } from "../../src/lib/databases/service";
import { API_LEVEL, FEATURES, serverVersion } from "../../src/lib/meta";
import type { PMNode } from "../../src/lib/editor/text";

let ws: string; const PFX = "nx-know ·";
before(async () => { ws = await workspace(); }); after(async () => { made.tags.push("nx-know-tag"); await cleanup(ws, PFX); await db.delete(schema.settings).where(eq(schema.settings.key, `brief.summary:${ws}`)).catch(() => {}); });
const day = 86_400_000;

test("meta: API level 3, version 3.0.0 and the feature list clients gate on", () => {
  assert.equal(API_LEVEL, 3); assert.match(serverVersion(), /^3\.0\.0/);
  for (const f of ["entities", "events", "canvas", "timemachine", "graph-v2", "insights", "health", "brief", "query", "zoom", "tasks-v2", "nodes-v3", "files-range"]) assert.ok((FEATURES as readonly string[]).includes(f), f);
  assert.equal(new Set(FEATURES).size, FEATURES.length);
});
test("knowledge health: orphans, broken links, missing references, duplicates, untitled, inactive projects, open tasks", async () => {
  const target = await mk(ws, `${PFX} H target`, doc(para("cible", "blkTARGET1"))); const trashed = await mk(ws, `${PFX} H trashed`, doc("t")); const ghostPage = randomUUID(), ghostRef = randomUUID(), ghostFile = randomUUID();
  const ref = await createReference(ws, { title: `${PFX} H ref` }); made.references.push(ref.id); const deadRef = await createReference(ws, { title: `${PFX} H dead ref` }); made.references.push(deadRef.id); await deleteReference(ws, deadRef.id);
  const mention = (id: string): PMNode => ({ type: "mention", attrs: { id, label: "x" } });
  const src = await mk(ws, `${PFX} H source`, doc(
    { type: "paragraph", content: [mention(target.id), mention(trashed.id), mention(ghostPage), { type: "citation", attrs: { refId: ref.id, label: "ok" } }, { type: "citation", attrs: { refId: ghostRef, label: "?" } }, { type: "citation", attrs: { refId: deadRef.id, label: "x" } }] },
    { type: "blockRef", attrs: { pageId: target.id, blockId: "blkTARGET1" } }, { type: "blockRef", attrs: { pageId: target.id, blockId: "blkMISSING" } }, { type: "pdf", attrs: { attachmentId: ghostFile, name: "x.pdf" } }));
  await softDeletePage(ws, trashed.id);
  const orphan = await mk(ws, `${PFX} H orphan`, doc("seul")); const untitled = await mk(ws, "Untitled"); made.pages.push(untitled.id);
  const twinA = await mk(ws, `${PFX} H twin`, doc("un")); const twinB = await mk(ws, `${PFX} H twin`, doc("deux"));
  const stale = await mk(ws, `${PFX} H old project`, undefined, { section: "projects" }); const staleKid = await mk(ws, `${PFX} H old kid`, doc("k"), { parentId: stale.id, section: "projects" });
  await db.update(schema.pages).set({ updatedAt: new Date(Date.now() - 45 * day) }).where(eq(schema.pages.id, stale.id)); await db.update(schema.pages).set({ updatedAt: new Date(Date.now() - 40 * day) }).where(eq(schema.pages.id, staleKid.id));
  const active = await mk(ws, `${PFX} H active project`, undefined, { section: "projects" }); await db.update(schema.pages).set({ updatedAt: new Date(Date.now() - 45 * day) }).where(eq(schema.pages.id, active.id)); await mk(ws, `${PFX} H fresh kid`, doc("k"), { parentId: active.id, section: "projects" });
  const late = await createTask(ws, { title: `${PFX} H overdue`, dueAt: new Date(Date.now() - 2 * day) }); const nodate = await createTask(ws, { title: `${PFX} H no date` }); const done = await createTask(ws, { title: `${PFX} H done`, status: "done" }); made.tasks.push(late.task.id, nodate.task.id, done.task.id);
  const h = await knowledgeHealth(ws);
  assert.ok(h.orphans.ids.includes(orphan.id)); assert.equal(h.orphans.ids.includes(src.id), false, "a page with links is not an orphan"); assert.equal(h.orphans.count >= h.orphans.items.length, true);
  const mine = h.brokenLinks.items.filter((b) => b.pageId === src.id).map((b) => [b.kind, b.targetId, b.reason, b.targetBlockId ?? null]);
  assert.deepEqual(mine.sort(), [["block", target.id, "missing", "blkMISSING"], ["file", ghostFile, "missing", null], ["page", ghostPage, "missing", null], ["page", trashed.id, "trashed", null]].sort(), "missing page, trashed page, missing block, missing file — and not the valid ones");
  assert.ok(h.brokenLinks.ids.includes(src.id)); assert.ok(h.brokenLinks.items.find((b) => b.pageId === src.id)!.blockId, "the block that holds the broken link is given");
  assert.deepEqual(h.missingReferences.items.filter((m) => m.pageId === src.id).map((m) => [m.refId, m.reason]).sort(), [[deadRef.id, "deleted"], [ghostRef, "missing"]].sort());
  assert.ok(h.potentialDuplicates.items.some((d) => d.reason === "title" && d.pageIds.includes(twinA.id) && d.pageIds.includes(twinB.id)));
  assert.ok(h.untitled.ids.includes(untitled.id)); assert.equal(h.untitled.items.find((u) => u.id === untitled.id)!.empty, true);
  const ip = h.inactiveProjects.items.find((p) => p.id === stale.id)!; assert.ok(ip, "a project whose whole subtree is idle"); assert.equal(ip.idleDays, 40, "idle since the latest change in the subtree"); assert.equal(h.inactiveProjects.ids.includes(active.id), false, "a recent sub-page keeps the project active"); assert.equal(h.inactiveProjects.ids.includes(staleKid.id), false, "only top-level projects");
  assert.equal((await knowledgeHealth(ws, { inactiveDays: 60 })).inactiveProjects.ids.includes(stale.id), false);
  assert.ok(h.openTasks.ids.includes(late.task.id) && h.openTasks.ids.includes(nodate.task.id)); assert.equal(h.openTasks.ids.includes(done.task.id), false); assert.ok(h.openTasks.overdue >= 1 && h.openTasks.withoutDate >= 1); assert.equal(h.openTasks.items.find((t) => t.id === late.task.id)!.overdue, true);
  assert.ok(h.score.issues >= 9); assert.equal(typeof h.computedAt, "string");
});
test("day bounds follow the time zone, including across a daylight-saving change", () => {
  const b = dayBounds(new Date("2026-11-19T03:30:00Z"), "America/Toronto"); assert.deepEqual([b.date, b.start.toISOString(), b.end.toISOString()], ["2026-11-18", "2026-11-18T05:00:00.000Z", "2026-11-19T05:00:00.000Z"]);
  const dst = dayBounds(new Date("2026-11-01T12:00:00Z"), "America/Toronto"); assert.deepEqual([dst.start.toISOString(), dst.end.toISOString()], ["2026-11-01T04:00:00.000Z", "2026-11-02T05:00:00.000Z"], "a 25-hour day");
  assert.equal(dayBounds(new Date("2026-06-15T10:00:00Z"), "UTC").start.toISOString(), "2026-06-15T00:00:00.000Z"); assert.throws(() => dayBounds(new Date(), "Mars/Olympus"), /Unknown time zone/);
});
test("brief: recent notes, active projects, tasks by due date, captures, suggestions, pages to revisit — and no model in GET", async () => {
  const now = new Date(); const tz = "America/Toronto"; const d = dayBounds(now, tz);
  const proj = await mk(ws, `${PFX} B project`, undefined, { section: "projects" }); const kid = await mk(ws, `${PFX} B kid`, doc("k"), { parentId: proj.id, section: "projects" });
  const over = await createTask(ws, { title: `${PFX} B overdue`, dueAt: new Date(d.start.getTime() - 3600_000), pageId: kid.id }); const today = await createTask(ws, { title: `${PFX} B today`, dueAt: new Date(d.start.getTime() + 3600_000) }); const soon = await createTask(ws, { title: `${PFX} B soon`, dueAt: new Date(d.end.getTime() + 2 * day) }); const far = await createTask(ws, { title: `${PFX} B far`, dueAt: new Date(d.end.getTime() + 30 * day) });
  made.tasks.push(over.task.id, today.task.id, soon.task.id, far.task.id);
  const cap = await capture(ws, { kind: "note", text: `${PFX} B capture` }); made.pages.push(cap.id);
  const a = await mk(ws, `${PFX} B hub`, doc("a")); const b = await mk(ws, `${PFX} B leaf`, doc("b")); await createRelation(ws, { fromId: b.id, toId: a.id, relType: "related" });
  await db.update(schema.pages).set({ updatedAt: new Date(now.getTime() - 60 * day), lastOpenedAt: null }).where(eq(schema.pages.id, a.id));
  const [sug] = await db.insert(schema.knowledgeEdges).values({ workspaceId: ws, fromId: kid.id, toId: a.id, kind: "ai_suggested", origin: "ai", status: "suggested", confidence: 0.99, rationale: `${PFX} same topic`, model: "m" }).returning();
  const brief = await buildBrief(ws, { tz, now });
  assert.deepEqual([brief.date, brief.timeZone], [d.date, tz]); assert.ok(brief.recentNotes.length <= 8 && brief.recentNotes.some((n) => n.id === b.id)); assert.equal(brief.recentNotes.some((n) => n.id === cap.id), false, "a capture waiting in the inbox is not a recent note");
  const ap = brief.activeProjects.find((p) => p.id === proj.id)!; assert.ok(ap); assert.deepEqual([ap.pages, ap.openTasks], [2, 1]);
  assert.ok(brief.tasks.overdue.some((t) => t.id === over.task.id)); assert.ok(brief.tasks.dueToday.some((t) => t.id === today.task.id)); assert.ok(brief.tasks.dueSoon.some((t) => t.id === soon.task.id));
  for (const g of [brief.tasks.overdue, brief.tasks.dueToday, brief.tasks.dueSoon]) assert.equal(g.some((t) => t.id === far.task.id), false, "a task due in a month is not in the brief");
  assert.equal(brief.tasks.overdue.find((t) => t.id === over.task.id)!.pageTitle, `${PFX} B kid`);
  assert.ok(brief.unfiledCaptures.count >= 1 && brief.unfiledCaptures.items.some((c) => c.id === cap.id));
  const s = brief.linkSuggestions.items.find((x) => x.id === sug.id)!; assert.ok(s, "pending suggestion listed"); assert.equal(s.ai, true, "marked as AI"); assert.ok(brief.linkSuggestions.count >= 1);
  assert.ok(brief.toRevisit.some((p) => p.id === a.id), "connected, untouched for 30 days"); assert.equal(brief.toRevisit.some((p) => p.id === b.id), false);
  await updateTask(ws, over.task.id, { status: "done" }); assert.equal((await buildBrief(ws, { tz, now })).tasks.overdue.some((t) => t.id === over.task.id), false);
  assert.equal(await code(buildBrief(ws, { tz: "Nowhere/Land" })), "bad_request");
  // the AI summary exists only after an explicit request, is produced through the model seam, and is marked
  await db.delete(schema.settings).where(eq(schema.settings.key, `brief.summary:${ws}`)); assert.equal((await buildBrief(ws, { tz, now })).aiSummary, null);
  let prompt = ""; const sum = await summariseBrief(ws, { tz, model: async (i) => { prompt = i.user; return { text: "  Résumé factice.  ", model: "fake-brief-1", costUsd: 0 }; } });
  assert.deepEqual([sum.ai, sum.text, sum.model], [true, "Résumé factice.", "fake-brief-1"]); assert.match(prompt, /<brief>/); assert.match(prompt, new RegExp(`${PFX} B today`)); assert.doesNotMatch(prompt, /"type":"doc"/, "titles and counts only, never the note contents");
  const withSum = (await buildBrief(ws, { tz, now })).aiSummary!; assert.deepEqual([withSum.ai, withSum.text, withSum.model], [true, "Résumé factice.", "fake-brief-1"]);
  await assert.rejects(summariseBrief(ws, { tz, model: async () => ({ text: "   ", model: "m" }) }), /empty summary/);
});
test("living blocks: tasks, pages, database, references and backlinks through one query shape", async () => {
  const p = await mk(ws, `${PFX} Q page`, doc("contenu recherché xyzzy"), { section: "documents" }); const other = await mk(ws, `${PFX} Q other`, doc("autre")); await setPageTags(ws, p.id, ["nx-know-tag"]);
  const t1 = await createTask(ws, { title: `${PFX} Q t1`, pageId: p.id, dueAt: "2026-12-01", priority: "high" }); const t2 = await createTask(ws, { title: `${PFX} Q t2`, pageId: other.id }); const t3 = await createTask(ws, { title: `${PFX} Q t3 done`, pageId: p.id, status: "done" }); made.tasks.push(t1.task.id, t2.task.id, t3.task.id);
  const ids = (a: { rows: { id: string }[] }) => a.rows.map((r) => r.id);
  let a = await runQuery(ws, { source: "tasks", filter: { text: `${PFX} Q` } }); assert.deepEqual(ids(a).sort(), [t1.task.id, t2.task.id].sort(), "open tasks by default"); assert.deepEqual(Object.keys(a), ["source", "columns", "rows", "total", "limit", "table", "resolvedAt"]); assert.equal(a.limit, 25); assert.equal(a.total, 2);
  assert.deepEqual(a.columns.map((c) => c.key), ["title", "status", "priority", "dueAt", "pageTitle", "project"]); assert.deepEqual(a.table.columns, ["Tâche", "État", "Priorité", "Échéance", "Page", "Projet"]);
  const row = a.rows.find((r) => r.id === t1.task.id)!; assert.deepEqual([row.pageId, row.pageTitle, row.priority, row.dueAt], [p.id, `${PFX} Q page`, "high", "2026-12-01T12:00:00.000Z"]); assert.deepEqual(a.table.rows.find((r) => r[0] === `${PFX} Q t1`), [`${PFX} Q t1`, "todo", "high", "2026-12-01T12:00:00.000Z", `${PFX} Q page`, null]);
  assert.deepEqual(ids(await runQuery(ws, { source: "tasks", filter: { text: `${PFX} Q`, status: "done" } })), [t3.task.id]); assert.equal((await runQuery(ws, { source: "tasks", filter: { text: `${PFX} Q`, status: "all" } })).total, 3);
  assert.deepEqual(ids(await runQuery(ws, { source: "tasks", filter: { tag: "#NX-know-tag" } })), [t1.task.id], "tasks of the pages carrying a tag"); assert.deepEqual(ids(await runQuery(ws, { source: "tasks", filter: { parentId: other.id } })), [t2.task.id]);
  assert.deepEqual(ids(await runQuery(ws, { source: "tasks", filter: { text: `${PFX} Q`, dueBefore: "2026-12-02", dueAfter: "2026-11-30" } })), [t1.task.id]); assert.deepEqual(ids(await runQuery(ws, { source: "tasks", filter: { section: "documents", text: `${PFX} Q` } })), [t1.task.id]);
  assert.equal(await code(runQuery(ws, { source: "tasks", filter: { status: "bogus" } })), "bad_request"); assert.equal(await code(runQuery(ws, { source: "tasks", filter: { dueBefore: "hier" } })), "bad_request");
  const lim = await runQuery(ws, { source: "tasks", filter: { text: `${PFX} Q`, status: "all" }, limit: 1 }); assert.equal(lim.rows.length, 1); assert.equal(lim.total, 3, "total counts beyond the limit");
  a = await runQuery(ws, { source: "pages", filter: { text: "xyzzy" } }); assert.deepEqual(ids(a), [p.id]); assert.deepEqual(a.rows[0].tags, ["nx-know-tag"]); assert.equal(a.rows[0].section, "documents");
  assert.deepEqual(ids(await runQuery(ws, { source: "pages", filter: { tag: "nx-know-tag" } })), [p.id]); assert.equal(ids(await runQuery(ws, { source: "pages", filter: { text: "100%_literal" } })).length, 0, "LIKE wildcards in the text are escaped");
  // database: goes through the database engine (view, formula, select options resolved to their names)
  const host = await mk(ws, `${PFX} Q db`, undefined, { type: "database", section: "databases" }); const d = await ensureDatabase(ws, host.id);
  const num = await createProperty(ws, d.id, { name: "Score", type: "number" }); const sel = await createProperty(ws, d.id, { name: "État", type: "select", config: { options: [{ id: "o1", name: "Lu", color: "green" }] } }); const fx = await createProperty(ws, d.id, { name: "Double", type: "formula", config: { expression: 'prop("Score") * 2' } });
  const r1 = await createRow(ws, d.id, { title: `${PFX} Q row A`, values: { [num.id]: 21, [sel.id]: "o1" } }); const r2 = await createRow(ws, d.id, { title: `${PFX} Q row B`, values: { [num.id]: 1 } }); made.pages.push(r1.pageId, r2.pageId);
  const q = await runQuery(ws, { source: "database", databaseId: host.id }) as any; assert.equal(q.total, 2); assert.equal(q.databaseId, d.id); assert.deepEqual(q.columns.map((c: any) => [c.label, c.type]), [["Name", "page"], ["Score", "number"], ["État", "select"], ["Double", "text"]]);
  const ra = q.rows.find((r: any) => r.id === r1.id); assert.deepEqual([ra.title, ra[num.id], ra[sel.id], ra[fx.id], ra.pageId], [`${PFX} Q row A`, 21, "Lu", 42, r1.pageId]); assert.deepEqual(q.table.rows.find((r: any[]) => r[0] === `${PFX} Q row A`), [`${PFX} Q row A`, 21, "Lu", 42]);
  assert.equal((await runQuery(ws, { source: "database", databaseId: d.id, filter: { text: "row B" } })).total, 1); assert.equal(await code(runQuery(ws, { source: "database" })), "bad_request"); assert.equal(await code(runQuery(ws, { source: "database", databaseId: d.id, viewId: randomUUID() })), "not_found");
  const ref = await createReference(ws, { title: `${PFX} Q reference`, authors: ["Doe, Jane"], year: 2019, pageId: p.id }); made.references.push(ref.id);
  a = await runQuery(ws, { source: "references", filter: { text: `${PFX} Q reference` } }); assert.deepEqual(ids(a), [ref.id]); assert.deepEqual([a.rows[0].year, a.rows[0].pageId, a.rows[0].citeKey], [2019, p.id, ref.citeKey]); assert.deepEqual(ids(await runQuery(ws, { source: "references", filter: { parentId: p.id } })), [ref.id]);
  await updatePage(ws, other.id, { content: doc({ type: "blockRef", attrs: { pageId: p.id, blockId: null } }) });
  a = await runQuery(ws, { source: "backlinks", pageId: p.id }); assert.deepEqual(ids(a), [other.id]); assert.deepEqual(a.rows[0].via, ["link"]); assert.equal(await code(runQuery(ws, { source: "backlinks" })), "bad_request");
});
test("semantic zoom: level 3 is the document, level 2 the outline without any model, level 1 is a clear seam", async () => {
  assert.equal(firstSentence("Une phrase. Puis une autre."), "Une phrase."); assert.equal(firstSentence("Vraiment ? Oui."), "Vraiment ?"); assert.equal(firstSentence("v1.2 est sortie hier. Suite"), "v1.2 est sortie hier."); assert.equal(firstSentence("  sans   ponctuation  "), "sans ponctuation"); assert.equal(firstSentence(""), "");
  const long = firstSentence("mot ".repeat(200)); assert.ok(long.length <= 241 && long.endsWith("…"));
  const h = (level: number, text: string, id: string): PMNode => ({ type: "heading", attrs: { level, id }, content: [{ type: "text", text }] });
  const content = doc(para("Préambule du document. Deuxième phrase.", "pre0000001"), h(1, "Introduction", "h100000001"), para("Le sujet est posé ici. Détails ensuite.", "p100000001"), para("Encore du texte."), h(2, "Méthode", "h200000001"),
    { type: "bulletList", content: [{ type: "listItem", content: [para("Premier point de la liste.")] }, { type: "listItem", content: [para("Second point.")] }] }, h(2, "Vide", "h300000001"), h(1, "Annexe", "h400000001"), { type: "audio", attrs: { title: "Mémo", transcript: [{ t: 0, text: "Bonjour tout le monde. Suite." }] } });
  assert.deepEqual(outlineOf(content).map((s) => [s.level, s.heading, s.firstSentence, s.blockId, s.blocks]), [
    [0, null, "Préambule du document.", "pre0000001", 1], [1, "Introduction", "Le sujet est posé ici.", "h100000001", 2], [2, "Méthode", "Premier point de la liste.", "h200000001", 1], [2, "Vide", "", "h300000001", 0], [1, "Annexe", "Audio: Mémo", "h400000001", 1]]);
  assert.equal(outlineOf(content)[1].words, 10); assert.deepEqual(outlineOf({ type: "doc", content: [] }), []); assert.deepEqual(outlineOf(null), []);
  const p = await mk(ws, `${PFX} Z page`, content); const stored = await getPage(ws, p.id);
  const z2 = zoomLevel2(stored); assert.deepEqual([z2.level, z2.pageId, z2.title, z2.version, z2.ai, z2.sections.length], [2, p.id, `${PFX} Z page`, 1, false, 5]);
  const z3 = zoomLevel3(stored); assert.deepEqual([z3.level, z3.ai], [3, false]); assert.deepEqual(z3.content, stored.content);
  let e: any; try { await zoomLevel1(ws, stored); } catch (x) { e = x; } assert.deepEqual([e.status, e.code], [501, "not_implemented"]);
  zoomSynopsis.provider = async (_w, page) => ({ level: 1, pageId: page.id, title: page.title, version: page.version, ai: true, model: "fake", generatedAt: new Date().toISOString(), cached: false, synopsis: "…" });
  try { const z1 = await zoomLevel1(ws, stored); assert.deepEqual([z1.level, z1.ai, z1.model], [1, true, "fake"]); } finally { zoomSynopsis.provider = null; }
});
