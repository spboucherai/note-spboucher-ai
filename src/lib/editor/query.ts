/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/lib/editor/query.ts
 * Description      : client side of the living blocks (`queryView`, and `chart`
 *                    fed by a database — SPEC §2 / §4.7). Builds the `POST
 *                    /api/query` body from the node attrs and reads the answer
 *                    of the final contract (docs/next/API-NEXT.md §4.7):
 *                    `{source, columns:[{key,label,type}],
 *                    rows:[{id,pageId,…}], total, limit, table:{columns,rows},
 *                    resolvedAt}`. An answer that does not have that shape is
 *                    an error (`QueryShapeError`), never a silently empty view.
 *                    Also here: the small local snapshot store that lets a view
 *                    show its last answer, marked stale, when the server cannot
 *                    be reached. Pure functions (the store takes its Storage).
 * Module           : lib
 * Repository       : https://git.spboucher.ai/note-spboucher-ai
 * Project Website  : https://note.spboucher.ai
 * Created          : 2026-11-19
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

import type { QueryViewAttrs, QueryFilter, ChartAttrs, ChartCell } from "./next-node-defs";

export type QueryColumnType = "text" | "number" | "date" | "checkbox" | "select" | "page" | "tags" | "url" | "json";
export interface QueryColumn { key: string; label: string; type: QueryColumnType }
export interface QueryRow { key: string; title: string; subtitle: string; status: string | null; done: boolean; due: string | null; href: string | null; icon: string | null; /** display text of every column, by column key */ cells: Record<string, string> }
export interface QueryResult { source: string; rows: QueryRow[]; columns: QueryColumn[]; total: number; limit: number; /** the same data flattened, ready for a chart */ table: { columns: string[]; rows: ChartCell[][] }; resolvedAt: string; /** database name (source `database`) */ name: string | null }
/** The server answered 200 with something that is not the §4.7 shape. */
export class QueryShapeError extends Error { constructor(what: string) { super(`Unexpected answer from the server (${what})`); this.name = "QueryShapeError"; } }

const FILTER_KEYS: (keyof QueryFilter)[] = ["tag", "section", "status", "parentId", "text", "dueBefore", "dueAfter"];
const COLUMN_TYPES = new Set<string>(["text", "number", "date", "checkbox", "select", "page", "tags", "url", "json"]);
/** Request body, SPEC §4.7: `{source, databaseId?, viewId?, filter, limit}`. Empty filter values are omitted; unknown filter keys are passed through. */
export function queryBody(a: Pick<QueryViewAttrs, "source" | "databaseId" | "viewId" | "filter" | "limit">): Record<string, unknown> {
  const filter: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(a.filter ?? {})) if (v != null && String(v).trim() !== "") filter[k] = v;
  return { source: a.source, ...(a.databaseId ? { databaseId: a.databaseId } : {}), ...(a.viewId ? { viewId: a.viewId } : {}), filter, limit: Math.min(200, Math.max(1, Math.round(Number(a.limit) || 25))) };
}
/** Body that reads the live data of a `chart` whose `source` is a database (the server caps `limit` at 500). */
export function chartQueryBody(source: NonNullable<ChartAttrs["source"]>): Record<string, unknown> {
  return { source: "database", databaseId: source.databaseId, ...(source.viewId ? { viewId: source.viewId } : {}), filter: {}, limit: 500 };
}
export const knownFilterKeys = () => [...FILTER_KEYS];

const isObj = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string => (v == null ? "" : typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : Array.isArray(v) ? v.map(str).filter(Boolean).join(", ") : isObj(v) ? str(v.title ?? v.name ?? v.label ?? "") : "");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Display text of one typed value. Dates stay ISO here (the view formats them with `shortDate`); checkboxes read Yes / No. */
export function cellDisplay(v: unknown, type: QueryColumnType): string {
  if (v == null) return ""; if (type === "checkbox") return v === true ? "Yes" : v === false ? "No" : str(v);
  if (type === "json" && (isObj(v) || Array.isArray(v))) { const s = str(v); if (s) return s; try { return JSON.stringify(v); } catch { return ""; } }
  return str(v);
}
/**
 * Reads a `POST /api/query` answer of the final contract. Display model per source: the title is the row's `title` (the server sets
 * it for the five sources — for a database it is the row's title property), tasks carry status / due date / block, references a
 * subtitle made of authors · year · journal. Throws `QueryShapeError` when `columns`, `rows` or `table` are not what §4.7 states.
 */
