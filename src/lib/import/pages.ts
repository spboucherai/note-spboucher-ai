/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/lib/import/pages.ts
 * Module           : lib
 * Repository       : https://git.spboucher.ai/note-spboucher-ai
 * Project Website  : https://note.spboucher.ai
 * Created          : 2026-11-01
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

/**
 * Worker-safe writers used by every importer. Mirrors src/lib/pages/service.ts (createPage/updatePage semantics:
 * position, plain text, word count, links/backlinks, index job) but does not import it: the service pulls
 * `@/lib/auth/guard` (server-only + next/headers), which cannot load inside the pg-boss worker.
 */
import { createHash, randomUUID } from "node:crypto";
import { and, eq, inArray, isNull, sql as dsql } from "drizzle-orm";
import { db, schema } from "@/db";
import { recordEvent } from "@/lib/events/service";
import { docText, wordCount, extractPageRefs, emptyDoc, type PMNode } from "@/lib/editor/text";
import { enqueue, QUEUES } from "@/lib/jobs";
import { storeFile } from "@/lib/files/storage";
import { extractText } from "@/lib/files/extract";

import { ImportError, ImportAborted, contentKey } from "./validate";
export { ImportError, ImportAborted };
export type Page = typeof schema.pages.$inferSelect;
export interface ImportStats { pages: number; databases: number; rows: number; attachments: number; references: number; skipped: string[]; /** items not created because an identical one already exists */ duplicates: number; /** items found already created by an earlier attempt of the same job */ resumed: number }
export type DuplicateMode = "skip" | "import";
export interface ImportCtx {
  workspaceId: string;
  /** lower-cased title → page id (existing pages + pages created during this import) */
  titles: Map<string, string>;
  /** normalised archive path (no extension) → page id, for relative links inside ZIPs */
  paths: Map<string, string>;
  /** `done`/`total` are items (pages, databases, rows…), reported as they are created */
  progress?: (p: { progress?: number; message?: string; done?: number; total?: number }) => Promise<void> | void;
  stats: ImportStats;
  duplicates: DuplicateMode;
  /** what the workspace held before this job started (null when duplicates = "import") */
  existing: ExistingIndex | null;
  /** per-job record of what was created, so that a retried job resumes instead of duplicating (null for one-shot imports) */
  ledger: Ledger | null;
  total: number; done: number;
}
/** One more item finished: reports real progress (items done / total). Throws ImportAborted when the job was cancelled. */
export async function tick(ctx: ImportCtx, message?: string, n = 1) { ctx.done += n; await ctx.progress?.({ done: ctx.done, total: Math.max(ctx.total, ctx.done), message }); }

/**
 * Ledger of a job: settings rows `import.<jobId>.i.<hash(key)>` = { k, id }. The id is reserved BEFORE the row is inserted and the insert
 * uses that id, so after a crash the next attempt can tell "already created" (row with that id exists) from "reserved only" without a transaction.
 */
export interface Ledger { claim(key: string): Promise<{ id: string; known: boolean }>; ids(): Set<string>; has(key: string): boolean }
const ledgerPrefix = (jobId: string) => `import.${jobId}.i.`;
export async function openLedger(jobId: string): Promise<Ledger> {
  const prefix = ledgerPrefix(jobId);
  const rows = await db.select({ value: schema.settings.value }).from(schema.settings).where(dsql`${schema.settings.key} like ${prefix + "%"}`);
  const map = new Map<string, string>(); for (const r of rows) { const v = r.value as { k?: string; id?: string }; if (v?.k && v.id) map.set(v.k, v.id); }
  return {
    has: (key) => map.has(key), ids: () => new Set(map.values()),
    async claim(key) {
      const hit = map.get(key); if (hit) return { id: hit, known: true };
      const id = randomUUID();
      await db.insert(schema.settings).values({ key: prefix + createHash("sha256").update(key).digest("hex").slice(0, 40), value: { k: key, id }, updatedAt: new Date() }).onConflictDoNothing();
      map.set(key, id); return { id, known: false };
    },
  };
}
export async function clearLedger(jobId: string) { await db.delete(schema.settings).where(dsql`${schema.settings.key} like ${ledgerPrefix(jobId) + "%"}`); }

