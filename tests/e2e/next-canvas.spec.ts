/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : tests/e2e/next-canvas.spec.ts
 * Description      : Infinite Canvas, desktop Chromium, scratch database only —
 *                    every card kind created through the interface and
 *                    identical after a reload; two browser contexts editing
 *                    concurrently (three-way merge on 409, conflict review);
 *                    offline draft and reconnect; selection, alignment,
 *                    clipboard, stacking, context menu, minimap, drops,
 *                    exports, entry points; unknown content preserved; viewport
 *                    without version noise; a performance probe with 1 000
 *                    cards (frame times are printed and written to the data
 *                    directory).
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

import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { apiCall, docOf, para, PDF, PNG, sql, ORIGIN, STATE } from "./helpers";

const SHOTS = process.env.CANVAS_SHOTS ?? path.join(os.homedir(), "dev/note-next-c-data/shots");
const made: string[] = [];
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
type Canvas = { format: string; nodes: any[]; edges: any[]; viewport: any; [k: string]: unknown };
const text = (id: string, x: number, y: number, t = id, extra: Record<string, unknown> = {}) => ({ id, kind: "text", x, y, w: 200, h: 100, z: 0, text: t, ...extra });
async function newCanvas(page: Page, title: string, data?: Partial<Canvas>) {
  const r = await apiCall(page, "POST", "/api/pages", { title: `E2E-canvas ${title} ${uid()}`, type: "canvas" }); expect(r.status).toBe(201); made.push(r.body.id);
  if (data) { const put = await apiCall(page, "PUT", `/api/canvases/${r.body.id}`, { data: { format: "spn-canvas-1", nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 }, ...data }, baseVersion: 1 }); expect(put.status, JSON.stringify(put.body)).toBe(200); }
  return r.body.id as string;
}
const server = async (page: Page, id: string) => (await apiCall(page, "GET", `/api/canvases/${id}`)).body as { data: Canvas; version: number };
const ready = (page: Page) => page.locator("[data-testid='canvas-page'][data-state='ready']");
const open = async (page: Page, id: string) => { await page.goto(`/p/${id}`); await ready(page).waitFor(); await page.locator("[data-testid='canvas-surface']").waitFor(); };
const saved = (page: Page) => expect(page.locator("[data-testid='canvas-status']")).toHaveAttribute("data-status", "saved", { timeout: 20_000 });
const surface = (page: Page) => page.locator("[data-testid='canvas-surface']");
const card = (page: Page, id: string) => page.locator(`.cv-node[data-id="${id}"]`);
const local = <T,>(page: Page, fn: string): Promise<T> => page.evaluate(`(() => { const c = window.__canvas; const s = c.store; return (${fn})(s, c); })()`) as Promise<T>;
const docOfCanvas = (page: Page) => local<Canvas>(page, "(s) => s.doc");
const selection = (page: Page) => local<string[]>(page, "(s) => s.get().selection");
const waitFor = async <T,>(fn: () => Promise<T | null | undefined | false>, ms = 15_000): Promise<T> => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error("condition not met in time"); await new Promise((r) => setTimeout(r, 200)); } };
const waitVersion = (page: Page, id: string, above: number) => waitFor(async () => { const s = await server(page, id); return s.version > above ? s : null; });
/** Types into the card being edited in place, then leaves the field. */
const typeInCard = async (page: Page, value: string, replace = false) => { const f = page.locator(".cv-node[data-editing] textarea.cv-field"); await f.waitFor(); if (replace) await f.fill(value); else await page.keyboard.type(value); await page.keyboard.press("Escape"); await expect(page.locator(".cv-node[data-editing]")).toHaveCount(0); };
const editCard = async (page: Page, id: string, value: string) => { await card(page, id).dblclick(); await typeInCard(page, value, true); };
const center = async (page: Page, id: string) => { const b = (await card(page, id).boundingBox())!; return { x: b.x + b.width / 2, y: b.y + b.height / 2, b }; };
const shot = async (page: Page, name: string) => { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, `${name}.png`) }); };
const setTheme = (page: Page, theme: "light" | "dark") => page.evaluate((t) => (window as any).__noteUI().setTheme(t), theme);
test.afterAll(async () => { if (made.length) await sql`delete from pages where id = any(${made}::uuid[])`; await sql`delete from pages where title like 'E2E-canvas %' or title = 'New canvas'`; await sql`delete from knowledge_edges where to_id in (select id from "references" where title like 'Canvas reference %')`; await sql`delete from "references" where title like 'Canvas reference %'`; });

