/**
 * Knowledge-graph service: nodes (pages by type, attachments, tags) + edges (links / backlinks, database relations,
 * AI-suggested edges, attachments, tag membership). Set-based SQL only (5 queries per build, no N+1) so it stays
 * fast for ~10k pages; the neighbourhood walk does ≤ depth queries.
 */
import { and, eq, sql as dsql } from "drizzle-orm";
import { db, schema } from "@/db";
import { HttpError } from "@/lib/errors";
import { NODE_KINDS, type EdgeKind, type GraphData, type GraphEdge, type GraphFilters, type GraphNode, type NodeKind, type Suggestion } from "./types";

/** Postgres array literal for parameterised any() */
const pgArr = (a: string[]) => `{${a.map((x) => `"${x.replace(/"/g, "")}"`).join(",")}}`;
const rows = async <T = any>(q: ReturnType<typeof dsql>): Promise<T[]> => (await db.execute(q)) as unknown as T[];
const kindOf = (p: { type: string; databaseId: string | null }): NodeKind => (p.databaseId ? "row" : p.type === "database" ? "database" : p.type === "research" ? "research" : "page");

/** Union of page→page adjacencies (explicit links, relations, AI edges) touching the given page ids — one query per hop. */
async function adjacent(wsId: string, ids: string[], suggestions: boolean): Promise<{ a: string; b: string }[]> {
  const arr = `${pgArr(ids)}`; const st = suggestions ? dsql`('suggested','accepted')` : dsql`('accepted')`;
  return rows(dsql`
    select l.from_page_id as a, l.to_page_id as b from links l where l.from_page_id = any(${arr}::uuid[]) or l.to_page_id = any(${arr}::uuid[])
    union
    select fr.page_id, tr.page_id from relations r join database_rows fr on fr.id = r.from_row_id join database_rows tr on tr.id = r.to_row_id
      where (fr.page_id = any(${arr}::uuid[]) or tr.page_id = any(${arr}::uuid[])) and fr.deleted_at is null and tr.deleted_at is null
    union
    select k.from_id, k.to_id from knowledge_edges k where k.workspace_id = ${wsId} and k.kind <> 'link' and k.status in ${st}
      and (k.from_id = any(${arr}::uuid[]) or k.to_id = any(${arr}::uuid[]))`);
}

/** Breadth-first page ids within `depth` hops of `pageId` (depth ≤ 4). */
export async function neighbourhoodIds(wsId: string, pageId: string, depth = 1, suggestions = true): Promise<Map<string, number>> {
  const seen = new Map<string, number>([[pageId, 0]]); let frontier = [pageId];
  for (let d = 1; d <= Math.min(4, Math.max(0, depth)) && frontier.length; d++) {
    const adj = await adjacent(wsId, frontier, suggestions); const next: string[] = [];
    for (const { a, b } of adj) for (const id of [a, b]) if (!seen.has(id)) { seen.set(id, d); next.push(id); }
    frontier = next;
  }
  return seen;
}

