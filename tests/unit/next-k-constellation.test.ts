/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : tests/unit/next-k-constellation.test.ts
 * Description      : Thought Constellation service on a *_dev database — pages
 *                    with chunk embeddings inserted by the test (two groups of
 *                    synthetic 1536-d vectors: fixtures, not model output) are
 *                    projected by the real code path (pgvector avg → PCA): the
 *                    two groups separate, the projection is cached by signature
 *                    and recomputed when embeddings change, links / tags /
 *                    projects are read live, and trashed pages leave the map.
 *                    No provider is called.
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

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db, schema, sql } from "../../src/db/index";
import { workspace, mk, doc, made, cleanup } from "../helpers/next";
import { buildConstellation } from "../../src/lib/graph/constellation";
import { createRelation } from "../../src/lib/graph/relations";
import { setPageTags } from "../../src/lib/inbox/service";
import { softDeletePage, updatePage } from "../../src/lib/pages/service";
import { EMBEDDING_MODEL } from "../../src/lib/ai/router";

let ws: string; const PFX = "nx-const ·"; const ids: string[] = [];
/** A unit-ish 1536-d vector: group A lives around axis 3, group B around axis 700; `j` adds a small, fixed variation. */
const vec = (group: "A" | "B", j: number) => { const v = new Array(1536).fill(0); v[group === "A" ? 3 : 700] = 1; v[(group === "A" ? 40 : 900) + j] = 0.15; v[1200] = 0.05 * (j % 3); return `[${v.join(",")}]`; };
async function embed(pageId: string, group: "A" | "B", j: number, chunks = 2) {
  for (let o = 0; o < chunks; o++) { const [c] = await db.insert(schema.chunks).values({ workspaceId: ws, sourceType: "page", sourceId: pageId, pageId, ordinal: o, content: `chunk ${o}`, contentHash: `${pageId}-${o}` }).returning({ id: schema.chunks.id }); await sql`insert into embeddings (chunk_id, model, embedding) values (${c.id}, ${EMBEDDING_MODEL}, ${vec(group, j + o)}::vector)`; }
}
before(async () => { ws = await workspace(); await db.delete(schema.settings).where(eq(schema.settings.key, `graph.constellation:${ws}`)); });
after(async () => { if (ids.length) await sql`delete from chunks where page_id = any(${ids}::uuid[])`; made.tags.push("nx-const-tag"); await db.delete(schema.settings).where(eq(schema.settings.key, `graph.constellation:${ws}`)); await cleanup(ws, PFX); });

