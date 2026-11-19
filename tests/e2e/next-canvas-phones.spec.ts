/**
 * file: tests/e2e/next-canvas-phones.spec.ts
 * description: Infinite Canvas on phones (360×740, 375×667, 430×932, touch) — a dedicated touch interface: dock with large targets,
 *   bottom sheets to add and edit cards, outline / list mode (open, edit text, reorder, locate), connect by tapping, touch pan and
 *   pinch; the app chrome never overflows horizontally.
 * author: Simon-Pierre Boucher — contact@spboucher.ai
 */
import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { apiCall, expectNoHorizontalOverflow, sql } from "./helpers";

const SHOTS = process.env.CANVAS_SHOTS ?? path.join(os.homedir(), "dev/note-next-c-data/shots");
const made: string[] = []; const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const text = (id: string, x: number, y: number, t: string, extra: Record<string, unknown> = {}) => ({ id, kind: "text", x, y, w: 200, h: 100, z: 0, text: t, ...extra });
async function newCanvas(page: Page, title: string, data: { nodes: unknown[]; edges: unknown[] }) {
  const r = await apiCall(page, "POST", "/api/pages", { title: `E2E-canvasp ${title} ${uid()}`, type: "canvas" }); expect(r.status).toBe(201); made.push(r.body.id);
  const put = await apiCall(page, "PUT", `/api/canvases/${r.body.id}`, { data: { format: "spn-canvas-1", viewport: { x: 0, y: 0, zoom: 1 }, ...data }, baseVersion: 1 }); expect(put.status, JSON.stringify(put.body)).toBe(200);
  return r.body.id as string;
}
const server = async (page: Page, id: string) => (await apiCall(page, "GET", `/api/canvases/${id}`)).body as { data: { nodes: any[]; edges: any[] }; version: number };
const saved = (page: Page) => expect(page.locator("[data-testid='canvas-status']")).toHaveAttribute("data-status", "saved", { timeout: 20_000 });
const waitFor = async <T,>(fn: () => Promise<T | null | undefined | false>, ms = 15_000): Promise<T> => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error("condition not met in time"); await new Promise((r) => setTimeout(r, 200)); } };
const local = <T,>(page: Page, fn: string): Promise<T> => page.evaluate(`(() => { const c = window.__canvas; return (${fn})(c.store); })()`) as Promise<T>;
test.afterAll(async () => { if (made.length) await sql`delete from pages where id = any(${made}::uuid[])`; });

