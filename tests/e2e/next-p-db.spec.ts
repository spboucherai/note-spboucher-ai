/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : tests/e2e/next-p-db.spec.ts
 * Description      : SP Note Next Generation, Databases Next Generation
 *                    (desktop Chromium, scratch database only) — the 20 000-row
 *                    database (virtualised grid, windowed loading, server-side
 *                    counts; scroll frame times and HTTP query times are
 *                    MEASURED and written to the metrics file), filters / sorts
 *                    in SQL, grouping with collapsed groups and aggregates,
 *                    keyboard navigation and inline editing, selection and bulk
 *                    actions, undo / redo, per-view columns, the visual filter
 *                    builder, calendar and timeline drags, gallery options, row
 *                    templates, rollups and formulas in the property editor,
 *                    CSV, smart (AI) properties with the fake model.
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

import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { apiCall, sql, expectNoHorizontalOverflow, removeBench } from "./helpers";

const DATA = process.env.DATA_DIR ? path.dirname(process.env.DATA_DIR) : "test-results"; const SHOTS = process.env.E2E_SHOTS ?? path.join(DATA, "shots"); const METRICS = path.join(SHOTS, "..", "db-metrics.json");
const made: string[] = []; const stamp = Date.now().toString(36);
type Bench = { pageId: string; databaseId: string; rows: number; views: Record<string, string>; properties: Record<string, string> };
let bench: Bench;
const metrics: Record<string, unknown> = fs.existsSync(METRICS) ? JSON.parse(fs.readFileSync(METRICS, "utf8")) : {};
const saveMetrics = (k: string, v: unknown) => { metrics[k] = v; metrics.at = new Date().toISOString(); fs.mkdirSync(path.dirname(METRICS), { recursive: true }); fs.writeFileSync(METRICS, JSON.stringify(metrics, null, 2)); };
const shot = async (page: Page, name: string) => { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, `${name}.png`) }); };
const stat = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const q = (f: number) => s[Math.min(s.length - 1, Math.floor(f * s.length))]; const r = (n: number) => Math.round(n * 10) / 10; return { n: s.length, median: r(q(0.5)), p95: r(q(0.95)), p99: r(q(0.99)), max: r(s[s.length - 1]) }; };

test.beforeAll(() => {
  // the 20 000-row database is seeded once (one connection); later runs reuse it
  const out = execFileSync("node", ["node_modules/tsx/dist/cli.mjs", "scripts/db-seed-bench.ts", "20000"], { encoding: "utf8", env: process.env, stdio: ["ignore", "pipe", "pipe"] });
  bench = JSON.parse(out.trim().split("\n").pop()!); expect(bench.rows).toBe(20000);
});
test.afterAll(async () => {
  await removeBench(bench); // see helpers.ts
  if (made.length) { await sql`delete from pages where database_id in (select id from databases where page_id = any(${made}::uuid[]))`; await sql`delete from pages where id = any(${made}::uuid[])`; } });

type Mk = { pageId: string; id: string; props: Record<string, string>; rows: { id: string; title: string }[]; views: Record<string, string> };
/** A small database through the API: properties, rows, extra views. */
async function mkDb(page: Page, name: string, props: { name: string; type: string; config?: unknown }[], rows: { title: string; values?: Record<string, unknown> }[], views: { name: string; type: string; config?: (p: Record<string, string>) => unknown }[] = []): Promise<Mk> {
  const c = await apiCall(page, "POST", "/api/pages", { title: `E2E-pdb ${name} ${stamp}`, type: "database", section: "databases" }); expect(c.status).toBe(201); made.push(c.body.id);
  const d = await apiCall(page, "GET", `/api/databases/${c.body.id}`); const P: Record<string, string> = { Name: d.body.properties[0].id };
  for (const p of props) { const r = await apiCall(page, "POST", `/api/databases/${d.body.id}/properties`, p); expect(r.status, JSON.stringify(r.body)).toBe(201); P[p.name] = r.body.id; }
  const out: { id: string; title: string }[] = [];
  for (let i = 0; i < rows.length; i += 100) { const r = await apiCall(page, "POST", `/api/databases/${d.body.id}/rows`, { rows: rows.slice(i, i + 100).map((x) => ({ title: x.title, values: Object.fromEntries(Object.entries(x.values ?? {}).map(([k, v]) => [P[k] ?? k, v])) })) }); expect(r.status, JSON.stringify(r.body)).toBe(201); out.push(...r.body.map((x: any) => ({ id: x.id, title: x.title }))); }
  const V: Record<string, string> = { Table: d.body.views[0].id };
  for (const v of views) { const r = await apiCall(page, "POST", `/api/databases/${d.body.id}/views`, { name: v.name, type: v.type, config: v.config?.(P) ?? {} }); expect(r.status, JSON.stringify(r.body)).toBe(201); V[v.name] = r.body.id; }
  return { pageId: c.body.id, id: d.body.id, props: P, rows: out, views: V };
}
const openDb = async (page: Page, pageId: string, view?: string) => { await page.goto(`/p/${pageId}`); await expect(page.getByRole("tablist", { name: "Views" })).toBeVisible(); if (view) { const tab = page.getByRole("tab", { name: view, exact: true }); if ((await tab.getAttribute("aria-selected")) !== "true") await tab.click(); await expect(tab).toHaveAttribute("aria-selected", "true"); } };
const grid = (page: Page) => page.locator(".db-scroll"); const count = (page: Page) => page.getByTestId("row-count");
const cell = (page: Page, rowId: string, propId: string) => page.locator(`[data-row="${rowId}"] [data-prop="${propId}"]`);
/** A database error must fail the assertion with its message (expect.poll would otherwise retry it silently until the timeout). */
const q = async <T>(fn: () => Promise<T>): Promise<T> => { try { return await fn(); } catch (e: any) { return { __dbError: String(e?.message ?? e) } as unknown as T; } };
const values = async (rowId: string) => q(async () => ((await sql`select r.values as v from database_rows r where r.id = ${rowId}`)[0]?.v ?? { __missing: rowId }) as Record<string, unknown>);
const viewConfig = async (viewId: string) => q(async () => ((await sql`select config from database_views where id = ${viewId}`)[0]?.config ?? { __missing: viewId }) as Record<string, any>);
/** Focus a grid cell without opening its editor. */
const focusCell = async (page: Page, rowId: string, propId: string) => { await cell(page, rowId, propId).evaluate((el: HTMLElement) => el.focus()); await expect(cell(page, rowId, propId)).toBeFocused(); };
const mod = process.platform === "darwin" ? "Meta" : "Control";

