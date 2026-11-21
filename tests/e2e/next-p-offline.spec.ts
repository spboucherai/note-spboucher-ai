/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : tests/e2e/next-p-offline.spec.ts
 * Description      : SP Note Next Generation, productivity workstream — web
 *                    offline-first (SPEC §10). A real production build with its
 *                    service worker, a real browser taken offline with
 *                    context.setOffline: open a synced note, edit it, create a
 *                    note with a task, close and reopen the tab still offline,
 *                    come back online → the server has everything exactly once
 *                    and a second browser context sees it; an edit made offline
 *                    while another session changed the note → the conflict
 *                    screen, both versions kept; an image added offline is
 *                    queued and uploaded later; integrity check; the HTTP cache
 *                    holds nothing private; the lock wipes the device copy.
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

import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import fs from "node:fs";
import { apiCall, docOf, para, sql, STATE, PNG, withSavedPasskey } from "./helpers";

const SHOTS = process.env.SHOTS_DIR ?? `${process.env.HOME}/dev/note-next-p-data/shots`;
const shot = async (page: Page, name: string) => { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: `${SHOTS}/${name}.png` }); };
const stamp = Date.now().toString(36);
const T = (s: string) => `E2E-offline ${s} ${stamp}`;
const text = (n: any): string => (!n ? "" : typeof n.text === "string" ? n.text : (n.content ?? []).map(text).join(" "));
const waitFor = async <T,>(fn: () => Promise<T | null | undefined | false>, ms = 20_000): Promise<T> => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error("condition not met in time"); await new Promise((r) => setTimeout(r, 300)); } };
/** Read one IndexedDB store of the device database from the page. */
const store = (page: Page, name: string) => page.evaluate((n) => new Promise<any[]>((resolve, reject) => { const r = indexedDB.open("note-local"); r.onerror = () => reject(r.error); r.onsuccess = () => { const d = r.result; if (!d.objectStoreNames.contains(n)) { d.close(); return resolve([]); } const g = d.transaction(n, "readonly").objectStore(n).getAll(); g.onsuccess = () => { d.close(); resolve(g.result.map((x: any) => ({ ...x, file: undefined }))); }; g.onerror = () => { d.close(); reject(g.error); }; }; }), name);
/** The app is ready for offline use: service worker in control, shell + its assets cached, replica holding the given pages. */
async function readyForOffline(page: Page, ids: string[]) {
  await page.goto("/");
  // the worker installs (pre-caches the shell), activates and claims the page; a page loaded before the claim is reloaded once
  const controlled = () => page.evaluate(() => Boolean(navigator.serviceWorker.controller));
  try { await waitFor(controlled, 15_000); } catch { const diag = await page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); return r ? { installing: r.installing?.state, waiting: r.waiting?.state, active: r.active?.state } : "no registration"; }); console.log("service worker not in control yet:", JSON.stringify(diag)); await page.reload(); await waitFor(controlled, 30_000); }
  await waitFor(() => page.evaluate(async () => Boolean(await caches.match("/offline"))));
  // ask for the shell of this build again and wait for the answer, so every asset of the offline app is in the cache
  await page.evaluate(() => new Promise<void>((resolve) => { const ch = new MessageChannel(); ch.port1.onmessage = () => resolve(); navigator.serviceWorker.controller!.postMessage({ type: "REFRESH_SHELL" }, [ch.port2]); setTimeout(resolve, 15_000); }));
  await page.reload(); // a sync runs at every start of the shell
  await waitFor(async () => { const have = new Set((await store(page, "pages")).map((p) => p.id)); return ids.every((i) => have.has(i)); });
}
const offEditor = (page: Page) => page.locator("[data-testid=offline-page] .ProseMirror").first();
const serverPage = async (page: Page, id: string) => (await apiCall(page, "GET", `/api/pages/${id}`)).body;
const made: string[] = [];
test.describe.configure({ mode: "serial" });
test.afterAll(async () => { await sql`delete from tasks where title like ${"E2E-offline %"}`; await sql`delete from pages where title like ${"E2E-offline %"} or id = any(${made}::uuid[])`; });

