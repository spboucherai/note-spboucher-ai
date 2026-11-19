/**
 * file: src/lib/editor/query.ts
 * description: client side of the living blocks (`queryView`, SPEC §2 / §4.7). Builds the `POST /api/query` body from the node attrs and
 *   turns whatever rows the server answers into a small display model (title, status, due date, link, cells) without assuming more of
 *   the row shape than the SPEC states: the exact shape is defined by the backend workstream (docs/next/API-NEXT.md). Pure functions.
 * author: Simon-Pierre Boucher — contact@spboucher.ai
 */
import type { QueryViewAttrs, QueryFilter } from "./next-node-defs";

export interface QueryRow { key: string; title: string; subtitle: string; status: string | null; done: boolean; due: string | null; href: string | null; icon: string | null; cells: Record<string, string> }
export interface QueryResult { rows: QueryRow[]; columns: string[]; total: number | null }

const FILTER_KEYS: (keyof QueryFilter)[] = ["tag", "section", "status", "parentId", "text", "dueBefore", "dueAfter"];
/** Request body, SPEC §4.7: `{source, databaseId?, viewId?, filter, limit}`. Empty filter values are omitted; unknown filter keys are passed through. */
export function queryBody(a: Pick<QueryViewAttrs, "source" | "databaseId" | "viewId" | "filter" | "limit">): Record<string, unknown> {
  const filter: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(a.filter ?? {})) if (v != null && String(v).trim() !== "") filter[k] = v;
  return { source: a.source, ...(a.databaseId ? { databaseId: a.databaseId } : {}), ...(a.viewId ? { viewId: a.viewId } : {}), filter, limit: Math.min(200, Math.max(1, Math.round(Number(a.limit) || 25))) };
}
export const knownFilterKeys = () => [...FILTER_KEYS];

const str = (v: unknown): string => (v == null ? "" : typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : Array.isArray(v) ? v.map(str).filter(Boolean).join(", ") : typeof v === "object" ? str((v as Record<string, unknown>).title ?? (v as Record<string, unknown>).name ?? (v as Record<string, unknown>).label ?? "") : "");
const first = (o: Record<string, unknown>, keys: string[]) => { for (const k of keys) { const v = o[k]; if (v != null && str(v) !== "") return str(v); } return ""; };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Accepts `{rows:[…]}`, `{items:[…]}`, `{results:[…]}` or a bare array; rows may carry their values at the top level or under `cells` / `properties` / `values`. */
export function normaliseQueryResult(json: unknown, source: string): QueryResult {
  const j = json as Record<string, unknown> | unknown[] | null;
  const list = Array.isArray(j) ? j : Array.isArray(j?.rows) ? (j!.rows as unknown[]) : Array.isArray(j?.items) ? (j!.items as unknown[]) : Array.isArray(j?.results) ? (j!.results as unknown[]) : [];
  const declared = !Array.isArray(j) && Array.isArray(j?.columns) ? (j!.columns as unknown[]).map((c) => str(typeof c === "object" && c ? (c as Record<string, unknown>).name ?? (c as Record<string, unknown>).id : c)).filter(Boolean) : [];
  const cols = new Set<string>(declared);
  const rows: QueryRow[] = list.filter((r): r is Record<string, unknown> => Boolean(r) && typeof r === "object").map((r, i) => {
    const nested = (r.cells ?? r.properties ?? r.values) as Record<string, unknown> | undefined;
    const cells: Record<string, string> = {};
    if (nested && typeof nested === "object" && !Array.isArray(nested)) for (const [k, v] of Object.entries(nested)) { cells[k] = str(v); if (!declared.length) cols.add(k); }
    const id = first(r, ["id", "taskId", "pageId", "rowId", "refId"]);
    const pageId = first(r, ["pageId", "page_id"]) || (source === "pages" || source === "backlinks" ? id : "");
    const blockId = first(r, ["blockId", "block_id"]);
    const status = first(r, ["status", "state"]) || cells.status || cells.Status || "";
    const authors = Array.isArray(r.authors) ? (r.authors as unknown[]).map(str).filter(Boolean) : [];
    const title = first(r, ["title", "name", "text", "label", "citeKey"]) || Object.values(cells).find(Boolean) || "Untitled";
    const subtitle = source === "references" ? [authors.slice(0, 3).join(", ") + (authors.length > 3 ? " et al." : ""), str(r.year), str(r.journal)].filter(Boolean).join(" · ") : first(r, ["subtitle", "excerpt", "section", "pageTitle", "heading"]);
    return {
      key: id || `row-${i}`, title, subtitle, status: status || null, done: r.done === true || r.checked === true || /^(done|completed|closed)$/i.test(status),
      due: first(r, ["due", "dueAt", "dueDate", "due_at"]) || null, icon: first(r, ["icon"]) || null,
      href: first(r, ["href", "url"]) || (pageId && UUID.test(pageId) ? `/p/${pageId}${blockId ? `#block-${blockId}` : ""}` : null), cells,
    };
  });
  const total = !Array.isArray(j) && typeof j?.total === "number" ? (j!.total as number) : null;
  return { rows, columns: [...cols], total };
}
/** Board layout: rows grouped by status, in order of first appearance; rows without a status go to "No status". */
export function groupByStatus(rows: QueryRow[]): { status: string; rows: QueryRow[] }[] {
  const m = new Map<string, QueryRow[]>(); for (const r of rows) { const k = r.status ?? "No status"; if (!m.has(k)) m.set(k, []); m.get(k)!.push(r); }
  return [...m.entries()].map(([status, rows]) => ({ status, rows }));
}
/** "2026-11-21" / ISO date-time → short local date; anything unparsable is shown as is. */
export function shortDate(v: string | null, now = new Date()): string {
  if (!v) return ""; const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T12:00:00` : v); if (Number.isNaN(d.getTime())) return v;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}) });
}
/** Past the end of its due day (date-only values are due until 23:59 local time). */
export function isOverdue(due: string | null, done: boolean, now = new Date()): boolean {
  if (!due || done) return false; const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(due) ? `${due}T23:59:59` : due); return !Number.isNaN(d.getTime()) && d.getTime() < now.getTime();
}
