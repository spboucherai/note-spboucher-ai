/**
 * file: tests/e2e/next-web.spec.ts
 * description: SP Note Next Generation, web workstream — editor safety (unknown content, content-error read-only), every new block
 *   (insert → reload → still there and rendered), sandboxed code, drawing, PDF annotations, voice note, rich tasks, Markdown paste,
 *   motion + reduced motion, Universal Command Center, panels, design tokens. Desktop Chromium, scratch database only.
 * author: Simon-Pierre Boucher — contact@spboucher.ai
 */
import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { apiCall, docOf, para, PDF, sql, ORIGIN, expectNoHorizontalOverflow } from "./helpers";

const made: string[] = [];
/** A task id of this run: a fixed id left behind by an interrupted run made the next run fail (the id was taken). */
const TASK_ID = crypto.randomUUID();
const newPage = async (page: Page, title: string, content?: unknown) => { const r = await apiCall(page, "POST", "/api/pages", { title: `E2E-next ${title} ${Date.now().toString(36)}`, ...(content ? { content } : {}) }); expect(r.status).toBe(201); made.push(r.body.id); return r.body as { id: string; version: number; title: string }; };
const server = async (page: Page, id: string) => (await apiCall(page, "GET", `/api/pages/${id}`)).body;
const saved = (page: Page) => expect(page.getByRole("status").filter({ hasText: /^Saved/ }).first()).toBeVisible({ timeout: 15_000 });
const editor = (page: Page) => page.locator("#main-scroll .note-editor .ProseMirror").first();
const open = async (page: Page, id: string) => { await page.goto(`/p/${id}`); await editor(page).waitFor(); };
const find = (n: any, type: string): any[] => [...(n?.type === type ? [n] : []), ...((n?.content ?? []) as any[]).flatMap((c) => find(c, type))];
const waitFor = async <T>(fn: () => Promise<T | null | undefined | false>, ms = 15_000): Promise<T> => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error("condition not met in time"); await new Promise((r) => setTimeout(r, 300)); } };
/** Put the caret in a fresh empty paragraph at the very end of the page. */
const newLine = async (page: Page) => { await editor(page).locator("> p").last().click(); await page.keyboard.press("ControlOrMeta+End"); await page.keyboard.press(process.platform === "darwin" ? "Meta+ArrowDown" : "Control+End"); await page.keyboard.press("Enter"); };
const slash = async (page: Page, query: string) => { await newLine(page); await page.keyboard.type(`/${query}`); await expect(page.locator("[id^='sg-']").first()).toBeVisible(); await page.keyboard.press("Enter"); };
test.afterAll(async () => { await sql`delete from tasks where id = ${TASK_ID} or page_id = any(${made}::uuid[]) or page_id in (select id from pages where title like 'E2E-next %')`; if (made.length) await sql`delete from pages where id = any(${made}::uuid[]) or title like 'E2E-next %'`; });

test("unknown content: a node type, a mark and an attr this client does not know survive an edit byte-identical", async ({ page }) => {
  await page.goto("/");
  const alien = { type: "hologram3000", attrs: { beam: { hue: 271, layers: ["a", "b"] }, id: "alienBlock1" }, content: [{ type: "paragraph", content: [{ type: "text", text: "from the future" }] }] };
  const marked = { type: "paragraph", content: [{ type: "text", text: "shimmering", marks: [{ type: "shimmer", attrs: { speed: 2 } }] }, { type: "text", text: " and " }, { type: "inlineGadget", attrs: { k: 1 } }] };
  const withAttr = { type: "callout", attrs: { kind: "note", icon: "💡", futureAttr: { keep: true } }, content: [para("known block, unknown attribute")] };
  const p = await newPage(page, "unknown", docOf(para("before"), alien, marked, withAttr, para("after")));
  const before = await server(page, p.id);
  await open(page, p.id);
  await expect(page.locator(".nb[data-node='unknownBlock']")).toContainText("hologram3000");
  await expect(page.getByText("This block was made with a newer version of SP Note.")).toBeVisible();
  await expect(page.locator(".unknown-mark")).toHaveText("shimmering"); await expect(page.locator(".unknown-inline")).toContainText("inlineGadget");
  await expect(page.getByTestId("editor-lock")).toHaveCount(0);
  await editor(page).locator("> p").first().click(); await page.keyboard.press("End"); await page.keyboard.type(" — typed elsewhere"); await saved(page);
  const after = await waitFor(async () => { const s = await server(page, p.id); return s.version > before.version ? s : null; });
  expect(JSON.stringify(after.content)).toContain("typed elsewhere");
  const pick = (doc: any) => ({ alien: JSON.stringify(find(doc, "hologram3000")[0]), gadget: JSON.stringify(find(doc, "inlineGadget")[0]), marks: JSON.stringify(doc.content[2].content[0].marks), attr: JSON.stringify(find(doc, "callout")[0].attrs) });
  expect(pick(after.content)).toEqual(pick(before.content)); // byte-identical JSON for everything unknown
  expect(JSON.stringify(after.content)).not.toMatch(/unknownBlock|unknownInline|unknownMark|xattrs/); // nothing internal leaks into the stored document
  // and it is still there after a reload
  await page.reload(); await expect(page.locator(".nb[data-node='unknownBlock']")).toBeVisible();
});

test("content error: a document that fails the schema check opens read-only and is never autosaved", async ({ page }) => {
  await page.goto("/");
  // a block nested where the schema allows inline content only: the structure of a future version
  const bad = docOf(para("kept safe"), { type: "paragraph", content: [{ type: "paragraph", content: [{ type: "text", text: "nested block" }] }] }, { type: "table", content: [{ type: "tableRow", content: [{ type: "futureCell", attrs: { span: 2 } }] }] });
  const p = await newPage(page, "content error", bad); const before = await server(page, p.id);
  await open(page, p.id);
  const lock = page.getByTestId("editor-lock"); await expect(lock).toBeVisible(); await expect(lock).toContainText("Read-only — this page holds newer content"); await expect(lock).toContainText("Nothing was changed");
  await expect(editor(page)).toHaveAttribute("contenteditable", "false");
  await editor(page).click({ force: true }); await page.keyboard.type("must not be saved"); await page.waitForTimeout(2500);
  // leaving the page (last-chance save path) must not write either
  await page.goto("/"); await page.waitForTimeout(800);
  const after = await server(page, p.id); expect(after.version).toBe(before.version); expect(JSON.stringify(after.content)).toBe(JSON.stringify(before.content));
  expect((await sql`select count(*)::int as n from page_versions where page_id = ${p.id}`)[0].n).toBe(0);
  // the title is still editable and saving it does not touch the content
  await open(page, p.id); await page.getByLabel("Page title").fill("E2E-next renamed while locked"); await saved(page);
  const renamed = await waitFor(async () => { const s = await server(page, p.id); return s.title === "E2E-next renamed while locked" ? s : null; });
  expect(JSON.stringify(renamed.content)).toBe(JSON.stringify(before.content));
});

