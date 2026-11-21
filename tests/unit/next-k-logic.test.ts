/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : tests/unit/next-k-logic.test.ts
 * Description      : pure logic of the knowledge screens (graph 2.0 filters /
 *                    styles / path / level of detail, constellation projection
 *                    and navigation, timeline grouping, time-machine honesty
 *                    and diff, health rows, semantic-zoom anchor, ask scopes,
 *                    brief labels). No database, no DOM, no network.
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

import { test } from "node:test";
import assert from "node:assert/strict";
import { pca2, spreadOverlaps, kmeans2d, clusterCount } from "../../src/lib/graph/projection";
import * as K from "../../src/lib/client/knowledge";
import type { EdgeV, NodeV } from "../../src/lib/graph/views";

const node = (id: string, kind: NodeV["kind"] = "page"): NodeV => ({ id, entityId: id, kind, title: id, icon: null, section: "notes", createdAt: null, updatedAt: null, databaseId: null, degree: 0, in: 0, out: 0 });
const edge = (id: string, source: string, target: string, x: Partial<EdgeV> = {}): EdgeV => ({ id, source, target, kind: "typed", relType: "related", origin: "user", status: "accepted", confidence: null, rationale: null, note: null, model: null, validFrom: null, validTo: null, sourceBlockId: null, targetBlockId: null, createdAt: null, sub: null, ...x });

test("graph filter: relation types, origin and status; degrees are recomputed; isolated nodes can be dropped", () => {
  const data = { nodes: [node("a"), node("b"), node("c"), node("d")], edges: [edge("1", "a", "b", { relType: "supports" }), edge("2", "b", "c", { relType: "contradicts", origin: "ai", status: "suggested" }), edge("3", "c", "a", { kind: "link", origin: "system" }), edge("4", "a", "c", { kind: "ai_suggested", origin: "ai", status: "suggested" })] };
  assert.equal(K.filterGraph(data, K.DEFAULT_FILTER).edges.length, 4); assert.ok(K.isDefaultFilter(K.DEFAULT_FILTER));
  const onlySupports = K.filterGraph(data, { ...K.DEFAULT_FILTER, relTypes: ["supports"] });
  assert.deepEqual(onlySupports.edges.map((e) => e.id), ["1", "3"], "relType filters typed + AI link suggestions, not document links");
  assert.deepEqual(onlySupports.nodes.map((n) => [n.id, n.degree, n.in, n.out]), [["a", 2, 1, 1], ["b", 1, 1, 0], ["c", 1, 0, 1], ["d", 0, 0, 0]]);
  assert.deepEqual(K.filterGraph(data, { ...K.DEFAULT_FILTER, origins: ["ai"] }).edges.map((e) => e.id), ["2", "4"]);
  assert.deepEqual(K.filterGraph(data, { ...K.DEFAULT_FILTER, statuses: ["accepted"] }).edges.map((e) => e.id), ["1", "3"]);
  assert.deepEqual(K.filterGraph(data, { ...K.DEFAULT_FILTER, kinds: ["link"] }).edges.map((e) => e.id), ["3"]);
  assert.deepEqual(K.filterGraph(data, { ...K.DEFAULT_FILTER, relTypes: [] }, true).nodes.map((n) => n.id), ["a", "c"]);
  assert.equal(K.isDefaultFilter({ ...K.DEFAULT_FILTER, relTypes: [] }), false);
});

