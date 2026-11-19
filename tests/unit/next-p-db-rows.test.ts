/**
 * File: tests/unit/next-p-db-rows.test.ts
 * Description: Databases Next Generation — rollups (every aggregate, rollups over computed / relation targets: audit D9), formulas
 *   (per-cell errors, dependency cycles, regex guard: D24), row operations (move without full reorder: D7, duplicate, bulk edit / delete /
 *   duplicate with undo and redo, row templates), relation target validation (D20), two-way leftovers (D21), CSV (D4, D11).
 * Author: Simon-Pierre Boucher · contact@spboucher.ai
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db, schema } from "../../src/db/index";
import { workspace, mk, cleanup, code } from "../helpers/next";
import { ensureDatabase, createProperty, updateProperty, deleteProperty, createRow, updateRow, getDatabase, getRows, listRowsSimple } from "../../src/lib/databases/service";
import { queryRows, iterateRows } from "../../src/lib/databases/engine";
import { moveRow, duplicateRows, bulkRows, undoOp, listRowTemplates, createRowTemplate, updateRowTemplate, deleteRowTemplate, BULK_MAX } from "../../src/lib/databases/rows";
import { formulaRefs, formulaCycle, formulaSyntaxError, safeRegex, evaluate } from "../../src/lib/databases/formula";
import { exportCsv, exportCsvStream, importCsv } from "../../src/lib/databases/csv";
import { displayValue } from "../../src/lib/databases/values";
import { AGGREGATES } from "../../src/lib/databases/types";
import type { Property } from "../../src/lib/databases/types";

let ws: string; const PFX = "nx-pdb-rows ·";
before(async () => { ws = await workspace(); }); after(async () => { await cleanup(ws, PFX); });
const newDb = async (name: string) => { const p = await mk(ws, `${PFX} ${name}`, undefined, { type: "database", section: "databases" }); return ensureDatabase(ws, p.id); };
const one = async (dbId: string, rowId: string) => { const d = await getDatabase(ws, dbId); const raw = await ensureDatabase(ws, dbId); return (await getRows(raw, d.properties, [rowId]))[0]; };
const order = async (dbId: string) => { const d = await getDatabase(ws, dbId); return (await queryRows(d.id, d.properties, { limit: 1000 })).rows.map((r) => r.title.replace(`${PFX} `, "")); };

test("rollups: every aggregate over a relation, with real target values", async () => {
  const t = await newDb("roll target"); const pts = await createProperty(ws, t.id, { name: "Points", type: "number" }); const ok = await createProperty(ws, t.id, { name: "Ok", type: "checkbox" }); const day = await createProperty(ws, t.id, { name: "Day", type: "date" }); const tag = await createProperty(ws, t.id, { name: "Tag", type: "select", config: { options: [{ id: "r", name: "Red", color: "red" }, { id: "g", name: "Green", color: "green" }] } });
  const mkT = (n: string, v: Record<string, unknown>) => createRow(ws, t.id, { title: `${PFX} ${n}`, values: v });
  const a = await mkT("a", { [pts.id]: 10, [ok.id]: true, [day.id]: "2026-01-10", [tag.id]: "r" }); const b = await mkT("b", { [pts.id]: 30, [ok.id]: false, [day.id]: "2026-03-01", [tag.id]: "g" }); const c = await mkT("c", { [pts.id]: 20, [ok.id]: true, [tag.id]: "r" }); const e = await mkT("e", {});
  const s = await newDb("roll source"); const rel = await createProperty(ws, s.id, { name: "Items", type: "relation", config: { targetDatabaseId: t.id } });
  const R = async (aggregate: string, target: Property) => (await createProperty(ws, s.id, { name: `${aggregate}:${target.name}`, type: "rollup", config: { relationPropertyId: rel.id, targetPropertyId: target.id, aggregate: aggregate as any } })).id;
  const want: [string, Property, unknown][] = [["count", pts, 4], ["count_values", pts, 3], ["not_empty", pts, 3], ["empty", pts, 1], ["percent_empty", pts, 25], ["percent_not_empty", pts, 75], ["sum", pts, 60], ["avg", pts, 20], ["min", pts, 10], ["max", pts, 30], ["median", pts, 20], ["range", pts, 20], ["count_unique", tag, 2], ["unique", tag, ["Red", "Green"]], ["show", tag, ["Red", "Green", "Red"]], ["checked", ok, 2], ["unchecked", ok, 2], ["percent_checked", ok, 50], ["percent_unchecked", ok, 50], ["min", day, new Date("2026-01-10T00:00:00").toISOString()], ["max", day, new Date("2026-03-01T00:00:00").toISOString()], ["range", day, 50]];
  const idsOf: string[] = []; for (const [agg, tp] of want) idsOf.push(await R(agg, tp));
  assert.deepEqual([...new Set(want.map((w) => w[0]))].sort(), [...AGGREGATES].sort(), "every aggregate of the enum is exercised");
  const row = await createRow(ws, s.id, { title: `${PFX} src`, values: { [rel.id]: [a.id, b.id, c.id, e.id] } });
  // the order of the related rows is not defined when they were created in the same instant: lists are compared as multisets
  const norm = (x: unknown) => (Array.isArray(x) ? [...x].map(String).sort() : x);
  want.forEach(([agg, tp, v], i) => assert.deepEqual(norm(row.values[idsOf[i]]), norm(v), `${agg} of ${tp.name}`));
  const d = await getDatabase(ws, s.id); const pct = d.properties.find((p) => p.name === "percent_checked:Ok")!; assert.equal(displayValue(pct, 50), "50 %");
  const empty = await createRow(ws, s.id, { title: `${PFX} none` }); assert.equal(empty.values[idsOf[0]], 0); assert.equal(empty.values[idsOf[6]], null); assert.equal(empty.values[idsOf[4]], null);
  assert.equal(await code(createProperty(ws, s.id, { name: "bad", type: "rollup", config: { relationPropertyId: rel.id, targetPropertyId: pts.id, aggregate: "mode" as any } })), "bad_request");
});

test("D9: a rollup over a formula, a rollup or a relation of the target rows is computed (it was always empty)", async () => {
  const leaf = await newDb("d9 leaf"); const w = await createProperty(ws, leaf.id, { name: "W", type: "number" });
  const l1 = await createRow(ws, leaf.id, { title: `${PFX} leaf1`, values: { [w.id]: 2 } }); const l2 = await createRow(ws, leaf.id, { title: `${PFX} leaf2`, values: { [w.id]: 5 } });
  const mid = await newDb("d9 mid"); const n = await createProperty(ws, mid.id, { name: "N", type: "number" }); const dbl = await createProperty(ws, mid.id, { name: "Double", type: "formula", config: { expression: 'prop("N") * 2' } });
  const toLeaf = await createProperty(ws, mid.id, { name: "Leaves", type: "relation", config: { targetDatabaseId: leaf.id } }); const leafSum = await createProperty(ws, mid.id, { name: "LeafSum", type: "rollup", config: { relationPropertyId: toLeaf.id, targetPropertyId: w.id, aggregate: "sum" } });
  const bad = await createProperty(ws, mid.id, { name: "Bad", type: "formula", config: { expression: "1 / 0" } });
  const m1 = await createRow(ws, mid.id, { title: `${PFX} mid1`, values: { [n.id]: 3, [toLeaf.id]: [l1.id, l2.id] } }); const m2 = await createRow(ws, mid.id, { title: `${PFX} mid2`, values: { [n.id]: 4, [toLeaf.id]: [l2.id] } });
  const top = await newDb("d9 top"); const toMid = await createProperty(ws, top.id, { name: "Mids", type: "relation", config: { targetDatabaseId: mid.id } });
  const R = async (name: string, target: string, aggregate: string) => (await createProperty(ws, top.id, { name, type: "rollup", config: { relationPropertyId: toMid.id, targetPropertyId: target, aggregate: aggregate as any } })).id;
  const overFormula = await R("sum of formula", dbl.id, "sum"); const overRollup = await R("sum of rollup", leafSum.id, "sum"); const overRelation = await R("leaves shown", toLeaf.id, "show"); const overError = await R("error passes", bad.id, "sum"); const maxFormula = await R("max formula", dbl.id, "max");
  const row = await createRow(ws, top.id, { title: `${PFX} top`, values: { [toMid.id]: [m1.id, m2.id] } });
  assert.equal(row.values[overFormula], 14); assert.equal(row.values[maxFormula], 8); assert.equal(row.values[overRollup], 12);
  assert.deepEqual((row.values[overRelation] as string[]).map((v) => v.split(", ").sort().join(", ")).sort(), [`${PFX} leaf1, ${PFX} leaf2`, `${PFX} leaf2`]); // relation rows inserted in one statement share created_at: their order is not defined
  assert.match((row.values[overError] as { error: string }).error, /Bad: Division by zero/);
  // the same values through the engine (window hydration)
  const d = await getDatabase(ws, top.id); const q = await queryRows(d.id, d.properties, { limit: 10 }); assert.equal(q.rows[0].values[overFormula], 14);
});

test("formulas: errors are per cell, an error in a dependency is reported (not read as empty), cycles are named", async () => {
  const d = await newDb("formulas"); const n = await createProperty(ws, d.id, { name: "N", type: "number" });
  const half = await createProperty(ws, d.id, { name: "Half", type: "formula", config: { expression: '10 / prop("N")' } }); const uses = await createProperty(ws, d.id, { name: "Uses", type: "formula", config: { expression: 'prop("Half") + 1' } });
  const syntax = await createProperty(ws, d.id, { name: "Syntax", type: "formula", config: { expression: "1 +" } }); const unknown = await createProperty(ws, d.id, { name: "Unknown", type: "formula", config: { expression: 'prop("Nope")' } });
  const good = await createRow(ws, d.id, { title: `${PFX} f good`, values: { [n.id]: 4 } }); const zero = await createRow(ws, d.id, { title: `${PFX} f zero`, values: { [n.id]: 0 } });
  assert.equal(good.values[half.id], 2.5); assert.equal(good.values[uses.id], 3.5);
  assert.deepEqual(zero.values[half.id], { error: "Division by zero" }); assert.deepEqual(zero.values[uses.id], { error: 'Error in "Half": Division by zero' });
  assert.match((good.values[syntax.id] as any).error, /Unexpected end/); assert.match((good.values[unknown.id] as any).error, /Unknown property "Nope"/);
  assert.equal(formulaSyntaxError("1 +") !== null, true); assert.equal(formulaSyntaxError('prop("N") * 2'), null);
  assert.deepEqual(formulaRefs('if(prop("A") > B, prop("C"), concat(D, "x"))').sort(), ["A", "B", "C", "D"]);
  // cycle refused when saved, with its path — on create and on update
  const a = await createProperty(ws, d.id, { name: "A", type: "formula", config: { expression: 'prop("N") + 1' } }); const b = await createProperty(ws, d.id, { name: "B", type: "formula", config: { expression: 'prop("A") * 2' } });
  let err: any; try { await updateProperty(ws, d.id, a.id, { config: { expression: 'prop("B") + 1' } }); } catch (e) { err = e; }
  assert.equal(err?.status, 400); assert.equal(err?.code, "formula_cycle"); assert.deepEqual(err?.extra?.cycle, ["A", "B", "A"]); assert.match(err.message, /A → B → A/);
  assert.equal(await code(createProperty(ws, d.id, { name: "Self", type: "formula", config: { expression: 'prop("Self") + 1' } })), "formula_cycle");
  assert.equal(await code(updateProperty(ws, d.id, a.id, { config: { expression: 'prop("N") + 2' } })), "ok");
  assert.deepEqual(formulaCycle([{ name: "A", type: "formula", config: { expression: "B" } }, { name: "B", type: "formula", config: { expression: "C" } }], "C", 'prop("A")'), ["C", "A", "B", "C"]);
  assert.equal(formulaCycle([{ name: "A", type: "formula", config: { expression: "B" } }, { name: "B", type: "number", config: {} }], "C", "A + B"), null);
  // a cycle that is already stored (2.x data, or closed by a rename) shows the path on every cell of the cycle and on the cells that read it
  await db.update(schema.databaseProperties).set({ config: { expression: 'prop("B") + 1' } }).where(eq(schema.databaseProperties.id, a.id));
  const reads = await createProperty(ws, d.id, { name: "Reads", type: "formula", config: { expression: 'prop("A")' } });
  const row = await one(d.id, good.id);
  for (const k of [a.id, b.id, reads.id]) assert.match((row.values[k] as any).error, /^Circular reference: (A → B → A|B → A → B)$/);
  assert.equal(row.values[half.id], 2.5, "the other formulas of the row still compute");
});

test("D24: test(s, regex) refuses patterns that can freeze the server", () => {
  assert.equal(evaluate('test("abc", "^a.c$")', { prop: () => null }), true);
  for (const bad of ["(a+)+$", "(a*)*b", "(x{1,5})+y", "a".repeat(301)]) assert.match((evaluate(`test("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa!", "${bad}")`, { prop: () => null }) as any).error, /refused|too long/);
  assert.match((evaluate('test("a", "(")', { prop: () => null }) as any).error, /Invalid regular expression/); assert.ok(safeRegex("^[a-z]+$").test("abc"));
});

test("D7: moving a row writes that row only and never collides with rows that were not sent", async () => {
  const d = await newDb("move"); const rows = []; for (const n of ["r1", "r2", "r3", "r4", "r5"]) rows.push(await createRow(ws, d.id, { title: `${PFX} ${n}` }));
  const before = await db.select({ id: schema.databaseRows.id, position: schema.databaseRows.position }).from(schema.databaseRows).where(eq(schema.databaseRows.databaseId, d.id));
  await moveRow(ws, d.id, rows[4].id, { after: rows[0].id }); assert.deepEqual(await order(d.id), ["r1", "r5", "r2", "r3", "r4"]);
  const after1 = await db.select({ id: schema.databaseRows.id, position: schema.databaseRows.position }).from(schema.databaseRows).where(eq(schema.databaseRows.databaseId, d.id));
  assert.equal(after1.filter((x) => before.find((y) => y.id === x.id)!.position !== x.position).length, 1, "one row written");
  await moveRow(ws, d.id, rows[2].id, { before: rows[0].id }); assert.deepEqual(await order(d.id), ["r3", "r1", "r5", "r2", "r4"]);
  await moveRow(ws, d.id, rows[0].id, { after: rows[3].id }); assert.deepEqual(await order(d.id), ["r3", "r5", "r2", "r4", "r1"]);
  // equal positions (what the 2.x partial reorder left behind): the move still lands where asked
  await db.update(schema.databaseRows).set({ position: 1 }).where(eq(schema.databaseRows.databaseId, d.id));
  const tied = await order(d.id); const [x, y] = [rows.find((r) => r.title.endsWith(tied[0]))!, rows.find((r) => r.title.endsWith(tied[3]))!];
  await moveRow(ws, d.id, y.id, { after: x.id }); const o = await order(d.id); assert.equal(o[1], tied[3]); assert.equal(o[0], tied[0]); assert.equal(new Set(o).size, 5);
  for (let i = 0; i < 70; i++) await moveRow(ws, d.id, rows[i % 2 ? 1 : 4].id, { after: x.id }); // precision exhaustion triggers a renormalisation, not a wrong place
  assert.equal((await order(d.id))[1], "r2");
  assert.equal(await code(moveRow(ws, d.id, x.id, { after: x.id })), "bad_request"); assert.equal(await code(moveRow(ws, d.id, x.id, {})), "bad_request"); assert.equal(await code(moveRow(ws, d.id, x.id, { after: "00000000-0000-4000-8000-000000000000" })), "not_found");
});

test("duplicate: values, relations, body and icon are copied; the copy sits right after its source", async () => {
  const t = await newDb("dup target"); const tr = await createRow(ws, t.id, { title: `${PFX} linked` });
  const d = await newDb("dup"); const n = await createProperty(ws, d.id, { name: "N", type: "number" }); const rel = await createProperty(ws, d.id, { name: "Rel", type: "relation", config: { targetDatabaseId: t.id } }); const ai = await createProperty(ws, d.id, { name: "Ai", type: "ai", config: { prompt: "x" } });
  const body = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "body of the source" }] }] };
  const a = await createRow(ws, d.id, { title: `${PFX} a`, icon: "🧩", content: body, values: { [n.id]: 7, [rel.id]: [tr.id], [ai.id]: "kept text" } }); await createRow(ws, d.id, { title: `${PFX} b` });
  await db.update(schema.databaseRows).set({ values: { ...(await one(d.id, a.id)).values, [ai.id]: { pending: true, at: "x" } } as any }).where(eq(schema.databaseRows.id, a.id));
  const [copy] = await duplicateRows(ws, d.id, [a.id]);
  assert.equal(copy.title, `${PFX} a (copy)`); assert.equal(copy.values[n.id], 7); assert.equal((copy.values[rel.id] as any[])[0].rowId, tr.id); assert.equal(copy.icon, "🧩"); assert.equal(copy.values[ai.id], undefined, "a pending AI marker is not copied");
  const [page] = await db.select({ plainText: schema.pages.plainText }).from(schema.pages).where(eq(schema.pages.id, copy.pageId)); assert.match(page.plainText, /body of the source/);
  assert.deepEqual(await order(d.id), ["a", "a (copy)", "b"]); assert.notEqual(copy.pageId, a.pageId);
  assert.deepEqual(await duplicateRows(ws, d.id, ["00000000-0000-4000-8000-000000000000"]), []);
});

test("bulk edit / delete / duplicate with undo and redo, on ids and on every row of a query", async () => {
  const d = await newDb("bulk"); const st = await createProperty(ws, d.id, { name: "Status", type: "status" }); const n = await createProperty(ws, d.id, { name: "N", type: "number" }); const f = await createProperty(ws, d.id, { name: "F", type: "formula", config: { expression: "1" } });
  const rows = []; for (let i = 0; i < 12; i++) rows.push(await createRow(ws, d.id, { title: `${PFX} k${String(i).padStart(2, "0")}`, values: { [st.id]: i % 3 === 0 ? "todo" : "doing", ...(i % 4 ? { [n.id]: i } : {}) } }));
  const full = await getDatabase(ws, d.id); const snap = async () => Object.fromEntries((await queryRows(d.id, full.properties, { limit: 1000 })).rows.map((r) => [r.title.slice(-3), [r.values[st.id], r.values[n.id] ?? null]]));
  const s0 = await snap();
  // edit by ids: set one value, clear another
  const ids = rows.slice(0, 5).map((r) => r.id); const up = await bulkRows(ws, d.id, { ids }, { type: "update", values: { [st.id]: "done", [n.id]: null } });
  assert.equal(up.affected, 5); assert.ok(up.opId); const s1 = await snap(); assert.deepEqual(s1.k00, ["done", null]); assert.deepEqual(s1.k03, ["done", null]); assert.deepEqual(s1.k05, s0.k05);
  await undoOp(ws, d.id, up.opId!); assert.deepEqual(await snap(), s0, "undo restores each row's own previous values");
  assert.equal(await code(undoOp(ws, d.id, up.opId!)), "conflict"); await undoOp(ws, d.id, up.opId!, true); assert.deepEqual(await snap(), s1, "redo"); assert.equal(await code(undoOp(ws, d.id, up.opId!, true)), "conflict"); await undoOp(ws, d.id, up.opId!);
  // edit every row of a query, minus exceptions
  const all = await bulkRows(ws, d.id, { all: { filter: { and: [{ property: st.id, op: "eq", value: "doing" }] }, except: [rows[1].id] } }, { type: "update", values: { Status: "done" } });
  assert.equal(all.affected, 7); const s2 = await snap(); assert.equal(s2.k01[0], "doing"); assert.equal(s2.k02[0], "done"); assert.equal(s2.k00[0], "todo"); await undoOp(ws, d.id, all.opId!); assert.deepEqual(await snap(), s0);
  assert.equal(await code(bulkRows(ws, d.id, { ids }, { type: "update", values: { [f.id]: 2 } })), "bad_request"); assert.equal(await code(bulkRows(ws, d.id, { ids }, { type: "update", values: { nope: 1 } })), "bad_request"); assert.equal(await code(bulkRows(ws, d.id, { ids }, { type: "update", values: {} })), "bad_request");
  assert.equal((await bulkRows(ws, d.id, { ids: ["00000000-0000-4000-8000-000000000000"] }, { type: "delete" })).affected, 0);
  // delete + undo + redo
  const del = await bulkRows(ws, d.id, { ids: ids.slice(0, 3) }, { type: "delete" }); assert.equal(del.affected, 3); assert.equal((await queryRows(d.id, full.properties, { limit: 0 })).total, 9);
  const [pg] = await db.select({ deletedAt: schema.pages.deletedAt }).from(schema.pages).where(eq(schema.pages.id, rows[0].pageId)); assert.ok(pg.deletedAt, "the row page went to the trash too");
  await undoOp(ws, d.id, del.opId!); assert.equal((await queryRows(d.id, full.properties, { limit: 0 })).total, 12); assert.deepEqual(await snap(), s0);
  await undoOp(ws, d.id, del.opId!, true); assert.equal((await queryRows(d.id, full.properties, { limit: 0 })).total, 9); await undoOp(ws, d.id, del.opId!);
  // duplicate + undo
  const dup = await bulkRows(ws, d.id, { ids: [rows[0].id, rows[1].id] }, { type: "duplicate" }); assert.equal(dup.rows!.length, 2); assert.equal((await queryRows(d.id, full.properties, { limit: 0 })).total, 14);
  await undoOp(ws, d.id, dup.opId!); assert.equal((await queryRows(d.id, full.properties, { limit: 0 })).total, 12); await undoOp(ws, d.id, dup.opId!, true); assert.equal((await queryRows(d.id, full.properties, { limit: 0 })).total, 14); await undoOp(ws, d.id, dup.opId!);
  assert.equal(await code(undoOp(ws, d.id, "00000000-0000-4000-8000-000000000000")), "not_found"); assert.equal(BULK_MAX.delete, 5000);
});

test("bulk delete of more than 100 rows uses the batch path and its undo brings back exactly those pages", async () => {
  const d = await newDb("bulk batch"); const made: { id: string; pageId: string }[] = [];
  const pagesIn = Array.from({ length: 130 }, (_, i) => ({ workspaceId: ws, parentId: d.pageId, databaseId: d.id, section: "databases", type: "page", title: `${PFX} batch ${i}`, position: i + 1 }));
  const ps = await db.insert(schema.pages).values(pagesIn).returning({ id: schema.pages.id }); const rs = await db.insert(schema.databaseRows).values(ps.map((p, i) => ({ databaseId: d.id, pageId: p.id, values: {}, position: i + 1 }))).returning({ id: schema.databaseRows.id, pageId: schema.databaseRows.pageId }); made.push(...rs);
  const child = await mk(ws, `${PFX} sub-page of a row`, undefined, { parentId: made[0].pageId });
  const full = await getDatabase(ws, d.id); const del = await bulkRows(ws, d.id, { all: {} }, { type: "delete" }); assert.equal(del.affected, 130);
  assert.equal((await queryRows(d.id, full.properties, { limit: 0 })).total, 0);
  const trashed = async (id: string) => !!(await db.select({ deletedAt: schema.pages.deletedAt }).from(schema.pages).where(eq(schema.pages.id, id)))[0].deletedAt;
  assert.equal(await trashed(made[77].pageId), true); assert.equal(await trashed(child.id), true, "sub-pages follow"); assert.equal(await trashed(d.pageId), false);
  await undoOp(ws, d.id, del.opId!); assert.equal((await queryRows(d.id, full.properties, { limit: 0 })).total, 130); assert.equal(await trashed(child.id), false);
});

test("row templates: capture a row, create from a template (explicit values win), default flag, update, delete", async () => {
  const d = await newDb("templates"); const st = await createProperty(ws, d.id, { name: "Status", type: "status" }); const n = await createProperty(ws, d.id, { name: "N", type: "number" }); const f = await createProperty(ws, d.id, { name: "F", type: "formula", config: { expression: 'prop("N") + 1' } });
  const body = { type: "doc", content: [{ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Agenda" }] }, { type: "paragraph", content: [{ type: "text", text: "template body" }] }] };
  const src = await createRow(ws, d.id, { title: `${PFX} model`, icon: "📌", content: body, values: { [st.id]: "doing", [n.id]: 5 } });
  const t = await createRowTemplate(ws, d.id, { name: "Meeting", fromRowId: src.id, isDefault: true });
  assert.deepEqual(t.values, { [st.id]: "doing", [n.id]: 5 }, "title and computed values are not captured"); assert.equal(t.icon, "📌"); assert.equal(t.isDefault, true);
  const made = await createRow(ws, d.id, { title: `${PFX} from template`, templateId: t.id, values: { [n.id]: 9 } });
  assert.equal(made.values[st.id], "doing"); assert.equal(made.values[n.id], 9); assert.equal(made.values[f.id], 10); assert.equal(made.icon, "📌");
  const [pg] = await db.select({ plainText: schema.pages.plainText }).from(schema.pages).where(eq(schema.pages.id, made.pageId)); assert.match(pg.plainText, /Agenda[\s\S]*template body/);
  const t2 = await createRowTemplate(ws, d.id, { name: "Blank-ish", values: { Status: "done", [f.id]: 3, nope: 1 }, isDefault: true }); assert.deepEqual(t2.values, { [st.id]: "done" });
  const list = await listRowTemplates(ws, d.id); assert.deepEqual(list.map((x) => [x.name, x.isDefault]), [["Meeting", false], ["Blank-ish", true]]);
  assert.equal((await updateRowTemplate(ws, d.id, t.id, { name: "Weekly", isDefault: true, values: { [n.id]: 1 } })).name, "Weekly"); assert.deepEqual((await listRowTemplates(ws, d.id)).map((x) => x.isDefault), [true, false]);
  assert.equal(await code(createRow(ws, d.id, { templateId: "00000000-0000-4000-8000-000000000000" })), "not_found");
  const other = await newDb("templates other"); assert.equal(await code(createRow(ws, other.id, { templateId: t.id })), "not_found", "a template belongs to its database");
  await deleteRowTemplate(ws, d.id, t2.id); assert.equal((await listRowTemplates(ws, d.id)).length, 1); assert.equal(await deleteRowTemplate(ws, d.id, t2.id), false, "idempotent: nothing left to delete");
  const again = await createRowTemplate(ws, d.id, { id: t.id, name: "ignored" }); assert.equal(again.name, "Weekly", "idempotent on a client id");
});

test("D20 / D21: relation targets must be rows of the target database; deleting the reverse side leaves a plain one-way relation", async () => {
  const a = await newDb("rel a"); const b = await newDb("rel b"); const c = await newDb("rel c");
  const rel = await createProperty(ws, a.id, { name: "To B", type: "relation", config: { targetDatabaseId: b.id, twoWay: true } });
  const br = await createRow(ws, b.id, { title: `${PFX} in b` }); const cr = await createRow(ws, c.id, { title: `${PFX} in c` });
  const row = await createRow(ws, a.id, { title: `${PFX} in a`, values: { [rel.id]: [br.id, cr.id] } });
  assert.deepEqual((row.values[rel.id] as any[]).map((x) => x.rowId), [br.id], "the row of another database is not linked");
  const up = await updateRow(ws, a.id, row.id, { [rel.id]: [cr.id] }); assert.deepEqual(up.values[rel.id], []);
  const reverse = (await getDatabase(ws, b.id)).properties.find((p) => p.config.syncedPropertyId === rel.id)!; assert.ok(reverse);
  await deleteProperty(ws, b.id, reverse.id);
  const fwd = (await getDatabase(ws, a.id)).properties.find((p) => p.id === rel.id)!; assert.equal(fwd.config.twoWay, undefined); assert.equal(fwd.config.targetDatabaseId, b.id);
  assert.equal((await listRowsSimple(ws, b.id, "in b", 1)).length, 1); assert.equal((await listRowsSimple(ws, b.id, undefined, 500)).length, 1);
});

test("CSV: D4 (no header → 400) and D11 (the stream exports every row, byte-identical to the one-shot export)", async () => {
  const d = await newDb("csv"); const n = await createProperty(ws, d.id, { name: "N", type: "number" });
  assert.equal(await code(importCsv(ws, d.id, "")), "bad_csv"); assert.equal(await code(importCsv(ws, d.id, "\n\n")), "bad_csv");
  const pagesIn = Array.from({ length: 2300 }, (_, i) => ({ workspaceId: ws, parentId: d.pageId, databaseId: d.id, section: "databases", type: "page", title: `${PFX} csv "quoted", ${i}`, position: i + 1 }));
  const ps = await db.insert(schema.pages).values(pagesIn).returning({ id: schema.pages.id }); await db.insert(schema.databaseRows).values(ps.map((p, i) => ({ databaseId: d.id, pageId: p.id, values: { [n.id]: i }, position: i + 1 })));
  const full = await getDatabase(ws, d.id); const all: any[] = []; for await (const page of iterateRows(d.id, full.properties, {}, 1000)) all.push(...page); assert.equal(all.length, 2300);
  const bytes = async (st: ReadableStream<Uint8Array>) => Buffer.from(await new Response(st).arrayBuffer()).toString("utf8"); // Response.text() would drop the BOM
  const text = await bytes(exportCsvStream(full.properties, iterateRows(d.id, full.properties, {}, 1000)));
  assert.equal(text, exportCsv(full.properties, all)); assert.equal(text.split("\r\n").length, 2301, "header + 2 300 rows (the 2.x export stopped at 1 000)"); assert.ok(text.startsWith("﻿Name,N\r\n"));
  const empty = await newDb("csv empty"); const e = await getDatabase(ws, empty.id); assert.equal(await bytes(exportCsvStream(e.properties, iterateRows(e.id, e.properties, {}))), exportCsv(e.properties, [])); assert.equal(exportCsv(e.properties, []), "\uFEFFName");
  const imp = await importCsv(ws, empty.id, `Name,Extra\n${PFX} imp 1,x\n${PFX} imp 2,y\n`); assert.deepEqual(imp, { created: 2, properties: ["Extra"] });
});
