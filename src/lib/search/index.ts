import { pgIso, pgNum } from "@/lib/pg-values";
import { and, eq, inArray, isNull, sql as dsql } from "drizzle-orm";
import { db, schema } from "@/db";
import { chunkDocument, chunkPlainText, type Chunk } from "./chunk";
import { embedTexts, EMBEDDING_VERSION } from "./embed";
import { EMBEDDING_MODEL } from "@/lib/ai/router";
import { createHash } from "node:crypto";
/** Postgres array literal for parameterised any()/all() */
const pgArr = (a: string[]) => `{${a.map((x) => `"${x.replace(/"/g, "")}"`).join(",")}}`;

/** Incremental indexing of one source (page | attachment | row). Skips when content hash unchanged; re-embeds only changed chunks. */
export async function indexSource(workspaceId: string, sourceType: "page" | "attachment" | "row", sourceId: string, title: string, content: { doc?: any; text?: string }, pageId?: string | null) {
  const chunks: Chunk[] = content.doc ? chunkDocument(title, content.doc) : chunkPlainText(content.text ?? "");
  // The source hash covers the text AND the block anchors: a page whose paragraphs only received their ids must still refresh its anchors (no re-embedding: passage hashes are unchanged).
  const fullHash = createHash("sha256").update(chunks.map((c) => `${c.contentHash}:${c.blockId ?? ""}:${c.heading ?? ""}`).join("|")).digest("hex");
  const [state] = await db.select().from(schema.indexState).where(and(eq(schema.indexState.sourceType, sourceType), eq(schema.indexState.sourceId, sourceId)));
  if (state && state.contentHash === fullHash && state.model === EMBEDDING_MODEL && state.version === EMBEDDING_VERSION) return { skipped: true, chunks: chunks.length };
  const existing = await db.select({ id: schema.chunks.id, ordinal: schema.chunks.ordinal, hash: schema.chunks.contentHash, blockId: schema.chunks.blockId, heading: schema.chunks.heading }).from(schema.chunks).where(and(eq(schema.chunks.sourceType, sourceType), eq(schema.chunks.sourceId, sourceId)));
  const byOrd = new Map(existing.map((e) => [e.ordinal, e]));
  const toEmbed: { idx: number; text: string }[] = [];
  const ids: string[] = [];
  await db.transaction(async (tx) => {
    for (const c of chunks) {
      const ex = byOrd.get(c.ordinal);
      if (ex && ex.hash === c.contentHash) { ids.push(ex.id); if (ex.blockId !== c.blockId || ex.heading !== c.heading) await tx.update(schema.chunks).set({ blockId: c.blockId, heading: c.heading, pageId: pageId ?? null }).where(eq(schema.chunks.id, ex.id)); const [emb] = await tx.select({ m: schema.embeddings.model }).from(schema.embeddings).where(eq(schema.embeddings.chunkId, ex.id)); if (!emb || emb.m !== EMBEDDING_MODEL) toEmbed.push({ idx: ids.length - 1, text: (c.heading ? c.heading + "\n" : "") + c.content }); continue; }
      if (ex) { await tx.update(schema.chunks).set({ heading: c.heading, blockId: c.blockId, content: c.content, tokenCount: c.tokenCount, contentHash: c.contentHash, pageId: pageId ?? null }).where(eq(schema.chunks.id, ex.id)); ids.push(ex.id); }
      else { const [row] = await tx.insert(schema.chunks).values({ workspaceId, sourceType, sourceId, pageId: pageId ?? null, ordinal: c.ordinal, blockId: c.blockId, heading: c.heading, content: c.content, tokenCount: c.tokenCount, contentHash: c.contentHash }).returning({ id: schema.chunks.id }); ids.push(row.id); }
      toEmbed.push({ idx: ids.length - 1, text: (c.heading ? c.heading + "\n" : "") + c.content });
    }
    const stale = existing.filter((e) => e.ordinal >= chunks.length).map((e) => e.id);
    if (stale.length) await tx.delete(schema.chunks).where(inArray(schema.chunks.id, stale));
  });
  if (toEmbed.length) {
    const vecs = await embedTexts(toEmbed.map((t) => t.text));
    for (let i = 0; i < toEmbed.length; i++) {
      const chunkId = ids[toEmbed[i].idx];
      await db.insert(schema.embeddings).values({ chunkId, model: EMBEDDING_MODEL, version: EMBEDDING_VERSION, embedding: vecs[i] }).onConflictDoUpdate({ target: schema.embeddings.chunkId, set: { model: EMBEDDING_MODEL, version: EMBEDDING_VERSION, embedding: vecs[i], createdAt: new Date() } });
    }
  }
  await db.insert(schema.indexState).values({ sourceType, sourceId, contentHash: fullHash, model: EMBEDDING_MODEL, version: EMBEDDING_VERSION }).onConflictDoUpdate({ target: [schema.indexState.sourceType, schema.indexState.sourceId], set: { contentHash: fullHash, model: EMBEDDING_MODEL, version: EMBEDDING_VERSION, indexedAt: new Date() } });
  return { skipped: false, chunks: chunks.length, embedded: toEmbed.length };
}
export async function removeSource(sourceType: string, sourceId: string) {
  await db.delete(schema.chunks).where(and(eq(schema.chunks.sourceType, sourceType), eq(schema.chunks.sourceId, sourceId)));
  await db.delete(schema.indexState).where(and(eq(schema.indexState.sourceType, sourceType), eq(schema.indexState.sourceId, sourceId)));
}