test("edge style: suggested = dashed AI with a badge; typed by tone; citations dotted; real ids editable", () => {
  const s = K.edgeStyle(edge("x", "a", "b", { status: "suggested", origin: "ai", relType: "contradicts", confidence: 0.82 }));
  assert.deepEqual([s.tone, Boolean(s.dash), s.ai], ["ai", true, true]); assert.match(s.label, /AI suggestion · contradicts · 82 %/);
  assert.equal(K.edgeStyle(edge("x", "a", "b", { relType: "supports" })).tone, "success"); assert.equal(K.edgeStyle(edge("x", "a", "b", { relType: "contradicts" })).tone, "danger");
  assert.equal(K.edgeStyle(edge("x", "a", "b", { relType: "precedes" })).tone, "warning"); assert.equal(K.edgeStyle(edge("x", "a", "b", { relType: "extends" })).tone, "accent");
  const acceptedAI = K.edgeStyle(edge("x", "a", "b", { origin: "ai", relType: "supports" })); assert.equal(acceptedAI.ai, true, "an accepted AI relation keeps its AI mark"); assert.equal(acceptedAI.dash, null);
  assert.ok(K.edgeStyle(edge("x", "a", "b", { kind: "cites" })).dash); assert.equal(K.edgeStyle(edge("x", "a", "b", { kind: "link" })).dash, null);
  assert.equal(K.isRealEdge({ id: "e-12" }), false); assert.equal(K.isRealEdge({ id: "0f9bf63b-6ddb-458d-8e3a-8071ebeb5eb8" }), true);
  for (const r of K.REL_TYPES) assert.ok(K.REL_LABEL[r], `label for ${r}`);
});

test("shortest path (undirected BFS), view query strings, level of detail and draw-in progress", () => {
  const es = [edge("1", "a", "b"), edge("2", "b", "c"), edge("3", "c", "d"), edge("4", "a", "d"), edge("5", "x", "y")];
  assert.deepEqual(K.shortestPath(es, "a", "c"), { nodes: ["a", "b", "c"], edges: ["1", "2"] });
  assert.deepEqual(K.shortestPath(es, "d", "a"), { nodes: ["d", "a"], edges: ["4"] }); assert.equal(K.shortestPath(es, "a", "x"), null); assert.deepEqual(K.shortestPath(es, "a", "a"), { nodes: ["a"], edges: [] });
  assert.equal(K.viewQuery({ view: "global" }), "view=global"); assert.equal(K.viewQuery({ view: "local" }), null, "local needs a page");
  assert.equal(K.viewQuery({ view: "local", pageId: "p1", depth: 9 }), "view=local&pageId=p1&depth=4");
  assert.equal(K.viewQuery({ view: "timeline", from: "2026-01-01T00:00:00.000Z", suggestions: false, hideOrphans: true }), "view=timeline&from=2026-01-01T00%3A00%3A00.000Z&suggestions=0&hideOrphans=1");
  assert.equal(K.VIEWS.length, 7);
  assert.equal(K.lodFor(50, 80).drawIn, true); assert.equal(K.lodFor(1000, 4000).drawIn, false); assert.equal(K.lodFor(1000, 4000).decorations, true);
  const big = K.lodFor(5000, 20000); assert.deepEqual([big.decorations, big.linkHover, big.warmupTicks], [false, false, 0]);
  assert.equal(K.drawProgress(0, 0, 10), 0); assert.equal(K.drawProgress(1e6, 9, 10), 1); assert.ok(K.drawProgress(210, 0, 10) > 0.5); assert.equal(K.drawProgress(100, 9, 10), 0, "later edges start later");
  assert.equal(K.drawInDuration(1), 420); assert.equal(K.drawInDuration(1000), 420 + 900, "the wave is capped");
});