test("create a canvas from the sidebar, add every kind of card, connect two, reload: identical", async ({ page }) => {
  test.setTimeout(150_000);
  await page.goto("/");
  const target = await apiCall(page, "POST", "/api/pages", { title: `E2E-canvas target ${uid()}`, content: docOf(para("The excerpt shown on the page card.")) }); made.push(target.body.id);
  const refTitle = `Canvas reference ${uid()}`; const ref = await apiCall(page, "POST", "/api/research/references", { title: refTitle, authors: ["Ada Lovelace"], year: 1843 }); expect(ref.status).toBe(201);
  await page.getByRole("button", { name: "New canvas" }).first().click();
  await page.waitForURL(/\/p\/[0-9a-f-]{36}/); await ready(page).waitFor(); const id = page.url().split("/p/")[1].slice(0, 36); made.push(id);
  await expect(page.getByText("This canvas is empty")).toBeVisible(); await expect(page.locator("[data-testid='canvas-icon']").first()).toBeVisible();
  const tool = (name: string) => page.locator("[data-testid='canvas-toolbar']").getByRole("button", { name, exact: true });
  const count = (kind: string) => page.locator(`.cv-node[data-kind="${kind}"]`);
  // text (in-place Markdown)
  await tool("Add text").click(); await typeInCard(page, "Hello **canvas**"); await expect(count("text").locator("strong")).toHaveText("canvas");
  // shape
  await tool("Add shape").click(); await page.getByRole("menuitem", { name: "Ellipse" }).click(); await expect(count("shape")).toHaveAttribute("data-shape", "ellipse");
  // page card (search and pick)
  await tool("Add page card").click(); const form = page.locator("[data-testid='canvas-card-form']"); await form.getByLabel("Find a page").fill("E2E-canvas target"); await form.getByRole("option").filter({ hasText: target.body.title }).click(); await form.getByRole("button", { name: "Done" }).click();
  await expect(page.locator("[data-testid='canvas-page-card'] .cv-title")).toContainText(target.body.title); await expect(page.locator("[data-testid='canvas-page-card'] .cv-excerpt")).toContainText("The excerpt shown on the page card.");
  // link
  await tool("Add link").click(); await form.getByLabel("Link address").fill("https://example.org/paper"); await form.getByLabel("Link title").fill("A paper"); await form.getByRole("button", { name: "Done" }).click(); await expect(count("link").locator(".cv-title")).toHaveText("A paper");
  // image + pdf (uploaded as attachments of the canvas page)
  await page.setInputFiles("[data-testid='canvas-file-input']", [{ name: "pixel.png", mimeType: "image/png", buffer: PNG }, { name: "hello.pdf", mimeType: "application/pdf", buffer: PDF }]);
  await expect(count("image").locator("img")).toBeVisible({ timeout: 15_000 }); await expect(page.locator("[data-testid='canvas-pdf'] .cv-pdf-page img")).toBeVisible({ timeout: 30_000 }); await expect(page.locator("[data-testid='canvas-pdf']")).toContainText("1 p.");
  // reference
  await tool("Add reference").click(); await form.getByLabel("Find a reference").fill(refTitle); await form.getByRole("option").filter({ hasText: refTitle }).click(); await form.getByRole("button", { name: "Done" }).click(); await expect(page.locator("[data-testid='canvas-ref-card'] .cv-title")).toHaveText(refTitle);
  // formula (KaTeX)
  await tool("Add formula").click(); await typeInCard(page, "E=mc^2"); await expect(count("math").locator(".katex")).toBeVisible();
  // table (small grid)
  await tool("Add table").click(); await page.keyboard.type("Year"); await page.keyboard.press("Tab"); await page.keyboard.type("Rate"); await page.keyboard.press("Escape"); await expect(count("table").locator("th").first()).toHaveText("Year");
  // freehand ink, directly on the canvas
  await tool("Draw").click(); const sb = (await surface(page).boundingBox())!;
  await page.mouse.move(sb.x + 70, sb.y + 260); await page.mouse.down(); for (let i = 1; i <= 12; i++) await page.mouse.move(sb.x + 70 + i * 10, sb.y + 260 + Math.sin(i / 2) * 30); await page.mouse.up();
  await expect(page.locator("[data-testid='canvas-ink-layer']")).toHaveAttribute("data-strokes", "1"); await page.locator("[data-testid='canvas-ink-bar']").getByRole("button", { name: "Done" }).click();
  await expect(page.locator("[data-testid='canvas-ink']")).toHaveAttribute("data-strokes", "1", { timeout: 15_000 });
  await expect(page.locator(".cv-node")).toHaveCount(10);
  // tidy up (animated grid: no connection yet), then connect the text to the shape by dragging its side handle, and label the connection
  await surface(page).click({ position: { x: 30, y: 120 } }); await tool("Tidy up").click(); await page.waitForTimeout(1200);
  const d0 = await docOfCanvas(page); const overlap = d0.nodes.some((a, i) => d0.nodes.some((b, j) => j > i && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h)); expect(overlap, "tidy up leaves no overlap").toBe(false);
  const textId = d0.nodes.find((n) => n.kind === "text").id, shapeId = d0.nodes.find((n) => n.kind === "shape").id;
  await card(page, textId).click(); expect(await selection(page)).toEqual([textId]);
  const handle = (await page.locator(".cv-connect[data-connect='bottom']").boundingBox())!; const to = await center(page, shapeId);
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2); await page.mouse.down(); await page.mouse.move(to.x, to.y, { steps: 8 }); await page.mouse.up();
  await expect(page.locator(".cv-edge")).toHaveCount(1); await page.locator("[data-testid='canvas-edge-bar']").getByRole("button", { name: "Edit label" }).click();
  await page.locator(".cv-edge-input").fill("leads to"); await page.keyboard.press("Enter"); await expect(page.locator(".cv-edge-label text")).toHaveText("leads to");
  await saved(page);
  const s1 = await waitFor(async () => { const s = await server(page, id); return s.data.edges[0]?.label === "leads to" ? s : null; });
  expect(new Set(s1.data.nodes.map((n) => n.kind))).toEqual(new Set(["text", "shape", "page", "link", "image", "pdf", "reference", "math", "table", "drawing"]));
  expect(s1.data.edges).toHaveLength(1); expect(s1.data.edges[0]).toMatchObject({ from: textId, to: shapeId, kind: "arrow", label: "leads to" });
  const by = (k: string) => s1.data.nodes.find((n) => n.kind === k);
  expect(by("page").pageId).toBe(target.body.id); expect(by("reference").refId).toBe(ref.body.id); expect(by("math").latex).toBe("E=mc^2"); expect(by("link")).toMatchObject({ url: "https://example.org/paper", text: "A paper" });
  expect(by("table").text.split("\n")[0]).toBe("| Year | Rate |  |"); expect(by("image").attachmentId).toMatch(/^[0-9a-f-]{36}$/); expect(by("pdf").attachmentId).toMatch(/^[0-9a-f-]{36}$/); expect(by("drawing").ink).toMatch(/^[0-9a-f-]{36}$/);
  const ink = await page.request.get(`/api/files/${by("drawing").ink}`); const inkDoc = await ink.json(); expect(inkDoc.format).toBe("spn-ink-1"); expect(inkDoc.strokes).toHaveLength(1); expect(inkDoc.width).toBe(by("drawing").w);
  // the canvas text is the page's plain text (search); page cards are backlinks
  const [row] = await sql`select plain_text from pages where id = ${id}`; expect(row.plain_text).toContain("Hello **canvas**"); expect(row.plain_text).toContain("leads to"); expect(row.plain_text).toContain("E=mc^2");
  const back = (await apiCall(page, "GET", `/api/pages/${target.body.id}`)).body.backlinks; expect(back.map((b: any) => b.id)).toContain(id);
  await shot(page, "desktop-light-all-kinds"); await setTheme(page, "dark"); await page.waitForTimeout(300); await shot(page, "desktop-dark-all-kinds"); await setTheme(page, "light");
  // reload: the same document, the same rendering, and no save caused by merely opening it
  await page.reload(); await ready(page).waitFor(); await expect(page.locator(".cv-node")).toHaveCount(10);
  await expect(page.locator("[data-testid='canvas-pdf'] .cv-pdf-page img")).toBeVisible({ timeout: 30_000 }); await expect(page.locator("[data-testid='canvas-ink']")).toHaveAttribute("data-strokes", "1"); await expect(page.locator(".cv-node[data-kind='math'] .katex")).toBeVisible();
  await expect(page.locator("[data-testid='canvas-page-card'] .cv-title")).toContainText(target.body.title); await expect(page.locator("[data-testid='canvas-ref-card'] .cv-title")).toHaveText(refTitle); await expect(page.locator(".cv-edge-label text")).toHaveText("leads to");
  await page.waitForTimeout(2500); const s2 = await server(page, id); expect(s2.version).toBe(s1.version); expect(s2.data).toEqual(s1.data); expect(await docOfCanvas(page).then((d) => ({ nodes: d.nodes, edges: d.edges }))).toEqual({ nodes: s1.data.nodes, edges: s1.data.edges });
  await apiCall(page, "DELETE", `/api/research/references/${ref.body.id}`);
});

