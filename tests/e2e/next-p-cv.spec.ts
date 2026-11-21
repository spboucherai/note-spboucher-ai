/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : tests/e2e/next-p-cv.spec.ts
 * Description      : SP Note Next Generation — capture, Smart Inbox and voice
 *                    notes (desktop Chromium, fake microphone, scratch
 *                    database). Capture: idea, smart paste (link, screenshot),
 *                    PDF and audio files, drag-and-drop, selection from the
 *                    editor, /share, the sidebar field through the outbox.
 *                    Smart Inbox: kind filter, AI suggestions only on demand,
 *                    checklist applied selectively on the real server, Undo,
 *                    loading / error / empty states. Voice: pause/resume,
 *                    microphone refused, transcription states written into the
 *                    node, timestamps that seek, AI summary → tasks / summary
 *                    blocks, 25 MB limit, delete the original, search hit
 *                    inside a transcript. The model's answer and the
 *                    transcription engine are simulated (route + rows written
 *                    like the worker does) except in the two tests guarded by
 *                    E2E_REAL_AI=1, which call the real providers once each
 *                    (cents; costs appended to real-ai-costs.jsonl).
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

import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { apiCall, docOf, para, PDF, PNG, sql, ORIGIN, expectNoHorizontalOverflow } from "./helpers";

const SHOTS = process.env.E2E_SHOTS ?? path.join(os.homedir(), "dev/note-next-p-cv-data/shots"); const canShoot = fs.existsSync(SHOTS);
const shot = async (page: Page, name: string) => { if (canShoot) await page.screenshot({ path: path.join(SHOTS, `${name}.png`) }); };
const made: string[] = []; const atts: string[] = [];
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
const newPage = async (page: Page, title: string, content?: unknown, extra: Record<string, unknown> = {}) => { const r = await apiCall(page, "POST", "/api/pages", { title: `E2E-pcv ${title} ${uid()}`, ...(content ? { content } : {}), ...extra }); expect(r.status).toBe(201); made.push(r.body.id); return r.body as { id: string; version: number; title: string }; };
const server = async (page: Page, id: string) => (await apiCall(page, "GET", `/api/pages/${id}`)).body;
const editor = (page: Page) => page.locator("#main-scroll .note-editor .ProseMirror").first();
const open = async (page: Page, id: string) => { await page.goto(`/p/${id}`); await editor(page).waitFor(); };
const find = (n: any, type: string): any[] => [...(n?.type === type ? [n] : []), ...((n?.content ?? []) as any[]).flatMap((c) => find(c, type))];
const waitFor = async <T>(fn: () => Promise<T | null | undefined | false>, ms = 15_000): Promise<T> => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error("condition not met in time"); await new Promise((r) => setTimeout(r, 300)); } };
const byTitle = async (like: string) => (await sql`select id, title, icon, capture_kind, inbox_at, content from pages where title like ${like} and deleted_at is null order by created_at desc`).map((r) => { made.push(r.id); return r; });
const sheet = (page: Page) => page.getByRole("dialog", { name: "Quick capture" });
/** Opens quick capture through the UI-state handle the shell exposes for the suites (the ⌘⇧C shortcut itself is covered once, below). */
const openSheet = (page: Page) => page.evaluate(() => (window as any).__noteUI().set({ captureOpen: true }));
const captureNote = async (page: Page, body: Record<string, unknown>) => { const r = await apiCall(page, "POST", "/api/capture", body); expect(r.status).toBe(201); made.push(r.body.id); return r.body as { id: string; title: string; kind: string }; };
/** A real, playable WAV (mono, 8 kHz, 16-bit, a quiet tone): the player can load and seek it. */
function wav(seconds: number): Buffer { const rate = 8000, n = Math.floor(seconds * rate); const b = Buffer.alloc(44 + n * 2); b.write("RIFF", 0); b.writeUInt32LE(36 + n * 2, 4); b.write("WAVEfmt ", 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write("data", 36); b.writeUInt32LE(n * 2, 40); for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin(i / 6) * 1200), 44 + i * 2); return b; }
const upload = async (page: Page, name: string, mimeType: string, buffer: Buffer) => { const up = await page.request.post("/api/attachments", { multipart: { file: { name, mimeType, buffer } }, headers: { origin: ORIGIN } }); expect(up.status()).toBe(201); const id = (await up.json()).id as string; atts.push(id); return id; };
const audioNode = (attachmentId: string, extra: Record<string, unknown> = {}) => ({ type: "audio", attrs: { attachmentId, duration: 0, title: "Réunion budget", recordedAt: null, transcript: [], transcriptStatus: "none", transcriptEngine: null, summary: null, ...extra } });
const idle = { queued: true, jobId: "00000000-0000-4000-8000-0000000000aa", transcript: [], text: "", engine: null, model: null, language: null, duration: null, segments: null, summary: null, error: null, costUsd: null, finishedAt: null };
const logCost = (entry: Record<string, unknown>) => { if (canShoot) fs.appendFileSync(path.join(SHOTS, "..", "real-ai-costs.jsonl"), JSON.stringify({ at: new Date().toISOString(), ...entry }) + "\n"); };

test.afterAll(async () => {
  if (atts.length) { await sql`delete from pgboss.job where name = 'transcribe' and data->>'attachmentId' = any(${atts})`.catch(() => {}); await sql`delete from audio_transcripts where attachment_id = any(${atts}::uuid[])`; }
  const mine = await sql`select id from pages where title like 'E2E-pcv %' or title like '%E2E-pcv%'`; const ids = [...new Set([...made, ...mine.map((r) => r.id)])];
  if (ids.length) { await sql`delete from tasks where page_id = any(${ids}::uuid[])`; await sql`delete from inbox_actions where page_id = any(${ids}::uuid[])`; await sql`delete from attachments where page_id = any(${ids}::uuid[])`; await sql`delete from pages where id = any(${ids}::uuid[])`; }
  if (atts.length) await sql`delete from attachments where id = any(${atts}::uuid[])`;
  await sql`delete from tags where name like 'e2epcv%'`;
});