test("PCA projection: deterministic, centred, separates two groups on the first axis, scaled to [-1, 1]", () => {
  const A = Array.from({ length: 6 }, (_, i) => [10 + i * 0.1, 0.2 * (i % 2), 1, -1 + 0.05 * i]); const B = Array.from({ length: 6 }, (_, i) => [-10 - i * 0.1, 0.2 * (i % 2), 1, 1 - 0.05 * i]);
  const p1 = pca2([...A, ...B]); const p2 = pca2([...A, ...B]); assert.deepEqual(p1, p2, "same input, same map");
  assert.equal(p1.coords.length, 12); const xs = p1.coords.map((c) => c[0]);
  assert.ok(xs.slice(0, 6).every((x) => x > 0.5) && xs.slice(6).every((x) => x < -0.5), "the two groups sit on opposite sides of axis 1");
  assert.ok(Math.max(...p1.coords.flat().map(Math.abs)) <= 1 + 1e-9); assert.ok(p1.explained[0] > 0.95 && p1.explained[0] <= 1); assert.ok(p1.explained[1] >= 0 && p1.explained[0] + p1.explained[1] <= 1 + 1e-6);
  assert.ok(Math.abs(xs.reduce((a, b) => a + b, 0)) < 1e-3, "centred");
  assert.deepEqual(pca2([]), { coords: [], explained: [0, 0] }); assert.deepEqual(pca2([[1, 2, 3]]).coords, [[0, 0]]); assert.deepEqual(pca2([[1, 2], [1, 2], [1, 2]]).coords, [[0, 0], [0, 0], [0, 0]], "no variance, no invented spread");
  const shuffled = pca2([...B, ...A]); shuffled.coords.slice(6).forEach((c, i) => assert.ok(Math.abs(c[0] - xs[i]) < 1e-4, "the position of a note does not depend on the order of the others"));
});

test("overlap spreading and deterministic k-means", () => {
  const spread = spreadOverlaps([[0, 0], [0, 0], [0, 0], [0.5, 0.5]]); assert.deepEqual(spread[0], [0, 0]); assert.deepEqual(spread[3], [0.5, 0.5]);
  assert.notDeepEqual(spread[1], [0, 0]); assert.notDeepEqual(spread[2], spread[1]); assert.ok(Math.hypot(...spread[2]) < 0.05);
  const pts: [number, number][] = [[0, 0], [0.1, 0], [0, 0.1], [5, 5], [5.1, 5], [5, 5.1], [-5, 5], [-5.1, 5]];
  const k = kmeans2d(pts, 3); assert.equal(k.centers.length, 3); assert.deepEqual(k.sizes.slice().sort(), [2, 3, 3]);
  assert.equal(new Set([k.assign[0], k.assign[1], k.assign[2]]).size, 1); assert.equal(new Set([k.assign[3], k.assign[4], k.assign[5]]).size, 1); assert.notEqual(k.assign[0], k.assign[3]);
  assert.deepEqual(kmeans2d(pts, 3), k, "deterministic"); assert.equal(k.assign[0], 0, "clusters are numbered by first appearance");
  assert.deepEqual(kmeans2d([], 3), { assign: [], centers: [], sizes: [], radii: [] }); assert.equal(kmeans2d([[1, 1], [1, 1]], 4).centers.length, 1, "identical points make one cluster");
  assert.deepEqual([clusterCount(0), clusterCount(1), clusterCount(2), clusterCount(50), clusterCount(5000)], [0, 1, 1, 5, 18]);
});

test("constellation: zoom tiers, fit, hit test, keyboard navigation, colour slots", () => {
  assert.deepEqual([K.zoomTier(100, 100), K.zoomTier(200, 100), K.zoomTier(500, 100)], ["clusters", "stars", "titles"]);
  const pts = [{ id: "c", x: 0, y: 0 }, { id: "r", x: 1, y: 0.1 }, { id: "l", x: -1, y: 0 }, { id: "u", x: 0.1, y: 1 }, { id: "d", x: 0, y: -1 }, { id: "far", x: 3, y: 0 }];
  const t = K.fitTransform(pts, 800, 600); const [cx, cy] = K.toScreen(pts[0], t); assert.ok(cx > 0 && cx < 800 && cy > 0 && cy < 600);
  for (const p of pts) { const [x, y] = K.toScreen(p, t); assert.ok(x >= 55 && x <= 745 && y >= 55 && y <= 545, `${p.id} is inside the margins`); }
  assert.ok(K.toScreen(pts[3], t)[1] < cy, "y grows upwards on the map, downwards on the screen");
  assert.equal(K.hitTest(pts, t, cx + 3, cy - 2), "c"); assert.equal(K.hitTest(pts, t, 5, 5), null);
  assert.equal(K.nearestInDirection(pts, "c", "right"), "r"); assert.equal(K.nearestInDirection(pts, "c", "left"), "l"); assert.equal(K.nearestInDirection(pts, "c", "up"), "u"); assert.equal(K.nearestInDirection(pts, "c", "down"), "d");
  assert.equal(K.nearestInDirection(pts, "r", "right"), "far"); assert.equal(K.nearestInDirection(pts, "far", "right"), null, "nothing further right"); assert.equal(K.nearestInDirection(pts.slice(0, 5), null, "right"), "c", "starts from the centre of the cloud"); assert.equal(K.nearestInDirection([], null, "up"), null);
  const slots = K.colourSlots(["p1", "p1", "p2", null, "p3", "p1", "p2"], 2); assert.deepEqual([...slots.entries()], [["p1", 0], ["p2", 1]]);
});

