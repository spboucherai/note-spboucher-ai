/**
 * file: tests/e2e/next-p-ra-ui.spec.ts
 * description: P-RA UI fixes — load failures are error states with Retry (tasks, trash, archive, search index / duplicates), task
 *   quick-add does not invent due dates, delete is reachable on touch and undoable, trash and search lists page with "Show more".
 *   Desktop Chromium, scratch database only; everything seeded carries the prefix `E2E-pra` and is removed in afterAll.
 * author: Simon-Pierre Boucher — contact@spboucher.ai
 */
import { test, expect, type Page, type Route } from "@playwright/test";
import { apiCall, sql, STATE } from "./helpers";

const PFX = "E2E-pra"; const stamp = Date.now().toString(36);
const pages: string[] = [];
test.afterAll(async () => {
  await sql`delete from tasks where title like ${PFX + " %"}`;
  if (pages.length) await sql`delete from pages where id = any(${pages}::uuid[])`;
  await sql`delete from pages where title like ${PFX + " %"}`;
});

const fail = (route: Route) => route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "E2E forced failure" }) });
/** The alert of an error state: title, the server message and a Retry button. */
async function expectError(page: Page, testId: string, title: RegExp) {
  const alert = page.getByTestId(testId); await expect(alert).toBeVisible({ timeout: 15_000 }); await expect(alert).toHaveAttribute("role", "alert");
  await expect(alert).toContainText(title); await expect(alert).toContainText("E2E forced failure"); await expect(alert.getByRole("button", { name: "Retry" })).toBeVisible();
  return alert;
}
const taskByTitle = async (page: Page, title: string) => ((await apiCall(page, "GET", "/api/tasks?done=1")).body as any[]).find((t) => t.title === title);

test("U9 tasks: a failed load is an error state with Retry, not 'Inbox zero'; Retry recovers", async ({ page }) => {
  await page.goto("/"); const title = `${PFX} ${stamp} visible after retry`; expect((await apiCall(page, "POST", "/api/tasks", { title })).status).toBe(201);
  const api = /\/api\/tasks(\?.*)?$/; await page.route(api, (r) => (r.request().method() === "GET" ? fail(r) : r.continue()));
  await page.goto("/tasks"); const alert = await expectError(page, "tasks-error", /Could not load your tasks/);
  await expect(page.getByText("Inbox zero")).toHaveCount(0); await expect(page.getByText("Not loaded")).toBeVisible();
  await page.unroute(api); await alert.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByTestId("tasks-error")).toHaveCount(0); await expect(page.getByTestId("task-row").filter({ hasText: title })).toBeVisible();
});

test("U9 trash and archive: a failed load is an error state with Retry, not an empty list", async ({ page }) => {
  await page.goto("/"); const created = await apiCall(page, "POST", "/api/pages", { title: `${PFX} ${stamp} trashed` }); expect(created.status).toBe(201); pages.push(created.body.id);
  expect((await apiCall(page, "DELETE", `/api/pages/${created.body.id}`)).status).toBe(200);
  const trash = /\/api\/pages\?view=trash/; await page.route(trash, fail);
  await page.goto("/trash"); const alert = await expectError(page, "trash-error", /Could not load the trash/); await expect(page.getByText("Trash is empty")).toHaveCount(0);
  await page.unroute(trash); await alert.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByTestId("trash-error")).toHaveCount(0); await expect(page.getByTestId("trash-row").filter({ hasText: `${PFX} ${stamp} trashed` })).toBeVisible();
  const archive = /\/api\/pages\?view=archived/; await page.route(archive, fail);
  await page.goto("/archive"); const a2 = await expectError(page, "archive-error", /Could not load the archive/); await expect(page.getByText("Nothing archived")).toHaveCount(0);
  await page.unroute(archive); await a2.getByRole("button", { name: "Retry" }).click(); await expect(page.getByTestId("archive-error")).toHaveCount(0);
});

test("U9 search: the Index and Duplicates tabs show an error state with Retry and recover", async ({ page }) => {
  const idx = /\/api\/search\/index-state/, dups = /\/api\/search\/duplicates/;
  await page.route(idx, (r) => (r.request().method() === "GET" ? fail(r) : r.continue())); await page.route(dups, fail);
  await page.goto("/search");
  await page.getByRole("tab", { name: /^Index/ }).click(); const a = await expectError(page, "index-error", /Could not load the index status/);
  await page.unroute(idx); await a.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByTestId("index-error")).toHaveCount(0); await expect(page.getByRole("button", { name: /Rebuild everything/ })).toBeVisible();
  await page.getByRole("tab", { name: "Duplicates" }).click(); const b = await expectError(page, "duplicates-error", /Could not load the duplicates/); await expect(page.getByText("No near-duplicate pages")).toHaveCount(0);
  await page.unroute(dups); await b.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByTestId("duplicates-error")).toHaveCount(0); await expect(page.getByText(/No near-duplicate pages|% similar/).first()).toBeVisible();
});