test("offline: open a synced note, edit it, create a note with a task, reopen the tab offline, sync once on reconnect; a second context sees it", async ({ page, context, browser }) => {
  test.setTimeout(180_000);
  await page.goto("/");
  const a = await apiCall(page, "POST", "/api/pages", { title: T("synced"), content: docOf(para("Written online before the tunnel.")) }); expect(a.status).toBe(201); made.push(a.body.id);
  await readyForOffline(page, [a.body.id]);
  await expect(page.getByTestId("sync-status").first()).toHaveAttribute("data-state", "synced");

  await context.setOffline(true);
  await page.goto(`/p/${a.body.id}`); // a real navigation with no network: the service worker answers with the app shell
  await expect(page.getByTestId("offline-app")).toBeVisible(); await expect(page.getByTestId("offline-banner")).toContainText("Offline");
  await expect(offEditor(page)).toContainText("Written online before the tunnel.");
  await offEditor(page).click(); await page.keyboard.press("ControlOrMeta+End"); await page.keyboard.type(" Edited in the tunnel.");
  await expect(page.getByTestId("offline-page-status")).toContainText(/Kept on this device/);
  await waitFor(async () => (await store(page, "drafts")).some((d) => d.pageId === a.body.id && text(d.patch.content).includes("Edited in the tunnel.")));

  // a new note, created under a client id, with text and a task
  await page.getByRole("navigation", { name: "Offline navigation" }).first().getByRole("button", { name: "New note" }).click();
  await expect(page).not.toHaveURL(new RegExp(a.body.id)); await expect(page).toHaveURL(/\/p\/[0-9a-f-]{36}$/); const newId = page.url().split("/p/")[1]; made.push(newId);
  await expect(page.locator(`[data-testid=offline-page][data-page-id="${newId}"]`)).toBeVisible();
  await page.getByLabel("Page title").fill(T("created"));
  await offEditor(page).click(); await page.keyboard.type("Born without a network.");
  await page.getByLabel("New task for this note").fill(T("task")); await page.getByRole("button", { name: "Add task" }).click();
  await expect(page.getByTestId("offline-page-task")).toHaveText(T("task"));
  await waitFor(async () => (await store(page, "drafts")).some((d) => d.pageId === newId && text(d.patch.content).includes("Born without a network.") && d.patch.title === T("created")));
  const journal = await store(page, "journal"); expect(journal.map((e) => e.kind)).toEqual(["page.create", "task.create"]); expect(journal[0].entityId).toBe(newId);
  await page.getByTestId("sync-status").click(); await expect(page.getByTestId("sync-inspector")).toBeVisible();
  await expect(page.getByTestId("sync-online")).toHaveText("Offline"); await expect(page.getByTestId("sync-entry")).toHaveCount(2); await expect(page.getByTestId("sync-draft")).toHaveCount(2);
  await shot(page, "offline-01-inspector-waiting"); await page.keyboard.press("Escape");
  await shot(page, "offline-02-new-note-offline");

  // close the tab, open another one, still offline: everything is there
  await page.close(); const p2 = await context.newPage();
  await p2.goto("/"); await expect(p2.getByTestId("offline-app")).toBeVisible();
  await expect(p2.getByTestId("offline-row").filter({ hasText: T("created") })).toBeVisible(); await shot(p2, "offline-03-home-offline");
  await p2.getByTestId("offline-row").filter({ hasText: T("created") }).click();
  await expect(offEditor(p2)).toContainText("Born without a network."); await expect(p2.getByLabel("Page title")).toHaveValue(T("created")); await expect(p2.getByTestId("offline-page-task")).toHaveText(T("task"));
  await p2.goto(`/p/${a.body.id}`); await expect(offEditor(p2)).toContainText("Written online before the tunnel. Edited in the tunnel.");
  await p2.goto("/tasks"); await expect(p2.getByTestId("offline-task").filter({ hasText: T("task") })).toBeVisible();
  expect((await apiCall(p2, "GET", `/api/pages/${newId}`).catch(() => ({ status: 0 }))).status, "the server knows nothing yet").not.toBe(200);

  // back online: the journal and the drafts are sent, then the full app takes over at the same address
  await context.setOffline(false);
  await expect(p2.getByTestId("offline-app")).toBeHidden({ timeout: 45_000 });
  await waitFor(async () => text((await serverPage(p2, a.body.id)).content).includes("Edited in the tunnel."));
  const created = await waitFor(async () => { const r = await serverPage(p2, newId); return r?.title === T("created") && text(r.content).includes("Born without a network.") ? r : null; });
  expect(created.version).toBeGreaterThan(1);
  const [{ n: pagesN }] = await sql`select count(*)::int as n from pages where title = ${T("created")}`; expect(pagesN, "exactly one page").toBe(1);
  const tasks = await sql`select id, page_id, status from tasks where title = ${T("task")} and deleted_at is null`; expect(tasks.length, "exactly one task").toBe(1); expect(tasks[0].page_id).toBe(newId);
  await waitFor(async () => (await store(p2, "journal")).length === 0 && (await store(p2, "drafts")).length === 0);
  await expect(p2.getByTestId("sync-status").first()).toHaveAttribute("data-state", "synced", { timeout: 20_000 });
  await p2.getByTestId("sync-status").first().click(); await expect(p2.getByTestId("sync-empty")).toBeVisible(); await shot(p2, "offline-04-inspector-synced"); await p2.keyboard.press("Escape");

  // a second browser context (another device) sees it
  const other: BrowserContext = await browser.newContext({ storageState: JSON.parse(fs.readFileSync(STATE, "utf8")), viewport: { width: 1280, height: 800 } }); const po = await other.newPage();
  await po.goto(`/p/${newId}`); await expect(po.locator("#main-scroll .ProseMirror").first()).toContainText("Born without a network."); await expect(po.getByLabel("Page title")).toHaveValue(T("created"));
  await po.goto(`/p/${a.body.id}`); await expect(po.locator("#main-scroll .ProseMirror").first()).toContainText("Edited in the tunnel.");
  await other.close(); await p2.close();
});

