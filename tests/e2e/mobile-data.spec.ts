import { test, expect, type Page } from "@playwright/test";
import { apiCall, docOf, para, expectNoHorizontalOverflow, sql } from "./helpers";

/** Phone journeys on structured data: a database, a property change, an export, an agent proposal. Same three viewports as mobile.spec.ts. */
const made: string[] = []; const execs: string[] = [];
const uniq = (t: { project: { name: string } }, s: string) => `${s} ${t.project.name} ${Date.now().toString(36)}`;
test.afterAll(async () => { if (execs.length) await sql`delete from ai_executions where id = any(${execs}::uuid[])`; if (made.length) { await sql`delete from tasks where page_id = any(${made}::uuid[])`; await sql`delete from pages where id = any(${made}::uuid[]) or parent_id = any(${made}::uuid[])`; } });
async function seedDb(page: Page, title: string) {
  const c = await apiCall(page, "POST", "/api/pages", { title, type: "database", section: "databases" }); expect(c.status).toBe(201); made.push(c.body.id);
  expect((await apiCall(page, "POST", `/api/databases/${c.body.id}/apply-template`, { template: "tasks" })).status).toBe(200);
  for (const r of ["E2E row with a long title that has to wrap on a narrow phone", "E2E short row"]) expect((await apiCall(page, "POST", `/api/databases/${c.body.id}/rows`, { title: r })).status).toBeLessThan(300);
  return c.body.id as string;
}

test("a database on a phone: cards, every view fits, a new row, a property changed from the row sheet", async ({ page }, t) => {
  await page.goto("/"); const id = await seedDb(page, uniq(t, "E2E-db")); await page.goto(`/p/${id}`);
  const card = page.getByRole("button", { name: "Open E2E short row" }); await expect(card).toBeVisible(); await expectNoHorizontalOverflow(page);
  for (const b of [page.getByRole("button", { name: "New", exact: true }), page.getByRole("button", { name: /View options/ })]) expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  // every saved view renders without pushing the page sideways
  const tabs = page.getByRole("tab"); const n = await tabs.count(); expect(n).toBeGreaterThanOrEqual(3);
  for (let i = 0; i < n; i++) { if ((await tabs.nth(i).getAttribute("aria-selected")) !== "true") await tabs.nth(i).click(); await expect(tabs.nth(i)).toHaveAttribute("aria-selected", "true"); await page.waitForTimeout(350); await test.step(`view ${await tabs.nth(i).innerText()}`, async () => { await expectNoHorizontalOverflow(page); await expect(page.locator("main")).not.toContainText(/couldn.t load|Application error/i); }); }
  await tabs.first().click(); await expect(tabs.first()).toHaveAttribute("aria-selected", "true"); // (a second tap on the selected view opens its settings — not wanted here)
  // quick create keeps its draft
  await page.getByRole("button", { name: "New", exact: true }).click(); let sheet = page.getByRole("dialog"); await sheet.getByLabel("Title").fill("E2E created on phone"); await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "New", exact: true }).click(); sheet = page.getByRole("dialog"); await expect(sheet.getByLabel("Title"), "the draft survives closing the sheet").toHaveValue("E2E created on phone");
  await sheet.getByRole("button", { name: "Create row" }).click(); await expect(page.getByRole("button", { name: "Open E2E created on phone" })).toBeVisible();
  // change a property from the row sheet
  await card.click(); sheet = page.getByRole("dialog").first(); await expect(sheet.getByLabel("Title")).toHaveValue("E2E short row");
  await sheet.getByRole("button", { name: "Status" }).click(); await page.getByRole("dialog").last().getByText("In progress", { exact: true }).click();
  await expect.poll(async () => JSON.stringify((await sql`select r.values from database_rows r join pages p on p.id = r.page_id where p.title = 'E2E short row' and r.database_id in (select id from databases where page_id = ${id})`)[0]?.values ?? {}), { timeout: 10_000 }).toContain("doing");
  await expectNoHorizontalOverflow(page);
  await page.reload(); await expect(page.getByRole("button", { name: "Open E2E short row" })).toBeVisible(); await expect(page.locator("main").getByText("In progress", { exact: true }).first(), "the card shows the new value after a reload").toBeVisible();
  // the full grid is still reachable and scrolls inside itself
  await page.getByRole("button", { name: /View options/ }).click(); await page.getByRole("dialog").getByRole("button", { name: /Grid/ }).click(); await page.getByRole("dialog").getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.locator(".db-scroll table")).toBeVisible(); await expectNoHorizontalOverflow(page);
  expect(await page.locator(".db-scroll").evaluate((el) => ["auto", "scroll"].includes(getComputedStyle(el).overflowX))).toBe(true);
});