test("20 000 rows: the grid is virtualised, loads by windows, and the scroll frame times are measured", async ({ page }) => {
  await page.goto("/"); const reqs: number[] = []; page.on("request", (r) => { if (r.url().endsWith(`/api/databases/${bench.databaseId}/query`) && r.method() === "POST") reqs.push(JSON.parse(r.postData() ?? "{}").offset ?? 0); });
  const t0 = Date.now(); await openDb(page, bench.pageId, "All rows"); await expect(count(page)).toHaveText("20,000 rows"); await expect(page.locator("[data-row]").first()).toBeVisible(); const firstPaint = Date.now() - t0;
  const dom = await page.locator("[data-row]").count(); expect(dom, "only the rows on screen (+ overscan) are in the DOM").toBeLessThan(80); expect(reqs, "one window of 100 rows, not the whole database").toEqual([0]);
  expect(await grid(page).evaluate((el) => el.scrollHeight)).toBeGreaterThan(20000 * 36);
  await shot(page, "table-20k-top");
  // measured: frame-to-frame time while scrolling (requestAnimationFrame deltas), three patterns
  const run = (pxPerFrame: number, frames: number) => page.evaluate(async ({ pxPerFrame, frames }) => {
    const el = document.querySelector<HTMLElement>(".db-scroll")!; el.scrollTop = 0; await new Promise((r) => setTimeout(r, 400)); const deltas: number[] = []; let maxRows = 0;
    await new Promise<void>((done) => { let last = performance.now(); let n = 0; const step = (now: number) => { deltas.push(now - last); last = now; el.scrollTop += pxPerFrame; maxRows = Math.max(maxRows, document.querySelectorAll("[data-row]").length); if (++n < frames) requestAnimationFrame(step); else done(); }; requestAnimationFrame(step); });
    return { deltas: deltas.slice(1), maxRows, reached: Math.round(el.scrollTop / 36) };
  }, { pxPerFrame, frames });
  const out: Record<string, unknown> = {};
  for (const [name, px, frames] of [["wheel-like (36 px / frame ≈ 60 rows / s)", 36, 300], ["fast (360 px / frame ≈ 600 rows / s)", 360, 300], ["scrollbar sweep (3 600 px / frame, whole 20 000 rows in ≈ 3.3 s)", 3600, 200]] as const) {
    const r = await run(px, frames); const s = stat(r.deltas); out[name] = { ...s, over16_7ms: r.deltas.filter((d) => d > 17.5).length, over33ms: r.deltas.filter((d) => d > 33.4).length, over50ms: r.deltas.filter((d) => d > 50).length, maxRowsInDom: r.maxRows, reachedRow: r.reached };
    expect(r.maxRows, `${name}: DOM stays bounded`).toBeLessThan(90); expect(s.p95, `${name}: p95 frame time (ms)`).toBeLessThan(50);
  }
  saveMetrics("scroll", { viewport: "1280×800, headless Chromium (Playwright), production build", rows: 20000, firstRowsVisibleMs: firstPaint, rowsInDomAtRest: dom, patterns: out });
  // the very last row is reachable (the 2.x UI stopped at 500)
  await grid(page).evaluate((el) => { el.scrollTop = el.scrollHeight; }); await expect(page.locator('[data-index="19999"]')).toBeVisible(); await expect(page.locator('[data-index="19999"]')).toContainText("20000");
  expect(Math.max(...reqs), "the last window was fetched by offset").toBe(19900); expect(new Set(reqs).size, "the sweeps crossed all 200 windows; only those where the scroll slowed down were fetched").toBeLessThan(120); metrics.windowsFetched = new Set(reqs).size;
  await shot(page, "table-20k-bottom");
});

test("20 000 rows: HTTP query times (first window, filtered, sorted, grouped, search) are measured; filtered + sorted view matches SQL", async ({ page }) => {
  await page.goto("/"); const P = bench.properties; const q = `/api/databases/${bench.databaseId}/query`;
  const time = async (body: unknown) => { const ms: number[] = []; let last: any; for (let i = 0; i < 9; i++) { const t = performance.now(); last = await apiCall(page, "POST", q, body); ms.push(performance.now() - t); expect(last.status).toBe(200); } return { ...stat(ms.slice(1)), total: last.body.total, engine: last.body.engine }; };
  const out: Record<string, unknown> = {
    "first window (100 rows, default order)": await time({ viewId: bench.views["All rows"], limit: 100, aggregates: true }),
    "filtered (Status = doing AND Estimate > 100), sorted by Due desc": await time({ viewId: bench.views["Doing, big, by due date"], limit: 100 }),
    "sorted by Cost desc": await time({ viewId: bench.views["Sorted by cost"], limit: 100 }),
    "grouped by Status (window + counts + sums)": await time({ viewId: bench.views["Grouped by status"], limit: 100, groupBy: P.Status }),
    "deep window (offset 19 900)": await time({ viewId: bench.views["All rows"], limit: 100, offset: 19900 }),
    "search “zephyr 12” (database has a formula → JavaScript path)": await time({ viewId: bench.views["All rows"], limit: 100, search: "zephyr 12" }),
    "sorted by a formula (JavaScript path)": await time({ viewId: bench.views["Sorted by formula (JS path)"], limit: 100 }),
  };
  saveMetrics("http", { note: "POST /api/databases/<id>/query through the running server (auth, JSON), 8 timed calls after 1 warm-up, measured from the test process on the same host", rows: 20000, scenarios: out });
  for (const [k, v] of Object.entries(out) as [string, any][]) if (!k.includes("JavaScript")) { expect(v.engine, k).toBe("sql"); expect(v.median, `${k}: median ms`).toBeLessThan(400); }
  // the filtered + sorted view in the UI = the same rows as SQL says
  const [{ n }] = await sql`select count(*)::int as n from database_rows r join pages p on p.id = r.page_id where r.database_id = ${bench.databaseId} and r.deleted_at is null and r.values->>${P.Status} = 'doing' and (r.values->>${P.Estimate})::numeric > 100`;
  await openDb(page, bench.pageId, "Doing, big, by due date"); await expect(count(page)).toHaveText(`${n.toLocaleString("en-CA")} rows`);
  const top = await sql`select r.id from database_rows r join pages p on p.id = r.page_id where r.database_id = ${bench.databaseId} and r.values->>${P.Status} = 'doing' and (r.values->>${P.Estimate})::numeric > 100 order by r.values->>${P.Due} desc nulls last, r.position limit 5`;
  await expect.poll(async () => page.locator("[data-row]").evaluateAll((els) => els.slice(0, 5).map((e) => e.getAttribute("data-row")))).toEqual(top.map((r) => r.id));
  // sort on a formula: still correct, flagged as computed
  await page.getByRole("tab", { name: "Sorted by formula (JS path)" }).click(); await expect(page.getByText("computed", { exact: true })).toBeVisible(); await expect(count(page)).toHaveText("20,000 rows");
});

test("grouping: whole-database counts and sums per group, collapsed groups persist with the view (table, board, list)", async ({ page }) => {
  await page.goto("/"); const P = bench.properties;
  const sums = await sql`select r.values->>${P.Status} as k, count(*)::int as n, sum((r.values->>${P.Estimate})::numeric)::float as est from database_rows r join pages p on p.id = r.page_id where r.database_id = ${bench.databaseId} and r.deleted_at is null group by 1`;
  const by = Object.fromEntries(sums.map((s) => [s.k, s])); expect(by.todo.n + by.doing.n + by.done.n).toBe(20000);
  await sql`update database_views set config = config - 'collapsed' where id = any(${[bench.views["Grouped by status"], bench.views.Board, bench.views.List]}::uuid[])`;
  await openDb(page, bench.pageId, "Grouped by status");
  // the groups of 20 000 rows are far apart in a virtual grid: "Collapse all" puts every group, its count and its sums on one screen
  await expect(page.locator('[data-group-count="todo"]')).toHaveText(by.todo.n.toLocaleString("en-CA")); await expect(page.locator('[data-group-count="done"]'), "the last group is 16 000 rows further down: not in the DOM").toHaveCount(0);
  await page.getByRole("button", { name: "Group", exact: true }).click(); await page.getByRole("button", { name: "Collapse all" }).click(); await page.keyboard.press("Escape");
  for (const k of ["todo", "doing", "done"]) await expect(page.locator(`[data-group-count="${k}"]`)).toHaveText(by[k].n.toLocaleString("en-CA")); // counts of 20 000 rows, none of them loaded
  await expect(page.locator('[data-group-agg="todo"]')).toContainText(`Estimate Σ ${by.todo.est}`); await expect(page.locator("[data-row]")).toHaveCount(0);
  await expect.poll(async () => (await viewConfig(bench.views["Grouped by status"])).collapsed).toEqual(["todo", "doing", "done", "__none"]); await shot(page, "table-grouped-collapsed");
  // expand the 2nd group only: its first row is row n(todo) of the view order, fetched as its own window
  await page.getByRole("button", { name: "Expand group In progress" }).click(); await expect(page.locator("[data-row]").first()).toHaveAttribute("data-index", String(by.todo.n));
  await page.reload(); await expect(page.getByRole("button", { name: "Expand group Not started" })).toBeVisible(); await expect(page.getByRole("button", { name: "Collapse group In progress" })).toBeVisible(); await expect(page.locator("[data-row]").first()).toHaveAttribute("data-index", String(by.todo.n));
  await page.getByRole("button", { name: "Group", exact: true }).click(); await page.getByRole("button", { name: "Expand all" }).click(); await page.keyboard.press("Escape"); await expect.poll(async () => (await viewConfig(bench.views["Grouped by status"])).collapsed).toEqual([]);
  // board: column counts are the whole database; collapsing a column persists; more cards load on demand
  await page.getByRole("tab", { name: "Board", exact: true }).click();
  for (const k of ["todo", "doing", "done"]) await expect(page.locator(`[data-group-count="${k}"]`)).toHaveText(by[k].n.toLocaleString("en-CA"));
  const col = page.getByRole("region", { name: /^In progress, / }); await expect(col.getByRole("button", { name: /^Open / })).toHaveCount(30);
  await col.getByRole("button", { name: /^Load more/ }).click(); await expect(col.getByRole("button", { name: /^Open / })).toHaveCount(80);
  await page.getByRole("button", { name: "Collapse column Done" }).click(); await expect(page.getByRole("button", { name: "Expand column Done" })).toBeVisible();
  await expect.poll(async () => (await viewConfig(bench.views.Board)).collapsed).toEqual(["done"]); await shot(page, "board-20k");
  await page.getByRole("button", { name: "Expand column Done" }).click();
  // list grouped by priority: counts + "Load more"
  await page.getByRole("tab", { name: "List", exact: true }).click(); const pr = await sql`select coalesce(r.values->>${P.Priority}, '__none') as k, count(*)::int as n from database_rows r where r.database_id = ${bench.databaseId} and r.deleted_at is null group by 1`;
  for (const g of pr) await expect(page.locator(`[data-group-count="${g.k}"]`)).toHaveText(g.n.toLocaleString("en-CA"));
  await expect(page.getByTestId("load-more")).toContainText("19,900 more rows");
});

