/**
 * File: src/lib/graph/intelligence.ts
 * Description: deterministic knowledge intelligence (SPEC §3.3 / §4.3) — no model involved, same input ⇒ same output:
 *   degree and PageRank centrality (central pages), central concepts, orphans, clusters (connected components, split by label
 *   propagation when large), recurring topics (tags and concepts carried by several pages), and exact duplicates (same title or same
 *   text). `pureGraphMetrics` is pure and unit-tested on fixed graphs; `computeIntelligence` feeds it from the workspace.
 * Author: Simon-Pierre Boucher · contact@spboucher.ai
 */
import { createHash } from "node:crypto";
import { sql as dsql } from "drizzle-orm";
import { db } from "@/db";

const rows = async <T = any>(q: ReturnType<typeof dsql>): Promise<T[]> => (await db.execute(q)) as unknown as T[];
export interface Metrics { degree: Map<string, number>; in: Map<string, number>; out: Map<string, number>; pagerank: Map<string, number>; components: string[][]; communities: string[][] }

/**
 * Graph metrics over node ids and directed edges (duplicates and self-loops ignored). Deterministic: nodes are processed in sorted id
 * order and every tie is broken by id.
 *  - PageRank: damping 0.85, uniform teleport, dangling mass redistributed uniformly, at most 100 iterations or L1 change < 1e-10;
 *    scores sum to 1.
 *  - components: connected components of the undirected graph, largest first.
 *  - communities: components of fewer than 8 nodes as they are; larger ones split by weighted label propagation — each node, in id
 *    order, takes the label with the greatest total weight among its neighbours (an edge weighs 1 + the number of neighbours its two
 *    ends share; smallest label on a tie; at most 30 sweeps). Singletons are not communities.
 */
export function pureGraphMetrics(nodeIds: string[], edgeList: [string, string][]): Metrics {
  const ids = [...new Set(nodeIds)].sort(); const idx = new Map(ids.map((id, i) => [id, i])); const n = ids.length;
  const outAdj: Set<number>[] = ids.map(() => new Set()); const inAdj: Set<number>[] = ids.map(() => new Set()); const und: Set<number>[] = ids.map(() => new Set());
  for (const [a, b] of edgeList) { const i = idx.get(a), j = idx.get(b); if (i === undefined || j === undefined || i === j) continue; outAdj[i].add(j); inAdj[j].add(i); und[i].add(j); und[j].add(i); }
  const degree = new Map<string, number>(), inD = new Map<string, number>(), outD = new Map<string, number>();
  ids.forEach((id, i) => { degree.set(id, und[i].size); inD.set(id, inAdj[i].size); outD.set(id, outAdj[i].size); });
  let pr = new Array<number>(n).fill(n ? 1 / n : 0); const d = 0.85;
  for (let it = 0; it < 100 && n > 0; it++) {
    let dangling = 0; for (let i = 0; i < n; i++) if (outAdj[i].size === 0) dangling += pr[i];
    const next = new Array<number>(n).fill((1 - d) / n + (d * dangling) / n);
    for (let i = 0; i < n; i++) if (outAdj[i].size) { const share = (d * pr[i]) / outAdj[i].size; for (const j of outAdj[i]) next[j] += share; }
    let delta = 0; for (let i = 0; i < n; i++) delta += Math.abs(next[i] - pr[i]); pr = next; if (delta < 1e-10) break;
  }
  const pagerank = new Map(ids.map((id, i) => [id, pr[i]]));
  const comp = new Array<number>(n).fill(-1); const components: string[][] = [];
  for (let s = 0; s < n; s++) { if (comp[s] !== -1) continue; const c = components.length; const members: number[] = []; const stack = [s]; comp[s] = c; while (stack.length) { const x = stack.pop()!; members.push(x); for (const y of und[x]) if (comp[y] === -1) { comp[y] = c; stack.push(y); } } components.push(members.sort((a, b) => a - b).map((i) => ids[i])); }
  components.sort((a, b) => b.length - a.length || a[0].localeCompare(b[0]));
  const communities: string[][] = [];
  // an edge counts 1 + the number of neighbours its two ends share: a link inside a dense group weighs more than a bridge between two groups
  const wCache = new Map<string, number>();
  const weight = (i: number, j: number) => { const k = i < j ? `${i}:${j}` : `${j}:${i}`; let w = wCache.get(k); if (w === undefined) { const [small, big] = und[i].size <= und[j].size ? [und[i], und[j]] : [und[j], und[i]]; w = 1; for (const x of small) if (big.has(x)) w++; wCache.set(k, w); } return w; };
  for (const c of components) {
    if (c.length < 2) continue; if (c.length < 8) { communities.push(c); continue; }
    const members = c.map((id) => idx.get(id)!); const label = new Map(members.map((i) => [i, i]));
    for (let sweep = 0; sweep < 30; sweep++) {
      let changed = false;
      for (const i of members) { const freq = new Map<number, number>(); for (const j of und[i]) freq.set(label.get(j)!, (freq.get(label.get(j)!) ?? 0) + weight(i, j)); let best = label.get(i)!, bestN = -1; for (const [l, k] of [...freq].sort((a, b) => a[0] - b[0])) if (k > bestN) { best = l; bestN = k; } if (best !== label.get(i)) { label.set(i, best); changed = true; } }
      if (!changed) break;
    }
    const groups = new Map<number, string[]>(); for (const i of members) groups.set(label.get(i)!, [...(groups.get(label.get(i)!) ?? []), ids[i]]);
    for (const g of groups.values()) if (g.length >= 2) communities.push(g.sort());
  }
  communities.sort((a, b) => b.length - a.length || a[0].localeCompare(b[0]));
  return { degree, in: inD, out: outD, pagerank, components, communities };
}