test("phone canvas: touch interface, outline mode, sheets, connect by tapping, no horizontal overflow", async ({ page }, info) => {
  test.setTimeout(120_000); const w = page.viewportSize()!.width;
  await page.goto("/");
  const id = await newCanvas(page, "phone", { nodes: [text("a", 0, 0, "First card"), text("b", 260, 40, "Second card", { color: "#008b4e" }), { id: "s", kind: "shape", shape: "diamond", x: 60, y: 220, w: 160, h: 120, z: 2, text: "Decide" }], edges: [{ id: "e1", from: "a", to: "b", label: "then" }] });
  await page.goto(`/p/${id}`); await page.locator("[data-testid='canvas-page'][data-state='ready']").waitFor(); const v0 = (await server(page, id)).version;
  const surface = page.locator("[data-testid='canvas-surface']"); await surface.waitFor(); await expect(page.locator(".cv-node")).toHaveCount(3);
  // a touch layout, not the desktop one: dock and view switch, no toolbar / minimap / zoom bar
  const dock = page.locator("[data-testid='canvas-dock']"); await expect(dock).toBeVisible(); await expect(page.getByRole("tab", { name: "List" })).toBeVisible();
  await expect(page.locator("[data-testid='canvas-toolbar']")).toHaveCount(0); await expect(page.locator("[data-testid='canvas-minimap']")).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
  for (const b of await dock.getByRole("button").all()) { const box = (await b.boundingBox())!; expect(box.height, "dock targets are at least 44 px tall").toBeGreaterThanOrEqual(44); expect(box.width).toBeGreaterThanOrEqual(44); }
  // the whole canvas was fitted into the narrow view on first open
  const fit = await local<{ zoom: number }>(page, "(s) => s.viewport"); expect(fit.zoom).toBeLessThan(1);
  // tap selects; the dock shows the actions of the selection; handles are finger-sized
  const tap = async (sel: string) => { const b = (await page.locator(sel).boundingBox())!; await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2); };
  await tap(".cv-node[data-id='a']"); expect(await local<string[]>(page, "(s) => s.get().selection")).toEqual(["a"]);
  await expect(dock.getByRole("button", { name: "Edit" })).toBeVisible(); await expect(dock.getByRole("button", { name: "Connect" })).toBeVisible();
  const handle = (await page.locator(".cv-handle[data-handle='se']").boundingBox())!; expect(handle.width).toBeGreaterThanOrEqual(15);
  fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, `phone-${w}-light-canvas.png`) });
  // connect by tapping: Connect, then the target card
  await dock.getByRole("button", { name: "Connect" }).click(); await expect(page.locator("[data-testid='canvas-connect-hint']")).toBeVisible(); await tap(".cv-node[data-id='s']");
  await expect(page.locator(".cv-edge")).toHaveCount(2); await expect(page.locator("[data-testid='canvas-connect-hint']")).toHaveCount(0);
  // one finger on empty space pans; two fingers pinch (CDP touch events)
  const box = (await surface.boundingBox())!; const cdp = await page.context().newCDPSession(page); const before = await local<{ x: number; y: number; zoom: number }>(page, "(s) => s.viewport");
  const touch = (type: string, pts: { x: number; y: number; id: number }[]) => cdp.send("Input.dispatchTouchEvent", { type: type as any, touchPoints: pts.map((p) => ({ x: p.x, y: p.y, id: p.id })) });
  const ex = box.x + box.width - 30, ey = box.y + box.height - 120; // an empty corner
  await touch("touchStart", [{ x: ex, y: ey, id: 1 }]); for (let i = 1; i <= 5; i++) await touch("touchMove", [{ x: ex - i * 12, y: ey - i * 8, id: 1 }]); await touch("touchEnd", []);
  const panned = await local<{ x: number; y: number; zoom: number }>(page, "(s) => s.viewport"); expect(panned.x).toBeGreaterThan(before.x + 20); expect(panned.zoom).toBe(before.zoom);
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await touch("touchStart", [{ x: cx - 40, y: cy, id: 1 }, { x: cx + 40, y: cy, id: 2 }]); for (let i = 1; i <= 6; i++) await touch("touchMove", [{ x: cx - 40 - i * 10, y: cy, id: 1 }, { x: cx + 40 + i * 10, y: cy, id: 2 }]); await touch("touchEnd", []);
  const pinched = await local<{ zoom: number }>(page, "(s) => s.viewport"); expect(pinched.zoom).toBeGreaterThan(panned.zoom * 1.5);
  await dock.getByRole("button", { name: "Fit" }).click(); await page.waitForTimeout(400);
  // dragging a card with one finger moves it
  const a0 = (await local<any>(page, "(s) => s.doc.nodes.find((n) => n.id === 'b')")); const bb = (await page.locator(".cv-node[data-id='b']").boundingBox())!; const bx = bb.x + bb.width / 2, by = bb.y + bb.height / 2;
  await touch("touchStart", [{ x: bx, y: by, id: 1 }]); for (let i = 1; i <= 6; i++) await touch("touchMove", [{ x: bx, y: by + i * 10, id: 1 }]); await touch("touchEnd", []);
  const a1 = (await local<any>(page, "(s) => s.doc.nodes.find((n) => n.id === 'b')")); expect(a1.y).toBeGreaterThan(a0.y + 20);
  // add from the bottom sheet (large buttons), edit in a sheet with large fields
  await dock.getByRole("button", { name: "Add" }).click(); const add = page.locator("[data-testid='canvas-add-sheet']"); await expect(add).toBeVisible(); await expectNoHorizontalOverflow(page);
  for (const b of await add.locator(".cv-add-grid button").all()) expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await page.screenshot({ path: path.join(SHOTS, `phone-${w}-light-add-sheet.png`) });
  await add.getByRole("button", { name: "Text" }).click(); const form = page.locator("[data-testid='canvas-card-form']"); await expect(form).toBeVisible();
  await form.getByLabel("Card text").fill("Added on the phone"); await expectNoHorizontalOverflow(page); await form.getByRole("button", { name: "Done" }).click(); await expect(page.locator(".cv-node")).toHaveCount(4);
  // outline / list mode: every card, its kind and connections; open + edit text; reorder; locate
  await page.getByRole("tab", { name: "List" }).click(); const rows = page.locator("[data-testid='canvas-outline-row']"); await expect(rows).toHaveCount(4); await expectNoHorizontalOverflow(page);
  await expect(rows.nth(0)).toContainText("First card"); await expect(rows.nth(0)).toContainText("→ 2"); await expect(rows.nth(1)).toContainText("← 1"); await expect(rows.nth(2)).toContainText("Decide");
  await page.screenshot({ path: path.join(SHOTS, `phone-${w}-light-outline.png`) });
  if (info.project.name.endsWith("375")) { await page.evaluate(() => (window as any).__noteUI().setTheme("dark")); await page.waitForTimeout(250); await page.screenshot({ path: path.join(SHOTS, `phone-${w}-dark-outline.png`) }); await page.getByRole("tab", { name: "Canvas" }).click(); await page.waitForTimeout(250); await page.screenshot({ path: path.join(SHOTS, `phone-${w}-dark-canvas.png`) }); await page.getByRole("tab", { name: "List" }).click(); await page.evaluate(() => (window as any).__noteUI().setTheme("light")); }
  await rows.nth(1).locator(".cv-outline-main").click(); await expect(form).toBeVisible(); await form.getByLabel("Card text").fill("Second card, edited from the list"); await form.getByRole("button", { name: "Done" }).click();
  await expect(rows.nth(1)).toContainText("Second card, edited from the list");
  await rows.nth(0).getByRole("button", { name: /Move “First card” down/ }).click(); await expect(rows.nth(1)).toContainText("First card"); await expect(rows.nth(0)).toContainText("edited from the list");
  await rows.nth(2).getByRole("button", { name: /Show “Decide” on the canvas/ }).click(); await expect(surface).toBeVisible(); expect(await local<string[]>(page, "(s) => s.get().selection")).toEqual(["s"]);
  await expectNoHorizontalOverflow(page);
  // everything was saved through the normal path
  await saved(page); const s = await waitFor(async () => { const x = await server(page, id); return x.version > v0 && x.data.nodes.length === 4 && x.data.nodes[0].id === "b" ? x : null; });
  expect(s.data.nodes.map((n) => n.id).slice(0, 3)).toEqual(["b", "a", "s"]); expect(s.data.nodes[0].text).toBe("Second card, edited from the list"); expect(s.data.nodes[3].text).toBe("Added on the phone");
  expect(s.data.edges.map((e) => `${e.from}>${e.to}`).sort()).toEqual(["a>b", "a>s"]);
});
