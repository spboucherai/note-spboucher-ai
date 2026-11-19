/**
 * File: src/lib/graph/constellation.ts
 * Description: Thought Constellation (Labs) — notes placed by meaning. Each live page that has embeddings gets the mean of its
 *   chunk embeddings; the cloud is projected to the plane by a deterministic PCA (src/lib/graph/projection.ts). The projection is
 *   cached per workspace (settings row `graph.constellation:<workspace>`) and recomputed only when the set of embeddings changed
 *   (signature = model + number of embeddings + date of the latest one + number of embedded pages). Titles, projects, tags and
 *   links are read live at each call, so a rename never waits for a recomputation. No model is called here: the vectors are the
 *   ones the search index already stores. A workspace without embeddings gets `embedded: 0` and no point — never a made-up layout.
 * Author: Simon-Pierre Boucher · contact@spboucher.ai
 */
import { eq, sql as dsql } from "drizzle-orm";
import { db, schema } from "@/db";
import { EMBEDDING_MODEL } from "@/lib/ai/router";
import { pca2, spreadOverlaps, kmeans2d, clusterCount } from "./projection";

const rows = async <T = any>(q: ReturnType<typeof dsql>): Promise<T[]> => (await db.execute(q)) as unknown as T[];
export const CONSTELLATION_MAX_PAGES = 5000; const BATCH = 400;
const KEY = (wsId: string) => `graph.constellation:${wsId}`;
interface Cached { signature: string; model: string; computedAt: string; explained: [number, number]; points: [string, number, number][]; truncated: boolean }
export interface ConstellationPoint { id: string; title: string; icon: string | null; type: string; section: string; x: number; y: number; cluster: number; projectId: string | null; tags: string[]; updatedAt: string; words: number; degree: number }
export interface Constellation {
  model: string; computedAt: string | null; cached: boolean; signature: string | null; explained: [number, number];
  /** live, non-archived pages outside the inbox / of which `embedded` have vectors / of which `shown` are on the map (cap 5 000, most recently edited first) */
  stats: { pages: number; embedded: number; shown: number; links: number; truncated: boolean };
  points: ConstellationPoint[];
  clusters: { id: number; x: number; y: number; r: number; size: number; label: string; topTags: string[] }[];
  links: { id: string; source: string; target: string; kind: string; relType: string; origin: string }[];
  projects: { id: string; title: string; icon: string | null; pages: number }[];
  tags: { name: string; color: string | null; pages: number }[];
}

async function signatureOf(wsId: string) {
  const [s] = await rows<{ n: number; pages: number; latest: Date | null }>(dsql`select count(*)::int as n, count(distinct c.page_id)::int as pages, max(e.created_at) as latest from embeddings e join chunks c on c.id = e.chunk_id join pages p on p.id = c.page_id
    where c.workspace_id = ${wsId} and c.source_type = 'page' and e.model = ${EMBEDDING_MODEL} and p.deleted_at is null and p.archived = false and p.inbox_at is null`);
  return { signature: `${EMBEDDING_MODEL}:${s?.n ?? 0}:${s?.pages ?? 0}:${s?.latest ? new Date(s.latest).toISOString() : "-"}`, embedded: s?.pages ?? 0 };
}
/** Mean embedding per page (pgvector `avg`), read in batches; the most recently edited pages first when the workspace exceeds the cap. */
async function project(wsId: string, signature: string, embedded: number): Promise<Cached> {
  const ids = (await rows<{ id: string }>(dsql`select p.id from pages p where p.workspace_id = ${wsId} and p.deleted_at is null and p.archived = false and p.inbox_at is null
    and exists (select 1 from chunks c join embeddings e on e.chunk_id = c.id where c.page_id = p.id and c.source_type = 'page' and e.model = ${EMBEDDING_MODEL}) order by p.updated_at desc, p.id limit ${CONSTELLATION_MAX_PAGES}`)).map((r) => r.id);
  ids.sort(); // the projection must not depend on edit order
  const vectors: Float32Array[] = []; const kept: string[] = [];
  for (let i = 0; i < ids.length; i += BATCH) {
    const part = ids.slice(i, i + BATCH);
    const got = await rows<{ id: string; v: string }>(dsql`select c.page_id as id, avg(e.embedding)::text as v from embeddings e join chunks c on c.id = e.chunk_id where c.page_id = any(${`{${part.join(",")}}`}::uuid[]) and c.source_type = 'page' and e.model = ${EMBEDDING_MODEL} group by c.page_id order by c.page_id`);
    for (const g of got) { const v = Float32Array.from(JSON.parse(g.v) as number[]); if (v.length) { vectors.push(v); kept.push(g.id); } }
  }
  const p = pca2(vectors); const coords = spreadOverlaps(p.coords);
  const value: Cached = { signature, model: EMBEDDING_MODEL, computedAt: new Date().toISOString(), explained: p.explained, points: kept.map((id, i) => [id, coords[i][0], coords[i][1]]), truncated: embedded > kept.length };
  await db.insert(schema.settings).values({ key: KEY(wsId), value }).onConflictDoUpdate({ target: schema.settings.key, set: { value, updatedAt: new Date() } });
  return value;
}