test("every new block: insert from the slash menu, save, reload — still there and rendered", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/"); const p = await newPage(page, "all blocks", docOf(para("start"))); await open(page, p.id);
  const blocks: [string, string][] = [["diagram", "mermaid"], ["graphique", "chart"], ["runnable", "runCode"], ["drawing", "drawing"], ["annotate", "pdf"], ["voice", "audio"], ["canvas", "canvasLink"], ["bibliography", "bibliography"], ["transclusion", "blockRef"], ["living", "queryView"]];
  for (const [q, type] of blocks) { await slash(page, q); await expect(page.locator(`.nb[data-node='${type}']`).first(), type).toBeVisible(); }
  await slash(page, "citation"); await expect(page.getByLabel("Search references")).toBeVisible(); await page.keyboard.press("Escape"); await expect(page.locator("[data-node='citation']")).toHaveCount(1);
  await slash(page, "hypothesis"); // the knowledge callouts (kind switch between the eight kinds: context-bar test)
  await saved(page);
  const doc = (await waitFor(async () => { const s = await server(page, p.id); return find(s.content, "callout").length === 1 ? s : null; })).content;
  for (const [, type] of blocks) { const n = find(doc, type); expect(n.length, type).toBe(1); expect(typeof n[0].attrs.id, `${type} has a block id`).toBe("string"); }
  expect(find(doc, "citation").length).toBe(1); expect(find(doc, "callout").map((c) => c.attrs.kind)).toEqual(["hypothesis"]);
  // exact default attrs of SPEC §2 for a freshly inserted block
  const { id: _i, ...mm } = find(doc, "mermaid")[0].attrs; expect(mm).toEqual({ code: "", preview: null, previewHash: null });
  const { id: _a, ...au } = find(doc, "audio")[0].attrs; expect(au).toEqual({ attachmentId: null, duration: 0, title: "", recordedAt: null, transcript: [], transcriptStatus: "none", transcriptEngine: null, summary: null });
  const { id: _q, ...qv } = find(doc, "queryView")[0].attrs; expect(qv).toEqual({ source: "tasks", databaseId: null, viewId: null, filter: {}, layout: "list", limit: 25, title: "" });
  await page.reload(); await editor(page).waitFor();
  for (const [, type] of blocks) await expect(page.locator(`.nb[data-node='${type}']`), `${type} after reload`).toHaveCount(1);
  await expect(page.locator("[data-node='citation']")).toHaveCount(1); await expect(page.locator(".callout[data-kind='hypothesis']")).toHaveCount(1);
  await expect(page.getByTestId("editor-lock")).toHaveCount(0);
  // the live view feature-detects its endpoint: a server without POST /api/query shows a neutral state (or rows once the backend has it)
  await expect(page.locator(".nb[data-node='queryView']")).toContainText(/not available on this server yet|Nothing matches|Open|Updating|Live · updated/); // 3.0 backend: real rows + the live indicator (slice next-p-ra)
});

test("mermaid renders; viewing stores nothing; the stored render follows the code once asked or edited (PNG preview + sha256 previewHash, never while typing)", async ({ page }) => {
  await page.goto("/"); const code = "flowchart LR\n  Idea --> Draft\n  Draft --> Published";
  const p = await newPage(page, "mermaid", docOf({ type: "mermaid", attrs: { code, preview: null, previewHash: null } }, para("tail"))); await open(page, p.id);
  await expect(page.getByTestId("mermaid-render").locator("svg")).toBeVisible({ timeout: 20_000 }); await expect(page.getByTestId("mermaid-render")).toContainText("Published");
  // merely viewing the page uploads nothing and saves nothing (no version, no `page.edited` event): the header says the render is not saved yet
  const v0 = (await server(page, p.id)).version; await page.waitForTimeout(5000); const viewed = await server(page, p.id); expect(viewed.version).toBe(v0); expect(find(viewed.content, "mermaid")[0].attrs.preview).toBeNull();
  await expect(page.locator(".nb[data-node='mermaid']")).toContainText("Render not saved yet");
  await page.locator(".nb[data-node='mermaid']").hover(); await page.getByRole("button", { name: "Save the render now" }).click();
  const first = await waitFor(async () => { const m = find((await server(page, p.id)).content, "mermaid")[0]; return m.attrs.preview ? m : null; }, 25_000);
  expect(first.attrs.previewHash).toBe(crypto.createHash("sha256").update(code, "utf8").digest("hex"));
  const img = await page.request.get(`/api/files/${first.attrs.preview}`); expect(img.status()).toBe(200); expect(img.headers()["content-type"]).toBe("image/png"); expect((await img.body()).subarray(1, 4).toString()).toBe("PNG");
  // edit the source: while the field is focused nothing is uploaded; after leaving it the preview and hash are refreshed
  await page.getByRole("button", { name: "Edit source" }).click(); const src = page.getByLabel("Mermaid source"); await src.click(); await page.keyboard.press("ControlOrMeta+End"); await page.keyboard.press("Meta+ArrowDown"); await page.keyboard.type("\n  Published --> Archived");
  await expect(page.getByTestId("mermaid-render")).toContainText("Archived", { timeout: 15_000 }); await page.waitForTimeout(3500);
  const during = find((await server(page, p.id)).content, "mermaid")[0]; expect(during.attrs.code).toContain("Archived"); expect(during.attrs.preview, "no new render uploaded while the source field has the focus").toBe(first.attrs.preview);
  await editor(page).locator("> p").last().click();
  const second = await waitFor(async () => { const m = find((await server(page, p.id)).content, "mermaid")[0]; return m.attrs.preview !== first.attrs.preview ? m : null; }, 25_000);
  expect(second.attrs.previewHash).toBe(crypto.createHash("sha256").update(second.attrs.code, "utf8").digest("hex"));
  // a syntax error keeps the last valid render on screen and does not upload anything
  await src.click(); await page.keyboard.press("Meta+ArrowDown"); await page.keyboard.type("\n  -->> ((("); await expect(page.getByText("This diagram has a syntax error")).toBeVisible({ timeout: 15_000 }); await expect(page.getByTestId("mermaid-render").locator("svg")).toBeVisible();
});

