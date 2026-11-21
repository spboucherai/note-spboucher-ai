/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : tests/e2e/live-ai.mjs
 * Module           : tests
 * Repository       : https://git.spboucher.ai/note-spboucher-ai
 * Project Website  : https://note.spboucher.ai
 * Created          : 2026-11-17
 * Last Modified    : 2026-11-17
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

// MANUAL, costs a few cents of provider usage: node tests/e2e/live-ai.mjs — asks one grounded question and one that the notes cannot answer.
import { chromium } from "@playwright/test";
const O = "http://localhost:8481"; const b = await chromium.launch(); const ctx = await b.newContext({ baseURL: O, storageState: "test-results/.auth/state.json", viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
const p = await ctx.newPage(); p.on("pageerror", (e) => console.log("PAGEERROR", e.message.slice(0, 200)));
const ask = async (q, tag) => {
  await p.goto("/"); await p.getByRole("button", { name: "AI assistant" }).click(); await p.waitForTimeout(600);
  const box = p.getByPlaceholder("Ask your notes…").last(); await box.click(); await box.fill(q); await p.waitForTimeout(300); await p.locator("button:has(svg.lucide-send)").last().click();
  await p.waitForTimeout(1500); const anyway = p.getByRole("button", { name: /Send anyway/ }); if (await anyway.count()) await anyway.click();
  for (let i = 0; i < 60; i++) { await p.waitForTimeout(1000); const t = await p.locator('[role="dialog"], aside, main').last().innerText().catch(() => ""); if (/\$0\.\d|No supporting note|insufficient|Retry/i.test(t) && i > 3) break; }
  const panel = await p.evaluate(() => document.body.innerText); const i = panel.lastIndexOf(q.slice(0, 20)); console.log(`--- ${tag}\n` + panel.slice(i, i + 900).replace(/\n{2,}/g, "\n"));
  const links = await p.locator('a[href*="#block-"]').evaluateAll((els) => els.map((e) => e.getAttribute("href"))); console.log("citation links:", links.slice(0, 4)); await p.screenshot({ path: `test-results/shots/live-${tag}.png` });
  return links;
};
const links = await ask("When is the IMM1033 intra and what does the lecture use?", "grounded");
if (links[0]) { await p.goto(links[0]); await p.waitForTimeout(1500); console.log("citation opens:", p.url(), "| block in view:", await p.evaluate((h) => { const el = document.getElementById(h); if (!el) return "missing"; const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight ? "yes" : "no"; }, links[0].split("#")[1])); }
await ask("What is the boiling point of tungsten according to my notes?", "ungrounded");
await b.close();
