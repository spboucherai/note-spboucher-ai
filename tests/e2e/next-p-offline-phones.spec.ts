/**
 * file: tests/e2e/next-p-offline-phones.spec.ts
 * description: web offline-first on phone viewports (360 / 375 / 430): the offline app opens from the service-worker shell, lists the
 *   notes kept on the device, opens one in the editor, creates a note and a task, with no horizontal overflow and a reachable sync
 *   inspector. Production build, real offline (context.setOffline).
 * author: Simon-Pierre Boucher — contact@spboucher.ai
 */
import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import { apiCall, docOf, para, sql, expectNoHorizontalOverflow } from "./helpers";

const SHOTS = process.env.SHOTS_DIR ?? `${process.env.HOME}/dev/note-next-p-data/shots`;
const waitFor = async <T,>(fn: () => Promise<T | null | undefined | false>, ms = 20_000): Promise<T> => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error("condition not met in time"); await new Promise((r) => setTimeout(r, 300)); } };
const ids = (page: Page, name: string) => page.evaluate((n) => new Promise<string[]>((resolve) => { const r = indexedDB.open("note-local"); r.onsuccess = () => { const d = r.result; if (!d.objectStoreNames.contains(n)) { d.close(); return resolve([]); } const g = d.transaction(n, "readonly").objectStore(n).getAll(); g.onsuccess = () => { d.close(); resolve(g.result.map((x: any) => x.id ?? x.pageId ?? String(x.seq))); }; }; r.onerror = () => resolve([]); }), name);
test.afterAll(async () => { await sql`delete from tasks where title like ${"E2E-offphone %"}`; await sql`delete from pages where title like ${"E2E-offphone %"}`; });

test("phone: the offline app lists, opens, creates and stays inside the viewport", async ({ page, context }, info) => {
  test.setTimeout(150_000);
  const tag = `${info.project.name} ${Date.now().toString(36)}`; const title = `E2E-offphone ${tag}`;
  await page.goto("/");
  const a = await apiCall(page, "POST", "/api/pages", { title, content: docOf(para("Readable in the metro.")) }); expect(a.status).toBe(201);
  const controlled = () => page.evaluate(() => Boolean(navigator.serviceWorker.controller));
  try { await waitFor(controlled, 15_000); } catch { await page.reload(); await waitFor(controlled, 30_000); }
  await page.evaluate(() => new Promise<void>((resolve) => { const ch = new MessageChannel(); ch.port1.onmessage = () => resolve(); navigator.serviceWorker.controller!.postMessage({ type: "REFRESH_SHELL" }, [ch.port2]); setTimeout(resolve, 15_000); }));
  await page.reload(); await waitFor(async () => (await ids(page, "pages")).includes(a.body.id));
  await context.setOffline(true);
  await page.goto("/"); await expect(page.getByTestId("offline-app")).toBeVisible();
  await expect(page.getByTestId("offline-row").filter({ hasText: title })).toBeVisible(); await expectNoHorizontalOverflow(page);
  fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: `${SHOTS}/offline-phone-home-${info.project.name}.png` });
  await page.getByTestId("offline-row").filter({ hasText: title }).click();
  await expect(page.locator("[data-testid=offline-page] .ProseMirror").first()).toContainText("Readable in the metro."); await expectNoHorizontalOverflow(page);
  await page.getByRole("button", { name: "New note" }).first().click();
  await expect(page.locator(`[data-testid=offline-page]:not([data-page-id="${a.body.id}"])`)).toBeVisible();
  await page.getByLabel("Page title").fill(`E2E-offphone new ${tag}`);
  await page.getByLabel("New task for this note").fill(`E2E-offphone task ${tag}`); await page.getByRole("button", { name: "Add task" }).click();
  await expect(page.getByTestId("offline-page-task")).toHaveText(`E2E-offphone task ${tag}`); await expectNoHorizontalOverflow(page);
  await page.getByTestId("sync-status").click(); await expect(page.getByTestId("sync-inspector")).toBeVisible(); await expect(page.getByTestId("sync-entry")).toHaveCount(2); await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: `${SHOTS}/offline-phone-inspector-${info.project.name}.png` }); await page.keyboard.press("Escape");
  await page.getByRole("navigation", { name: "Offline navigation" }).last().getByRole("button", { name: "Tasks" }).click();
  await expect(page.getByTestId("offline-task").filter({ hasText: `E2E-offphone task ${tag}` })).toBeVisible(); await expectNoHorizontalOverflow(page);
  await context.setOffline(false);
  await expect(page.getByTestId("offline-app")).toBeHidden({ timeout: 45_000 });
  await waitFor(async () => (await sql`select 1 from pages where title = ${`E2E-offphone new ${tag}`}`).length === 1);
  await waitFor(async () => (await sql`select 1 from tasks where title = ${`E2E-offphone task ${tag}`}`).length === 1);
});
