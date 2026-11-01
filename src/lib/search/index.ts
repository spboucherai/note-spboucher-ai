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
  const fullHash = createHash("sha256").update(chunks.map((c) => c.contentHash).join("|")).digest("hex");
  const [state] = await db.select().from(schema.indexState).where(and(eq(schema.indexState.sourceType, sourceType), eq(schema.indexState.sourceId, sourceId)));
  if (state && state.contentHash === fullHash && state.model === EMBEDDING_MODEL && state.version === EMBEDDING_VERSION) return { skipped: true, chunks: chunks.length };
  const existing = await db.select({ id: schema.chunks.id, ordinal: schema.chunks.ordinal, hash: schema.chunks.contentHash }).from(schema.chunks).where(and(eq(schema.chunks.sourceType, sourceType), eq(schema.chunks.sourceId, sourceId)));
  const byOrd = new Map(existing.map((e) => [e.ordinal, e]));
  const toEmbed: { idx: number; text: string }[] = [];
  const ids: string[] = [];
  await db.transaction(async (tx) => {
    for (const c of chunks) {
      const ex = byOrd.get(c.ordinal);
      if (ex && ex.hash === c.contentHash) { ids.push(ex.id); const [emb] = await tx.select({ m: schema.embeddings.model }).from(schema.embeddings).where(eq(schema.embeddings.chunkId, ex.id)); if (!emb || emb.m !== EMBEDDING_MODEL) toEmbed.push({ idx: ids.length - 1, text: (c.heading ? c.heading + "\n" : "") + c.content }); continue; }
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

export interface Hit { chunkId: string; pageId: string | null; sourceType: string; sourceId: string; title: string; icon: string | null; heading: string | null; blockId: string | null; content: string; score: number; semantic: number; keyword: number }

/** Hybrid retrieval: HNSW cosine + tsvector rank fused by reciprocal rank fusion, with optional metadata filters. */
export async function hybridSearch(workspaceId: string, query: string, opts: { limit?: number; pageIds?: string[]; sourceTypes?: string[]; semantic?: boolean } = {}): Promise<Hit[]> {
  const limit = opts.limit ?? 12; const k = Math.max(30, limit * 4);
  const filters = [dsql`c.workspace_id = ${workspaceId}`];
  if (opts.pageIds?.length) filters.push(dsql`c.page_id = any(${pgArr(opts.pageIds)}::uuid[])`);
  if (opts.sourceTypes?.length) filters.push(dsql`c.source_type = any(${pgArr(opts.sourceTypes)}::text[])`);
  const where = dsql.join(filters, dsql` and `);
  const kw = await db.execute(dsql`select c.id, ts_rank_cd(c.tsv, q) as r from chunks c, websearch_to_tsquery('simple', ${query}) q where ${where} and c.tsv @@ q order by r desc limit ${k}`);
  let sem: any[] = [];
  if (opts.semantic !== false && process.env.OPENAI_API_KEY) {
    try { const [v] = await embedTexts([query], "search"); sem = (await db.execute(dsql`select c.id, 1 - (e.embedding <=> ${`[${v.join(",")}]`}::vector) as s from embeddings e join chunks c on c.id = e.chunk_id where ${where} and e.model = ${EMBEDDING_MODEL} order by e.embedding <=> ${`[${v.join(",")}]`}::vector limit ${k}`)) as any[]; } catch (e) { console.error("semantic search failed", e); }
  }
  const fused = new Map<string, { score: number; semantic: number; keyword: number }>();
  (kw as any[]).forEach((r, i) => { const f = fused.get(r.id) ?? { score: 0, semantic: 0, keyword: 0 }; f.score += 1 / (60 + i); f.keyword = Number(r.r); fused.set(r.id, f); });
  sem.forEach((r, i) => { const f = fused.get(r.id) ?? { score: 0, semantic: 0, keyword: 0 }; f.score += 1 / (60 + i); f.semantic = Number(r.s); fused.set(r.id, f); });
  const top = [...fused.entries()].sort((a, b) => b[1].score - a[1].score).slice(0, limit);
  if (!top.length) return [];
  const rows = await db.execute(dsql`select c.id, c.page_id, c.source_type, c.source_id, c.heading, c.block_id, c.content, p.title, p.icon, a.filename from chunks c left join pages p on p.id = c.page_id and p.deleted_at is null left join attachments a on a.id = c.source_id and c.source_type = 'attachment' where c.id = any(${pgArr(top.map(([id]) => id))}::uuid[])`);
  const byId = new Map((rows as any[]).map((r) => [r.id, r]));
  return top.map(([id, f]) => { const r = byId.get(id); return r ? { chunkId: id, pageId: r.page_id, sourceType: r.source_type, sourceId: r.source_id, title: r.title ?? r.filename ?? "Untitled", icon: r.icon ?? null, heading: r.heading, blockId: r.block_id, content: r.content, ...f } : null; }).filter(Boolean) as Hit[];
}

/** Title / quick search (trigram + prefix) for the command palette and mentions. */
export async function quickSearch(workspaceId: string, q: string, limit = 10) {
  if (!q.trim()) return db.select({ id: schema.pages.id, title: schema.pages.title, icon: schema.pages.icon, type: schema.pages.type, section: schema.pages.section, updatedAt: schema.pages.updatedAt }).from(schema.pages).where(and(eq(schema.pages.workspaceId, workspaceId), dsql`deleted_at is null`)).orderBy(dsql`last_opened_at desc nulls last, updated_at desc`).limit(limit);
  return db.execute(dsql`select id, title, icon, type, section, updated_at as "updatedAt" from pages where workspace_id = ${workspaceId} and deleted_at is null and (title ilike ${"%" + q + "%"} or title % ${q}) order by (title ilike ${q + "%"}) desc, similarity(title, ${q}) desc, updated_at desc limit ${limit}`) as unknown as Promise<{ id: string; title: string; icon: string | null; type: string; section: string; updatedAt: Date }[]>;
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
export async function indexStats(workspaceId: string) {
  const [s] = (await db.execute(dsql`select (select count(*) from pages where workspace_id = ${workspaceId} and deleted_at is null) as pages, (select count(*) from attachments where workspace_id = ${workspaceId} and deleted_at is null and extracted_text is not null) as attachments, (select count(*) from chunks where workspace_id = ${workspaceId}) as chunks, (select count(*) from chunks c join embeddings e on e.chunk_id = c.id where c.workspace_id = ${workspaceId}) as embedded, (select count(distinct source_id) from index_state) as indexed_sources, (select max(indexed_at) from index_state) as last_indexed, (select count(*) from index_state where model <> ${EMBEDDING_MODEL} or version <> ${EMBEDDING_VERSION}) as stale`)) as any[];
  return { ...s, model: EMBEDDING_MODEL, version: EMBEDDING_VERSION };
}