/** Snapshot of the workspace used to recognise duplicates (pages by title + content hash, databases by name + row count, files by sha256). */
export interface ExistingIndex { pages: Map<string, { id: string; title: string }>; databases: Map<string, { pageId: string; title: string }>; files: Map<string, { pageId: string; title: string }> }
export const dbKey = (name: string, rows: number) => `${name.trim().toLowerCase()}\n${rows}`;
export async function loadExisting(workspaceId: string, exclude: Set<string> = new Set()): Promise<ExistingIndex> {
  const out: ExistingIndex = { pages: new Map(), databases: new Map(), files: new Map() };
  // ordinary pages only: a database page or a database row is never "the same page" as an imported Markdown file or folder
  const rows = await db.select({ id: schema.pages.id, title: schema.pages.title, plainText: schema.pages.plainText }).from(schema.pages).where(and(eq(schema.pages.workspaceId, workspaceId), isNull(schema.pages.deletedAt), isNull(schema.pages.databaseId), dsql`${schema.pages.type} <> 'database'`)).orderBy(schema.pages.createdAt);
  for (const r of rows) { if (exclude.has(r.id)) continue; const k = contentKey(r.title, r.plainText); if (!out.pages.has(k)) out.pages.set(k, { id: r.id, title: r.title }); }
  const dbs = (await db.execute(dsql`select d.page_id as "pageId", p.title, (select count(*) from database_rows r where r.database_id = d.id and r.deleted_at is null) as n from databases d join pages p on p.id = d.page_id where d.workspace_id = ${workspaceId} and d.deleted_at is null and p.deleted_at is null order by p.created_at`)) as unknown as { pageId: string; title: string; n: string | number }[];
  for (const d of dbs) { if (exclude.has(d.pageId)) continue; const k = dbKey(d.title, Number(d.n)); if (!out.databases.has(k)) out.databases.set(k, { pageId: d.pageId, title: d.title }); }
  const files = (await db.execute(dsql`select a.sha256, a.page_id as "pageId", p.title from attachments a join pages p on p.id = a.page_id where a.workspace_id = ${workspaceId} and a.deleted_at is null and p.deleted_at is null order by a.created_at`)) as unknown as { sha256: string; pageId: string; title: string }[];
  for (const f of files) { if (exclude.has(f.pageId)) continue; if (!out.files.has(f.sha256)) out.files.set(f.sha256, { pageId: f.pageId, title: f.title }); }
  return out;
}

export interface CtxOptions { progress?: ImportCtx["progress"]; duplicates?: DuplicateMode; jobId?: string | null }
export async function newCtx(workspaceId: string, opts: CtxOptions = {}): Promise<ImportCtx> {
  // every live page (row pages included) — first created wins when titles collide
  const rows = await db.select({ id: schema.pages.id, title: schema.pages.title }).from(schema.pages).where(and(eq(schema.pages.workspaceId, workspaceId), isNull(schema.pages.deletedAt))).orderBy(schema.pages.createdAt);
  const titles = new Map<string, string>(); for (const r of rows) if (!titles.has(r.title.toLowerCase())) titles.set(r.title.toLowerCase(), r.id);
  const duplicates = opts.duplicates ?? "skip";
  const ledger = opts.jobId ? await openLedger(opts.jobId) : null;
  // what this very job created in an earlier attempt is not a "duplicate"
  const existing = duplicates === "skip" ? await loadExisting(workspaceId, ledger?.ids()) : null;
  return { workspaceId, titles, paths: new Map(), progress: opts.progress, stats: { pages: 0, databases: 0, rows: 0, attachments: 0, references: 0, skipped: [], duplicates: 0, resumed: 0 }, duplicates, existing, ledger, total: 0, done: 0 };
}
/** The page that already holds this title + text, when duplicates are skipped. */
export const findDuplicatePage = (ctx: ImportCtx, title: string, text: string) => ctx.existing?.pages.get(contentKey((title.trim().slice(0, 500) || "Untitled"), text)) ?? null;
/** Reserve (or recover) the id of an item of this job. `row` is the already-created row when a previous attempt got that far. */
export async function claimItem<T>(ctx: ImportCtx, key: string | undefined, load: (id: string) => Promise<T | undefined>): Promise<{ id?: string; row?: T }> {
  if (!key || !ctx.ledger) return {};
  const c = await ctx.ledger.claim(key);
  if (!c.known) return { id: c.id };
  const row = await load(c.id); if (row) ctx.stats.resumed++;
  return { id: c.id, row };
}
const pgArr = (a: string[]) => `{${a.map((x) => `"${x.replace(/"/g, "")}"`).join(",")}}`;

