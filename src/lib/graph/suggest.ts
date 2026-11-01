/**
 * AI link suggestions. Candidates = top-k pages by cosine similarity between page chunks (pgvector HNSW, one SQL
 * query), excluding self, already-linked pages and pairs that already carry an ai_suggested edge (any status — a
 * rejected pair is never re-suggested). A quick model then confirms each pair (structured JSON) and writes a
 * one-sentence rationale + confidence; related pairs are stored as knowledge_edges kind=ai_suggested status=suggested.
 */
import { sql as dsql } from "drizzle-orm";
import { db, schema } from "@/db";
import { route, EMBEDDING_MODEL } from "@/lib/ai/router";
import { callAI } from "@/lib/ai/providers";
import { recordUsage } from "@/lib/ai/usage";
import { INJECTION_GUARD } from "@/lib/ai/prompts";

const rows = async <T = any>(q: ReturnType<typeof dsql>): Promise<T[]> => (await db.execute(q)) as unknown as T[];
export interface Candidate { id: string; title: string; type: string; section: string; excerpt: string; sim: number; hits: number }
export interface SuggestResult { pageId: string; candidates: number; suggested: number; declined: number; model?: string; costUsd?: number | null; skipped?: string }

/** Nearest pages by chunk-embedding cosine similarity (max over chunk pairs), excluding self / linked / already-judged pairs. */
export async function nearestPages(wsId: string, pageId: string, k = 8, minSim = 0.25): Promise<Candidate[]> {
  return rows<Candidate>(dsql`
    with src as (
      select e.embedding as v from embeddings e join chunks c on c.id = e.chunk_id
      where c.workspace_id = ${wsId} and c.page_id = ${pageId} and e.model = ${EMBEDDING_MODEL} order by c.ordinal limit 24),
    nn as (
      select n.page_id, n.sim from src s cross join lateral (
        select c.page_id, 1 - (e.embedding <=> s.v) as sim from embeddings e join chunks c on c.id = e.chunk_id
        where c.workspace_id = ${wsId} and c.page_id is not null and c.page_id <> ${pageId} and e.model = ${EMBEDDING_MODEL}
        order by e.embedding <=> s.v limit 20) n)
    select p.id, p.title, p.type, p.section, left(p.plain_text, 1200) as excerpt, max(nn.sim)::float as sim, count(*)::int as hits
    from nn join pages p on p.id = nn.page_id
    where p.deleted_at is null
      and not exists (select 1 from links l where (l.from_page_id = ${pageId} and l.to_page_id = p.id) or (l.from_page_id = p.id and l.to_page_id = ${pageId}))
      and not exists (select 1 from knowledge_edges x where x.kind = 'ai_suggested' and ((x.from_id = ${pageId} and x.to_id = p.id) or (x.from_id = p.id and x.to_id = ${pageId})))
    group by p.id having max(nn.sim) >= ${minSim}
    order by sim desc limit ${k}`);
}

const SCHEMA = { name: "link_suggestions", schema: { type: "object", additionalProperties: false, required: ["results"], properties: { results: { type: "array", items: { type: "object", additionalProperties: false, required: ["id", "related", "confidence", "rationale"], properties: { id: { type: "string", description: "candidate id, copied verbatim" }, related: { type: "boolean", description: "true only if the two pages are genuinely about the same topic, project, entity or question and a reader of one would benefit from the other" }, confidence: { type: "number", description: "0 to 1" }, rationale: { type: "string", description: "one sentence, in the language of the pages, naming the concrete shared topic" } } } } } } };
const SYSTEM = `You curate the knowledge graph of a private research workspace. You receive a SOURCE page and candidate pages that are semantically close by embedding. For each candidate decide whether a link between the two pages is genuinely useful: they discuss the same specific topic, project, entity, dataset, course, paper or question — not merely the same broad field or a shared writing style. Be strict: generic similarity (both are "notes", both mention finance) is NOT a link. Return one result per candidate id, in the same order. ${INJECTION_GUARD}`;
const clamp01 = (x: unknown) => Math.max(0, Math.min(1, Number(x) || 0));