test("keyboard: arrows, Enter, Tab / Shift+Tab, type-to-edit, Escape, Delete; a bad number is refused (U1); Enter on the Open button opens the row (U5); undo / redo", async ({ page }) => {
  await page.goto("/");
  const d = await mkDb(page, "keys", [{ name: "Notes", type: "text" }, { name: "Qty", type: "number" }, { name: "Done", type: "checkbox" }], [{ title: "kb one", values: { Notes: "first", Qty: 5 } }, { title: "kb two", values: { Notes: "second", Qty: 7 } }, { title: "kb three" }]);
  const [r1, r2, r3] = d.rows; const { Name, Notes, Qty, Done } = d.props; await openDb(page, d.pageId); await expect(count(page)).toHaveText("3 rows");
  await focusCell(page, r1.id, Notes);
  await page.keyboard.press("ArrowDown"); await expect(cell(page, r2.id, Notes)).toBeFocused(); await page.keyboard.press("ArrowRight"); await expect(cell(page, r2.id, Qty)).toBeFocused();
  await page.keyboard.press("ArrowUp"); await expect(cell(page, r1.id, Qty)).toBeFocused(); await page.keyboard.press("ArrowLeft"); await expect(cell(page, r1.id, Notes)).toBeFocused();
  await page.keyboard.press("Tab"); await expect(cell(page, r1.id, Qty)).toBeFocused(); await page.keyboard.press("Shift+Tab"); await expect(cell(page, r1.id, Notes)).toBeFocused();
  await page.keyboard.press("End"); await expect(cell(page, r1.id, Done)).toBeFocused(); await page.keyboard.press("Tab"); await expect(cell(page, r2.id, Name), "Tab wraps to the next row").toBeFocused(); await page.keyboard.press("Home");
  // Enter edits, Enter commits and moves down
  await focusCell(page, r1.id, Notes); await page.keyboard.press("Enter"); const input = cell(page, r1.id, Notes).locator("input"); await expect(input).toBeFocused(); await expect(input).toHaveValue("first");
  await page.keyboard.type(" edited"); await page.keyboard.press("Enter"); await expect(cell(page, r2.id, Notes)).toBeFocused(); await expect.poll(async () => (await values(r1.id))[Notes]).toBe(" edited"); // the value was selected: typing replaces it
  // type-to-edit: the typed characters replace the value, every keystroke lands in the editor; Tab commits and moves right
  await page.keyboard.type("Hello world"); await expect(cell(page, r2.id, Notes).locator("input")).toHaveValue("Hello world"); await page.keyboard.press("Tab"); await expect(cell(page, r2.id, Qty)).toBeFocused(); await expect.poll(async () => (await values(r2.id))[Notes]).toBe("Hello world");
  // Escape cancels and keeps the cell focused
  await page.keyboard.type("999"); await page.keyboard.press("Escape"); await expect(cell(page, r2.id, Qty)).toBeFocused(); await page.waitForTimeout(300); expect((await values(r2.id))[Qty]).toBe(7);
  // U1: a non-number is refused and the stored value is kept
  await page.keyboard.press("Enter"); await page.keyboard.type("abc"); await page.keyboard.press("Enter"); await expect(page.getByText("Not a number")).toBeVisible(); await page.waitForTimeout(300); expect((await values(r2.id))[Qty]).toBe(7); await expect(cell(page, r2.id, Qty)).toContainText("7");
  // number typed, checkbox toggled with Space, Delete clears
  await focusCell(page, r3.id, Qty); await page.keyboard.type("42"); await page.keyboard.press("Enter"); await expect.poll(async () => (await values(r3.id))[Qty]).toBe(42);
  await focusCell(page, r3.id, Done); await page.keyboard.press("Space"); await expect.poll(async () => (await values(r3.id))[Done]).toBe(true);
  await focusCell(page, r1.id, Qty); await page.keyboard.press("Delete"); await expect.poll(async () => (await values(r1.id))[Qty]).toBeUndefined();
  // undo / redo with the keyboard: Delete, Space, 42 come back in reverse order
  await page.keyboard.press(`${mod}+z`); await expect.poll(async () => (await values(r1.id))[Qty]).toBe(5); await expect(page.getByText("Undone: edit Qty")).toBeVisible();
  await page.keyboard.press(`${mod}+z`); await expect.poll(async () => (await values(r3.id))[Done] ?? false).toBe(false);
  await page.keyboard.press(`${mod}+Shift+z`); await expect.poll(async () => (await values(r3.id))[Done]).toBe(true);
  await page.keyboard.press(`${mod}+z`); await page.keyboard.press(`${mod}+z`); await expect.poll(async () => (await values(r3.id))[Qty]).toBeUndefined();
  await page.getByRole("button", { name: /^Redo/ }).click(); await expect.poll(async () => (await values(r3.id))[Qty]).toBe(42);
  // U5: Enter on the "Open" button inside the title cell opens the row instead of starting an edit
  await cell(page, r1.id, Name).hover(); const open = cell(page, r1.id, Name).getByRole("button", { name: "Open kb one" }); await open.focus(); await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog").getByLabel("Title")).toHaveValue("kb one"); await page.keyboard.press("Escape");
  await shot(page, "table-keyboard");
});