async function afterContentChange(p: Page) {
  const refs = extractPageRefs(p.content as PMNode).filter((r) => r !== p.id);
  await db.delete(schema.links).where(and(eq(schema.links.fromPageId, p.id), eq(schema.links.kind, "link")));
  if (refs.length) {
    const valid = await db.select({ id: schema.pages.id }).from(schema.pages).where(and(inArray(schema.pages.id, refs), eq(schema.pages.workspaceId, p.workspaceId)));
    if (valid.length) {
      await db.insert(schema.links).values(valid.map((v) => ({ fromPageId: p.id, toPageId: v.id, kind: "link" }))).onConflictDoNothing();
      await db.insert(schema.knowledgeEdges).values(valid.map((v) => ({ workspaceId: p.workspaceId, fromId: p.id, toId: v.id, kind: "link", status: "accepted" }))).onConflictDoNothing();
    }
  }
  await db.delete(schema.knowledgeEdges).where(and(eq(schema.knowledgeEdges.fromId, p.id), eq(schema.knowledgeEdges.kind, "link"), refs.length ? dsql`to_id <> all(${pgArr(refs)}::uuid[])` : dsql`true`));
  await enqueue(QUEUES.index, { sourceType: "page", sourceId: p.id, workspaceId: p.workspaceId }, { singletonKey: `page:${p.id}`, singletonSeconds: 20, singletonNextSlot: true }); // at most one indexing per page per 20 s, and an edit inside that window is indexed in the next one — never dropped
}

export interface NewPage { /** ledger key (unique inside the job) — makes the creation resumable */ key?: string; title?: string; parentId?: string | null; section?: string; type?: string; content?: PMNode; icon?: string | null; properties?: Record<string, unknown>; databaseId?: string | null; createdAt?: Date; updatedAt?: Date }
export async function createPage(ctx: ImportCtx, input: NewPage): Promise<Page> {
  const c = await claimItem(ctx, input.key ? `page:${input.key}` : undefined, async (id) => (await db.select().from(schema.pages).where(and(eq(schema.pages.id, id), eq(schema.pages.workspaceId, ctx.workspaceId))))[0]);
  if (c.row) { if (!ctx.titles.has(c.row.title.toLowerCase())) ctx.titles.set(c.row.title.toLowerCase(), c.row.id); ctx.stats.pages++; return c.row; }
  const [{ max }] = await db.select({ max: dsql<number>`coalesce(max(position),0)` }).from(schema.pages).where(and(eq(schema.pages.workspaceId, ctx.workspaceId), input.parentId ? eq(schema.pages.parentId, input.parentId) : isNull(schema.pages.parentId)));
  const content = input.content ?? emptyDoc(); const plain = docText(content);
  const [p] = await db.insert(schema.pages).values({ ...(c.id ? { id: c.id } : {}), workspaceId: ctx.workspaceId, title: (input.title ?? "").trim().slice(0, 500) || "Untitled", parentId: input.parentId ?? null, section: input.section ?? "notes", type: input.type ?? "page", content, plainText: plain, wordCount: wordCount(plain), icon: input.icon ?? null, properties: input.properties ?? {}, databaseId: input.databaseId ?? null, position: Number(max) + 1, ...(input.createdAt ? { createdAt: input.createdAt } : {}), ...(input.updatedAt ? { updatedAt: input.updatedAt } : {}) }).returning();
  await recordEvent(db, { workspaceId: ctx.workspaceId, kind: "page.created", pageId: p.id, summary: p.title, data: { section: p.section, type: p.type, via: "import" } });
  await afterContentChange(p);
  if (!ctx.titles.has(p.title.toLowerCase())) ctx.titles.set(p.title.toLowerCase(), p.id);
  ctx.stats.pages++;
  return p;
}
export async function getPageById(ctx: ImportCtx, id: string): Promise<Page | undefined> { return (await db.select().from(schema.pages).where(and(eq(schema.pages.id, id), eq(schema.pages.workspaceId, ctx.workspaceId), isNull(schema.pages.deletedAt))))[0]; }
export async function updatePage(ctx: ImportCtx, id: string, patch: Partial<{ title: string; content: PMNode; icon: string | null; properties: Record<string, unknown>; parentId: string | null; updatedAt: Date }>): Promise<Page> {
  const set: Partial<Page> = { updatedAt: patch.updatedAt ?? new Date() };
  if (patch.title !== undefined) set.title = patch.title.trim().slice(0, 500) || "Untitled";
  if (patch.content !== undefined) { set.content = patch.content as any; set.plainText = docText(patch.content); set.wordCount = wordCount(set.plainText); set.version = dsql`version + 1` as any; }
  if (patch.icon !== undefined) set.icon = patch.icon; if (patch.properties !== undefined) set.properties = patch.properties; if (patch.parentId !== undefined) set.parentId = patch.parentId;
  const [p] = await db.update(schema.pages).set(set).where(and(eq(schema.pages.id, id), eq(schema.pages.workspaceId, ctx.workspaceId))).returning();
  if (!p) throw new ImportError("Page not found", 404);
  if (patch.content !== undefined) await afterContentChange(p);
  return p;
}