test("the network drops while the full app is open: a new page and a pin are journaled, the offline app takes over, one page on the server afterwards", async ({ page, context }) => {
  test.setTimeout(150_000);
  await page.goto("/");
  const a = await apiCall(page, "POST", "/api/pages", { title: T("live"), content: docOf(para("Open when the network dropped.")) }); made.push(a.body.id);
  await readyForOffline(page, [a.body.id]);
  await page.goto(`/p/${a.body.id}`); await expect(page.locator("#main-scroll .ProseMirror").first()).toContainText("Open when the network dropped.");
  await context.setOffline(true);
  await expect(page.getByTestId("sync-status").first()).toHaveAttribute("data-state", "offline");
  await page.getByRole("button", { name: "New page", exact: true }).first().click(); // top bar: goes through the journal, then the router falls back to a real navigation
  await expect(page.getByTestId("offline-app")).toBeVisible({ timeout: 30_000 }); await expect(page).not.toHaveURL(new RegExp(a.body.id));
  const newId = page.url().split("/p/")[1]; made.push(newId); expect(newId).toMatch(/^[0-9a-f-]{36}$/);
  await expect(page.locator(`[data-testid=offline-page][data-page-id="${newId}"]`)).toBeVisible();
  await page.getByLabel("Page title").fill(T("dropped")); await page.getByRole("button", { name: "Pin" }).click(); await expect(page.getByRole("button", { name: "Pinned" })).toBeVisible();
  await waitFor(async () => { const j = await store(page, "journal"); return j.length === 2 && j[0].kind === "page.create" && j[1].kind === "page.update" && j[1].body.pinned === true; });
  await context.setOffline(false);
  await expect(page.getByTestId("offline-app")).toBeHidden({ timeout: 45_000 });
  const rows = await waitFor(async () => { const r = await sql`select id, pinned, version from pages where title = ${T("dropped")}`; return r.length ? r : null; });
  expect(rows.length).toBe(1); expect(rows[0].id).toBe(newId); await waitFor(async () => (await sql`select pinned from pages where id = ${newId}`)[0].pinned === true);
  await waitFor(async () => (await store(page, "journal")).length === 0);
});

