/**
 * File: src/lib/databases/engine.ts
 * Description: Databases Next Generation — the SQL query engine. Filters, sorts, search, grouping, aggregates and pagination run in
 *   PostgreSQL for every stored value type (title, text, url, number, date, checkbox, select, status, multi_select, ai, file, created /
 *   last-edited time); only the requested window is hydrated (relations, rollups, formulas). A rule or a sort on a relation, a rollup or
 *   a formula cannot be expressed in SQL: the query then falls back to the JavaScript path of `query.ts` (after pushing down every
 *   top-level AND rule that can be), and the answer says so (`engine: "js"`, `fallback`). Semantics mirror `matchRule` / `sortKey`.
 * Author: Simon-Pierre Boucher · contact@spboucher.ai
 */
import { and, eq, inArray, isNull, sql as dsql, type SQL } from "drizzle-orm";
import { db, schema } from "@/db";
import { HttpError } from "@/lib/errors";
import type { Property, FilterNode, FilterRule, FilterGroup, Sort, RowOut, QueryInput, QueryResult, GroupOut, NumAgg } from "./types";
import { isGroup, FILTER_OPS } from "./types";
import { hydrate, matchFilter, sortRows, type Raw } from "./query";
import { displayValue, numberOf, dateOf, isEmpty } from "./values";
import { groupKeyOf, groupOrder, GROUPABLE } from "./group";

