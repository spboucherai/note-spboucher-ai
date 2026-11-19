/**
 * File: src/lib/knowledge/query.ts
 * Description: living blocks (SPEC §4.7) — resolves a `queryView` or a `chart` at display time. Five sources (tasks, pages, database,
 *   references, backlinks), one answer shape: typed columns, rows keyed by column, and the same data as a plain table for charts.
 *   The database source goes through the database query engine (views, filters, sorts, formulas, rollups) — nothing is re-implemented.
 * Author: Simon-Pierre Boucher · contact@spboucher.ai
 */
import { sql as dsql } from "drizzle-orm";
import { db } from "@/db";
import { HttpError } from "@/lib/errors";
import { getDatabase, queryRows } from "@/lib/databases/service";
import { resolveView } from "@/lib/databases/query";
import { cellText } from "@/lib/editor/next-nodes";

export const QUERY_SOURCES = ["tasks", "pages", "database", "references", "backlinks"] as const;
export type QuerySource = (typeof QUERY_SOURCES)[number];
export interface QueryFilter { tag?: string; section?: string; status?: string; parentId?: string; text?: string; dueBefore?: string; dueAfter?: string }
export interface QueryRequest { source: QuerySource; databaseId?: string | null; viewId?: string | null; pageId?: string | null; filter?: QueryFilter; limit?: number }
export interface QueryColumn { key: string; label: string; type: "text" | "number" | "date" | "checkbox" | "select" | "page" | "tags" | "url" | "json" }
export interface QueryAnswer { source: QuerySource; columns: QueryColumn[]; rows: ({ id: string; pageId: string | null; blockId?: string | null } & Record<string, unknown>)[]; total: number; limit: number; table: { columns: string[]; rows: (string | number | null)[][] }; resolvedAt: string }

const rowsQ = async <T = any>(q: ReturnType<typeof dsql>): Promise<T[]> => (await db.execute(q)) as unknown as T[];
const iso = (d: unknown) => (d ? new Date(d as string).toISOString() : null);
const like = (s: string) => `%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
const when = (v: string | undefined, name: string) => { if (!v) return null; const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T00:00:00.000Z` : v); if (isNaN(d.getTime())) throw new HttpError(400, `Invalid ${name}`, "bad_request"); return d.toISOString(); };
const tableOf = (columns: QueryColumn[], rows: Record<string, unknown>[]) => ({ columns: columns.map((c) => c.label), rows: rows.map((r) => columns.map((c) => { const v = r[c.key]; return v === null || v === undefined ? null : typeof v === "number" ? v : Array.isArray(v) ? v.map(cellText).join(", ") : cellText(typeof v === "object" ? ((v as any).title ?? (v as any).name ?? v) : v); })) });

