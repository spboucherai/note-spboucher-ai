/**
 * file: tests/e2e/next-web-phones.spec.ts
 * description: SP Note Next Generation on phones (360×740, 375×667, 430×932, touch): a page holding every new block never overflows
 *   horizontally, the blocks render and stay usable with a finger, the Universal Command Center has a touch entry point, and the
 *   phone layout rules (one scroll container, keyboard inset) are intact.
 * author: Simon-Pierre Boucher — contact@spboucher.ai
 */
import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import { apiCall, docOf, para, expectNoHorizontalOverflow, sql, PDF } from "./helpers";

const made: string[] = [];
const newPage = async (page: Page, title: string, content?: unknown) => { const r = await apiCall(page, "POST", "/api/pages", { title: `E2E-nextp ${title} ${Date.now().toString(36)}`, ...(content ? { content } : {}) }); expect(r.status).toBe(201); made.push(r.body.id); return r.body as { id: string }; };
test.afterAll(async () => { if (made.length) await sql`delete from pages where id = any(${made}::uuid[]) or title like 'E2E-nextp %'`; });
const TYPES = ["mermaid", "chart", "runCode", "bibliography", "queryView", "blockRef", "drawing", "pdf", "audio", "canvasLink"];

test("a page with every new block: rendered, no horizontal overflow, one scroll container", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/");
  // real attachments so the heavy blocks render their content, not only their empty state
  const up = await page.request.post("/api/attachments", { multipart: { file: { name: "hello.pdf", mimeType: "application/pdf", buffer: PDF } }, headers: { origin: process.env.E2E_BASE_URL ?? "http://localhost:8481" } }); expect(up.status()).toBe(201); const pdf = (await up.json()).id;
  const nodes = JSON.parse(fs.readFileSync("tests/e2e/next/all-nodes.json", "utf8")) as any[];
  const wide = { type: "chart", attrs: { kind: "bar", title: "A very long chart title that must wrap or truncate on a narrow phone screen", columns: ["Category with a long name", ...Array.from({ length: 9 }, (_, i) => `Series ${i + 1}`)], rows: Array.from({ length: 14 }, (_, r) => [`Row ${r + 1} with a long label`, ...Array.from({ length: 9 }, (_, i) => (r + 1) * (i + 2))]), x: "Category with a long name", y: Array.from({ length: 9 }, (_, i) => `Series ${i + 1}`), source: null } };
  const code = { type: "runCode", attrs: { language: "javascript", code: "const averyveryverylongidentifierthatdoesnotwrap = 'x'.repeat(400); console.log(averyveryverylongidentifierthatdoesnotwrap);", output: { text: "x".repeat(600), error: false, ms: 1, at: "2026-11-19T00:00:00.000Z" } } };
  const withPdf = nodes.map((n) => (n.type === "pdf" ? { ...n, attrs: { ...n.attrs, attachmentId: pdf, name: "hello.pdf", annotations: [{ id: "a1", page: 1, kind: "highlight", color: "#f5c542", rects: [[0.1, 0.45, 0.4, 0.07]], text: "Hello note", note: "a note that is long enough to wrap on a phone: ".repeat(3), createdAt: "2026-11-19T00:00:00.000Z" }] } } : n));
  const p = await newPage(page, "all blocks", docOf(...withPdf, wide, code, { type: "unknownFutureBlock", attrs: { some: "data ".repeat(40) } }, para("end")));
  await page.goto(`/p/${p.id}`); await page.locator(".note-editor .ProseMirror").first().waitFor();
  for (const t of TYPES) await expect(page.locator(`.nb[data-node='${t}']`).first(), t).toBeAttached();
  await expect(page.locator(".nb[data-node='unknownBlock']")).toBeAttached(); await expect(page.locator("[data-node='citation']")).toBeAttached();
  await page.locator(".nb[data-node='mermaid']").scrollIntoViewIfNeeded(); // heavy blocks load when they come near the viewport
  await expect(page.getByTestId("mermaid-render").locator("svg")).toBeAttached({ timeout: 25_000 });
  await page.locator(".nb[data-node='pdf']").scrollIntoViewIfNeeded(); await expect(page.getByTestId("pdf-canvas")).toBeVisible({ timeout: 30_000 }); await expect(page.getByTestId("pdf-annotation")).toHaveCount(1, { timeout: 20_000 });
  await expect(page.getByTestId("editor-lock")).toHaveCount(0);
  // walk the page top to bottom: nothing sticks out at any scroll position
  const steps = await page.evaluate(() => { const m = document.getElementById("main-scroll")!; return Math.ceil(m.scrollHeight / m.clientHeight); });
  for (let i = 0; i <= steps; i++) { await page.evaluate((k) => { const m = document.getElementById("main-scroll")!; m.scrollTop = k * m.clientHeight; }, i); await page.waitForTimeout(120); await expectNoHorizontalOverflow(page); }
  const offenders = await page.evaluate(() => { const w = document.documentElement.clientWidth; return [...document.querySelectorAll<HTMLElement>(".note-editor .nb, .note-editor .callout, .note-editor .ai-block")].filter((el) => { const r = el.getBoundingClientRect(); return r.right > w + 1 || r.left < -1; }).map((el) => el.getAttribute("data-node") ?? el.className); }); expect(offenders).toEqual([]);
  // one scroll container (audit §9.8): the document itself does not scroll
  expect(await page.evaluate(() => ({ doc: document.documentElement.scrollHeight <= window.innerHeight + 1, main: document.getElementById("main-scroll")!.scrollHeight > document.getElementById("main-scroll")!.clientHeight }))).toEqual({ doc: true, main: true });
  // touch targets of the block controls
  const small = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>(".note-editor .nb-btn")].filter((b) => b.offsetParent && b.getBoundingClientRect().height < 43.5).length); expect(small, "block buttons are at least 44 px high on touch").toBe(0);
});