// =====================================================================================================================
// A. Capture
// =====================================================================================================================
test("capture sheet: an idea, then smart paste — an address becomes a link, a clipboard image a screenshot", async ({ page }) => {
  await page.goto("/inbox"); const tag = uid(); await expect(page.getByRole("heading", { name: "Inbox" })).toBeVisible();
  await page.keyboard.press("ControlOrMeta+Shift+C"); const s = sheet(page); await expect(s.getByLabel("Capture text")).toBeFocused();
  await expect(s.getByRole("radio")).toHaveText(["Note", "Idea", "To-do", "Link"]);
  await s.getByRole("radio", { name: "Idea" }).click(); await s.getByLabel("Capture text").fill(`E2E-pcv idea ${tag}\nwhat if captures filed themselves`); await shot(page, "capture-sheet-idea");
  await s.getByRole("button", { name: "Capture", exact: true }).click(); await expect(page.getByText("Captured to inbox")).toBeVisible(); await expect(s).toBeHidden();
  const [idea] = await byTitle(`E2E-pcv idea ${tag}%`); expect(idea.capture_kind).toBe("note"); expect(idea.icon).toBe("💡"); expect(idea.inbox_at).toBeTruthy();
  // paste an address into the empty field → Link
  await openSheet(page); await expect(s.getByLabel("Capture text")).toBeFocused();
  await s.getByLabel("Capture text").evaluate((el, url) => { const dt = new DataTransfer(); dt.setData("text/plain", url); el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true })); }, `https://example.org/e2e-pcv-${tag}`);
  await expect(s.getByLabel("Capture text")).toHaveValue(`https://example.org/e2e-pcv-${tag}`); await expect(s.getByRole("radio", { name: "Link" })).toHaveAttribute("aria-checked", "true");
  await s.getByRole("button", { name: "Capture", exact: true }).click(); await expect(s).toBeHidden();
  const link = await waitFor(async () => (await sql`select id, capture_kind, content from pages where content::text like ${`%e2e-pcv-${tag}%`} and capture_kind = 'link'`)[0]); made.push(link.id);
  // paste an image from the clipboard → attached as a screenshot, never typed into the field
  await openSheet(page); await expect(s.getByLabel("Capture text")).toBeFocused();
  await s.getByLabel("Capture text").evaluate((el, b64) => { const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)); const dt = new DataTransfer(); dt.items.add(new File([bytes], "image.png", { type: "image/png" })); el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true })); }, PNG.toString("base64"));
  await expect(s.getByTestId("capture-origin")).toHaveText("Screenshot from the clipboard"); await expect(s.getByRole("list", { name: "Attachments" })).toContainText(/screenshot-\d{8}-\d{6}\.png/);
  await s.getByLabel("Capture text").fill(`E2E-pcv shot ${tag}`); await shot(page, "capture-sheet-screenshot"); await s.getByRole("button", { name: "Capture", exact: true }).click(); await expect(s).toBeHidden();
  const [sc] = await waitFor(async () => { const r = await byTitle(`E2E-pcv shot ${tag}%`); return r.length ? r : null; }); expect(sc.capture_kind).toBe("screenshot"); expect(find(sc.content, "image").length).toBe(1);
});

test("capture sheet: a PDF becomes a document with a PDF block, an audio file a voice note; oversized audio is explained", async ({ page }) => {
  await page.goto("/inbox"); const tag = uid(); const s = sheet(page);
  await openSheet(page); await expect(s.getByLabel("Capture text")).toBeFocused();
  await s.locator("input[type=file]").setInputFiles({ name: `E2E-pcv ${tag}.pdf`, mimeType: "application/pdf", buffer: PDF });
  await expect(s.getByRole("list", { name: "Attachments" })).toContainText(`E2E-pcv ${tag}.pdf`); await s.getByRole("button", { name: "Capture", exact: true }).click(); await expect(s).toBeHidden();
  const [doc] = await waitFor(async () => { const r = await byTitle(`E2E-pcv ${tag}.pdf%`); return r.length ? r : null; }); expect(doc.capture_kind).toBe("document"); const pdf = find(doc.content, "pdf"); expect(pdf.length).toBe(1); expect(pdf[0].attrs.name).toBe(`E2E-pcv ${tag}.pdf`); expect(pdf[0].attrs.attachmentId).toMatch(/^[0-9a-f-]{36}$/);
  await openSheet(page); await expect(s.getByLabel("Capture text")).toBeFocused();
  await s.locator("input[type=file]").setInputFiles({ name: `E2E-pcv entrevue ${tag}.wav`, mimeType: "audio/wav", buffer: wav(1) });
  await s.getByRole("button", { name: "Capture", exact: true }).click(); await expect(s).toBeHidden();
  const [au] = await waitFor(async () => { const r = await sql`select id, capture_kind, content from pages where capture_kind = 'audio' and content::text like ${`%E2E-pcv entrevue ${tag}%`}`; return r.length ? r : null; }); made.push(au.id);
  const node = find(au.content, "audio"); expect(node.length).toBe(1); expect(node[0].attrs.title).toBe(`E2E-pcv entrevue ${tag}`); expect(node[0].attrs.transcriptStatus).toBe("none");
  // a recording over 25 MB is accepted (it stays playable) but the sheet says it cannot be transcribed
  await openSheet(page); await expect(s.getByLabel("Capture text")).toBeFocused();
  await s.locator("input[type=file]").setInputFiles({ name: "long-lecture.wav", mimeType: "audio/wav", buffer: Buffer.alloc(25 * 1024 * 1024 + 2048, 1) });
  await expect(s.getByRole("note")).toContainText("over the 25 MB a transcription accepts"); await s.getByRole("button", { name: "Remove long-lecture.wav" }).click(); await expect(s.getByRole("note")).toHaveCount(0);
  await page.keyboard.press("Escape"); await expect(s).toBeHidden();
});

