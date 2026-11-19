/**
 * File: src/lib/databases/query.ts
 * Description: row loading + computed values (relations, rollups, formulas) and the JavaScript filter / sort reference implementation.
 *   Since 3.0 the queries themselves run in `engine.ts` (SQL); `queryRowsJs` below is the 2.x full-scan path, kept as the fallback
 *   for rules on computed properties and as the reference of the benchmarks and parity tests.
 * Author: Simon-Pierre Boucher · contact@spboucher.ai
 */
import { and, eq, inArray, isNull, sql as dsql, type SQL } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Property, FilterNode, FilterRule, FilterGroup, Sort, RowOut, RelationRef, QueryInput, QueryResult } from "./types";
import { isGroup, isError } from "./types";
class CycleError extends Error { constructor(public path: string[]) { super("cycle"); } }
import { evaluate, type FVal } from "./formula";
import { displayValue, formulaValue, sortKey, isEmpty, numberOf, dateOf, optionOf } from "./values";

export interface Raw { id: string; pageId: string; databaseId: string; values: Record<string, unknown>; position: number; createdAt: Date; updatedAt: Date; title: string; icon: string | null; pageUpdatedAt: Date; cover?: string | null }
const rawCols = { id: schema.databaseRows.id, pageId: schema.databaseRows.pageId, databaseId: schema.databaseRows.databaseId, values: schema.databaseRows.values, position: schema.databaseRows.position, createdAt: schema.databaseRows.createdAt, updatedAt: schema.databaseRows.updatedAt, title: schema.pages.title, icon: schema.pages.icon, pageUpdatedAt: schema.pages.updatedAt, cover: schema.pages.cover };
export async function loadRaw(where: SQL[]): Promise<Raw[]> {
  return db.select(rawCols).from(schema.databaseRows).innerJoin(schema.pages, eq(schema.pages.id, schema.databaseRows.pageId)).where(and(isNull(schema.databaseRows.deletedAt), isNull(schema.pages.deletedAt), ...where)).orderBy(schema.databaseRows.position, schema.databaseRows.createdAt) as Promise<Raw[]>;
}
export const loadProps = async (dbId: string): Promise<Property[]> => (await db.select().from(schema.databaseProperties).where(eq(schema.databaseProperties.databaseId, dbId)).orderBy(schema.databaseProperties.position, schema.databaseProperties.createdAt)) as Property[];

/** Relations of a set of rows for the given relation properties: Map<rowId, Map<propId, rowId[]>>. */
export async function loadRelations(props: Property[], rowIds: string[]) {
  const out = new Map<string, Map<string, string[]>>(); if (!rowIds.length) return out;
  const fwd = props.filter((p) => p.type === "relation" && !p.config.syncedPropertyId); const syn = props.filter((p) => p.type === "relation" && p.config.syncedPropertyId);
  const push = (row: string, prop: string, to: string) => { let m = out.get(row); if (!m) out.set(row, (m = new Map())); let a = m.get(prop); if (!a) m.set(prop, (a = [])); a.push(to); };
  if (fwd.length) for (const r of await db.select().from(schema.relationsTable).where(and(inArray(schema.relationsTable.propertyId, fwd.map((p) => p.id)), inArray(schema.relationsTable.fromRowId, rowIds))).orderBy(schema.relationsTable.createdAt)) push(r.fromRowId, r.propertyId, r.toRowId);
  if (syn.length) { const by = new Map(syn.map((p) => [p.config.syncedPropertyId as string, p.id])); for (const r of await db.select().from(schema.relationsTable).where(and(inArray(schema.relationsTable.propertyId, [...by.keys()]), inArray(schema.relationsTable.toRowId, rowIds))).orderBy(schema.relationsTable.createdAt)) push(r.toRowId, by.get(r.propertyId)!, r.fromRowId); }
  return out;
}

