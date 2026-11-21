/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : tests/e2e/overflow.mjs
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

// ad-hoc: node tests/e2e/overflow.mjs /path [width] → lists the elements that stick out of the viewport
import { chromium } from "@playwright/test";
const path = process.argv[2] ?? "/"; const w = Number(process.argv[3] ?? 360);
const b = await chromium.launch(); const ctx = await b.newContext({ baseURL: "http://localhost:8481", storageState: "test-results/.auth/state.json", viewport: { width: w, height: 740 }, hasTouch: true, isMobile: true });
const p = await ctx.newPage(); await p.goto(path); await p.waitForTimeout(2500);
console.log(JSON.stringify(await p.evaluate(() => { const W = document.documentElement.clientWidth; const out = []; for (const el of document.querySelectorAll("#main-scroll *")) { const r = el.getBoundingClientRect(); if (r.right > W + 1 && r.width > 0) { let clipped = false; for (let a = el.parentElement; a && a.id !== "main-scroll"; a = a.parentElement) { const o = getComputedStyle(a).overflowX; if (o === "auto" || o === "scroll" || o === "hidden" || o === "clip") { clipped = true; break; } } if (!clipped) out.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 70)} right=${Math.round(r.right)} w=${Math.round(r.width)}`); } } return out.slice(0, 12); }), null, 1)); await b.close();
