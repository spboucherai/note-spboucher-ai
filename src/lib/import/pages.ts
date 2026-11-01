/**
 * Worker-safe writers used by every importer. Mirrors src/lib/pages/service.ts (createPage/updatePage semantics:
 * position, plain text, word count, links/backlinks, index job) but does not import it: the service pulls
 * `@/lib/auth/guard` (server-only + next/headers), which cannot load inside the pg-boss worker.
 */
import { and, eq, inArray, isNull, sql as dsql } from "drizzle-orm";
import { db, schema } from "@/db";
import { docText, wordCount, extractPageRefs, emptyDoc, type PMNode } from "@/lib/editor/text";
import { enqueue, QUEUES } from "@/lib/jobs";
import { storeFile } from "@/lib/files/storage";
import { extractText } from "@/lib/files/extract";

export class ImportError extends Error { constructor(message: string, public status = 400) { super(message); } }
export type Page = typeof schema.pages.$inferSelect;
export interface ImportCtx {
  workspaceId: string;
  /** lower-cased title → page id (existing pages + pages created during this import) */
  titles: Map<string, string>;
  /** normalised archive path (no extension) → page id, for relative links inside ZIPs */
  paths: Map<string, string>;
  progress?: (p: { progress?: number; message?: string }) => Promise<void> | void;
  stats: { pages: number; databases: number; rows: number; attachments: number; references: number; skipped: string[] };
}
export async function newCtx(workspaceId: string, progress?: ImportCtx["progress"]): Promise<ImportCtx> {
  // every live page (row pages included) — first created wins when titles collide
  const rows = await db.select({ id: schema.pages.id, title: schema.pages.title }).from(schema.pages).where(and(eq(schema.pages.workspaceId, workspaceId), isNull(schema.pages.deletedAt))).orderBy(schema.pages.createdAt);
  const titles = new Map<string, string>(); for (const r of rows) if (!titles.has(r.title.toLowerCase())) titles.set(r.title.toLowerCase(), r.id);
  return { workspaceId, titles, paths: new Map(), progress, stats: { pages: 0, databases: 0, rows: 0, attachments: 0, references: 0, skipped: [] } };
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
  await enqueue(QUEUES.index, { sourceType: "page", sourceId: p.id, workspaceId: p.workspaceId }, { singletonKey: `page:${p.id}`, singletonSeconds: 20 });
}