export async function buildGraph(wsId: string, f: GraphFilters = {}): Promise<GraphData> {
  const types = new Set<NodeKind>(f.types?.length ? f.types : NODE_KINDS);
  const suggestions = f.suggestions !== false;
  let ids: string[] | null = null; let center: string | null = null;
  if (f.pageId) { center = f.pageId; ids = [...(await neighbourhoodIds(wsId, f.pageId, f.depth ?? 1, suggestions)).keys()]; }
  const where = [dsql`p.workspace_id = ${wsId}`, dsql`p.deleted_at is null`];
  if (f.section) where.push(dsql`p.section = ${f.section}`);
  if (f.since) where.push(dsql`p.updated_at >= ${f.since.toISOString()}::timestamptz`);
  if (ids) where.push(dsql`p.id = any(${pgArr(ids)}::uuid[])`);
  const pageRows = await rows<{ id: string; type: string; section: string; title: string; icon: string | null; database_id: string | null; updated_at: Date }>(
    dsql`select p.id, p.type, p.section, p.title, p.icon, p.database_id, p.updated_at from pages p where ${dsql.join(where, dsql` and `)}`);
  const nodes = new Map<string, GraphNode>();
  for (const p of pageRows) { const kind = kindOf({ type: p.type, databaseId: p.database_id }); if (!types.has(kind)) continue; nodes.set(p.id, { id: p.id, kind, title: p.title || "Untitled", icon: p.icon, section: p.section, updatedAt: p.updated_at ? new Date(p.updated_at).toISOString() : null, databaseId: p.database_id, degree: 0, in: 0, out: 0 }); }
  const pageIds = [...nodes.keys()];
  const edges: GraphEdge[] = []; const seenPair = new Set<string>();
  const push = (e: GraphEdge) => { if (!nodes.has(e.source) || !nodes.has(e.target) || e.source === e.target) return; const k = `${e.kind}|${e.source}|${e.target}`; if (seenPair.has(k)) return; seenPair.add(k); edges.push(e); };
  if (pageIds.length) {
    const inSet = dsql`${pgArr(pageIds)}::uuid[]`;
    const [links, rels, kedges] = await Promise.all([
      rows<{ id: string; a: string; b: string; kind: string }>(dsql`select l.id, l.from_page_id as a, l.to_page_id as b, l.kind from links l where l.from_page_id = any(${inSet}) and l.to_page_id = any(${inSet})`),
      types.has("row") ? rows<{ id: string; a: string; b: string; prop: string }>(dsql`select r.id, fr.page_id as a, tr.page_id as b, dp.name as prop from relations r join database_rows fr on fr.id = r.from_row_id join database_rows tr on tr.id = r.to_row_id join database_properties dp on dp.id = r.property_id where fr.page_id = any(${inSet}) and tr.page_id = any(${inSet}) and fr.deleted_at is null and tr.deleted_at is null`) : Promise.resolve([]),
      rows<{ id: string; a: string; b: string; status: string; confidence: number | null; rationale: string | null; model: string | null; kind: string }>(dsql`select k.id, k.from_id as a, k.to_id as b, k.status, k.confidence, k.rationale, k.model, k.kind from knowledge_edges k where k.workspace_id = ${wsId} and k.kind <> 'link' and k.status in ${suggestions ? dsql`('suggested','accepted')` : dsql`('accepted')`} and k.from_id = any(${inSet}) and k.to_id = any(${inSet})`),
    ]);
    for (const l of links) push({ id: l.id, source: l.a, target: l.b, kind: "link", status: "accepted", sub: l.kind, confidence: null, rationale: null });
    for (const r of rels) push({ id: r.id, source: r.a, target: r.b, kind: "relation", status: "accepted", sub: r.prop, confidence: null, rationale: null });
    for (const k of kedges) {
      // accepted AI edges are mirrored as links(kind=ai) and a suggestion is moot once the pair is explicitly linked: draw the confirmed line once
      if (seenPair.has(`link|${k.a}|${k.b}`) || seenPair.has(`link|${k.b}|${k.a}`)) {
        // …but keep the provenance of an accepted AI link on the confirmed edge (why it exists, which model proposed it, how sure it was).
        if (k.status === "accepted") {
          const mirrored = edges.find((e) => e.kind === "link" && e.sub === "ai" && ((e.source === k.a && e.target === k.b) || (e.source === k.b && e.target === k.a)));
          if (mirrored) { mirrored.rationale = k.rationale; mirrored.confidence = k.confidence; mirrored.model = k.model; }
        }
        continue;
      }
      push({ id: k.id, source: k.a, target: k.b, kind: "ai_suggested", status: k.status === "suggested" ? "suggested" : "accepted", sub: k.model, confidence: k.confidence, rationale: k.rationale, model: k.model });
    }
    if (types.has("attachment")) {
      const atts = await rows<{ id: string; page_id: string; filename: string; created_at: Date }>(dsql`select a.id, a.page_id, a.filename, a.created_at from attachments a where a.workspace_id = ${wsId} and a.deleted_at is null and a.page_id = any(${inSet})`);
      for (const a of atts) { const id = `att:${a.id}`; nodes.set(id, { id, kind: "attachment", title: a.filename, icon: null, section: null, updatedAt: new Date(a.created_at).toISOString(), databaseId: null, degree: 0, in: 0, out: 0 }); push({ id: `e-att-${a.id}`, source: a.page_id, target: id, kind: "attachment", status: "accepted", sub: null, confidence: null, rationale: null }); }
    }
    if (types.has("tag")) {
      const tg = await rows<{ id: string; name: string; color: string | null; page_id: string }>(dsql`select t.id, t.name, t.color, pt.page_id from tags t join page_tags pt on pt.tag_id = t.id where t.workspace_id = ${wsId} and pt.page_id = any(${inSet})`);
      for (const t of tg) { const id = `tag:${t.id}`; if (!nodes.has(id)) nodes.set(id, { id, kind: "tag", title: `#${t.name}`, icon: null, section: null, updatedAt: null, databaseId: null, degree: 0, in: 0, out: 0 }); push({ id: `e-tag-${t.id}-${t.page_id}`, source: t.page_id, target: id, kind: "tag", status: "accepted", sub: t.color, confidence: null, rationale: null }); }
    }
  }
  for (const e of edges) { const s = nodes.get(e.source)!, t = nodes.get(e.target)!; s.degree++; t.degree++; s.out++; t.in++; }
  let out = [...nodes.values()];
  if (f.hideOrphans) out = out.filter((n) => n.degree > 0 || n.id === center);
  return { nodes: out, edges, center, stats: { pages: pageIds.length, edges: edges.length, suggested: edges.filter((e) => e.status === "suggested").length } };
}