export interface Hit { chunkId: string; pageId: string | null; sourceType: string; sourceId: string; title: string; icon: string | null; heading: string | null; blockId: string | null; content: string; score: number; semantic: number; keyword: number; kind?: "page" | "entry" | "file" | "reference"; section?: string | null; archived?: boolean; updatedAt?: Date | string | null; snippet?: string; more?: number; attachmentId?: string | null }
export interface SearchFilters { limit?: number; pageIds?: string[]; sourceTypes?: string[]; semantic?: boolean; kinds?: ("page" | "entry" | "file" | "reference")[]; section?: string; since?: Date; until?: Date; includeArchived?: boolean; group?: boolean }
/** Markers around matched terms in `snippet` (control characters: cannot occur in note text, so the client can split safely and never injects HTML). */
/** Cosine similarity under which a passage found by meaning alone (no word in common) is treated as noise. Empirical for text-embedding-3-small; calibrate in docs/operations.md §6. */
export const SEARCH_MIN_SEMANTIC = 0.33;
export const HL_START = "\u0001", HL_END = "\u0002";

/**
 * Hybrid retrieval: HNSW cosine + tsvector rank fused by reciprocal rank fusion, with metadata filters (kind, space, dates, archive).
 * With `group`, hits are collapsed to the best passage per source (`more` = other matching passages) and bibliographic references
 * matching the words are appended. Trashed pages never appear (their chunks are removed); archived pages only on request.
 */