export interface NewPage { title?: string; parentId?: string | null; section?: string; type?: string; content?: PMNode; icon?: string | null; properties?: Record<string, unknown>; databaseId?: string | null; createdAt?: Date; updatedAt?: Date }
export async function createPage(ctx: ImportCtx, input: NewPage): Promise<Page> {
  const [{ max }] = await db.select({ max: dsql<number>`coalesce(max(position),0)` }).from(schema.pages).where(and(eq(schema.pages.workspaceId, ctx.workspaceId), input.parentId ? eq(schema.pages.parentId, input.parentId) : isNull(schema.pages.parentId)));
  const content = input.content ?? emptyDoc(); const plain = docText(content);
  const [p] = await db.insert(schema.pages).values({ workspaceId: ctx.workspaceId, title: (input.title ?? "").trim().slice(0, 500) || "Untitled", parentId: input.parentId ?? null, section: input.section ?? "notes", type: input.type ?? "page", content, plainText: plain, wordCount: wordCount(plain), icon: input.icon ?? null, properties: input.properties ?? {}, databaseId: input.databaseId ?? null, position: Number(max) + 1, ...(input.createdAt ? { createdAt: input.createdAt } : {}), ...(input.updatedAt ? { updatedAt: input.updatedAt } : {}) }).returning();
  await afterContentChange(p);
  if (!ctx.titles.has(p.title.toLowerCase())) ctx.titles.set(p.title.toLowerCase(), p.id);
  ctx.stats.pages++;
  return p;
}
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
export interface NewDatabase { name: string; parentId?: string | null; description?: string | null; icon?: string | null; titleName?: string; columns: { name: string; type: PropType; config?: Record<string, unknown> }[] }
export async function createDatabase(ctx: ImportCtx, input: NewDatabase) {
  const page = await createPage(ctx, { title: input.name, parentId: input.parentId ?? null, section: "databases", type: "database", icon: input.icon ?? null });
  const [database] = await db.insert(schema.databases).values({ workspaceId: ctx.workspaceId, pageId: page.id, name: page.title, description: input.description ?? null, icon: input.icon ?? null }).returning();
  // same shape as src/lib/databases/service.ts ensureDatabase: one `title` property ("Name") + a default table view
  const [titleProp] = await db.insert(schema.databaseProperties).values({ databaseId: database.id, name: input.titleName ?? "Name", type: "title", position: 0, width: 260 }).returning();
  const properties = input.columns.length ? await db.insert(schema.databaseProperties).values(input.columns.map((c, i) => ({ databaseId: database.id, name: c.name.slice(0, 200) || `Column ${i + 1}`, type: c.type, config: c.config ?? {}, position: i + 1, width: c.type === "checkbox" ? 90 : 180 }))).returning() : [];
  await db.insert(schema.databaseViews).values({ databaseId: database.id, name: "Table", type: "table", config: {}, position: 0, isDefault: true });
  ctx.stats.databases++;
  return { page, database, titleProp, properties };
}
export async function addRow(ctx: ImportCtx, d: { id: string; pageId: string; titlePropId?: string | null }, input: { title: string; values: Record<string, unknown>; content?: PMNode; position?: number }) {
  const page = await createPage(ctx, { title: input.title, parentId: d.pageId, section: "databases", type: "page", databaseId: d.id, content: input.content });
  const values = d.titlePropId ? { ...input.values, [d.titlePropId]: page.title } : input.values;
  const [row] = await db.insert(schema.databaseRows).values({ databaseId: d.id, pageId: page.id, values, position: input.position ?? ctx.stats.rows + 1 }).returning();
  ctx.stats.rows++;
  return { page, row };
}
export async function createAttachment(ctx: ImportCtx, buf: Buffer, filename: string, mime: string, pageId: string | null) {
  const { sha256, storagePath } = await storeFile(buf, filename);
  const ex = await extractText(buf, mime, filename);
  const [a] = await db.insert(schema.attachments).values({ workspaceId: ctx.workspaceId, pageId, filename: filename.slice(0, 255), mime, size: buf.length, sha256, storagePath, extractedText: ex?.text ?? null, pageCount: ex?.pages ?? null, meta: { source: "import" } }).returning();
  if (ex?.text) await enqueue(QUEUES.index, { sourceType: "attachment", sourceId: a.id, workspaceId: ctx.workspaceId });
  ctx.stats.attachments++;
  return a;
}
export const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml", pdf: "application/pdf", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation", csv: "text/csv", md: "text/markdown", txt: "text/plain", json: "application/json", bib: "application/x-bibtex", zip: "application/zip", mp4: "video/mp4", mp3: "audio/mpeg", m4a: "audio/mp4", wav: "audio/wav", html: "text/html" };
export const mimeOf = (name: string) => MIME[(name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "")] ?? "application/octet-stream";

/** Progress record for async imports — settings key `import.<jobId>`. */
export interface ImportProgress { status: "queued" | "running" | "done" | "error"; progress: number; message?: string; kind?: string; filename?: string; pageId?: string | null; stats?: ImportCtx["stats"]; error?: string; createdAt: string; updatedAt: string; workspaceId?: string }
export async function setImportProgress(jobId: string, patch: Partial<ImportProgress>) {
  const key = `import.${jobId}`;
  const [cur] = await db.select().from(schema.settings).where(eq(schema.settings.key, key));
  const now = new Date().toISOString();
  const value: ImportProgress = { status: "queued", progress: 0, createdAt: now, ...((cur?.value as Partial<ImportProgress>) ?? {}), ...patch, updatedAt: now };
  await db.insert(schema.settings).values({ key, value, updatedAt: new Date() }).onConflictDoUpdate({ target: schema.settings.key, set: { value, updatedAt: new Date() } });
  return value;
}
export async function getImportProgress(jobId: string): Promise<ImportProgress | null> {
  const [cur] = await db.select().from(schema.settings).where(eq(schema.settings.key, `import.${jobId}`));
  return (cur?.value as ImportProgress) ?? null;
}