export interface PageRef { id: string; title: string; icon: string | null }
export interface Intelligence {
  computedAt: string;
  stats: { pages: number; edges: number; orphans: number; clusters: number; concepts: number; tags: number };
  centralPages: (PageRef & { degree: number; in: number; out: number; pagerank: number })[];
  centralConcepts: { id: string; name: string; pages: number; status: string; origin: string }[];
  orphans: (PageRef & { section: string; updatedAt: string })[];
  clusters: { id: string; size: number; label: string; pageIds: string[]; top: PageRef[] }[];
  recurringTopics: { kind: "tag" | "concept"; id: string; name: string; pages: number; pageIds: string[]; lastActivityAt: string | null }[];
  duplicates: { reason: "title" | "content"; pageIds: string[]; title: string }[];
}
const round = (x: number) => Math.round(x * 1e6) / 1e6;
export const fingerprint = (kind: string, parts: string[]) => createHash("sha256").update(`${kind}|${[...parts].sort().join("|")}`).digest("hex").slice(0, 40);

/**
 * The picture of the workspace, computed from real data on every call (5 queries). Pages = live, not archived, not database rows, not
 * waiting in the inbox. Edges = accepted page → page edges (document links, accepted typed relations, accepted AI link suggestions)
 * plus database relations. Lists are capped (`limit`, default 20; orphans and duplicates 200) and sorted deterministically.
 */
