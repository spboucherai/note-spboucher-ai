/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : tests/e2e/next-p-db-phones.spec.ts
 * Description      : SP Note Next Generation, Databases Next Generation on
 *                    phones (360 / 375 / 430 px): the 20 000-row database stays
 *                    usable (cards load by pages, the grid is virtualised,
 *                    every view fits), groups collapse, the filter builder
 *                    works from the options sheet, selection + bulk actions and
 *                    row templates have touch-sized controls. No horizontal
 *                    overflow anywhere.
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

const DATA = process.env.DATA_DIR ? path.dirname(process.env.DATA_DIR) : "test-results"; const SHOTS = process.env.E2E_SHOTS ?? path.join(DATA, "shots");
const made: string[] = []; let bench: { pageId: string; databaseId: string; views: Record<string, string>; properties: Record<string, string> };
const shot = async (page: Page, name: string, w: number) => { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, `phone-${w}-${name}.png`) }); };
test.beforeAll(() => { bench = JSON.parse(execFileSync("node", ["node_modules/tsx/dist/cli.mjs", "scripts/db-seed-bench.ts", "20000"], { encoding: "utf8", env: process.env, stdio: ["ignore", "pipe", "pipe"] }).trim().split("\n").pop()!); });
test.afterAll(async () => { await removeBench(bench); if (made.length) { await sql`delete from pages where database_id in (select id from databases where page_id = any(${made}::uuid[]))`; await sql`delete from pages where id = any(${made}::uuid[])`; } });
const tab = async (page: Page, name: string) => { const t = page.getByRole("tab", { name, exact: true }); await t.scrollIntoViewIfNeeded(); if ((await t.getAttribute("aria-selected")) !== "true") await t.click(); await expect(t).toHaveAttribute("aria-selected", "true"); };