const ev = (id: string, at: string, kind: string, data: Record<string, unknown> = {}): K.KEvent => ({ id, at, kind, pageId: "p", pageTitle: "T", pageIcon: null, entityKind: null, entityId: null, actor: "user", device: null, summary: "T", data });
test("timeline: grouping by day in a zone, duplicates dropped, reconstructed flag, details, query string", () => {
  const events = [ev("1", "2026-11-19T03:30:00.000Z", "page.edited", { wordCount: 12 }), ev("2", "2026-11-18T23:10:00.000Z", "page.renamed", { from: "A", to: "B" }), ev("2", "2026-11-18T23:10:00.000Z", "page.renamed"), ev("3", "2026-11-17T12:00:00.000Z", "page.created", { backfilled: true })];
  const g = K.groupEventsByDay(events, "America/Toronto", new Date("2026-11-19T15:00:00.000Z"));
  assert.deepEqual(g.map((d) => [d.key, d.events.length]), [["2026-11-18", 2], ["2026-11-17", 1]], "03:30Z is still the 18th in Toronto; the duplicate id is dropped");
  assert.match(g[0].label, /^Yesterday · /); assert.match(K.groupEventsByDay([events[0]], "UTC", new Date("2026-11-19T15:00:00.000Z"))[0].label, /^Today · /);
  assert.equal(K.isReconstructed(events[3]), true); assert.equal(K.isReconstructed(events[0]), false);
  assert.equal(K.eventDetail(events[1]), "“A” → “B”"); assert.equal(K.eventDetail(events[0]), "12 words"); assert.equal(K.eventVerb("relation.accepted"), "Relation accepted"); assert.equal(K.eventVerb("x.y"), "x.y");
  assert.equal(K.eventDetail(ev("9", "2026-11-19T00:00:00Z", "relation.created", { fromTitle: "A", toTitle: "B", relType: "supports" })), "A supports B");
  assert.equal(K.eventsQuery({ families: [] }), "limit=50");
  assert.equal(K.eventsQuery({ families: ["task", "links"], pageId: "p1", projectId: "x" }, "CUR", 20), "kinds=link.*%2Crelation.*%2Ctask.*&pageId=p1&limit=20&cursor=CUR", "pageId wins over projectId");
  const all = K.EVENT_FAMILIES.flatMap((f) => f.kinds.split(",")); assert.equal(new Set(all).size, all.length, "no kind in two families");
});