test("replaying twice cannot duplicate: the same journal entry sent again answers the stored row", async ({ page }) => {
  await page.goto("/");
  const id = crypto.randomUUID(); made.push(id); const key = `e2e-${stamp}-dup`;
  const one = await apiCall(page, "POST", "/api/pages", { id, title: T("idempotent") }, { "idempotency-key": key }); expect(one.status).toBe(201);
  const two = await apiCall(page, "POST", "/api/pages", { id, title: T("idempotent") }, { "idempotency-key": key }); expect([200, 201]).toContain(two.status); expect(two.body.id).toBe(id);
  const tid = crypto.randomUUID();
  for (let i = 0; i < 2; i++) { const r = await apiCall(page, "POST", "/api/tasks", { id: tid, title: T("idempotent task"), pageId: id }); expect([200, 201]).toContain(r.status); expect(r.body.id).toBe(tid); }
  const [{ n }] = await sql`select count(*)::int as n from pages where title = ${T("idempotent")}`; expect(n).toBe(1);
  const [{ n: tn }] = await sql`select count(*)::int as n from tasks where title = ${T("idempotent task")}`; expect(tn).toBe(1);
});

test("offline edit while another session changes the note: conflict screen on reconnect, nothing overwritten, both versions kept", async ({ page, context }) => {
  test.setTimeout(150_000);
  await page.goto("/");
  const a = await apiCall(page, "POST", "/api/pages", { title: T("conflict"), content: docOf(para("Common ancestor.")) }); made.push(a.body.id);
  await readyForOffline(page, [a.body.id]);
  await context.setOffline(true);
  await page.goto(`/p/${a.body.id}`); await expect(page.getByTestId("offline-app")).toBeVisible();
  await offEditor(page).click(); await page.keyboard.press("ControlOrMeta+End"); await page.keyboard.type(" Mine, typed offline.");
  await waitFor(async () => (await store(page, "drafts")).some((d) => d.pageId === a.body.id && text(d.patch.content).includes("Mine, typed offline.")));
  // the "other session": a direct write on the server (the test process is not offline)
  await sql`update pages set content = ${sql.json(docOf(para("Theirs, written elsewhere.")) as any)}, version = version + 1, updated_at = now() where id = ${a.body.id}`;
  await context.setOffline(false);
  await expect(page.getByTestId("offline-app")).toBeHidden({ timeout: 45_000 });
  const banner = page.getByRole("alert").filter({ hasText: "This note was also changed in another session" }); await expect(banner).toBeVisible({ timeout: 20_000 }); await expect(banner).toContainText("Nothing was overwritten");
  await banner.getByRole("button", { name: "Compare" }).click();
  const dialog = page.getByRole("dialog").filter({ hasText: "This device" }); await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("region", { name: "Your version" })).toContainText("Mine, typed offline."); await expect(dialog.getByRole("region", { name: "Other session's version" })).toContainText("Theirs, written elsewhere.");
  await shot(page, "offline-05-conflict");
  expect(text((await serverPage(page, a.body.id)).content), "the server copy was not overwritten").toBe("Theirs, written elsewhere.");
  await dialog.getByRole("button", { name: "Keep both" }).click();
  await expect(dialog).toBeHidden({ timeout: 15_000 });
  const rows = await sql`select title, content::text as plain_text from pages where title like ${T("conflict") + "%"} and deleted_at is null order by created_at`;
  expect(rows.length, "two pages: the note and the conflict copy").toBe(2);
  expect(rows.some((r) => r.plain_text.includes("Theirs, written elsewhere."))).toBe(true); expect(rows.some((r) => r.plain_text.includes("Mine, typed offline."))).toBe(true);
  await waitFor(async () => (await store(page, "drafts")).every((d) => d.pageId !== a.body.id));
});