test("export: a page as Markdown; the whole workspace only with a fresh passkey; the report says what is inside", async ({ page }, t) => {
  await page.goto("/"); const title = uniq(t, "E2E-export"); const c = await apiCall(page, "POST", "/api/pages", { title, content: docOf(para("exported paragraph")) }); made.push(c.body.id);
  const md = await page.request.get(`/api/export?format=md&pageId=${c.body.id}`); expect(md.status()).toBe(200); const text = await md.text(); expect(text).toContain("exported paragraph"); expect(text).toContain(title);
  await sql`update sessions set verified_at = now() - interval '10 minutes' where revoked_at is null`;
  const stale = await page.request.get("/api/export?format=json"); expect(stale.status(), "whole-workspace export needs a fresh passkey").toBe(403); expect((await stale.json()).code).toBe("reauth_required");
  await sql`update sessions set verified_at = now() where revoked_at is null`;
  const full = await page.request.get("/api/export?format=json&versions=0"); expect(full.status()).toBe(200); const j = await full.json();
  expect(j.report, "the export carries its own report").toBeTruthy(); expect(j.pages.some((p: any) => p.id === c.body.id)).toBe(true);
  const [a] = await sql`select action from audit_logs where action like 'export%' order by created_at desc limit 1`; expect(a?.action).toBeTruthy();
  await page.goto("/settings#data"); await expect(page.getByText("Workspace ZIP")).toBeVisible(); await expectNoHorizontalOverflow(page);
});

test("an agent proposal is reviewed on the phone: preview, approve, the change is applied, undo restores", async ({ page }, t) => {
  await page.goto("/"); const title = uniq(t, "E2E-agent"); const c = await apiCall(page, "POST", "/api/pages", { title, content: docOf(para("page to tag")) }); made.push(c.body.id);
  const [ws] = await sql`select id from workspaces limit 1`; const now = new Date().toISOString();
  const proposal = { idx: 0, tool: "propose_tags", kind: "tags", rationale: "Looks like an end-to-end test page.", title: `Tag “${title}”`, destructive: false, status: "proposed", pageId: c.body.id, before: { label: "Tags now", lines: ["(none)"] }, after: { label: "Tags after", lines: ["#e2e-agent-tag"] }, at: now, payload: { pageId: c.body.id, add: ["e2e-agent-tag"] } };
  const [ex] = await sql`insert into ai_executions (workspace_id, agent, task, model, status, scopes, proposed_changes, tools_invoked, documents_accessed, outcome, result, started_at, finished_at) values (${ws.id}, 'suggest_tags', 'Suggest tags', 'test-seed', 'awaiting_approval', ${sql.json(["read:page", "propose:tags"])}, ${sql.json([proposal])}, ${sql.json([])}, ${sql.json([c.body.id])}, null, '1 proposal', now(), now()) returning id`; execs.push(ex.id);
  await page.goto("/ai/agents"); await expect(page.getByText("to review").first()).toBeVisible(); await page.getByText("to review").first().click();
  const card = page.getByRole("article", { name: "Proposal 1" }); await expect(card).toBeVisible(); await expect(card).toContainText("#e2e-agent-tag"); await expect(card).toContainText("Looks like an end-to-end test page."); await expectNoHorizontalOverflow(page);
  expect((await sql`select count(*)::int as n from page_tags where page_id = ${c.body.id}`)[0].n, "nothing is written before approval").toBe(0);
  await card.getByRole("button", { name: "Approve" }).click(); await expect(card.getByRole("button", { name: "Undo" })).toBeVisible({ timeout: 10_000 });
  expect((await sql`select t.name from page_tags pt join tags t on t.id = pt.tag_id where pt.page_id = ${c.body.id}`).map((r) => r.name)).toEqual(["e2e-agent-tag"]);
  await card.getByRole("button", { name: "Undo" }).click(); await expect(card.getByText(/Undone/)).toBeVisible({ timeout: 10_000 });
  expect((await sql`select count(*)::int as n from page_tags where page_id = ${c.body.id}`)[0].n).toBe(0);
  const acts = (await sql`select action from audit_logs where action like 'agent%' and created_at > now() - interval '1 minute'`).map((r) => r.action); expect(acts.length).toBeGreaterThan(0);
  await sql`delete from tags where name = 'e2e-agent-tag'`;
});
