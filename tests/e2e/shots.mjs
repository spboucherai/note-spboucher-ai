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