test("time machine: the wording follows source / exact as reported; block diff; scrubber mapping", () => {
  const base = { existed: true, exact: false, versionAt: "2026-11-01T10:00:00.000Z", version: 4, versionId: "v", changedSince: true };
  assert.deepEqual(K.honesty({ ...base, existed: false, source: "none" }).label, "Did not exist yet");
  const cur = K.honesty({ ...base, source: "current", exact: true }); assert.deepEqual([cur.label, cur.tone, cur.restorable], ["Exact", "exact", false]);
  const ver = K.honesty({ ...base, source: "version" }); assert.deepEqual([ver.label, ver.tone, ver.restorable], ["Approximate", "approximate", true]); assert.match(ver.detail, /v4/); assert.match(ver.detail, /at or before/);
  const after = K.honesty({ ...base, source: "version_after" }); assert.equal(after.label, "Approximate"); assert.match(after.detail, /first entry saved after/);
  assert.equal(K.honesty({ ...base, source: "version", exact: true }).label, "Exact", "never downgraded or upgraded: `exact` is the API's");
  assert.deepEqual([K.honesty({ ...base, source: "none" }).label, K.honesty({ ...base, source: "none" }).restorable], ["No record", false]);
  assert.equal(K.honesty({ ...base, source: "version", versionId: null }).restorable, false);
  const d = K.diffBlocks(["a", "b", "c", "d"], ["a", "c", "x", "d"]); assert.deepEqual(d, [{ op: "same", text: "a" }, { op: "del", text: "b" }, { op: "same", text: "c" }, { op: "add", text: "x" }, { op: "same", text: "d" }]);
  assert.deepEqual(K.diffStats(d), { added: 1, removed: 1, same: 3 }); assert.deepEqual(K.diffBlocks([], ["n"]), [{ op: "add", text: "n" }]); assert.deepEqual(K.diffBlocks(["o"], []), [{ op: "del", text: "o" }]);
  assert.deepEqual(K.blockTexts({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: " one  two " }] }, { type: "paragraph" }] }), ["one two"]);
  assert.equal(K.sliderToDate(500, 1000, 0, 1000).getTime(), 500); assert.equal(K.dateToSlider(250, 1000, 0, 1000), 250); assert.equal(K.dateToSlider(-5, 1000, 0, 1000), 0); assert.equal(K.dateToSlider(5, 1000, 10, 10), 1000);
  assert.equal(K.sliderToDate(K.dateToSlider(1_700_000_123_000, 1000, 1_700_000_000_000, 1_700_001_000_000), 1000, 1_700_000_000_000, 1_700_001_000_000).getTime(), 1_700_000_123_000);
});

test("health: categories, issue counts and rows that only navigate", () => {
  const sec = (items: unknown[], extra = {}) => ({ count: items.length, ids: [], items, ...extra });
  const h: K.Health = { computedAt: "", inactiveDays: 30, score: { pages: 10, issues: 5 }, orphans: sec([{ id: "o1", title: "Lonely", icon: "📄", section: "notes", updatedAt: "2026-11-01T00:00:00Z" }]),
    brokenLinks: sec([{ pageId: "p1", title: "Has a dead link", kind: "page", targetId: "gone", blockId: "blk1", reason: "trashed" }, { pageId: "p1", title: "Has a dead link", kind: "file", targetId: "f", blockId: null, reason: "missing" }]),
    missingReferences: sec([{ pageId: "p2", title: "Cites nothing", refId: "r", blockId: "b2", reason: "deleted" }]), potentialDuplicates: sec([{ reason: "title", pageIds: ["a", "b"], title: "Twin" }]),
    untitled: sec([{ id: "u1", section: "notes", updatedAt: "2026-11-02T00:00:00Z", empty: true }]), inactiveProjects: sec([{ id: "pr", title: "Old", icon: null, lastActivityAt: "2026-09-01T00:00:00Z", idleDays: 79 }]),
    openTasks: sec([{ id: "t1", title: "Do it", dueAt: "2026-11-01T00:00:00Z", pageId: null, priority: "high", overdue: true }, { id: "t2", title: "Later", dueAt: null, pageId: "pp", priority: null, overdue: false }], { overdue: 1, withoutDate: 1 }) };
  assert.deepEqual(K.HEALTH_CATEGORIES.map((c) => c.id), ["orphans", "brokenLinks", "missingReferences", "potentialDuplicates", "untitled", "inactiveProjects", "openTasks"]);
  assert.equal(K.issueCount(h, "openTasks"), 1, "open tasks count as issues only when overdue"); assert.equal(K.issueCount(h, "brokenLinks"), 2);
  assert.equal(K.healthRows(h, "orphans")[0].href, "/p/o1"); const bl = K.healthRows(h, "brokenLinks"); assert.equal(bl[0].href, "/p/p1#block-blk1", "to the block that holds the link"); assert.match(bl[0].detail, /in the trash/); assert.equal(bl[1].href, "/p/p1"); assert.notEqual(bl[0].key, bl[1].key);
  assert.equal(K.healthRows(h, "missingReferences")[0].href, "/p/p2#block-b2"); const dup = K.healthRows(h, "potentialDuplicates")[0]; assert.equal(dup.href, null); assert.deepEqual(dup.links?.map((l) => l.href), ["/p/a", "/p/b"]);
  assert.equal(K.healthRows(h, "untitled")[0].href, "/p/u1"); assert.match(K.healthRows(h, "inactiveProjects")[0].detail, /79 days/);
  const tasks = K.healthRows(h, "openTasks"); assert.equal(tasks[0].href, "/tasks"); assert.match(tasks[0].detail, /^Overdue/); assert.equal(tasks[1].href, "/p/pp"); assert.match(tasks[1].detail, /^No date/);
});

