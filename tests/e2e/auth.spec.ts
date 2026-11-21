/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : tests/e2e/auth.spec.ts
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
import fs from "node:fs";
import { cli, enrollmentToken, sql, STATE, virtualAuthenticator, withSavedPasskey, saveState, expectNoHorizontalOverflow, ORIGIN } from "./helpers";

const saved = () => JSON.parse(fs.readFileSync(STATE, "utf8"));
test.describe.configure({ mode: "serial" });

test("nothing private is reachable without a session", async ({ page, request }) => {
  await page.goto("/"); await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "Private space" })).toBeVisible();
  const html = await page.content(); expect(html).not.toMatch(/Workspace|sidebar|note-editor/i);
  await page.goto("/p/00000000-0000-0000-0000-000000000000"); await expect(page).toHaveURL(/\/login\?next=/);
  for (const u of ["/api/tree", "/api/pages", "/api/search?q=a", "/api/settings", "/api/auth/passkeys", "/api/auth/sessions", "/api/auth/state", "/api/export?format=json", "/api/files/00000000-0000-0000-0000-000000000000", "/api/backups", "/api/dashboard"]) expect((await request.get(u)).status(), u).toBe(401);
  for (const u of ["/gate", "/unlock/abcdefgh", "/api/gate", "/api/lock"]) expect((await request.get(u)).status(), u).toBe(404);
  expect((await request.get("/api/health")).status()).toBe(200);
  await expectNoHorizontalOverflow(page);
});
test("every API route refuses anonymous reads and writes", async ({ request }) => {
  const routes: string[] = []; const walk = (d: string) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (e.isDirectory()) walk(`${d}/${e.name}`); else if (e.name === "route.ts") routes.push(d.replace("src/app", "").replace(/\[[^\]]+\]/g, "00000000-0000-0000-0000-000000000000")); } }; walk("src/app/api");
  const open = new Set(["/api/health", "/api/auth/login/options", "/api/auth/login/verify", "/api/auth/enroll/options", "/api/auth/enroll/verify", "/api/auth/logout"]);
  expect(routes.length).toBeGreaterThan(50);
  for (const r of routes.filter((r) => !open.has(r))) {
    const g = await request.get(r); expect([401], `GET ${r} → ${g.status()}`).toContain(g.status());
    const p = await request.post(r, { data: {}, headers: { origin: ORIGIN } }); expect([401], `POST ${r} → ${p.status()}`).toContain(p.status());
  }
});
test("ceremony endpoints refuse cross-site callers and unknown tokens", async ({ request }) => {
  expect((await request.post("/api/auth/login/options", { headers: { origin: "https://evil.example" } })).status()).toBe(403);
  expect((await request.post("/api/auth/login/options", { headers: { origin: ORIGIN, "sec-fetch-site": "cross-site" } })).status()).toBe(403);
  const r = await request.post("/api/auth/enroll/options", { headers: { origin: ORIGIN }, data: { token: "A".repeat(43) } }); expect(r.status()).toBe(403); expect((await r.json()).code).toBe("enrollment_closed");
  // a forged assertion (well-formed, unknown credential) is refused, burns its challenge and is audited
  const ctx = await request.post("/api/auth/login/options", { headers: { origin: ORIGIN } }); expect(ctx.status()).toBe(200);
  const forged = { id: "Zm9yZ2VkLWNyZWRlbnRpYWwtaWQ", rawId: "Zm9yZ2VkLWNyZWRlbnRpYWwtaWQ", type: "public-key", response: { clientDataJSON: "e30", authenticatorData: "AAAA", signature: "AAAA" }, clientExtensionResults: {} };
  const v = await request.post("/api/auth/login/verify", { headers: { origin: ORIGIN }, data: { response: forged } }); expect(v.status()).toBe(400); expect((await v.json()).code).toBe("unknown_credential");
  const v2 = await request.post("/api/auth/login/verify", { headers: { origin: ORIGIN }, data: { response: forged } }); expect((await v2.json()).code).toBe("challenge_used");
  const bad = await request.post("/api/auth/login/verify", { headers: { origin: ORIGIN }, data: { response: { id: "x" } } }); expect(bad.status()).toBe(400);
  expect((v.headers()["set-cookie"] ?? "")).not.toContain("note_session");
  await sql`delete from login_attempts`;
});
test("first-passkey window is closed for good once a passkey exists", async ({ page }) => {
  let out = ""; try { out = cli("open-enrollment"); } catch (e: any) { out = String(e.stderr ?? e.message); }
  expect(out).toMatch(/already exists/);
  await page.goto("/enroll#" + "B".repeat(43)); await expect(page.getByRole("heading", { name: "Link closed" })).toBeVisible();
  expect(page.url()).not.toContain("#"); // the token is removed from the address bar
});
test("sign in with the passkey, then lock this device", async ({ page, context }) => {
  await withSavedPasskey(page);
  await page.goto("/settings"); await expect(page).toHaveURL(/\/login\?next=%2Fsettings/);
  await page.getByRole("button", { name: /Continue with/ }).click();
  await expect(page).toHaveURL(/\/settings$/);
  const cookies = await context.cookies(); const c = cookies.find((x) => x.name.endsWith("note_session"))!;
  expect(c.httpOnly).toBe(true); expect(c.sameSite).toBe("Lax"); expect(c.value).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(c.expires - Date.now() / 1000).toBeLessThan(91 * 86400);
  const [row] = await sql`select token_hash from sessions where revoked_at is null order by created_at desc limit 1`; expect(row.token_hash).not.toBe(c.value); expect(row.token_hash).toHaveLength(64);
  await page.goto("/settings#security"); await page.getByRole("button", { name: /^Lock$/ }).click(); await page.getByRole("dialog").getByRole("button", { name: "Lock" }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect((await page.request.get("/api/tree")).status()).toBe(401);
  // the revoked token is dead even if replayed by hand
  expect((await page.request.get("/api/tree", { headers: { cookie: `${c.name}=${c.value}` } })).status()).toBe(401);
});
test("a passkey prompt without user verification is refused", async ({ page }) => {
  const a = await virtualAuthenticator(page, { userVerified: false });
  await a.cdp.send("WebAuthn.addCredential", { authenticatorId: a.id, credential: { ...JSON.parse(fs.readFileSync("test-results/.auth/credential.json", "utf8")), signCount: Math.floor((Date.now() - 1_794_000_000_000) / 10) } });
  await page.goto("/login"); await page.getByRole("button", { name: /Continue with/ }).click();
  await expect(page.getByText(/could not be verified|Cancelled\. Tap the button/i)).toBeVisible(); // the browser itself refuses: verification is required and was not performed
  await expect(page).toHaveURL(/\/login/);
  expect((await page.request.get("/api/tree")).status()).toBe(401);
  await sql`delete from login_attempts`;
});
test("sensitive actions need a fresh passkey: add, rename, remove; the last passkey cannot be removed", async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: saved(), viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }); const page = await ctx.newPage(); const va = await withSavedPasskey(page);
  await sql`update sessions set verified_at = now() - interval '10 minutes' where revoked_at is null`;
  const stale = await page.request.post("/api/auth/passkeys/options", { headers: { origin: ORIGIN } }); expect(stale.status()).toBe(403); expect((await stale.json()).code).toBe("reauth_required");
  const [cur] = await sql`select id from webauthn_credentials`;
  const only = await page.request.delete(`/api/auth/passkeys/${cur.id}`, { headers: { origin: ORIGIN } }); expect(only.status(), "stale session cannot delete").toBe(403);
  await page.goto("/settings#security");
  const pk = page.locator("#sec-passkeys"); await expect(pk.getByText("E2E phone", { exact: true })).toBeVisible(); await expect(page.getByRole("button", { name: "Remove E2E phone" })).toBeDisabled();
  const before = saved().cookies.find((x: any) => x.name.endsWith("note_session")).value;
  // the same authenticator already holds a passkey: the browser refuses a duplicate and the UI says so
  await page.getByRole("button", { name: "Add a passkey" }).click(); await page.getByRole("dialog").getByLabel("Name").fill("Dup"); await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText(/already holds a passkey/)).toBeVisible();
  const after = (await ctx.cookies()).find((x) => x.name.endsWith("note_session"))!.value; expect(after, "step-up rotates the session token").not.toBe(before);
  expect((await page.request.get("/api/auth/state").then((r) => r.json())).fresh).toBe(true);
  // "second device": an authenticator that does not hold the first passkey
  await va.cdp.send("WebAuthn.clearCredentials", { authenticatorId: va.id });
  await page.getByRole("dialog").getByLabel("Name").fill("Second key"); await page.getByRole("button", { name: "Continue" }).click();
  await expect(pk.getByText("Second key", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Rename Second key" }).click(); await page.getByLabel("Passkey name").fill("Spare key"); await page.getByRole("button", { name: "Save" }).click();
  await expect(pk.getByText("Spare key", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Remove Spare key" }).click(); await page.getByRole("dialog").getByRole("button", { name: "Remove passkey" }).click();
  await expect(pk.getByText("Spare key", { exact: true })).toHaveCount(0);
  const [{ n }] = await sql`select count(*)::int as n from webauthn_credentials`; expect(n).toBe(1);
  // with a fresh verification the server still refuses to delete the only passkey
  const [c] = await sql`select id from webauthn_credentials`; const last = await page.request.delete(`/api/auth/passkeys/${c.id}`, { headers: { origin: ORIGIN } }); expect(last.status()).toBe(409); expect((await last.json()).code).toBe("last_passkey");
  await saveState(ctx); await expectNoHorizontalOverflow(page); await ctx.close();
});
test("another device can be signed out; global revocation ends every session", async ({ browser }) => {
  const a = await browser.newContext({ storageState: saved() }); const pa = await a.newPage(); await withSavedPasskey(pa);
  const b = await browser.newContext(); const pb = await b.newPage(); await withSavedPasskey(pb);
  await pb.goto("/login"); await pb.getByRole("button", { name: /Continue with/ }).click(); await expect(pb).toHaveURL(/localhost:\d+\/$/);
  await pa.goto("/settings#security"); await expect(pa.locator("#sec-sessions").getByText("this device", { exact: true })).toBeVisible();
  await pa.getByRole("button", { name: "Others" }).click(); await pa.getByRole("dialog").getByRole("button", { name: "Sign out" }).click();
  await expect(pa.getByText(/\d+ sessions? ended/).first()).toBeVisible();
  expect((await pb.request.get("/api/tree")).status(), "other device is out").toBe(401); expect((await pa.request.get("/api/tree")).status()).toBe(200);
  await saveState(a); await a.close(); await b.close();
});
test("recovery: a CLI window replaces every passkey and signs every device out", async ({ browser }) => {
  const old = await browser.newContext({ storageState: saved() }); const po = await old.newPage(); expect((await po.request.get("/api/tree")).status()).toBe(200);
  const token = enrollmentToken(cli("recover", "5"));
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }); const page = await ctx.newPage(); const va = await virtualAuthenticator(page);
  await page.goto(`/enroll#${token}`); await expect(page.getByText(/every previous passkey is deleted/)).toBeVisible();
  await page.getByLabel("Name of this device").fill("E2E phone"); await page.getByRole("button", { name: /Create passkey/ }).click(); await page.getByText("Passkey registered").waitFor(); await page.waitForURL(/\/settings/);
  expect((await po.request.get("/api/tree")).status(), "old session revoked by recovery").toBe(401);
  const rows = await sql`select label from webauthn_credentials`; expect(rows.length).toBe(1);
  const again = await page.request.post("/api/auth/enroll/options", { headers: { origin: ORIGIN }, data: { token } }); expect(again.status(), "window is single use").toBe(403);
  const { credentials } = await va.cdp.send("WebAuthn.getCredentials", { authenticatorId: va.id }); fs.writeFileSync("test-results/.auth/credential.json", JSON.stringify(credentials[0]), { mode: 0o600 });
  await saveState(ctx); await ctx.close(); await old.close(); await sql`delete from login_attempts`;
});
test("audit trail records the security events", async () => {
  const rows = await sql`select distinct action from audit_logs where action like 'auth.%' and created_at > now() - interval '10 minutes'`;
  const got = rows.map((r) => r.action);
  for (const a of ["auth.enrollment_opened", "auth.passkey_bootstrap", "auth.login", "auth.logout", "auth.step_up", "auth.passkey_added", "auth.passkey_renamed", "auth.passkey_revoked", "auth.sessions_revoked_all", "auth.recovery_completed", "auth.login_failed"]) expect(got, a).toContain(a);
});
test.afterAll(async () => { await sql.end(); });
