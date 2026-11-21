/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : tests/e2e/shots2.mjs
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

// ad-hoc visual pass of the database / agents / assistant / data screens with seeded data → test-results/shots/
import { chromium } from "@playwright/test"; import fs from "node:fs";
const w = Number(process.argv[2] ?? 360); fs.mkdirSync("test-results/shots", { recursive: true }); const O = "http://localhost:8481";
const b = await chromium.launch(); const ctx = await b.newContext({ baseURL: O, storageState: "test-results/.auth/state.json", viewport: { width: w, height: 740 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push("PAGEERROR " + e.message.slice(0, 300))); p.on("console", (m) => { if (m.type() === "error") errs.push("CONSOLE " + m.text().slice(0, 200)); });
const post = async (u, d) => { const r = await p.request.post(u, { data: d, headers: { origin: O } }); return { s: r.status(), j: await r.json().catch(() => null) }; };
const shot = async (name) => { await p.waitForTimeout(900); const o = await p.evaluate(() => ({ dw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, mw: document.getElementById("main-scroll")?.scrollWidth, mc: document.getElementById("main-scroll")?.clientWidth })); await p.screenshot({ path: `test-results/shots/${w}-${name}.png` }); console.log(name, (o.dw > o.cw + 1 || (o.mw ?? 0) > (o.mc ?? 0) + 1) ? "OVERFLOW " + JSON.stringify(o) : "ok"); };
await p.goto("/");
let tree = await (await p.request.get("/api/tree")).json(); let dbp = tree.find((n) => n.type === "database" && n.title === "E2E Tasks DB");
if (!dbp) { const c = await post("/api/pages", { title: "E2E Tasks DB", type: "database", section: "databases" }); dbp = c.j; const t = await post(`/api/databases/${dbp.id}/apply-template`, { template: process.argv[3] ?? "tasks" }); console.log("template", t.s, JSON.stringify(t.j).slice(0, 200)); for (const title of ["Write the report with a rather long title that must wrap properly", "Call the notary", "Review chapter 3"]) { const r = await post(`/api/databases/${dbp.id}/rows`, { title }); if (r.s >= 300) console.log("row", r.s, JSON.stringify(r.j)); } }
await p.goto(`/p/${dbp.id}`); await shot("db-default");
const tabs = await p.getByRole("tab").allTextContents(); console.log("tabs:", tabs.join(" | "));
for (const t of tabs.slice(0, 7)) { try { await p.getByRole("tab", { name: t, exact: true }).first().click({ timeout: 3000 }); await shot("db-" + t.toLowerCase().replace(/[^a-z]/g, "")); } catch (e) { console.log("tab fail", t); } }
console.log("buttons:", (await p.locator("main button").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label") || e.textContent?.trim().slice(0, 24)).filter(Boolean))).slice(0, 40).join(" | "));
for (const r of ["ai/agents", "settings#data", "research"]) { await p.goto("/" + r); await shot(r.replace(/[^a-z]/g, "-")); }
await p.goto("/"); await p.getByRole("button", { name: "AI assistant" }).click(); await shot("ai-panel");
console.log(errs.slice(0, 10).join("\n")); await b.close();