async function second(browser: import("@playwright/test").Browser): Promise<{ ctx: BrowserContext; page: Page }> { const ctx = await browser.newContext({ storageState: STATE, baseURL: ORIGIN, viewport: { width: 1280, height: 800 } }); return { ctx, page: await ctx.newPage() }; }
const count409 = (page: Page) => { const seen = { n: 0 }; page.on("response", (r) => { if (r.request().method() === "PUT" && r.url().includes("/api/canvases/") && r.status() === 409) seen.n++; }); return seen; };

test("two sessions edit different cards at the same time: the second save meets a 409, merges, and both edits survive", async ({ page, browser }) => {
  await page.goto("/"); const id = await newCanvas(page, "merge", { nodes: [text("a", 0, 0, "Card A"), text("b", 300, 0, "Card B"), text("c", 600, 0, "Card C")], edges: [{ id: "e1", from: "a", to: "b" }] });
  const B = await second(browser); const conflictsB = count409(B.page);
  await open(page, id); await open(B.page, id); const v0 = (await server(page, id)).version;
  await editCard(page, "a", "Card A — edited in session one"); await saved(page); await waitVersion(page, id, v0);
  // session two still holds the old base: it edits another card, moves a third and adds a connection
  await editCard(B.page, "b", "Card B — edited in session two");
  const c = await center(B.page, "c"); await B.page.mouse.move(c.x, c.y); await B.page.mouse.down(); await B.page.mouse.move(c.x + 40, c.y + 160, { steps: 6 }); await B.page.mouse.up();
  await saved(B.page);
  const s = await waitFor(async () => { const x = await server(page, id); return x.data.nodes.find((n) => n.id === "b").text.includes("session two") ? x : null; });
  expect(conflictsB.n, "session two's save was refused once (409) before the merge").toBeGreaterThanOrEqual(1);
  expect(s.data.nodes.find((n) => n.id === "a").text).toBe("Card A — edited in session one"); expect(s.data.nodes.find((n) => n.id === "b").text).toBe("Card B — edited in session two"); expect(s.data.nodes.find((n) => n.id === "c").y).toBeGreaterThan(100); expect(s.data.edges).toHaveLength(1);
  await expect(card(B.page, "a")).toContainText("edited in session one"); await expect(B.page.locator("[data-testid='canvas-review']")).toHaveCount(0);
  // session one catches up when its window comes back to the front (nothing pending there: plain refresh)
  await page.evaluate(() => window.dispatchEvent(new Event("focus"))); await expect(card(page, "b")).toContainText("edited in session two"); await expect(page.locator("[data-testid='canvas-review']")).toHaveCount(0);
  expect(await docOfCanvas(page).then((d) => d.nodes)).toEqual(s.data.nodes);
  await B.ctx.close();
});

