/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : tests/e2e/next-integration.spec.ts
 * Description      : SP Note Next Generation — cross-feature scenario on the
 *                    merged build (integration hardening). One note holding
 *                    every new block is followed through the features built by
 *                    separate workstreams: editor (every block rendered,
 *                    opening it writes nothing), journal / timeline, knowledge
 *                    graph (blockRef, canvasLink and citation edges), knowledge
 *                    health, daily brief, Ask with scope "This page" (answer
 *                    faked at the HTTP level: no model is called) citing one of
 *                    its blocks, offline edit → one sync, a canvas page offline
 *                    (honest "needs a connection", never the text editor), its
 *                    canvas, Markdown export → re-import. Desktop Chromium with
 *                    the service worker, scratch database only; everything
 *                    created carries the prefix `E2E-integ` and is removed.
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
import { apiCall, docOf, para, PDF, sql, ORIGIN } from "./helpers";

const stamp = Date.now().toString(36); const PFX = "E2E-integ"; const T = (s: string) => `${PFX} ${s} ${stamp}`;
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const made: string[] = []; const refs: string[] = []; const TASK_ID = crypto.randomUUID();
const DUE = new Date(Date.now() + 36 * 3600_000).toISOString().slice(0, 10); // tomorrow or the day after: in the brief as due today / due soon
const server = async (page: Page, id: string) => (await apiCall(page, "GET", `/api/pages/${id}`)).body;
const text = (n: any): string => (!n ? "" : typeof n.text === "string" ? n.text : (n.content ?? []).map(text).join(" "));
const types = (n: any, out: Record<string, number> = {}): Record<string, number> => { if (n?.type && n.type !== "text") out[n.type] = (out[n.type] ?? 0) + 1; for (const c of n?.content ?? []) types(c, out); return out; };
const waitFor = async <V,>(fn: () => Promise<V | null | undefined | false>, ms = 30_000): Promise<V> => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error("condition not met in time"); await new Promise((r) => setTimeout(r, 300)); } };
const store = (page: Page, name: string) => page.evaluate((n) => new Promise<any[]>((resolve, reject) => { const r = indexedDB.open("note-local"); r.onerror = () => reject(r.error); r.onsuccess = () => { const d = r.result; if (!d.objectStoreNames.contains(n)) { d.close(); return resolve([]); } const g = d.transaction(n, "readonly").objectStore(n).getAll(); g.onsuccess = () => { d.close(); resolve(g.result.map((x: any) => ({ ...x, file: undefined }))); }; g.onerror = () => { d.close(); reject(g.error); }; }; }), name);
async function readyForOffline(page: Page, ids: string[]) {
  await page.goto("/"); const controlled = () => page.evaluate(() => Boolean(navigator.serviceWorker.controller));
  try { await waitFor(controlled, 15_000); } catch { await page.reload(); await waitFor(controlled, 30_000); }
  await waitFor(() => page.evaluate(async () => Boolean(await caches.match("/offline"))));
  await page.evaluate(() => new Promise<void>((resolve) => { const ch = new MessageChannel(); ch.port1.onmessage = () => resolve(); navigator.serviceWorker.controller!.postMessage({ type: "REFRESH_SHELL" }, [ch.port2]); setTimeout(resolve, 15_000); }));
  await page.reload(); await waitFor(async () => { const have = new Set((await store(page, "pages")).map((p) => p.id)); return ids.every((i) => have.has(i)); });
}
const upload = async (page: Page, name: string, mimeType: string, buffer: Buffer, pageId: string) => { const r = await page.request.fetch("/api/attachments", { method: "POST", headers: { origin: ORIGIN }, multipart: { file: { name, mimeType, buffer }, pageId } }); expect(r.status(), await r.text()).toBeLessThan(300); return (await r.json()).id as string; };

