/**
 * File: tests/unit/next-p-db-engine.test.ts
 * Description: Databases Next Generation — the SQL query engine against the 2.x JavaScript reference (`queryRowsJs`) on the same rows:
 *   every operator on every stored type, sorts, search, windows, grouping and aggregates; the JavaScript fallback for computed
 *   properties; validation of filters and sorts (audit D10). Runs against a *_dev database.
 * Author: Simon-Pierre Boucher · contact@spboucher.ai
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { workspace, mk, cleanup, code } from "../helpers/next";
import { ensureDatabase, createProperty, createRow, getDatabase, updateView, createView, deleteProperty } from "../../src/lib/databases/service";
import { queryRows, queryIds, iterateRows, validateFilter, validateSorts, ruleSql, splitFilter } from "../../src/lib/databases/engine";
import { queryRowsJs, matchFilter } from "../../src/lib/databases/query";
import { groupKeyOf, groupMetas } from "../../src/lib/databases/group";
import { numberOf } from "../../src/lib/databases/values";
import type { Database, FilterGroup, FilterOp, Property, Sort } from "../../src/lib/databases/types";

let ws: string; const PFX = "nx-pdb-engine ·"; let d: Database; let P: Record<string, Property>; let stored: Property[]; let other: Database;
let seed = 7; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }; const pick = <T>(a: T[]) => a[Math.floor(rnd() * a.length)];
const N = 160;
before(async () => {
  ws = await workspace();
  const tp = await mk(ws, `${PFX} target`, undefined, { type: "database", section: "databases" }); const t = await ensureDatabase(ws, tp.id);
  const tn = await createProperty(ws, t.id, { name: "Points", type: "number" }); const targets: string[] = [];
  for (let i = 0; i < 6; i++) targets.push((await createRow(ws, t.id, { title: `${PFX} t${i} ${["alpha", "beta", "gamma"][i % 3]}`, values: { [tn.id]: i * 10 } })).id);
  const page = await mk(ws, `${PFX} db`, undefined, { type: "database", section: "databases" }); const db0 = await ensureDatabase(ws, page.id);
  const mkp = (name: string, type: any, config: any = {}) => createProperty(ws, db0.id, { name, type, config });
  await mkp("Text", "text"); await mkp("Url", "url"); await mkp("Num", "number"); await mkp("Date", "date"); await mkp("When", "date", { includeTime: true }); await mkp("Check", "checkbox");
  await mkp("Status", "status"); await mkp("Sel", "select", { options: [{ id: "a", name: "Apple", color: "red" }, { id: "b", name: "Banana", color: "yellow" }, { id: "c", name: "Cherry pie", color: "pink" }] });
  await mkp("Multi", "multi_select", { options: [{ id: "x", name: "Xray", color: "gray" }, { id: "y", name: "Yankee", color: "blue" }, { id: "z", name: "Zulu", color: "green" }] });
  await mkp("Ai", "ai", { prompt: "x" }); await mkp("Created", "created_time"); await mkp("Edited", "last_edited_time");
  const rel = await mkp("Rel", "relation", { targetDatabaseId: t.id }); await mkp("Roll", "rollup", { relationPropertyId: rel.id, targetPropertyId: tn.id, aggregate: "sum" });
  await mkp("Form", "formula", { expression: 'prop("Num") * 2' });
  d = await getDatabase(ws, db0.id); P = Object.fromEntries(d.properties.map((p) => [p.name, p])); stored = d.properties.filter((p) => !["relation", "rollup", "formula"].includes(p.type));
  const words = ["alpha", "Bravo", "charlie", "delta", "Echo", "foxtrot 12", "golf_x", "hotel%", "india", ""]; const rows: any[] = [];
  for (let i = 0; i < N; i++) {
    const v: Record<string, unknown> = {};
    if (rnd() < 0.8) v[P.Text.id] = `${pick(words)} ${pick(words)}`.trim();
    if (rnd() < 0.5) v[P.Url.id] = `https://ex.org/${pick(words)}/${i}`;
    if (rnd() < 0.85) v[P.Num.id] = rnd() < 0.1 ? String(Math.floor(rnd() * 50)) : rnd() < 0.1 ? "1,250" : Math.round((rnd() * 200 - 50) * 100) / 100;
    if (rnd() < 0.8) v[P.Date.id] = new Date(Date.UTC(2026, Math.floor(rnd() * 12), 1 + Math.floor(rnd() * 28))).toISOString().slice(0, 10);
    if (rnd() < 0.6) v[P.When.id] = new Date(Date.UTC(2026, 10, 1 + Math.floor(rnd() * 28), Math.floor(rnd() * 24), 30)).toISOString();
    if (rnd() < 0.6) v[P.Check.id] = rnd() < 0.5;
    if (rnd() < 0.8) v[P.Status.id] = pick(["todo", "doing", "done"]);
    if (rnd() < 0.7) v[P.Sel.id] = rnd() < 0.08 ? "ghost" : pick(["a", "b", "c"]);
    if (rnd() < 0.6) v[P.Multi.id] = ["x", "y", "z"].filter(() => rnd() < 0.4);
    if (rnd() < 0.5) v[P.Ai.id] = rnd() < 0.15 ? { pending: true, at: "2026-11-19T00:00:00Z" } : rnd() < 0.15 ? { error: "boom" } : `summary ${pick(words)}`;
    if (rnd() < 0.5) v[P.Rel.id] = [pick(targets), pick(targets)];
    rows.push({ title: `${PFX} ${pick(words)} ${String(i).padStart(3, "0")}`, values: v });
  }
  for (const r of rows) await createRow(ws, d.id, r);
  const op = await mk(ws, `${PFX} other`, undefined, { type: "database", section: "databases" }); other = await getDatabase(ws, (await ensureDatabase(ws, op.id)).id);
});
after(async () => { await cleanup(ws, PFX); });

const ids = (r: { rows: { id: string }[] }) => r.rows.map((x) => x.id);
async function same(props: Property[], input: { filter?: FilterGroup | null; sorts?: Sort[]; search?: string }, label: string, expect: "sql" | "js" = "sql") {
  const a = await queryRows(d.id, props, { ...input, limit: 1000 }); const b = await queryRowsJs(d.id, props, { ...input, limit: 1000 });
  assert.equal(a.engine, expect, `${label}: engine`); assert.equal(a.total, b.total, `${label}: total (sql ${a.total}, js ${b.total})`);
  assert.deepEqual(ids(a), ids(b), `${label}: rows and order`); return a;
}

test("filters: every operator on every stored type gives the rows of the JavaScript reference, from SQL", async () => {
  const cases: [string, FilterOp, unknown][] = [];
  for (const n of ["Text", "Url", "Ai"]) for (const [op, v] of [["contains", "alpha"], ["contains", "ALPHA"], ["not_contains", "bravo"], ["eq", "alpha delta"], ["neq", "alpha delta"], ["starts_with", "ech"], ["ends_with", "india"], ["contains", "hotel%"], ["contains", "golf_"], ["contains", ""], ["starts_with", ""], ["empty", undefined], ["not_empty", undefined]] as [FilterOp, unknown][]) cases.push([n, op, v]);
  for (const [op, v] of [["eq", 12], ["eq", "1250"], ["neq", 12], ["gt", 100], ["gte", 100], ["lt", 0], ["lte", 0], ["gt", "25"], ["eq", ""], ["gt", "abc"], ["empty", undefined], ["not_empty", undefined]] as [FilterOp, unknown][]) cases.push(["Num", op, v]);
  for (const n of ["Date", "When"]) for (const [op, v] of [["on", "2026-11-14"], ["before", "2026-06-15"], ["after", "2026-06-15"], ["eq", "2026-11-14"], ["neq", "2026-11-14"], ["gte", "2026-11-10"], ["lt", "2026-03-01"], ["on", "today"], ["before", "today"], ["on", "nonsense"], ["empty", undefined], ["not_empty", undefined]] as [FilterOp, unknown][]) cases.push([n, op, v]);
  for (const n of ["Created", "Edited"]) for (const [op, v] of [["on", "today"], ["before", "today"], ["after", "2020-01-01"], ["gte", "today"], ["empty", undefined], ["not_empty", undefined]] as [FilterOp, unknown][]) cases.push([n, op, v]);
  for (const [op, v] of [["eq", true], ["eq", false], ["eq", "true"], ["neq", true], ["empty", undefined], ["not_empty", undefined]] as [FilterOp, unknown][]) cases.push(["Check", op, v]);
  for (const n of ["Status", "Sel"]) for (const [op, v] of [["eq", n === "Sel" ? "a" : "doing"], ["eq", n === "Sel" ? "Banana" : "Done"], ["neq", n === "Sel" ? "c" : "todo"], ["eq", "ghost"], ["contains", "an"], ["not_contains", "an"], ["starts_with", "ch"], ["ends_with", "e"], ["contains", "ghost"], ["empty", undefined], ["not_empty", undefined]] as [FilterOp, unknown][]) cases.push([n, op, v]);
  for (const [op, v] of [["contains", "x"], ["contains", "Yankee"], ["not_contains", "z"], ["eq", "y"], ["neq", "y"], ["empty", undefined], ["not_empty", undefined]] as [FilterOp, unknown][]) cases.push(["Multi", op, v]);
  for (const [op, v] of [["contains", "alpha"], ["eq", `${PFX} alpha 001`], ["starts_with", PFX.toLowerCase()], ["ends_with", "7"], ["not_contains", "0"]] as [FilterOp, unknown][]) cases.push(["Name", op, v]);
  let n = 0; let nonTrivial = 0;
  // An AI cell that is pending or failed is EMPTY for the engine (as `isEmpty` and the JavaScript path); the 2.x pushdown called it filled.
  const everything = (await queryRowsJs(d.id, d.properties, { limit: 1000 })).rows; const pm = new Map(d.properties.map((p) => [p.id, p]));
  for (const op of ["empty", "not_empty"] as FilterOp[]) { const f: FilterGroup = { and: [{ property: P.Ai.id, op }] }; const r = await queryRows(d.id, d.properties, { filter: f, limit: 1000 }); assert.equal(r.engine, "sql"); assert.deepEqual(ids(r), everything.filter((x) => matchFilter(f, pm, x.values)).map((x) => x.id), `Ai ${op}`); }
  for (const [name, op, value] of cases.filter(([n, o]) => !(n === "Ai" && (o === "empty" || o === "not_empty")))) { const r = await same(d.properties, { filter: { and: [{ property: P[name].id, op, value }] } }, `${name} ${op} ${JSON.stringify(value)}`); n++; if (r.total > 0 && r.total < N) nonTrivial++; }
  assert.ok(n >= 110, `only ${n} cases`); assert.ok(nonTrivial >= 60, `only ${nonTrivial} cases select a strict subset`);
});

test("filters: nested AND / OR groups run in SQL and match the reference", async () => {
  const f1: FilterGroup = { and: [{ property: P.Status.id, op: "eq", value: "doing" }, { or: [{ property: P.Num.id, op: "gt", value: 100 }, { property: P.Check.id, op: "eq", value: true }, { and: [{ property: P.Text.id, op: "contains", value: "alpha" }, { property: P.Date.id, op: "before", value: "2026-07-01" }] }] }] };
  const f2: FilterGroup = { or: [{ property: P.Sel.id, op: "empty" }, { and: [{ property: P.Multi.id, op: "contains", value: "x" }, { property: P.Multi.id, op: "not_contains", value: "y" }] }] };
  for (const [i, f] of [f1, f2, { and: [] } as FilterGroup, { or: [] } as FilterGroup].entries()) await same(d.properties, { filter: f }, `group ${i}`);
});

test("sorts: each stored type, both directions, multi-key — same order as the reference; empty values last", async () => {
  for (const name of ["Name", "Text", "Url", "Num", "Date", "When", "Check", "Status", "Sel", "Multi", "Created"]) for (const dir of ["asc", "desc"] as const) {
    const r = await same(d.properties, { sorts: [{ property: P[name].id, dir }] }, `sort ${name} ${dir}`);
    if (name === "Num") { const ns = r.rows.map((x) => numberOf(x.values[P.Num.id])); const firstNull = ns.indexOf(null); assert.ok(firstNull > 0 && ns.slice(firstNull).every((x) => x == null), "empty numbers are last in both directions"); }
  }
  await same(d.properties, { sorts: [{ property: P.Status.id, dir: "asc" }, { property: P.Num.id, dir: "desc" }, { property: P.Name.id, dir: "asc" }] }, "multi-key");
  await same(d.properties, { filter: { and: [{ property: P.Check.id, op: "eq", value: true }] }, sorts: [{ property: P.Date.id, dir: "desc" }] }, "filter + sort");
});

test("search: SQL on a database without computed properties, JavaScript when a rollup / formula exists — same rows either way", async () => {
  const noComputed = d.properties.filter((p) => p.type !== "rollup" && p.type !== "formula");
  for (const q of ["alpha", "FOXTROT 12", "ex.org/india", "banana", "yankee", "1250", "summary", "t3 alpha", "hotel%", "zzzz-nothing"]) { const r = await same(noComputed, { search: q }, `search "${q}"`); if (q === "zzzz-nothing") assert.equal(r.total, 0); else assert.ok(r.total > 0, `"${q}" finds something`); }
  const r = await queryRows(d.id, noComputed, { search: "nov 14", limit: 1000 }); const ref = await queryRowsJs(d.id, noComputed, { search: "nov 14", limit: 1000 });
  assert.deepEqual(ids(r), ids(ref), "a date typed as displayed (“nov 14”) is found from SQL");
  // additive: the SQL search also finds a date by its ISO form (the 2.x search only knew the displayed form)
  const iso = await queryRows(d.id, noComputed, { search: "2026-11-1", limit: 1000 }); assert.equal(iso.engine, "sql"); assert.ok(iso.total > 0 && iso.rows.every((x) => [P.Date.id, P.When.id].some((k) => String(x.values[k] ?? "").includes("2026-11-1")) || x.title.includes("2026-11-1")));
  const viaJs = await same(d.properties, { search: "alpha" }, "search with computed", "js"); assert.deepEqual(viaJs.fallback, ["search:computed"]);
});

test("fallback: a rule or a sort on a relation / rollup / formula uses the JavaScript path, says so, and still pushes the other AND rules down", async () => {
  const a = await same(d.properties, { filter: { and: [{ property: P.Form.id, op: "gt", value: 100 }, { property: P.Status.id, op: "eq", value: "doing" }] } }, "formula rule", "js");
  assert.deepEqual(a.fallback, ["filter:formula"]);
  const split = splitFilter({ and: [{ property: P.Form.id, op: "gt", value: 100 }, { property: P.Status.id, op: "eq", value: "doing" }] }, new Map(d.properties.map((p) => [p.id, p])));
  assert.equal(split.pushed.length, 1); assert.equal(split.rest, true);
  assert.equal((await same(d.properties, { filter: { and: [{ property: P.Rel.id, op: "contains", value: "alpha" }] } }, "relation rule", "js")).fallback?.[0], "filter:relation");
  assert.equal((await same(d.properties, { filter: { and: [{ property: P.Roll.id, op: "gte", value: 30 }] } }, "rollup rule", "js")).fallback?.[0], "filter:rollup");
  assert.equal((await same(d.properties, { sorts: [{ property: P.Form.id, dir: "desc" }] }, "formula sort", "js")).fallback?.[0], "sort:formula");
  assert.equal(ruleSql({ property: P.Rel.id, op: "empty" }, P.Rel), null);
  assert.equal((await same(d.properties, { filter: { and: [{ property: P.Text.id, op: "before", value: "2026-01-01" }] } }, "date operator on text", "js")).fallback?.[0], "filter:operator");
});

test("windows: limit / offset slices of the SQL order tile the whole result; limit 0 returns counts only; only the window is hydrated", async () => {
  const sorts: Sort[] = [{ property: P.Num.id, dir: "desc" }]; const all = await queryRows(d.id, d.properties, { sorts, limit: 1000 }); const seen: string[] = [];
  for (let offset = 0; offset < all.total; offset += 37) { const w = await queryRows(d.id, d.properties, { sorts, limit: 37, offset }); assert.equal(w.total, all.total); assert.equal(w.hasMore, offset + w.rows.length < all.total); seen.push(...ids(w)); }
  assert.deepEqual(seen, ids(all));
  const none = await queryRows(d.id, d.properties, { limit: 0 }); assert.equal(none.rows.length, 0); assert.equal(none.total, N); assert.equal(none.hasMore, true);
  const one = await queryRows(d.id, d.properties, { limit: 3, offset: 5 }); assert.equal(one.rows.length, 3); assert.ok(one.rows.every((r) => typeof r.values[P.Created.id] === "string"));
  const byIds = await queryRows(d.id, d.properties, { ids: [all.rows[3].id, all.rows[9].id], limit: 10 }); assert.equal(byIds.total, 2);
  const paged: string[] = []; for await (const page of iterateRows(d.id, d.properties, { sorts }, 50)) paged.push(...page.map((r) => r.id)); assert.deepEqual(paged, ids(all));
  assert.deepEqual(await queryIds(d.id, d.properties, { sorts }), ids(all));
  assert.deepEqual(await queryIds(d.id, d.properties, { sorts: [{ property: P.Form.id, dir: "asc" }] }), ids(await queryRowsJs(d.id, d.properties, { sorts: [{ property: P.Form.id, dir: "asc" }], limit: 1000 })));
});

test("grouping: counts, offsets and numeric aggregates of every group are computed on the whole result; rows come ordered by group", async () => {
  const all = (await queryRowsJs(d.id, d.properties, { limit: 1000 })).rows;
  for (const name of ["Status", "Sel", "Check"]) {
    const gp = P[name]; const r = await queryRows(d.id, d.properties, { groupBy: gp.id, limit: 20, sorts: [{ property: P.Num.id, dir: "asc" }] });
    assert.equal(r.engine, "sql"); assert.ok(r.groups && r.groups.length >= 2);
    const expected = new Map<string, typeof all>(); for (const row of all) { const k = groupKeyOf(gp, row.values[gp.id]); expected.set(k, [...(expected.get(k) ?? []), row]); }
    assert.equal(r.groups!.reduce((s, g) => s + g.count, 0), N); assert.equal(r.total, N);
    const order = groupMetas(gp).map((m) => m.key).filter((k) => expected.has(k)); assert.deepEqual(r.groups!.map((g) => g.key), order, `${name}: option order, no value last`);
    let at = 0; for (const g of r.groups!) {
      assert.equal(g.count, expected.get(g.key)!.length, `${name}/${g.key} count`); assert.equal(g.offset, at); at += g.count;
      const ns = expected.get(g.key)!.map((x) => numberOf(x.values[P.Num.id])).filter((x): x is number => x != null); const sum = ns.reduce((a, b) => a + b, 0);
      assert.ok(Math.abs((g.aggregates[P.Num.id]?.sum ?? 0) - sum) < 1e-6, `${name}/${g.key} sum`); if (ns.length) { assert.equal(g.aggregates[P.Num.id].count, ns.length); assert.ok(Math.abs(g.aggregates[P.Num.id].avg - sum / ns.length) < 1e-6); }
    }
    // a window that starts at a group's offset starts with a row of that group, sorted by Num inside the group
    const g1 = r.groups![1]; const w = await queryRows(d.id, d.properties, { groupBy: gp.id, limit: 5, offset: g1.offset, sorts: [{ property: P.Num.id, dir: "asc" }] });
    assert.ok(w.rows.length > 0 && w.rows.every((x, i) => i >= g1.count || groupKeyOf(gp, x.values[gp.id]) === g1.key), `${name}: window at the offset of group 2`);
    const total = all.map((x) => numberOf(x.values[P.Num.id])).filter((x): x is number => x != null).reduce((a, b) => a + b, 0); assert.ok(Math.abs(r.aggregates![P.Num.id].sum - total) < 1e-6);
  }
  const filtered = await queryRows(d.id, d.properties, { groupBy: P.Status.id, limit: 0, filter: { and: [{ property: P.Check.id, op: "eq", value: true }] } });
  assert.equal(filtered.groups!.reduce((s, g) => s + g.count, 0), all.filter((x) => x.values[P.Check.id] === true).length);
  const viaJs = await queryRows(d.id, d.properties, { groupBy: P.Status.id, limit: 1000, sorts: [{ property: P.Form.id, dir: "asc" }] }); assert.equal(viaJs.engine, "js");
  const sqlOrder = await queryRows(d.id, d.properties, { groupBy: P.Status.id, limit: 1000 }); assert.deepEqual(viaJs.groups!.map((g) => [g.key, g.count, g.offset]), sqlOrder.groups!.map((g) => [g.key, g.count, g.offset]));
  assert.ok(viaJs.rows.every((x, i, a) => i === 0 || groupMetas(P.Status).findIndex((m) => m.key === groupKeyOf(P.Status, x.values[P.Status.id])) >= groupMetas(P.Status).findIndex((m) => m.key === groupKeyOf(P.Status, a[i - 1].values[P.Status.id]))));
  const agg = await queryRows(d.id, stored, { aggregates: true, limit: 0 }); assert.equal(agg.aggregates![P.Num.id].count, all.filter((x) => numberOf(x.values[P.Num.id]) != null).length);
});

test("extraFilter is ANDed with the filter (calendar window, board column) without replacing it", async () => {
  const filter: FilterGroup = { and: [{ property: P.Status.id, op: "eq", value: "doing" }] }; const extraFilter: FilterGroup = { and: [{ property: P.Date.id, op: "gte", value: "2026-06-01" }, { property: P.Date.id, op: "lte", value: "2026-06-30" }] };
  const r = await queryRows(d.id, d.properties, { filter, extraFilter, limit: 1000 }); const ref = await queryRowsJs(d.id, d.properties, { filter: { and: [filter, extraFilter] }, limit: 1000 });
  assert.equal(r.engine, "sql"); assert.deepEqual(ids(r), ids(ref)); assert.ok(r.rows.every((x) => String(x.values[P.Date.id]).startsWith("2026-06") && x.values[P.Status.id] === "doing"));
});

test("D10: filters and sorts are validated — unknown property / operator, and + or in one group, bad sort → 400", async () => {
  const props = d.properties; const bad = (f: unknown) => { try { validateFilter(f, props); return "ok"; } catch (e: any) { return `${e.status}:${e.code}`; } };
  assert.equal(bad({ and: [{ property: P.Text.id, op: "contains", value: "a" }] }), "ok"); assert.equal(bad(null), "ok");
  assert.equal(bad({ and: [{ property: P.Text.id, op: "containz", value: "a" }] }), "400:bad_filter");
  assert.equal(bad({ and: [{ property: "00000000-0000-4000-8000-000000000000", op: "eq", value: "a" }] }), "400:bad_filter");
  assert.equal(bad({ and: [], or: [] }), "400:bad_filter"); assert.equal(bad({ and: [{ or: [{ and: [{ or: [{ and: [{ or: [] }] }] }] }] }] }), "400:bad_filter"); assert.equal(bad("x"), "400:bad_filter");
  assert.throws(() => validateSorts([{ property: P.Text.id, dir: "up" }], props), (e: any) => e.status === 400 && e.code === "bad_sort"); validateSorts([{ property: P.Text.id, dir: "asc" }], props);
  const view = d.views[0];
  assert.equal(await code(updateView(ws, d.id, view.id, { config: { filter: { and: [{ property: P.Text.id, op: "nope" as any }] } } })), "bad_filter");
  assert.equal(await code(createView(ws, d.id, { name: "bad", type: "table", config: { sorts: [{ property: "nope", dir: "asc" }] } })), "bad_sort");
  assert.equal(await code(updateView(ws, d.id, view.id, { config: { filter: { and: [{ property: P.Text.id, op: "contains", value: "a" }] } } })), "ok");
});

test("a deleted property leaves no dead rule, sort or setting in the saved views", async () => {
  const a = await createProperty(ws, other.id, { name: "A", type: "select", config: { options: [{ id: "o", name: "O", color: "gray" }] } }); const b = await createProperty(ws, other.id, { name: "B", type: "date" });
  const v = await createView(ws, other.id, { name: "v", type: "board", config: { groupBy: a.id, dateProperty: b.id, hidden: [a.id, b.id], order: [b.id, a.id], widths: { [a.id]: 200, [b.id]: 120 }, sorts: [{ property: a.id, dir: "asc" }, { property: b.id, dir: "desc" }], filter: { and: [{ property: a.id, op: "eq", value: "o" }, { or: [{ property: a.id, op: "empty" }] }, { property: b.id, op: "not_empty" }] } } });
  await deleteProperty(ws, other.id, a.id);
  const c = (await getDatabase(ws, other.id)).views.find((x) => x.id === v.id)!.config;
  assert.equal(c.groupBy, null); assert.equal(c.dateProperty, b.id); assert.deepEqual(c.hidden, [b.id]); assert.deepEqual(c.order, [b.id]); assert.deepEqual(c.widths, { [b.id]: 120 }); assert.deepEqual(c.sorts, [{ property: b.id, dir: "desc" }]);
  assert.deepEqual(c.filter, { and: [{ property: b.id, op: "not_empty" }] });
});