test("a draft left for a note that is NOT open is replayed in the background; a stale one is recorded as a conflict, never applied", async ({ page }) => {
  await page.goto("/");
  const ok = await apiCall(page, "POST", "/api/pages", { title: T("bg ok"), content: docOf(para("v1")) }); const stale = await apiCall(page, "POST", "/api/pages", { title: T("bg stale"), content: docOf(para("v1")) }); made.push(ok.body.id, stale.body.id);
  await readyForOffline(page, [ok.body.id, stale.body.id]);
  await sql`update pages set content = ${sql.json(docOf(para("changed elsewhere")) as any)}, version = version + 1 where id = ${stale.body.id}`;
  await page.evaluate(([okId, staleId, v1, v2]) => new Promise<void>((resolve, reject) => { const r = indexedDB.open("note-local"); r.onsuccess = () => { const d = r.result; const t = d.transaction("drafts", "readwrite"); const doc = (s: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: s }] }] }); t.objectStore("drafts").put({ pageId: okId, baseVersion: v1, patch: { content: doc("typed before the crash") }, updatedAt: Date.now() }); t.objectStore("drafts").put({ pageId: staleId, baseVersion: v2, patch: { content: doc("mine, stale base") }, updatedAt: Date.now() }); t.oncomplete = () => { d.close(); resolve(); }; t.onerror = () => reject(t.error); }; }), [ok.body.id, stale.body.id, ok.body.version, stale.body.version] as const);
  await page.getByTestId("sync-status").first().click(); await page.getByRole("button", { name: "Sync now" }).click();
  await waitFor(async () => text((await serverPage(page, ok.body.id)).content) === "typed before the crash");
  await expect(page.getByTestId("sync-conflict")).toHaveCount(1); await expect(page.getByTestId("sync-conflict")).toContainText(T("bg stale"));
  expect(text((await serverPage(page, stale.body.id)).content), "stale draft not applied").toBe("changed elsewhere");
  expect((await store(page, "drafts")).map((d) => d.pageId)).toEqual([stale.body.id]);
  await shot(page, "offline-06-inspector-conflict");
  // opening the note shows the existing conflict screen; keeping the other version settles it and clears the record
  await page.getByTestId("sync-conflict").getByRole("link", { name: "Open" }).click();
  const banner = page.getByText("This note was also changed in another session"); await expect(banner).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Keep theirs" }).first().click();
  await waitFor(async () => (await store(page, "drafts")).length === 0);
});

test("an image added offline is kept on the device (bounded), shown from there, then uploaded once under the same id", async ({ page, context }) => {
  test.setTimeout(150_000);
  await page.goto("/");
  const a = await apiCall(page, "POST", "/api/pages", { title: T("image"), content: docOf(para("Before the picture.")) }); made.push(a.body.id);
  await readyForOffline(page, [a.body.id]);
  await context.setOffline(true);
  await page.goto(`/p/${a.body.id}`); await expect(page.getByTestId("offline-app")).toBeVisible();
  await offEditor(page).click(); await page.keyboard.press("ControlOrMeta+End");
  await page.evaluate((b64) => { const bin = atob(b64); const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i); const dt = new DataTransfer(); dt.items.add(new File([bytes], "offline-shot.png", { type: "image/png" })); document.querySelector("[data-testid=offline-page] .ProseMirror")!.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true })); }, PNG.toString("base64"));
  const img = offEditor(page).locator("img").first(); await expect(img).toBeVisible({ timeout: 15_000 });
  const src = await img.getAttribute("src"); expect(src).toMatch(/^\/api\/files\/[0-9a-f-]{36}$/); const attId = src!.split("/").pop()!;
  await waitFor(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)); // served by the service worker from the device queue
  expect((await store(page, "blobs")).map((b) => b.id)).toEqual([attId]); expect((await store(page, "journal")).map((e) => e.kind)).toEqual(["upload"]);
  await page.getByTestId("sync-status").click(); await expect(page.getByTestId("sync-blobs")).toContainText("Limit: 10 MB per image, 100 MB in total"); await shot(page, "offline-07-image-queued"); await page.keyboard.press("Escape");
  await context.setOffline(false);
  await expect(page.getByTestId("offline-app")).toBeHidden({ timeout: 45_000 });
  await waitFor(async () => (await sql`select 1 from attachments where id = ${attId}`).length === 1);
  const file = await page.request.get(`/api/files/${attId}`); expect(file.status()).toBe(200); expect((await file.body()).equals(PNG)).toBe(true);
  await waitFor(async () => JSON.stringify((await serverPage(page, a.body.id)).content).includes(attId));
  expect((await store(page, "blobs")).length).toBe(0);
  const [{ n }] = await sql`select count(*)::int as n from attachments where id = ${attId}`; expect(n).toBe(1);
});