export function normaliseQueryResult(json: unknown, source: string): QueryResult {
  if (!isObj(json)) throw new QueryShapeError("not an object");
  if (!Array.isArray(json.columns) || !Array.isArray(json.rows)) throw new QueryShapeError("columns / rows missing");
  const columns: QueryColumn[] = json.columns.map((c, i) => { if (!isObj(c) || typeof c.key !== "string" || typeof c.label !== "string") throw new QueryShapeError(`column ${i}`); return { key: c.key, label: c.label, type: (COLUMN_TYPES.has(String(c.type)) ? c.type : "text") as QueryColumnType }; });
  const t = json.table; if (!isObj(t) || !Array.isArray(t.columns) || !Array.isArray(t.rows)) throw new QueryShapeError("table missing");
  const table = { columns: t.columns.map(str), rows: t.rows.map((r, i) => { if (!Array.isArray(r)) throw new QueryShapeError(`table row ${i}`); return r.map((v): ChartCell => (v == null ? null : typeof v === "number" ? v : str(v))); }) };
  const src = typeof json.source === "string" ? json.source : source;
  const statusKey = src === "database" ? columns.find((c) => c.type === "select" && /^(status|state|statut|état|etat)$/i.test(c.label))?.key ?? columns.find((c) => c.type === "select")?.key ?? null : null;
  const rows: QueryRow[] = json.rows.map((r, i) => {
    if (!isObj(r) || typeof r.id !== "string") throw new QueryShapeError(`row ${i}`);
    const cells: Record<string, string> = {}; for (const c of columns) cells[c.key] = cellDisplay(r[c.key], c.type);
    const pageId = typeof r.pageId === "string" ? r.pageId : src === "pages" || src === "backlinks" ? r.id : ""; const blockId = typeof r.blockId === "string" ? r.blockId : "";
    const status = src === "tasks" ? str(r.status) : statusKey ? cells[statusKey] ?? "" : "";
    const authors = Array.isArray(r.authors) ? r.authors.map(str).filter(Boolean) : [];
    const title = str(r.title) || (src === "references" ? str(r.citeKey) : "") || "Untitled";
    const subtitle = src === "references" ? [authors.slice(0, 3).join(", ") + (authors.length > 3 ? " et al." : ""), str(r.year), str(r.journal)].filter(Boolean).join(" · ")
      : src === "tasks" ? [str(r.pageTitle), str(r.project)].filter(Boolean).join(" · ") : src === "pages" ? (Array.isArray(r.tags) ? r.tags.map((x) => `#${str(x)}`).join(" ") : "") : src === "backlinks" ? (Array.isArray(r.via) ? r.via.map(str).join(", ") : "") : "";
    return {
      key: r.id, title, subtitle, status: status || null, done: src === "tasks" ? r.status === "done" : false,
      due: src === "tasks" && typeof r.dueAt === "string" ? r.dueAt : null, icon: typeof r.icon === "string" && r.icon ? r.icon : null,
      href: pageId && UUID.test(pageId) ? `/p/${pageId}${blockId ? `#block-${blockId}` : ""}` : src === "references" && UUID.test(r.id) ? `/research?ref=${r.id}` : null, cells,
    };
  });
  return { source: src, rows, columns, total: typeof json.total === "number" ? json.total : rows.length, limit: typeof json.limit === "number" ? json.limit : rows.length, table, resolvedAt: typeof json.resolvedAt === "string" ? json.resolvedAt : new Date().toISOString(), name: typeof json.name === "string" ? json.name : null };
}
/** Columns worth a table column next to the title: everything but the column that repeats the title. */
export function tableColumns(r: Pick<QueryResult, "columns" | "rows">): QueryColumn[] {
  const i = r.columns.findIndex((c) => (c.type === "page" || c.key === "title") && r.rows.every((row) => !row.cells[c.key] || row.cells[c.key] === row.title));
  return r.columns.filter((_, j) => j !== i);
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
/** "just now", "3 min ago", "14:05", "18 Nov, 14:05" — how old the data on screen is. */
export function refreshedLabel(iso: string | null | undefined, now = new Date()): string {
  if (!iso) return ""; const d = new Date(iso); if (Number.isNaN(d.getTime())) return ""; const s = Math.max(0, (now.getTime() - d.getTime()) / 1000);
  if (s < 45) return "just now"; if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`;
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return d.toDateString() === now.toDateString() ? time : `${d.toLocaleDateString(undefined, { day: "numeric", month: "short" })}, ${time}`;
}
/** True when the two tables hold the same cells (a chart snapshot is rewritten only when the live data really changed). */
export function sameTable(a: { columns: string[]; rows: ChartCell[][] }, b: { columns: string[]; rows: ChartCell[][] }): boolean {
  if (a.columns.length !== b.columns.length || a.rows.length !== b.rows.length || a.columns.some((c, i) => c !== b.columns[i])) return false;
  return a.rows.every((r, i) => { const o = b.rows[i]; return r.length === o.length && r.every((v, j) => (v ?? null) === (o[j] ?? null)); });
}

/* ------------------------------------------------- last answer, kept on the device ------------------------------------------------- */
const SNAP_PREFIX = "spn.query.", SNAP_INDEX = "spn.query.index", SNAP_MAX = 40, SNAP_BYTES = 200_000;
type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;
/** Stable key of a request body (key order does not matter). FNV-1a over the canonical JSON — a cache key, not a security feature. */
export function queryKeyOf(body: unknown): string {
  const canon = (v: unknown): unknown => (Array.isArray(v) ? v.map(canon) : isObj(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
  const s = JSON.stringify(canon(body)); let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36) + s.length.toString(36);
}
/** Keeps the raw answer (re-read through `normaliseQueryResult` when needed). At most 40 views, 200 kB each; the oldest are dropped. Never throws. */
export function saveQuerySnapshot(store: Store | null | undefined, body: unknown, answer: unknown): boolean {
  if (!store) return false;
  try {
    const key = queryKeyOf(body), raw = JSON.stringify(answer); if (raw.length > SNAP_BYTES) return false;
    const index: string[] = (() => { try { const v = JSON.parse(store.getItem(SNAP_INDEX) ?? "[]"); return Array.isArray(v) ? v.filter((x) => typeof x === "string") : []; } catch { return []; } })().filter((k) => k !== key);
    index.push(key); while (index.length > SNAP_MAX) store.removeItem(SNAP_PREFIX + index.shift());
    store.setItem(SNAP_PREFIX + key, raw); store.setItem(SNAP_INDEX, JSON.stringify(index)); return true;
  } catch { return false; }
}
export function loadQuerySnapshot(store: Store | null | undefined, body: unknown, source: string): QueryResult | null {
  if (!store) return null;
  try { const raw = store.getItem(SNAP_PREFIX + queryKeyOf(body)); return raw ? normaliseQueryResult(JSON.parse(raw), source) : null; } catch { return null; }
}