const R = schema.databaseRows; const P = schema.pages;
const JS_ONLY = new Set(["relation", "rollup", "formula"]);
const TEXTY = new Set(["title", "text", "url", "ai"]);
const DATEY = new Set(["date", "created_time", "last_edited_time"]);
export const MAX_LIMIT = 1000;
const NIL = "00000000-0000-0000-0000-000000000000";
/** The JavaScript path compares calendar days in the server's local zone: the SQL path uses the same zone, explicitly. */
const zone = () => process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
const like = (s: string) => s.replace(/[%_\\]/g, "\\$&");
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const bool = (x: SQL) => dsql`coalesce(${x}, false)`;
const textArr = (a: string[]) => dsql`${`{${a.map((s) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`).join(",")}}`}::text[]`;

// ---------- value expressions
const jv = (p: Property) => dsql`(${R.values}->${p.id}::text)`;
const tv = (p: Property) => dsql`(${R.values}->>${p.id}::text)`;
/** Text of a text-like cell (an AI cell that is pending or failed holds an object: it reads as empty). */
const txt = (p: Property): SQL => (p.type === "title" ? dsql`${P.title}` : dsql`(case when jsonb_typeof(${jv(p)}) = 'object' then '' else coalesce(${tv(p)}, '') end)`);
const present = (p: Property): SQL => (p.type === "title" ? dsql`true` : dsql`${tv(p)} is not null`);
const NUM_RE = "^[+-]?([0-9]+\\.?[0-9]*|\\.[0-9]+)([eE][+-]?[0-9]+)?$";
const numSql = (p: Property): SQL => dsql`(case jsonb_typeof(${jv(p)}) when 'number' then (${tv(p)})::double precision when 'boolean' then (case when ${tv(p)} = 'true' then 1 else 0 end)::double precision when 'string' then (case when regexp_replace(${tv(p)}, '[\\s,$%]', '', 'g') ~ ${NUM_RE} then regexp_replace(${tv(p)}, '[\\s,$%]', '', 'g')::double precision end) end)`;
/** Instant of a date-like cell (timestamptz). A date without time is local midnight, as in `toDate`. */
function tsSql(p: Property): SQL {
  if (p.type === "created_time") return dsql`${R.createdAt}`;
  if (p.type === "last_edited_time") return dsql`greatest(${R.updatedAt}, ${P.updatedAt})`;
  const z = zone();
  return dsql`(case when jsonb_typeof(${jv(p)}) <> 'string' then null when ${tv(p)} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then (case when pg_input_is_valid(${tv(p)}, 'date') then (${tv(p)})::date::timestamp at time zone ${z} end) when ${tv(p)} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T.*(Z|[+-][0-9]{2}:?[0-9]{2})$' then (case when pg_input_is_valid(${tv(p)}, 'timestamptz') then (${tv(p)})::timestamptz end) when ${tv(p)} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T' then (case when pg_input_is_valid(${tv(p)}, 'timestamp') then (${tv(p)})::timestamp at time zone ${z} end) end)`;
}
const daySql = (p: Property): SQL => dsql`((${tsSql(p)}) at time zone ${zone()})::date`;
const truthy = (p: Property): SQL => dsql`(${jv(p)} is not null and ${jv(p)} not in ('false'::jsonb, 'null'::jsonb, '""'::jsonb, '0'::jsonb))`;
function emptySql(p: Property): SQL {
  if (p.type === "title") return dsql`(${P.title} = '' or ${P.title} = 'Untitled')`;
  if (p.type === "created_time" || p.type === "last_edited_time") return dsql`false`;
  return dsql`(${jv(p)} is null or ${jv(p)} in ('null'::jsonb, '""'::jsonb, '[]'::jsonb) or (jsonb_typeof(${jv(p)}) = 'object' and (${jv(p)}->>'pending' = 'true' or jsonb_typeof(${jv(p)}->'error') = 'string')))`;
}
/** Option ids and names a stored select value may equal for the filter value `fv` (an option id or an option name). */
const optionKeys = (p: Property, pred: (name: string, id: string) => boolean): string[] => { const out = new Set<string>(); for (const o of p.config.options ?? []) if (pred(o.name, o.id)) { out.add(o.id); out.add(o.name); } return [...out]; };
const filterDay = (fv: unknown): string | null => { const d = fv === "today" ? new Date() : dateOf(fv); return d ? ymd(d) : null; };

// ---------- filters
/** SQL of one rule, or null when the rule needs the JavaScript path. An unknown property matches every row (as `matchRule`). */
export function ruleSql(rule: FilterRule, p: Property | undefined): SQL | null {
  if (!p) return dsql`true`;
  if (JS_ONLY.has(p.type)) return null;
  const fv = rule.value; const s = String(fv ?? ""); const q = s.toLowerCase();
  switch (rule.op) {
    case "empty": return emptySql(p);
    case "not_empty": return dsql`not ${emptySql(p)}`;
    case "eq": case "neq": {
      let r: SQL | null = null;
      if (p.type === "checkbox") { const want = fv === true || fv === "true" || fv === 1; r = want ? truthy(p) : dsql`not ${truthy(p)}`; }
      else if (p.type === "select" || p.type === "status") r = bool(dsql`(not ${emptySql(p)} and ${tv(p)} = any(${textArr([...new Set([s, ...optionKeys(p, (name) => name === fv)])])}))`);
      else if (p.type === "multi_select") r = bool(dsql`(jsonb_typeof(${jv(p)}) = 'array' and jsonb_exists_any(${jv(p)}, ${textArr([...new Set([s, ...optionKeys(p, (name) => name === fv)])])}))`);
      else if (p.type === "number") { const n = numberOf(fv); r = n == null ? dsql`${numSql(p)} is null` : bool(dsql`${numSql(p)} = ${n}`); }
      else if (p.type === "date") { const d = filterDay(fv); r = d ? bool(dsql`${daySql(p)} = ${d}::date`) : dsql`false`; }
      else if (TEXTY.has(p.type)) r = dsql`lower(${txt(p)}) = ${q}`;
      if (!r) return null;
      return rule.op === "eq" ? r : dsql`not ${r}`;
    }
    case "contains": case "not_contains": {
      let r: SQL | null = null;
      if (p.type === "multi_select") r = bool(dsql`(jsonb_typeof(${jv(p)}) = 'array' and jsonb_exists_any(${jv(p)}, ${textArr([...new Set([s, ...optionKeys(p, (name) => name === fv)])])}))`);
      else if (p.type === "select" || p.type === "status") r = selectText(p, (name) => name.includes(q), dsql`${tv(p)} ilike ${"%" + like(q) + "%"}`, q === "");
      else if (TEXTY.has(p.type)) { if (q === "") return rule.op === "contains" ? present(p) : dsql`false`; r = dsql`${txt(p)} ilike ${"%" + like(q) + "%"}`; } // empty needle: as the 2.x pushdown (a missing value does not "contain" it)
      if (!r) return null;
      return rule.op === "contains" ? r : dsql`not ${r}`;
    }
    case "starts_with": case "ends_with": {
      const st = rule.op === "starts_with";
      if (p.type === "select" || p.type === "status") return selectText(p, (name) => (st ? name.startsWith(q) : name.endsWith(q)), dsql`${tv(p)} ilike ${st ? like(q) + "%" : "%" + like(q)}`, q === "");
      if (TEXTY.has(p.type)) return q === "" ? present(p) : dsql`${txt(p)} ilike ${st ? like(q) + "%" : "%" + like(q)}`;
      return null;
    }
    case "gt": case "gte": case "lt": case "lte": case "before": case "after": case "on": {
      const op = rule.op === "gt" || rule.op === "after" ? dsql`>` : rule.op === "gte" ? dsql`>=` : rule.op === "lt" || rule.op === "before" ? dsql`<` : rule.op === "lte" ? dsql`<=` : dsql`=`;
      if (DATEY.has(p.type)) { const d = filterDay(fv); return d ? bool(dsql`${daySql(p)} ${op} ${d}::date`) : dsql`false`; }
      if (rule.op === "before" || rule.op === "after" || rule.op === "on") return null; // a date comparison on a non-date value: JavaScript path
      if (p.type === "number") { const n = numberOf(fv); return n == null ? dsql`false` : bool(dsql`${numSql(p)} ${op} ${n}`); }
      return null;
    }
  }
  return dsql`true`; // unknown operator: matches everything (legacy); new input is validated before it gets here
}
/** Text operator on a select / status value: compares the option NAME (what the cell displays); a value that is no option compares raw. */
function selectText(p: Property, pred: (lowerName: string) => boolean, raw: SQL, all: boolean): SQL {
  if (all) return dsql`true`;
  const hit = optionKeys(p, (name) => pred(name.toLowerCase())); const known = optionKeys(p, () => true);
  return bool(dsql`(not ${emptySql(p)} and (${tv(p)} = any(${textArr(hit)}) or (${tv(p)} <> all(${textArr(known)}) and ${raw})))`);
}
export function filterSql(f: FilterNode, props: Map<string, Property>): SQL | null {
  if (!isGroup(f)) return ruleSql(f, props.get(f.property));
  const items = f.or ?? f.and ?? []; if (!items.length) return dsql`true`;
  const parts = items.map((n) => filterSql(n, props)); if (parts.some((x) => !x)) return null;
  return dsql`(${dsql.join(parts as SQL[], f.or ? dsql` or ` : dsql` and `)})`;
}
/** Push down what can be: the whole tree, or — for a top-level AND — each rule that compiles. `rest` = true when JavaScript must still filter. */
export function splitFilter(f: FilterGroup | null | undefined, props: Map<string, Property>): { pushed: SQL[]; rest: boolean; reasons: string[] } {
  if (!f) return { pushed: [], rest: false, reasons: [] };
  const whole = filterSql(f, props); if (whole) return { pushed: [whole], rest: false, reasons: [] };
  const reasons = [...new Set(collectRules(f).map((r) => props.get(r.property)).filter((p) => p && !ruleSql({ property: p.id, op: "empty" }, p)).map((p) => `filter:${p!.type}`))];
  if (!reasons.length) reasons.push("filter:operator");
  if (f.or) return { pushed: [], rest: true, reasons };
  return { pushed: (f.and ?? []).map((n) => filterSql(n, props)).filter((x): x is SQL => !!x), rest: true, reasons };
}
export const collectRules = (f: FilterNode | null | undefined): FilterRule[] => (!f ? [] : isGroup(f) ? [...(f.and ?? []), ...(f.or ?? [])].flatMap(collectRules) : [f]);

/**
 * Validation of a filter sent by a client (query body, view config): unknown operator, unknown property, a group carrying both `and`
 * and `or`, nesting deeper than 4 → HTTP 400 `bad_filter` (audit D10: a typo used to silently disable the filter).
 */
export function validateFilter(f: unknown, props: Property[], path = "filter", depth = 0): void {
  if (f == null) return;
  if (typeof f !== "object" || Array.isArray(f)) throw new HttpError(400, `${path}: a filter group or rule is expected`, "bad_filter");
  const o = f as Record<string, unknown>;
  if ("property" in o) {
    if (typeof o.property !== "string" || !props.some((p) => p.id === o.property)) throw new HttpError(400, `${path}: unknown property "${String(o.property)}"`, "bad_filter");
    if (!(FILTER_OPS as readonly string[]).includes(String(o.op))) throw new HttpError(400, `${path}: unknown operator "${String(o.op)}"`, "bad_filter");
    return;
  }
  if (depth > 4) throw new HttpError(400, `${path}: filter groups are nested too deep`, "bad_filter");
  if (o.and !== undefined && o.or !== undefined) throw new HttpError(400, `${path}: a group holds either "and" or "or", not both`, "bad_filter");
  const items = o.and ?? o.or ?? []; if (!Array.isArray(items)) throw new HttpError(400, `${path}: "and" / "or" must be a list`, "bad_filter");
  items.forEach((n, i) => validateFilter(n, props, `${path}.${o.or !== undefined ? "or" : "and"}[${i}]`, depth + 1));
}
export function validateSorts(sorts: unknown, props: Property[]): void {
  if (sorts == null) return; if (!Array.isArray(sorts)) throw new HttpError(400, "sorts: a list is expected", "bad_sort");
  for (const s of sorts) if (!s || typeof s.property !== "string" || !props.some((p) => p.id === s.property) || (s.dir !== "asc" && s.dir !== "desc")) throw new HttpError(400, `sorts: unknown property or direction (${JSON.stringify(s)?.slice(0, 80)})`, "bad_sort");
}

// ---------- sorts
let icu: boolean | null = null;
async function hasIcu(): Promise<boolean> { if (icu == null) { try { icu = (await db.execute(dsql`select 1 from pg_collation where collname = 'und-x-icu'`)).length > 0; } catch { icu = false; } } return icu; }
/** Sort key (null = empty, always last), mirroring `sortKey`. Text compares case-insensitively with the ICU root collation (≈ localeCompare). */
export function sortSql(p: Property, useIcu: boolean): SQL | null {
  if (JS_ONLY.has(p.type) || p.type === "file") return null;
  const coll = (x: SQL) => (useIcu ? dsql`(${x}) collate "und-x-icu"` : x);
  if (p.type === "number") return numSql(p);
  if (DATEY.has(p.type)) return tsSql(p);
  if (p.type === "checkbox") return dsql`(case when ${emptySql(p)} then null when ${truthy(p)} then 1 else 0 end)`;
  if (p.type === "select" || p.type === "status") { const ids = (p.config.options ?? []).map((o) => o.id); return dsql`(case when ${emptySql(p)} then null else coalesce(array_position(${textArr(ids)}, ${tv(p)}), ${ids.length + 1}) end)`; }
  if (p.type === "multi_select") { const names = JSON.stringify(Object.fromEntries((p.config.options ?? []).map((o) => [o.id, o.name]))); return coll(dsql`(case when ${emptySql(p)} then null else (select lower(string_agg(coalesce(${names}::jsonb->>e.v, e.v), ', ' order by e.ord)) from jsonb_array_elements_text(case when jsonb_typeof(${jv(p)}) = 'array' then ${jv(p)} else jsonb_build_array(${jv(p)}) end) with ordinality e(v, ord)) end)`); }
  if (p.type === "title") return coll(dsql`nullif(lower(${P.title}), '')`);
  return coll(dsql`(case when ${emptySql(p)} then null else lower(${txt(p)}) end)`);
}
/** Group key of a row for a select / status / checkbox property (same keys as `groupKeyOf`). */
function groupSql(p: Property): { key: SQL; order: SQL } {
  if (p.type === "checkbox") return { key: dsql`(case when ${truthy(p)} then 'true' else 'false' end)`, order: dsql`(case when ${truthy(p)} then 1 else 0 end)` };
  const ids = (p.config.options ?? []).map((o) => o.id);
  return { key: dsql`(case when ${tv(p)} = any(${textArr(ids)}) then ${tv(p)} else '__none' end)`, order: dsql`coalesce(array_position(${textArr(ids)}, ${tv(p)}), ${ids.length + 1})` };
}

// ---------- search
/**
 * Search over the title and the stored values (text, URL, AI text, option names, raw number, ISO date, relation titles). Null → needs
 * the JavaScript path (rollup / formula present). `dateHits` (see `dateDisplayHits`) adds the days whose DISPLAYED form matches ("mar 3").
 */
export function searchSql(search: string, props: Property[], dateHits?: Map<string, string[]>): SQL | null {
  const q = search.trim().toLowerCase(); if (!q) return dsql`true`;
  if (props.some((p) => p.type === "rollup" || p.type === "formula")) return null;
  // one ILIKE over the concatenated raw texts (title, text, URL, number, ISO date) instead of one per property: ~2× faster on 20 000 rows
  const pat = "%" + like(q) + "%"; const texts: SQL[] = [dsql`${P.title}`]; const parts: SQL[] = [];
  for (const p of props) {
    if (p.type === "text" || p.type === "url") texts.push(tv(p));
    else if (p.type === "number") texts.push(dsql`replace(${tv(p)}, ',', '')`);
    else if (p.type === "ai") texts.push(txt(p));
    else if (p.type === "date") { texts.push(tv(p)); const days = dateHits?.get(p.id); if (days?.length) parts.push(dsql`left(${tv(p)}, 10) = any(${textArr(days)})`); }
    else if (p.type === "select" || p.type === "status") { const hit = optionKeys(p, (name) => name.toLowerCase().includes(q)); if (hit.length) parts.push(dsql`${tv(p)} = any(${textArr(hit)})`); }
    else if (p.type === "multi_select") { const hit = optionKeys(p, (name) => name.toLowerCase().includes(q)); if (hit.length) parts.push(dsql`(jsonb_typeof(${jv(p)}) = 'array' and jsonb_exists_any(${jv(p)}, ${textArr(hit)}))`); }
    else if (p.type === "relation") {
      const synced = p.config.syncedPropertyId as string | undefined;
      parts.push(synced
        ? dsql`exists (select 1 from relations rl join database_rows tr on tr.id = rl.from_row_id join pages tp on tp.id = tr.page_id where rl.property_id = ${synced}::uuid and rl.to_row_id = ${R.id} and tr.deleted_at is null and tp.title ilike ${pat})`
        : dsql`exists (select 1 from relations rl join database_rows tr on tr.id = rl.to_row_id join pages tp on tp.id = tr.page_id where rl.property_id = ${p.id}::uuid and rl.from_row_id = ${R.id} and tr.deleted_at is null and tp.title ilike ${pat})`);
    }
  }
  parts.unshift(dsql`concat_ws(E'\n', ${dsql.join(texts, dsql`, `)}) ilike ${pat}`);
  return dsql`(${dsql.join(parts, dsql` or `)})`;
}

const MONTHS = Array.from({ length: 12 }, (_, m) => displayValue({ type: "date", config: {} } as Property, `2026-${String(m + 1).padStart(2, "0")}-15`).toLowerCase());
/**
 * A date cell shows "Mar 3, 2026": a search typed that way must still find it. Per date property, the ISO days between its smallest and
 * largest stored value whose displayed form contains the query. Skipped when the query has no letters found in a month name.
 */
async function dateDisplayHits(where: SQL[], props: Property[], search: string): Promise<Map<string, string[]> | undefined> {
  const q = search.trim().toLowerCase(); const run = q.match(/[a-zà-ÿ]+/)?.[0]; if (!run || !MONTHS.some((m) => m.includes(run))) return undefined;
  const dates = props.filter((p) => p.type === "date"); if (!dates.length) return undefined; const out = new Map<string, string[]>();
  const range = (await db.execute(dsql`select ${dsql.join(dates.flatMap((p, i) => [dsql`min(left(${tv(p)}, 10)) as ${dsql.raw(`lo${i}`)}`, dsql`max(left(${tv(p)}, 10)) as ${dsql.raw(`hi${i}`)}`]), dsql`, `)} from ${R} inner join ${P} on ${P.id} = ${R.pageId} where ${and(...where)}`)) as unknown as Record<string, string | null>[];
  dates.forEach((p, i) => {
    const lo = dateOf(range[0]?.[`lo${i}`]), hi = dateOf(range[0]?.[`hi${i}`]); if (!lo || !hi) return; const days: string[] = [];
    for (let d = new Date(lo.getFullYear(), lo.getMonth(), lo.getDate()), n = 0; d <= hi && n < 40_000; d.setDate(d.getDate() + 1), n++) { const iso = ymd(d); if (displayValue(p, iso).toLowerCase().includes(q)) days.push(iso); }
    if (days.length) out.set(p.id, days);
  });
  return out;
}

// ---------- the query
const rawCols = { id: R.id, pageId: R.pageId, databaseId: R.databaseId, values: R.values, position: R.position, createdAt: R.createdAt, updatedAt: R.updatedAt, title: P.title, icon: P.icon, pageUpdatedAt: P.updatedAt, cover: P.cover };
export interface EngineInput extends QueryInput { ids?: string[] }
export interface Plan { where: SQL[]; order: SQL[]; sqlOnly: boolean; reasons: string[]; group: Property | undefined; filter: FilterGroup | null }
const andFilters = (a: FilterGroup | null | undefined, b: FilterGroup | null | undefined): FilterGroup | null => { const xs = [a, b].filter((x): x is FilterGroup => !!x && (x.and ?? x.or ?? []).length > 0); return !xs.length ? null : xs.length === 1 ? xs[0] : { and: xs }; };
export async function plan(dbId: string, props: Property[], input: EngineInput): Promise<Plan> {
  const pm = new Map(props.map((p) => [p.id, p])); const useIcu = await hasIcu();
  const where: SQL[] = [eq(R.databaseId, dbId), isNull(R.deletedAt), isNull(P.deletedAt)]; const reasons: string[] = [];
  if (input.ids) where.push(inArray(R.id, input.ids.length ? input.ids : [NIL]));
  const filter = andFilters(input.filter, input.extraFilter);
  const split = splitFilter(filter, pm); where.push(...split.pushed); reasons.push(...split.reasons);
  let sqlOnly = !split.rest;
  // a database with rollups / formulas searches in JavaScript (their values are not stored): one load, the 2.x semantics
  if (input.search?.trim()) { if (props.some((p) => p.type === "rollup" || p.type === "formula")) { sqlOnly = false; reasons.push("search:computed"); } else where.push(bool(searchSql(input.search, props, await dateDisplayHits(where, props, input.search))!)); }
  const group = input.groupBy ? props.find((p) => p.id === input.groupBy && GROUPABLE.has(p.type)) : undefined;
  const order: SQL[] = []; if (group) order.push(dsql`${groupSql(group).order} asc`);
  for (const s of input.sorts ?? []) { const p = pm.get(s.property); if (!p) continue; const k = sortSql(p, useIcu); if (!k) { sqlOnly = false; reasons.push(`sort:${p.type}`); continue; } order.push(s.dir === "desc" ? dsql`${k} desc nulls last` : dsql`${k} asc nulls last`); }
  order.push(dsql`${R.position} asc`, dsql`${R.createdAt} asc`, dsql`${R.id} asc`);
  return { where, order, sqlOnly, reasons: [...new Set(reasons)], group, filter };
}
const numProps = (props: Property[]) => props.filter((p) => p.type === "number");
function aggCols(props: Property[]): Record<string, SQL> { const cols: Record<string, SQL> = {}; numProps(props).forEach((p, i) => { cols[`s${i}`] = dsql`sum(${numSql(p)})`; cols[`n${i}`] = dsql`count(${numSql(p)})`; cols[`lo${i}`] = dsql`min(${numSql(p)})`; cols[`hi${i}`] = dsql`max(${numSql(p)})`; }); return cols; }
function aggOut(props: Property[], row: Record<string, unknown>): Record<string, NumAgg> { const out: Record<string, NumAgg> = {}; numProps(props).forEach((p, i) => { const n = Number(row[`n${i}`] ?? 0); if (!n) return; const sum = Number(row[`s${i}`] ?? 0); out[p.id] = { sum, avg: sum / n, min: Number(row[`lo${i}`]), max: Number(row[`hi${i}`]), count: n }; }); return out; }
/** Aggregates of numeric values computed in JavaScript (fallback path; also covers numeric formulas and rollups). */
function aggJs(props: Property[], rows: RowOut[]): Record<string, NumAgg> {
  const out: Record<string, NumAgg> = {};
  for (const p of props) { if (p.type !== "number" && p.type !== "formula" && p.type !== "rollup") continue; const ns = rows.map((r) => (typeof r.values[p.id] === "number" || p.type === "number" ? numberOf(r.values[p.id]) : null)).filter((n): n is number => n != null); if (!ns.length) continue; const sum = ns.reduce((a, b) => a + b, 0); out[p.id] = { sum, avg: sum / ns.length, min: Math.min(...ns), max: Math.max(...ns), count: ns.length }; }
  return out;
}
function mergeAggs(list: Record<string, NumAgg>[]): Record<string, NumAgg> { const out: Record<string, NumAgg> = {}; for (const a of list) for (const [k, v] of Object.entries(a)) { const o = out[k]; out[k] = o ? { sum: o.sum + v.sum, count: o.count + v.count, min: Math.min(o.min, v.min), max: Math.max(o.max, v.max), avg: (o.sum + v.sum) / (o.count + v.count) } : { ...v }; } return out; }
const from = () => db.select(rawCols).from(R).innerJoin(P, eq(P.id, R.pageId));

/**
 * The database query. Backwards compatible answer `{rows, total, limit, offset}` plus additive fields:
 * `engine`, `fallback`, `hasMore`, `groups` (when `groupBy` is sent: every group of the WHOLE result with its count, its start offset in
 * the returned order and numeric aggregates) and `aggregates` (when `aggregates` or `groupBy` is sent).
 * With `groupBy`, rows are ordered by group first (option order, "no value" last), then by the sorts.
 */
export async function queryRows(dbId: string, props: Property[], input: EngineInput): Promise<QueryResult> {
  const offset = Math.max(0, Math.floor(input.offset ?? 0)); const limit = Math.min(MAX_LIMIT, Math.max(0, Math.floor(input.limit ?? 200)));
  const pl = await plan(dbId, props, input); const wantAgg = !!input.aggregates || (!!pl.group && !input.skipGroups);
  if (pl.sqlOnly) {
    const where = and(...pl.where);
    let groups: GroupOut[] | undefined; let aggregates: Record<string, NumAgg> | undefined; let total: number;
    if (pl.group && !input.skipGroups) {
      // one pass: the key / order / numeric expressions are computed in a sub-select so that GROUP BY sees plain columns; totals are the sum of the groups
      const g = groupSql(pl.group); const nums = numProps(props);
      const inner = dsql.join([dsql`${g.key} as k`, dsql`${g.order} as o`, ...nums.map((p, i) => dsql`${numSql(p)} as ${dsql.raw(`v${i}`)}`)], dsql`, `);
      const outer = nums.map((_, i) => dsql.raw(`, sum(v${i}) as s${i}, count(v${i}) as n${i}, min(v${i}) as lo${i}, max(v${i}) as hi${i}`));
      const gs = (await db.execute(dsql`select k as key, min(o) as ord, count(*) as count${dsql.join(outer, dsql``)} from (select ${inner} from ${R} inner join ${P} on ${P.id} = ${R.pageId} where ${where}) s group by k order by min(o)`)) as unknown as Record<string, unknown>[];
      let at = 0; groups = gs.map((x): GroupOut => { const count = Number(x.count); const o: GroupOut = { key: String(x.key), count, offset: at, aggregates: aggOut(props, x) }; at += count; return o; });
      total = at; aggregates = mergeAggs(groups.map((x) => x.aggregates));
    } else {
      const [head] = await db.select({ total: dsql<number>`count(*)`, ...(wantAgg ? aggCols(props) : {}) }).from(R).innerJoin(P, eq(P.id, R.pageId)).where(where);
      total = Number(head?.total ?? 0); if (wantAgg) aggregates = aggOut(props, head as Record<string, unknown>);
    }
    const raws = limit && offset < total ? ((await from().where(where).orderBy(...pl.order).limit(limit).offset(offset)) as Raw[]) : [];
    const rows = await hydrate(props, raws);
    const out: QueryResult = { rows, total, limit, offset, engine: "sql", hasMore: offset + rows.length < total };
    if (aggregates) out.aggregates = aggregates; if (groups) out.groups = groups;
    return out;
  }
  // ---------- JavaScript path (a rule / sort / search on a relation, rollup or formula): the pushed-down part still narrows the load
  const pm = new Map(props.map((p) => [p.id, p]));
  let rows = await hydrate(props, (await from().where(and(...pl.where)).orderBy(R.position, R.createdAt)) as Raw[]);
  if (pl.filter) rows = rows.filter((r) => matchFilter(pl.filter, pm, r.values));
  if (input.search?.trim() && pl.reasons.includes("search:computed")) { const q = input.search.trim().toLowerCase(); rows = rows.filter((r) => r.title.toLowerCase().includes(q) || props.some((p) => p.type !== "title" && displayValue(p, r.values[p.id]).toLowerCase().includes(q))); }
  rows = sortRows(rows, input.sorts ?? [], pm);
  const out: QueryResult = { rows: [], total: rows.length, limit, offset, engine: "js", fallback: pl.reasons };
  if (pl.group) { // (the JavaScript path has every row in hand: `skipGroups` saves nothing here)
    const gp = pl.group; const buckets = new Map<string, RowOut[]>(); for (const r of rows) { const k = groupKeyOf(gp, r.values[gp.id]); let b = buckets.get(k); if (!b) buckets.set(k, (b = [])); b.push(r); }
    const keys = [...buckets.keys()].sort((a, b) => groupOrder(gp, a) - groupOrder(gp, b)); let at = 0; rows = [];
    out.groups = keys.map((k) => { const b = buckets.get(k)!; const o: GroupOut = { key: k, count: b.length, offset: at, aggregates: aggJs(props, b) }; at += b.length; rows.push(...b); return o; });
  }
  if (wantAgg) out.aggregates = aggJs(props, rows);
  out.rows = limit ? rows.slice(offset, offset + limit) : []; out.hasMore = offset + out.rows.length < out.total;
  return out;
}
/** Ids of every row matching a query, in order (bulk actions on "all rows of this view"). */
export async function queryIds(dbId: string, props: Property[], input: EngineInput, cap = 50_000): Promise<string[]> {
  const pl = await plan(dbId, props, input);
  if (pl.sqlOnly) return (await db.select({ id: R.id }).from(R).innerJoin(P, eq(P.id, R.pageId)).where(and(...pl.where)).orderBy(...pl.order).limit(cap)).map((r) => r.id);
  const ids: string[] = []; for await (const page of iterateRows(dbId, props, input, 1000)) { for (const r of page) ids.push(r.id); if (ids.length >= cap) break; }
  return ids.slice(0, cap);
}
/** Every row of a query, page by page (CSV export, bulk actions): SQL windows, or one JavaScript pass sliced. */
export async function* iterateRows(dbId: string, props: Property[], input: EngineInput, pageSize = 1000): AsyncGenerator<RowOut[]> {
  const pl = await plan(dbId, props, input);
  if (pl.sqlOnly) {
    // keyset-free paging is safe here: the order ends with (position, created_at, id), which is total
    for (let offset = 0; ; offset += pageSize) { const raws = (await from().where(and(...pl.where)).orderBy(...pl.order).limit(pageSize).offset(offset)) as Raw[]; if (!raws.length) return; yield await hydrate(props, raws); if (raws.length < pageSize) return; }
  }
  const pm = new Map(props.map((p) => [p.id, p]));
  let rows = await hydrate(props, (await from().where(and(...pl.where)).orderBy(R.position, R.createdAt)) as Raw[]);
  if (pl.filter) rows = rows.filter((r) => matchFilter(pl.filter, pm, r.values));
  if (input.search?.trim() && pl.reasons.includes("search:computed")) { const q = input.search.trim().toLowerCase(); rows = rows.filter((r) => r.title.toLowerCase().includes(q) || props.some((p) => p.type !== "title" && displayValue(p, r.values[p.id]).toLowerCase().includes(q))); }
  rows = sortRows(rows, input.sorts ?? [], pm);
  for (let i = 0; i < rows.length; i += pageSize) yield rows.slice(i, i + pageSize);
}
export { isEmpty };