test("drag and drop anywhere: an overlay appears, the drop opens the capture sheet prefilled; nothing is saved before Capture", async ({ page }) => {
  await page.goto("/inbox"); const tag = uid(); const s = sheet(page); await expect(page.getByRole("heading", { name: "Inbox" })).toBeVisible();
  const before = (await sql`select count(*)::int as n from pages where inbox_at is not null`)[0].n;
  await page.evaluate(({ b64, name }) => { const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)); const dt = new DataTransfer(); dt.items.add(new File([bytes], name, { type: "application/pdf" })); (window as any).__dt = dt; const t = document.getElementById("main-scroll")!; for (const type of ["dragenter", "dragover"]) t.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true })); }, { b64: PDF.toString("base64"), name: `E2E-pcv dropped ${tag}.pdf` });
  await expect(page.getByTestId("capture-drop")).toBeVisible(); await expect(page.getByTestId("capture-drop")).toContainText("Drop to capture"); await shot(page, "capture-drop-overlay");
  await page.evaluate(() => document.getElementById("main-scroll")!.dispatchEvent(new DragEvent("drop", { dataTransfer: (window as any).__dt, bubbles: true, cancelable: true })));
  await expect(page.getByTestId("capture-drop")).toHaveCount(0); await expect(s).toBeVisible(); await expect(s.getByTestId("capture-origin")).toHaveText("Dropped here"); await expect(s.getByRole("list", { name: "Attachments" })).toContainText(`E2E-pcv dropped ${tag}.pdf`);
  expect((await sql`select count(*)::int as n from pages where inbox_at is not null`)[0].n, "a drop alone saves nothing").toBe(before);
  await s.getByRole("button", { name: "Capture", exact: true }).click(); await expect(s).toBeHidden();
  const [d] = await waitFor(async () => { const r = await byTitle(`E2E-pcv dropped ${tag}.pdf%`); return r.length ? r : null; }); expect(d.capture_kind).toBe("document");
  // a dragged address → link
  await page.evaluate((url) => { const dt = new DataTransfer(); dt.setData("text/uri-list", url); dt.setData("text/plain", url); const t = document.getElementById("main-scroll")!; for (const type of ["dragenter", "dragover", "drop"]) t.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true })); }, `https://example.org/e2e-pcv-drop-${tag}`);
  await expect(s).toBeVisible(); await expect(s.getByLabel("Capture text")).toHaveValue(`https://example.org/e2e-pcv-drop-${tag}`); await expect(s.getByRole("radio", { name: "Link" })).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Escape"); await expect(s).toBeHidden();
  // dismissed: the dropped address is forgotten, the next plain opening is empty
  await openSheet(page); await expect(s.getByLabel("Capture text")).toHaveValue(""); await expect(s.getByTestId("capture-origin")).toHaveCount(0); await page.keyboard.press("Escape");
  // a drag that starts inside the app (a link of the page) is not a capture
  await page.evaluate(() => { const dt = new DataTransfer(); dt.setData("text/plain", "internal"); window.dispatchEvent(new DragEvent("dragstart", { dataTransfer: dt, bubbles: true })); const t = document.getElementById("main-scroll")!; for (const type of ["dragenter", "dragover"]) t.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true })); });
  await page.waitForTimeout(200); await expect(page.getByTestId("capture-drop")).toHaveCount(0); await page.evaluate(() => window.dispatchEvent(new DragEvent("dragend", { bubbles: true })));
});

test("selected text: the editor's selection menu captures it as a selection that links back to its page and block", async ({ page }) => {
  await page.goto("/"); const tag = uid(); const p = await newPage(page, "source", docOf(para(`Zeugma${tag} garantie de taux quatre-vingt-dix jours`), para("tail"))); await open(page, p.id);
  await editor(page).locator("p").first().click({ clickCount: 3 });
  await page.getByRole("toolbar", { name: "Formatting" }).getByRole("button", { name: "Capture selection" }).click();
  const s = sheet(page); await expect(s).toBeVisible(); await expect(s.getByTestId("capture-origin")).toContainText("Selected text"); await expect(s.getByTestId("capture-origin")).toContainText("E2E-pcv source");
  await expect(s.getByLabel("Capture text")).toHaveValue(`Zeugma${tag} garantie de taux quatre-vingt-dix jours`); await expect(s.getByRole("radiogroup")).toHaveCount(0); await shot(page, "capture-sheet-selection");
  await s.getByRole("button", { name: "Capture", exact: true }).click(); await expect(page.getByText("Captured to inbox")).toBeVisible();
  const [c] = await waitFor(async () => { const r = await sql`select id, capture_kind, content from pages where capture_kind = 'selection' and title like ${`Zeugma${tag}%`}`; return r.length ? r : null; }); made.push(c.id);
  expect(find(c.content, "blockquote").length).toBe(1); const src = (await server(page, p.id)).content.content[0].attrs.id; expect(JSON.stringify(c.content)).toContain(`"href":"/p/${p.id}#block-${src}"`);
  const back = await apiCall(page, "GET", `/api/pages/${p.id}/backlinks`); if (back.status === 200) expect(JSON.stringify(back.body)).toContain(c.id);
  // the same from the Command Center
  await editor(page).locator("p").first().click({ clickCount: 3 }); await page.keyboard.press("ControlOrMeta+k"); const pal = page.getByRole("dialog").filter({ has: page.locator("[cmdk-input]") }); await pal.locator("[cmdk-input]").fill("capture the selection");
  await expect(pal.locator("[cmdk-item]").first()).toContainText("Capture the selection"); await page.keyboard.press("Enter"); await expect(s.getByTestId("capture-origin")).toContainText("Selected text"); await page.keyboard.press("Escape");
});