test("touch entry to the Universal Command Center; drawing and capture sheets fit the screen", async ({ page }) => {
  await page.goto("/"); const p = await newPage(page, "touch", docOf({ type: "drawing", attrs: { ink: null, preview: null, pk: null, width: 0, height: 0, background: "none" } }, para("end")));
  await page.goto(`/p/${p.id}`); await page.locator(".note-editor .ProseMirror").first().waitFor();
  const entry = page.getByRole("button", { name: "Command center" }); await expect(entry).toBeVisible(); const eb = (await entry.boundingBox())!; expect(eb.height).toBeGreaterThanOrEqual(44); expect(eb.width).toBeGreaterThanOrEqual(44);
  await entry.tap(); const dlg = page.getByRole("dialog", { name: "Command center" }); await expect(dlg).toBeVisible(); await expectNoHorizontalOverflow(page);
  const box = (await dlg.locator("[cmdk-root]").boundingBox())!; expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width + 0.5);
  await dlg.locator("[cmdk-input]").fill("inbx"); const first = dlg.locator("[cmdk-item]").first(); await expect(first).toContainText("Inbox"); await page.waitForTimeout(350); /* the sheet's scale-in is over */ expect((await first.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await first.tap(); await expect(page).toHaveURL(/\/inbox/);
  await page.goto(`/p/${p.id}`); await page.locator(".nb[data-node='drawing']").getByRole("button", { name: "Draw" }).tap();
  const canvas = page.getByTestId("ink-canvas"); await expect(canvas).toBeVisible(); const cb = (await canvas.boundingBox())!; expect(cb.x).toBeGreaterThanOrEqual(0); expect(cb.x + cb.width).toBeLessThanOrEqual(page.viewportSize()!.width + 0.5); await expectNoHorizontalOverflow(page);
  await expect(page.getByRole("button", { name: "Save drawing" })).toBeVisible();
});