test("runnable code: runs only on click, in a sandbox that has no network, no parent DOM, no cookies; an endless loop is killed", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/"); const attempts: string[] = []; const reached: string[] = [];
  // a request the browser starts and then refuses (CSP) still shows up as a request event: what matters is that none ever gets a response
  page.on("request", (r) => { if (r.url().includes("sandbox-probe")) attempts.push(`${r.url().split("sandbox-probe=")[1]}:${r.failure()?.errorText ?? "pending"}`); }); page.on("response", (r) => { if (r.url().includes("sandbox-probe")) reached.push(r.url()); }); page.on("requestfinished", (r) => { if (r.url().includes("sandbox-probe")) reached.push(r.url()); });
  const code = [
    "const out = {};",
    `try { const r = await fetch('${ORIGIN}/api/tree?sandbox-probe=1', { credentials: 'include' }); out.fetch = 'status ' + r.status; } catch (e) { out.fetch = 'blocked'; }`,
    `try { await new Promise((res, rej) => { const x = new XMLHttpRequest(); x.open('GET', '${ORIGIN}/api/tree?sandbox-probe=2'); x.onload = () => res(x.status); x.onerror = () => rej(new Error('xhr')); x.send(); }); out.xhr = 'reached'; } catch (e) { out.xhr = 'blocked'; }`,
    `try { importScripts('${ORIGIN}/sw.js?sandbox-probe=3'); out.importScripts = 'loaded'; } catch (e) { out.importScripts = 'blocked'; }`,
    "try { out.cookie = typeof document === 'undefined' ? 'no document' : 'cookie:' + document.cookie; } catch (e) { out.cookie = 'blocked'; }",
    "try { out.parentDom = typeof parent === 'undefined' || !parent ? 'no parent' : parent.document.title; } catch (e) { out.parentDom = 'blocked'; }",
    "try { out.topDom = typeof top === 'undefined' || !top ? 'no top' : top.document.body.innerHTML.length; } catch (e) { out.topDom = 'blocked'; }",
    "try { out.storage = typeof localStorage === 'undefined' ? 'no storage' : localStorage.getItem('note-ui'); } catch (e) { out.storage = 'blocked'; }",
    "try { out.idb = typeof indexedDB === 'undefined' ? 'no idb' : await new Promise((res) => { const q = indexedDB.open('note-local'); q.onsuccess = () => res('opened:' + q.result.objectStoreNames.length); q.onerror = () => res('blocked'); }); } catch (e) { out.idb = 'blocked'; }",
    "console.log('RESULT ' + JSON.stringify(out));", "21 * 2",
  ].join("\n");
  const p = await newPage(page, "sandbox", docOf({ type: "runCode", attrs: { language: "javascript", code, output: null } }, para("tail"))); await open(page, p.id);
  const block = page.locator(".nb[data-node='runCode']"); await expect(block).toBeVisible(); await page.waitForTimeout(1500);
  expect(await page.locator("iframe[sandbox]").count(), "nothing runs when the page opens").toBe(0); await expect(page.getByTestId("run-output")).toHaveCount(0);
  await block.getByRole("button", { name: "Run code" }).click();
  const out = page.getByTestId("run-output"); await expect(out).toContainText("RESULT", { timeout: 20_000 }); await expect(out).toContainText("42");
  const res = JSON.parse((await out.innerText()).split("RESULT ")[1].split("\n")[0]);
  expect(res.fetch).toBe("blocked"); expect(res.xhr).toBe("blocked"); expect(res.importScripts).toBe("blocked");
  expect(res.cookie).toMatch(/^(no document|blocked|cookie:)$/); expect(res.parentDom).toMatch(/^(no parent|blocked)$/); expect(res.topDom).toMatch(/^(no top|blocked)$/); expect(res.storage).toMatch(/^(no storage|blocked)$/);
  expect(String(res.idb)).not.toMatch(/^opened:[1-9]/); // an opaque origin never sees the app's IndexedDB stores
  expect(reached, `no request from the sandbox reached the server (attempts seen by the browser: ${attempts.join(", ") || "none"})`).toEqual([]);
  // the result is stored in the node (SPEC: output {text, error, ms, at})
  await saved(page); const stored = await waitFor(async () => { const n = find((await server(page, p.id)).content, "runCode")[0]; return n.attrs.output ? n : null; });
  expect(stored.attrs.output.error).toBe(false); expect(stored.attrs.output.text).toContain("RESULT"); expect(typeof stored.attrs.output.ms).toBe("number"); expect(new Date(stored.attrs.output.at).getTime()).toBeGreaterThan(0);
  // the frame itself: sandbox="allow-scripts" only, opaque origin, CSP without network — checked on a second run while it is alive
  const area = block.getByRole("textbox").first(); await area.click(); await page.keyboard.press("ControlOrMeta+a"); await page.keyboard.type("await new Promise((r) => setTimeout(r, 2500)); 'slow done'");
  await block.getByRole("button", { name: "Run code" }).click(); const frame = page.locator("iframe[sandbox]"); await expect(frame).toHaveCount(1);
  expect(await frame.getAttribute("sandbox")).toBe("allow-scripts"); const srcdoc = (await frame.getAttribute("srcdoc")) ?? ""; expect(srcdoc).toContain("default-src 'none'"); expect(srcdoc).not.toContain("slow done");
  await expect(out).toContainText("slow done", { timeout: 15_000 }); await expect(frame).toHaveCount(0);
  // endless loop: killed by the timeout while the app stays responsive
  await area.click(); await page.keyboard.press("ControlOrMeta+a"); await page.keyboard.type("for (;;) {}"); await block.getByRole("button", { name: "Run code" }).click();
  await expect(block.getByRole("button", { name: "Stop" })).toBeVisible(); await page.waitForTimeout(1200);
  // a stray key while the block card is selected must not replace it (AtomGuard): the text goes below
  await block.locator(".nb-label").click(); await page.keyboard.type("x"); await expect(block).toBeVisible();
  await editor(page).locator("> p").last().click(); await page.keyboard.type("still typing while it loops"); await expect(editor(page)).toContainText("still typing while it loops");
  await expect(out).toContainText(/Timed out/, { timeout: 20_000 }); await expect(page.locator("iframe[sandbox]")).toHaveCount(0);
});

