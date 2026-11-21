/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : tests/e2e/shots.mjs
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

// ad-hoc visual pass: node tests/e2e/shots.mjs [width] → test-results/shots/*.png (uses the saved e2e session; test database only)
import { chromium } from "@playwright/test"; import fs from "node:fs";
const w = Number(process.argv[2] ?? 360); const h = w < 500 ? 740 : 800; fs.mkdirSync("test-results/shots", { recursive: true });
const b = await chromium.launch(); const ctx = await b.newContext({ baseURL: "http://localhost:8481", storageState: "test-results/.auth/state.json", viewport: { width: w, height: h }, hasTouch: w < 800, isMobile: w < 800, deviceScaleFactor: 2 });
const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push("PAGEERROR " + e.message.slice(0, 300))); p.on("console", (m) => { if (m.type() === "error") errs.push("CONSOLE " + m.text().slice(0, 300)); });
const shot = async (name) => { await p.waitForTimeout(700); const o = await p.evaluate(() => ({ dw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, mw: document.getElementById("main-scroll")?.scrollWidth, mc: document.getElementById("main-scroll")?.clientWidth })); await p.screenshot({ path: `test-results/shots/${w}-${name}.png` }); console.log(name, JSON.stringify(o), (o.dw > o.cw + 1 || (o.mw ?? 0) > (o.mc ?? 0) + 1) ? "OVERFLOW" : "ok"); };
await p.goto("/"); await shot("home");
if (w < 800) { await p.getByRole("button", { name: "Quick capture" }).click(); await shot("capture"); await p.keyboard.press("Escape"); await p.getByRole("button", { name: "More" }).click(); await shot("drawer"); await p.keyboard.press("Escape"); }
await p.goto("/inbox"); await shot("inbox");
const tree = await (await p.request.get("/api/tree")).json(); const page = tree.find((n) => n.type === "page"); const dbp = tree.find((n) => n.type === "database");
if (page) { await p.goto(`/p/${page.id}`); await shot("page"); await p.locator(".ProseMirror").first().click(); await shot("page-editing"); }
if (dbp) { await p.goto(`/p/${dbp.id}`); await shot("database"); }
for (const r of ["search?q=test", "tasks", "settings", "research", "graph", "backlinks", "ai/agents", "ai/models", "trash", "archive"]) { await p.goto("/" + r); await shot(r.replace(/[^a-z]/g, "-")); }
console.log(errs.slice(0, 12).join("\n")); await b.close();
