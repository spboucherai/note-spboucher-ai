/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : tests/e2e/next/shots-next.mjs
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

// file: tests/e2e/next/shots-next.mjs
// description: before/after screenshots (light + dark, desktop + phone) of home, a rich page and the command palette.
// author: Simon-Pierre Boucher — contact@spboucher.ai
// usage: E2E_BASE_URL=http://localhost:8485 node tests/e2e/next/shots-next.mjs <label> <outDir> [docJsonFile]
import { chromium } from "@playwright/test"; import fs from "node:fs";
const base = process.env.E2E_BASE_URL ?? "http://localhost:8485"; const label = process.argv[2] ?? "after"; const out = process.argv[3] ?? "test-results/shots"; fs.mkdirSync(out, { recursive: true });
const T = (text, marks) => ({ type: "text", text, ...(marks ? { marks } : {}) }); const P = (...c) => ({ type: "paragraph", content: c });
const baseDoc = [
  { type: "heading", attrs: { level: 1 }, content: [T("Knowledge systems")] },
  P(T("A note is a "), T("living document", [{ type: "bold" }]), T(": it links to other pages, carries "), T("structured blocks", [{ type: "italic" }]), T(" and stays readable. See "), T("the specification", [{ type: "link", attrs: { href: "https://example.org" } }]), T(" and inline "), T("code", [{ type: "code" }]), T(".")),
  { type: "heading", attrs: { level: 2 }, content: [T("Plan")] },
  { type: "taskList", content: [{ type: "taskItem", attrs: { checked: true }, content: [P(T("Collect the sources"))] }, { type: "taskItem", attrs: { checked: false }, content: [P(T("Write the synthesis"))] }] },
  { type: "callout", attrs: { kind: "info", icon: "💡" }, content: [P(T("Callouts keep a decision or a warning visible in the flow of the text."))] },
  { type: "blockquote", content: [P(T("What is written without effort is in general read without pleasure."))] },
  { type: "codeBlock", attrs: { language: "typescript" }, content: [T("export const lumen = (t: number) => `linear-gradient(135deg, accent, ai ${t}%)`;")] },
  { type: "table", content: [{ type: "tableRow", content: ["Token", "Light", "Dark"].map((h) => ({ type: "tableHeader", content: [P(T(h))] })) }, { type: "tableRow", content: ["accent", "#3157D5", "#8AA2FF"].map((h) => ({ type: "tableCell", content: [P(T(h))] })) }] },
  { type: "aiBlock", attrs: { model: "assistant", at: "2026-11-19T12:00:00Z" }, content: [P(T("AI-generated content is always marked as such."))] },
  { type: "heading", attrs: { level: 3 }, content: [T("Notes")] },
  { type: "bulletList", content: ["First idea", "Second idea", "Third idea"].map((s) => ({ type: "listItem", content: [P(T(s))] })) },
];
const extra = process.argv[4] ? JSON.parse(fs.readFileSync(process.argv[4], "utf8")) : [];
const b = await chromium.launch();
for (const theme of ["light", "dark"]) for (const [dev, w, h] of [["desktop", 1280, 800], ["phone", 375, 667]]) {
  const ctx = await b.newContext({ baseURL: base, storageState: "test-results/.auth/state.json", viewport: { width: w, height: h }, hasTouch: dev === "phone", isMobile: dev === "phone", deviceScaleFactor: 2, colorScheme: theme });
  await ctx.addInitScript((t) => { try { localStorage.setItem("note-theme", t); const u = JSON.parse(localStorage.getItem("note-ui") ?? '{"state":{},"version":0}'); u.state.theme = t; localStorage.setItem("note-ui", JSON.stringify(u)); } catch {} }, theme);
  const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message.slice(0, 200)));
  const r = await p.request.post("/api/pages", { data: { title: "Lumen showcase", icon: "🧭", content: { type: "doc", content: [...baseDoc, ...extra] } }, headers: { origin: base, "content-type": "application/json" } }); const pg = await r.json();
  const shot = async (name, full) => { await p.waitForTimeout(900); await p.screenshot({ path: `${out}/${label}-${dev}-${theme}-${name}.png`, fullPage: false }); if (full) { const m = await p.evaluate(() => { const el = document.getElementById("main-scroll"); return el ? el.scrollHeight : 0; }); if (m > h) { await p.setViewportSize({ width: w, height: Math.min(m + 120, 9000) }); await p.waitForTimeout(700); await p.screenshot({ path: `${out}/${label}-${dev}-${theme}-${name}-full.png` }); await p.setViewportSize({ width: w, height: h }); } } };
  await p.goto("/"); await shot("home");
  await p.goto(`/p/${pg.id}`); await p.locator(".ProseMirror").first().waitFor(); await shot("page", true);
  if (dev === "desktop") { await p.keyboard.press("Control+k"); await shot("palette"); await p.keyboard.press("Escape"); }
  else { try { await p.getByRole("button", { name: "More" }).click({ timeout: 3000 }); await shot("drawer"); await p.keyboard.press("Escape"); } catch {} }
  await p.request.delete(`/api/pages/${pg.id}`, { headers: { origin: base } });
  console.log(label, dev, theme, errs.length ? "ERRORS: " + errs.join(" | ") : "ok"); await ctx.close();
}
await b.close();