test("/share opens the capture sheet prefilled from ?title=&text=&url= and leaves a clean address", async ({ page }) => {
  const tag = uid(); await page.goto(`/share?title=${encodeURIComponent(`E2E-pcv shared ${tag}`)}&text=${encodeURIComponent("Worth reading")}&url=${encodeURIComponent(`https://example.org/e2e-pcv-share-${tag}`)}`);
  const s = sheet(page); await expect(s).toBeVisible(); await expect(s.getByTestId("capture-origin")).toHaveText("Shared with SP Note");
  await expect(s.getByLabel("Capture text")).toHaveValue(`https://example.org/e2e-pcv-share-${tag}\nE2E-pcv shared ${tag}\nWorth reading`); await expect(s.getByRole("radio", { name: "Link" })).toHaveAttribute("aria-checked", "true");
  await expect(page).toHaveURL(/\/inbox$/); await expect(page.locator("h1", { hasText: "Inbox" })).toBeVisible(); // behind the sheet (hidden from the accessibility tree while it is open)
  await s.getByRole("button", { name: "Capture", exact: true }).click(); await expect(s).toBeHidden();
  const l = await waitFor(async () => (await sql`select id, title, capture_kind, content from pages where capture_kind = 'link' and content::text like ${`%e2e-pcv-share-${tag}%`}`)[0]); made.push(l.id);
  expect(l.title).toBe("example.org"); expect(JSON.stringify(l.content)).toContain(`E2E-pcv shared ${tag}`);
  await page.goto("/share"); await expect(page.getByText("Nothing was shared")).toBeVisible(); await expect(sheet(page)).toHaveCount(0);
});

test("sidebar quick-capture field goes through the outbox: kept offline, sent exactly once when the network returns", async ({ page, context }) => {
  await page.goto("/"); const title = `E2E-pcv sidebar ${uid()}`; const field = page.getByRole("navigation", { name: "Workspace" }).getByLabel("Quick capture");
  await context.setOffline(true); await field.fill(title); await page.keyboard.press("Enter");
  await expect(page.getByText("Saved on this device")).toBeVisible(); await expect(field).toHaveValue("");
  expect((await sql`select count(*)::int as n from pages where title = ${title}`)[0].n).toBe(0);
  expect(await page.evaluate(() => new Promise<number>((res) => { const r = indexedDB.open("note-local"); r.onsuccess = () => { const q = r.result.transaction("outbox").objectStore("outbox").getAll(); q.onsuccess = () => res(q.result.length); }; })), "the capture waits in the outbox").toBe(1);
  await context.setOffline(false); await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect.poll(async () => (await sql`select count(*)::int as n from pages where title = ${title}`)[0].n, { timeout: 20_000 }).toBe(1);
  await page.evaluate(() => window.dispatchEvent(new Event("online"))); await page.waitForTimeout(1200);
  const rows = await sql`select id from pages where title = ${title}`; expect(rows.length, "no duplicate after a second replay trigger").toBe(1); made.push(rows[0].id);
});

// =====================================================================================================================
// B. Smart Inbox
// =====================================================================================================================
test("inbox: filter by kind of capture", async ({ page }) => {
  await page.goto("/"); const tag = uid();
  await captureNote(page, { kind: "note", text: `E2E-pcv filt note ${tag}` }); await captureNote(page, { kind: "tasks", text: `E2E-pcv filt todo ${tag}` }); await captureNote(page, { kind: "selection", text: `E2E-pcv filt quote ${tag}` }); await captureNote(page, { kind: "idea", text: `E2E-pcv filt idea ${tag}` });
  await page.goto("/inbox"); const filters = page.getByRole("group", { name: "Filter by kind of capture" }); await expect(filters.getByRole("button", { name: /^All/ })).toHaveAttribute("aria-pressed", "true");
  const card = (s: string) => page.getByRole("listitem").filter({ hasText: `E2E-pcv filt ${s} ${tag}` });
  for (const k of ["note", "todo", "quote", "idea"]) await expect(card(k)).toBeVisible();
  await filters.getByRole("button", { name: /^Selections/ }).click(); await expect(card("quote")).toBeVisible(); for (const k of ["note", "todo", "idea"]) await expect(card(k)).toHaveCount(0);
  await filters.getByRole("button", { name: /^Ideas/ }).click(); await expect(card("idea")).toBeVisible(); await expect(card("note")).toHaveCount(0);
  await filters.getByRole("button", { name: /^To-dos/ }).click(); await expect(card("todo")).toBeVisible(); await expect(card("quote")).toHaveCount(0);
  await filters.getByRole("button", { name: /^All/ }).click(); for (const k of ["note", "todo", "quote", "idea"]) await expect(card(k)).toBeVisible();
  await expect(filters.getByRole("button", { name: /^Links/ })).toHaveCount(0, { timeout: 1000 }).catch(() => { /* other suites may have left link captures: the chip is then legitimately there */ });
});

test("inbox: AI suggestions only on demand, shown as an AI-marked checklist, applied selectively on the server, with Undo", async ({ page }) => {
  await page.goto("/"); const tag = uid(); const parent = await newPage(page, `Refinancement ${tag}`, undefined, { section: "projects" }); const rel = await newPage(page, `Offre de la banque ${tag}`);
  const cap = await captureNote(page, { kind: "note", text: `E2E-pcv rappeler banque ${tag}\nDemander si la garantie de taux peut être prolongée.` });
  let calls = 0; const answer = { pageId: cap.id, contentHash: "0".repeat(32), status: "ready", ai: true, model: "claude-haiku-5-5", provider: "anthropic", generatedAt: new Date().toISOString(), cached: false, costUsd: 0.0001,
    suggestions: { title: { value: `E2E-pcv Rappeler la banque ${tag}`, current: cap.title }, tags: [{ name: `e2epcv${tag}`, existing: false }, { name: `e2epcvb${tag}`, existing: false }], destination: { section: "projects", parentId: parent.id, parentTitle: parent.title }, relations: [{ pageId: rel.id, title: rel.title, icon: null, reason: "Même financement." }], summary: "Rappeler la banque pour prolonger la garantie de taux." } };
  await page.route("**/api/inbox/*/suggestions*", async (route) => { calls++; await new Promise((r) => setTimeout(r, 700)); await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(answer) }); });
  await page.goto("/inbox"); const card = page.getByRole("listitem").filter({ hasText: cap.title }); await expect(card).toBeVisible(); await page.waitForTimeout(800);
  expect(calls, "no suggestion is fetched before the owner asks").toBe(0);
  await card.getByRole("button", { name: /^Suggest with AI/ }).click(); const panel = card.getByTestId("inbox-suggestions");
  await expect(panel.getByRole("status")).toContainText("Reading the capture"); await expect(panel.locator(".ai-mark")).toHaveText("AI suggestions");
  await expect(panel.getByRole("checkbox")).toHaveCount(6); expect(calls).toBe(1); await expect(panel).toContainText("claude-haiku-5-5");
  for (const box of await panel.getByRole("checkbox").all()) await expect(box).not.toBeChecked();
  await expect(panel.getByRole("button", { name: /^Apply/ })).toBeDisabled(); await shot(page, "inbox-suggestions-checklist");
  const before = await server(page, cap.id); expect(before.title).toBe(cap.title); expect(before.inboxAt).toBeTruthy();
  // the owner keeps the title (edited), one of the two tags and the related page — not the destination, not the summary
  await panel.getByLabel("Suggested title").fill(`E2E-pcv Banque — garantie ${tag}`); await expect(panel.getByRole("checkbox", { name: /^Title/ })).toBeChecked();
  await panel.getByRole("checkbox", { name: `Tag: e2epcv${tag}` }).check(); await panel.getByRole("checkbox", { name: /^Related/ }).check();
  await expect(panel.getByRole("button", { name: "Apply 3 selected" })).toBeEnabled(); await panel.getByRole("button", { name: "Apply 3 selected" }).click();
  await expect(page.getByText("3 suggestions applied")).toBeVisible(); await expect(panel).toHaveCount(0);
  const after = await server(page, cap.id); expect(after.title).toBe(`E2E-pcv Banque — garantie ${tag}`); expect(after.inboxAt, "not moved: the destination was not ticked").toBeTruthy(); expect(after.parentId ?? null).toBeNull();
  expect((await sql`select t.name from page_tags pt join tags t on t.id = pt.tag_id where pt.page_id = ${cap.id}`).map((r) => r.name)).toEqual([`e2epcv${tag}`]);
  expect((await sql`select status, kind from knowledge_edges where from_id = ${cap.id} and to_id = ${rel.id}`).length).toBe(1); expect(find(after.content, "aiBlock").length, "the summary was not ticked").toBe(0);
  await expect(page.getByRole("listitem").filter({ hasText: `E2E-pcv Banque — garantie ${tag}` })).toBeVisible();
  await page.getByRole("button", { name: "Undo" }).click(); await expect(page.getByText("Undone")).toBeVisible();
  const undone = await server(page, cap.id); expect(undone.title).toBe(cap.title); expect((await sql`select 1 from page_tags where page_id = ${cap.id}`).length).toBe(0); expect((await sql`select 1 from knowledge_edges where from_id = ${cap.id}`).length).toBe(0);
  // destination + summary: the capture is filed (leaves the inbox) and the summary lands as an AI block; Undo brings everything back
  const card2 = page.getByRole("listitem").filter({ hasText: cap.title }); await card2.getByRole("button", { name: /^Suggest with AI/ }).click(); const panel2 = card2.getByTestId("inbox-suggestions"); await expect(panel2.getByRole("checkbox")).toHaveCount(6);
  await panel2.getByRole("button", { name: "Select all" }).click(); await expect(panel2.getByRole("button", { name: "Apply 6 selected" })).toBeEnabled(); await panel2.getByRole("button", { name: "Clear" }).click(); await expect(panel2.getByRole("button", { name: /^Apply/ })).toBeDisabled();
  await panel2.getByRole("checkbox", { name: /^File in/ }).check(); await panel2.getByRole("checkbox", { name: /^Summary/ }).check(); await panel2.getByRole("button", { name: "Apply 2 selected" }).click();
  await expect(page.getByText(/2 suggestions applied · filed in projects/)).toBeVisible(); await expect(page.getByRole("listitem").filter({ hasText: cap.title })).toHaveCount(0);
  const filed = await server(page, cap.id); expect(filed.inboxAt).toBeNull(); expect(filed.parentId).toBe(parent.id); const ai = find(filed.content, "aiBlock"); expect(ai.length).toBe(1); expect(ai[0].attrs.action).toBe("summary");
  await page.getByRole("button", { name: "Undo" }).click(); await expect(page.getByRole("listitem").filter({ hasText: cap.title })).toBeVisible();
  const back = await server(page, cap.id); expect(back.inboxAt).toBeTruthy(); expect(find(back.content, "aiBlock").length).toBe(0);
});