test("drawing: pen strokes with pointer events, undo, save → spn-ink-1 + PNG preview attachments", async ({ page }) => {
  await page.goto("/"); const p = await newPage(page, "drawing", docOf({ type: "drawing", attrs: { ink: null, preview: null, pk: null, width: 0, height: 0, background: "none" } }, para("tail"))); await open(page, p.id);
  await page.locator(".nb[data-node='drawing']").getByRole("button", { name: "Draw" }).click();
  const canvas = page.getByTestId("ink-canvas"); await expect(canvas).toBeVisible(); const box = (await canvas.boundingBox())!;
  const stroke = async (pts: [number, number][]) => { await page.mouse.move(box.x + pts[0][0], box.y + pts[0][1]); await page.mouse.down(); for (const [x, y] of pts.slice(1)) await page.mouse.move(box.x + x, box.y + y, { steps: 4 }); await page.mouse.up(); };
  await page.getByRole("button", { name: "Pen", exact: true }).click(); await stroke([[40, 40], [140, 60], [200, 140]]);
  await page.getByRole("button", { name: "Highlighter", exact: true }).click(); await stroke([[60, 180], [260, 180]]);
  await page.getByRole("button", { name: "Marker", exact: true }).click(); await stroke([[300, 40], [320, 200]]);
  await page.getByRole("button", { name: "Undo", exact: true }).click(); // removes the marker stroke
  await page.getByRole("button", { name: "Save drawing" }).click();
  const node = await waitFor(async () => { const n = find((await server(page, p.id)).content, "drawing")[0]; return n.attrs.ink && n.attrs.preview ? n : null; }, 20_000);
  expect(node.attrs.pk).toBeNull(); expect(node.attrs.width).toBeGreaterThan(0); expect(node.attrs.height).toBeGreaterThan(0);
  const ink = await (await page.request.get(`/api/files/${node.attrs.ink}`)).json();
  expect(ink.format).toBe("spn-ink-1"); expect(ink.width).toBe(node.attrs.width); expect(ink.strokes.map((s: any) => s.tool)).toEqual(["pen", "highlighter"]);
  for (const s of ink.strokes) { expect(s.color).toMatch(/^#[0-9a-f]{8}$/i); expect(s.points.length).toBeGreaterThan(1); for (const pt of s.points) { expect(pt.length).toBe(3); expect(pt[2]).toBeGreaterThanOrEqual(0); expect(pt[2]).toBeLessThanOrEqual(1); } }
  const png = await page.request.get(`/api/files/${node.attrs.preview}`); expect(png.headers()["content-type"]).toBe("image/png");
  await expect(page.locator(".nb[data-node='drawing'] img")).toBeVisible(); await page.reload(); await expect(page.locator(".nb[data-node='drawing'] img")).toBeVisible();
  // re-open: the saved ink is loaded back for editing
  await page.locator(".nb[data-node='drawing']").getByRole("button", { name: "Edit" }).click(); await expect(page.getByTestId("ink-canvas")).toBeVisible(); await expect(page.getByRole("button", { name: "Save drawing" })).toBeDisabled();
});

test("pdf: upload, render, select text → highlight with normalised rects and a note stored in the node", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/"); const p = await newPage(page, "pdf", docOf({ type: "pdf", attrs: { attachmentId: null, name: "", page: 1, annotations: [] } }, para("tail"))); await open(page, p.id);
  const block = page.locator(".nb[data-node='pdf']");
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), block.getByRole("button", { name: "Choose a PDF" }).click()]); await chooser.setFiles({ name: "hello-note.pdf", mimeType: "application/pdf", buffer: PDF });
  await expect(page.getByTestId("pdf-canvas")).toBeVisible({ timeout: 30_000 });
  const layer = page.getByTestId("pdf-textlayer"); await expect(layer).toContainText("Hello note", { timeout: 20_000 });
  const painted = await page.getByTestId("pdf-canvas").evaluate((c: HTMLCanvasElement) => { const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data; let dark = 0; for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 0 && d[i] < 100) dark++; return dark; }); expect(painted, "the page is really drawn").toBeGreaterThan(20);
  // select the text with the mouse (drag across the span), then highlight
  const span = layer.locator("span", { hasText: "Hello note" }).first(); const b = (await span.boundingBox())!;
  await page.mouse.move(b.x + 1, b.y + b.height / 2); await page.mouse.down(); await page.mouse.move(b.x + b.width - 1, b.y + b.height / 2, { steps: 8 }); await page.mouse.up();
  await block.getByRole("button", { name: "Highlight" }).first().click();
  await expect(page.getByTestId("pdf-annotation")).toHaveCount(1); await saved(page);
  const node = await waitFor(async () => { const n = find((await server(page, p.id)).content, "pdf")[0]; return n.attrs.annotations.length ? n : null; });
  const a = node.attrs.annotations[0]; expect(node.attrs.name).toBe("hello-note.pdf"); expect(a.kind).toBe("highlight"); expect(a.page).toBe(1); expect(a.text).toContain("Hello note"); expect(a.color).toMatch(/^#[0-9a-f]{6}$/i); expect(a.rects.length).toBeGreaterThan(0);
  for (const r of a.rects) { expect(r.length).toBe(4); for (const v of r) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); } }
  // the text sits at x≈20/200, y≈100/200 from the bottom of a 200×200 page → about 10 % from the left and around the middle from the top
  expect(a.rects[0][0]).toBeGreaterThan(0.05); expect(a.rects[0][0]).toBeLessThan(0.2); expect(a.rects[0][1]).toBeGreaterThan(0.35); expect(a.rects[0][1]).toBeLessThan(0.6);
  await expect(page.getByTestId("pdf-annotation-list")).toContainText("Hello note");
  await page.reload(); await expect(page.getByTestId("pdf-annotation")).toHaveCount(1, { timeout: 30_000 });
});

