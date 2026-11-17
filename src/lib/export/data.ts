/** Loads everything an export needs for a workspace (or a subtree) in a few queries. Next-only (used by /api/export). */
import { and, asc, eq, inArray, isNull, sql as dsql } from "drizzle-orm";
import { db, schema } from "@/db";
import { slugify } from "@/lib/utils";
import { displayValue } from "@/lib/databases/values";
import type { Property } from "@/lib/databases/types";

export type PageRow = typeof schema.pages.$inferSelect;
export type DatabaseRow = typeof schema.databases.$inferSelect;
export type PropertyRow = typeof schema.databaseProperties.$inferSelect;
export type RowRow = typeof schema.databaseRows.$inferSelect;
export type AttachmentRow = typeof schema.attachments.$inferSelect;
export type ReferenceRow = typeof schema.researchReferences.$inferSelect;

export class ExportNotFound extends Error {}
export interface ExportSet {
  workspace: { id: string; name: string; slug: string; createdAt: Date };
  rootId: string | null;
  pages: PageRow[];
  databases: DatabaseRow[]; properties: PropertyRow[]; rows: RowRow[]; views: (typeof schema.databaseViews.$inferSelect)[];
  attachments: AttachmentRow[]; references: ReferenceRow[]; experiments: (typeof schema.experiments.$inferSelect)[]; tags: (typeof schema.tags.$inferSelect)[]; pageTags: { pageId: string; tagId: string }[]; tasks: (typeof schema.tasks.$inferSelect)[];
}

const chunked = async <T, R>(ids: T[], fn: (part: T[]) => Promise<R[]>, size = 500) => { const out: R[] = []; for (let i = 0; i < ids.length; i += size) out.push(...(await fn(ids.slice(i, i + size)))); return out; };

export async function loadExportSet(wsId: string, rootId?: string | null): Promise<ExportSet> {
  const [ws] = await db.select({ id: schema.workspaces.id, name: schema.workspaces.name, slug: schema.workspaces.slug, createdAt: schema.workspaces.createdAt }).from(schema.workspaces).where(eq(schema.workspaces.id, wsId));
  if (!ws) throw new ExportNotFound("Workspace not found");
  let pages: PageRow[];
  if (rootId) {
    const ids = (await db.execute(dsql`with recursive t as (select id from pages where id = ${rootId} and workspace_id = ${wsId} and deleted_at is null union all select p.id from pages p join t on (p.parent_id = t.id) where p.deleted_at is null) select id from t`)) as unknown as { id: string }[];
    const idList = ids.map((r) => r.id); if (!idList.length) throw new ExportNotFound("Page not found (deleted or not in this workspace)");
    pages = await chunked(idList, (part) => db.select().from(schema.pages).where(inArray(schema.pages.id, part)));
    // row pages of databases hosted inside the subtree (their parent_id may be null)
    const dbs = await db.select({ id: schema.databases.id }).from(schema.databases).where(and(eq(schema.databases.workspaceId, wsId), isNull(schema.databases.deletedAt), inArray(schema.databases.pageId, idList)));
    if (dbs.length) { const have = new Set(pages.map((p) => p.id)); const rowsPages = await db.select().from(schema.pages).where(and(inArray(schema.pages.databaseId, dbs.map((d) => d.id)), isNull(schema.pages.deletedAt))); for (const rp of rowsPages) if (!have.has(rp.id)) pages.push(rp); }
  } else pages = await db.select().from(schema.pages).where(and(eq(schema.pages.workspaceId, wsId), isNull(schema.pages.deletedAt))).orderBy(asc(schema.pages.position), asc(schema.pages.createdAt));
  const pageIds = pages.map((p) => p.id); const pageSet = new Set(pageIds);
  const databases = (await db.select().from(schema.databases).where(and(eq(schema.databases.workspaceId, wsId), isNull(schema.databases.deletedAt)))).filter((d) => pageSet.has(d.pageId));
  const dbIds = databases.map((d) => d.id);
  const properties = dbIds.length ? (await db.select().from(schema.databaseProperties).where(inArray(schema.databaseProperties.databaseId, dbIds)).orderBy(asc(schema.databaseProperties.position))) : [];
  const rows = dbIds.length ? (await db.select().from(schema.databaseRows).where(and(inArray(schema.databaseRows.databaseId, dbIds), isNull(schema.databaseRows.deletedAt))).orderBy(asc(schema.databaseRows.position))) : [];
  const views = dbIds.length ? await db.select().from(schema.databaseViews).where(inArray(schema.databaseViews.databaseId, dbIds)).orderBy(asc(schema.databaseViews.position)) : [];
  const allAtt = await db.select().from(schema.attachments).where(and(eq(schema.attachments.workspaceId, wsId), isNull(schema.attachments.deletedAt)));
  const allRefs = await db.select().from(schema.researchReferences).where(and(eq(schema.researchReferences.workspaceId, wsId), isNull(schema.researchReferences.deletedAt)));
  const references = rootId ? allRefs.filter((r) => r.pageId && pageSet.has(r.pageId)) : allRefs;
  // a subtree export also needs the files its pages point to even when the attachment row belongs to no page of the subtree
  // (files stored by an import, images pasted elsewhere and reused, PDFs attached to its references)
  let attachments = allAtt;
  if (rootId) { const used = new Set<string>(); for (const p of pages) for (const m of JSON.stringify(p.content ?? {}).matchAll(/\/api\/files\/([0-9a-f-]{36})/g)) used.add(m[1]); for (const r of references) if (r.attachmentId) used.add(r.attachmentId); attachments = allAtt.filter((a) => (a.pageId && pageSet.has(a.pageId)) || used.has(a.id)); }
  const allExps = await db.select().from(schema.experiments).where(eq(schema.experiments.workspaceId, wsId));
  const experiments = rootId ? allExps.filter((e) => e.pageId && pageSet.has(e.pageId)) : allExps;
  const tags = await db.select().from(schema.tags).where(eq(schema.tags.workspaceId, wsId));
  const pageTags = pageIds.length ? await chunked(pageIds, (part) => db.select().from(schema.pageTags).where(inArray(schema.pageTags.pageId, part))) : [];
  const allTasks = await db.select().from(schema.tasks).where(and(eq(schema.tasks.workspaceId, wsId), isNull(schema.tasks.deletedAt)));
  const tasks = rootId ? allTasks.filter((t) => t.pageId && pageSet.has(t.pageId)) : allTasks;
  return { workspace: ws, rootId: rootId ?? null, pages, databases, properties, rows, views, attachments, references, experiments, tags, pageTags, tasks };
}