test("U12 quick-add: 'Buy sun cream' and 'Plan 3 days in Paris' keep their title and get no due date; 'tomorrow' still works", async ({ page }) => {
  await page.goto("/tasks"); const input = page.getByLabel("Add a task");
  const add = async (text: string) => { await input.fill(text); await page.keyboard.press("Enter"); await expect(input).toHaveValue(""); };
  const sun = `${PFX} ${stamp} Buy sun cream`, paris = `${PFX} ${stamp} Plan 3 days in Paris`, marc = `${PFX} ${stamp} Call Marc`;
  await add(sun); await add(paris); await add(`${marc} tomorrow`);
  await expect(page.getByTestId("task-row").filter({ hasText: sun })).toBeVisible(); await expect(page.getByTestId("task-row").filter({ hasText: sun }).getByTestId("task-due")).toHaveCount(0);
  const a = await taskByTitle(page, sun), b = await taskByTitle(page, paris), c = await taskByTitle(page, marc);
  expect(a).toBeTruthy(); expect(a.dueAt).toBeNull(); expect(b).toBeTruthy(); expect(b.dueAt).toBeNull(); expect(c).toBeTruthy(); expect(c.dueAt).not.toBeNull();
  await expect(page.getByTestId("task-row").filter({ hasText: marc }).getByTestId("task-due")).toBeVisible();
});

test("U13 delete then Undo restores the same task; the restore route is idempotent", async ({ page }) => {
  await page.goto("/"); const title = `${PFX} ${stamp} undo me`; const made = await apiCall(page, "POST", "/api/tasks", { title, dueAt: "2031-01-15", priority: "high", project: "e2e" }); expect(made.status).toBe(201); const id = made.body.id;
  await page.goto("/tasks"); const row = page.getByTestId("task-row").filter({ hasText: title }); await expect(row).toBeVisible();
  await row.hover(); await row.getByRole("button", { name: `Delete task: ${title}` }).click();
  await expect(row).toHaveCount(0); await expect(page.getByText("Task deleted")).toBeVisible(); expect((await apiCall(page, "GET", `/api/tasks/${id}`)).body.deletedAt).toBeTruthy();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(row).toBeVisible(); await expect(page.getByText("Task restored")).toBeVisible();
  const back = (await apiCall(page, "GET", `/api/tasks/${id}`)).body; expect(back.deletedAt ?? null).toBeNull(); expect(back.title).toBe(title); expect(back.priority).toBe("high"); expect(back.project).toBe("e2e"); expect(String(back.dueAt)).toContain("2031-01-15");
  // route contract: restoring a live task changes nothing; unknown action and unknown id are refused
  expect((await apiCall(page, "POST", `/api/tasks/${id}?action=restore`)).status).toBe(200);
  expect((await apiCall(page, "POST", `/api/tasks/${id}?action=explode`)).status).toBe(400);
  expect((await apiCall(page, "POST", "/api/tasks/00000000-0000-4000-8000-000000000000?action=restore")).status).toBe(404);
});

