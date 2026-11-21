/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : tests/e2e/global-setup.ts
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

import fs from "node:fs";
import { chromium } from "@playwright/test";
import { AUTH_DIR, cli, enrollmentToken, saveCredential, saveState, sql, virtualAuthenticator } from "./helpers";

/**
 * Start from a known access state on the TEST database: no passkey, no session, no window. Then perform the real first-enrollment
 * journey once (CLI window → /enroll → virtual authenticator) and keep the resulting session + passkey for the other specs.
 */
export default async function globalSetup() {
  process.env.E2E_STARTED = String(Date.now() - 2000); // read by global-teardown.ts
  const base = process.env.E2E_BASE_URL ?? "http://localhost:8481";
  await sql`delete from webauthn_credentials`; await sql`update sessions set revoked_at = now(), revoked_reason = 'e2e-reset' where revoked_at is null`;
  await sql`delete from login_attempts`; await sql`delete from webauthn_challenges`; await sql`update auth_enrollments set closed_reason = 'e2e-reset' where consumed_at is null and closed_reason is null`;
  fs.rmSync(AUTH_DIR, { recursive: true, force: true });
  const token = enrollmentToken(cli("open-enrollment", "5"));
  const browser = await chromium.launch(); const ctx = await browser.newContext({ baseURL: base, viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage(); const a = await virtualAuthenticator(page);
  await page.goto(`/enroll#${token}`);
  await page.getByLabel("Name of this device").fill("E2E phone");
  await page.getByRole("button", { name: /Create passkey/ }).click();
  await page.getByText("Passkey registered").waitFor();
  await page.waitForURL(/\/settings/);
  await saveCredential(a.cdp, a.id); await saveState(ctx);
  await browser.close(); await sql.end();
}