export async function buildConstellation(wsId: string, opts: { refresh?: boolean } = {}): Promise<Constellation> {
  const [{ signature, embedded }, [total]] = await Promise.all([signatureOf(wsId), rows<{ n: number }>(dsql`select count(*)::int as n from pages where workspace_id = ${wsId} and deleted_at is null and archived = false and inbox_at is null`)]);
  const empty: Constellation = { model: EMBEDDING_MODEL, computedAt: null, cached: false, signature: null, explained: [0, 0], stats: { pages: total?.n ?? 0, embedded: 0, shown: 0, links: 0, truncated: false }, points: [], clusters: [], links: [], projects: [], tags: [] };
  if (!embedded) return empty;
  const [stored] = await db.select().from(schema.settings).where(eq(schema.settings.key, KEY(wsId)));
  const hit = stored?.value as Cached | undefined; const fresh = !hit || hit.signature !== signature || opts.refresh;
  const proj = fresh ? await project(wsId, signature, embedded) : hit!;
  const pos = new Map(proj.points.map(([id, x, y]) => [id, [x, y] as [number, number]]));
  const idArr = `{${[...pos.keys()].join(",")}}`;
  const [pages, tagRows, edges, tree] = await Promise.all([
    rows<{ id: string; title: string; icon: string | null; type: string; section: string; updated_at: Date; word_count: number }>(dsql`select id, title, icon, type, section, updated_at, word_count from pages where workspace_id = ${wsId} and id = any(${idArr}::uuid[]) and deleted_at is null and archived = false and inbox_at is null`),
    rows<{ page_id: string; name: string; color: string | null }>(dsql`select pt.page_id, t.name, t.color from page_tags pt join tags t on t.id = pt.tag_id where t.workspace_id = ${wsId} and pt.page_id = any(${idArr}::uuid[]) order by t.name`),
    rows<{ id: string; from_id: string; to_id: string; kind: string; rel_type: string; origin: string }>(dsql`select id, from_id, to_id, kind, rel_type, origin from knowledge_edges where workspace_id = ${wsId} and status = 'accepted' and source_kind = 'page' and target_kind = 'page' and from_id = any(${idArr}::uuid[]) and to_id = any(${idArr}::uuid[]) and from_id <> to_id order by created_at, id limit 20000`),
    rows<{ id: string; parent_id: string | null; section: string; title: string; icon: string | null }>(dsql`select id, parent_id, section, title, icon from pages where workspace_id = ${wsId} and deleted_at is null`),
  ]);
  // project of a page = its top-most ancestor (or itself) in the section `projects`
  const byId = new Map(tree.map((t) => [t.id, t])); const projectOf = (id: string): string | null => { let cur = byId.get(id); let root: string | null = null; const seen = new Set<string>(); while (cur && !seen.has(cur.id)) { seen.add(cur.id); if (cur.section === "projects") root = cur.id; cur = cur.parent_id ? byId.get(cur.parent_id) : undefined; } return root; };
  const tagsOf = new Map<string, string[]>(); const tagMeta = new Map<string, { color: string | null; pages: number }>();
  for (const t of tagRows) { tagsOf.set(t.page_id, [...(tagsOf.get(t.page_id) ?? []), t.name]); const m = tagMeta.get(t.name) ?? { color: t.color, pages: 0 }; m.pages++; tagMeta.set(t.name, m); }
  const degree = new Map<string, number>(); const seenPair = new Set<string>(); const links: Constellation["links"] = [];
  for (const e of edges) { const k = e.from_id < e.to_id ? `${e.from_id}|${e.to_id}` : `${e.to_id}|${e.from_id}`; if (seenPair.has(k)) continue; seenPair.add(k); links.push({ id: e.id, source: e.from_id, target: e.to_id, kind: e.kind, relType: e.rel_type, origin: e.origin }); degree.set(e.from_id, (degree.get(e.from_id) ?? 0) + 1); degree.set(e.to_id, (degree.get(e.to_id) ?? 0) + 1); }
  const live = pages.sort((a, b) => a.id.localeCompare(b.id)); const coords = live.map((p) => pos.get(p.id)!);
  const km = kmeans2d(coords, clusterCount(live.length));
  const points: ConstellationPoint[] = live.map((p, i) => ({ id: p.id, title: p.title || "Untitled", icon: p.icon, type: p.type, section: p.section, x: coords[i][0], y: coords[i][1], cluster: km.assign[i], projectId: projectOf(p.id), tags: tagsOf.get(p.id) ?? [], updatedAt: new Date(p.updated_at).toISOString(), words: p.word_count ?? 0, degree: degree.get(p.id) ?? 0 }));
  const clusters = km.centers.map((c, id) => {
    const members = points.filter((p) => p.cluster === id); let best = members[0]; for (const m of members) if ((m.x - c[0]) ** 2 + (m.y - c[1]) ** 2 < (best.x - c[0]) ** 2 + (best.y - c[1]) ** 2 - 1e-12) best = m;
    const count = new Map<string, number>(); for (const m of members) for (const t of m.tags) count.set(t, (count.get(t) ?? 0) + 1);
    return { id, x: c[0], y: c[1], r: km.radii[id], size: km.sizes[id], label: best?.title ?? "", topTags: [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 3).map(([t]) => t) };
  });
  const projCount = new Map<string, number>(); for (const p of points) if (p.projectId) projCount.set(p.projectId, (projCount.get(p.projectId) ?? 0) + 1);
  return {
    model: proj.model, computedAt: proj.computedAt, cached: !fresh, signature: proj.signature, explained: proj.explained,
    stats: { pages: total?.n ?? 0, embedded, shown: points.length, links: links.length, truncated: proj.truncated }, points, clusters, links,
    projects: [...projCount.entries()].map(([id, n]) => ({ id, title: byId.get(id)?.title || "Untitled", icon: byId.get(id)?.icon ?? null, pages: n })).sort((a, b) => b.pages - a.pages || a.id.localeCompare(b.id)),
    tags: [...tagMeta.entries()].map(([name, m]) => ({ name, color: m.color, pages: m.pages })).sort((a, b) => b.pages - a.pages || a.name.localeCompare(b.name)),
  };
}