test("U13 touch: the delete button is visible with a 44 px target and the due date shows on a 360 px screen", async ({ page, browser }) => {
  await page.goto("/"); const title = `${PFX} ${stamp} touch row`; expect((await apiCall(page, "POST", "/api/tasks", { title, dueAt: "2031-02-20" })).status).toBe(201);
  const ctx = await browser.newContext({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true, storageState: STATE }); const phone = await ctx.newPage();
  try {
    await phone.goto("/tasks"); const fine = await phone.evaluate(() => window.matchMedia("(hover: hover) and (pointer: fine)").matches);
    test.skip(fine, "this browser does not emulate a coarse pointer");
    const row = phone.getByTestId("task-row").filter({ hasText: title }); await expect(row).toBeVisible(); await expect(row.getByTestId("task-due")).toBeVisible();
    const del = row.getByRole("button", { name: `Delete task: ${title}` }); await expect(del).toBeVisible(); expect(await del.evaluate((el) => getComputedStyle(el).opacity)).toBe("1");
    const box = (await del.boundingBox())!; expect(box.width).toBeGreaterThanOrEqual(44); expect(box.height).toBeGreaterThanOrEqual(44);
    expect(await phone.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
  } finally { await ctx.close(); }
});

test("U10 trash: more than 100 trashed pages are reached with 'Show more'; ?offset= is validated", async ({ page }) => {
  test.setTimeout(120_000); await page.goto("/"); const N = 103; const ids: string[] = [];
  for (let i = 0; i < N; i += 10) { const batch = await Promise.all(Array.from({ length: Math.min(10, N - i) }, (_v, k) => apiCall(page, "POST", "/api/pages", { title: `${PFX} ${stamp} bulk ${String(i + k).padStart(3, "0")}` }))); for (const r of batch) { expect(r.status).toBe(201); ids.push(r.body.id); pages.push(r.body.id); } }
  // trashed long ago: they close the list (most recently deleted first), whatever the scratch trash already holds
  await sql`update pages set deleted_at = timestamptz '2001-01-01' + (random() * interval '1 day') where id = any(${ids}::uuid[])`;
  const first = await apiCall(page, "GET", "/api/pages?view=trash&limit=100"); expect(first.status).toBe(200); expect(first.body.length).toBe(100); expect(first.headers["x-next-offset"]).toBe("100");
  const second = await apiCall(page, "GET", "/api/pages?view=trash&limit=100&offset=100"); expect(second.status).toBe(200); expect(second.body.length).toBeGreaterThanOrEqual(3);
  const overlap = new Set(first.body.map((p: any) => p.id)); expect(second.body.some((p: any) => overlap.has(p.id))).toBe(false);
  for (const bad of ["-1", "abc", "1.5", "9999999"]) { const r = await apiCall(page, "GET", `/api/pages?view=trash&offset=${bad}`); expect(r.status, bad).toBe(400); expect(r.body.code).toBe("bad_offset"); }
  const plain = await apiCall(page, "GET", "/api/pages?view=recent&limit=1"); expect(plain.status).toBe(200); expect(Array.isArray(plain.body)).toBe(true);
  await page.goto("/trash"); const rows = page.getByTestId("trash-row"); await expect(rows).toHaveCount(100); const more = page.getByTestId("trash-more");
  await expect(more).toContainText("Showing the first 100."); const bulk = rows.filter({ hasText: `${PFX} ${stamp} bulk` });
  for (let i = 0; i < 30 && (await more.getByRole("button", { name: "Show more" }).count()); i++) { const n = await rows.count(); await more.getByRole("button", { name: "Show more" }).click(); await expect.poll(() => rows.count()).toBeGreaterThan(n); }
  await expect(page.getByTestId("trash-more")).toHaveCount(0); await expect(bulk).toHaveCount(N);
});

test("U10 search: results load 40 at a time up to 120, then the list says it is truncated", async ({ page }) => {
  const limits: number[] = [];
  await page.route(/\/api\/search\?/, (r) => { const u = new URL(r.request().url()); if (u.searchParams.get("mode") !== "hybrid") return r.continue(); const limit = Number(u.searchParams.get("limit")); limits.push(limit);
    const hits = Array.from({ length: Math.min(limit, 500) }, (_v, i) => ({ chunkId: `c${i}`, pageId: null, sourceType: "page", sourceId: `s${i}`, title: `${PFX} hit ${i + 1}`, icon: null, heading: null, blockId: null, content: `passage ${i + 1}`, semantic: 0, keyword: 1, kind: "page" }));
    return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(hits) }); });
  await page.goto(`/search?q=${encodeURIComponent(`${PFX} many`)}`);
  const items = page.getByTestId("search-results").locator("> li"); const more = page.getByTestId("search-more"); const btn = more.getByRole("button", { name: "Show more" });
  await expect(items).toHaveCount(40); await expect(more).toContainText("Showing the first 40."); await expect(page.getByRole("tab", { name: "Results · 40+" })).toBeVisible();
  await btn.click(); await expect(items).toHaveCount(80); await btn.click(); await expect(items).toHaveCount(120);
  await expect(more).toContainText("Showing the first 120 results"); await expect(btn).toHaveCount(0); expect(limits).toEqual(expect.arrayContaining([40, 80, 120])); expect(Math.max(...limits)).toBe(120);
  // a new query starts again at the first 40
  await page.getByLabel("Search everything").fill(`${PFX} other`); await expect(items).toHaveCount(40); expect(limits[limits.length - 1]).toBe(40);
  await page.unrouteAll({ behavior: "ignoreErrors" });
  // the route itself accepts the higher limit (it capped at 60 before) and still answers a plain array
  const r = await apiCall(page, "GET", "/api/search?mode=quick&q=&limit=120"); expect(r.status).toBe(200); expect(Array.isArray(r.body)).toBe(true);
});