test("integrity check: hashes match the server; a damaged device copy is detected and replaced", async ({ page }) => {
  await page.goto("/");
  const a = await apiCall(page, "POST", "/api/pages", { title: T("integrity"), content: docOf(para("Exact bytes matter.")) }); made.push(a.body.id);
  await readyForOffline(page, [a.body.id]);
  const srv = await apiCall(page, "GET", "/api/sync/integrity"); expect(srv.status).toBe(200); expect(srv.body.algorithm).toBe("sha256-stable-json-1"); expect(srv.body.pages.find((p: any) => p.id === a.body.id).hash).toMatch(/^[0-9a-f]{64}$/);
  await page.getByTestId("sync-status").first().click(); await page.getByRole("button", { name: "Verify integrity" }).click();
  const rep = page.getByTestId("integrity-report"); await expect(rep).toContainText("Integrity verified", { timeout: 30_000 }); await expect(rep).toHaveAttribute("data-ok", "1");
  await shot(page, "offline-08-integrity");
  // damage the device copy (same version, other content)
  await page.evaluate((id) => new Promise<void>((resolve) => { const r = indexedDB.open("note-local"); r.onsuccess = () => { const d = r.result; const s = d.transaction("pages", "readwrite").objectStore("pages"); const g = s.get(id); g.onsuccess = () => { const p = g.result; p.content = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "bit rot" }] }] }; s.put(p).onsuccess = () => { d.close(); resolve(); }; }; }; }), a.body.id);
  await page.getByRole("button", { name: "Verify integrity" }).click();
  await expect(rep).toContainText("Integrity repaired", { timeout: 30_000 }); await expect(rep).toContainText("1 different, 1 replaced by the server copy");
  expect(text((await store(page, "pages")).find((p) => p.id === a.body.id).content)).toBe("Exact bytes matter.");
});

test("privacy: the HTTP cache holds only public build assets; locking the device erases the replica, the journal and the queue", async ({ browser }) => {
  test.setTimeout(120_000);
  // a session of its own (the lock ends it): sign in with the saved passkey
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, storageState: { cookies: [], origins: [] } }); const page = await ctx.newPage(); await withSavedPasskey(page);
  await page.goto("/login"); await page.getByRole("button", { name: /Continue with/ }).click(); await expect(page).toHaveURL(/localhost:\d+\/$/);
  const a = await apiCall(page, "POST", "/api/pages", { title: T("private"), content: docOf(para("PRIVATE-MARKER-7391")) }); made.push(a.body.id);
  await readyForOffline(page, [a.body.id]);
  const cached = await page.evaluate(async () => { const out: { url: string; body: string }[] = []; for (const k of await caches.keys()) { const c = await caches.open(k); for (const req of await c.keys()) { const res = await c.match(req); const ct = res?.headers.get("content-type") ?? ""; out.push({ url: new URL(req.url).pathname, body: /text|json|javascript/.test(ct) ? await res!.text() : "" }); } } return out; });
  expect(cached.length).toBeGreaterThan(5);
  for (const c of cached) { expect(c.url, "only the shell, the manifest, icons and hashed assets").toMatch(/^\/(offline|manifest\.webmanifest|icons\/|_next\/static\/)/); expect(c.body.includes("PRIVATE-MARKER-7391"), `${c.url} holds no note text`).toBe(false); expect(c.body.includes(T("private"))).toBe(false); }
  expect((await store(page, "pages")).length).toBeGreaterThan(0);
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: /Lock this device/ }).first().click();
  await expect(page).toHaveURL(/\/login/, { timeout: 20_000 });
  for (const n of ["pages", "tasks", "attachments", "journal", "blobs", "drafts", "outbox", "meta"]) expect((await store(page, n)).length, `${n} is empty after the lock`).toBe(0);
  // offline now: the shell opens, but there is nothing to show
  await ctx.setOffline(true); await page.goto("/"); await expect(page.getByRole("heading", { name: "You are offline" })).toBeVisible(); await expect(page.getByText("PRIVATE-MARKER-7391")).toHaveCount(0);
  await ctx.close();
});
