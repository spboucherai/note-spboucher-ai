/**
 * Knowledge graph 2.0 (SPEC §3.3, §4.3): typed relations (user ones accepted, model ones never auto-accepted), graph views, concepts,
 * deterministic intelligence (PageRank, orphans, clusters, recurring topics, duplicates) and the `graph-insights` job run with an
 * injected fake model — no provider is called. Runs against a *_dev database.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, schema } from "../../src/db/index";
import { workspace, mk, doc, made, cleanup, code, kinds, eventsOf, para } from "../helpers/next";
import { createRelation, updateRelation, deleteRelation, listRelations, getRelation, REL_TYPES } from "../../src/lib/graph/relations";
import { decideSuggestion } from "../../src/lib/graph/service";
import { buildGraphView, GRAPH_VIEWS } from "../../src/lib/graph/views";
import { buildGraph } from "../../src/lib/graph/service";
import { pureGraphMetrics, computeIntelligence } from "../../src/lib/graph/intelligence";
import { createConcept, updateConcept, getConcept, listConcepts, deleteConcept } from "../../src/lib/graph/concepts";
import { runGraphInsights, refreshDeterministicInsights, listInsights, decideInsight, INSIGHT_SCHEMA, type InsightModel } from "../../src/lib/graph/insights";
import { createReference } from "../../src/lib/research/references";
import { setPageTags } from "../../src/lib/inbox/service";
import { getPage, updatePage } from "../../src/lib/pages/service";
import { QUEUES, QUEUE_POLICY } from "../../src/lib/jobs/queues";
import { handleGraphInsights } from "../../src/worker/handlers/graph-insights";
import type { PMNode } from "../../src/lib/editor/text";

let ws: string; const PFX = "nx-graph ·";
before(async () => { ws = await workspace(); }); after(async () => { made.tags.push("nx-graph-topic"); await cleanup(ws, PFX); });
const long = (s: string) => doc(`${s} ` + "mot ".repeat(25));

test("pure metrics: PageRank, degrees, components and communities on fixed graphs", () => {
  const ring = pureGraphMetrics(["a", "b", "c", "d"], [["a", "b"], ["b", "c"], ["c", "d"], ["d", "a"]]);
  for (const id of ["a", "b", "c", "d"]) assert.ok(Math.abs(ring.pagerank.get(id)! - 0.25) < 1e-9, "a symmetric ring ranks everyone equally");
  const star = pureGraphMetrics(["hub", "x", "y", "z", "lonely"], [["x", "hub"], ["y", "hub"], ["z", "hub"], ["x", "hub"], ["hub", "hub"]]);
  assert.equal(star.degree.get("hub"), 3, "duplicates and self-loops ignored"); assert.equal(star.in.get("hub"), 3); assert.equal(star.out.get("x"), 1); assert.equal(star.degree.get("lonely"), 0);
  const sum = [...star.pagerank.values()].reduce((a, b) => a + b, 0); assert.ok(Math.abs(sum - 1) < 1e-9, "scores sum to 1"); assert.ok(star.pagerank.get("hub")! > star.pagerank.get("x")! * 2);
  assert.ok(Math.abs(star.pagerank.get("x")! - star.pagerank.get("lonely")!) < 1e-9, "a node nobody links to has the base score");
  assert.deepEqual(star.components, [["hub", "x", "y", "z"], ["lonely"]]); assert.deepEqual(star.communities, [["hub", "x", "y", "z"]], "a singleton is not a community");
  // two cliques of 8 joined by one bridge: one component, two communities
  const A = Array.from({ length: 8 }, (_, i) => `a${i}`), B = Array.from({ length: 8 }, (_, i) => `b${i}`); const edges: [string, string][] = [];
  for (const g of [A, B]) for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) edges.push([g[i], g[j]]); edges.push(["a0", "b0"]);
  const two = pureGraphMetrics([...A, ...B], edges); assert.equal(two.components.length, 1); assert.deepEqual(two.communities, [A, B]);
  assert.deepEqual(pureGraphMetrics([...B, ...A].reverse(), [...edges].reverse()).communities, [A, B], "deterministic whatever the input order");
  assert.deepEqual(pureGraphMetrics([], []).components, []);
});
test("a user relation is typed, accepted at once, journaled, unique per (from, to, type) and idempotent on its id", async () => {
  const a = await mk(ws, `${PFX} A`, doc("a")); const b = await mk(ws, `${PFX} B`, doc("b")); const id = randomUUID();
  const r = await createRelation(ws, { id, fromId: a.id, toId: b.id, relType: "supports", note: "parce que", sourceBlockId: "blkA", validFrom: new Date("2026-01-01T00:00:00Z") });
  assert.equal(r.existing, false); assert.deepEqual([r.relation.id, r.relation.kind, r.relation.relType, r.relation.origin, r.relation.status, r.relation.sourceKind, r.relation.targetKind], [id, "relation", "supports", "user", "accepted", "page", "page"]);
  assert.ok(r.relation.decidedAt); assert.equal(r.relation.fromTitle, `${PFX} A`); assert.equal(r.relation.toTitle, `${PFX} B`); assert.equal(r.relation.sourceBlockId, "blkA");
  assert.equal((await createRelation(ws, { id, fromId: a.id, toId: b.id, relType: "contradicts" })).existing, true, "same id: the stored relation, untouched");
  assert.equal((await getRelation(ws, id)).relType, "supports");
  assert.equal(await code(createRelation(ws, { fromId: a.id, toId: b.id, relType: "supports" })), "relation_exists");
  const other = await createRelation(ws, { fromId: a.id, toId: b.id, relType: "extends" }); assert.equal(other.existing, false, "another type between the same two pages is another relation");
  assert.equal(await code(createRelation(ws, { fromId: a.id, toId: a.id, relType: "related" })), "bad_node"); assert.equal(await code(createRelation(ws, { fromId: a.id, toId: randomUUID(), relType: "related" })), "bad_node");
  assert.equal(await code(createRelation(ws, { fromId: a.id, toId: b.id, relType: "follows", validFrom: new Date("2026-02-01"), validTo: new Date("2026-01-01") })), "bad_request");
  assert.equal(await code(updateRelation(ws, other.relation.id, { relType: "supports" })), "relation_exists");
  const edited = await updateRelation(ws, id, { note: null, validTo: new Date("2026-12-31T00:00:00Z"), relType: "part_of" }); assert.equal(edited.note, null); assert.equal(edited.relType, "part_of"); assert.ok(edited.rev > r.relation.rev);
  assert.deepEqual((await listRelations(ws, { nodeId: a.id })).map((x) => x.relType).sort(), ["extends", "part_of"]); assert.equal((await listRelations(ws, { nodeId: a.id, relType: "extends" })).length, 1);
  await deleteRelation(ws, id); assert.equal(await code(getRelation(ws, id)), "not_found"); assert.equal(await deleteRelation(ws, id), false, "idempotent: nothing left to delete");
  assert.deepEqual((await kinds(a.id)).filter((k) => k.startsWith("relation.")), ["relation.created", "relation.created", "relation.removed"]);
  assert.equal(REL_TYPES.length, 12);
});
test("nothing created by a model is accepted without a user decision", async () => {
  const a = await mk(ws, `${PFX} M1`, doc("a")); const b = await mk(ws, `${PFX} M2`, doc("b"));
  const s = await createRelation(ws, { fromId: a.id, toId: b.id, relType: "contradicts" }, { origin: "ai", model: "fake-1", confidence: 0.7, rationale: "x dit le contraire de y" });
  assert.deepEqual([s.relation.origin, s.relation.status, s.relation.decidedAt, s.relation.model], ["ai", "suggested", null, "fake-1"]); assert.equal((await kinds(a.id)).filter((k) => k.startsWith("relation.")).length, 0, "a suggestion is not an event");
  assert.equal((await createRelation(ws, { fromId: a.id, toId: b.id, relType: "contradicts" }, { origin: "ai", model: "fake-2" })).existing, true, "a model never re-proposes a known pair");
  const g = await buildGraphView(ws, "local", { pageId: a.id, suggestions: false }); assert.equal(g.edges.some((e) => e.id === s.relation.id), false, "hidden when suggestions are off");
  const acc = await updateRelation(ws, s.relation.id, { status: "accepted" }); assert.equal(acc.status, "accepted"); assert.ok(acc.decidedAt); assert.equal(acc.origin, "ai", "the origin is kept: provenance is never lost");
  const back = await updateRelation(ws, s.relation.id, { status: "suggested" }); assert.equal(back.decidedAt, null); const rej = await updateRelation(ws, s.relation.id, { status: "rejected" }); assert.ok(rej.decidedAt);
  assert.deepEqual((await kinds(a.id)).filter((k) => k.startsWith("relation.")), ["relation.accepted", "relation.rejected"]);
  assert.equal((await createRelation(ws, { fromId: a.id, toId: b.id, relType: "contradicts" }, { origin: "ai" })).relation.status, "rejected", "a rejected suggestion stays rejected");
});
test("edges derived from a document are read-only; only a link suggestion can be decided as one", async () => {
  const t = await mk(ws, `${PFX} target`, doc("t")); const p = await mk(ws, `${PFX} source`, doc({ type: "paragraph", content: [{ type: "mention", attrs: { id: t.id, label: "t" } }] }));
  const K = schema.knowledgeEdges; const [link] = await db.select().from(K).where(and(eq(K.fromId, p.id), eq(K.kind, "link"))); assert.ok(link);
  assert.equal(await code(updateRelation(ws, link.id, { status: "rejected" })), "derived_edge"); assert.equal(await code(deleteRelation(ws, link.id)), "derived_edge");
  assert.equal(await code(decideSuggestion(ws, link.id, "rejected")), "status-404", "D-12: a link mirror edge is not a suggestion");
  assert.equal((await db.select().from(K).where(eq(K.id, link.id)))[0].status, "accepted");
  const [sug] = await db.insert(K).values({ workspaceId: ws, fromId: t.id, toId: p.id, kind: "ai_suggested", origin: "ai", status: "suggested", model: "m", confidence: 0.8, rationale: `${PFX} why` }).returning();
  assert.equal(await code(updateRelation(ws, sug.id, { note: "x" })), "derived_edge");
  assert.equal((await updateRelation(ws, sug.id, { status: "accepted" })).status, "accepted"); assert.equal((await db.select().from(schema.links).where(and(eq(schema.links.fromPageId, t.id), eq(schema.links.kind, "ai")))).length, 1, "2.x behaviour kept: the accepted suggestion is a backlink");
  assert.ok((await kinds(t.id)).includes("relation.accepted")); assert.equal(await code(deleteRelation(ws, sug.id)), "derived_edge");
});
test("graph views: global, local, project, timeline, concepts, documents, references", async () => {
  assert.deepEqual([...GRAPH_VIEWS], ["global", "local", "project", "timeline", "concepts", "documents", "references"]);
  const root = await mk(ws, `${PFX} V project`, undefined, { section: "projects" }); const kid = await mk(ws, `${PFX} V kid`, doc("k"), { parentId: root.id, section: "projects" });
  const ext = await mk(ws, `${PFX} V external`, doc("e")); const far = await mk(ws, `${PFX} V far`, doc("f")); const docPage = await mk(ws, `${PFX} V document`, doc("d"), { section: "documents" }); const cv = await mk(ws, `${PFX} V canvas`, undefined, { type: "canvas" });
  const ref = await createReference(ws, { title: `${PFX} V ref`, year: 2021 }); made.references.push(ref.id);
  const { concept } = await createConcept(ws, { name: `${PFX} V concept`, pageIds: [kid.id, ext.id] }); made.concepts.push(concept.id);
  const { relation } = await createRelation(ws, { fromId: kid.id, toId: ext.id, relType: "supports" }); await createRelation(ws, { fromId: ext.id, toId: far.id, relType: "precedes" });
  await createRelation(ws, { fromId: kid.id, toId: ref.id, targetKind: "reference", relType: "cites" }); await createRelation(ws, { fromId: concept.id, sourceKind: "concept", toId: ref.id, targetKind: "reference", relType: "about" });
  await updatePage(ws, docPage.id, { content: doc({ type: "paragraph", content: [{ type: "citation", attrs: { refId: ref.id, label: "R" } }] }, { type: "canvasLink", attrs: { pageId: cv.id } }) });
  const ids = (g: { nodes: { id: string }[] }) => new Set(g.nodes.map((n) => n.id));
  const global = await buildGraphView(ws, "global"); for (const id of [root.id, kid.id, ext.id, far.id, docPage.id, cv.id, `ref:${ref.id}`, `concept:${concept.id}`]) assert.ok(ids(global).has(id), `global has ${id}`);
  assert.equal(global.nodes.find((n) => n.id === cv.id)!.kind, "canvas"); assert.equal(global.nodes.find((n) => n.id === `ref:${ref.id}`)!.entityId, ref.id);
  const typed = global.edges.find((e) => e.id === relation.id)!; assert.deepEqual([typed.kind, typed.relType, typed.origin, typed.status, typed.source, typed.target], ["typed", "supports", "user", "accepted", kid.id, ext.id]);
  assert.ok(global.edges.some((e) => e.kind === "cites" && e.source === docPage.id && e.target === `ref:${ref.id}` && e.sourceBlockId), "a citation is an edge anchored to its block");
  assert.ok(global.edges.some((e) => e.kind === "link" && e.source === docPage.id && e.target === cv.id), "canvasLink is a link edge");
  assert.ok(global.edges.some((e) => e.kind === "about" && e.source === kid.id && e.target === `concept:${concept.id}`)); assert.ok(global.edges.some((e) => e.source === `concept:${concept.id}` && e.target === `ref:${ref.id}`));
  const node = global.nodes.find((n) => n.id === kid.id)!; assert.equal(node.degree, node.in + node.out); assert.ok(node.degree >= 3); assert.ok(global.stats.references >= 1 && global.stats.concepts >= 1);
  const local1 = await buildGraphView(ws, "local", { pageId: kid.id, depth: 1 }); assert.equal(local1.center, kid.id); assert.ok(ids(local1).has(ext.id)); assert.equal(ids(local1).has(far.id), false);
  const local2 = await buildGraphView(ws, "local", { pageId: kid.id, depth: 2 }); assert.ok(ids(local2).has(far.id), "depth 2 reaches one hop further");
  assert.equal(await code(buildGraphView(ws, "local", {})), "bad_request"); assert.equal(await code(buildGraphView(ws, "local", { pageId: randomUUID() })), "not_found");
  const project = await buildGraphView(ws, "project", { pageId: root.id }); assert.ok(ids(project).has(root.id) && ids(project).has(kid.id)); assert.equal(project.nodes.find((n) => n.id === ext.id)?.external, true, "a neighbour outside the project is kept, flagged external"); assert.equal(ids(project).has(far.id), false); assert.equal(project.nodes.find((n) => n.id === kid.id)?.external, undefined);
  const tl = await buildGraphView(ws, "timeline", { from: new Date(Date.now() - 3600_000), to: new Date(Date.now() + 60_000) }); assert.ok(ids(tl).has(kid.id)); assert.ok(tl.range && tl.buckets && tl.buckets.length >= 1); assert.ok(tl.buckets!.reduce((a, b) => a + b.created, 0) >= 6); assert.ok(tl.edges.some((e) => e.id === relation.id));
  const old = await buildGraphView(ws, "timeline", { from: new Date("2020-01-01"), to: new Date("2020-02-01") }); assert.equal(old.nodes.length, 0); assert.equal(await code(buildGraphView(ws, "timeline", { from: new Date("2026-02-01"), to: new Date("2026-01-01") })), "bad_request");
  const cg = await buildGraphView(ws, "concepts"); assert.ok(ids(cg).has(`concept:${concept.id}`) && ids(cg).has(kid.id) && ids(cg).has(ext.id)); assert.equal(ids(cg).has(far.id), false); assert.ok(cg.edges.every((e) => e.kind === "about" || e.source.startsWith("concept:") || e.target.startsWith("concept:")));
  const dg = await buildGraphView(ws, "documents"); assert.ok(ids(dg).has(docPage.id) && ids(dg).has(`ref:${ref.id}`)); assert.equal(ids(dg).has(kid.id), false); assert.ok(dg.nodes.filter((n) => n.kind === "page").every((n) => n.section === "documents"));
  const rg = await buildGraphView(ws, "references"); assert.ok(ids(rg).has(`ref:${ref.id}`) && ids(rg).has(kid.id) && ids(rg).has(docPage.id)); assert.ok(rg.edges.every((e) => e.source.startsWith("ref:") || e.target.startsWith("ref:")));
  const hidden = await buildGraphView(ws, "references", { hideOrphans: true }); assert.ok(hidden.nodes.every((n) => n.degree > 0));
  const legacy = await buildGraph(ws, {}); assert.deepEqual(Object.keys(legacy), ["nodes", "edges", "center", "stats"], "the 2.x answer of /api/graph keeps its shape"); assert.deepEqual(Object.keys(legacy.stats), ["pages", "edges", "suggested"]);
});
test("concepts: create, link pages, rename, decide, delete", async () => {
  const a = await mk(ws, `${PFX} C1`, doc("a")); const b = await mk(ws, `${PFX} C2`, doc("b")); const id = randomUUID(); made.concepts.push(id);
  const c = await createConcept(ws, { id, name: `  ${PFX}   volatilité  `, description: "d", pageIds: [a.id] }); assert.equal(c.concept.name, `${PFX} volatilité`); assert.deepEqual([c.concept.origin, c.concept.status], ["user", "accepted"]);
  assert.equal((await createConcept(ws, { id, name: "autre" })).existing, true); assert.equal(await code(createConcept(ws, { name: `${PFX} VOLATILITÉ` })), "concept_exists"); assert.equal(await code(createConcept(ws, { name: "   " })), "bad_request");
  assert.equal(await code(createConcept(ws, { name: `${PFX} bad pages`, pageIds: [randomUUID()] })), "bad_page");
  let g = await getConcept(ws, id); assert.equal(g.pages, 1); assert.deepEqual(g.pageLinks.map((l) => [l.pageId, l.origin, l.status]), [[a.id, "user", "accepted"]]);
  g = await updateConcept(ws, id, { addPages: [b.id], description: null }); assert.equal(g.pages, 2); assert.equal(g.description, null); assert.ok(g.rev > c.concept.rev, "linking a page moves the concept in the feed");
  g = await updateConcept(ws, id, { removePages: [a.id], name: `${PFX} variance` }); assert.equal(g.pages, 1); assert.equal(g.name, `${PFX} variance`);
  assert.ok((await listConcepts(ws, { pageId: b.id })).some((x) => x.id === id)); assert.equal((await listConcepts(ws, { pageId: a.id })).some((x) => x.id === id), false);
  const ai = await createConcept(ws, { name: `${PFX} suggéré` }, { origin: "ai", model: "fake" }); made.concepts.push(ai.concept.id); assert.equal(ai.concept.status, "suggested"); assert.equal((await listConcepts(ws)).some((x) => x.id === ai.concept.id), false, "a suggested concept is not listed with the accepted ones"); assert.ok((await listConcepts(ws, { status: "suggested" })).some((x) => x.id === ai.concept.id));
  assert.equal((await updateConcept(ws, ai.concept.id, { status: "accepted" })).status, "accepted"); await deleteConcept(ws, ai.concept.id); assert.equal(await code(getConcept(ws, ai.concept.id)), "not_found");
});
test("intelligence: central pages, orphans, clusters, recurring topics and exact duplicates, from real data", async () => {
  const hub = await mk(ws, `${PFX} I hub`, long("hub")); const s = await Promise.all([1, 2, 3].map((i) => mk(ws, `${PFX} I spoke ${i}`, long(`spoke ${i}`))));
  for (const x of s) await createRelation(ws, { fromId: x.id, toId: hub.id, relType: "related" });
  const orphan = await mk(ws, `${PFX} I orphan`, long("orphan")); const d1 = await mk(ws, `${PFX} I twin`, long("texte identique")); const d2 = await mk(ws, `${PFX} I twin`, long("texte identique"));
  await setPageTags(ws, s[0].id, ["nx-graph-topic"]); await setPageTags(ws, s[1].id, ["nx-graph-topic"]);
  const x = await computeIntelligence(ws, { limit: 100 }); const again = await computeIntelligence(ws, { limit: 100 });
  assert.deepEqual({ ...x, computedAt: "" }, { ...again, computedAt: "" }, "same data, same answer");
  const h = x.centralPages.find((p) => p.id === hub.id)!; assert.ok(h, "the hub is central"); assert.deepEqual([h.degree, h.in, h.out], [3, 3, 0]); for (const sp of s) assert.ok(h.pagerank > x.centralPages.find((p) => p.id === sp.id)!.pagerank);
  assert.ok(x.orphans.some((o) => o.id === orphan.id)); assert.equal(x.orphans.some((o) => o.id === hub.id), false); assert.equal(x.centralPages.some((p) => p.id === orphan.id), false);
  const cl = x.clusters.find((c) => c.pageIds.includes(hub.id))!; assert.equal(cl.size, 4); assert.equal(cl.label, `${PFX} I hub`, "a cluster is named after its most central page"); assert.deepEqual([...cl.pageIds].sort(), [hub.id, ...s.map((p) => p.id)].sort());
  const topic = x.recurringTopics.find((t) => t.kind === "tag" && t.name === "nx-graph-topic")!; assert.equal(topic.pages, 2); assert.deepEqual(topic.pageIds, [s[0].id, s[1].id].sort()); assert.ok(topic.lastActivityAt);
  assert.ok(x.duplicates.some((d) => d.reason === "title" && d.pageIds.includes(d1.id) && d.pageIds.includes(d2.id))); assert.ok(x.duplicates.some((d) => d.reason === "content" && d.pageIds.includes(d1.id) && d.pageIds.includes(d2.id)));
  assert.ok(x.stats.pages >= 7 && x.stats.orphans >= 3 && x.stats.clusters >= 1);
  const det = await refreshDeterministicInsights(ws); assert.ok(det.created >= 3, "cluster + topic + duplicates materialised"); assert.equal((await refreshDeterministicInsights(ws)).created, 0, "a second run stores nothing new");
  const stored = await listInsights(ws, { kind: "cluster" }); const mine = stored.insights.find((i) => (i.data as any).pageIds?.includes(hub.id))!; assert.deepEqual([mine.origin, mine.status, mine.model], ["system", "suggested", null]);
  await decideInsight(ws, mine.id, "dismissed"); assert.equal((await refreshDeterministicInsights(ws)).created, 0, "a dismissed insight does not come back");
});
test("graph-insights job: strict JSON through an injected model, and every cited page / block must exist", async () => {
  const a = await mk(ws, `${PFX} J alpha`, long("La volatilité est stationnaire.")); const b = await mk(ws, `${PFX} J beta`, long("La volatilité n'est pas stationnaire.")); const c = await mk(ws, `${PFX} J gamma`, long("Pourquoi la persistance change-t-elle ?"));
  const blk = async (id: string) => ((await getPage(ws, id)).content as PMNode).content![0].attrs!.id as string; const [ba, bb, bc] = [await blk(a.id), await blk(b.id), await blk(c.id)];
  const ghost = randomUUID(); let seen: Parameters<InsightModel>[0] | null = null;
  const fake: InsightModel = async (input) => { seen = input; return { model: "fake-model-1", costUsd: 0, text: JSON.stringify({
    contradictions: [
      { title: `${PFX} stationnarité`, detail: "A affirme, B nie.", a: { pageId: a.id, blockId: ba }, b: { pageId: b.id, blockId: bb }, confidence: 0.9 },
      { title: `${PFX} inventée`, detail: "page inconnue", a: { pageId: a.id, blockId: ba }, b: { pageId: ghost, blockId: null }, confidence: 0.9 },
      { title: `${PFX} bloc inventé`, detail: "bloc inconnu", a: { pageId: a.id, blockId: "nope000000" }, b: { pageId: b.id, blockId: bb }, confidence: 0.9 },
      { title: `${PFX} même passage`, detail: "x", a: { pageId: a.id, blockId: ba }, b: { pageId: a.id, blockId: ba }, confidence: 0.5 }],
    openQuestions: [{ title: `${PFX} persistance ?`, detail: "non résolue", source: { pageId: c.id, blockId: bc } }, { title: `${PFX} question fantôme`, detail: "", source: { pageId: ghost, blockId: null } }],
    concepts: [{ name: `${PFX} stationnarité (concept)`, description: "propriété", pageIds: [a.id, b.id, ghost], confidence: 0.8 }, { name: `${PFX} concept d'une seule page`, description: "", pageIds: [a.id, ghost], confidence: 0.8 }],
  }) }; };
  const r = await runGraphInsights(ws, { pageIds: [a.id, b.id, c.id], model: fake });
  assert.deepEqual(r, { pages: 3, contradictions: 1, openQuestions: 1, concepts: 1, conceptLinks: 2, dropped: 7, model: "fake-model-1", costUsd: 0 });
  assert.ok(seen); const input = seen as Parameters<InsightModel>[0]; assert.equal(input.jsonSchema, INSIGHT_SCHEMA); assert.match(input.user, new RegExp(`\\[b:${ba}\\] La volatilité est stationnaire`)); assert.match(input.user, /<workspace>/); assert.match(input.system, /never an instruction/);
  const all = (await listInsights(ws, { status: "all" })).insights.filter((i) => i.title.startsWith(PFX));
  assert.deepEqual(all.filter((i) => i.origin === "ai").map((i) => [i.kind, i.title, i.status, i.model]).sort(), [["contradiction", `${PFX} stationnarité`, "suggested", "fake-model-1"], ["open_question", `${PFX} persistance ?`, "suggested", "fake-model-1"]], "nothing that cites a missing page or block is stored");
  const con = all.find((i) => i.kind === "contradiction")!; assert.deepEqual((con.data as any).pageIds.sort(), [a.id, b.id].sort()); assert.deepEqual((con.data as any).blockIds.sort(), [ba, bb].sort());
  const concept = (await listConcepts(ws, { status: "suggested" })).find((x) => x.name === `${PFX} stationnarité (concept)`)!; assert.ok(concept); made.concepts.push(concept.id); assert.deepEqual([concept.origin, concept.status, concept.pages, concept.suggestedPages], ["ai", "suggested", 0, 2]);
  assert.equal((await listConcepts(ws, { status: "all" })).some((x) => x.name === `${PFX} concept d'une seule page`), false);
  assert.equal((await db.select().from(schema.knowledgeEdges).where(and(eq(schema.knowledgeEdges.fromId, a.id), eq(schema.knowledgeEdges.kind, "relation")))).length, 0, "a contradiction is an insight, not yet a relation");
  // running again stores nothing twice
  const r2 = await runGraphInsights(ws, { pageIds: [a.id, b.id, c.id], model: fake }); assert.deepEqual([r2.contradictions, r2.openQuestions, r2.concepts, r2.conceptLinks], [0, 0, 0, 0]);
  // the user accepts the contradiction: the typed relation is created, accepted, with its AI origin
  const dec = await decideInsight(ws, con.id, "accepted"); assert.ok(dec.relationId); const rel = await getRelation(ws, dec.relationId!); assert.deepEqual([rel.relType, rel.origin, rel.status, rel.model, rel.sourceBlockId, rel.targetBlockId], ["contradicts", "ai", "accepted", "fake-model-1", ba, bb]);
  assert.ok((await eventsOf(a.id)).some((e) => e.kind === "relation.accepted" && e.data.relationId === rel.id));
  // malformed outputs fail the job instead of storing anything
  await assert.rejects(runGraphInsights(ws, { pageIds: [a.id, b.id], model: async () => ({ model: "m", text: "not json" }) }), /invalid JSON/);
  await assert.rejects(runGraphInsights(ws, { pageIds: [a.id, b.id], model: async () => ({ model: "m", text: JSON.stringify({ contradictions: [{ title: 5 }] }) }) }), /does not match the schema/);
  let called = 0; const skipped = await runGraphInsights(ws, { pageIds: [a.id], model: async () => { called++; return { model: "m", text: "{}" }; } }); assert.equal(skipped.skipped, "not enough pages with text"); assert.equal(called, 0, "no call for fewer than two pages");
});
test("the graph-insights queue exists, is never retried automatically, and its handler ignores an empty payload", async () => {
  assert.equal(QUEUES.graphInsights, "graph-insights"); assert.equal(QUEUE_POLICY["graph-insights"].retryLimit, 0); assert.equal(QUEUE_POLICY["graph-insights"].deadLetter, true);
  assert.deepEqual(await handleGraphInsights({} as any), { ignored: true });
});
