/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : tests/e2e/next/perf-typing.mjs
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

// file: tests/e2e/next/perf-typing.mjs
// description: typing-latency probe on a 2 000-block document (keystroke → next painted frame), used before/after the Lumen upgrade.
// author: Simon-Pierre Boucher — contact@spboucher.ai
// usage: E2E_BASE_URL=http://localhost:8485 node tests/e2e/next/perf-typing.mjs [blocks=2000] [chars=80]  (needs the saved e2e session; scratch database only)
import { chromium } from "@playwright/test";
const base = process.env.E2E_BASE_URL ?? "http://localhost:8485"; const N = Number(process.argv[2] ?? 2000); const CH = Number(process.argv[3] ?? 80);
const b = await chromium.launch(); const ctx = await b.newContext({ baseURL: base, storageState: "test-results/.auth/state.json", viewport: { width: 1280, height: 800 } });
const p = await ctx.newPage();
const words = "lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua".split(" ");
const content = { type: "doc", content: Array.from({ length: N }, (_, i) => (i % 25 === 0 ? { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: `Section ${i / 25 + 1}` }] } : { type: "paragraph", content: [{ type: "text", text: Array.from({ length: 18 }, (_, k) => words[(i * 7 + k * 3) % words.length]).join(" ") }] })) };
const r = await p.request.post("/api/pages", { data: { title: `E2E-perf ${Date.now()}`, content }, headers: { origin: base, "content-type": "application/json" } }); const pg = await r.json();
const t0 = Date.now(); await p.goto(`/p/${pg.id}`); await p.locator(".ProseMirror p").first().waitFor(); const ready = Date.now() - t0;
await p.waitForTimeout(1500);
await p.locator(".ProseMirror p").nth(2).click();
await p.evaluate(() => { window.__lat = []; document.addEventListener("beforeinput", () => { const t = performance.now(); requestAnimationFrame(() => { const sync = performance.now() - t; requestAnimationFrame(() => window.__lat.push({ sync, frame: performance.now() - t })); }); }, true); });
for (let i = 0; i < CH; i++) { await p.keyboard.type("abcdefghij klmnop"[i % 17]); await p.waitForTimeout(60); }
await p.waitForTimeout(400);
const lat = await p.evaluate(() => window.__lat); const q = (a, f) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * f))]; };
const sync = lat.map((l) => l.sync), frame = lat.map((l) => l.frame);
console.log(JSON.stringify({ blocks: N, samples: lat.length, readyMs: ready, toFirstFrame: { median: +q(sync, 0.5).toFixed(1), p95: +q(sync, 0.95).toFixed(1), max: +Math.max(...sync).toFixed(1) }, toPaintedFrame: { median: +q(frame, 0.5).toFixed(1), p95: +q(frame, 0.95).toFixed(1), max: +Math.max(...frame).toFixed(1) } }));
await p.request.delete(`/api/pages/${pg.id}`, { headers: { origin: base } });
await b.close();