test("inbox suggestions: error (with and without retry), empty and cancelled states change nothing", async ({ page }) => {
  await page.goto("/"); const tag = uid(); const cap = await captureNote(page, { kind: "note", text: `E2E-pcv states ${tag}` }); let mode: "no_model" | "provider" | "empty" | "slow" = "no_model";
  await page.route("**/api/inbox/*/suggestions*", async (route) => {
    if (mode === "no_model") return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "No model is available for this task", code: "no_model" }) });
    if (mode === "provider") return route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ error: "The AI provider failed: overloaded", code: "provider_error" }) });
    if (mode === "slow") { await new Promise((r) => setTimeout(r, 4000)); return route.abort(); }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ pageId: cap.id, contentHash: "0".repeat(32), status: "ready", ai: true, model: "claude-haiku-5-5", provider: "anthropic", generatedAt: new Date().toISOString(), cached: true, costUsd: null, suggestions: { title: null, tags: [], destination: null, relations: [], summary: null } }) });
  });
  await page.goto("/inbox"); const card = page.getByRole("listitem").filter({ hasText: cap.title }); const panel = card.getByTestId("inbox-suggestions"); const ask = card.getByRole("button", { name: /^Suggest with AI/ });
  await ask.click(); await expect(panel.getByRole("alert")).toContainText("No AI model is available"); await expect(panel.getByRole("button", { name: "Try again" })).toHaveCount(0); await shot(page, "inbox-suggestions-error");
  await panel.getByRole("button", { name: "Close suggestions" }).click(); await expect(panel).toHaveCount(0);
  mode = "provider"; await ask.click(); await expect(panel.getByRole("alert")).toContainText("The AI provider failed"); mode = "empty"; await panel.getByRole("button", { name: "Try again" }).click();
  await expect(panel.getByRole("status")).toContainText("Nothing to suggest"); await expect(panel.getByRole("checkbox")).toHaveCount(0); await expect(panel.getByRole("button", { name: /^Apply/ })).toHaveCount(0);
  await panel.getByRole("button", { name: "Close suggestions" }).click(); mode = "slow"; await ask.click(); await expect(panel.getByRole("status")).toContainText("Reading the capture"); await panel.getByRole("button", { name: "Cancel" }).click(); await expect(panel).toHaveCount(0);
  const p = await server(page, cap.id); expect(p.title).toBe(cap.title); expect(p.inboxAt).toBeTruthy(); expect((await sql`select 1 from inbox_actions where page_id = ${cap.id}`).length).toBe(0);
});

test("inbox and archive: a failed load is shown as a failure with a retry, never as an empty list", async ({ page }) => {
  await page.goto("/"); let fail = true;
  await page.route(/\/api\/inbox$/, (route) => (fail ? route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "database unavailable" }) }) : route.continue()));
  await page.route(/\/api\/pages\?view=archived/, (route) => (fail ? route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "database unavailable" }) }) : route.continue()));
  await page.goto("/inbox"); await expect(page.getByText("The inbox could not be loaded")).toBeVisible({ timeout: 15_000 }); await expect(page.getByText("Nothing to sort")).toHaveCount(0); await expect(page.getByText("database unavailable")).toBeVisible();
  await page.goto("/archive"); await expect(page.getByText("Could not load the archive")).toBeVisible({ timeout: 15_000 }); await expect(page.getByText("Nothing archived")).toHaveCount(0);
  fail = false; await page.getByRole("button", { name: /^(Try again|Retry)$/ }).click(); await expect(page.getByText("Could not load the archive")).toHaveCount(0);
});

