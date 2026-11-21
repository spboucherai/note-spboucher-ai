/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : tests/e2e/desktop.spec.ts
 * Module           : tests
 * Repository       : https://git.spboucher.ai/note-spboucher-ai
 * Project Website  : https://note.spboucher.ai
 * Created          : 2026-11-17
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

import { test, expect } from "@playwright/test";
import { apiCall, sql, expectNoHorizontalOverflow } from "./helpers";

const made: string[] = [];
test.afterAll(async () => { if (made.length) await sql`delete from pages where id = any(${made}::uuid[])`; });

test("a repeated mutation with the same Idempotency-Key creates one page and replays the answer", async ({ page }) => {
  await page.goto("/"); const key = `e2e-${Date.now()}-abcdef`; const title = `E2E-idem ${key}`;
  const a = await apiCall(page, "POST", "/api/pages", { title }, { "idempotency-key": key }); const b = await apiCall(page, "POST", "/api/pages", { title }, { "idempotency-key": key });
  expect(a.status).toBe(201); expect(b.status).toBe(201); expect(b.body.id).toBe(a.body.id); expect(b.headers["idempotent-replay"]).toBe("true"); made.push(a.body.id);
  expect((await sql`select count(*)::int as n from pages where title = ${title}`)[0].n).toBe(1);
  // five parallel sends of one capture (a retry storm after a timeout): still one note
  const k2 = `e2e-${Date.now()}-storm1`; const t2 = `E2E-storm ${k2}`;
  const rs = await Promise.all(Array.from({ length: 5 }, () => apiCall(page, "POST", "/api/capture", { kind: "note", text: t2 }, { "idempotency-key": k2 })));
  expect(rs.every((r) => r.status === 201 || (r.status === 409 && r.body.code === "in_progress"))).toBe(true);
  const rows = await sql`select id from pages where title = ${t2}`; expect(rows.length).toBe(1); made.push(rows[0].id);
  // the key cannot be reused for another request, and a malformed key is refused
  expect((await apiCall(page, "POST", "/api/capture", { kind: "note", text: "x" }, { "idempotency-key": key })).status).toBe(422);
  expect((await apiCall(page, "POST", "/api/pages", { title: "x" }, { "idempotency-key": "bad key!" })).status).toBe(400);
});
test("responses carry a request id and are never cacheable; mutations need our origin", async ({ page }) => {
  await page.goto("/"); const r = await apiCall(page, "GET", "/api/tree"); expect(r.headers["x-request-id"]).toMatch(/^[A-Za-z0-9_-]{8,64}$/); expect(r.headers["cache-control"]).toContain("no-store");
  const html = await page.request.get("/"); expect(html.headers()["cache-control"]).toContain("no-store");
  const cross = await page.request.post("/api/pages", { data: { title: "csrf" }, headers: { origin: "https://evil.example" } }); expect(cross.status()).toBe(403);
  const none = await page.request.fetch("/api/pages", { method: "POST", data: { title: "csrf" }, headers: { origin: "" } }); expect([403]).toContain(none.status());
  expect((await sql`select count(*)::int as n from pages where title = 'csrf'`)[0].n).toBe(0);
  const bad = await apiCall(page, "POST", "/api/pages", { title: "bad doc", content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "x", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] }] }] } }); expect(bad.status).toBe(400);
});
test("the service worker caches the app shell only — no API, no page HTML", async ({ page }) => {
  await page.goto("/"); await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.goto("/search"); await page.goto("/inbox"); await page.waitForTimeout(800);
  const urls: string[] = await page.evaluate(async () => { const out: string[] = []; for (const k of await caches.keys()) for (const r of await (await caches.open(k)).keys()) out.push(new URL(r.url).pathname); return out; });
  expect(urls.length).toBeGreaterThan(3); expect(urls).toContain("/offline");
  for (const u of urls) expect(u.startsWith("/_next/static/") || u.startsWith("/icons/") || u === "/offline" || u === "/manifest.webmanifest", `unexpected cached URL ${u}`).toBe(true);
});
test("desktop layout still works: sidebar, capture to inbox, settings sections", async ({ page }) => {
  await page.goto("/"); await expect(page.getByRole("navigation", { name: "Workspace" })).toBeVisible(); await expect(page.getByRole("navigation", { name: "Primary" })).toBeHidden();
  const t = `E2E-desk ${Date.now()}`; await page.getByRole("navigation", { name: "Workspace" }).getByLabel("Quick capture").fill(t); await page.keyboard.press("Enter"); await expect(page.getByText("Captured to inbox")).toBeVisible();
  await page.getByRole("navigation", { name: "Workspace" }).getByRole("link", { name: "Inbox" }).click(); await expect(page.getByRole("main").getByText(t)).toBeVisible(); // in the inbox list (the sidebar tree may list the capture too)
  const [row] = await sql`select id from pages where title = ${t}`; made.push(row.id);
  await page.goto("/settings"); for (const name of ["Security", "Appearance", "Data & backups", "AI & costs", "Indexing", "Jobs", "Tasks", "Profile", "About"]) { await page.getByRole("tab", { name }).click(); await expect(page.locator("main")).not.toContainText(/couldn.t load/i); }
  await page.getByRole("tab", { name: "Jobs" }).click(); await expect(page.getByText(/Worker running/)).toBeVisible(); await expectNoHorizontalOverflow(page);
});