export type PropType = "text" | "number" | "date" | "checkbox" | "select" | "multi_select" | "url";
export type { PropertyType } from "@/lib/databases/types";
export interface NewDatabase { key?: string; name: string; parentId?: string | null; description?: string | null; icon?: string | null; titleName?: string; columns: { name: string; type: PropType; config?: Record<string, unknown> }[] }
/** Idempotent: every part (page, database row, properties, default view) is created only when missing, so a retried job completes a half-made database. */
export async function createDatabase(ctx: ImportCtx, input: NewDatabase) {
  const page = await createPage(ctx, { key: input.key ? `db:${input.key}` : undefined, title: input.name, parentId: input.parentId ?? null, section: "databases", type: "database", icon: input.icon ?? null });
  let [database] = await db.select().from(schema.databases).where(eq(schema.databases.pageId, page.id));
  if (!database) [database] = await db.insert(schema.databases).values({ workspaceId: ctx.workspaceId, pageId: page.id, name: page.title, description: input.description ?? null, icon: input.icon ?? null }).returning();
  // same shape as src/lib/databases/service.ts ensureDatabase: one `title` property ("Name") + a default table view
  const have = await db.select().from(schema.databaseProperties).where(eq(schema.databaseProperties.databaseId, database.id)).orderBy(schema.databaseProperties.position);
  let titleProp = have.find((p) => p.type === "title");
  if (!titleProp) [titleProp] = await db.insert(schema.databaseProperties).values({ databaseId: database.id, name: input.titleName ?? "Name", type: "title", position: 0, width: 260 }).returning();
  let properties = have.filter((p) => p.type !== "title");
  if (!properties.length && input.columns.length) properties = await db.insert(schema.databaseProperties).values(input.columns.map((c, i) => ({ databaseId: database.id, name: c.name.slice(0, 200) || `Column ${i + 1}`, type: c.type, config: c.config ?? {}, position: i + 1, width: c.type === "checkbox" ? 90 : 180 }))).returning();
  const [view] = await db.select({ id: schema.databaseViews.id }).from(schema.databaseViews).where(eq(schema.databaseViews.databaseId, database.id)).limit(1);
  if (!view) await db.insert(schema.databaseViews).values({ databaseId: database.id, name: "Table", type: "table", config: {}, position: 0, isDefault: true });
  ctx.stats.databases++;
  return { page, database, titleProp, properties };
}
export async function addRow(ctx: ImportCtx, d: { id: string; pageId: string; titlePropId?: string | null }, input: { key?: string; title: string; values: Record<string, unknown>; content?: PMNode; position?: number; createdAt?: Date; updatedAt?: Date }) {
  const page = await createPage(ctx, { key: input.key, title: input.title, parentId: d.pageId, section: "databases", type: "page", databaseId: d.id, content: input.content, createdAt: input.createdAt, updatedAt: input.updatedAt });
  const values = d.titlePropId ? { ...input.values, [d.titlePropId]: page.title } : input.values;
  let [row] = await db.select().from(schema.databaseRows).where(and(eq(schema.databaseRows.databaseId, d.id), eq(schema.databaseRows.pageId, page.id)));
  if (!row) [row] = await db.insert(schema.databaseRows).values({ databaseId: d.id, pageId: page.id, values, position: input.position ?? ctx.stats.rows + 1 }).returning();
  ctx.stats.rows++;
  return { page, row };
}
export async function createAttachment(ctx: ImportCtx, buf: Buffer, filename: string, mime: string, pageId: string | null, key?: string) {
  const c = await claimItem(ctx, key ? `att:${key}` : undefined, async (id) => (await db.select().from(schema.attachments).where(and(eq(schema.attachments.id, id), eq(schema.attachments.workspaceId, ctx.workspaceId))))[0]);
  if (c.row) { ctx.stats.attachments++; return c.row; }
  const { sha256, storagePath } = await storeFile(buf, filename);
  const ex = await extractText(buf, mime, filename);
  const [a] = await db.insert(schema.attachments).values({ ...(c.id ? { id: c.id } : {}), workspaceId: ctx.workspaceId, pageId, filename: filename.slice(0, 255), mime, size: buf.length, sha256, storagePath, extractedText: ex?.text ?? null, pageCount: ex?.pages ?? null, meta: { source: "import" } }).returning();
  if (ex?.text) await enqueue(QUEUES.index, { sourceType: "attachment", sourceId: a.id, workspaceId: ctx.workspaceId });
  ctx.stats.attachments++;
  return a;
}
export const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml", pdf: "application/pdf", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation", csv: "text/csv", md: "text/markdown", txt: "text/plain", json: "application/json", bib: "application/x-bibtex", zip: "application/zip", mp4: "video/mp4", mp3: "audio/mpeg", m4a: "audio/mp4", wav: "audio/wav", html: "text/html" };
export const mimeOf = (name: string) => MIME[(name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "")] ?? "application/octet-stream";