test("the same card edited in both sessions, and an edit against a deletion: review panel, nothing lost, keep mine / keep theirs", async ({ page, browser }) => {
  await page.goto("/"); const id = await newCanvas(page, "conflict", { nodes: [text("a", 0, 0, "Original A"), text("b", 300, 0, "Original B"), text("c", 0, 200, "Original C")], edges: [] });
  const B = await second(browser); const conflictsB = count409(B.page);
  await open(page, id); await open(B.page, id); const v0 = (await server(page, id)).version;
  await editCard(page, "a", "A from session one"); await card(page, "b").click(); await page.keyboard.press("Delete"); await expect(card(page, "b")).toHaveCount(0); await saved(page); await waitVersion(page, id, v0);
  await editCard(B.page, "a", "A from session two"); await editCard(B.page, "b", "B edited in session two while session one deleted it");
  const review = B.page.locator("[data-testid='canvas-review']"); await expect(review).toBeVisible({ timeout: 20_000 }); expect(conflictsB.n).toBeGreaterThanOrEqual(1);
  const items = review.locator("[data-testid='canvas-conflict']"); await expect(items).toHaveCount(2);
  await expect(review.locator("[data-reason='bothEdited']")).toContainText("A from session two"); await expect(review.locator("[data-reason='bothEdited']")).toContainText("A from session one");
  await expect(review.locator("[data-reason='editedAndDeleted']")).toContainText("Deleted");
  // non-blocking: the canvas is still editable while the panel is open, and this device's versions are on the canvas and on the server
  await editCard(B.page, "c", "C edited during the review"); await saved(B.page);
  let s = await waitFor(async () => { const x = await server(page, id); return x.data.nodes.find((n) => n.id === "c")?.text === "C edited during the review" ? x : null; });
  expect(s.data.nodes.find((n) => n.id === "a").text).toBe("A from session two"); expect(s.data.nodes.find((n) => n.id === "b").text, "edit versus delete keeps the edited card").toContain("B edited in session two");
  fs.mkdirSync(SHOTS, { recursive: true }); await B.page.screenshot({ path: path.join(SHOTS, "desktop-light-conflict-review.png") });
  // keep theirs for A (the other session's text comes back), keep mine for B (the edited card stays)
  await review.locator("[data-reason='bothEdited']").getByRole("button", { name: "Keep theirs" }).click(); await expect(card(B.page, "a")).toContainText("A from session one"); await expect(items).toHaveCount(1);
  await review.locator("[data-reason='editedAndDeleted']").getByRole("button", { name: "Keep mine" }).click(); await expect(review).toHaveCount(0); await saved(B.page);
  s = await waitFor(async () => { const x = await server(page, id); return x.data.nodes.find((n) => n.id === "a").text === "A from session one" ? x : null; });
  expect(s.data.nodes.map((n) => n.id).sort()).toEqual(["a", "b", "c"]);
  await B.ctx.close();
});

test("offline: edits are kept on the device, sent on reconnect, and a draft survives a closed tab", async ({ page, context }) => {
  await page.goto("/"); const id = await newCanvas(page, "offline", { nodes: [text("a", 0, 0, "Online card")], edges: [] }); await open(page, id); const v0 = (await server(page, id)).version;
  const draft = () => page.evaluate((key) => new Promise<any>((res) => { const r = indexedDB.open("note-local"); r.onsuccess = () => { try { const g = r.result.transaction("drafts").objectStore("drafts").get(key); g.onsuccess = () => res(g.result ?? null); g.onerror = () => res(null); } catch { res(null); } }; r.onerror = () => res(null); }), `canvas:${id}`);
  await context.setOffline(true);
  await page.locator("[data-testid='canvas-toolbar']").getByRole("button", { name: "Add text", exact: true }).click(); await typeInCard(page, "Written offline");
  await expect(page.locator("[data-testid='canvas-status']")).toHaveAttribute("data-status", "offline", { timeout: 20_000 }); await expect(page.locator("[data-testid='canvas-status']")).toContainText("Offline");
  const d = await waitFor(draft); expect(d.baseVersion).toBe(v0); expect(d.patch.data.nodes.map((n: any) => n.text)).toContain("Written offline"); expect(d.patch.base.nodes).toHaveLength(1);
  expect((await server(page, id).catch(() => null))?.version ?? v0).toBe(v0);
  await context.setOffline(false); await page.evaluate(() => window.dispatchEvent(new Event("online"))); await saved(page);
  const s1 = await waitVersion(page, id, v0); expect(s1.data.nodes.map((n) => n.text)).toContain("Written offline"); expect(await draft()).toBeNull();
  // second part: offline again, edit, close the tab before any reconnection
  await context.setOffline(true); await editCard(page, "a", "Changed offline, then the tab was closed"); await waitFor(async () => { const x = await draft(); return x && x.patch.data.nodes.some((n: any) => String(n.text).includes("tab was closed")) ? x : null; });
  await page.close(); await context.setOffline(false);
  const again = await context.newPage(); await open(again, id); await expect(again.getByText("Unsaved changes restored")).toBeVisible({ timeout: 15_000 }); await expect(card(again, "a")).toContainText("Changed offline"); await saved(again);
  const s2 = await waitVersion(again, id, s1.version); expect(s2.data.nodes.find((n) => n.id === "a").text).toBe("Changed offline, then the tab was closed"); expect(s2.data.nodes).toHaveLength(2);
});