export async function runQuery(wsId: string, q: QueryRequest): Promise<QueryAnswer> {
  const limit = Math.min(500, Math.max(1, q.limit ?? 25)); const f = q.filter ?? {}; const text = f.text?.trim() ? like(f.text.trim()) : null; const tag = f.tag?.trim().replace(/^#/, "").toLowerCase() || null;
  const done = (source: QuerySource, columns: QueryColumn[], rows: any[], total: number): QueryAnswer => ({ source, columns, rows, total, limit, table: tableOf(columns, rows), resolvedAt: new Date().toISOString() });
  if (q.source === "tasks") {
    const st = f.status ?? "open"; if (!["open", "todo", "doing", "done", "all"].includes(st)) throw new HttpError(400, "filter.status for tasks: open | todo | doing | done | all", "bad_request");
    const where = [dsql`t.workspace_id = ${wsId}`, dsql`t.deleted_at is null`];
    if (st === "open") where.push(dsql`t.status <> 'done'`); else if (st !== "all") where.push(dsql`t.status = ${st}`);
    if (f.parentId) where.push(dsql`t.page_id = ${f.parentId}`); if (text) where.push(dsql`t.title ilike ${text}`);
    if (f.section) where.push(dsql`p.section = ${f.section}`);
    if (tag) where.push(dsql`exists (select 1 from page_tags pt join tags g on g.id = pt.tag_id where pt.page_id = t.page_id and g.name = ${tag})`);
    const before = when(f.dueBefore, "dueBefore"), after = when(f.dueAfter, "dueAfter");
    if (before) where.push(dsql`t.due_at < ${before}::timestamptz`); if (after) where.push(dsql`t.due_at >= ${after}::timestamptz`);
    const r = await rowsQ<any>(dsql`select t.id, t.title, t.status, t.priority, t.due_at, t.completed_at, t.project, t.page_id, t.block_id, p.title as page_title, count(*) over ()::int as total from tasks t left join pages p on p.id = t.page_id where ${dsql.join(where, dsql` and `)} order by (t.status = 'done'), t.due_at asc nulls last, t.created_at desc, t.id limit ${limit}`);
    return done("tasks", [{ key: "title", label: "Tâche", type: "text" }, { key: "status", label: "État", type: "select" }, { key: "priority", label: "Priorité", type: "select" }, { key: "dueAt", label: "Échéance", type: "date" }, { key: "pageTitle", label: "Page", type: "page" }, { key: "project", label: "Projet", type: "text" }],
      r.map((t) => ({ id: t.id, pageId: t.page_id, blockId: t.block_id, title: t.title, status: t.status, priority: t.priority, dueAt: iso(t.due_at), completedAt: iso(t.completed_at), pageTitle: t.page_title, project: t.project })), r[0]?.total ?? 0);
  }
  if (q.source === "pages") {
    const where = [dsql`p.workspace_id = ${wsId}`, dsql`p.deleted_at is null`, dsql`p.database_id is null`, dsql`p.inbox_at is null`];
    if (f.status === "archived") where.push(dsql`p.archived = true`); else if (f.status === "pinned") where.push(dsql`p.archived = false and p.pinned = true`); else if (!f.status || f.status === "active") where.push(dsql`p.archived = false`); else if (f.status !== "all") where.push(dsql`p.archived = false and p.properties->>'status' = ${f.status}`);
    if (f.section) where.push(dsql`p.section = ${f.section}`); if (f.parentId) where.push(dsql`p.parent_id = ${f.parentId}`);
    if (text) where.push(dsql`(p.title ilike ${text} or p.plain_text ilike ${text})`);
    if (tag) where.push(dsql`exists (select 1 from page_tags pt join tags g on g.id = pt.tag_id where pt.page_id = p.id and g.name = ${tag})`);
    const r = await rowsQ<any>(dsql`select p.id, p.title, p.icon, p.section, p.type, p.parent_id, p.created_at, p.updated_at, p.word_count, coalesce((select array_agg(g.name order by g.name) from page_tags pt join tags g on g.id = pt.tag_id where pt.page_id = p.id), '{}') as tags, count(*) over ()::int as total from pages p where ${dsql.join(where, dsql` and `)} order by p.updated_at desc, p.id limit ${limit}`);
    return done("pages", [{ key: "title", label: "Titre", type: "page" }, { key: "section", label: "Espace", type: "select" }, { key: "tags", label: "Étiquettes", type: "tags" }, { key: "updatedAt", label: "Modifiée", type: "date" }, { key: "wordCount", label: "Mots", type: "number" }],
      r.map((p) => ({ id: p.id, pageId: p.id, title: p.title, icon: p.icon, section: p.section, type: p.type, parentId: p.parent_id, tags: p.tags, createdAt: iso(p.created_at), updatedAt: iso(p.updated_at), wordCount: p.word_count })), r[0]?.total ?? 0);
  }
  if (q.source === "database") {
    if (!q.databaseId) throw new HttpError(400, "databaseId is required for source database", "bad_request");
    const d = await getDatabase(wsId, q.databaseId); const view = q.viewId ? d.views.find((v) => v.id === q.viewId) : d.views.find((v) => v.isDefault) ?? d.views[0];
    if (q.viewId && !view) throw new HttpError(404, "View not found", "not_found");
    const res = await queryRows(d.id, d.properties, resolveView(view, { search: f.text?.trim() || undefined, limit, offset: 0 }));
    const hidden = new Set(view?.config?.hidden ?? []); const props = d.properties.filter((p) => !hidden.has(p.id));
    const typeOf = (t: string): QueryColumn["type"] => (t === "number" ? "number" : t === "date" || t === "created_time" || t === "last_edited_time" ? "date" : t === "checkbox" ? "checkbox" : t === "select" || t === "status" ? "select" : t === "multi_select" ? "tags" : t === "url" ? "url" : t === "title" || t === "text" || t === "formula" || t === "rollup" ? "text" : "json");
    const columns: QueryColumn[] = props.map((p) => ({ key: p.id, label: p.name, type: p.type === "title" ? "page" : typeOf(p.type) }));
    const option = (p: (typeof props)[number], v: unknown) => { const o = (p.config.options ?? []).find((x) => x.id === v); return o ? o.name : v; };
    const rows = res.rows.map((r) => { const o: any = { id: r.id, pageId: r.pageId, title: r.title, icon: r.icon }; for (const p of props) { const v = p.type === "title" ? r.title : r.values[p.id]; o[p.id] = p.type === "select" || p.type === "status" ? option(p, v) : p.type === "multi_select" && Array.isArray(v) ? v.map((x) => option(p, x)) : p.type === "relation" && Array.isArray(v) ? v.map((x: any) => x?.title ?? x) : v ?? null; } return o; });
    return { ...done("database", columns, rows, res.total), databaseId: d.id, viewId: view?.id ?? null, name: d.name } as QueryAnswer;
  }
  if (q.source === "references") {
    const where = [dsql`r.workspace_id = ${wsId}`, dsql`r.deleted_at is null`];
    if (f.parentId) where.push(dsql`(r.page_id = ${f.parentId} or exists (select 1 from knowledge_edges k where k.from_id = ${f.parentId} and k.to_id = r.id and k.kind = 'cites'))`);
    if (text) where.push(dsql`(r.title ilike ${text} or r.cite_key ilike ${text} or r.authors::text ilike ${text})`);
    if (f.status) where.push(dsql`r.verified = ${f.status}`);
    const r = await rowsQ<any>(dsql`select r.id, r.cite_key, r.title, r.authors, r.year, r.journal, r.doi, r.url, r.page_id, r.verified, count(*) over ()::int as total from "references" r where ${dsql.join(where, dsql` and `)} order by r.year desc nulls last, r.cite_key, r.id limit ${limit}`);
    return done("references", [{ key: "title", label: "Titre", type: "text" }, { key: "authors", label: "Auteurs", type: "tags" }, { key: "year", label: "Année", type: "number" }, { key: "journal", label: "Revue", type: "text" }, { key: "citeKey", label: "Clé", type: "text" }],
      r.map((x) => ({ id: x.id, pageId: x.page_id, title: x.title, authors: x.authors ?? [], year: x.year, journal: x.journal, citeKey: x.cite_key, doi: x.doi, url: x.url, verified: x.verified })), r[0]?.total ?? 0);
  }
  // backlinks: pages that link to `pageId` (or filter.parentId), through a document link, an accepted suggestion or a canvas card
  const target = q.pageId ?? f.parentId; if (!target) throw new HttpError(400, "pageId is required for source backlinks", "bad_request");
  const where = [dsql`p.workspace_id = ${wsId}`, dsql`p.deleted_at is null`, dsql`p.id <> ${target}`];
  if (text) where.push(dsql`p.title ilike ${text}`); if (f.section) where.push(dsql`p.section = ${f.section}`);
  const r = await rowsQ<any>(dsql`select p.id, p.title, p.icon, p.section, p.updated_at, array_agg(distinct l.kind order by l.kind) as kinds, count(*) over ()::int as total from links l join pages p on p.id = l.from_page_id where l.to_page_id = ${target} and ${dsql.join(where, dsql` and `)} group by p.id order by p.updated_at desc, p.id limit ${limit}`);
  return done("backlinks", [{ key: "title", label: "Page", type: "page" }, { key: "section", label: "Espace", type: "select" }, { key: "updatedAt", label: "Modifiée", type: "date" }],
    r.map((p) => ({ id: p.id, pageId: p.id, title: p.title, icon: p.icon, section: p.section, updatedAt: iso(p.updated_at), via: p.kinds })), r[0]?.total ?? 0);
}
