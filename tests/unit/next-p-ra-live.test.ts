/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : tests/unit/next-p-ra-live.test.ts
 * Module           : tests
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

/**
 * Living blocks, client side (SPEC §4.7): the reader of `POST /api/query` is pinned against REAL answers of the server function
 * (`runQuery`, JSON round-tripped exactly as the route sends it) for the five sources, plus the strictness of the reader, the request
 * bodies, the device snapshot store and the "last refreshed" label. Runs against a *_dev database.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { workspace, mk, doc, made, cleanup } from "../helpers/next";
import { runQuery } from "../../src/lib/knowledge/query";
import { createTask } from "../../src/lib/tasks/service";
import { createReference } from "../../src/lib/research/references";
import { ensureDatabase, createProperty, createRow } from "../../src/lib/databases/service";
import { normaliseQueryResult, QueryShapeError, queryBody, chartQueryBody, tableColumns, groupByStatus, sameTable, refreshedLabel, queryKeyOf, saveQuerySnapshot, loadQuerySnapshot, cellDisplay } from "../../src/lib/editor/query";
import { chartModel, defaultChartConfig } from "../../src/lib/editor/chart";

let ws: string; const PFX = "nx-pra-live ·";
before(async () => { ws = await workspace(); }); after(async () => { await cleanup(ws, PFX); });
const wire = <T>(v: T): unknown => JSON.parse(JSON.stringify(v));
const memory = () => { const m = new Map<string, string>(); return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); } }; };

test("contract: the reader accepts the real answer of every source and derives the display model from it", async () => {
  const p = await mk(ws, `${PFX} page`, doc("corps de la page"), { section: "documents" });
  const linker = await mk(ws, `${PFX} linker`, { type: "doc", content: [{ type: "paragraph", content: [{ type: "mention", attrs: { id: p.id, label: `${PFX} page` } }] }] });
  const t1 = await createTask(ws, { title: `${PFX} t1`, pageId: p.id, blockId: "blk1", dueAt: "2020-01-02", priority: "high" }); const t2 = await createTask(ws, { title: `${PFX} t2 done`, pageId: p.id, status: "done" }); made.tasks.push(t1.task.id, t2.task.id);
  const ref = await createReference(ws, { title: `${PFX} A paper`, authors: ["Jane Doe", "John Roe"], year: 2021, journal: "J. Tests", entryType: "article", pageId: p.id } as any); made.references.push(ref.id);

  // tasks
  const raw = wire(await runQuery(ws, { source: "tasks", filter: { parentId: p.id, status: "all" } })) as any;
  assert.deepEqual(Object.keys(raw), ["source", "columns", "rows", "total", "limit", "table", "resolvedAt"], "§4.7 top-level keys");
  assert.deepEqual(Object.keys(raw.columns[0]), ["key", "label", "type"]);
  const tasks = normaliseQueryResult(raw, "tasks");
  assert.equal(tasks.total, 2); assert.equal(tasks.limit, 25); assert.equal(tasks.resolvedAt, raw.resolvedAt); assert.deepEqual(tasks.columns.map((c) => c.key), ["title", "status", "priority", "dueAt", "pageTitle", "project"]);
  const a = tasks.rows.find((r) => r.key === t1.task.id)!, b = tasks.rows.find((r) => r.key === t2.task.id)!;
  assert.deepEqual([a.title, a.status, a.done, a.href, a.subtitle, a.cells.priority], [`${PFX} t1`, "todo", false, `/p/${p.id}#block-blk1`, `${PFX} page`, "high"]);
  assert.match(a.due ?? "", /^2020-01-02T/); assert.deepEqual([b.status, b.done, b.due], ["done", true, null]);
  assert.deepEqual(groupByStatus(tasks.rows).map((g) => g.status).sort(), ["done", "todo"]);
  assert.deepEqual(tableColumns(tasks).map((c) => c.key), ["status", "priority", "dueAt", "pageTitle", "project"], "the title column is not repeated in the table layout");
  assert.deepEqual(tasks.table.columns, raw.table.columns); assert.deepEqual(tasks.table.rows, raw.table.rows);

  // pages
  const pages = normaliseQueryResult(wire(await runQuery(ws, { source: "pages", filter: { text: `${PFX} page` } })), "pages");
  const pr = pages.rows.find((r) => r.key === p.id)!; assert.deepEqual([pr.title, pr.href, pr.status, pr.done, pr.due], [`${PFX} page`, `/p/${p.id}`, null, false, null]); assert.equal(pr.cells.section, "documents");

  // references
  const refs = normaliseQueryResult(wire(await runQuery(ws, { source: "references", filter: { text: `${PFX} A paper` } })), "references");
  const rr = refs.rows.find((r) => r.key === ref.id)!; assert.equal(rr.title, `${PFX} A paper`); assert.equal(rr.subtitle, "Jane Doe, John Roe · 2021 · J. Tests"); assert.equal(rr.cells.authors, "Jane Doe, John Roe"); assert.equal(rr.cells.year, "2021"); assert.equal(rr.href, `/p/${p.id}`);

  // backlinks
  const back = normaliseQueryResult(wire(await runQuery(ws, { source: "backlinks", pageId: p.id })), "backlinks");
  assert.deepEqual(back.rows.map((r) => [r.key, r.href]), [[linker.id, `/p/${linker.id}`]]);

  // database → also what a chart with `source` plots
  const host = await mk(ws, `${PFX} db`, undefined, { type: "database", section: "databases" }); const d = await ensureDatabase(ws, host.id);
  const num = await createProperty(ws, d.id, { name: "Score", type: "number" }); const st = await createProperty(ws, d.id, { name: "Status", type: "select", config: { options: [{ id: "o1", name: "Read", color: "green" }] } }); const chk = await createProperty(ws, d.id, { name: "Seen", type: "checkbox" });
  const r1 = await createRow(ws, d.id, { title: `${PFX} row A`, values: { [num.id]: 21, [st.id]: "o1", [chk.id]: true } }); const r2 = await createRow(ws, d.id, { title: `${PFX} row B`, values: { [num.id]: 4 } }); made.pages.push(r1.pageId, r2.pageId);
  const body = chartQueryBody({ databaseId: host.id }); assert.deepEqual(body, { source: "database", databaseId: host.id, filter: {}, limit: 500 });
  const dbRaw = wire(await runQuery(ws, body as any)) as any; assert.equal(dbRaw.name, d.name); assert.equal(dbRaw.databaseId, d.id);
  const dbr = normaliseQueryResult(dbRaw, "database"); assert.equal(dbr.name, d.name); assert.deepEqual(dbr.columns.map((c) => [c.label, c.type]), [["Name", "page"], ["Score", "number"], ["Status", "select"], ["Seen", "checkbox"]]);
  const ra = dbr.rows.find((r) => r.key === r1.id)!; assert.deepEqual([ra.title, ra.status, ra.href, ra.cells[num.id], ra.cells[chk.id]], [`${PFX} row A`, "Read", `/p/${r1.pageId}`, "21", "Yes"]);
  assert.deepEqual(tableColumns(dbr).map((c) => c.label), ["Score", "Status", "Seen"]);
  assert.deepEqual(dbr.table.columns, ["Name", "Score", "Status", "Seen"]); assert.deepEqual(dbr.table.rows.find((r) => r[0] === `${PFX} row A`)?.slice(0, 3), [`${PFX} row A`, 21, "Read"]);
  // the flattened table is directly plottable: the chart model draws one bar per row from the live data
  const cfg = defaultChartConfig(dbr.table.columns, dbr.table.rows); assert.equal(cfg.x, "Name"); assert.ok(cfg.y.includes("Score"));
  const model = chartModel({ kind: "bar", title: "", columns: dbr.table.columns, rows: dbr.table.rows, x: cfg.x, y: ["Score"] }, { width: 600, height: 300 }); assert.deepEqual(model.problems, []); assert.equal(model.rects.length, 2);
});

test("contract: anything that is not the §4.7 shape is an error, never an empty view", () => {
  const ok = { source: "tasks", columns: [{ key: "title", label: "Tâche", type: "text" }], rows: [{ id: "x", pageId: null, title: "T" }], total: 1, limit: 25, table: { columns: ["Tâche"], rows: [["T"]] }, resolvedAt: "2026-11-19T18:30:22.355Z" };
  assert.equal(normaliseQueryResult(ok, "tasks").rows.length, 1);
  for (const bad of [null, [], [{ id: "a", title: "x" }], { rows: [] }, { ...ok, columns: ["Tâche"] }, { ...ok, columns: [{ name: "Tâche" }] }, { ...ok, rows: [{ title: "no id" }] }, { ...ok, table: undefined }, { ...ok, table: { columns: ["a"], rows: [{}] } }, { items: [{ id: "a" }] }])
    assert.throws(() => normaliseQueryResult(bad, "tasks"), QueryShapeError, JSON.stringify(bad));
  // an unknown column type is displayed as text; unknown extra keys are ignored
  assert.equal(normaliseQueryResult({ ...ok, columns: [{ key: "title", label: "T", type: "future" }], extra: 1 }, "tasks").columns[0].type, "text");
  assert.equal(cellDisplay(["a", "b"], "tags"), "a, b"); assert.equal(cellDisplay(false, "checkbox"), "No"); assert.equal(cellDisplay({ title: "Linked" }, "json"), "Linked"); assert.equal(cellDisplay(null, "number"), "");
});

test("request bodies, snapshot comparison and the refreshed label", () => {
  assert.deepEqual(queryBody({ source: "tasks", databaseId: null, viewId: null, filter: { status: "open", tag: " " }, limit: 999 }), { source: "tasks", filter: { status: "open" }, limit: 200 });
  assert.deepEqual(chartQueryBody({ databaseId: "d", viewId: "v" }), { source: "database", databaseId: "d", viewId: "v", filter: {}, limit: 500 });
  assert.equal(sameTable({ columns: ["a"], rows: [[1], [null]] }, { columns: ["a"], rows: [[1], [null]] }), true);
  assert.equal(sameTable({ columns: ["a"], rows: [[1]] }, { columns: ["a"], rows: [["1"]] }), false); assert.equal(sameTable({ columns: ["a"], rows: [[1]] }, { columns: ["b"], rows: [[1]] }), false); assert.equal(sameTable({ columns: ["a"], rows: [] }, { columns: ["a"], rows: [[1]] }), false);
  const now = new Date("2026-11-19T18:00:00Z");
  assert.equal(refreshedLabel("2026-11-19T17:59:40Z", now), "just now"); assert.equal(refreshedLabel("2026-11-19T17:48:00Z", now), "12 min ago"); assert.equal(refreshedLabel(null, now), ""); assert.equal(refreshedLabel("nope", now), "");
  assert.match(refreshedLabel("2026-11-17T10:00:00Z", now), /17/, "another day shows the date");
});

test("device snapshot: last answer per request, key independent of key order, bounded, never throws", () => {
  const s = memory(); const answer = { source: "tasks", columns: [{ key: "title", label: "Tâche", type: "text" }], rows: [{ id: "x", pageId: null, title: "Kept" }], total: 1, limit: 25, table: { columns: ["Tâche"], rows: [["Kept"]] }, resolvedAt: "2026-11-19T18:30:22.355Z" };
  assert.equal(queryKeyOf({ source: "tasks", filter: { a: 1, b: 2 }, limit: 5 }), queryKeyOf({ limit: 5, filter: { b: 2, a: 1 }, source: "tasks" })); assert.notEqual(queryKeyOf({ source: "tasks" }), queryKeyOf({ source: "pages" }));
  assert.equal(loadQuerySnapshot(s, { source: "tasks" }, "tasks"), null);
  assert.equal(saveQuerySnapshot(s, { source: "tasks" }, answer), true);
  const back = loadQuerySnapshot(s, { source: "tasks" }, "tasks")!; assert.equal(back.rows[0].title, "Kept"); assert.equal(back.resolvedAt, "2026-11-19T18:30:22.355Z", "the snapshot keeps the time the server resolved it");
  for (let i = 0; i < 45; i++) saveQuerySnapshot(s, { source: "pages", limit: i + 1 }, answer);
  assert.equal([...s.m.keys()].filter((k) => k !== "spn.query.index").length, 40, "oldest snapshots are dropped"); assert.equal(loadQuerySnapshot(s, { source: "tasks" }, "tasks"), null);
  assert.equal(saveQuerySnapshot(s, { source: "big" }, { blob: "x".repeat(210_000) }), false, "oversized answers are not kept");
  s.m.set("spn.query." + queryKeyOf({ source: "broken" }), "{not json"); assert.equal(loadQuerySnapshot(s, { source: "broken" }, "tasks"), null);
  const full = { getItem: () => null, setItem: () => { throw new Error("QuotaExceededError"); }, removeItem: () => {} }; assert.equal(saveQuerySnapshot(full, { source: "tasks" }, answer), false);
  assert.equal(saveQuerySnapshot(null, {}, answer), false); assert.equal(loadQuerySnapshot(undefined, {}, "tasks"), null);
});