/** Tag names per page (page_tags ∪ properties.tags). */
export function tagsOf(set: ExportSet, page: PageRow): string[] {
  const byId = new Map(set.tags.map((t) => [t.id, t.name]));
  const fromTable = set.pageTags.filter((pt) => pt.pageId === page.id).map((pt) => byId.get(pt.tagId)).filter((x): x is string => Boolean(x));
  const fromProps = Array.isArray((page.properties as any)?.tags) ? ((page.properties as any).tags as unknown[]).map(String) : [];
  return [...new Set([...fromTable, ...fromProps])];
}

/** Property values of a row page keyed by property *name* (database_rows.values is keyed by property id). */
export function rowValuesByName(set: ExportSet, page: PageRow): Record<string, unknown> | null {
  if (!page.databaseId) return null;
  const row = set.rows.find((r) => r.pageId === page.id); if (!row) return null;
  const props = set.properties.filter((p) => p.databaseId === page.databaseId && p.type !== "title").sort((a, b) => a.position - b.position);
  const out: Record<string, unknown> = {};
  for (const p of props) {
    const v = (row.values as any)?.[p.id] ?? (row.values as any)?.[p.name]; if (v === undefined || v === null || v === "") continue;
    if (p.type === "select" || p.type === "status" || p.type === "multi_select" || p.type === "relation" || p.type === "file") { try { out[p.name] = displayValue({ id: p.id, databaseId: p.databaseId, name: p.name, type: p.type as Property["type"], config: (p.config ?? {}) as Property["config"], position: p.position, width: p.width }, v); continue; } catch {} }
    out[p.name] = v;
  }
  return out;
}

export interface Placed { page: PageRow; file: string; dir: string; depth: number }
/**
 * Folder hierarchy mirroring parents: page → `<dir>/<slug>.md`, its children → `<dir>/<slug>/…`.
 * Database row pages are always placed under the database page's folder.
 */
export function assignPaths(set: ExportSet): Map<string, Placed> {
  const dbPageByDbId = new Map(set.databases.map((d) => [d.id, d.pageId]));
  const inSet = new Set(set.pages.map((p) => p.id));
  const parentOf = (p: PageRow) => { if (p.databaseId && dbPageByDbId.has(p.databaseId)) return dbPageByDbId.get(p.databaseId)!; return p.parentId && inSet.has(p.parentId) ? p.parentId : null; };
  const children = new Map<string | null, PageRow[]>();
  for (const p of set.pages) { const k = parentOf(p); if (!children.has(k)) children.set(k, []); children.get(k)!.push(p); }
  for (const arr of children.values()) arr.sort((a, b) => a.position - b.position || a.createdAt.getTime() - b.createdAt.getTime());
  const out = new Map<string, Placed>();
  const walk = (parent: string | null, dir: string, depth: number) => {
    const used = new Set<string>();
    for (const p of children.get(parent) ?? []) {
      let base = slugify(p.title).slice(0, 80) || "untitled"; let slug = base; let n = 2; while (used.has(slug)) slug = `${base}-${n++}`; used.add(slug);
      const file = dir ? `${dir}/${slug}.md` : `${slug}.md`; const sub = dir ? `${dir}/${slug}` : slug;
      out.set(p.id, { page: p, file, dir: sub, depth }); walk(p.id, sub, depth + 1);
    }
  };
  walk(null, "", 0);
  // pages whose parent chain is broken (should not happen) → root
  for (const p of set.pages) if (!out.has(p.id)) { const slug = `${slugify(p.title) || "untitled"}-${p.id.slice(0, 8)}`; out.set(p.id, { page: p, file: `${slug}.md`, dir: slug, depth: 0 }); }
  return out;
}
export const attachmentFile = (a: { id: string; filename: string }) => `attachments/${a.id.slice(0, 8)}-${a.filename.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").slice(0, 150)}`;