test("constellation: real code path over stored embeddings — separation, cache, live metadata, honest counts", async () => {
  const before0 = await buildConstellation(ws); const base = before0.stats.embedded;
  const project = await mk(ws, `${PFX} Projet`, doc("racine du projet"), { section: "projects" });
  const a = [await mk(ws, `${PFX} A1`, doc("alpha un"), { parentId: project.id, section: "projects" }), await mk(ws, `${PFX} A2`, doc("alpha deux")), await mk(ws, `${PFX} A3`, doc("alpha trois"))];
  const b = [await mk(ws, `${PFX} B1`, doc("beta un")), await mk(ws, `${PFX} B2`, doc("beta deux")), await mk(ws, `${PFX} B3`, doc("beta trois"))];
  const noVec = await mk(ws, `${PFX} sans vecteur`, doc("jamais indexée"));
  ids.push(...a.map((p) => p.id), ...b.map((p) => p.id), project.id, noVec.id);
  await sql`delete from chunks where page_id = any(${ids}::uuid[])`; // whatever a running worker may have indexed meanwhile: the test owns these vectors
  for (const [i, p] of a.entries()) await embed(p.id, "A", i); for (const [i, p] of b.entries()) await embed(p.id, "B", i);
  await createRelation(ws, { fromId: a[0].id, toId: a[1].id, relType: "supports" }); await setPageTags(ws, a[1].id, ["nx-const-tag"]);

  const c1 = await buildConstellation(ws); assert.equal(c1.cached, false); assert.equal(c1.model, EMBEDDING_MODEL); assert.equal(c1.stats.embedded, base + 6);
  assert.ok(c1.stats.pages >= c1.stats.embedded + 2, "pages without vectors are counted, not placed"); assert.equal(c1.points.some((p) => p.id === noVec.id), false);
  const at = (id: string) => c1.points.find((p) => p.id === id)!; const pa = a.map((p) => at(p.id)), pb = b.map((p) => at(p.id));
  for (const p of [...pa, ...pb]) { assert.ok(p, "every embedded page is a point"); assert.ok(Math.abs(p.x) <= 1.05 && Math.abs(p.y) <= 1.05); }
  const d = (p: { x: number; y: number }, q: { x: number; y: number }) => Math.hypot(p.x - q.x, p.y - q.y);
  const within = Math.max(d(pa[0], pa[1]), d(pa[0], pa[2]), d(pb[0], pb[1]), d(pb[0], pb[2])); const between = Math.min(...pa.flatMap((p) => pb.map((q) => d(p, q))));
  if (base === 0) assert.ok(between > within * 3, `notes that mean the same sit together (within ${within.toFixed(3)}, between ${between.toFixed(3)})`); else assert.ok(between > within, "the two groups are apart");
  assert.equal(at(a[0].id).projectId, project.id, "project = top-most ancestor in the section projects"); assert.equal(at(a[1].id).projectId, null); assert.deepEqual(at(a[1].id).tags, ["nx-const-tag"]);
  assert.ok(c1.links.some((l) => (l.source === a[0].id && l.target === a[1].id) || (l.source === a[1].id && l.target === a[0].id)), "accepted relations are the constellation lines"); assert.equal(at(a[0].id).degree >= 1, true);
  assert.equal(c1.clusters.reduce((s, c) => s + c.size, 0), c1.points.length); assert.ok(c1.clusters.every((c) => c.label)); assert.ok(c1.projects.some((p) => p.id === project.id && p.pages === 1)); assert.ok(c1.tags.some((t) => t.name === "nx-const-tag"));
  assert.ok(c1.explained[0] > 0 && c1.explained[0] + c1.explained[1] <= 1 + 1e-6);

  // second call: same signature → cached positions, live titles
  await updatePage(ws, a[2].id, { title: `${PFX} A3 renommée` });
  const c2 = await buildConstellation(ws); assert.equal(c2.cached, true); assert.equal(c2.computedAt, c1.computedAt); assert.equal(c2.points.find((p) => p.id === a[2].id)!.title, `${PFX} A3 renommée`);
  assert.deepEqual(c2.points.map((p) => [p.id, p.x, p.y]), c1.points.map((p) => [p.id, p.x, p.y]), "positions are stable while the embeddings do not change");
  // new embeddings → new signature → recomputed
  await embed(noVec.id, "B", 7, 1); const c3 = await buildConstellation(ws); assert.equal(c3.cached, false); assert.notEqual(c3.signature, c2.signature); assert.ok(c3.points.some((p) => p.id === noVec.id));
  const moved = c3.points.find((p) => p.id === noVec.id)!; assert.ok(Math.min(...b.map((p) => d(moved, c3.points.find((x) => x.id === p.id)!))) < Math.min(...a.map((p) => d(moved, c3.points.find((x) => x.id === p.id)!))), "the new note lands near the notes it resembles");
  // refresh=1 recomputes even when nothing changed; a trashed page leaves the map
  const c4 = await buildConstellation(ws, { refresh: true }); assert.equal(c4.cached, false); assert.deepEqual(c4.points.map((p) => [p.id, p.x, p.y]), c3.points.map((p) => [p.id, p.x, p.y]), "deterministic: recomputing gives the same map");
  await softDeletePage(ws, b[2].id); const c5 = await buildConstellation(ws); assert.equal(c5.points.some((p) => p.id === b[2].id), false);
});