test("20 000 rows on a phone: cards load by pages, every view fits, the grid is virtualised", async ({ page }, t) => {
  const w = t.project.use.viewport!.width; await sql`update database_views set config = config - 'mobileLayout' - 'collapsed' where database_id = ${bench.databaseId}`;
  await page.goto(`/p/${bench.pageId}`); await tab(page, "All rows");
  await expect(page.getByText("20000 rows · 100 loaded")).toBeVisible(); await expect(page.getByRole("button", { name: /^Open / })).toHaveCount(100); await expectNoHorizontalOverflow(page);
  // the next page loads when the end of the list comes into view
  await page.getByTestId("load-more").scrollIntoViewIfNeeded(); await expect(page.getByText(/20000 rows · [2-9]00 loaded/)).toBeVisible(); expect(await page.getByRole("button", { name: /^Open / }).count()).toBeGreaterThanOrEqual(200); await shot(page, "cards-20k", w);
  await page.locator("#main-scroll").evaluate((el) => { el.scrollTop = 0; });
  for (const name of ["Grouped by status", "Board", "Calendar", "Timeline", "Gallery", "List", "Doing, big, by due date"]) {
    await tab(page, name); await page.waitForTimeout(400);
    await test.step(name, async () => { await expectNoHorizontalOverflow(page); await expect(page.locator("main")).not.toContainText(/Could not load|Application error/i); });
  }
  // grouped cards: whole-database counts, a group collapses and stays collapsed
  await tab(page, "Grouped by status"); const [{ n }] = await sql`select count(*)::int as n from database_rows where database_id = ${bench.databaseId} and deleted_at is null and database_rows.values->>${bench.properties.Status} = 'todo'`;
  await expect(page.locator('[data-group-count="todo"]')).toHaveText(String(n)); const collapse = page.getByRole("button", { name: "Collapse group Not started" }); expect((await collapse.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await collapse.click(); await expect(page.getByRole("button", { name: "Expand group Not started" })).toBeVisible(); await expect(page.getByRole("region", { name: "Not started" }).getByRole("button", { name: /^Open / })).toHaveCount(0); await shot(page, "grouped-collapsed", w);
  await page.getByRole("button", { name: "Expand group Not started" }).click();
  // the real grid: virtualised, scrolls inside itself, the last row is reachable
  await tab(page, "All rows"); await page.getByRole("button", { name: /View options/ }).click(); await page.getByRole("dialog").getByRole("button", { name: /Grid/ }).click(); await page.getByRole("dialog").getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.getByTestId("row-count")).toHaveText("20,000 rows"); expect(await page.locator("[data-row]").count()).toBeLessThan(80); await expectNoHorizontalOverflow(page);
  await page.locator(".db-scroll").evaluate((el) => { el.scrollTop = el.scrollHeight; }); await expect(page.locator('[data-index="19999"]')).toBeVisible(); await expectNoHorizontalOverflow(page); await shot(page, "grid-20k", w);
  await sql`update database_views set config = config - 'mobileLayout' where database_id = ${bench.databaseId}`;
});

test("phone: filter builder in the options sheet, selection and bulk actions in the grid, row templates — touch-sized, nothing overflows", async ({ page }, t) => {
  const w = t.project.use.viewport!.width; await page.goto("/");
  const c = await apiCall(page, "POST", "/api/pages", { title: `E2E-pdb phone ${w} ${Date.now().toString(36)}`, type: "database", section: "databases" }); expect(c.status).toBe(201); made.push(c.body.id);
  const d = (await apiCall(page, "GET", `/api/databases/${c.body.id}`)).body; const st = (await apiCall(page, "POST", `/api/databases/${d.id}/properties`, { name: "Status", type: "status" })).body; const qty = (await apiCall(page, "POST", `/api/databases/${d.id}/properties`, { name: "Qty", type: "number" })).body;
  const rows = (await apiCall(page, "POST", `/api/databases/${d.id}/rows`, { rows: Array.from({ length: 12 }, (_, i) => ({ title: `phone row ${i + 1} ${i % 2 ? "even" : "odd"}`, values: { [st.id]: i % 3 ? "doing" : "todo", [qty.id]: i } })) })).body;
  expect((await apiCall(page, "POST", `/api/databases/${d.id}/row-templates`, { name: "Preset", fromRowId: rows[1].id })).status).toBe(201);
  await page.goto(`/p/${c.body.id}`); await expect(page.getByText("12 rows")).toBeVisible();
  // filter from the sheet: debounced, saved with the view
  await page.getByRole("button", { name: /View options/ }).click(); const sheet = page.getByRole("dialog"); const fb = sheet.getByTestId("filter-builder");
  await fb.getByRole("button", { name: "Add filter" }).click(); expect((await fb.getByLabel("Value").boundingBox())!.height).toBeGreaterThanOrEqual(44); await fb.getByLabel("Value").fill("even");
  await expect.poll(async () => (await sql`select config from database_views where database_id = ${d.id}`)[0].config.filter).toEqual({ and: [{ property: d.properties[0].id, op: "contains", value: "even" }] });
  await fb.getByRole("button", { name: "Add group" }).click(); await expect(fb.locator('[data-depth="1"]')).toBeVisible(); await expectNoHorizontalOverflow(page); await shot(page, "filter-sheet", w);
  await fb.locator('[data-depth="1"]').getByRole("button", { name: "Remove group" }).click();
  // grid layout: selection + bulk bar
  await sheet.getByRole("button", { name: /Grid/ }).click(); await sheet.getByRole("button", { name: "Done", exact: true }).click(); await expect(page.getByTestId("row-count")).toHaveText("6 rows");
  await page.getByRole("checkbox", { name: "Select all 6 rows" }).check(); const bar = page.getByRole("toolbar", { name: "Selected rows" }); await expect(bar.getByRole("status")).toHaveText("6 selected");
  for (const name of ["Edit property", "Duplicate", "Delete"]) expect((await bar.getByRole("button", { name }).boundingBox())!.height, name).toBeGreaterThanOrEqual(44);
  await expectNoHorizontalOverflow(page); await shot(page, "bulk-bar", w);
  await bar.getByRole("button", { name: "Edit property" }).click(); const ed = page.getByRole("dialog"); await ed.getByLabel("Property to edit").selectOption({ label: "Qty" }); await ed.getByTestId("bulk-value").locator("input").fill("77"); await ed.getByRole("button", { name: "Apply to 6" }).click();
  await expect.poll(async () => (await sql`select count(*)::int as n from database_rows where database_id = ${d.id} and database_rows.values->>${qty.id} = '77'`)[0].n).toBe(6);
  await page.getByRole("button", { name: /^Undo/ }).first().click(); await expect.poll(async () => (await sql`select count(*)::int as n from database_rows where database_id = ${d.id} and database_rows.values->>${qty.id} = '77'`)[0].n).toBe(0);
  // New ▾: the template menu is reachable and creates a row with the preset values
  const more = page.getByRole("button", { name: "New row from a template" }); expect((await more.boundingBox())!.height).toBeGreaterThanOrEqual(44); await more.click(); await page.getByRole("menuitem", { name: /Preset/ }).click();
  await expect(page.getByRole("dialog").getByLabel("Title")).toBeVisible(); await expectNoHorizontalOverflow(page);
  await expect.poll(async () => (await sql`select count(*)::int as n from database_rows where database_id = ${d.id} and deleted_at is null`)[0].n).toBe(13);
});