export async function hybridSearch(workspaceId: string, query: string, opts: SearchFilters = {}): Promise<Hit[]> {
  const limit = opts.limit ?? 12; const k = Math.max(30, limit * 4);
  const kinds = opts.kinds?.length ? opts.kinds : null; const wantChunks = !kinds || kinds.some((x) => x !== "reference");
  const filters = [dsql`c.workspace_id = ${workspaceId}`, dsql`(c.page_id is null or p.id is not null)`];
  if (opts.pageIds?.length) filters.push(dsql`c.page_id = any(${pgArr(opts.pageIds)}::uuid[])`);
  if (opts.sourceTypes?.length) filters.push(dsql`c.source_type = any(${pgArr(opts.sourceTypes)}::text[])`);
  if (kinds) { const ors = []; if (kinds.includes("page")) ors.push(dsql`(c.source_type = 'page' and p.database_id is null)`); if (kinds.includes("entry")) ors.push(dsql`(c.source_type = 'page' and p.database_id is not null)`); if (kinds.includes("file")) ors.push(dsql`c.source_type = 'attachment'`); filters.push(ors.length ? dsql`(${dsql.join(ors, dsql` or `)})` : dsql`false`); }
  if (opts.section) filters.push(dsql`p.section = ${opts.section}`);
  if (opts.since) filters.push(dsql`coalesce(p.updated_at, c.created_at) >= ${opts.since.toISOString()}::timestamptz`);
  if (opts.until) filters.push(dsql`coalesce(p.updated_at, c.created_at) <= ${opts.until.toISOString()}::timestamptz`);
  if (!opts.includeArchived) filters.push(dsql`(p.id is null or p.archived = false)`);
  const where = dsql.join(filters, dsql` and `); const from = dsql`chunks c left join pages p on p.id = c.page_id and p.deleted_at is null`;
  const fused = new Map<string, { score: number; semantic: number; keyword: number }>();
  if (wantChunks) {
    const kw = await db.execute(dsql`select c.id, ts_rank_cd(c.tsv, q) as r from ${from}, websearch_to_tsquery('simple', ${query}) q where ${where} and c.tsv @@ q order by r desc limit ${k}`);
    let sem: any[] = [];
    if (opts.semantic !== false && process.env.OPENAI_API_KEY) {
      try { const [v] = await embedTexts([query], "search"); sem = (await db.execute(dsql`select c.id, 1 - (e.embedding <=> ${`[${v.join(",")}]`}::vector) as s from embeddings e join chunks c on c.id = e.chunk_id left join pages p on p.id = c.page_id and p.deleted_at is null where ${where} and e.model = ${EMBEDDING_MODEL} order by e.embedding <=> ${`[${v.join(",")}]`}::vector limit ${k}`)) as any[]; } catch (e) { console.error("semantic search failed", (e as Error).message); }
    }
    (kw as any[]).forEach((r, i) => { const f = fused.get(r.id) ?? { score: 0, semantic: 0, keyword: 0 }; f.score += 1 / (60 + i); f.keyword = Number(r.r); fused.set(r.id, f); });
    // A vector search always returns its k nearest passages, however unrelated: keep a meaning-only hit only above a similarity floor.
    sem.filter((r) => Number(r.s) >= SEARCH_MIN_SEMANTIC || fused.has(r.id)).forEach((r, i) => { const f = fused.get(r.id) ?? { score: 0, semantic: 0, keyword: 0 }; f.score += 1 / (60 + i); f.semantic = Number(r.s); fused.set(r.id, f); });
  }
  const ranked = [...fused.entries()].sort((a, b) => b[1].score - a[1].score).slice(0, opts.group ? k : limit);
  let hits: Hit[] = [];
  if (ranked.length) {
    const rows = await db.execute(dsql`select c.id, c.page_id, c.source_type, c.source_id, c.heading, c.block_id, c.content, p.title, p.icon, p.section, p.archived, p.database_id, p.updated_at, a.filename, a.created_at as file_at,
      ts_headline('simple', c.content, websearch_to_tsquery('simple', ${query}), ${`StartSel=${HL_START}, StopSel=${HL_END}, MaxWords=34, MinWords=14, MaxFragments=2, FragmentDelimiter=" … "`}) as snippet
      from chunks c left join pages p on p.id = c.page_id and p.deleted_at is null left join attachments a on a.id = c.source_id and c.source_type = 'attachment' where c.id = any(${pgArr(ranked.map(([id]) => id))}::uuid[])`);
    const byId = new Map((rows as any[]).map((r) => [r.id, r]));
    hits = ranked.map(([id, f]) => { const r = byId.get(id); return r ? { chunkId: id, pageId: r.page_id, sourceType: r.source_type, sourceId: r.source_id, title: (r.source_type === "attachment" ? r.filename : r.title) ?? r.title ?? r.filename ?? "Untitled", icon: r.icon ?? null, heading: r.heading, blockId: r.block_id, content: r.content, kind: r.source_type === "attachment" ? "file" : r.database_id ? "entry" : "page", section: r.section ?? null, archived: Boolean(r.archived), updatedAt: r.updated_at ?? r.file_at ?? null, snippet: r.snippet ?? undefined, attachmentId: r.source_type === "attachment" ? r.source_id : null, ...f } as Hit : null; }).filter(Boolean) as Hit[];
  }
  if (!opts.group) return hits.slice(0, limit);
  const seen = new Map<string, Hit>(); for (const h of hits) { const key = `${h.sourceType}:${h.sourceId}`; const first = seen.get(key); if (first) first.more = (first.more ?? 0) + 1; else seen.set(key, h); }
  const grouped = [...seen.values()].slice(0, limit);
  if (!kinds || kinds.includes("reference")) grouped.push(...(await searchReferences(workspaceId, query, 8, opts)));
  return grouped;
}
/** Bibliographic references are not chunk-indexed: plain word/trigram match on title, authors, journal, cite key and DOI. */
async function searchReferences(workspaceId: string, query: string, limit: number, opts: SearchFilters): Promise<Hit[]> {
  const q = query.trim(); if (q.length < 2 || opts.section || opts.pageIds?.length) return [];
  const like = "%" + q.replace(/[%_\\]/g, "\\$&") + "%";
  const rows = (await db.execute(dsql`select id, title, authors, year, journal, doi, cite_key, page_id, updated_at from "references" where workspace_id = ${workspaceId} and deleted_at is null
    and (title ilike ${like} or cite_key ilike ${like} or coalesce(doi,'') ilike ${like} or coalesce(journal,'') ilike ${like} or authors::text ilike ${like} or title % ${q})
    ${opts.since ? dsql`and updated_at >= ${opts.since.toISOString()}::timestamptz` : dsql``} ${opts.until ? dsql`and updated_at <= ${opts.until.toISOString()}::timestamptz` : dsql``}
    order by (title ilike ${like}) desc, similarity(title, ${q}) desc limit ${limit}`)) as any[];
  return rows.map((r) => ({ chunkId: `ref:${r.id}`, pageId: r.page_id, sourceType: "reference", sourceId: r.id, title: r.title, icon: "📚", heading: null, blockId: null, content: [Array.isArray(r.authors) ? r.authors.slice(0, 4).join(", ") : "", r.year, r.journal, r.doi ? `doi:${r.doi}` : "", `@${r.cite_key}`].filter(Boolean).join(" · "), score: 0, semantic: 0, keyword: 1, kind: "reference" as const, updatedAt: r.updated_at }));
}

