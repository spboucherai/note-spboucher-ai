/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : scripts/next-k-perf-seed.ts
 * Description      : DEVELOPMENT ONLY — fills a scratch database with a
 *                    synthetic workspace to measure the Knowledge Graph 2.0
 *                    against its budget (5 000 nodes / 20 000 edges) and the
 *                    Thought Constellation. Deterministic (fixed seed): one
 *                    root page "PERF", N-1 pages under it in 60 communities, E
 *                    edges (65 % document links, 30 % typed relations, 5 % AI
 *                    suggestions; 85 % inside a community) and, with
 *                    --embeddings, one synthetic 1536-d vector per page
 *                    (community centre + noise — fixtures, not model output).
 *                    Refuses any database whose name does not end in _dev,
 *                    _test or _scratch. usage: set -a && . ./.env && set +a &&
 *                    node_modules/.bin/tsx scripts/next-k-perf-seed.ts [--nodes
 *                    5000] [--edges 20000] [--embeddings] [--clean]
 * Module           : scripts
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

import "../tests/helpers/testdb";
import { like, eq } from "drizzle-orm";
import { db, schema, sql } from "../src/db/index";
import { EMBEDDING_MODEL } from "../src/lib/ai/router";

const arg = (name: string, def: number) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? Number(process.argv[i + 1]) : def; };
const N = arg("nodes", 5000), E = arg("edges", 20000); const withEmb = process.argv.includes("--embeddings"); const PFX = "PERF ·"; const COMMUNITIES = 60;
let seed = 20261119; const rnd = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const [ws] = await db.select().from(schema.workspaces).limit(1); if (!ws) throw new Error("No workspace: run `pnpm run bootstrap` first.");

const old = await db.select({ id: schema.pages.id }).from(schema.pages).where(like(schema.pages.title, `${PFX}%`));
if (old.length) { const ids = old.map((o) => o.id); for (let i = 0; i < ids.length; i += 1000) { const part = ids.slice(i, i + 1000); await sql`delete from knowledge_edges where from_id = any(${part}::uuid[]) or to_id = any(${part}::uuid[])`; await sql`delete from chunks where page_id = any(${part}::uuid[])`; await sql`delete from knowledge_events where page_id = any(${part}::uuid[])`; await sql`delete from pages where id = any(${part}::uuid[])`; } console.log(`removed ${ids.length} synthetic pages`); }
await db.delete(schema.settings).where(eq(schema.settings.key, `graph.constellation:${ws.id}`));
if (process.argv.includes("--clean")) { await sql.end(); process.exit(0); }

const t0 = Date.now();
const [root] = await db.insert(schema.pages).values({ workspaceId: ws.id, title: `${PFX} synthetic workspace`, section: "projects", icon: "🧪" }).returning({ id: schema.pages.id });
const ids: string[] = [root.id]; const community: number[] = [0];
for (let i = 1; i < N; i += 500) {
  const batch = Array.from({ length: Math.min(500, N - i) }, (_, k) => { const n = i + k; const c = n % COMMUNITIES; const text = `Synthetic note ${n} of community ${c}.`; return { workspaceId: ws.id, parentId: root.id, title: `${PFX} c${String(c).padStart(2, "0")} note ${n}`, section: "projects", content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] }, plainText: text, wordCount: 6 }; });
  const got = await db.insert(schema.pages).values(batch).returning({ id: schema.pages.id }); got.forEach((g, k) => { ids.push(g.id); community.push((i + k) % COMMUNITIES); });
}
const byCommunity: number[][] = Array.from({ length: COMMUNITIES }, () => []); community.forEach((c, i) => byCommunity[c].push(i));
const RELS = ["related", "supports", "contradicts", "extends", "example_of", "part_of", "precedes", "follows", "answers", "duplicates"]; const seen = new Set<string>(); const rows: any[] = [];
// preferential attachment inside a community: low indexes of each community attract more edges (hubs)
const pick = (list: number[]) => list[Math.floor(rnd() ** 2.2 * list.length)];
let guard = 0;
while (rows.length < E && guard++ < E * 20) {
  const a = 1 + Math.floor(rnd() * (N - 1)); const b = rnd() < 0.85 ? pick(byCommunity[community[a]]) : 1 + Math.floor(rnd() * (N - 1)); if (a === b || b === 0) continue;
  const r = rnd(); const kind = r < 0.65 ? "link" : r < 0.95 ? "relation" : "relation-ai"; const relType = kind === "link" ? "related" : RELS[Math.floor(rnd() * RELS.length)];
  const key = `${a}|${b}|${kind === "link" ? "link" : "relation"}|${relType}`; if (seen.has(key)) continue; seen.add(key);
  rows.push({ workspaceId: ws.id, fromId: ids[a], toId: ids[b], kind: kind === "link" ? "link" : "relation", relType, origin: kind === "link" ? "system" : kind === "relation" ? "user" : "ai", status: kind === "relation-ai" ? "suggested" : "accepted", confidence: kind === "relation-ai" ? Math.round((0.4 + rnd() * 0.55) * 100) / 100 : null, rationale: kind === "relation-ai" ? "synthetic suggestion (performance fixture)" : null, model: kind === "relation-ai" ? "fixture" : null, decidedAt: kind === "relation" ? new Date() : null });
}
for (let i = 0; i < rows.length; i += 1000) await db.insert(schema.knowledgeEdges).values(rows.slice(i, i + 1000));
console.log(`seeded ${ids.length} pages and ${rows.length} edges in ${Date.now() - t0} ms`);
if (withEmb) {
  const t1 = Date.now(); const D = 1536; const centres = Array.from({ length: COMMUNITIES }, () => Array.from({ length: D }, () => rnd() - 0.5));
  for (let i = 1; i < N; i += 100) {
    const part = Array.from({ length: Math.min(100, N - i) }, (_, k) => i + k);
    const cs = await db.insert(schema.chunks).values(part.map((n) => ({ workspaceId: ws.id, sourceType: "page", sourceId: ids[n], pageId: ids[n], ordinal: 0, content: `Synthetic note ${n}`, contentHash: `perf-${n}` }))).returning({ id: schema.chunks.id });
    const vals = part.map((n, k) => { const c = centres[community[n]]; let norm = 0; const v = c.map((x) => { const y = x + (rnd() - 0.5) * 0.9; norm += y * y; return y; }); norm = Math.sqrt(norm); return { chunk_id: cs[k].id, model: EMBEDDING_MODEL, embedding: `[${v.map((y) => (y / norm).toFixed(5)).join(",")}]` }; });
    await sql`insert into embeddings ${sql(vals as any, "chunk_id", "model", "embedding")}`;
  }
  console.log(`seeded ${N - 1} synthetic embeddings in ${Date.now() - t1} ms`);
}
await sql.end();