test("REAL provider (E2E_REAL_AI=1): suggestions for a real capture come back validated and AI-marked; nothing changes until applied", async ({ page }) => {
  test.skip(process.env.E2E_REAL_AI !== "1", "set E2E_REAL_AI=1 to call the real model once (about 0.0001 USD)"); test.setTimeout(150_000);
  await page.goto("/"); const tag = uid(); await newPage(page, `Refinancement du triplex ${tag}`, docOf(para("Projet de refinancement hypothécaire du triplex : banque, taux, notaire.")), { section: "projects" });
  const cap = await captureNote(page, { kind: "note", text: `E2E-pcv rappeler la banque triplex ${tag}\nDemander si la garantie de taux de 90 jours peut être prolongée pour le refinancement.` });
  await page.goto("/inbox"); const card = page.getByRole("listitem").filter({ hasText: cap.title }); await card.getByRole("button", { name: /^Suggest with AI/ }).click(); const panel = card.getByTestId("inbox-suggestions");
  await expect(panel.getByRole("status").or(panel.getByRole("checkbox").first()).or(panel.getByRole("alert")).first()).toBeVisible();
  await expect(panel.getByRole("checkbox").first(), "the real model returned at least one validated suggestion").toBeVisible({ timeout: 120_000 }); await expect(panel.locator(".ai-mark")).toHaveText("AI suggestions"); await shot(page, "inbox-suggestions-real");
  const cached = await apiCall(page, "GET", `/api/inbox/${cap.id}/suggestions?cachedOnly=1`); expect(cached.status).toBe(200); expect(cached.body.ai).toBe(true); expect(cached.body.model).toBeTruthy();
  logCost({ test: "inbox suggestions", model: cached.body.model, costUsd: cached.body.costUsd });
  const p = await server(page, cap.id); expect(p.title).toBe(cap.title); expect(p.inboxAt).toBeTruthy(); expect((await sql`select 1 from page_tags where page_id = ${cap.id}`).length).toBe(0);
});

// =====================================================================================================================
// C. Voice notes
// =====================================================================================================================
test("voice note: record with pause and resume — one recording whose length leaves the pause out", async ({ page }) => {
  test.setTimeout(90_000); await page.goto("/"); const p = await newPage(page, "voice pause", docOf(audioNode(null as unknown as string, { attachmentId: null, title: "" }), para("tail"))); await open(page, p.id);
  const block = page.locator(".nb[data-node='audio']"); await block.getByRole("button", { name: "Start recording" }).click(); await expect(block.getByRole("timer")).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(1300); await block.getByRole("button", { name: "Pause recording" }).click(); await expect(block.getByText("Paused", { exact: true })).toBeVisible(); await expect(block.getByRole("status")).toHaveText("Recording paused");
  const frozen = await block.getByRole("timer").textContent(); await page.waitForTimeout(2600); expect(await block.getByRole("timer").textContent(), "the clock stops while paused").toBe(frozen); await shot(page, "voice-recording-paused");
  await block.getByRole("button", { name: "Resume recording" }).click(); await expect(block.getByRole("status")).toHaveText("Recording in progress"); await page.waitForTimeout(1300); await block.getByRole("button", { name: "Stop recording" }).click();
  const node = await waitFor(async () => { const n = find((await server(page, p.id)).content, "audio")[0]; return n.attrs.attachmentId ? n : null; }, 30_000); atts.push(node.attrs.attachmentId);
  expect(node.attrs.duration).toBeGreaterThan(1.8); expect(node.attrs.duration, "about 2.6 s were recorded during 5.2 s of wall time").toBeLessThan(4.2);
  const file = await page.request.get(`/api/files/${node.attrs.attachmentId}`); expect(file.status()).toBe(200); expect((await file.body()).length).toBeGreaterThan(200);
  await expect(block.getByRole("group", { name: "Audio player" })).toBeVisible();
});

test("voice note: a refused or missing microphone is explained, and uploading a file stays possible", async ({ browser }) => {
  for (const [how, message] of [["denied", /Microphone access was refused\. Allow the microphone for this site/], ["absent", /No microphone was found on this device/], ["unsupported", /Recording is not available in this browser\. You can still upload an audio file/]] as const) {
    const ctx = await browser.newContext({ storageState: "test-results/.auth/state.json", baseURL: ORIGIN }); const page = await ctx.newPage();
    await page.addInitScript((mode) => { if (mode === "unsupported") { delete (window as any).MediaRecorder; return; } const err = new DOMException("no", mode === "denied" ? "NotAllowedError" : "NotFoundError"); Object.defineProperty(navigator.mediaDevices, "getUserMedia", { configurable: true, value: () => Promise.reject(err) }); }, how);
    await page.goto("/"); const p = await newPage(page, `mic ${how}`, docOf(audioNode(null as unknown as string, { attachmentId: null, title: "" }), para("tail"))); await open(page, p.id);
    const block = page.locator(".nb[data-node='audio']"); await block.getByRole("button", { name: "Start recording" }).click(); await expect(block).toContainText(message); await expect(block.getByRole("button", { name: "Upload audio file" })).toBeEnabled();
    if (how === "denied") { await shot(page, "voice-microphone-refused"); await openSheet(page); await sheet(page).getByRole("button", { name: "Record a voice memo" }).click(); await expect(page.getByText("Microphone access was refused", { exact: true })).toBeVisible(); }
    expect(find((await server(page, p.id)).content, "audio")[0].attrs.attachmentId).toBeNull(); await ctx.close();
  }
});