/** Attach relations, rollups, formulas and timestamps. */
export async function hydrate(props: Property[], raws: Raw[], depth = 0): Promise<RowOut[]> {
  if (!raws.length) return [];
  const ids = raws.map((r) => r.id); const rels = await loadRelations(props, ids);
  const targetIds = new Set<string>(); for (const m of rels.values()) for (const a of m.values()) a.forEach((x) => targetIds.add(x));
  const targets = new Map<string, Raw>(); if (targetIds.size) for (const t of await loadRaw([inArray(schema.databaseRows.id, [...targetIds])])) targets.set(t.id, t);
  // properties of target databases (for rollups over typed values)
  const rollups = props.filter((p) => p.type === "rollup"); const tdb = new Set<string>(); for (const t of targets.values()) tdb.add(t.databaseId);
  for (const p of rollups) { const rel = props.find((x) => x.id === p.config.relationPropertyId); if (typeof rel?.config.targetDatabaseId === "string") tdb.add(rel.config.targetDatabaseId); } // 3.0: the target property is known even when no row is linked
  const tprops = new Map<string, Property[]>(); if (rollups.length) for (const d of tdb) tprops.set(d, d === props[0]?.databaseId ? props : await loadProps(d));
  // 3.0 (audit D9): a rollup over a relation, rollup or formula of the target rows needs those rows hydrated too (computed values are never stored). Two levels deep at most.
  const computed = new Map<string, Record<string, unknown>>();
  if (rollups.length && depth < MAX_ROLLUP_DEPTH) for (const [d, ps] of tprops) {
    const need = rollups.some((p) => { const tp = ps.find((x) => x.id === p.config.targetPropertyId); return !!tp && (tp.type === "relation" || tp.type === "rollup" || tp.type === "formula"); }); if (!need) continue;
    for (const h of await hydrate(ps, [...targets.values()].filter((t) => t.databaseId === d), depth + 1)) computed.set(h.id, h.values);
  }
  const byName = new Map(props.map((p) => [p.name, p]));
  return raws.map((r) => {
    const values: Record<string, unknown> = { ...r.values };
    for (const p of props) {
      if (p.type === "title") values[p.id] = r.title;
      else if (p.type === "created_time") values[p.id] = r.createdAt.toISOString();
      else if (p.type === "last_edited_time") values[p.id] = (r.pageUpdatedAt > r.updatedAt ? r.pageUpdatedAt : r.updatedAt).toISOString();
      else if (p.type === "relation") values[p.id] = (rels.get(r.id)?.get(p.id) ?? []).map((id) => targets.get(id)).filter(Boolean).map((t): RelationRef => ({ rowId: t!.id, pageId: t!.pageId, title: t!.title, icon: t!.icon }));
    }
    for (const p of rollups) values[p.id] = rollup(p, props, values, targets, tprops, computed, depth);
    // Formulas: each one is evaluated once per row (memo); a formula that reads another one gets its value, or its error (3.0: an
    // error in a dependency is no longer silently read as empty); a dependency cycle is reported with its path on every cell of the cycle.
    const memo = new Map<string, ReturnType<typeof evaluate>>(); const stack: string[] = [];
    const run = (q: Property): ReturnType<typeof evaluate> => {
      if (memo.has(q.id)) return memo.get(q.id)!;
      if (stack.includes(q.name)) throw new CycleError([...stack.slice(stack.indexOf(q.name)), q.name]);
      stack.push(q.name); let v: ReturnType<typeof evaluate>;
      try { v = q.config.expression ? evaluate(String(q.config.expression), ctx) : null; } finally { stack.pop(); }
      if (cycle && cycle.includes(q.name)) v = { error: `Circular reference: ${cycle.join(" → ")}` };
      if (!stack.length) cycle = null;
      memo.set(q.id, v); return v;
    };
    let cycle: string[] | null = null;
    const ctx = { prop: (name: string): FVal => { const q = byName.get(name); if (!q) throw new Error(`Unknown property "${name}"`); if (q.type !== "formula") return formulaValue(q, values[q.id]); let v: ReturnType<typeof evaluate>; try { v = run(q); } catch (e) { if (e instanceof CycleError) { cycle = e.path; throw new Error(`Circular reference: ${e.path.join(" → ")}`); } throw e; } if (isError(v)) throw new Error(v.error.startsWith("Circular reference") || v.error.startsWith("Error in ") ? v.error : `Error in "${name}": ${v.error}`); return formulaValue(q, v); } };
    for (const p of props) if (p.type === "formula") values[p.id] = run(p);
    return { id: r.id, pageId: r.pageId, title: r.title, icon: r.icon, values, position: r.position, createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(), ...(r.cover ? { cover: r.cover } : {}) };
  });
}
export const MAX_ROLLUP_DEPTH = 2;
const round1 = (n: number) => Math.round(n * 10) / 10;
function rollup(p: Property, props: Property[], values: Record<string, unknown>, targets: Map<string, Raw>, tprops: Map<string, Property[]>, computed: Map<string, Record<string, unknown>>, depth: number): unknown {
  const rel = props.find((x) => x.id === p.config.relationPropertyId); if (!rel || rel.type !== "relation") return { error: "No relation" };
  const refs = (values[rel.id] as RelationRef[] | undefined) ?? []; const agg = p.config.aggregate ?? "count";
  if (agg === "count") return refs.length;
  const tp = p.config.targetPropertyId ? [...tprops.values()].flat().find((x) => x.id === p.config.targetPropertyId) : undefined; if (!tp) return agg === "count_values" ? 0 : { error: "No target property" };
  const isComputed = tp.type === "relation" || tp.type === "rollup" || tp.type === "formula";
  if (isComputed && depth >= MAX_ROLLUP_DEPTH) return { error: "Rollup nested too deep" };
  const all = refs.map((ref) => { const t = targets.get(ref.rowId); if (!t) return null; if (tp.type === "title") return t.title; if (tp.type === "created_time") return t.createdAt.toISOString(); if (tp.type === "last_edited_time") return (t.pageUpdatedAt > t.updatedAt ? t.pageUpdatedAt : t.updatedAt).toISOString(); if (isComputed) return computed.get(t.id)?.[tp.id] ?? null; return t.values[tp.id] ?? null; });
  const bad = all.find((v) => isComputed && typeof v === "object" && v !== null && "error" in (v as object)) as { error: string } | undefined; if (bad) return { error: `${tp.name}: ${bad.error}` };
  const vals = all.filter((v) => !isEmpty(v)); const n = all.length;
  const pct = (k: number) => (n ? round1((k / n) * 100) : null);
  switch (agg) {
    case "count_values": case "not_empty": return vals.length;
    case "empty": return n - vals.length;
    case "percent_empty": return pct(n - vals.length);
    case "percent_not_empty": return pct(vals.length);
    case "show": return vals.map((v) => displayValue(tp, v));
    case "unique": return [...new Set(vals.map((v) => displayValue(tp, v)))];
    case "count_unique": return new Set(vals.map((v) => displayValue(tp, v))).size;
    case "checked": case "unchecked": case "percent_checked": case "percent_unchecked": {
      const yes = all.filter((v) => v === true || v === "true" || v === 1).length; const k = agg === "checked" || agg === "percent_checked" ? yes : n - yes;
      return agg.startsWith("percent") ? pct(k) : k;
    }
  }
  const dateLike = tp.type === "date" || tp.type === "created_time" || tp.type === "last_edited_time" || (tp.type === "formula" && vals.length > 0 && vals.every((v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}(T|$)/.test(v)));
  if (dateLike) { const ds = vals.map(dateOf).filter(Boolean) as Date[]; if (!ds.length) return null; const lo = Math.min(...ds.map((d) => d.getTime())), hi = Math.max(...ds.map((d) => d.getTime())); if (agg === "min") return new Date(lo).toISOString(); if (agg === "max") return new Date(hi).toISOString(); if (agg === "range") return Math.round((hi - lo) / 864e5); return { error: `${agg} needs numbers` }; }
  const ns = vals.map(tp.type === "checkbox" ? (v) => (v ? 1 : 0) : numberOf).filter((x): x is number => x != null); if (!ns.length) return null;
  const sum = ns.reduce((a, b) => a + b, 0);
  if (agg === "sum") return sum; if (agg === "avg") return sum / ns.length; if (agg === "min") return Math.min(...ns); if (agg === "max") return Math.max(...ns); if (agg === "range") return Math.max(...ns) - Math.min(...ns);
  if (agg === "median") { const s = [...ns].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
  return { error: `Unknown aggregate "${agg}"` };
}

// ---------- filters
const str = (p: Property, v: unknown) => displayValue(p, v).toLowerCase();
const filterDate = (v: unknown) => (v === "today" ? new Date() : dateOf(v));
const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
export function matchRule(rule: FilterRule, p: Property | undefined, values: Record<string, unknown>): boolean {
  if (!p) return true; const v = values[p.id]; const fv = rule.value;
  switch (rule.op) {
    case "empty": return isEmpty(v); case "not_empty": return !isEmpty(v);
    case "eq": case "neq": {
      let r: boolean;
      if (p.type === "checkbox") r = Boolean(v) === (fv === true || fv === "true" || fv === 1);
      else if (p.type === "select" || p.type === "status") r = !isEmpty(v) && (v === fv || optionOf(p, v)?.name === fv);
      else if (p.type === "multi_select") r = Array.isArray(v) && v.some((x) => x === fv || optionOf(p, x)?.name === fv);
      else if (p.type === "relation") r = Array.isArray(v) && (v as RelationRef[]).some((x) => x.rowId === fv || x.title === fv);
      else if (p.type === "number" || (p.type === "formula" && typeof v === "number")) r = numberOf(v) === numberOf(fv);
      else if (p.type === "date") { const a = dateOf(v), b = filterDate(fv); r = !!a && !!b && day(a) === day(b); }
      else r = str(p, v) === String(fv ?? "").toLowerCase();
      return rule.op === "eq" ? r : !r;
    }
    case "contains": return p.type === "multi_select" ? Array.isArray(v) && v.some((x) => x === fv || optionOf(p, x)?.name === fv) : p.type === "relation" ? Array.isArray(v) && (v as RelationRef[]).some((x) => x.rowId === fv || x.title.toLowerCase().includes(String(fv ?? "").toLowerCase())) : str(p, v).includes(String(fv ?? "").toLowerCase());
    case "not_contains": return !matchRule({ ...rule, op: "contains" }, p, values);
    case "starts_with": return str(p, v).startsWith(String(fv ?? "").toLowerCase()); case "ends_with": return str(p, v).endsWith(String(fv ?? "").toLowerCase());
    case "gt": case "gte": case "lt": case "lte": case "before": case "after": case "on": {
      const isDateType = p.type === "date" || p.type === "created_time" || p.type === "last_edited_time" || rule.op === "before" || rule.op === "after" || rule.op === "on";
      let a: number | null, b: number | null;
      if (isDateType) { const x = dateOf(v), y = filterDate(fv); a = x ? day(x) : null; b = y ? day(y) : null; } else { a = numberOf(v); b = numberOf(fv); }
      if (a == null || b == null) return false;
      return rule.op === "gt" || rule.op === "after" ? a > b : rule.op === "gte" ? a >= b : rule.op === "lt" || rule.op === "before" ? a < b : rule.op === "lte" ? a <= b : a === b;
    }
  }
  return true;
}
export function matchFilter(f: FilterNode | null | undefined, props: Map<string, Property>, values: Record<string, unknown>): boolean {
  if (!f) return true;
  if (!isGroup(f)) return matchRule(f, props.get(f.property), values);
  if (f.or) return f.or.length === 0 || f.or.some((n) => matchFilter(n, props, values));
  return (f.and ?? []).every((n) => matchFilter(n, props, values));
}
/** SQL pushdown when every rule is simple (title/text/url/select/status/ai/checkbox); null otherwise. */
function sqlFilter(f: FilterNode, props: Map<string, Property>): SQL | null {
  if (isGroup(f)) { const parts = (f.or ?? f.and ?? []).map((n) => sqlFilter(n, props)); if (parts.some((x) => !x)) return null; if (!parts.length) return dsql`true`; return dsql.join(parts as SQL[], f.or ? dsql` or ` : dsql` and `); }
  const p = props.get(f.property); if (!p) return dsql`true`;
  const col = p.type === "title" ? dsql`${schema.pages.title}` : dsql`(${schema.databaseRows.values}->>${p.id})`;
  if (["title", "text", "url", "select", "status", "ai"].includes(p.type)) {
    const v = String(f.value ?? "");
    if (f.op === "empty") return p.type === "title" ? dsql`(${schema.pages.title} = '' or ${schema.pages.title} = 'Untitled')` : dsql`coalesce(${col}, '') = ''`;
    if (f.op === "not_empty") return p.type === "title" ? dsql`(${schema.pages.title} <> '' and ${schema.pages.title} <> 'Untitled')` : dsql`coalesce(${col}, '') <> ''`;
    if ((p.type === "select" || p.type === "status") && (f.op === "eq" || f.op === "neq")) { const o = optionOf(p, v); const id = o?.id ?? v; return f.op === "eq" ? dsql`${col} = ${id}` : dsql`coalesce(${col}, '') <> ${id}`; }
    if (p.type !== "select" && p.type !== "status") {
      if (f.op === "eq") return dsql`lower(coalesce(${col}, '')) = ${v.toLowerCase()}`; if (f.op === "neq") return dsql`lower(coalesce(${col}, '')) <> ${v.toLowerCase()}`;
      if (f.op === "contains") return dsql`${col} ilike ${"%" + v.replace(/[%_\\]/g, "\\$&") + "%"}`; if (f.op === "not_contains") return dsql`coalesce(${col}, '') not ilike ${"%" + v.replace(/[%_\\]/g, "\\$&") + "%"}`;
      if (f.op === "starts_with") return dsql`${col} ilike ${v.replace(/[%_\\]/g, "\\$&") + "%"}`; if (f.op === "ends_with") return dsql`${col} ilike ${"%" + v.replace(/[%_\\]/g, "\\$&")}`;
    }
  }
  if (p.type === "checkbox" && (f.op === "eq" || f.op === "neq")) { const t = f.value === true || f.value === "true" || f.value === 1; return (f.op === "eq") === t ? dsql`coalesce((${schema.databaseRows.values}->>${p.id})::boolean, false) = true` : dsql`coalesce((${schema.databaseRows.values}->>${p.id})::boolean, false) = false`; }
  return null;
}
export function sortRows(rows: RowOut[], sorts: Sort[], props: Map<string, Property>) {
  if (!sorts.length) return rows;
  const keyed = rows.map((r) => ({ r, k: sorts.map((s) => { const p = props.get(s.property); return p ? sortKey(p, r.values[p.id]) : null; }) }));
  keyed.sort((a, b) => { for (let i = 0; i < sorts.length; i++) { const x = a.k[i], y = b.k[i]; if (x === y) continue; if (x == null) return 1; if (y == null) return -1; const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y)); if (c) return sorts[i].dir === "desc" ? -c : c; } return a.r.position - b.r.position; });
  return keyed.map((k) => k.r);
}
/** 2.x path: loads and hydrates the whole database, then filters / sorts / slices in memory. Reference implementation (benchmarks, parity tests). */
export async function queryRowsJs(dbId: string, props: Property[], input: QueryInput & { ids?: string[] }): Promise<QueryResult> {
  const pm = new Map(props.map((p) => [p.id, p]));
  const where: SQL[] = [eq(schema.databaseRows.databaseId, dbId)]; if (input.ids) where.push(inArray(schema.databaseRows.id, input.ids.length ? input.ids : ["00000000-0000-0000-0000-000000000000"]));
  const pushed = input.filter ? sqlFilter(input.filter, pm) : null; if (pushed) where.push(pushed);
  let rows = await hydrate(props, await loadRaw(where));
  if (input.filter && !pushed) rows = rows.filter((r) => matchFilter(input.filter, pm, r.values));
  if (input.search?.trim()) { const q = input.search.trim().toLowerCase(); rows = rows.filter((r) => r.title.toLowerCase().includes(q) || props.some((p) => p.type !== "title" && displayValue(p, r.values[p.id]).toLowerCase().includes(q))); }
  rows = sortRows(rows, input.sorts ?? [], pm);
  const total = rows.length; const offset = Math.max(0, input.offset ?? 0); const limit = Math.min(1000, Math.max(1, input.limit ?? 200));
  return { rows: rows.slice(offset, offset + limit), total, limit, offset };
}
export const resolveView = (view: { config: FilterGroup | any } | undefined, input: QueryInput): QueryInput => ({ ...input, filter: input.filter === undefined ? (view?.config?.filter ?? null) : input.filter, sorts: input.sorts ?? view?.config?.sorts ?? [] });