/** Depth-N neighbourhood of a page (mini graph). */
export async function pageNeighbourhood(wsId: string, pageId: string, depth = 1, opts: { suggestions?: boolean; types?: NodeKind[] } = {}) {
  return buildGraph(wsId, { pageId, depth, suggestions: opts.suggestions ?? true, types: opts.types });
}

/** Pending / decided AI suggestions with page titles. */
export async function listSuggestions(wsId: string, status: "suggested" | "accepted" | "rejected" = "suggested", opts: { pageId?: string | null; limit?: number } = {}): Promise<Suggestion[]> {
  const extra = opts.pageId ? dsql`and (k.from_id = ${opts.pageId} or k.to_id = ${opts.pageId})` : dsql``;
  const r = await rows<any>(dsql`select k.id, k.from_id, k.to_id, k.status, k.confidence, k.rationale, k.model, k.created_at, k.decided_at, a.title as from_title, a.icon as from_icon, b.title as to_title, b.icon as to_icon
    from knowledge_edges k join pages a on a.id = k.from_id and a.deleted_at is null join pages b on b.id = k.to_id and b.deleted_at is null
    where k.workspace_id = ${wsId} and k.kind = 'ai_suggested' and k.status = ${status} ${extra}
      and (${status} <> 'suggested' or not exists (select 1 from links l where (l.from_page_id = k.from_id and l.to_page_id = k.to_id) or (l.from_page_id = k.to_id and l.to_page_id = k.from_id)))
    order by k.confidence desc nulls last, k.created_at desc limit ${opts.limit ?? 200}`);
  return r.map((k) => ({ id: k.id, fromId: k.from_id, toId: k.to_id, status: k.status, confidence: k.confidence, rationale: k.rationale, model: k.model, createdAt: new Date(k.created_at).toISOString(), decidedAt: k.decided_at ? new Date(k.decided_at).toISOString() : null, fromTitle: k.from_title, fromIcon: k.from_icon, toTitle: k.to_title, toIcon: k.to_icon }));
}
export async function suggestionCounts(wsId: string) {
  const r = await rows<{ status: string; n: number }>(dsql`select k.status, count(*)::int as n from knowledge_edges k where k.workspace_id = ${wsId} and k.kind = 'ai_suggested'
    and (k.status <> 'suggested' or not exists (select 1 from links l where (l.from_page_id = k.from_id and l.to_page_id = k.to_id) or (l.from_page_id = k.to_id and l.to_page_id = k.from_id))) group by k.status`);
  const c = { suggested: 0, accepted: 0, rejected: 0 } as Record<string, number>; for (const x of r) c[x.status] = Number(x.n); return c;
}