test("voice note: transcription states reach the node, timestamps seek, the AI summary inserts tasks and a summary, the search finds the transcript, the original can be deleted", async ({ page }) => {
  test.setTimeout(420_000); await page.goto("/"); const tag = uid(); const word = `zythum${tag}`; const att = await upload(page, `E2E-pcv reunion ${tag}.wav`, "audio/wav", wav(8));
  const p = await newPage(page, "voice flows", docOf(audioNode(att), para("tail"))); await open(page, p.id); const block = page.locator(".nb[data-node='audio']"); const blockId = find((await server(page, p.id)).content, "audio")[0].attrs.id;
  // the engine is simulated exactly where the worker would act: the request is answered "queued" and the transcript row is written by the test
  let posted: any = null;
  await page.route("**/api/audio/*/transcribe", async (route) => { posted = route.request().postDataJSON(); await sql`insert into audio_transcripts (attachment_id, workspace_id, status, want_summary) select ${att}, workspace_id, 'pending', true from attachments where id = ${att} on conflict (attachment_id) do update set status = 'pending', error = null`; await route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ ...idle, attachmentId: att, status: "pending", requestedAt: new Date().toISOString() }) }); });
  await expect(block.getByText("Sends the recording to the transcription engine (25 MB max).")).toBeVisible();
  await block.getByRole("button", { name: "Transcript + AI summary" }).click(); await expect(block.getByText("Transcription in progress…")).toBeVisible(); expect(posted).toEqual({ summarize: true });
  await waitFor(async () => find((await server(page, p.id)).content, "audio")[0].attrs.transcriptStatus === "pending"); await shot(page, "voice-transcription-pending");
  const transcript = [{ t: 0, text: "Réunion du budget." }, { t: 2.5, text: `Nous parlons du ${word} et du taux fixe.` }, { t: 5.5, text: "Marie envoie le contrat lundi." }];
  const summary = { text: "Le budget est revu et le taux fixe est retenu.", decisions: ["Retenir le taux fixe"], tasks: ["Marie : envoyer le contrat lundi", "Appeler le notaire"], model: "gpt-test-mini", at: new Date().toISOString() };
  await sql`update audio_transcripts set status = 'done', engine = 'openai', model = 'whisper-1', language = 'french', duration = 8, transcript = ${sql.json(transcript)}, text = ${transcript.map((l) => l.text).join(" ")}, summary = ${sql.json(summary)}, finished_at = now() where attachment_id = ${att}`;
  const list = block.getByRole("list", { name: "Transcript" }); await expect(list.getByRole("button")).toHaveCount(3, { timeout: 15_000 }); await expect(block.getByText("Transcribed with openai:whisper-1")).toBeVisible();
  const node = await waitFor(async () => { const n = find((await server(page, p.id)).content, "audio")[0]; return n.attrs.transcriptStatus === "done" ? n : null; });
  expect(node.attrs.transcript).toEqual(transcript); expect(node.attrs.transcriptEngine).toBe("openai:whisper-1"); expect(node.attrs.summary.text).toBe(summary.text);
  // timestamps seek the player
  await expect(list.getByRole("button").nth(1)).toContainText("[00:02]"); await list.getByRole("button").nth(1).click();
  await expect.poll(() => block.locator("audio").evaluate((a: HTMLAudioElement) => a.currentTime), { timeout: 10_000 }).toBeGreaterThanOrEqual(2.4); expect(await block.locator("audio").evaluate((a: HTMLAudioElement) => a.currentTime)).toBeLessThan(8); await block.getByRole("button", { name: "Pause" }).click();
  // AI summary: marked as AI, and inserted only on request, as AI blocks that name their source
  const box = block.getByRole("region", { name: "AI summary" }); await expect(box.locator(".au-ai-mark")).toHaveText("AI summary"); await expect(box).toContainText("gpt-test-mini"); await expect(box).toContainText("Retenir le taux fixe"); await shot(page, "voice-transcript-summary");
  expect(find((await server(page, p.id)).content, "aiBlock").length, "nothing is inserted by itself").toBe(0);
  await box.getByRole("button", { name: "Insert as tasks" }).click(); await expect(page.getByText("Tasks inserted below")).toBeVisible();
  const withTasks = await waitFor(async () => { const d = (await server(page, p.id)).content; return find(d, "aiBlock").length === 1 ? d : null; }); const tb = find(withTasks, "aiBlock")[0];
  expect(tb.attrs.action).toBe("tasks"); expect(tb.attrs.model).toBe("gpt-test-mini"); expect(tb.attrs.sources).toEqual([{ pageId: p.id, blockId, title: "Réunion budget" }]);
  expect(find(tb, "taskItem").map((i) => [i.attrs.checked, i.content[0].content[0].text])).toEqual([[false, "Marie : envoyer le contrat lundi"], [false, "Appeler le notaire"]]);
  await box.getByRole("button", { name: "Insert summary" }).click(); await expect(page.getByText("Summary inserted below")).toBeVisible();
  const withBoth = await waitFor(async () => { const d = (await server(page, p.id)).content; return find(d, "aiBlock").length === 2 ? d : null; }); const sb = find(withBoth, "aiBlock").find((b) => b.attrs.action === "summary");
  expect(sb.attrs.sources[0].blockId).toBe(blockId); expect(JSON.stringify(sb)).toContain(summary.text); expect(withBoth.content.findIndex((n: any) => n.type === "audio")).toBeLessThan(withBoth.content.findIndex((n: any) => n.type === "aiBlock"));
  await expect(page.locator(".note-editor .ai-block")).toHaveCount(2); await expect(page.locator(".note-editor .ai-block .cite-chip").first()).toContainText("Réunion budget"); await shot(page, "voice-inserted-ai-blocks");
  expect((await sql`select count(*)::int as n from knowledge_events where page_id = ${p.id} and kind = 'ai.applied'`)[0].n, "each insertion is journaled as ai.applied").toBe(2);
  // search: the transcript is indexed by the worker; the result is flagged as a voice note and opens the block with the matching line marked
  await waitFor(async () => { const r = await apiCall(page, "GET", `/api/search?mode=hybrid&q=${word}&limit=40&group=1&semantic=0`); return r.status === 200 && (r.body as any[]).some((h) => h.pageId === p.id); }, 300_000); // the index queue is shared with every page the other suites create and delete: one job every 2 s
  await page.evaluate(() => localStorage.setItem("note-search-filters", JSON.stringify({ kinds: [], section: "", range: "", since: "", until: "", semantic: false, archived: false })));
  await page.goto(`/search?q=${word}`); const hit = page.getByRole("listitem").filter({ hasText: "E2E-pcv voice flows" }).first(); await expect(hit).toBeVisible({ timeout: 20_000 }); await expect(hit).toContainText("voice note transcript"); await expect(hit.locator("mark").first()).toContainText(word); await shot(page, "search-transcript-hit");
  await hit.getByRole("link").click(); await expect(page).toHaveURL(new RegExp(`/p/${p.id}\\?hl=${word}#block-`)); const opened = page.locator(".nb[data-node='audio']");
  await expect(opened.getByTestId("au-hits")).toHaveText("1 transcript line matches your search"); await expect(opened.locator(".au-line[data-hit='true']")).toHaveCount(1); await expect(opened.locator(".au-line[data-hit='true']")).toContainText(word); await expect(opened).toBeInViewport(); await shot(page, "voice-search-hit-opened");
  // keep or delete the original: kept by default; deleting is confirmed and leaves the transcript and the summary
  const keep = opened.getByRole("group", { name: "Original audio" }); await expect(keep).toContainText("The original audio is kept."); await keep.getByRole("button", { name: "Delete original audio…" }).click();
  await expect(keep).toContainText("Delete the audio file? The transcript and the summary stay."); await keep.getByRole("button", { name: "Keep audio" }).click(); await expect(keep).toContainText("The original audio is kept."); expect((await page.request.get(`/api/files/${att}`)).status()).toBe(200);
  await keep.getByRole("button", { name: "Delete original audio…" }).click(); await keep.getByRole("button", { name: "Delete audio" }).click(); await expect(page.getByText("Original audio deleted")).toBeVisible();
  await expect(opened.getByRole("note")).toHaveText("The original audio was deleted — the transcript is kept."); await expect(opened.getByRole("group", { name: "Audio player" })).toHaveCount(0); await expect(opened.getByRole("list", { name: "Transcript" }).getByRole("button")).toHaveCount(3); await expect(opened.getByRole("region", { name: "AI summary" })).toBeVisible(); await shot(page, "voice-audio-deleted");
  const gone = await waitFor(async () => { const n = find((await server(page, p.id)).content, "audio")[0]; return n.attrs.attachmentId === null ? n : null; }); expect(gone.attrs.transcript).toEqual(transcript); expect(gone.attrs.summary.text).toBe(summary.text);
  expect((await page.request.get(`/api/files/${att}`)).status()).toBe(404);
});