test("semantic zoom: levels, shortcuts and the block → outline-section anchor", () => {
  assert.deepEqual(K.ZOOM_LEVELS.map((z) => z.label), ["Synopsis", "Outline", "Full", "Full + connections"]);
  assert.equal(K.zoomShortcut({ altKey: true, metaKey: false, ctrlKey: false, code: "Digit2" }), 2); assert.equal(K.zoomShortcut({ altKey: true, metaKey: true, ctrlKey: false, code: "Digit2" }), null); assert.equal(K.zoomShortcut({ altKey: false, metaKey: false, ctrlKey: false, code: "Digit2" }), null); assert.equal(K.zoomShortcut({ altKey: true, metaKey: false, ctrlKey: false, code: "Digit5" }), null);
  const blocks = ["intro", "p0", "h1", "p1", null, "p2", "h2", "p3"]; const sections = [{ blockId: "intro" }, { blockId: "h1" }, { blockId: "h2" }];
  assert.equal(K.sectionOf(blocks, sections, "p2"), "h1"); assert.equal(K.sectionOf(blocks, sections, "h2"), "h2"); assert.equal(K.sectionOf(blocks, sections, "p3"), "h2"); assert.equal(K.sectionOf(blocks, sections, "p0"), "intro");
  assert.equal(K.sectionOf(blocks, sections, "unknown"), "intro"); assert.equal(K.sectionOf(blocks, sections, null), "intro"); assert.equal(K.sectionOf([], [], "x"), null);
});

test("ask my knowledge: scopes available, request fields, the insufficient-evidence wording, starters", () => {
  assert.equal(K.scopeAvailable("all", {}), true); assert.equal(K.scopeAvailable("page", {}), false); assert.equal(K.scopeAvailable("page", { pageId: "p" }), true); assert.equal(K.scopeAvailable("selection", { pageId: "p", selection: "  " }), false); assert.equal(K.scopeAvailable("project", { pageId: "p" }), true);
  assert.equal(K.scopeApplies("notes", "selection"), true); assert.equal(K.scopeApplies("draft", "selection"), false); assert.equal(K.scopeApplies("general", "page"), false); assert.equal(K.scopeApplies("contradictions", "project"), true);
  assert.deepEqual(K.scopeBody("notes", "all", { pageId: "p" }), {}, "`all` sends the 2.x request unchanged"); assert.deepEqual(K.scopeBody("notes", "page", { pageId: "p" }), { scope: "page" }); assert.deepEqual(K.scopeBody("notes", "page", {}), {}, "unavailable scope falls back to all");
  assert.deepEqual(K.scopeBody("notes", "project", { pageId: "p", projectId: "r" }), { scope: "project", projectId: "r" }); assert.deepEqual(K.scopeBody("general", "page", { pageId: "p" }), {});
  assert.deepEqual(K.scopeBody("notes", "selection", { pageId: "p", selection: "x".repeat(30_000), selectionBlockId: "b" }), { scope: "selection", selection: "x".repeat(20_000), selectionBlockId: "b" });
  assert.equal(K.evidenceNotice("ok", false), null); const none = K.evidenceNotice("none", false, "notes", "page")!; assert.equal(none.title, "Insufficient evidence"); assert.match(none.detail, /this page/); assert.match(none.detail, /No AI provider was called/);
  assert.match(K.evidenceNotice("insufficient", true)!.detail, /withheld/); assert.match(K.evidenceNotice("none", false, "draft")!.detail, /reference documents/);
  const st = K.starterQuestions({}); assert.ok(st.length >= 3 && st.every((s) => s.scope === "all")); const withPage = K.starterQuestions({ pageId: "p", hasSelection: true }); assert.equal(withPage[0].scope, "selection"); assert.ok(withPage.some((s) => s.scope === "page") && withPage.length <= 5);
});

