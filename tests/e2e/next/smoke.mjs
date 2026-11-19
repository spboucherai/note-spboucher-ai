// file: tests/e2e/next/smoke.mjs — opens a page holding every Next Generation block and prints console/page errors + overflow (manual aid)
// author: Simon-Pierre Boucher — contact@spboucher.ai
import { chromium } from "@playwright/test"; import fs from "node:fs";
const base = process.env.E2E_BASE_URL ?? "http://localhost:8485"; const w = Number(process.argv[2] ?? 1280);
const b = await chromium.launch(); const ctx = await b.newContext({ baseURL: base, storageState: "test-results/.auth/state.json", viewport: { width: w, height: 900 }, hasTouch: w < 800, isMobile: w < 800 });
const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push("PAGEERROR " + e.message.slice(0, 400))); p.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") errs.push(m.type().toUpperCase() + " " + m.text().slice(0, 300)); });
const content = { type: "doc", content: JSON.parse(fs.readFileSync("tests/e2e/next/all-nodes.json", "utf8")) };
const r = await p.request.post("/api/pages", { data: { title: "E2E-smoke all nodes", content }, headers: { origin: base, "content-type": "application/json" } }); const pg = await r.json();
await p.goto(`/p/${pg.id}`); await p.locator(".ProseMirror").first().waitFor(); await p.waitForTimeout(5000);
const o = await p.evaluate(() => ({ nodes: [...document.querySelectorAll(".nb[data-node]")].map((n) => n.getAttribute("data-node")), lock: !!document.querySelector("[data-testid=editor-lock]"), dw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, mw: document.getElementById("main-scroll")?.scrollWidth, mc: document.getElementById("main-scroll")?.clientWidth }));
console.log(JSON.stringify(o)); await p.screenshot({ path: `test-results/smoke-${w}.png`, fullPage: false });
const h = await p.evaluate(() => document.getElementById("main-scroll").scrollHeight); await p.setViewportSize({ width: w, height: Math.min(h + 100, 12000) }); await p.waitForTimeout(1200); await p.screenshot({ path: `test-results/smoke-${w}-full.png` });
console.log(errs.slice(0, 25).join("\n") || "no console errors");
if (!process.env.KEEP) await p.request.delete(`/api/pages/${pg.id}`, { headers: { origin: base } }); else console.log("page", pg.id);
await b.close();
