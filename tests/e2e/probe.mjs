import { chromium } from "@playwright/test";
const O = "http://localhost:8481"; const b = await chromium.launch(); const ctx = await b.newContext({ baseURL: O, storageState: "test-results/.auth/state.json", viewport: { width: 360, height: 740 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
const p = await ctx.newPage(); const tree = await (await p.request.get("/api/tree")).json(); const dbp = tree.find((n) => n.title === "E2E Tasks DB");
await p.goto(`/p/${dbp.id}`); await p.getByRole("button", { name: "Open Call the notary" }).click(); await p.waitForTimeout(900);
const names = async (sel) => (await p.locator(sel).evaluateAll((els) => els.map((e) => (e.getAttribute("aria-label") || e.textContent || "").trim().replace(/\s+/g, " ").slice(0, 40)).filter(Boolean))).join(" | ");
console.log("SHEET:", await names('[role="dialog"] button, [role="dialog"] [role="switch"], [role="dialog"] input')); await p.screenshot({ path: "test-results/shots/360-db-row.png" });
const st = p.getByRole("dialog").getByRole("button", { name: /Status/ }).first(); if (await st.count()) { await st.click(); await p.waitForTimeout(700); console.log("STATUS:", await names('[role="dialog"] button')); await p.screenshot({ path: "test-results/shots/360-db-status.png" }); }
await p.keyboard.press("Escape"); await p.keyboard.press("Escape"); await p.waitForTimeout(300);
await p.getByRole("button", { name: "New", exact: true }).click(); await p.waitForTimeout(700); console.log("NEW:", await names('[role="dialog"] button, [role="dialog"] input, [role="dialog"] textarea')); await p.screenshot({ path: "test-results/shots/360-db-new.png" }); await p.keyboard.press("Escape");
await p.getByRole("button", { name: /View options/ }).click(); await p.waitForTimeout(700); console.log("OPTIONS:", (await names('[role="dialog"] button')).slice(0, 700)); await p.screenshot({ path: "test-results/shots/360-db-options.png" });
await b.close();