test("selection and bulk actions: select-all on every row of the view, shift-range, edit a property, move to group, duplicate, delete — each undoable", async ({ page }) => {
  await page.goto("/");
  const rows = Array.from({ length: 230 }, (_, i) => ({ title: `bulk ${String(i + 1).padStart(3, "0")}`, values: { Status: i % 2 ? "doing" : "todo", Qty: i } }));
  const d = await mkDb(page, "bulk", [{ name: "Status", type: "status" }, { name: "Qty", type: "number" }], rows, [{ name: "Grouped", type: "table", config: (p) => ({ groupBy: p.Status }) }]);
  const S = d.props.Status; const n = async (status: string) => (await sql`select count(*)::int as n from database_rows where database_id = ${d.id} and deleted_at is null and database_rows.values->>${S} = ${status}`)[0].n; const live = async () => (await sql`select count(*)::int as n from database_rows where database_id = ${d.id} and deleted_at is null`)[0].n;
  await openDb(page, d.pageId); await expect(count(page)).toHaveText("230 rows");
  // shift-range: rows 3 → 12
  await page.locator('[data-index="2"]').getByRole("checkbox").click(); await page.locator('[data-index="11"]').getByRole("checkbox").click({ modifiers: ["Shift"] });
  const bar = page.getByRole("toolbar", { name: "Selected rows" }); await expect(bar.getByRole("status")).toHaveText("10 selected");
  // select all 230 (only 100 are loaded): the action applies to every row of the view
  await page.getByRole("checkbox", { name: "Select all 230 rows" }).check(); await expect(bar.getByRole("status")).toHaveText("230 selected");
  await page.locator('[data-index="0"]').getByRole("checkbox").click(); await expect(bar.getByRole("status")).toHaveText("229 selected"); // all but one
  await bar.getByRole("button", { name: "Edit property" }).click(); const pop = page.getByRole("dialog"); await pop.getByLabel("Property to edit").selectOption({ label: "Status" });
  await pop.getByTestId("bulk-value").getByRole("button").first().click(); await page.getByRole("dialog").last().getByText("Done", { exact: true }).click();
  await page.getByRole("button", { name: "Apply to 229" }).click(); await expect(page.getByText("Edit Status: 229 rows")).toBeVisible();
  expect(await n("done")).toBe(229); expect(await n("todo")).toBe(1); await expect(bar).toHaveCount(0);
  await page.keyboard.press(`${mod}+z`); await expect.poll(() => n("done")).toBe(0); expect(await n("todo")).toBe(115); expect(await n("doing")).toBe(115);
  await page.keyboard.press(`${mod}+Shift+z`); await expect.poll(() => n("done")).toBe(229); await page.keyboard.press(`${mod}+z`); await expect.poll(() => n("done")).toBe(0);
  // duplicate two rows, undo from the toast
  await page.locator('[data-index="0"]').getByRole("checkbox").click(); await page.locator('[data-index="1"]').getByRole("checkbox").click();
  await bar.getByRole("button", { name: "Duplicate" }).click(); await expect(count(page)).toHaveText("232 rows"); await expect(page.locator('[data-index="1"]')).toContainText("bulk 001 (copy)");
  await page.getByRole("button", { name: "Undo", exact: true }).first().click(); await expect(count(page)).toHaveText("230 rows");
  // delete 3 rows, then undo with the keyboard
  for (const i of [4, 5, 6]) await page.locator(`[data-index="${i}"]`).getByRole("checkbox").click();
  page.once("dialog", (dlg) => dlg.accept()); await bar.getByRole("button", { name: "Delete" }).click(); await expect(count(page)).toHaveText("227 rows"); expect(await live()).toBe(227);
  await page.keyboard.press(`${mod}+z`); await expect(count(page)).toHaveText("230 rows"); expect(await live()).toBe(230);
  // grouped view: move the selection to another group
  await page.getByRole("tab", { name: "Grouped", exact: true }).click(); await expect(page.locator('[data-group-count="todo"]')).toHaveText("115");
  await page.locator("[data-row]").nth(0).getByRole("checkbox").click(); await page.locator("[data-row]").nth(1).getByRole("checkbox").click();
  await bar.getByRole("button", { name: "Move to group" }).click(); await page.getByRole("dialog").getByRole("button", { name: "Done" }).click();
  await expect(page.locator('[data-group-count="todo"]')).toHaveText("113"); expect(await n("done")).toBe(2);
  await page.keyboard.press(`${mod}+z`); await expect(page.locator('[data-group-count="todo"]')).toHaveText("115"); await shot(page, "table-bulk");
});

test("columns: width, order and visibility are saved per view; another view keeps its own", async ({ page }) => {
  await page.goto("/");
  const d = await mkDb(page, "cols", [{ name: "Alpha", type: "text" }, { name: "Beta", type: "number" }, { name: "Gamma", type: "checkbox" }], [{ title: "c1", values: { Alpha: "a", Beta: 1 } }], [{ name: "Second", type: "table" }]);
  await openDb(page, d.pageId); const heads = () => page.locator(".db-scroll thead th[data-col]").evaluateAll((els) => els.map((e) => e.textContent?.trim()));
  await expect.poll(heads).toEqual(["Name", "Alpha", "Beta", "Gamma"]);
  // resize Alpha by dragging its edge
  const sep = page.getByRole("separator", { name: "Resize Alpha" }); const b = (await sep.boundingBox())!; await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down(); await page.mouse.move(b.x + 90, b.y + b.height / 2, { steps: 4 }); await page.mouse.up();
  await expect.poll(async () => (await viewConfig(d.views.Table)).widths?.[d.props.Alpha]).toBeGreaterThan(240);
  // reorder: Gamma two steps to the left (button path), then Beta dragged after Alpha is not needed — check the drag path too
  await page.getByRole("button", { name: "Edit property Gamma" }).click(); await page.getByRole("button", { name: "Move left" }).click(); await expect.poll(heads).toEqual(["Name", "Alpha", "Gamma", "Beta"]);
  await page.keyboard.press("Escape"); await page.locator(`th[data-col="${d.props.Beta}"]`).dragTo(page.locator(`th[data-col="${d.props.Alpha}"]`)); await expect.poll(heads).toEqual(["Name", "Beta", "Alpha", "Gamma"]);
  await expect.poll(async () => (await viewConfig(d.views.Table)).order).toEqual([d.props.Beta, d.props.Alpha, d.props.Gamma]);
  // hide Gamma
  await page.getByRole("button", { name: "Edit property Gamma" }).click(); await page.getByRole("button", { name: "Hide" }).click(); await expect.poll(heads).toEqual(["Name", "Beta", "Alpha"]);
  await page.reload(); await expect.poll(heads).toEqual(["Name", "Beta", "Alpha"]);
  expect(await page.locator(`th[data-col="${d.props.Alpha}"]`).evaluate((el) => el.getBoundingClientRect().width)).toBeGreaterThan(240);
  await page.getByRole("tab", { name: "Second", exact: true }).click(); await expect.poll(heads).toEqual(["Name", "Alpha", "Beta", "Gamma"]);
  // column footer: sum of Beta, saved with the view
  await page.getByLabel("Footer of Beta").selectOption("sum"); await expect(page.locator(`[data-footer="${d.props.Beta}"]`)).toHaveText("1"); await expect.poll(async () => (await viewConfig(d.views.Second)).footers?.[d.props.Beta]).toBe("sum");
});