/** Title / quick search (trigram + prefix) for the command palette and mentions. */
export async function quickSearch(workspaceId: string, q: string, limit = 10) {
  if (!q.trim()) return db.select({ id: schema.pages.id, title: schema.pages.title, icon: schema.pages.icon, type: schema.pages.type, section: schema.pages.section, updatedAt: schema.pages.updatedAt }).from(schema.pages).where(and(eq(schema.pages.workspaceId, workspaceId), dsql`deleted_at is null`)).orderBy(dsql`last_opened_at desc nulls last, updated_at desc`).limit(limit);
  const rows = (await db.execute(dsql`select id, title, icon, type, section, updated_at as "updatedAt" from pages where workspace_id = ${workspaceId} and deleted_at is null and (title ilike ${"%" + q + "%"} or title % ${q}) order by (title ilike ${q + "%"}) desc, similarity(title, ${q}) desc, updated_at desc limit ${limit}`)) as unknown as { id: string; title: string; icon: string | null; type: string; section: string; updatedAt: unknown }[];
  return rows.map((r) => ({ ...r, updatedAt: pgIso(r.updatedAt) })); // raw SQL hands back PostgreSQL text: the API answers ISO-8601, like the branch above
}

/** Near-duplicate pages: pairs of chunks from different pages with cosine similarity ≥ threshold (default 0.93). */
export async function findDuplicates(workspaceId: string, threshold = 0.93, limit = 50) {
  const rows = await db.execute(dsql`
    with c as (select c.id, c.page_id, e.embedding from chunks c join embeddings e on e.chunk_id = c.id where c.workspace_id = ${workspaceId} and c.page_id is not null and e.model = ${EMBEDDING_MODEL})
    select a.page_id as page_a, b.page_id as page_b, max(1 - (a.embedding <=> b.embedding)) as sim
    from c a join c b on a.page_id < b.page_id and (a.embedding <=> b.embedding) <= ${1 - threshold}
    group by a.page_id, b.page_id order by sim desc limit ${limit}`);
  const ids = [...new Set((rows as any[]).flatMap((r) => [r.page_a, r.page_b]))];
  if (!ids.length) return [];
  const pages = await db.select({ id: schema.pages.id, title: schema.pages.title, icon: schema.pages.icon, wordCount: schema.pages.wordCount, updatedAt: schema.pages.updatedAt }).from(schema.pages).where(and(inArray(schema.pages.id, ids), isNull(schema.pages.deletedAt)));
  const byId = new Map(pages.map((p) => [p.id, p]));
  return (rows as any[]).map((r) => ({ a: byId.get(r.page_a), b: byId.get(r.page_b), similarity: Number(r.sim) })).filter((x) => x.a && x.b);
}
/**
 * What the index is missing: sources never indexed or changed since their last indexing ("pending"), and index jobs that failed for good
 * in the queue during the last 7 days ("failed", with the queue's error text — never note content).
 */