test("voice note: record with the microphone → uploaded attachment + player; transcription feature-detected", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/"); const p = await newPage(page, "audio", docOf({ type: "audio", attrs: { attachmentId: null, duration: 0, title: "", recordedAt: null, transcript: [], transcriptStatus: "none", transcriptEngine: null, summary: null } }, para("tail"))); await open(page, p.id);
  const block = page.locator(".nb[data-node='audio']"); await block.getByRole("button", { name: "Start recording" }).click();
  await expect(block.getByRole("timer")).toBeVisible({ timeout: 10_000 }); await page.waitForTimeout(1800); await block.getByRole("button", { name: "Stop recording" }).click();
  const node = await waitFor(async () => { const n = find((await server(page, p.id)).content, "audio")[0]; return n.attrs.attachmentId ? n : null; }, 30_000);
  expect(node.attrs.title).toMatch(/Voice note/); expect(new Date(node.attrs.recordedAt).getTime()).toBeGreaterThan(Date.now() - 120_000); expect(node.attrs.transcriptStatus).toBe("none");
  const file = await page.request.get(`/api/files/${node.attrs.attachmentId}`); expect(file.status()).toBe(200); expect(file.headers()["content-type"]).toMatch(/^audio\//); expect((await file.body()).length).toBeGreaterThan(200);
  await expect(block.getByRole("group", { name: "Audio player" })).toBeVisible(); await expect(block.getByLabel("Seek")).toBeVisible();
  // transcription: this server may not have POST /api/audio/<id>/transcribe yet → neutral state, node untouched
  await block.getByRole("button", { name: "Transcribe" }).click();
  await expect(block.getByText(/Transcription is not available on this server yet|in progress/i)).toBeVisible({ timeout: 10_000 });
  // a transcript written by another client shows clickable timestamps
  const withT = docOf({ type: "audio", attrs: { ...node.attrs, id: undefined, transcript: [{ t: 0, text: "bonjour" }, { t: 65, text: "second passage" }], transcriptStatus: "done", transcriptEngine: "test-engine" } });
  const p2 = await newPage(page, "audio transcript", withT); await open(page, p2.id);
  const list = page.getByRole("list", { name: "Transcript" }); await expect(list).toContainText("second passage"); await expect(list.getByRole("button").nth(1)).toContainText("1:05");
});

test("chart: SVG render of the snapshot, kind switch and data grid edit are stored", async ({ page }) => {
  await page.goto("/"); const attrs = { kind: "bar", title: "Notes per month", columns: ["Month", "Notes"], rows: [["Aug", 12], ["Sep", 18], ["Oct", 25]], x: "Month", y: ["Notes"], source: null };
  const p = await newPage(page, "chart", docOf({ type: "chart", attrs }, para("tail"))); await open(page, p.id);
  const svg = page.getByTestId("chart-svg"); await expect(svg).toBeVisible(); expect(await svg.locator("rect").count()).toBeGreaterThanOrEqual(3); await expect(svg).toHaveAttribute("role", "img");
  const block = page.locator(".nb[data-node='chart']"); await block.getByRole("button", { name: "Line", exact: true }).click(); expect(await svg.locator("path").count()).toBeGreaterThan(0);
  await block.getByRole("button", { name: /Edit data/ }).click(); const grid = page.getByTestId("chart-grid"); await expect(grid).toBeVisible();
  const cell = grid.locator("tbody input").nth(1); await cell.fill("40"); await cell.blur(); await saved(page);
  const node = await waitFor(async () => { const n = find((await server(page, p.id)).content, "chart")[0]; return n.attrs.kind === "line" && n.attrs.rows[0][1] === 40 ? n : null; });
  expect(node.attrs.columns).toEqual(["Month", "Notes"]); expect(node.attrs.source).toBeNull(); expect(node.attrs.rows[1]).toEqual(["Sep", 18]);
});