/**
 * Job record — settings key `import.<jobId>`. Written with an atomic jsonb merge (`value || patch`): the heartbeat, the progress
 * callback and the route never overwrite each other's fields.
 */
export type ImportStatus = "preview" | "queued" | "running" | "done" | "error" | "cancelled";
export interface ImportProgress {
  status: ImportStatus; progress: number; done?: number; total?: number; message?: string; kind?: string; filename?: string; size?: number;
  pageId?: string | null; stats?: ImportStats; error?: string | null; errorCode?: string | null; retryable?: boolean; attempts?: number; maxAttempts?: number;
  duplicates?: DuplicateMode; parentId?: string | null; preview?: unknown;
  createdAt: string; updatedAt: string; /** last time `done`/`progress` moved */ progressAt?: string; /** worker liveness */ heartbeatAt?: string;
  /** internal — never sent to the browser */ workspaceId?: string; userId?: string; staged?: string | null; runId?: string | null; cancelRequested?: boolean;
}
/** A job that reported nothing for this long is shown as stalled (with Retry). */
export const STALLED_MS = 10 * 60_000;
const importKey = (jobId: string) => `import.${jobId}`;
const merge = (patch: object) => dsql`${schema.settings.value} || ${JSON.stringify(patch)}::jsonb`;
export async function setImportProgress(jobId: string, patch: Partial<ImportProgress>): Promise<ImportProgress> {
  const now = new Date().toISOString(); const p = { ...patch, updatedAt: now };
  const init: ImportProgress = { status: "queued", progress: 0, createdAt: now, ...p };
  const [row] = await db.insert(schema.settings).values({ key: importKey(jobId), value: init, updatedAt: new Date() }).onConflictDoUpdate({ target: schema.settings.key, set: { value: merge(p), updatedAt: new Date() } }).returning({ value: schema.settings.value });
  return row.value as ImportProgress;
}
/** Progress write of one run. Returns null when the job was cancelled or another run took it over — the caller must stop. */
export async function updateImportRun(jobId: string, runId: string, patch: Partial<ImportProgress>): Promise<ImportProgress | null> {
  const p = { ...patch, updatedAt: new Date().toISOString() };
  const [row] = await db.update(schema.settings).set({ value: merge(p), updatedAt: new Date() }).where(and(eq(schema.settings.key, importKey(jobId)), dsql`${schema.settings.value}->>'runId' = ${runId}`, dsql`coalesce(${schema.settings.value}->>'cancelRequested', 'false') <> 'true'`)).returning({ value: schema.settings.value });
  return (row?.value as ImportProgress) ?? null;
}
export async function getImportProgress(jobId: string): Promise<ImportProgress | null> {
  const [cur] = await db.select().from(schema.settings).where(eq(schema.settings.key, importKey(jobId)));
  return (cur?.value as ImportProgress) ?? null;
}
export async function deleteImportRecord(jobId: string) { await db.delete(schema.settings).where(eq(schema.settings.key, importKey(jobId))); await clearLedger(jobId); }
/** Job records of a workspace, newest first (ledger rows excluded). */
export async function listImportJobs(workspaceId: string, limit = 20): Promise<({ jobId: string } & ImportProgress)[]> {
  const rows = await db.select().from(schema.settings).where(and(dsql`${schema.settings.key} ~ '^import\\.[0-9a-f-]{36}$'`, dsql`${schema.settings.value}->>'workspaceId' = ${workspaceId}`)).orderBy(dsql`${schema.settings.updatedAt} desc`).limit(limit);
  return rows.map((r) => ({ jobId: r.key.slice("import.".length), ...(r.value as ImportProgress) }));
}