test("selection, alignment, undo, clipboard, stacking, resize, context menu, minimap; unknown content preserved; the viewport alone never creates a version", async ({ page }) => {
  await page.goto("/");
  const alien = { id: "alien", kind: "hologram", x: 700, y: 300, w: 220, h: 90, z: 3, payload: { deep: [1, { k: null }] }, locked: true };
  const id = await newCanvas(page, "interactions", { theme: { grid: true }, nodes: [text("a", 100, 100, "Alpha"), text("b", 380, 160, "Beta", { z: 1 }), text("c", 660, 80, "Gamma", { z: 2, future: [1, 2] }), alien], edges: [{ id: "e1", from: "a", to: "c", weight: 7, kind: "zigzag" }] });
  await open(page, id); const v0 = (await server(page, id)).version; const s = surface(page); const box = (await s.boundingBox())!;
  await expect(card(page, "alien")).toContainText("Unsupported card"); await expect(card(page, "alien")).toContainText("hologram");
  // pan and zoom only: nothing is sent, the view is remembered on this device
  await page.mouse.move(box.x + 500, box.y + 400); await page.mouse.wheel(0, -200); await page.mouse.wheel(0, 100); await page.keyboard.down("Space").catch(() => {}); await page.keyboard.up("Space").catch(() => {});
  await s.focus(); await page.keyboard.press("Shift+Digit1"); await page.waitForTimeout(1800);
  expect((await server(page, id)).version, "a viewport change alone does not create a version").toBe(v0);
  expect(await page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? "null")?.zoom > 0, `note-canvas-vp-${id}`)).toBe(true);
  // marquee around Alpha and Beta, align top, undo / redo
  const a = await center(page, "a"), b = await center(page, "b");
  await page.mouse.move(a.b.x - 30, a.b.y - 30); await page.mouse.down(); await page.mouse.move(b.b.x + b.b.width + 10, b.b.y + b.b.height + 10, { steps: 6 }); await page.mouse.up();
  expect((await selection(page)).sort()).toEqual(["a", "b"]);
  const bar = page.locator("[data-testid='canvas-selection-bar']"); await bar.getByRole("button", { name: "Align and distribute" }).click(); await page.getByRole("menuitem", { name: "Align top" }).click();
  let d = await docOfCanvas(page); expect(d.nodes.find((n) => n.id === "b").y).toBe(100);
  await s.focus(); await page.keyboard.press("ControlOrMeta+z"); expect((await docOfCanvas(page)).nodes.find((n) => n.id === "b").y).toBe(160); await page.keyboard.press("ControlOrMeta+Shift+z"); expect((await docOfCanvas(page)).nodes.find((n) => n.id === "b").y).toBe(100);
  // duplicate, delete, copy / paste
  await page.keyboard.press("ControlOrMeta+d"); expect((await docOfCanvas(page)).nodes).toHaveLength(6); expect(await selection(page)).toHaveLength(2); await page.keyboard.press("Delete"); expect((await docOfCanvas(page)).nodes).toHaveLength(4);
  await card(page, "a").click(); await page.keyboard.press("ControlOrMeta+c"); await page.keyboard.press("ControlOrMeta+v"); d = await docOfCanvas(page); expect(d.nodes).toHaveLength(5); const pasted = d.nodes[4]; expect(pasted).toMatchObject({ kind: "text", text: "Alpha", x: 124, y: 124 }); expect(pasted.id).not.toBe("a");
  await page.keyboard.press("Backspace"); expect((await docOfCanvas(page)).nodes).toHaveLength(4);
  // stacking, arrow-key nudge, drag with the mouse, resize by a handle
  await card(page, "a").click(); await bar.getByRole("button", { name: "Bring to front" }).click(); d = await docOfCanvas(page); expect(d.nodes.find((n) => n.id === "a").z).toBeGreaterThan(Math.max(...d.nodes.filter((n) => n.id !== "a").map((n) => n.z)));
  await s.focus(); await page.keyboard.press("Shift+ArrowRight"); expect((await docOfCanvas(page)).nodes.find((n) => n.id === "a").x).toBe(110);
  const zoom = await local<number>(page, "(s) => s.viewport.zoom"); const g = await center(page, "c"); await page.mouse.move(g.x, g.y); await page.mouse.down(); await page.mouse.move(g.x + 60 * zoom, g.y + 90 * zoom, { steps: 8 }); await page.keyboard.down("Alt"); await page.mouse.move(g.x + 60 * zoom, g.y + 91 * zoom); await page.mouse.up(); await page.keyboard.up("Alt");
  d = await docOfCanvas(page); expect(Math.abs(d.nodes.find((n) => n.id === "c").x - 720)).toBeLessThan(3); expect(Math.abs(d.nodes.find((n) => n.id === "c").y - 171)).toBeLessThan(3);
  const h = (await page.locator(".cv-handle[data-handle='se']").boundingBox())!; await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2); await page.mouse.down(); await page.mouse.move(h.x + h.width / 2 + 80 * zoom, h.y + h.height / 2 + 40 * zoom, { steps: 5 }); await page.mouse.up();
  d = await docOfCanvas(page); expect(Math.abs(d.nodes.find((n) => n.id === "c").w - 280)).toBeLessThan(3); expect(Math.abs(d.nodes.find((n) => n.id === "c").h - 140)).toBeLessThan(3);
  // the unknown card can be moved like any other
  await card(page, "alien").click(); await page.keyboard.press("ArrowDown");
  // context menu: on empty space and on a card
  await s.click({ button: "right", position: { x: 60, y: box.height - 200 } }); await page.getByRole("menuitem", { name: "Add shape here" }).click(); expect((await docOfCanvas(page)).nodes.filter((n) => n.kind === "shape")).toHaveLength(1);
  await card(page, "b").click({ button: "right" }); await page.getByRole("menuitem", { name: "Delete" }).click(); expect((await docOfCanvas(page)).nodes.some((n) => n.id === "b")).toBe(false);
  // connection tools: select the connection, switch to right angles and to a plain line
  await page.locator(".cv-edge[data-edge='e1'] .cv-edge-hit").click({ force: true }); const ebar = page.locator("[data-testid='canvas-edge-bar']"); await ebar.getByRole("button", { name: "Right angles" }).click(); await ebar.getByRole("button", { name: "Plain line" }).click(); await expect(page.locator(".cv-edge[data-edge='e1'] .cv-edge-head")).toHaveCount(0);
  // minimap and zoom controls
  const before = await local<{ x: number; y: number; zoom: number }>(page, "(s) => s.viewport"); const mm = (await page.locator("[data-testid='canvas-minimap']").boundingBox())!; await page.mouse.click(mm.x + 12, mm.y + 12);
  const after = await local<{ x: number; y: number }>(page, "(s) => s.viewport"); expect(after.x !== before.x || after.y !== before.y).toBe(true);
  await page.getByRole("button", { name: "Zoom in", exact: true }).click(); await page.waitForTimeout(300); expect(await local<number>(page, "(s) => s.viewport.zoom")).toBeGreaterThan(before.zoom); await page.getByRole("button", { name: "Zoom to fit" }).click(); await page.waitForTimeout(400);
  await saved(page); const end = await waitVersion(page, id, v0);
  // everything this client does not know came through the whole session untouched
  const alienOut = end.data.nodes.find((n) => n.id === "alien"); expect(alienOut).toEqual({ ...alien, y: 301 }); expect(end.data.theme).toEqual({ grid: true }); expect(end.data.nodes.find((n) => n.id === "c").future).toEqual([1, 2]);
  expect(end.data.edges[0]).toEqual({ id: "e1", from: "a", to: "c", weight: 7, kind: "line", route: "orthogonal" });
});