test("filter builder: AND / OR groups, debounced text (U4), incomplete rules are not applied, the API refuses an invalid rule (D10); U7 layout change keeps the config", async ({ page }) => {
  await page.goto("/");
  const rows = [["apple pie", "todo", 5], ["apple tart", "doing", 50], ["banana split", "done", 500], ["cherry cake", "todo", 70], ["cherry pie", "doing", 9]].map(([t, s, q]) => ({ title: String(t), values: { Status: s, Qty: q } }));
  const d = await mkDb(page, "filters", [{ name: "Status", type: "status" }, { name: "Qty", type: "number" }], rows);
  await openDb(page, d.pageId); await expect(count(page)).toHaveText("5 rows");
  const patches: string[] = []; page.on("request", (r) => { if (r.method() === "PATCH" && r.url().includes(`/api/databases/${d.id}/views`)) patches.push(r.postData() ?? ""); });
  await page.getByRole("button", { name: "Filter" }).click(); const fb = page.getByTestId("filter-builder");
  await fb.getByRole("button", { name: "Add filter" }).click(); await expect(fb.locator("[data-rule-problem]")).toHaveText("Enter a value"); await expect(fb.getByText("1 incomplete rule is not applied yet.")).toBeVisible();
  await page.waitForTimeout(700); expect(patches.length, "an incomplete rule is not saved").toBe(0); await expect(count(page)).toHaveText("5 rows");
  await fb.getByLabel("Value").pressSequentially("pie", { delay: 40 }); await expect(count(page)).toHaveText("2 rows"); await page.waitForTimeout(600);
  expect(patches.length, "typing 3 characters saves once, not 3 times").toBe(1); expect(JSON.parse(patches[0]).config.filter).toEqual({ and: [{ property: d.props.Name, op: "contains", value: "pie" }] });
  // OR group: (Status is Done) or (Qty > 60)
  await fb.getByRole("button", { name: "Add group" }).click(); const g = fb.locator('[data-depth="1"]'); await expect(g).toHaveAttribute("aria-label", "Group of rules combined with or");
  await g.getByRole("button", { name: "Add filter" }).click(); await g.getByLabel("Property to filter").selectOption({ label: "Status" }); await g.getByLabel("Value").selectOption({ label: "Done" });
  await g.getByRole("button", { name: "Add filter" }).click(); await g.getByLabel("Property to filter").nth(1).selectOption({ label: "Qty" }); await g.getByLabel("Condition").nth(1).selectOption("gt"); await g.getByLabel("Value").nth(1).fill("x"); await expect(g.locator("[data-rule-problem]")).toHaveText("Not a number"); await g.getByLabel("Value").nth(1).fill("60");
  // name contains "pie" AND (done OR qty > 60) → nothing; switch the root to OR → pie rows + banana + cherry cake
  await expect(count(page)).toHaveText("0 rows"); await fb.getByLabel("Combine filters with").first().selectOption("or"); await expect(count(page)).toHaveText("4 rows");
  await expect.poll(async () => (await viewConfig(d.views.Table)).filter).toEqual({ or: [{ property: d.props.Name, op: "contains", value: "pie" }, { or: [{ property: d.props.Status, op: "eq", value: "done" }, { property: d.props.Qty, op: "gt", value: "60" }] }] });
  await shot(page, "filter-builder"); await page.keyboard.press("Escape"); await expect(page.getByRole("button", { name: "Filters, 3 active" })).toBeVisible();
  // D10 at the API
  const bad = await apiCall(page, "POST", `/api/databases/${d.id}/query`, { filter: { and: [{ property: d.props.Name, op: "containz", value: "x" }] } }); expect(bad.status).toBe(400); expect(bad.body.code).toBe("bad_filter");
  expect((await apiCall(page, "PATCH", `/api/databases/${d.id}/views`, { id: d.views.Table, config: { filter: { and: [], or: [] } } })).status).toBe(400);
  expect((await apiCall(page, "POST", `/api/databases/${d.id}/query`, { sorts: [{ property: "nope", dir: "asc" }] })).body.code).toBe("bad_sort");
  // U7: changing the layout keeps the view's filter and settings; board gets a default group only because none was set
  await page.getByRole("button", { name: /^Settings of the view/ }).click(); await page.getByRole("dialog").getByRole("combobox").first().selectOption("board");
  await expect.poll(async () => { const c = await viewConfig(d.views.Table); return [c.groupBy, (c.filter?.or ?? []).length]; }).toEqual([d.props.Status, 2]);
});

test("calendar: drag a row to another day (undo), “+N more” opens the day (U6), rows without a date are listed", async ({ page }) => {
  await page.goto("/"); const today = new Date(); const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const day = (n: number) => iso(new Date(today.getFullYear(), today.getMonth(), n));
  const rows = [...Array.from({ length: 7 }, (_, i) => ({ title: `crowd ${i + 1}`, values: { When: day(10) } })), { title: "mover", values: { When: day(12) } }, ...Array.from({ length: 8 }, (_, i) => ({ title: `floating ${i + 1}` }))];
  const d = await mkDb(page, "calendar", [{ name: "When", type: "date" }], rows, [{ name: "Cal", type: "calendar", config: (p) => ({ dateProperty: p.When }) }]);
  const mover = d.rows.find((r) => r.title === "mover")!; await openDb(page, d.pageId, "Cal");
  const cellOf = (k: string) => page.locator(`[data-day="${k}"]`); await expect(cellOf(day(12)).locator(`[data-chip="${mover.id}"]`)).toBeVisible();
  // U6: the overflow of the 10th opens the full list
  await cellOf(day(10)).getByRole("button", { name: /^3 more rows on/ }).click(); const list = page.getByRole("dialog"); await expect(list.locator("[data-chip]")).toHaveCount(7); await shot(page, "calendar-more");
  await list.locator("[data-chip]").last().click(); await expect(page.getByRole("dialog").getByLabel("Title")).toHaveValue("crowd 7"); await page.keyboard.press("Escape");
  // drag "mover" from the 12th to the 15th
  await cellOf(day(12)).locator(`[data-chip="${mover.id}"]`).dragTo(cellOf(day(15))); await expect(cellOf(day(15)).locator(`[data-chip="${mover.id}"]`)).toBeVisible();
  await expect.poll(async () => (await values(mover.id))[d.props.When]).toBe(day(15)); await expect(page.getByText(/^Moved to /)).toBeVisible();
  await page.getByRole("button", { name: "Undo", exact: true }).first().click(); await expect.poll(async () => (await values(mover.id))[d.props.When]).toBe(day(12)); await expect(cellOf(day(12)).locator(`[data-chip="${mover.id}"]`)).toBeVisible();
  // undated rows: count of the whole database, full list one click away, and a row can be dragged onto a day
  await expect(page.getByTestId("undated")).toContainText("8 rows without a date"); await page.getByTestId("undated").getByRole("button", { name: "Show all 8" }).click(); await expect(page.getByRole("dialog").getByRole("button")).toHaveCount(8); await page.keyboard.press("Escape");
  const f1 = d.rows.find((r) => r.title === "floating 1")!; await page.getByTestId("undated").getByRole("button", { name: "floating 1", exact: true }).dragTo(cellOf(day(20)));
  await expect.poll(async () => (await values(f1.id))[d.props.When]).toBe(day(20)); await expect(page.getByTestId("undated")).toContainText("7 rows without a date"); await shot(page, "calendar-drag");
});