test("block reference: pick a page then a block → live read-only embed, jump to source; a removed target says so", async ({ page }) => {
  await page.goto("/"); const src = await newPage(page, "ref source", docOf({ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Source heading" }] }, para("The sentence that gets transcluded.")));
  const srcDoc = (await server(page, src.id)).content; const target = srcDoc.content[1]; expect(typeof target.attrs.id).toBe("string");
  const p = await newPage(page, "ref host", docOf({ type: "blockRef", attrs: { pageId: null, blockId: null, mode: "embed" } }, para("tail"))); await open(page, p.id);
  const block = page.locator(".nb[data-node='blockRef']"); await block.getByLabel("Search a page").fill(src.title);
  await block.getByRole("option", { name: new RegExp(src.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) }).click();
  await page.getByTestId("blockref-blocks").getByRole("option", { name: /The sentence that gets transcluded/ }).click();
  await expect(page.getByTestId("blockref-embed")).toContainText("The sentence that gets transcluded."); await saved(page);
  const node = await waitFor(async () => { const n = find((await server(page, p.id)).content, "blockRef")[0]; return n.attrs.pageId ? n : null; }); expect(node.attrs).toMatchObject({ pageId: src.id, blockId: target.attrs.id, mode: "embed" });
  await expect(block.getByRole("link", { name: "Jump to the source" })).toHaveAttribute("href", `/p/${src.id}#block-${target.attrs.id}`);
  // live: the source changes, the embed follows after a reload of the host
  await apiCall(page, "PATCH", `/api/pages/${src.id}`, { content: docOf(srcDoc.content[0], { ...target, content: [{ type: "text", text: "Edited at the source." }] }) });
  await page.reload(); await expect(page.getByTestId("blockref-embed")).toContainText("Edited at the source.");
  const gone = await newPage(page, "ref missing", docOf({ type: "blockRef", attrs: { pageId: src.id, blockId: "doesNotExist", mode: "embed" } })); await open(page, gone.id);
  await expect(page.locator(".nb[data-node='blockRef']")).toContainText("Reference not found"); await expect(page.locator(".nb[data-node='blockRef']")).toContainText("Référence introuvable");
});

test("rich tasks, callout kinds and AI sources: chips edit due / priority; the morphing bar follows the block type", async ({ page }) => {
  await page.goto("/");
  const p = await newPage(page, "tasks", docOf({ type: "taskList", content: [{ type: "taskItem", attrs: { checked: false, due: null, priority: null, taskId: TASK_ID }, content: [para("ship the editor")] }] }, { type: "callout", attrs: { kind: "note", icon: "💡" }, content: [para("a callout")] }, { type: "codeBlock", attrs: { language: "plaintext" }, content: [{ type: "text", text: "let x = 1" }] }, { type: "aiBlock", attrs: { model: "m", action: "synthesis", sources: [{ pageId: "11111111-2222-4333-8444-555555555555", blockId: "b1", title: "Field notes" }] }, content: [para("generated")] }, para("tail")));
  await open(page, p.id);
  await expect(page.locator(".ai-sources .cite-chip")).toHaveAttribute("href", "/p/11111111-2222-4333-8444-555555555555#block-b1"); await expect(page.locator(".ai-sources")).toContainText("Field notes");
  await expect(page.locator(".task-chip.is-linked")).toHaveCount(1);
  await editor(page).locator("li p", { hasText: "ship the editor" }).click();
  const bar = page.getByRole("toolbar", { name: "Task tools" }); await expect(bar).toBeVisible(); await bar.getByLabel("Due date").fill("2030-05-17"); await bar.getByRole("button", { name: "Priority high" }).click();
  await expect(page.locator(".task-chip.is-due")).toContainText("May 17"); await expect(page.locator(".task-chip.is-priority")).toHaveText("High");
  // chip editor (popover on the chip)
  await page.locator(".task-chip.is-priority").click(); const pop = page.getByRole("dialog", { name: "Task details" }); await expect(pop).toBeVisible(); await pop.getByRole("button", { name: "Low" }).click(); await pop.getByRole("button", { name: "Done" }).click(); await expect(page.locator(".task-chip.is-priority")).toHaveText("Low");
  // the bar morphs with the block under the cursor
  await page.getByText("a callout").click(); const cb = page.getByRole("toolbar", { name: "Callout tools" }); await expect(cb).toBeVisible(); await cb.getByRole("button", { name: "Decision" }).click(); await expect(page.locator(".callout")).toHaveAttribute("data-kind", "decision");
  await page.getByText("let x = 1").click(); const code = page.getByRole("toolbar", { name: "Code tools" }); await expect(code).toBeVisible(); await code.getByLabel("Code language").selectOption("typescript");
  await page.getByText("tail", { exact: true }).click(); await expect(page.locator(".context-bar")).toHaveCount(0);
  await saved(page);
  const doc = (await waitFor(async () => { const s = await server(page, p.id); return find(s.content, "callout")[0].attrs.kind === "decision" && find(s.content, "codeBlock")[0].attrs.language === "typescript" ? s : null; })).content;
  expect(find(doc, "taskItem")[0].attrs).toMatchObject({ checked: false, due: "2030-05-17", priority: "low", taskId: TASK_ID }); expect(typeof find(doc, "taskItem")[0].attrs.id).toBe("string");
  expect(find(doc, "callout")[0].attrs.icon).toBe("⚖️"); expect(find(doc, "aiBlock")[0].attrs.sources[0].title).toBe("Field notes"); expect(find(doc, "aiBlock")[0].attrs.action).toBe("synthesis");
});

test("Markdown paste becomes blocks (including the new forms); plain prose stays text", async ({ page }) => {
  await page.goto("/"); const p = await newPage(page, "paste", docOf(para("start"))); await open(page, p.id);
  const paste = async (text: string) => { await newLine(page); await page.evaluate(async (t) => { await navigator.clipboard.writeText(t); }, text); await page.keyboard.press("ControlOrMeta+v"); };
  await paste("## Pasted heading\n\n- [x] done item\n- [ ] open item\n\n```mermaid\nflowchart LR\n  P --> Q\n```\n\n> a quote");
  await expect(editor(page).locator("h2")).toHaveText("Pasted heading"); await expect(editor(page).locator("ul[data-type='taskList'] li")).toHaveCount(2); await expect(page.locator(".nb[data-node='mermaid']")).toHaveCount(1); await expect(editor(page).locator("blockquote")).toContainText("a quote");
  await paste("Just a sentence with a * star and an_underscore."); await expect(editor(page)).toContainText("Just a sentence with a * star and an_underscore.");
  await saved(page); const doc = (await server(page, p.id)).content; expect(find(doc, "mermaid")[0].attrs.code).toBe("flowchart LR\n  P --> Q"); expect(find(doc, "taskItem").map((t) => t.attrs.checked)).toEqual([true, false]);
});

test("Living Pages reveal and its reduced-motion fallback; motion classes degrade to a ≤ 120 ms cross-fade", async ({ page, browser }) => {
  await page.goto("/"); const many = docOf(...Array.from({ length: 40 }, (_, i) => para(`paragraph ${i + 1}`))); const p = await newPage(page, "motion", many);
  // animations run 25× slower while probed (DevTools playback rate): under load the 240 ms reveal used to be over before the probe ran. Reported timings are unchanged.
  const probe = async (pg: Page) => { const cdp = await pg.context().newCDPSession(pg); await cdp.send("Animation.enable"); await cdp.send("Animation.setPlaybackRate", { playbackRate: 0.04 }); await pg.goto(`/p/${p.id}`); await pg.locator("#main-scroll .note-editor .ProseMirror > p").first().waitFor(); return pg.evaluate(() => { const blocks = [...document.querySelectorAll("#main-scroll .note-editor .ProseMirror > *")]; const anims = blocks.map((b) => b.getAnimations().map((a) => ({ kf: (a.effect as KeyframeEffect).getKeyframes().map((k) => String(k.transform ?? "")), t: a.effect!.getTiming() }))); const root = document.querySelector("#main-scroll .note-editor .ProseMirror")!.getAnimations().map((a) => ({ d: a.effect!.getTiming().duration, kf: (a.effect as KeyframeEffect).getKeyframes().map((k) => String(k.transform ?? "none")) })); return { animated: anims.filter((a) => a.length).length, moving: anims.filter((a) => a.some((x) => x.kf.some((t) => t.includes("translateY(6px)")))).length, delays: anims.flatMap((a) => a.map((x) => Number(x.t.delay))).slice(0, 4), durations: anims.flatMap((a) => a.map((x) => Number(x.t.duration))).slice(0, 2), root }; }); };
  const normal = await probe(page);
  expect(normal.moving, "the first blocks rise 6 px").toBeGreaterThan(0); expect(normal.animated).toBeLessThanOrEqual(24); expect(normal.delays.slice(0, 3)).toEqual([0, 18, 36]); expect(normal.durations[0]).toBe(240);
  const ctx = await browser.newContext({ baseURL: ORIGIN, storageState: "test-results/.auth/state.json", viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" }); const rp = await ctx.newPage();
  const reduced = await probe(rp);
  expect(reduced.moving, "no block moves under Reduce Motion").toBe(0); expect(reduced.animated).toBe(0);
  for (const a of reduced.root) { expect(Number(a.d)).toBeLessThanOrEqual(120); expect(a.kf.every((t) => t === "none" || t === "")).toBe(true); }
  // CSS side: the command center (scale-in) and a menu (fade-up) become a plain 120 ms fade
  await rp.keyboard.press("Control+k"); const dlg = rp.getByRole("dialog", { name: "Command center" }); await expect(dlg).toBeVisible();
  const css = await rp.evaluate(() => { const el = document.querySelector("[cmdk-root]")!; const s = getComputedStyle(el); return { name: s.animationName, dur: s.animationDuration }; }); expect(css.name).toBe("fade-only"); expect(css.dur).toBe("0.12s");
  await rp.keyboard.press("Escape");
  // quick capture: the Lumen pulse exists in normal motion and is a static glow (no scale) under Reduce Motion
  const pulse = async (pg: Page) => pg.evaluate(async () => { const { lumenPulse } = await (window as any).__noteMotion(); lumenPulse(document.body); const el = document.querySelector(".lumen-pulse")!; return (el.getAnimations()[0].effect as KeyframeEffect).getKeyframes().map((k) => String(k.transform ?? "none")); });
  expect((await pulse(page)).some((t) => t.includes("scale"))).toBe(true); expect((await pulse(rp)).every((t) => t === "none")).toBe(true);
  await ctx.close();
});

test("Universal Command Center: fuzzy commands + pages + recents, editor commands, keyboard only", async ({ page }) => {
  await page.goto("/"); const p = await newPage(page, "Zebra Quantum Ledger", docOf(para("body"))); await page.reload();
  await page.keyboard.press("Control+k"); const dlg = page.getByRole("dialog", { name: "Command center" }); await expect(dlg).toBeVisible(); const input = dlg.locator("[cmdk-input]");
  await expect(dlg).toContainText("Go to"); await expect(dlg).toContainText("navigate"); // groups + keyboard hints
  await input.fill("drk thm"); await expect(dlg.locator("[cmdk-item]").first()).toContainText("Dark theme"); await page.keyboard.press("Enter");
  await expect(dlg).toBeHidden(); await expect(page.locator("html")).toHaveClass(/dark/);
  await page.keyboard.press("Control+k"); await expect(dlg.locator("[cmdk-group-heading]").first()).toHaveText("Recent"); await expect(dlg.locator("[cmdk-item]").first()).toContainText("Dark theme"); // remembered
  await input.fill("light theme"); await page.keyboard.press("Enter"); await expect(page.locator("html")).not.toHaveClass(/dark/);
  // pages: fuzzy on the title, typo-tolerant subsequence
  await page.keyboard.press("Control+k"); await input.fill("zbra qntm"); await expect(dlg.locator("[cmdk-item]").first()).toContainText("Zebra Quantum Ledger"); await page.keyboard.press("Enter"); await expect(page).toHaveURL(new RegExp(`/p/${p.id}`)); await editor(page).waitFor();
  // contextual commands registered by the page and its editor
  await editor(page).locator("> p").last().click(); await page.keyboard.press("Control+k"); await input.fill("insert diagram"); await expect(dlg.locator("[cmdk-item]").first()).toContainText("Insert diagram"); await page.keyboard.press("Enter");
  await expect(page.locator(".nb[data-node='mermaid']")).toHaveCount(1);
  await page.keyboard.press("Control+k"); await input.fill("version history"); await page.keyboard.press("Enter"); await expect(page.getByRole("dialog", { name: "Version history" })).toBeVisible(); await page.keyboard.press("Escape");
  // semantic zoom through the command center: outline hides the body, a click on a heading comes back to the full text
  const z = await newPage(page, "zoom", docOf({ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "First part" }] }, para("intro sentence"), para("hidden detail"), { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Second part" }] }, para("more"))); await open(page, z.id);
  await page.keyboard.press("Control+k"); await input.fill("outline zoom"); await expect(dlg.locator("[cmdk-item]").first()).toContainText("Zoom out to the outline"); await page.keyboard.press("Enter");
  await expect(page.getByText("hidden detail")).toBeHidden(); await expect(page.getByText("intro sentence")).toBeVisible(); await expect(page.getByText("Outline — click a heading")).toBeVisible();
  await page.getByRole("heading", { name: "Second part" }).click(); await expect(page.getByText("hidden detail")).toBeVisible();
  expect(JSON.stringify((await server(page, z.id)).content)).not.toContain("sz-"); // the zoom never touches the document
});

test("workspace: outline panel, page open to the side (editable, saved), collapsible sidebar sections, system theme follows the OS", async ({ page }) => {
  await page.goto("/"); const side = await newPage(page, "side page", docOf(para("side body")));
  const main = await newPage(page, "main page", docOf({ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Alpha section" }] }, para("main body"))); await open(page, main.id);
  await page.getByRole("button", { name: "Outline panel" }).click(); const panel = page.locator("aside[data-panel='outline']"); await expect(panel).toBeVisible(); await expect(panel.getByRole("navigation", { name: "Outline" })).toContainText("Alpha section");
  expect(await panel.evaluate((el) => getComputedStyle(el).animationName)).toBe("panel-in-right");
  const w0 = (await panel.boundingBox())!.width; const handle = panel.getByRole("separator", { name: "Resize panel" }); await handle.focus(); await page.keyboard.press("ArrowLeft"); await page.keyboard.press("ArrowLeft"); expect((await panel.boundingBox())!.width).toBeCloseTo(w0 + 48, 0);
  await page.evaluate((id) => (window as any).__noteUI().openPanel("page", id), side.id);
  const sp = page.getByTestId("side-page"); await expect(sp).toContainText("side body"); await sp.locator(".ProseMirror").click(); await page.keyboard.press("End"); await page.keyboard.type(" edited from the side");
  await waitFor(async () => JSON.stringify((await server(page, side.id)).content).includes("edited from the side"));
  expect(JSON.stringify((await server(page, main.id)).content)).not.toContain("edited from the side"); await expectNoHorizontalOverflow(page);
  await page.getByRole("button", { name: "Close panel" }).click(); await expect(page.locator("aside[data-panel]")).toHaveCount(0);
  // sidebar sections collapse and remember it
  const sec = page.getByRole("button", { name: "Intelligence" }); await expect(page.getByRole("link", { name: "Backlinks" })).toBeVisible(); await sec.click(); await expect(page.getByRole("link", { name: "Backlinks" })).toBeHidden(); await expect(sec).toHaveAttribute("aria-expanded", "false");
  await page.reload(); await expect(page.getByRole("button", { name: "Intelligence" })).toHaveAttribute("aria-expanded", "false"); await page.getByRole("button", { name: "Intelligence" }).click();
  // system theme: an OS change is followed while the app is open (was: only at load)
  await page.evaluate(() => (window as any).__noteUI().setTheme("system")); await page.emulateMedia({ colorScheme: "dark" }); await expect(page.locator("html")).toHaveClass(/dark/); await page.emulateMedia({ colorScheme: "light" }); await expect(page.locator("html")).not.toHaveClass(/dark/);
});

test("design system: fonts are self-hosted and applied, tokens convert to the documented sRGB values, focus ring is solid", async ({ page }) => {
  await page.goto("/"); const p = await newPage(page, "Design tokens", docOf(para("body text"), { type: "codeBlock", attrs: { language: "plaintext" }, content: [{ type: "text", text: "mono" }] })); await open(page, p.id);
  const fonts = await page.evaluate(async () => { await (document as any).fonts.ready; const fam = (sel: string) => getComputedStyle(document.querySelector(sel)!).fontFamily; const loaded = [...(document as any).fonts].filter((f: any) => f.status === "loaded").map((f: any) => f.family.replace(/["']/g, "")); return { title: fam("[aria-label='Page title']"), body: fam("body"), code: fam(".note-editor pre"), loaded: [...new Set(loaded)] }; });
  expect(fonts.title).toContain("Source Serif 4 Variable"); expect(fonts.body).toContain("Inter Variable"); expect(fonts.code).toContain("JetBrains Mono Variable");
  for (const f of ["Inter Variable", "Source Serif 4 Variable", "JetBrains Mono Variable"]) expect(fonts.loaded, `${f} loaded from our origin`).toContain(f);
  const external = await page.evaluate(() => performance.getEntriesByType("resource").map((r) => r.name).filter((n) => /\.woff2?(\?|$)/.test(n) && !n.startsWith(location.origin))); expect(external).toEqual([]);
  // measured conversion of the oklch tokens (browser) = scripts/contrast.mjs (docs/next/DESIGN-SYSTEM-NEXT.md lists these exact values)
  const expected = JSON.parse(execFileSync("node", ["scripts/contrast.mjs", "--json"], { encoding: "utf8" })).hexes;
  for (const theme of ["light", "dark"] as const) {
    const measured = await page.evaluate((dark) => { document.documentElement.classList.toggle("dark", dark); const c = document.createElement("canvas"); c.width = c.height = 1; const ctx = c.getContext("2d", { colorSpace: "srgb" })!; const out: Record<string, string> = {}; for (const t of ["bg", "bg-elev", "bg-sunk", "bg-side", "bg-hover", "fg", "fg-muted", "fg-faint", "line", "line-strong", "accent", "accent-fg", "accent-soft", "ai", "ai-soft", "success", "warning", "danger"]) { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue(`--${t}`).trim(); ctx.fillRect(0, 0, 1, 1); const d = ctx.getImageData(0, 0, 1, 1).data; out[t] = "#" + [d[0], d[1], d[2]].map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase(); } return out; }, theme === "dark");
    for (const [t, hex] of Object.entries(measured)) { const e = expected[theme][t]; const diff = [1, 3, 5].map((i) => Math.abs(parseInt(hex.slice(i, i + 2), 16) - parseInt(e.slice(i, i + 2), 16))); expect(Math.max(...diff), `${theme} --${t}: browser ${hex} vs script ${e}`).toBeLessThanOrEqual(2); }
  }
  await page.evaluate(() => document.documentElement.classList.remove("dark"));
  await page.keyboard.press("Tab"); const ring = await page.evaluate(() => { const el = document.activeElement as HTMLElement; const s = getComputedStyle(el); return { style: s.outlineStyle, width: s.outlineWidth, color: s.outlineColor }; });
  expect(ring.style).toBe("solid"); expect(parseFloat(ring.width)).toBeGreaterThanOrEqual(2); expect(ring.color).not.toMatch(/\/\s*0\.\d+\)|rgba\([^)]*,\s*0\.\d+\)/); // not a translucent ring
  // density had no CSS rule before 3.0
  const h = async () => page.evaluate(() => document.querySelector(".side-item")!.getBoundingClientRect().height); const comfy = await h(); await page.evaluate(() => { document.documentElement.dataset.density = "compact"; }); expect(await h()).toBeLessThan(comfy); await page.evaluate(() => { document.documentElement.dataset.density = "comfortable"; });
  expect(fs.existsSync("docs/next/DESIGN-SYSTEM-NEXT.md")).toBe(true);
});