/** Accept (→ links kind=ai so it becomes a real backlink) or reject (never re-suggested) an AI suggestion. */
export async function decideSuggestion(wsId: string, id: string, status: "accepted" | "rejected") {
  const [k] = await db.select().from(schema.knowledgeEdges).where(and(eq(schema.knowledgeEdges.id, id), eq(schema.knowledgeEdges.workspaceId, wsId)));
  if (!k) throw new HttpError(404, "Suggestion not found");
  await db.update(schema.knowledgeEdges).set({ status, decidedAt: new Date() }).where(eq(schema.knowledgeEdges.id, id));
  if (status === "accepted") await db.insert(schema.links).values({ fromPageId: k.fromId, toPageId: k.toId, kind: "ai" }).onConflictDoNothing();
  else await db.delete(schema.links).where(and(eq(schema.links.fromPageId, k.fromId), eq(schema.links.toPageId, k.toId), eq(schema.links.kind, "ai")));
  return { ...k, status };
}

/**
 * Undo a decision: the suggestion goes back to the review queue (status = suggested) and the link created by an
 * acceptance is removed. Rationale, confidence and model are left untouched.
 */
export async function revertSuggestion(wsId: string, id: string) {
  const [k] = await db.select().from(schema.knowledgeEdges).where(and(eq(schema.knowledgeEdges.id, id), eq(schema.knowledgeEdges.workspaceId, wsId), eq(schema.knowledgeEdges.kind, "ai_suggested")));
  if (!k) throw new HttpError(404, "Suggestion not found");
  await db.update(schema.knowledgeEdges).set({ status: "suggested", decidedAt: null }).where(eq(schema.knowledgeEdges.id, id));
  await db.delete(schema.links).where(and(eq(schema.links.fromPageId, k.fromId), eq(schema.links.toPageId, k.toId), eq(schema.links.kind, "ai")));
  return { ...k, previousStatus: k.status, status: "suggested" as const };
}

/** Linked pages of one page (both directions, confirmed only) for the inspector. */
export async function linkedPages(wsId: string, pageId: string) {
  return rows<{ id: string; title: string; icon: string | null; kind: EdgeKind; direction: "out" | "in" }>(dsql`
    select p.id, p.title, p.icon, 'link'::text as kind, case when l.from_page_id = ${pageId} then 'out' else 'in' end as direction
    from links l join pages p on p.id = case when l.from_page_id = ${pageId} then l.to_page_id else l.from_page_id end
    where (l.from_page_id = ${pageId} or l.to_page_id = ${pageId}) and p.workspace_id = ${wsId} and p.deleted_at is null
    union
    select p.id, p.title, p.icon, 'relation'::text, case when fr.page_id = ${pageId} then 'out' else 'in' end
    from relations r join database_rows fr on fr.id = r.from_row_id join database_rows tr on tr.id = r.to_row_id
    join pages p on p.id = case when fr.page_id = ${pageId} then tr.page_id else fr.page_id end
    where (fr.page_id = ${pageId} or tr.page_id = ${pageId}) and p.workspace_id = ${wsId} and p.deleted_at is null
    order by 2`);
}