export async function computeIntelligence(wsId: string, opts: { limit?: number } = {}): Promise<Intelligence> {
  const limit = Math.min(100, Math.max(1, opts.limit ?? 20));
  const [pages, edges, tagRows, conceptRows] = await Promise.all([
    rows<{ id: string; title: string; icon: string | null; section: string; updated_at: Date; h: string; wc: number }>(dsql`select id, title, icon, section, updated_at, md5(plain_text) as h, word_count as wc from pages where workspace_id = ${wsId} and deleted_at is null and archived = false and database_id is null and inbox_at is null`),
    rows<{ a: string; b: string }>(dsql`select k.from_id as a, k.to_id as b from knowledge_edges k where k.workspace_id = ${wsId} and k.status = 'accepted' and k.source_kind = 'page' and k.target_kind = 'page'
      union select fr.page_id, tr.page_id from relations r join database_rows fr on fr.id = r.from_row_id join database_rows tr on tr.id = r.to_row_id join pages p on p.id = fr.page_id where p.workspace_id = ${wsId} and fr.deleted_at is null and tr.deleted_at is null`),
    rows<{ id: string; name: string; page_id: string; updated_at: Date }>(dsql`select t.id, t.name, pt.page_id, p.updated_at from tags t join page_tags pt on pt.tag_id = t.id join pages p on p.id = pt.page_id where t.workspace_id = ${wsId} and p.deleted_at is null`),
    rows<{ id: string; name: string; status: string; origin: string; page_id: string | null; updated_at: Date | null }>(dsql`select c.id, c.name, c.status, c.origin, pc.page_id, p.updated_at from concepts c left join page_concepts pc on pc.concept_id = c.id and pc.status = 'accepted' left join pages p on p.id = pc.page_id and p.deleted_at is null where c.workspace_id = ${wsId} and c.status = 'accepted'`),
  ]);
  const byId = new Map(pages.map((p) => [p.id, p])); const ref = (id: string): PageRef => { const p = byId.get(id)!; return { id, title: p.title, icon: p.icon }; };
  const live = edges.filter((e) => byId.has(e.a) && byId.has(e.b));
  const m = pureGraphMetrics(pages.map((p) => p.id), live.map((e) => [e.a, e.b]));
  const rank = [...byId.keys()].sort((x, y) => m.pagerank.get(y)! - m.pagerank.get(x)! || m.degree.get(y)! - m.degree.get(x)! || x.localeCompare(y));
  const centralPages = rank.filter((id) => m.degree.get(id)! > 0).slice(0, limit).map((id) => ({ ...ref(id), degree: m.degree.get(id)!, in: m.in.get(id)!, out: m.out.get(id)!, pagerank: round(m.pagerank.get(id)!) }));
  const orphans = pages.filter((p) => m.degree.get(p.id) === 0).sort((x, y) => new Date(y.updated_at).getTime() - new Date(x.updated_at).getTime() || x.id.localeCompare(y.id)).slice(0, 200).map((p) => ({ id: p.id, title: p.title, icon: p.icon, section: p.section, updatedAt: new Date(p.updated_at).toISOString() }));
  const clusters = m.communities.slice(0, limit).map((c) => { const top = [...c].sort((x, y) => m.pagerank.get(y)! - m.pagerank.get(x)! || x.localeCompare(y)).slice(0, 3).map(ref); return { id: fingerprint("cluster", c), size: c.length, label: top[0].title, pageIds: c, top }; });
  const topics = new Map<string, Intelligence["recurringTopics"][number]>();
  const add = (kind: "tag" | "concept", id: string, name: string, pageId: string | null, at: Date | null) => { const k = `${kind}:${id}`; const t = topics.get(k) ?? { kind, id, name, pages: 0, pageIds: [], lastActivityAt: null }; if (pageId && !t.pageIds.includes(pageId)) { t.pages++; if (t.pageIds.length < 50) t.pageIds.push(pageId); const iso = at ? new Date(at).toISOString() : null; if (iso && (!t.lastActivityAt || iso > t.lastActivityAt)) t.lastActivityAt = iso; } topics.set(k, t); };
  for (const t of tagRows) add("tag", t.id, t.name, t.page_id, t.updated_at);
  const conceptPages = new Map<string, { id: string; name: string; status: string; origin: string; pages: number }>();
  for (const c of conceptRows) { const live2 = c.page_id && c.updated_at ? c.page_id : null; add("concept", c.id, c.name, live2, c.updated_at); const x = conceptPages.get(c.id) ?? { id: c.id, name: c.name, status: c.status, origin: c.origin, pages: 0 }; if (live2) x.pages++; conceptPages.set(c.id, x); }
  const recurringTopics = [...topics.values()].filter((t) => t.pages >= 2).sort((x, y) => y.pages - x.pages || x.name.localeCompare(y.name) || x.id.localeCompare(y.id)).slice(0, limit).map((t) => ({ ...t, pageIds: [...t.pageIds].sort() }));
  const centralConcepts = [...conceptPages.values()].sort((x, y) => y.pages - x.pages || x.name.localeCompare(y.name)).slice(0, limit);
  const dup: Intelligence["duplicates"] = []; const group = (key: (p: (typeof pages)[number]) => string | null, reason: "title" | "content") => { const g = new Map<string, string[]>(); for (const p of pages) { const k = key(p); if (k) g.set(k, [...(g.get(k) ?? []), p.id]); } for (const idsOf of g.values()) if (idsOf.length > 1) dup.push({ reason, pageIds: idsOf.sort(), title: byId.get(idsOf.sort()[0])!.title }); };
  group((p) => (p.wc >= 5 ? p.h : null), "content"); // same text, at least 5 words (empty pages are not "duplicates")
  group((p) => { const t = p.title.trim().toLowerCase().replace(/\s+/g, " "); return t && t !== "untitled" && t !== "sans titre" ? t : null; }, "title");
  const duplicates = dup.sort((x, y) => x.reason.localeCompare(y.reason) || x.pageIds[0].localeCompare(y.pageIds[0])).slice(0, 200);
  return { computedAt: new Date().toISOString(), stats: { pages: pages.length, edges: live.length, orphans: pages.filter((p) => m.degree.get(p.id) === 0).length, clusters: m.communities.length, concepts: conceptPages.size, tags: new Set(tagRows.map((t) => t.id)).size }, centralPages, centralConcepts, orphans, clusters, recurringTopics, duplicates };
}