/** Suggest links for one page. k = max candidates sent to the model. */
export async function suggestLinksForPage(wsId: string, pageId: string, opts: { k?: number; minSim?: number } = {}): Promise<SuggestResult> {
  const [src] = await rows<{ id: string; title: string; type: string; section: string; excerpt: string }>(dsql`select id, title, type, section, left(plain_text, 2000) as excerpt from pages where id = ${pageId} and workspace_id = ${wsId} and deleted_at is null`);
  if (!src) return { pageId, candidates: 0, suggested: 0, declined: 0, skipped: "page not found" };
  const cands = await nearestPages(wsId, pageId, opts.k ?? 8, opts.minSim ?? 0.25);
  if (!cands.length) return { pageId, candidates: 0, suggested: 0, declined: 0, skipped: "no candidates" };
  const r = await route({ task: "quick", schema: true });
  const user = [`<workspace>`, `SOURCE PAGE (id ${src.id}) — ${src.title} [${src.type}/${src.section}]`, src.excerpt || "(empty)", "", ...cands.flatMap((c) => [`CANDIDATE id=${c.id} — ${c.title} [${c.type}/${c.section}] similarity=${c.sim.toFixed(2)}`, c.excerpt || "(empty)", ""]), `</workspace>`, `Judge each of the ${cands.length} candidates. Candidate ids: ${cands.map((c) => c.id).join(", ")}.`].join("\n");
  const t0 = performance.now();
  let parsed: { results: { id: string; related: boolean; confidence: number; rationale: string }[] };
  try {
    const res = await callAI({ model: r.model.id, provider: r.provider, system: SYSTEM, messages: [{ role: "user", content: user }], jsonSchema: SCHEMA, effort: r.effort, maxTokens: 2000, timeoutMs: 120_000 });
    await recordUsage({ workspaceId: wsId, provider: r.provider, model: r.model.id, task: "suggest-links", usage: res.usage, costUsd: res.costUsd, latencyMs: res.totalMs, ttftMs: res.ttftMs, ok: true, refId: pageId });
    try { parsed = JSON.parse(res.text); } catch { throw new Error("model returned invalid JSON"); }
    const byId = new Map(cands.map((c) => [c.id, c])); let suggested = 0, declined = 0;
    for (const x of parsed.results ?? []) {
      const c = byId.get(String(x.id)); if (!c) continue; byId.delete(c.id);
      const related = Boolean(x.related) && clamp01(x.confidence) >= 0.35;
      await db.insert(schema.knowledgeEdges).values({ workspaceId: wsId, fromId: pageId, toId: c.id, fromType: "page", toType: "page", kind: "ai_suggested", status: related ? "suggested" : "rejected", confidence: clamp01(x.confidence), rationale: String(x.rationale ?? "").slice(0, 600), model: r.model.id, decidedAt: null }).onConflictDoNothing();
      if (related) suggested++; else declined++;
    }
    return { pageId, candidates: cands.length, suggested, declined, model: r.model.id, costUsd: res.costUsd };
  } catch (e: any) {
    await recordUsage({ workspaceId: wsId, provider: r.provider, model: r.model.id, task: "suggest-links", ok: false, error: String(e?.message ?? e).slice(0, 300), latencyMs: performance.now() - t0, refId: pageId });
    throw e;
  }
}

/** Batched workspace pass: every page that has embeddings, most recently edited first (bounded per run). */
export async function suggestLinksForWorkspace(wsId: string, opts: { limit?: number; k?: number } = {}) {
  const pages = await rows<{ id: string }>(dsql`select p.id from pages p where p.workspace_id = ${wsId} and p.deleted_at is null and exists (select 1 from chunks c join embeddings e on e.chunk_id = c.id where c.page_id = p.id and e.model = ${EMBEDDING_MODEL}) order by p.updated_at desc limit ${opts.limit ?? 150}`);
  const out = { pages: pages.length, suggested: 0, declined: 0, failed: 0 };
  for (const p of pages) { try { const r = await suggestLinksForPage(wsId, p.id, { k: opts.k ?? 5 }); out.suggested += r.suggested; out.declined += r.declined; } catch (e) { out.failed++; console.error("[suggest-links]", p.id, e); } }
  return out;
}