test("entry points and exports: command center, canvasLink block, listing with its icon, page and file drops, PNG / SVG / Markdown", async ({ page }) => {
  test.setTimeout(120_000);
  await sql`delete from pages where title = 'New canvas'`; // leftovers of other tests would be offered as pages of that name
  await page.goto("/");
  // command center → New canvas
  await page.keyboard.press("ControlOrMeta+k"); await page.locator("[cmdk-input]").fill("New canvas"); await page.getByRole("option", { name: /New canvas/ }).first().click();
  await page.waitForURL(/\/p\/[0-9a-f-]{36}/); await ready(page).waitFor(); const id = page.url().split("/p/")[1].slice(0, 36); made.push(id);
  await page.getByLabel("Canvas title").fill(`E2E-canvas entry ${uid()}`); await page.waitForTimeout(1200);
  const title = await page.getByLabel("Canvas title").inputValue(); await expect(page.locator("nav[aria-label='Workspace']").first().getByText(title)).toBeVisible({ timeout: 10_000 });
  await expect(page.locator("nav[aria-label='Workspace']").first().locator(`a[href='/p/${id}'] [data-testid='canvas-icon']`).first()).toBeVisible();
  // drop a page dragged from the sidebar, a link and an image file from the desktop
  const other = await apiCall(page, "POST", "/api/pages", { title: `E2E-canvas dropped ${uid()}`, content: docOf(para("dropped page body")) }); made.push(other.body.id);
  const drop = (kind: "uri" | "file", value: string, y = 300) => page.evaluate(async ([k, v, top]) => {
    const el = document.querySelector("[data-testid='canvas-surface']")!; const r = el.getBoundingClientRect(); const dt = new DataTransfer();
    if (k === "uri") { dt.setData("text/uri-list", v); dt.setData("text/plain", v); } else { const bin = atob(v); const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i); dt.items.add(new File([bytes], "dropped.png", { type: "image/png" })); }
    for (const type of ["dragover", "drop"]) el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.left + (k === "uri" ? 300 : 700), clientY: r.top + (top as number) }));
  }, [kind, value, y] as const);
  await drop("uri", `${ORIGIN}/p/${other.body.id}`); await expect(page.locator("[data-testid='canvas-page-card'] .cv-title")).toContainText(other.body.title);
  await drop("uri", "https://example.org/dropped-link", 520); await expect(page.locator(".cv-node[data-kind='link']")).toContainText("example.org");
  await drop("file", PNG.toString("base64")); await expect(page.locator(".cv-node[data-kind='image'] img")).toBeVisible({ timeout: 15_000 });
  await page.locator("[data-testid='canvas-toolbar']").getByRole("button", { name: "Add text", exact: true }).click(); await typeInCard(page, "Exported text"); await saved(page);
  const s1 = await waitFor(async () => { const s = await server(page, id); return s.data.nodes.length === 4 ? s : null; }); expect(s1.data.nodes.map((n) => n.kind).sort()).toEqual(["image", "link", "page", "text"]);
  // exports
  const exportAs = async (item: string) => { const [dl] = await Promise.all([page.waitForEvent("download"), (async () => { await page.locator("[data-testid='canvas-toolbar']").getByRole("button", { name: "Export" }).click(); await page.getByRole("menuitem", { name: item }).click(); })()]); const p = await dl.path(); return { name: dl.suggestedFilename(), data: fs.readFileSync(p!) }; };
  const svg = await exportAs("Export as SVG"); expect(svg.name).toMatch(/\.svg$/); const svgText = svg.data.toString("utf8"); expect(svgText.startsWith("<svg")).toBe(true); expect(svgText).toContain("Exported text"); expect(svgText).toContain(other.body.title.slice(0, 12)); expect(svgText).toContain("data:image/png;base64,"); expect((svgText.match(/<g data-id=/g) ?? []).length).toBe(4);
  const md = await exportAs("Export as Markdown outline"); const mdText = md.data.toString("utf8"); expect(mdText).toContain(`# ${title}`); expect(mdText).toContain("## Cards"); expect(mdText).toContain(`- **Page** — [${other.body.title}](/p/${other.body.id})`); expect(mdText).toContain("- **Text** — Exported text"); expect(mdText).toContain("## Connections");
  const png = await exportAs("Export as PNG"); expect(png.name).toMatch(/\.png$/); expect(png.data.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a"); expect(png.data.length).toBeGreaterThan(2000);
  // double-click on a page card opens the note
  await page.locator("[data-testid='canvas-page-card']").dblclick(); await page.waitForURL(new RegExp(`/p/${other.body.id}`)); await expect(page.locator(".note-editor .ProseMirror").first()).toContainText("dropped page body");
  // a canvasLink block in a document opens the canvas
  const host = await apiCall(page, "POST", "/api/pages", { title: `E2E-canvas host ${uid()}`, content: docOf(para("before"), { type: "canvasLink", attrs: { pageId: id } }) }); made.push(host.body.id);
  await page.goto(`/p/${host.body.id}`); await page.locator(".canvas-card").click(); await page.waitForURL(new RegExp(`/p/${id}`)); await ready(page).waitFor(); await expect(page.locator(".cv-node")).toHaveCount(4);
  // a trashed canvas opens read-only
  await apiCall(page, "DELETE", `/api/pages/${id}`); await page.reload(); await ready(page).waitFor(); await expect(page.getByText("This canvas is in the trash (read-only).")).toBeVisible(); await expect(page.locator("[data-testid='canvas-toolbar']").getByRole("button", { name: "Add text", exact: true })).toHaveCount(0);
});

