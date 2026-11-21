/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : tests/e2e/next/perf-k.mjs
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

// file: tests/e2e/next/perf-k.mjs
// description: measures the Knowledge Graph 2.0 (and the Thought Constellation) on the synthetic workspace of
//   scripts/next-k-perf-seed.ts — time to first paint of the graph, duration and frame rate of the layout phase, then frame times
//   while zooming with the wheel and panning with a drag (requestAnimationFrame intervals read in the page while Playwright drives
//   the mouse). Prints one JSON object. Numbers are real measurements of this run; nothing is estimated.
// author: Simon-Pierre Boucher — contact@spboucher.ai
// usage: E2E_BASE_URL=http://localhost:8487 node tests/e2e/next/perf-k.mjs <sessionTokenFile> [--headed]
import { chromium } from "@playwright/test"; import fs from "node:fs";
const base = process.env.E2E_BASE_URL ?? "http://localhost:8487"; const token = fs.readFileSync(process.argv[2], "utf8").trim();
// --gpu: the full Chromium binary in its new headless mode with the Metal backend (the default headless shell rasterises on the CPU)
const gpu = process.argv.includes("--gpu");
const b = await chromium.launch({ headless: !process.argv.includes("--headed"), ...(gpu ? { channel: "chromium", args: ["--use-angle=metal", "--enable-gpu-rasterization", "--ignore-gpu-blocklist", "--enable-zero-copy"] } : {}) });
const ctx = await b.newContext({ baseURL: base, viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, extraHTTPHeaders: { cookie: `__Host-note_session=${token}` } }); const p = await ctx.newPage();
const stats = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const q = (f) => s[Math.min(s.length - 1, Math.floor(f * s.length))]; const mean = a.reduce((x, y) => x + y, 0) / a.length; return { frames: a.length, meanMs: +mean.toFixed(1), p50Ms: +q(0.5).toFixed(1), p95Ms: +q(0.95).toFixed(1), maxMs: +s[s.length - 1].toFixed(1), fps: +(1000 / mean).toFixed(1) }; };
const sample = async (ms, drive) => { await p.evaluate(() => { const w = window; w.__raf = []; let last = performance.now(); w.__rafOn = true; const tick = (t) => { w.__raf.push(t - last); last = t; if (w.__rafOn) requestAnimationFrame(tick); }; requestAnimationFrame(tick); }); const t0 = Date.now(); while (Date.now() - t0 < ms) await drive(Date.now() - t0); return stats(await p.evaluate(() => { window.__rafOn = false; return window.__raf.slice(1); })); };
const out = { at: new Date().toISOString(), viewport: "1440x900@2x", browser: `Chromium ${b.version()} ${process.argv.includes("--headed") ? "headed" : gpu ? "headless (full binary, Metal)" : "headless shell (CPU raster)"}` };
// ---- graph
await p.addInitScript(() => { window.__kgPerf = []; });
const t0 = Date.now(); await p.goto(process.argv.includes("--legacy") ? "/graph?renderer=force" : "/graph"); const canvas = p.getByTestId("graph-canvas"); await canvas.waitFor({ timeout: 120_000 });
out.graph = { renderer: (await canvas.getAttribute("data-renderer")) ?? "react-force-graph-2d", nodes: Number(await canvas.getAttribute("data-nodes")), edges: Number(await canvas.getAttribute("data-edges")), lod: await canvas.getAttribute("data-lod"), dataAndFirstCanvasMs: Date.now() - t0 };
await p.waitForFunction(() => window.__kgPerf.length > 0, null, { timeout: 120_000 }); out.graph.firstFrameMs = Date.now() - t0;
await p.waitForFunction(() => Boolean(window.__kgSettled), null, { timeout: 180_000 }); out.graph.layoutSettledMs = Date.now() - t0;
const layoutFrames = await p.evaluate(() => { const a = window.__kgPerf; const d = []; for (let i = 1; i < a.length; i++) d.push(a[i] - a[i - 1]); return d; }); out.graph.layoutPhase = stats(layoutFrames);
const bb = await canvas.boundingBox(); const cx = bb.x + bb.width / 2, cy = bb.y + bb.height / 2; await p.mouse.move(cx, cy); await p.waitForTimeout(500);
out.graph.wheelZoom = await sample(5000, async (t) => { await p.mouse.wheel(0, Math.floor(t / 1250) % 2 === 0 ? -40 : 40); await p.waitForTimeout(12); });
await p.mouse.move(cx, cy); await p.mouse.down();
out.graph.dragPan = await sample(5000, async (t) => { const a = t / 400; await p.mouse.move(cx + Math.cos(a) * 220, cy + Math.sin(a) * 140); await p.waitForTimeout(8); });
await p.mouse.up();
// zoomed in (labels on): pan again
for (let i = 0; i < 14; i++) { await p.mouse.move(cx, cy); await p.mouse.wheel(0, -120); await p.waitForTimeout(30); } await p.mouse.down();
out.graph.dragPanZoomedIn = await sample(4000, async (t) => { const a = t / 400; await p.mouse.move(cx + Math.cos(a) * 200, cy + Math.sin(a) * 120); await p.waitForTimeout(8); });
await p.mouse.up();
// selecting a node from the list (inspector + highlighted edges drawing themselves)
await p.getByTestId("open-insights").click().catch(() => {}); const tSel = Date.now(); await p.locator("[data-testid=insight-central] button").nth(1).click({ timeout: 60_000 }).catch(() => {}); await p.getByTestId("node-inspector").waitFor({ timeout: 60_000 }).then(() => { out.graph.selectCentralPageMs = Date.now() - tSel; }).catch(() => { out.graph.selectCentralPageMs = null; });
// ---- constellation
const t1 = Date.now(); const r = await p.request.get("/api/graph/constellation"); const c = await r.json(); out.constellation = { apiMs: Date.now() - t1, cached: c.cached, points: c.points?.length ?? 0, links: c.links?.length ?? 0, clusters: c.clusters?.length ?? 0, explained: c.explained };
const t2 = Date.now(); await p.goto("/constellation"); const sky = p.locator("[data-testid=constellation-canvas]");
if (await sky.waitFor({ timeout: 120_000 }).then(() => true).catch(() => false)) {
  out.constellation.firstCanvasMs = Date.now() - t2; await p.waitForTimeout(2500); const sb = await sky.boundingBox(); const sx = sb.x + sb.width / 2, sy = sb.y + sb.height / 2; await p.mouse.move(sx, sy);
  out.constellation.wheelZoom = await sample(5000, async (t) => { await p.mouse.wheel(0, Math.floor(t / 1250) % 2 === 0 ? -60 : 60); await p.waitForTimeout(12); });
  await p.mouse.down(); out.constellation.dragPan = await sample(4000, async (t) => { const a = t / 400; await p.mouse.move(sx + Math.cos(a) * 220, sy + Math.sin(a) * 140); await p.waitForTimeout(8); }); await p.mouse.up();
}
out.gl = await p.evaluate(() => { try { const c = document.createElement("canvas"); const g = c.getContext("webgl"); const e = g.getExtension("WEBGL_debug_renderer_info"); return e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : "webgl"; } catch { return null; } });
console.log(JSON.stringify(out, null, 1)); await b.close();
