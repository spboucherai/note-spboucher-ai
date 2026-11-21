/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : tests/e2e/model-picker.mjs
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

// Manual check of the model selector in a real browser (scratch instance): opens it, searches, navigates with the keyboard, selects.
import { chromium } from "@playwright/test";
import fs from "node:fs";
const token = fs.readFileSync(process.env.HOME + "/dev/note-next-ai-data/.session", "utf8").trim();
const out = process.env.HOME + "/dev/note-next-ai-data/live";
const browser = await chromium.launch();
for (const [name, viewport, scheme] of [["desktop", { width: 1280, height: 800 }, "light"], ["phone", { width: 390, height: 844 }, "dark"]]) {
  const ctx = await browser.newContext({ viewport, colorScheme: scheme, extraHTTPHeaders: { cookie: `__Host-note_session=${token}` } });
  const page = await ctx.newPage(); const errors = []; page.on("pageerror", (e) => errors.push(String(e))); page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto("http://localhost:8484/", { waitUntil: "networkidle" });
  let btn = page.locator('button[aria-label="Model"]').first();
  if (!(await btn.count()) || !(await btn.isVisible().catch(() => false))) { const open = page.locator('button[aria-label*="ssistant" i], button[aria-label*="AI" ]').first(); if (await open.count()) await open.click().catch(() => {}); btn = page.locator('button[aria-label="Model"]').first(); }
  await btn.scrollIntoViewIfNeeded(); const before = (await btn.innerText()).trim();
  await btn.click(); await page.waitForSelector('[role="listbox"]');
  const options = await page.locator('[role="option"]').count(); const groups = await page.locator('[role="group"]').evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
  await page.waitForTimeout(350); await page.screenshot({ path: `${out}/picker-${name}-open.png` });
  await page.keyboard.type("haiku"); await page.waitForTimeout(150);
  const filtered = await page.locator('[role="option"]').evaluateAll((els) => els.map((e) => e.innerText.replace(/\s+/g, " ").trim()));
  const activeId = await page.locator('input[role="combobox"]').getAttribute("aria-activedescendant");
  await page.keyboard.press("ArrowDown"); await page.keyboard.press("ArrowUp"); await page.screenshot({ path: `${out}/picker-${name}-search.png` });
  await page.keyboard.press("Enter"); await page.waitForTimeout(200);
  const after = (await btn.innerText()).replace(/\s+/g, " ").trim(); const closed = (await page.locator('[role="listbox"]').count()) === 0;
  // reopen, show unavailable, Escape closes
  await btn.click(); await page.waitForSelector('[role="listbox"]'); const show = page.getByRole("button", { name: "Show" }); let withUnavailable = null, disabled = null;
  if (await show.count()) { await show.click(); await page.waitForFunction(() => document.querySelectorAll('[role="option"][aria-disabled="true"]').length > 0, null, { timeout: 15000 }).catch(() => {}); withUnavailable = await page.locator('[role="option"]').count(); disabled = await page.locator('[role="option"][aria-disabled="true"]').count(); await page.keyboard.type("claude sonnet"); await page.waitForTimeout(200); await page.screenshot({ path: `${out}/picker-${name}-unavailable.png` }); }
  await page.keyboard.press("Escape"); await page.waitForTimeout(150); const escClosed = (await page.locator('[role="listbox"]').count()) === 0;
  const logo = await page.evaluate(async () => (await fetch("/model-logos/anthropic.svg")).status);
  console.log(JSON.stringify({ name, before, options, groups, filtered, activeId: Boolean(activeId), after, closed, withUnavailable, disabled, escClosed, logo, errors: errors.slice(0, 5) }));
  await ctx.close();
}
await browser.close();