test("performance probe: 1 000 cards — only what is visible is rendered; pan, zoom and drag frame times", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("/");
  const N = 1000, COLS = 40; const kinds = ["text", "text", "shape", "link", "math", "table"];
  const nodes = Array.from({ length: N }, (_, i) => { const k = kinds[i % kinds.length]; return { id: `n${i}`, kind: k, x: (i % COLS) * 300, y: Math.floor(i / COLS) * 180, w: 240, h: 120, z: i, ...(k === "text" ? { text: `## Card ${i}\nSome **Markdown** text for card number ${i}.` } : k === "shape" ? { shape: ["rect", "ellipse", "diamond"][i % 3], text: `S${i}`, color: "#2f5ddb" } : k === "link" ? { url: `https://example.org/${i}`, text: `Link ${i}` } : k === "math" ? { latex: `x_{${i}}^2 + y^2` } : { text: `| A | B |\n| --- | --- |\n| ${i} | ${i * 2} |` }) }; });
  const edges = Array.from({ length: N - 1 }, (_, i) => ({ id: `e${i}`, from: `n${i}`, to: `n${i + 1}`, ...(i % 7 === 0 ? { label: `l${i}` } : {}) }));
  const id = await newCanvas(page, "perf 1000", { nodes, edges });
  await page.evaluate((k) => localStorage.setItem(k, JSON.stringify({ x: 2000, y: 1500, zoom: 1 })), `note-canvas-vp-${id}`);
  const t0 = Date.now(); await open(page, id); await expect(page.locator(".cv-node").first()).toBeVisible(); const openMs = Date.now() - t0;
  const rendered = () => page.evaluate(() => ({ nodes: document.querySelectorAll(".cv-node").length, lod: document.querySelectorAll(".cv-node[data-lod]").length, edges: document.querySelectorAll(".cv-edge").length }));
  const atOne = await rendered(); expect(atOne.nodes).toBeGreaterThan(8); expect(atOne.nodes, "culling: far fewer than 1 000 cards in the DOM at 100 %").toBeLessThan(160);
  /** Drives `frames` animation frames, calling `step(i)` before each, and returns the frame intervals. */
  const probe = (kind: "pan" | "zoom" | "sweep" | "drag", frames: number) => page.evaluate(async ([k, n]) => {
    const el = document.querySelector("[data-testid='canvas-surface']") as HTMLElement; const r = el.getBoundingClientRect(); const store = (window as any).__canvas.store; const M = (window as any).__canvas.model;
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2; const dts: number[] = []; let dragId: string | null = null; let base = store.doc;
    if (k === "drag") { const vis = M.visibleRect(store.viewport, store.size); dragId = store.doc.nodes.find((x: any) => x.x > vis.x + 100 && x.y > vis.y + 100 && x.x < vis.x + vis.w - 300)?.id ?? store.doc.nodes[0].id; store.select([dragId]); base = store.doc; }
    const next = () => new Promise<number>((res) => requestAnimationFrame(res));
    let last = await next();
    for (let i = 0; i < n; i++) {
      if (k === "pan") el.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, clientX: cx, clientY: cy, deltaX: 18 * Math.cos(i / 15), deltaY: 14.5 * Math.sin(i / 11) + 9.5 }));
      else if (k === "zoom" || k === "sweep") el.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, clientX: cx, clientY: cy, deltaY: (i < n / 2 ? 1 : -1) * (k === "zoom" ? 1 : 4), ctrlKey: true }));
      else store.apply(() => M.moveNodes(base, [dragId], i * 3, Math.sin(i / 8) * 60), "transient");
      const t = await next(); dts.push(t - last); last = t;
    }
    if (k === "drag") store.cancel();
    const sorted = [...dts].sort((a, b) => a - b); const avg = dts.reduce((s, x) => s + x, 0) / dts.length;
    return { frames: n, avg: +avg.toFixed(2), p50: +sorted[Math.floor(n * 0.5)].toFixed(2), p95: +sorted[Math.floor(n * 0.95)].toFixed(2), max: +sorted[n - 1].toFixed(2), over33: dts.filter((x) => x > 33.4).length, fps: +(1000 / avg).toFixed(1) };
  }, [kind, frames] as const);
  const results: Record<string, unknown> = { cards: N, connections: N - 1, openMs, renderedAt100: atOne };
  results.panAt100 = await probe("pan", 240); results.zoomAround100 = await probe("zoom", 180); results.dragAt100 = await probe("drag", 180);
  // the hard case: pinch from 100 % out to where most cards turn into placeholders (≈ 3 %/frame) and back, hundreds of cards entering the view
  results.zoomSweep100to3 = await probe("sweep", 180);
  results.renderedAfterPan = await rendered();
  // everything on screen at once: zoom to fit (cards become placeholders)
  await surface(page).focus(); await page.keyboard.press("Shift+Digit1"); await page.waitForTimeout(900);
  const atFit = await rendered(); results.renderedAtFit = atFit; results.zoomAtFit = await local<number>(page, "(s) => +s.viewport.zoom.toFixed(3)");
  expect(atFit.nodes).toBe(N); expect(atFit.lod, "at this scale the cards are light placeholders").toBe(N);
  results.panAtFit = await probe("pan", 180); results.zoomAtFit2 = await probe("zoom", 120); results.dragAtFit = await probe("drag", 120);
  fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, "desktop-light-1000-cards.png") });
  // "Tidy up" on 1 000 connected cards (force-directed, 60 steps) — measured in the page
  results.tidyMs = await page.evaluate(() => { const c = (window as any).__canvas; const t = performance.now(); c.model.tidyLayout(c.store.doc, { seed: 1 }); return Math.round(performance.now() - t); });
  fs.writeFileSync(path.join(SHOTS, "..", "perf-1000.json"), JSON.stringify(results, null, 1)); console.log("CANVAS PERF " + JSON.stringify(results));
  for (const k of ["panAt100", "zoomAround100", "dragAt100", "panAtFit"]) { const r = results[k] as { p95: number; avg: number }; expect(r.avg, `${k} average frame time`).toBeLessThan(20); expect(r.p95, `${k} p95 frame time`).toBeLessThan(34); }
  expect((await server(page, id)).version, "the probe changed nothing").toBe(2);
});