test("brief: due labels by calendar day in the viewer's zone", () => {
  const now = new Date("2026-11-19T15:00:00.000Z");
  assert.equal(K.dueLabel("2026-11-19T22:00:00.000Z", now, "America/Toronto"), "today"); assert.equal(K.dueLabel("2026-11-20T03:00:00.000Z", now, "America/Toronto"), "today", "22:00 local is still today");
  assert.equal(K.dueLabel("2026-11-20T15:00:00.000Z", now, "America/Toronto"), "tomorrow"); assert.equal(K.dueLabel("2026-11-18T15:00:00.000Z", now, "America/Toronto"), "overdue since yesterday");
  assert.equal(K.dueLabel("2026-11-15T15:00:00.000Z", now, "America/Toronto"), "overdue by 4 days"); assert.equal(K.dueLabel("2026-11-23T15:00:00.000Z", now, "America/Toronto"), "in 4 days");
});

import { initLayout, stepLayout, layoutDone } from "../../src/lib/graph/layout";
test("large-graph layout: deterministic, finite, linked nodes end closer than unlinked ones, known positions are kept", () => {
  // two rings of 30 nodes joined by one edge, plus 5 isolated nodes
  const edges: [number, number][] = []; for (let i = 0; i < 30; i++) { edges.push([i, (i + 1) % 30]); edges.push([30 + i, 30 + ((i + 1) % 30)]); edges.push([i, (i + 7) % 30]); edges.push([30 + i, 30 + ((i + 7) % 30)]); } edges.push([0, 30], [3, 3], [2, 999]);
  const run = () => { const s = initLayout(65, edges); let guard = 0; while (!stepLayout(s, 10) && guard++ < 100); return s; };
  const a = run(), b = run(); assert.ok(layoutDone(a)); assert.deepEqual(Array.from(a.x), Array.from(b.x), "same graph, same picture"); assert.equal(a.src.length, edges.length - 2, "self loops and unknown nodes are ignored");
  assert.ok(Array.from(a.x).every(Number.isFinite) && Array.from(a.y).every(Number.isFinite));
  const d = (i: number, j: number) => Math.hypot(a.x[i] - a.x[j], a.y[i] - a.y[j]); const mean = (l: number[]) => l.reduce((x, y) => x + y, 0) / l.length;
  const linked = mean(edges.slice(0, 120).map(([i, j]) => d(i, j))); const across = mean(Array.from({ length: 30 }, (_, i) => d(i, 30 + ((i + 15) % 30))));
  assert.ok(linked < across * 0.7, `linked ${linked.toFixed(1)} < across ${across.toFixed(1)}`);
  let minD = Infinity; for (let i = 0; i < 65; i++) for (let j = i + 1; j < 65; j++) minD = Math.min(minD, d(i, j)); assert.ok(minD > 3, "nodes do not pile up");
  const again = initLayout(65, edges, (i) => ({ x: a.x[i], y: a.y[i] })); assert.ok(again.iter > 0, "a laid-out graph only needs a short relaxation"); assert.equal(again.x[10], a.x[10]);
  const empty = initLayout(0, []); assert.equal(stepLayout(empty), true);
});
