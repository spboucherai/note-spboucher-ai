// ad-hoc: node tests/e2e/debug.mjs /path  → prints console errors and saves a screenshot (uses the saved e2e session)
import { chromium } from "@playwright/test";
const path = process.argv[2] ?? "/"; const w = Number(process.argv[3] ?? 390);
const b = await chromium.launch(); const ctx = await b.newContext({ baseURL: "http://localhost:8481", storageState: "test-results/.auth/state.json", viewport: { width: w, height: 844 }, hasTouch: w < 800, isMobile: w < 800 });
const p = await ctx.newPage(); p.on("pageerror", (e) => console.log("PAGEERROR", e.message.slice(0, 600))); p.on("console", (m) => { if (m.type() === "error") console.log("CONSOLE", m.text().slice(0, 400)); });
await p.goto(path); await p.waitForTimeout(Number(process.argv[4] ?? 2500)); await p.screenshot({ path: "test-results/debug.png", fullPage: process.argv[5] === "full" }); console.log("url", p.url()); await b.close();