test("voice note: a failed transcription says why and can be retried; the 25 MB limit of the API is explained", async ({ page }) => {
  test.setTimeout(90_000); await page.goto("/"); const tag = uid(); const att = await upload(page, `E2E-pcv echec ${tag}.wav`, "audio/wav", wav(2));
  const p = await newPage(page, "voice failure", docOf(audioNode(att), para("tail"))); await open(page, p.id); const block = page.locator(".nb[data-node='audio']"); const posts: any[] = [];
  const handler = async (route: any) => { posts.push(route.request().postDataJSON()); await sql`insert into audio_transcripts (attachment_id, workspace_id, status, error, finished_at) select ${att}, workspace_id, 'failed', ${`Transcription failed: the engine returned 500 (simulated, attempt ${posts.length})`}, now() from attachments where id = ${att} on conflict (attachment_id) do update set status = 'failed', error = excluded.error`; await route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ ...idle, attachmentId: att, status: "pending", requestedAt: new Date().toISOString() }) }); };
  await page.route("**/api/audio/*/transcribe", handler);
  await block.getByRole("button", { name: "Transcribe", exact: true }).click();
  await expect(block.getByText("Transcription failed", { exact: true })).toBeVisible({ timeout: 15_000 }); await expect(block.getByRole("alert")).toHaveText("Transcription failed: the engine returned 500 (simulated, attempt 1)"); await shot(page, "voice-transcription-failed");
  await waitFor(async () => find((await server(page, p.id)).content, "audio")[0].attrs.transcriptStatus === "failed"); expect(posts[0]).toEqual({});
  await block.getByRole("button", { name: "Retry transcription" }).click(); await expect.poll(() => posts.length).toBe(2); expect(posts[1]).toEqual({ force: true }); await expect(block.getByRole("alert")).toHaveText("Transcription failed: the engine returned 500 (simulated, attempt 2)", { timeout: 15_000 }); await expect(block.getByText("Transcription failed", { exact: true })).toBeVisible(); // the second attempt went through pending → failed
  // the real route refuses a recording over 25 MB before anything is queued or sent
  await page.unroute("**/api/audio/*/transcribe", handler); await sql`delete from audio_transcripts where attachment_id = ${att}`; await sql`update attachments set size = ${25 * 1024 * 1024 + 1} where id = ${att}`;
  await block.getByRole("button", { name: "Retry transcription" }).click(); await expect(block.getByRole("alert")).toContainText("This recording is larger than 25 MB, the most the transcription engine accepts"); await shot(page, "voice-limit-25mb");
  expect((await sql`select 1 from audio_transcripts where attachment_id = ${att}`).length, "nothing was queued").toBe(0);
  // a PDF attachment is not a recording
  const pdf = await upload(page, `E2E-pcv ${tag}.pdf`, "application/pdf", PDF); const r = await apiCall(page, "POST", `/api/audio/${pdf}/transcribe`, {}); expect(r.status).toBe(415); expect(r.body.code).toBe("not_audio");
});

test("REAL engine (E2E_REAL_AI=1): a spoken memo is captured, transcribed and summarised by the real providers, written into the node and found by search", async ({ page }) => {
  test.skip(process.env.E2E_REAL_AI !== "1", "set E2E_REAL_AI=1 to transcribe one short generated recording for real (a fraction of a cent)"); test.skip(process.platform !== "darwin", "needs macOS `say` and `afconvert`"); test.setTimeout(240_000);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pcv-voice-")); const aiff = path.join(tmp, "memo.aiff"), m4a = path.join(tmp, "memo.m4a");
  execFileSync("say", ["-o", aiff, "Budget meeting. We keep the fixed rate for five years. Marie sends the contract to the bank on Monday morning."]); execFileSync("afconvert", ["-f", "m4af", "-d", "aac", aiff, m4a]);
  const bytes = fs.readFileSync(m4a); fs.rmSync(tmp, { recursive: true, force: true }); expect(bytes.length).toBeLessThan(400_000);
  await page.goto("/"); const tag = uid(); const att = await upload(page, `E2E-pcv memo ${tag}.m4a`, "audio/mp4", bytes);
  const cap = await captureNote(page, { kind: "audio", attachmentIds: [att] }); expect(cap.kind).toBe("audio"); await open(page, cap.id); const block = page.locator(".nb[data-node='audio']");
  await block.getByRole("button", { name: "Transcript + AI summary" }).click(); await expect(block.getByText("Transcription in progress…")).toBeVisible({ timeout: 15_000 });
  const list = block.getByRole("list", { name: "Transcript" }); await expect(list.getByRole("button").first()).toBeVisible({ timeout: 180_000 }); await expect(list).toContainText(/fixed rate/i); await expect(list).toContainText(/Monday/i);
  const node = await waitFor(async () => { const n = find((await server(page, cap.id)).content, "audio")[0]; return n.attrs.transcriptStatus === "done" ? n : null; }, 30_000);
  expect(node.attrs.transcriptEngine).toMatch(/^openai:/); expect(node.attrs.transcript.length).toBeGreaterThan(0); expect(node.attrs.transcript.every((l: any) => typeof l.t === "number" && typeof l.text === "string")).toBe(true);
  const state = (await apiCall(page, "GET", `/api/audio/${att}`)).body; expect(state.status).toBe("done");
  if (state.summary) { await expect(block.getByRole("region", { name: "AI summary" })).toContainText(state.summary.text.slice(0, 30)); expect(node.attrs.summary.text).toBe(state.summary.text); } else await expect(block.getByRole("alert")).toContainText("Summary not produced");
  await shot(page, "voice-real-transcription");
  const usage = await sql`select task, model, cost_usd from ai_usage where ref_id = ${att}`; logCost({ test: "voice transcription", engine: node.attrs.transcriptEngine, durationSeconds: state.duration, usage: usage.map((u) => ({ task: u.task, model: u.model, costUsd: u.cost_usd })) });
  await waitFor(async () => { const r = await apiCall(page, "GET", `/api/search?mode=hybrid&q=${encodeURIComponent("fixed rate")}&limit=40&group=1&semantic=0`); return r.status === 200 && (r.body as any[]).some((h) => h.pageId === cap.id); }, 60_000);
  await expectNoHorizontalOverflow(page);
});