test("timeline: drag a bar to move it, drag its end to stretch it, Alt+Arrow moves it by a day — each undoable", async ({ page }) => {
  await page.goto("/"); const d0 = new Date(); const iso = (n: number) => { const d = new Date(d0.getFullYear(), d0.getMonth(), d0.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
  const d = await mkDb(page, "timeline", [{ name: "Start", type: "date" }, { name: "End", type: "date" }], [{ title: "task A", values: { Start: iso(1), End: iso(3) } }, { title: "task B", values: { Start: iso(5), End: iso(6) } }, { title: "no dates" }], [{ name: "TL", type: "timeline", config: (p) => ({ startProperty: p.Start, endProperty: p.End, scale: "week" }) }]);
  const a = d.rows[0]; const { Start, End } = d.props; const dates = async () => { const v = await values(a.id); return "__dbError" in v ? JSON.stringify(v) : `${v?.[Start]} → ${v?.[End]}`; }; await openDb(page, d.pageId, "TL"); const bar = page.locator(`[data-bar="${a.id}"]`); await expect(bar).toHaveAttribute("data-start", iso(1));
  const drag = async (loc: ReturnType<Page["locator"]>, dx: number) => { const b = (await loc.boundingBox())!; await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down(); await page.mouse.move(b.x + b.width / 2 + dx / 2, b.y + b.height / 2, { steps: 3 }); await page.mouse.move(b.x + b.width / 2 + dx, b.y + b.height / 2, { steps: 3 }); await page.mouse.up(); };
  await drag(bar, 28 * 4); // week scale: 28 px per day → 4 days later
  await expect.poll(async () => dates()).toBe(`${iso(5)} → ${iso(7)}`); await expect(bar).toHaveAttribute("data-start", iso(5)); await expect(page.getByText("Moved 4 days later")).toBeVisible();
  await expect(page.getByRole("dialog"), "a drag does not open the row").toHaveCount(0);
  await page.keyboard.press(`${mod}+z`); await expect.poll(async () => (await values(a.id))[Start]).toBe(iso(1));
  // stretch the end by 2 days
  await drag(bar.locator("xpath=following-sibling::span[@data-handle='end']"), 28 * 2); await expect.poll(async () => dates()).toBe(`${iso(1)} → ${iso(5)}`);
  // keyboard: Alt+ArrowRight = one day later
  await bar.focus(); await page.keyboard.press("Alt+ArrowRight"); await expect.poll(async () => dates()).toBe(`${iso(2)} → ${iso(6)}`);
  await bar.click(); await expect(page.getByRole("dialog").getByLabel("Title")).toHaveValue("task A"); await page.keyboard.press("Escape"); // a plain click still opens the row
  await expect(page.getByTestId("undated")).toContainText("1 row without a start date"); await shot(page, "timeline-drag");
  // 20 000 rows: the timeline of the benchmark database shows its filtered rows and says how many
  await openDb(page, bench.pageId, "Timeline"); await expect(page.locator("[data-bar]").first()).toBeVisible(); expect(await page.locator("[data-bar]").count()).toBeGreaterThan(10);
});

test("gallery: cover source, card size and shown properties are saved with the view", async ({ page }) => {
  await page.goto("/");
  const d = await mkDb(page, "gallery", [{ name: "Tag", type: "select", config: { options: [{ id: "x", name: "Xenon", color: "blue" }] } }, { name: "Qty", type: "number" }], [{ title: "card one", values: { Tag: "x", Qty: 3 } }, { title: "card two", values: { Qty: 8 } }], [{ name: "Cards", type: "gallery" }]);
  await sql`update pages set cover = '/api/files/00000000-0000-4000-8000-000000000000' where id = (select page_id from database_rows where id = ${d.rows[0].id})`;
  await openDb(page, d.pageId, "Cards"); const card = page.locator(`[data-card="${d.rows[0].id}"]`); await expect(card.locator("[data-cover]")).toHaveAttribute("data-cover", "placeholder");
  await page.getByRole("button", { name: /^Settings of the view/ }).click(); const s = page.getByRole("dialog");
  await s.getByLabel("Cover").selectOption("@page"); await expect(card.locator("[data-cover]")).toHaveAttribute("data-cover", "image"); await expect(page.locator(`[data-card="${d.rows[1].id}"] [data-cover]`)).toHaveAttribute("data-cover", "placeholder");
  await s.getByLabel("Card size").selectOption("large"); await expect(page.locator("[data-card-size]")).toHaveAttribute("data-card-size", "large");
  await s.getByLabel("Qty").click(); await expect(s.getByLabel("Qty")).toBeChecked(); await expect(card.locator("[data-card-prop]")).toHaveCount(1); await expect(card.locator(`[data-card-prop="${d.props.Qty}"]`)).toHaveText("3");
  await s.getByLabel("Cover").selectOption("@none"); await expect(card.locator("[data-cover]")).toHaveCount(0);
  await expect.poll(async () => { const c = await viewConfig(d.views.Cards); return [c.cover, c.cardSize, c.cardProps]; }).toEqual(["none", "large", [d.props.Qty]]);
  await page.reload(); await expect(page.locator("[data-card-size]")).toHaveAttribute("data-card-size", "large"); await expect(page.locator(`[data-card="${d.rows[0].id}"] [data-cover]`)).toHaveCount(0); await shot(page, "gallery-options");
});

test("row templates: save a row as a template, create rows from it, default template on New, duplicate a row", async ({ page }) => {
  await page.goto("/");
  const d = await mkDb(page, "templates", [{ name: "Status", type: "status" }, { name: "Qty", type: "number" }], [{ title: "model row", values: { Status: "doing", Qty: 12 } }]);
  await apiCall(page, "PATCH", `/api/pages/${(await sql`select page_id from database_rows where id = ${d.rows[0].id}`)[0].page_id}`, { content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Agenda of the template" }] }] } });
  await openDb(page, d.pageId); await cell(page, d.rows[0].id, d.props.Name).hover(); await page.getByRole("button", { name: "Open model row" }).click();
  page.once("dialog", (dlg) => dlg.accept("Weekly")); await page.getByRole("dialog").getByRole("button", { name: "Save as template" }).click(); await expect(page.getByText("Template “Weekly” saved")).toBeVisible();
  // duplicate from the row panel
  await page.getByRole("dialog").getByRole("button", { name: "Duplicate" }).click(); await expect(page.getByRole("dialog").getByLabel("Title")).toHaveValue("model row (copy)"); await page.keyboard.press("Escape"); await expect(count(page)).toHaveText("2 rows");
  // New ▾ → Weekly
  await page.getByRole("button", { name: "New row from a template" }).click(); await page.getByRole("menuitem", { name: /Weekly/ }).click();
  await expect(page.getByRole("dialog").getByText("Agenda of the template")).toBeVisible(); await page.keyboard.press("Escape"); await expect(count(page)).toHaveText("3 rows");
  const created = await sql`select r.values, p.plain_text from database_rows r join pages p on p.id = r.page_id where r.database_id = ${d.id} and r.deleted_at is null and p.title = 'Untitled'`;
  expect(created.length).toBe(1); expect(created[0].values[d.props.Status]).toBe("doing"); expect(created[0].values[d.props.Qty]).toBe(12); expect(created[0].plain_text).toContain("Agenda of the template");
  // make it the default: the New button uses it
  await page.getByRole("button", { name: "New row from a template" }).click(); await page.getByRole("menuitem", { name: "Row templates…" }).click(); await page.getByRole("dialog").getByRole("button", { name: "Make default" }).click(); await expect(page.getByRole("dialog").getByRole("button", { name: "Default", exact: true })).toBeVisible(); await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "New", exact: true }).click(); await expect(page.getByRole("dialog").getByText("Agenda of the template")).toBeVisible(); await page.keyboard.press("Escape");
  expect((await sql`select count(*)::int as n from database_rows where database_id = ${d.id} and deleted_at is null and database_rows.values->>${d.props.Qty} = '12'`)[0].n).toBe(4);
  // ⌘Z removes the row just created
  await page.keyboard.press(`${mod}+z`); await expect(count(page)).toHaveText("3 rows");
});

test("rollups and formulas in the editor: every aggregate offered, a rollup over a formula computes (D9), a formula cycle is named and cannot be saved, errors show per cell", async ({ page }) => {
  await page.goto("/");
  const items = await mkDb(page, "roll items", [{ name: "Price", type: "number" }, { name: "Paid", type: "checkbox" }, { name: "Double", type: "formula", config: { expression: 'prop("Price") * 2' } }], [{ title: "item a", values: { Price: 10, Paid: true } }, { title: "item b", values: { Price: 30 } }]);
  const d = await mkDb(page, "roll orders", [{ name: "Items", type: "relation", config: { targetDatabaseId: items.id } }, { name: "N", type: "number" }, { name: "Half", type: "formula", config: { expression: '10 / prop("N")' } }], [{ title: "order 1", values: { Items: items.rows.map((r) => r.id), N: 0 } }, { title: "order 2", values: { N: 4 } }]);
  await openDb(page, d.pageId); const o1 = d.rows[0].id;
  // formula error shown in its cell, with the message; the other row computes
  await expect(cell(page, o1, d.props.Half).locator("[data-cell-error]")).toHaveText("Division by zero"); await expect(cell(page, d.rows[1].id, d.props.Half)).toHaveText("2.5");
  // add a rollup: sum of the FORMULA "Double" of the related items (D9), then percent checked
  const addRollup = async (name: string, target: string, agg: string) => { await page.getByRole("button", { name: "Add property" }).click(); const ed = page.getByRole("dialog"); await ed.getByRole("button", { name: "Rollup" }).click(); await ed.getByPlaceholder("Property name").fill(name); const sels = ed.getByRole("combobox"); await sels.nth(0).selectOption({ label: "Items" }); await sels.nth(1).selectOption({ label: target }); await sels.nth(2).selectOption(agg); await ed.getByRole("button", { name: "Add property" }).click(); await expect(page.getByRole("button", { name: `Edit property ${name}` })).toBeVisible(); };
  await page.getByRole("button", { name: "Add property" }).click(); await page.getByRole("dialog").getByRole("button", { name: "Rollup" }).click();
  expect(await page.getByRole("dialog").getByRole("combobox").nth(2).locator("option").count(), "19 aggregates").toBe(19); await page.keyboard.press("Escape");
  await addRollup("Total doubled", "Double (formula)", "sum"); await addRollup("Paid %", "Paid", "percent_checked");
  const P = Object.fromEntries((await sql`select name, id from database_properties where database_id = ${d.id}`).map((r) => [r.name, r.id]));
  await expect(cell(page, o1, P["Total doubled"])).toHaveText("80"); await expect(cell(page, o1, P["Paid %"])).toHaveText("50 %");
  // formula cycle: A = Half + 1 exists; editing Half to read A is refused in the editor with the path
  await page.getByRole("button", { name: "Add property" }).click(); let ed = page.getByRole("dialog"); await ed.getByRole("button", { name: "Formula" }).click(); await ed.getByPlaceholder("Property name").fill("A"); await ed.locator("textarea").fill('prop("Half") + 1');
  await expect(ed.getByTestId("formula-preview")).toContainText('Error in "Half"'); await ed.getByRole("button", { name: "Add property" }).click(); await expect(page.getByRole("button", { name: "Edit property A" })).toBeVisible();
  await page.getByRole("button", { name: "Edit property Half" }).click(); ed = page.getByRole("dialog"); await ed.locator("textarea").fill('prop("A") * 2');
  await expect(ed.getByTestId("formula-cycle")).toContainText("Half → A → Half"); await expect(ed.getByRole("button", { name: "Save" })).toBeDisabled(); await shot(page, "formula-cycle");
  await ed.locator("textarea").fill("1 +"); await expect(ed.getByTestId("formula-preview")).toContainText("Syntax:"); await page.keyboard.press("Escape");
  const api = await apiCall(page, "PATCH", `/api/databases/${d.id}/properties`, { id: d.props.Half, config: { expression: 'prop("A") * 2' } }); expect(api.status).toBe(400); expect(api.body.code).toBe("formula_cycle");
});

test("CSV: the export streams all 20 000 rows (D11); an import without a header answers 400 (D4); search is debounced", async ({ page }) => {
  await page.goto("/");
  const t0 = Date.now(); const res = await page.request.get(`/api/databases/${bench.databaseId}/query?format=csv&viewId=${bench.views["All rows"]}`); expect(res.status()).toBe(200); const text = (await res.body()).toString("utf8"); const ms = Date.now() - t0;
  const lines = text.split("\r\n"); expect(lines.length, "header + 20 000 rows").toBe(20001); expect(lines[0].replace(/^﻿/, "")).toBe("Name,Status,Priority,Tags,Estimate,Cost,Due,Done,Owner,Link,Created,Score"); expect(lines[20000]).toContain("20000");
  saveMetrics("csvExport", { rows: 20000, bytes: text.length, ms, note: "GET …/query?format=csv, whole response read by the test" });
  const filtered = await page.request.get(`/api/databases/${bench.databaseId}/query?format=csv&viewId=${bench.views["Doing, big, by due date"]}`); expect((await filtered.body()).toString("utf8").split("\r\n").length).toBeGreaterThan(1001);
  const d = await mkDb(page, "csv", [], []);
  const up = (body: string) => page.request.post(`/api/databases/${d.id}/import`, { multipart: { file: { name: "x.csv", mimeType: "text/csv", buffer: Buffer.from(body) } }, headers: { origin: process.env.E2E_BASE_URL ?? "http://localhost:8481" } });
  expect((await up("")).status()).toBe(400); expect((await up("\n\n")).status()).toBe(400); const ok = await up("Name,Qty\nrow a,1\nrow b,2\n"); expect(ok.status()).toBe(201); expect((await ok.json()).created).toBe(2);
  expect((await apiCall(page, "POST", `/api/databases/${d.id}/import`, { not: "multipart" })).status).toBe(400);
  expect((await apiCall(page, "GET", `/api/databases/${d.id}/rows?limit=abc`)).status).toBe(400); expect((await apiCall(page, "GET", `/api/databases/${d.id}/rows?full=1&offset=-1`)).status).toBe(400); // D23
  expect((await apiCall(page, "DELETE", `/api/databases/${d.id}/rows?id=not-a-uuid`)).status).toBe(400); expect((await apiCall(page, "DELETE", `/api/databases/${d.id}/views?id=nope`)).status).toBe(400); // D2
  // search: one query after typing, not one per keystroke
  await openDb(page, bench.pageId, "All rows"); await expect(count(page)).toHaveText("20,000 rows"); const qs: string[] = []; page.on("request", (r) => { if (r.url().endsWith(`/api/databases/${bench.databaseId}/query`) && r.method() === "POST") { const b = JSON.parse(r.postData() ?? "{}"); if (b.search) qs.push(b.search); } });
  await page.getByRole("button", { name: "Search rows" }).click(); await page.getByLabel("Search rows").pressSequentially("zephyr 12", { delay: 30 }); await expect(count(page)).toHaveText("38 rows"); expect([...new Set(qs)], "only the final text was queried").toEqual(["zephyr 12"]);
  await expectNoHorizontalOverflow(page);
});

/**
 * The scratch database accepts 6 connections: the web server and the worker process do not fit together with the tests. The queued AI
 * runs are executed by `scripts/e2e-ai-runner.ts` — the worker's real handler (routing, model call, cost, run log, cell write) on one
 * connection; only the pg-boss dispatch is bypassed.
 */
async function aiRunner(fakeUrl: string | null): Promise<{ stop: () => Promise<void> }> {
  const { spawn } = await import("node:child_process");
  const child = spawn("node", ["node_modules/tsx/dist/cli.mjs", "scripts/e2e-ai-runner.ts", ...(fakeUrl ? ["--fake-url", fakeUrl] : [])], { env: process.env, stdio: ["ignore", "pipe", "inherit"] });
  await new Promise<void>((ok, ko) => { const t = setTimeout(() => ko(new Error("AI runner did not start")), 30_000); child.stdout!.on("data", (b: Buffer) => { if (b.toString().includes("ready")) { clearTimeout(t); ok(); } }); child.on("exit", (c) => { clearTimeout(t); ko(new Error(`AI runner exited (${c})`)); }); });
  return { stop: () => new Promise<void>((done) => { child.removeAllListeners("exit"); child.on("exit", () => done()); child.kill("SIGTERM"); setTimeout(done, 8000); }) };
}

test("smart (AI) property with the fake model: configuration, generate, AI mark, hand-typed value protected, column fill, failed run + retry, runs log with cost", async ({ page }) => {
  test.skip(!process.env.FAKE_LLM_KEY_E2EPDB, "needs FAKE_LLM_KEY_E2EPDB (the key the fake model server accepts)");
  test.setTimeout(180_000);
  const { startFakeLLM } = await import("../helpers/fake-llm");
  const fake = await startFakeLLM(); fake.key = process.env.FAKE_LLM_KEY_E2EPDB!;
  fake.reply = (body) => JSON.stringify({ value: /on fire/.test(JSON.stringify(body.messages)) ? "Urgent" : "Normal" });
  const runner = await aiRunner(fake.url); const reg = { cleanup: () => runner.stop() };
  try {
    await page.goto("/"); const d = await mkDb(page, "smart", [], [{ title: "server on fire" }, { title: "weekly newsletter" }, { title: "printer jam" }]); const [r1, r2, r3] = d.rows;
    await openDb(page, d.pageId);
    // configuration UI: task, choices, model, flags — the problem is shown until the configuration can run
    await page.getByRole("button", { name: "Add property" }).click(); const ed = page.getByRole("dialog"); await ed.getByRole("button", { name: "AI", exact: true }).click(); await ed.getByPlaceholder("Property name").fill("Triage");
    const cfg = ed.getByTestId("ai-config"); await expect(cfg.getByTestId("ai-problem")).toHaveText("No prompt configured"); await cfg.getByLabel("AI task").selectOption("classify"); await expect(cfg.getByTestId("ai-problem")).toHaveText("Classification needs at least two choices");
    for (const c of ["Urgent", "Normal"]) { await cfg.getByLabel("New choice").fill(c); await cfg.getByLabel("New choice").press("Enter"); } await expect(cfg.getByTestId("ai-problem")).toHaveCount(0); await expect(cfg.getByRole("list", { name: "Choices" }).getByRole("listitem")).toHaveCount(2);
    await expect(cfg.getByLabel("Run automatically")).not.toBeChecked(); await expect(cfg.getByLabel("AI-managed")).not.toBeChecked(); await shot(page, "ai-config");
    await ed.getByRole("button", { name: "Add property" }).click(); await expect(page.getByRole("button", { name: "Edit property Triage" })).toBeVisible();
    const pid = (await sql`select id from database_properties where database_id = ${d.id} and name = 'Triage'`)[0].id as string;
    // the editor offers the ModelPicker (Auto = measured routing by default); the fake model is set through the documented route
    await page.getByRole("button", { name: "Edit property Triage" }).click(); const picker = page.getByRole("dialog").getByLabel("Model of this AI property"); await expect(picker).toContainText("Auto"); await picker.click(); await expect(page.getByPlaceholder("Search a model, a creator, a provider…")).toBeVisible(); await expect(page.getByRole("listbox").getByRole("option").first()).toBeVisible(); await page.keyboard.press("Escape"); await page.keyboard.press("Escape");
    expect((await apiCall(page, "PUT", `/api/databases/${d.id}/ai/config`, { propertyId: pid, ai: { model: "e2epdb:echo" } })).status).toBe(200); await page.reload(); await expect(count(page)).toHaveText("3 rows");
    expect((await sql`select config->'ai' as ai from database_properties where id = ${pid}`)[0].ai).toEqual({ task: "classify", model: "e2epdb:echo", prompt: "", choices: ["Urgent", "Normal"], autoRun: false, managed: false });
    // nothing ran yet: no request reached the model
    expect(fake.requests.filter((r) => r.path.endsWith("/chat/completions")).length).toBe(0);
    // generate one cell: pending, then the value with the AI mark
    await cell(page, r1.id, pid).getByRole("button", { name: "Generate" }).click(); await expect(cell(page, r1.id, pid)).toContainText("Urgent", { timeout: 30_000 }); await expect(cell(page, r1.id, pid).getByLabel("AI-generated")).toBeVisible(); expect((await values(r1.id))[pid]).toBe("Urgent");
    // a value typed by hand is protected: the run is skipped until the owner asks to replace it
    await cell(page, r2.id, pid).hover(); await cell(page, r2.id, pid).getByRole("button", { name: "Edit Triage by hand" }).click(); await page.keyboard.type("Mine"); await page.keyboard.press("Enter"); await expect.poll(async () => (await values(r2.id))[pid]).toBe("Mine");
    await cell(page, r2.id, pid).hover(); await cell(page, r2.id, pid).getByRole("button", { name: "Regenerate Triage" }).click(); await expect(page.getByText("This value was typed by hand")).toBeVisible(); await page.waitForTimeout(500); expect((await values(r2.id))[pid]).toBe("Mine");
    await page.getByRole("button", { name: "Replace with AI" }).click(); await expect(cell(page, r2.id, pid)).toContainText("Normal", { timeout: 30_000 });
    // whole column: fill the empty cells (confirmation states the count)
    await page.getByRole("button", { name: "Edit property Triage" }).click(); let asked = ""; page.once("dialog", (dlg) => { asked = dlg.message(); void dlg.accept(); }); await page.getByRole("button", { name: "Fill empty cells" }).click();
    await expect(cell(page, r3.id, pid)).toContainText("Normal", { timeout: 30_000 }); expect(asked).toContain("Run the AI on 1 cell of “Triage”"); await page.keyboard.press("Escape");
    // a failing model: the cell shows the error and offers Retry; the log has the error
    expect((await apiCall(page, "PUT", `/api/databases/${d.id}/ai/config`, { propertyId: pid, ai: { model: "e2epdb:err-500" } })).status).toBe(200);
    await cell(page, r1.id, pid).hover(); await cell(page, r1.id, pid).getByRole("button", { name: "Regenerate Triage" }).click(); await expect(cell(page, r1.id, pid).getByRole("button", { name: "Retry Triage" })).toBeVisible({ timeout: 30_000 }); await shot(page, "ai-cell-error");
    await page.getByRole("button", { name: "Edit property Triage" }).click(); await page.getByRole("group", { name: "AI column" }).getByRole("button", { name: "Runs log" }).click(); const log = page.getByTestId("ai-runs"); await expect(log.locator('[data-run="failed"]')).toHaveCount(1);
    await expect(log.locator('[data-run="failed"] [data-run-error]')).not.toBeEmpty(); await expect(log.locator('[data-run="done"]')).toHaveCount(3); await expect(log.locator('[data-run="skipped"]')).toHaveCount(1); await expect(log.locator('[data-run="skipped"] [data-run-error]')).toContainText("edited by hand");
    await expect(log.locator('[data-run="done"]').first().locator("[data-run-cost]")).toHaveText(/^\$0\.000\d+$/); await expect(log.locator('[data-run="done"]').first()).toContainText("e2epdb:echo");
    const cost = (await sql`select coalesce(sum(cost_usd), 0)::float as c, count(*)::int as n from ai_property_runs where database_id = ${d.id} and status = 'done'`)[0]; expect(cost.n).toBe(3); expect(cost.c).toBeGreaterThan(0);
    await expect(log.getByTestId("ai-runs-summary")).toContainText("3 done · 1 failed · 1 skipped"); await shot(page, "ai-runs-log");
    // retry from the log once the model works again
    expect((await apiCall(page, "PUT", `/api/databases/${d.id}/ai/config`, { propertyId: pid, ai: { model: "e2epdb:echo" } })).status).toBe(200);
    await log.locator('[data-run="failed"]').getByRole("button", { name: "Retry" }).click(); await expect(log.locator('[data-run="done"]')).toHaveCount(4, { timeout: 30_000 }); await page.keyboard.press("Escape");
    await expect(cell(page, r1.id, pid)).toContainText("Urgent"); expect(fake.requests.filter((r) => r.path.endsWith("/chat/completions")).length, "5 model calls in all: 4 answered + 1 refused by the failing model").toBeGreaterThanOrEqual(5);
  } finally { await reg.cleanup(); await fake.close(); }
});

test("smart (AI) property with a REAL provider (opt-in: E2E_REAL_AI=1): one cell classified, cost read from the runs log", async ({ page }) => {
  test.skip(process.env.E2E_REAL_AI !== "1", "opt-in (E2E_REAL_AI=1): spends a fraction of a cent on a real model");
  test.setTimeout(180_000);
  const model = process.env.E2E_REAL_AI_MODEL ?? "claude-haiku-5-5";
  const runner = await aiRunner(null); try {
  await page.goto("/"); const d = await mkDb(page, "real ai", [{ name: "Triage", type: "ai", config: { ai: { task: "classify", prompt: "", choices: ["Urgent", "Normal", "Later"], model, autoRun: false, managed: false } } }], [{ title: "The production database server is down and customers cannot log in" }]);
  await openDb(page, d.pageId); const c = cell(page, d.rows[0].id, d.props.Triage); await c.getByRole("button", { name: "Generate" }).click();
  await expect(c.getByLabel("AI-generated")).toBeVisible({ timeout: 90_000 }); const value = (await values(d.rows[0].id))[d.props.Triage]; expect(["Urgent", "Normal", "Later"]).toContain(value);
  await page.getByRole("button", { name: "Edit property Triage" }).click(); await page.getByRole("group", { name: "AI column" }).getByRole("button", { name: "Runs log" }).click(); await expect(page.getByTestId("ai-runs").locator('[data-run="done"]')).toHaveCount(1); await shot(page, "ai-real-run");
  const [run] = await sql`select model, provider, input_tokens, output_tokens, cost_usd, status from ai_property_runs where database_id = ${d.id}`;
  saveMetrics("realAi", { model: run.model, provider: run.provider, inputTokens: run.input_tokens, outputTokens: run.output_tokens, costUsd: run.cost_usd, value });
  expect(run.status).toBe("done"); expect(run.cost_usd).toBeGreaterThan(0); expect(run.cost_usd, "a fraction of a cent").toBeLessThan(0.02);
  } finally { await runner.stop(); }
});