test.afterAll(async () => {
  await sql`delete from tasks where id = ${TASK_ID} or title like ${PFX + "%"}`;
  const ids = (await sql`select id from pages where title like ${PFX + "%"} or id = any(${made}::uuid[])`).map((r) => r.id as string);
  if (ids.length) { await sql`delete from knowledge_edges where from_id = any(${ids}::uuid[]) or to_id = any(${ids}::uuid[])`; await sql`delete from attachments where page_id = any(${ids}::uuid[])`; await sql`delete from knowledge_events where page_id = any(${ids}::uuid[])`; await sql`delete from pages where id = any(${ids}::uuid[])`; }
  if (refs.length) { await sql`delete from knowledge_edges where to_id = any(${refs}::uuid[])`; await sql`delete from "references" where id = any(${refs}::uuid[])`; }
});

test("one note with every new block lives in the timeline, the graph, health, the brief, Ask, offline, its canvas, and survives Markdown export → import", async ({ page, context, browser }) => {
  test.setTimeout(300_000); await page.goto("/");
  // ---------- the note and what it points to
  const target = await apiCall(page, "POST", "/api/pages", { title: T("target"), content: docOf(para(`Quoted passage ${stamp} about conditional variance.`)) }); made.push(target.body.id);
  const targetBlock = (await server(page, target.body.id)).content.content[0].attrs.id as string; expect(targetBlock).toBeTruthy();
  const canvas = await apiCall(page, "POST", "/api/pages", { title: T("canvas"), type: "canvas" }); expect(canvas.status).toBe(201); made.push(canvas.body.id);
  const ref = await apiCall(page, "POST", "/api/research/references", { title: `${PFX} Generalized autoregressive conditional heteroskedasticity ${stamp}`, authors: ["Bollerslev, Tim"], year: 1986 }); expect(ref.status).toBe(201); refs.push(ref.body.id);
  const shell = await apiCall(page, "POST", "/api/pages", { title: T("every block") }); expect(shell.status).toBe(201); made.push(shell.body.id); const N = shell.body.id as string;
  const png = await upload(page, "preview.png", "image/png", PNG, N); const pdf = await upload(page, "article.pdf", "application/pdf", PDF, N);
  const fixture = JSON.parse(fs.readFileSync("tests/fixtures/next-nodes/all-nodes.json", "utf8"));
  const rewrite = (n: any): any => {
    const a = n.attrs ? { ...n.attrs } : undefined;
    if (a) {
      if (n.type === "blockRef") { a.pageId = target.body.id; a.blockId = targetBlock; } if (n.type === "canvasLink") a.pageId = canvas.body.id; if (n.type === "citation") a.refId = ref.body.id;
      if (n.type === "pdf") a.attachmentId = pdf; if (n.type === "audio") a.attachmentId = png; if (n.type === "mermaid") a.preview = png; if (n.type === "drawing") { a.ink = png; a.preview = png; }
      if (n.type === "queryView") a.filter = { status: "open" }; delete a.id; // ids are given by the server
    }
    return { ...n, ...(a ? { attrs: a } : {}), ...(n.content ? { content: n.content.map(rewrite) } : {}) };
  };
  const body = rewrite(fixture).content as any[];
  const content = docOf(para(`Integration zeta ${stamp}: the opening paragraph of the note.`), ...body,
    { type: "callout", attrs: { kind: "decision", icon: "⚖️" }, content: [para("We keep the GARCH(1,1) specification.")] }, { type: "callout", attrs: { kind: "question", icon: "❓" }, content: [para("Is the persistence stable?")] }, { type: "callout", attrs: { kind: "hypothesis", icon: "🧪" }, content: [para("Volatility clusters.")] },
    { type: "taskList", content: [{ type: "taskItem", attrs: { checked: false, due: DUE, priority: "high", taskId: TASK_ID }, content: [para(`${PFX} task ${stamp}`)] }] }, para("Closing paragraph."));
  const saved = await apiCall(page, "PATCH", `/api/pages/${N}`, { content, baseVersion: shell.body.version }); expect(saved.status, JSON.stringify(saved.body).slice(0, 300)).toBe(200);
  const stored = await server(page, N); const kinds = types(stored.content); const NEW = ["mermaid", "drawing", "chart", "queryView", "citation", "bibliography", "pdf", "blockRef", "runCode", "audio", "canvasLink"];
  for (const k of NEW) expect(kinds[k], `stored ${k}`).toBe(1); expect(kinds.callout).toBe(3); expect(kinds.taskItem).toBe(1);
  const zetaBlock = stored.content.content[0].attrs.id as string;

  // ---------- editor: every block rendered, not locked, and VIEWING writes nothing
  await page.goto(`/p/${N}`); const ed = page.locator("#main-scroll .note-editor .ProseMirror").first(); await ed.waitFor();
  await expect(page.getByTestId("editor-lock")).toHaveCount(0);
  for (const k of NEW.filter((k) => k !== "citation")) await expect(page.locator(`.nb[data-node='${k}']`).first(), `rendered ${k}`).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".nb[data-node='unknownBlock']")).toHaveCount(0);
  await page.waitForTimeout(4000); const viewed = await server(page, N);
  const changed = (viewed.content.content as any[]).map((n, i) => (JSON.stringify(n) === JSON.stringify(stored.content.content[i]) ? null : `${n.type}: ${JSON.stringify(stored.content.content[i]).slice(0, 400)} → ${JSON.stringify(n).slice(0, 400)}`)).filter(Boolean);
  expect(changed, "opening the note changed no block").toEqual([]); expect(viewed.version, "opening the note saved nothing").toBe(stored.version);

  // ---------- journal / timeline, graph, health, brief
  const ev = (await apiCall(page, "GET", `/api/events?pageId=${N}`)).body.events.map((e: any) => e.kind) as string[]; expect(ev).toContain("page.created"); expect(ev).toContain("page.edited");
  await page.goto("/timeline"); await expect(page.getByTestId("timeline")).toContainText(T("every block"), { timeout: 20_000 });
  const edges = await sql`select to_id, kind, target_kind from knowledge_edges where from_id = ${N}`; const edge = (to: string) => edges.find((e) => e.to_id === to);
  expect(edge(target.body.id)?.kind, "blockRef → link edge").toBe("link"); expect(edge(canvas.body.id)?.kind, "canvasLink → link edge").toBe("link"); expect(edge(ref.body.id)?.kind, "citation → cites edge").toBe("cites"); expect(edge(ref.body.id)?.target_kind).toBe("reference");
  const local = (await apiCall(page, "GET", `/api/graph?view=local&pageId=${N}`)).body; const nodeIds = local.nodes.map((n: any) => n.id); expect(local.center).toBe(N); expect(nodeIds).toContain(target.body.id); expect(nodeIds).toContain(canvas.body.id);
  const tm = (await apiCall(page, "GET", `/api/tasks/${TASK_ID}`)).body; expect(tm.pageId, "the taskItem became a task of the page").toBe(N); expect(tm.dueAt, "a bare date of a taskItem is stored at 12:00 UTC").toBe(`${DUE}T12:00:00.000Z`);
  await page.goto(`/graph?pageId=${N}`); await page.getByTestId("graph-canvas").waitFor({ timeout: 30_000 });
  const health = (await apiCall(page, "GET", "/api/health/knowledge")).body; expect(health.orphans.ids, "a note with links is not an orphan").not.toContain(N); expect(health.score.pages).toBeGreaterThanOrEqual(3);
  const brief = (await apiCall(page, "GET", "/api/brief")).body; expect(brief.recentNotes.map((n: any) => n.id)).toContain(N); expect(JSON.stringify(brief.tasks)).toContain(TASK_ID);
  await page.goto("/"); await expect(page.getByTestId("brief")).toContainText(T("every block"));

  // ---------- Ask, scope "This page": the answer (faked at the HTTP level) cites a block of the note; the chip jumps to it
  const noSw = await browser.newContext({ baseURL: ORIGIN, storageState: "test-results/.auth/state.json", viewport: { width: 1280, height: 800 }, serviceWorkers: "block" }); const ap = await noSw.newPage();
  const sent: any[] = []; const sse = (events: unknown[]) => events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("") + "data: [DONE]\n\n";
  const src = { n: 1, chunkId: "c1", pageId: N, title: T("every block"), icon: null, heading: null, blockId: zetaBlock, excerpt: "Integration zeta: the opening paragraph of the note.", score: 0.02, semantic: 0.7, sourceType: "page", blockIds: [zetaBlock], anchor: "block", quote: "the opening paragraph of the note" };
  await ap.route("**/api/ai/chat", (route) => { const b = route.request().postDataJSON(); sent.push(b); return route.fulfill({ contentType: "text/event-stream", body: sse([{ type: "meta", conversationId: "00000000-0000-4000-8000-000000000002", clientId: b.clientId, mode: "notes", model: "fake-model", provider: "fake", reason: "test", task: "chat", sources: [src], weak: [], evidence: "ok", sent: { pageChars: 0, excerpts: 1, references: 0, images: 0, history: 0, embeddedBy: null, rankedBy: null }, budgetNote: null, replayed: false, scope: b.scope ?? "all", scopePages: 1, staleDropped: 0 }, { type: "text", delta: "It opens the note [1]." }, { type: "done", messageId: "m1", content: "It opens the note [1].", usage: null, costUsd: 0, latencyMs: 10, ttftMs: 5, sources: [src], evidence: "ok", invalidCitations: [], uncited: false, replayed: false }]) }); });
  await ap.goto(`/p/${N}`); await ap.locator(".note-editor .ProseMirror").first().waitFor(); await ap.getByRole("button", { name: "Ask about this page" }).first().click();
  const panel = ap.getByRole("complementary", { name: "AI assistant" }); await panel.getByTestId("ask-scope").getByRole("radio", { name: "This page" }).click();
  await panel.getByLabel("Message").fill("What does the first paragraph say?"); await panel.getByRole("button", { name: "Send" }).click();
  const chip = panel.getByTestId("cite-chip").first(); await expect(chip).toBeVisible({ timeout: 30_000 }); expect(sent.at(-1)).toMatchObject({ scope: "page", pageId: N }); await expect(chip).toHaveAttribute("data-block", zetaBlock);
  await ap.evaluate(() => { document.getElementById("main-scroll")!.scrollTop = 99999; }); await chip.click(); await expect(ap.locator(`#block-${zetaBlock}`)).toBeInViewport();
  expect((await server(page, N)).version, "asking wrote nothing into the note").toBe(stored.version); await noSw.close();

  // ---------- offline: the note is edited, a canvas and a database page say they need a connection, then exactly one sync
  const dbPage = await apiCall(page, "POST", "/api/pages", { title: T("database"), type: "database", section: "databases" }); made.push(dbPage.body.id);
  await readyForOffline(page, [N, canvas.body.id, dbPage.body.id]); const before = await server(page, N); const editsBefore = (await apiCall(page, "GET", `/api/events?pageId=${N}&kinds=page.edited`)).body.events.length;
  const canvasBefore = (await apiCall(page, "GET", `/api/canvases/${canvas.body.id}`)).body;
  await context.setOffline(true);
  for (const [id, word] of [[canvas.body.id, "Canvases"], [dbPage.body.id, "Databases"]] as const) {
    await page.goto(`/p/${id}`); await expect(page.getByTestId("offline-app")).toBeVisible(); const op = page.locator(`[data-testid=offline-page][data-page-id="${id}"]`); await expect(op).toBeVisible();
    await expect(op).toContainText(`${word} are not kept on this device`); await expect(op.locator(".ProseMirror")).toHaveCount(0); // never the text editor on a canvas / database page
  }
  await page.goto(`/p/${N}`); await expect(page.getByTestId("offline-app")).toBeVisible(); const off = page.locator("[data-testid=offline-page] .ProseMirror").first(); await expect(off).toContainText(`Integration zeta ${stamp}`);
  await off.locator("> p").first().click(); await page.keyboard.press("End"); await page.keyboard.type(" Edited offline.");
  await waitFor(async () => (await store(page, "drafts")).some((d) => d.pageId === N && text(d.patch.content).includes("Edited offline.")));
  await context.setOffline(false); await expect(page.getByTestId("offline-app")).toBeHidden({ timeout: 60_000 });
  const after = await waitFor(async () => { const s = await server(page, N); return text(s.content).includes("Edited offline.") ? s : null; }, 60_000);
  await page.waitForTimeout(3000); const settled = await server(page, N);
  expect(settled.version, "synced once: one new version").toBe(before.version + 1); expect(after.version).toBe(settled.version);
  expect((await apiCall(page, "GET", `/api/events?pageId=${N}&kinds=page.edited`)).body.events.length - editsBefore, "at most one journal entry for the offline edit (edits are coalesced)").toBeLessThanOrEqual(1);
  expect(types(settled.content), "every block survived the offline editor").toEqual(types(before.content));
  const canvasAfter = (await apiCall(page, "GET", `/api/canvases/${canvas.body.id}`)).body; expect(canvasAfter.version, "the canvas was not touched by being opened offline").toBe(canvasBefore.version); expect((await server(page, canvas.body.id)).type).toBe("canvas");

  // ---------- its canvas opens from the canvasLink block
  await page.goto(`/p/${N}`); await ed.waitFor(); await page.locator(".nb[data-node='canvasLink']").first().getByRole("link").first().click().catch(async () => { await page.locator(".nb[data-node='canvasLink']").first().dblclick(); });
  await page.waitForURL(new RegExp(`/p/${canvas.body.id}`), { timeout: 20_000 }); await expect(page.locator("[data-testid='canvas-surface']")).toBeVisible({ timeout: 20_000 });

  // ---------- Markdown: the documented forms, then re-import
  const exp = await page.request.get(`/api/export?format=md&pageId=${N}`); expect(exp.status()).toBe(200); const md = await exp.text();
  for (const form of ["```mermaid", `[[${target.body.id}#${targetBlock}]]`, `[Canvas](/p/${canvas.body.id})`, "```javascript", "```output", "[PDF: article.pdf]", "[Audio: Réunion de laboratoire]", "| Trimestre | Ventes | Marge |", "[Vue: Tâches ouvertes]", "[@", `Integration zeta ${stamp}`, "Edited offline."]) expect(md, `Markdown form ${form}`).toContain(form);
  const imp = await page.request.fetch("/api/import", { method: "POST", headers: { origin: ORIGIN }, multipart: { file: { name: `${PFX} reimport ${stamp}.md`, mimeType: "text/markdown", buffer: Buffer.from(md, "utf8") }, sync: "1" } });
  expect(imp.status(), await imp.text()).toBeLessThan(300); const impBody = await imp.json(); expect(impBody.pageId).toBeTruthy(); made.push(impBody.pageId);
  if (impBody.jobId) await apiCall(page, "DELETE", `/api/import?jobId=${impBody.jobId}`); await sql`delete from settings where key like 'import.%' and value->>'filename' like ${PFX + "%"}`; // the job record of this import
  const back = await server(page, impBody.pageId); const bt = types(back.content); const backText = text(back.content);
  // what the documented Markdown forms carry back: structural blocks as blocks, the rest as readable text (never lost)
  for (const k of ["mermaid", "runCode", "blockRef", "canvasLink", "table"]) expect(bt[k] ?? 0, `re-imported as a ${k} block (${JSON.stringify(bt)})`).toBeGreaterThanOrEqual(1);
  for (const s of [`Integration zeta ${stamp}`, "Edited offline.", "Ventes par trimestre", "Closing paragraph.", "We keep the GARCH(1,1) specification.", "Bonjour à tous."]) expect(backText, `text kept: ${s}`).toContain(s);
  expect(JSON.stringify(back.content)).toContain(targetBlock);
});