export async function indexHealth(workspaceId: string) {
  const pending = (await db.execute(dsql`select p.id, p.title, p.icon, p.updated_at from pages p left join index_state s on s.source_type = 'page' and s.source_id = p.id where p.workspace_id = ${workspaceId} and p.deleted_at is null and (s.source_id is null or s.indexed_at < p.updated_at - interval '90 seconds') order by p.updated_at desc limit 50`)) as any[];
  const [{ n: pendingFiles }] = (await db.execute(dsql`select count(*)::int as n from attachments a left join index_state s on s.source_type = 'attachment' and s.source_id = a.id where a.workspace_id = ${workspaceId} and a.deleted_at is null and a.extracted_text is not null and s.source_id is null`)) as any[];
  let failed: { id: string; sourceId: string | null; sourceType: string | null; error: string; at: string }[] = []; let queued = 0;
  try {
    const f = (await db.execute(dsql`select id, data, output, completed_on from pgboss.job where name = 'index-source' and state = 'failed' and completed_on > now() - interval '7 days' and data->>'workspaceId' = ${workspaceId} order by completed_on desc limit 30`)) as any[];
    failed = f.map((j) => ({ id: j.id, sourceId: j.data?.sourceId ?? null, sourceType: j.data?.sourceType ?? null, error: String(j.output?.message ?? j.output?.value ?? "failed").slice(0, 200), at: pgIso(j.completed_on) ?? "" }));
    const [q] = (await db.execute(dsql`select count(*)::int as n from pgboss.job where name in ('index-source','reindex-all') and state in ('created','retry','active')`)) as any[]; queued = q?.n ?? 0;
  } catch { /* queue schema not readable: report what we know */ }
  // a failure is only current if that source is still not indexed
  const stillPending = new Set(pending.map((p) => p.id));
  return { pending: pending.map((p) => ({ id: p.id, title: p.title, icon: p.icon, updatedAt: pgIso(p.updated_at) })), pendingFiles, failed: failed.filter((f) => !f.sourceId || stillPending.has(f.sourceId) || f.sourceType === "attachment"), queued, embeddingsConfigured: Boolean(process.env.OPENAI_API_KEY) };
}
export async function indexStats(workspaceId: string) {
  const [s] = (await db.execute(dsql`select (select count(*) from pages where workspace_id = ${workspaceId} and deleted_at is null) as pages, (select count(*) from attachments where workspace_id = ${workspaceId} and deleted_at is null and extracted_text is not null) as attachments, (select count(*) from chunks where workspace_id = ${workspaceId}) as chunks, (select count(*) from chunks c join embeddings e on e.chunk_id = c.id where c.workspace_id = ${workspaceId}) as embedded, (select count(distinct source_id) from index_state) as indexed_sources, (select max(indexed_at) from index_state) as last_indexed, (select count(*) from index_state where model <> ${EMBEDDING_MODEL} or version <> ${EMBEDDING_VERSION}) as stale`)) as any[];
  return { pages: pgNum(s.pages), attachments: pgNum(s.attachments), chunks: pgNum(s.chunks), embedded: pgNum(s.embedded), indexed_sources: pgNum(s.indexed_sources), last_indexed: pgIso(s.last_indexed), stale: pgNum(s.stale), model: EMBEDDING_MODEL, version: EMBEDDING_VERSION };
}
