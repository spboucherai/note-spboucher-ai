/**
 * file: tests/e2e/next-p-ra.spec.ts
 * description: slice next-p-ra — living blocks on real data (queryView + chart fed by a database: live indicator, refresh on focus,
 *   stale snapshot when the server cannot be reached), citations resolved in one batched request, research project scaffold + section
 *   templates + LaTeX / BibTeX export, PDF annotations saved as extracts of the reference the PDF belongs to (no duplicate), contextual
 *   AI (new actions previewed, inserted as an aiBlock with action + sources; link suggestions confirmed one by one). The AI endpoint is
 *   answered by the test in the documented SSE format (docs/next/API-NEXT-AI.md §3): no provider is called here.
 *   Desktop Chromium, scratch database only; everything created carries the prefix `E2E-pra2` and is removed in afterAll.
 * author: Simon-Pierre Boucher — contact@spboucher.ai
 */
import { test, expect, type Page, type Route } from "@playwright/test";
import { apiCall, docOf, para, PDF, sql, ORIGIN } from "./helpers";

const PFX = "E2E-pra2"; const stamp = Date.now().toString(36); const SHOTS = process.env.E2E_SHOTS_DIR ?? "";
const made: string[] = []; const refs: string[] = []; const tasks: string[] = [];
const shot = async (page: Page, name: string) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false }); };
const newPage = async (page: Page, title: string, content?: unknown, extra: Record<string, unknown> = {}) => { const r = await apiCall(page, "POST", "/api/pages", { title: `${PFX} ${title} ${stamp}`, ...(content ? { content } : {}), ...extra }); expect(r.status).toBe(201); made.push(r.body.id); return r.body as { id: string; version: number; title: string }; };
const server = async (page: Page, id: string) => (await apiCall(page, "GET", `/api/pages/${id}`)).body;
const editor = (page: Page) => page.locator("#main-scroll .note-editor .ProseMirror").first();
const open = async (page: Page, id: string) => { await page.goto(`/p/${id}`); await editor(page).waitFor(); };
const saved = (page: Page) => expect(page.getByRole("status").filter({ hasText: /^Saved/ }).first()).toBeVisible({ timeout: 15_000 });
const find = (n: any, type: string): any[] => [...(n?.type === type ? [n] : []), ...((n?.content ?? []) as any[]).flatMap((c) => find(c, type))];
const waitFor = async <T>(fn: () => Promise<T | null | undefined | false>, ms = 15_000): Promise<T> => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error("condition not met in time"); await new Promise((r) => setTimeout(r, 300)); } };
const newRef = async (page: Page, body: Record<string, unknown>) => { const r = await apiCall(page, "POST", "/api/research/references", body); expect(r.status).toBe(201); refs.push(r.body.id); return r.body as { id: string; citeKey: string }; };
test.afterAll(async () => {
  if (tasks.length) await sql`delete from tasks where id = any(${tasks}::uuid[])`;
  if (refs.length) await sql`delete from "references" where id = any(${refs}::uuid[])`;
  await sql`delete from tasks where page_id in (select id from pages where title like ${PFX + " %"})`;
  const all = await sql`with recursive t as (select id from pages where title like ${PFX + " %"} or id = any(${made}::uuid[]) union select p.id from pages p join t on p.parent_id = t.id) select id from t`;
  const ids = all.map((r) => r.id as string); if (ids.length) { await sql`delete from pages where database_id in (select id from databases where page_id = any(${ids}::uuid[]))`; await sql`delete from pages where id = any(${ids}::uuid[])`; }
});

/* ------------------------------------------------------------ C. living blocks ------------------------------------------------------------ */
test("queryView: real rows from POST /api/query, live indicator, refresh on focus, stale snapshot when the server fails — also after a reload", async ({ page }) => {
  test.setTimeout(90_000); await page.goto("/");
  const host = await newPage(page, "live host", docOf(para("tasks live here")));
  for (const [title, extra] of [["write the model", { priority: "high", due: "2031-03-04" }], ["collect the data", {}]] as const) { const t = await apiCall(page, "POST", "/api/tasks", { title: `${PFX} ${title}`, pageId: host.id, ...extra }); expect(t.status).toBe(201); tasks.push(t.body.id ?? t.body.task?.id); }
  const qv = (layout: string, title: string) => ({ type: "queryView", attrs: { source: "tasks", databaseId: null, viewId: null, filter: { parentId: host.id, status: "all" }, layout, limit: 25, title } });
  const p = await newPage(page, "live view", docOf(para("above"), qv("list", "Project tasks"), qv("table", "As a table"), para("below")));
  await open(page, p.id);
  const list = page.locator(".nb[data-node='queryView']").first(), table = page.locator(".nb[data-node='queryView']").nth(1);
  await expect(list.getByTestId("query-rows").locator(".qv-row")).toHaveCount(2); await expect(list).toContainText(`${PFX} write the model`); await expect(list.getByTestId("query-count")).toHaveText("2");
  const badge = list.getByTestId("live-indicator"); await expect(badge).toHaveAttribute("data-state", "live"); await expect(badge).toContainText(/Live · updated (just now|\d+ min ago)/);
  // table layout: headers are the server's column labels, the title column is not repeated
  await expect(table.locator("thead th")).toHaveText(["Title", "État", "Priorité", "Échéance", "Page", "Projet"]); await expect(table.locator("tbody tr").first()).toContainText("high");
  await shot(page, "c1-queryview-live");
  // a task added elsewhere appears when the window regains focus (no click in the block)
  await page.waitForTimeout(5300);
  const t3 = await apiCall(page, "POST", "/api/tasks", { title: `${PFX} third task`, pageId: host.id }); tasks.push(t3.body.id ?? t3.body.task?.id);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(list.getByTestId("query-rows").locator(".qv-row")).toHaveCount(3, { timeout: 10_000 }); await expect(list.getByTestId("query-count")).toHaveText("3");
  // the server stops answering: the last answer stays on screen, clearly flagged
  const q = /\/api\/query$/; await page.route(q, (r: Route) => r.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "E2E maintenance" }) }));
  await list.getByRole("button", { name: "Refresh" }).click();
  await expect(list.getByTestId("live-stale")).toContainText("E2E maintenance"); await expect(list.getByTestId("live-indicator")).toHaveAttribute("data-state", "stale"); await expect(list.getByTestId("live-indicator")).toContainText(/Not refreshed · snapshot from/);
  await expect(list.getByTestId("query-rows").locator(".qv-row")).toHaveCount(3);
  // offline (request aborted) after a reload: the copy kept on the device is shown as a snapshot
  await page.unroute(q); await page.route(q, (r: Route) => r.abort("internetdisconnected"));
  await page.reload(); await editor(page).waitFor();
  const again = page.locator(".nb[data-node='queryView']").first();
  await expect(again.getByTestId("query-rows").locator(".qv-row")).toHaveCount(3, { timeout: 15_000 }); await expect(again.getByTestId("live-indicator")).toHaveAttribute("data-state", /offline|stale/); await expect(again.getByTestId("live-stale")).toBeVisible();
  await shot(page, "c2-queryview-stale");
  // back online: Retry brings the live state back
  await page.unroute(q); await again.getByTestId("live-stale").getByRole("button", { name: "Retry" }).click();
  await expect(again.getByTestId("live-indicator")).toHaveAttribute("data-state", "live"); await expect(again.getByTestId("live-stale")).toHaveCount(0);
  // the living dot does not animate under reduced motion
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(await again.locator(".live-dot").evaluate((el) => getComputedStyle(el, "::after").animationName)).toBe("none");
});

test("chart with a database source: drawn from live rows, viewing writes nothing, snapshot stored with a user edit and on Refresh, and the snapshot is shown when offline", async ({ page }) => {
  test.setTimeout(90_000); await page.goto("/");
  const db = await newPage(page, "chart db", undefined, { type: "database", section: "databases" });
  const prop = await apiCall(page, "POST", `/api/databases/${db.id}/properties`, { name: "Score", type: "number" }); expect(prop.status).toBe(201);
  for (const [title, v] of [["Alpha", 3], ["Beta", 7]] as const) expect((await apiCall(page, "POST", `/api/databases/${db.id}/rows`, { title, values: { [prop.body.id]: v } })).status).toBeLessThan(300);
  const p = await newPage(page, "chart live", docOf(para("above"), { type: "chart", attrs: { kind: "bar", title: "Scores", columns: [], rows: [], x: null, y: [], source: { databaseId: db.id } } }, para("below")));
  await open(page, p.id);
  const block = page.locator(".nb[data-node='chart']");
  await expect(block.getByTestId("chart-svg").locator("rect.ch-mark")).toHaveCount(2, { timeout: 15_000 });
  await expect(block.getByTestId("chart-source")).toContainText("Database"); await expect(block.getByTestId("live-indicator")).toHaveAttribute("data-state", "live");
  // merely VIEWING the page writes nothing: no save, no new version, no `page.edited` event (the live table is drawn, the stored snapshot waits)
  const v0 = (await server(page, p.id)).version; await page.waitForTimeout(4000);
  const viewed = await server(page, p.id); expect(viewed.version).toBe(v0); expect(find(viewed.content, "chart")[0].attrs.rows).toEqual([]);
  expect((await apiCall(page, "GET", `/api/events?pageId=${p.id}&kinds=page.edited`)).body.events).toHaveLength(0);
  // a real user edit carries the snapshot into the node (what natives and offline readers draw), source untouched;
  // undo does not fight it: the snapshot write is outside the history
  await editor(page).locator("> p").first().click(); await page.keyboard.press("End"); await page.keyboard.type(" x");
  const node = await waitFor(async () => { const n = find((await server(page, p.id)).content, "chart")[0]; return n.attrs.rows.length === 2 ? n : null; });
  expect(node.attrs.columns).toEqual(["Name", "Score"]); expect(node.attrs.rows).toEqual([["Alpha", 3], ["Beta", 7]]); expect(node.attrs.source).toEqual({ databaseId: db.id }); expect(node.attrs.y).toEqual(["Score"]);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(block.getByTestId("chart-svg").locator("rect.ch-mark")).toHaveCount(2);
  // a row added in the database shows up on refresh, and the stored snapshot follows
  expect((await apiCall(page, "POST", `/api/databases/${db.id}/rows`, { title: "Gamma", values: { [prop.body.id]: 5 } })).status).toBeLessThan(300);
  await block.getByRole("button", { name: "Refresh" }).click();
  await expect(block.getByTestId("chart-svg").locator("rect.ch-mark")).toHaveCount(3, { timeout: 10_000 });
  await waitFor(async () => find((await server(page, p.id)).content, "chart")[0].attrs.rows.length === 3);
  await shot(page, "c3-chart-live");
  // offline: the stored snapshot is drawn and says so
  await page.route(/\/api\/query$/, (r: Route) => r.abort("internetdisconnected"));
  await page.reload(); await editor(page).waitFor();
  const off = page.locator(".nb[data-node='chart']");
  await expect(off.getByTestId("chart-svg").locator("rect.ch-mark")).toHaveCount(3, { timeout: 15_000 }); await expect(off.getByTestId("live-indicator")).toHaveAttribute("data-state", /offline|stale/); await expect(off.getByTestId("chart-source")).toContainText(/snapshot/i);
  await shot(page, "c4-chart-offline");
});

/* ------------------------------------------------------------ A. research ------------------------------------------------------------ */
test("citations: every citation of a page is resolved by ONE ?ids= request; labels follow the reference; a deleted reference is flagged", async ({ page }) => {
  await page.goto("/");
  const a = await newRef(page, { title: `${PFX} Mortgage Prepayment`, authors: ["Jane Doe", "John Roe"], year: 2021, journal: "Journal of Housing Finance" });
  const b = await newRef(page, { title: `${PFX} Term Premia`, authors: ["Ada Lovelace"], year: 2019 });
  const ghost = "5d3f9a52-0c1e-4c0b-9a38-0d6f2f1c7e11";
  const cite = (refId: string, label: string, locator = "") => ({ type: "citation", attrs: { refId, locator, label } });
  const p = await newPage(page, "citations", docOf({ type: "paragraph", content: [{ type: "text", text: "See " }, cite(a.id, "stale label", "p. 12"), { type: "text", text: " and " }, cite(b.id, "Lovelace 2019"), { type: "text", text: ", again " }, cite(a.id, "Doe & Roe 2021"), { type: "text", text: " and a lost one " }, cite(ghost, "Lost 1999")] }, { type: "bibliography", attrs: { style: "apa", title: "References" } }));
  const calls: string[] = []; page.on("request", (r) => { if (r.url().includes("/api/research/references")) calls.push(r.url().replace(ORIGIN, "")); });
  await open(page, p.id);
  const chips = page.locator("[data-node='citation'] .cite-inline");
  await expect(chips.first()).toHaveText("(Doe & Roe 2021, p. 12)"); await expect(chips.first()).toHaveAttribute("data-ref-state", "resolved"); await expect(chips.nth(1)).toHaveText("(Lovelace 2019)");
  await expect(chips.nth(3)).toHaveAttribute("data-ref-state", "deleted"); await expect(chips.nth(3)).toHaveText("(Lost 1999)");
  const bib = page.getByTestId("bibliography-list"); await expect(bib.locator("li")).toHaveCount(3);
  await expect(bib).toContainText("Doe, J., & Roe, J. (2021)"); await expect(bib).toContainText("Lovelace, A. (2019)"); await expect(bib.locator("li[data-missing]")).toContainText("Reference not found");
  const idCalls = calls.filter((u) => u.includes("?ids=")); expect(idCalls, "one batched request for the page").toHaveLength(1);
  expect(idCalls[0].split("ids=")[1].split(",").sort()).toEqual([a.id, b.id, ghost].sort()); expect(calls.filter((u) => !u.includes("?ids=")), "the library is not downloaded to resolve citations").toHaveLength(0);
  // the stored label was not rewritten just by displaying the page
  expect(find((await server(page, p.id)).content, "citation")[0].attrs.label).toBe("stale label");
  await shot(page, "a1-citations");
});

test("research project: scaffold from the overview, project pages, section templates, LaTeX / BibTeX export with its report", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/research");
  await page.getByRole("button", { name: "New working paper" }).click();
  await page.getByRole("radio", { name: /Research project/ }).check(); await page.getByLabel("Title").fill(`${PFX} Term structure ${stamp}`);
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await page.waitForURL(/\/p\/[0-9a-f-]{36}/); const id = page.url().split("/p/")[1].slice(0, 36); made.push(id); await editor(page).waitFor();
  const outline = page.getByTestId("project-outline"); for (const t of ["Hypotheses", "Methods notes", "Equations", "Results", "Figures"]) await expect(outline.getByRole("link", { name: new RegExp(t) })).toBeVisible();
  await expect(editor(page).locator(".callout[data-kind='question']")).toHaveCount(1);
  // insert a section template: existing nodes, at the end of the page
  await page.getByRole("button", { name: "Insert a research section" }).click(); await page.getByRole("menuitem", { name: /Hypothesis/ }).click();
  await expect(editor(page).locator(".callout[data-kind='hypothesis']")).toHaveCount(1); await saved(page);
  await page.getByRole("button", { name: "Insert a research section" }).click(); await page.getByRole("menuitem", { name: /^Figure/ }).click();
  await expect(editor(page).locator(".nb[data-node='chart']")).toHaveCount(1);
  const doc = await waitFor(async () => { const s = await server(page, id); return find(s.content, "chart").length === 1 && find(s.content, "callout").some((c) => c.attrs.kind === "hypothesis") ? s : null; });
  expect(doc.type).toBe("research"); expect(doc.properties.researchKind).toBe("project");
  // export: report first, then the three downloads
  await page.getByRole("button", { name: "Export the project" }).click();
  const pop = page.getByTestId("research-export"); await expect(pop.getByTestId("export-report")).toContainText(/5 sections · 0 cite keys · 0 figures · 2 hypotheses/);
  await expect(pop.getByTestId("export-tex")).toHaveAttribute("href", `/api/research/export.tex?projectId=${id}`); await expect(pop.getByTestId("export-zip")).toHaveAttribute("href", `/api/research/export.tex?projectId=${id}&format=zip`); await expect(pop.getByTestId("export-bib")).toHaveAttribute("href", `/api/research/references/export.bib?projectId=${id}`);
  await shot(page, "a2-research-project-export");
  const [download] = await Promise.all([page.waitForEvent("download"), pop.getByTestId("export-tex").click()]); expect(download.suggestedFilename()).toMatch(/\.tex$/);
  const tex = await page.request.get(`/api/research/export.tex?projectId=${id}`); expect(tex.status()).toBe(200); const body = await tex.text();
  for (const s of ["\\documentclass", "\\section{Hypotheses}", "\\section{Figures}", "\\begin{abstract}", "\\begin{equation}"]) expect(body).toContain(s);
  const zip = await page.request.get(`/api/research/export.tex?projectId=${id}&format=zip`); expect(zip.status()).toBe(200); expect(zip.headers()["content-type"]).toContain("application/zip"); expect((await zip.body()).subarray(0, 2).toString()).toBe("PK");
  expect((await page.request.get(`/api/research/references/export.bib?projectId=${id}`)).status()).toBe(200);
  // the plain working paper is still what "New working paper" creates by default
  const paper = await apiCall(page, "POST", "/api/research/papers", { title: `${PFX} plain paper ${stamp}` }); expect(paper.status).toBe(201); made.push(paper.body.id); expect(paper.body.children).toBeUndefined(); expect(paper.body.properties.tags).toEqual(["working-paper"]);
});

test("pdf of a reference: highlights and notes become the reference's extracts — once, updated in place, removed with the annotation", async ({ page }) => {
  test.setTimeout(120_000); await page.goto("/");
  const up = await page.request.post("/api/attachments", { multipart: { file: { name: "doe-2021.pdf", mimeType: "application/pdf", buffer: PDF } }, headers: { origin: ORIGIN } }); expect(up.status()).toBe(201); const att = (await up.json()).id as string;
  const ref = await newRef(page, { title: `${PFX} Annotated paper`, authors: ["Jane Doe"], year: 2021 });
  expect((await apiCall(page, "POST", `/api/research/references/${ref.id}?action=attach`, { attachmentId: att })).status).toBe(200);
  const byAtt = await apiCall(page, "GET", `/api/research/references?attachmentId=${att}`); expect(byAtt.status).toBe(200); expect(byAtt.body.map((r: any) => [r.id, r.label])).toEqual([[ref.id, "Doe (2021)"]]);
  expect((await apiCall(page, "GET", "/api/research/references?attachmentId=nope")).status).toBe(400);
  const p = await newPage(page, "pdf extracts", docOf({ type: "pdf", attrs: { attachmentId: att, name: "doe-2021.pdf", page: 1, annotations: [] } }, para("tail")));
  const extracts = async () => (await apiCall(page, "GET", `/api/research/references/${ref.id}/extracts`)).body as any[];
  await open(page, p.id);
  const block = page.locator(".nb[data-node='pdf']"); const layer = page.getByTestId("pdf-textlayer"); await expect(layer).toContainText("Hello note", { timeout: 30_000 });
  const link = block.getByTestId("pdf-reference-link"); await expect(link).toContainText("PDF of Doe (2021)"); await expect(link).toContainText("saved as extracts");
  const span = layer.locator("span", { hasText: "Hello note" }).first(); const b = (await span.boundingBox())!;
  await page.mouse.move(b.x + 1, b.y + b.height / 2); await page.mouse.down(); await page.mouse.move(b.x + b.width - 1, b.y + b.height / 2, { steps: 8 }); await page.mouse.up();
  await block.getByRole("button", { name: "Add note" }).first().click(); await expect(page.getByTestId("pdf-annotation")).toHaveCount(1);
  const first = await waitFor(async () => { const e = await extracts(); return e.length === 1 ? e[0] : null; });
  expect(first.quote).toContain("Hello note"); expect(first.page).toBe("1"); expect(first.note).toBeNull();
  await expect(block.getByTestId("pdf-annotation-extract")).toHaveCount(1);
  // the note typed on the annotation updates the same extract
  await block.getByRole("textbox", { name: "Note" }).fill("Key passage for H1");
  await waitFor(async () => { const e = await extracts(); return e.length === 1 && e[0].note === "Key passage for H1" && e[0].id === first.id; });
  await saved(page); await shot(page, "a3-pdf-extract-link");
  // re-opening and re-saving the page creates nothing new
  await page.reload(); await expect(page.getByTestId("pdf-annotation")).toHaveCount(1, { timeout: 30_000 }); await expect(page.locator(".nb[data-node='pdf']").getByTestId("pdf-annotation-extract")).toHaveCount(1);
  await editor(page).locator("> p").last().click(); await page.keyboard.type(" edited"); await saved(page); await page.waitForTimeout(1500);
  expect((await extracts()).map((e) => e.id)).toEqual([first.id]);
  // it is the reference's extract: visible in the reference sheet of the research library
  await page.goto(`/research`); await page.getByRole("tab", { name: /Library/ }).click(); await page.getByText(`${PFX} Annotated paper`).first().click();
  await expect(page.getByRole("dialog")).toContainText("Hello note"); await expect(page.getByRole("dialog")).toContainText("Key passage for H1"); await page.keyboard.press("Escape");
  // deleting the annotation removes its extract
  await open(page, p.id); await expect(page.getByTestId("pdf-annotation")).toHaveCount(1, { timeout: 30_000 });
  await page.getByTestId("pdf-annotation-list").locator("button").first().click(); await page.locator(".nb[data-node='pdf']").getByRole("button", { name: "Delete annotation" }).click();
  await expect(page.getByTestId("pdf-annotation")).toHaveCount(0); await waitFor(async () => (await extracts()).length === 0);
});

/* ------------------------------------------------------------ B. contextual AI ------------------------------------------------------------ */
const sseBody = (events: unknown[]) => events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("") + "data: [DONE]\n\n";
const metaEv = { type: "meta", model: "e2e-model", provider: "e2e", reason: "test", budgetNote: null };
const doneEv = { type: "done", usage: { inputTokens: 10, outputTokens: 20, cachedTokens: 0, reasoningTokens: 0 }, costUsd: 0.0001, latencyMs: 12 };
const selectAll = async (page: Page) => { await editor(page).locator("> p").first().click(); await page.keyboard.press("ControlOrMeta+a"); };

test("contextual AI: the new analysis actions are previewed, never applied on their own, and inserted as an aiBlock with action + sources", async ({ page }) => {
  await page.goto("/");
  const p = await newPage(page, "ai analysis", docOf(para("Rates rise when inflation rises. Rates fall when inflation rises."), para("Second paragraph about the term premium.")));
  const sent: any[] = [];
  await page.route(/\/api\/ai\/action$/, async (r: Route) => { const body = r.request().postDataJSON(); sent.push(body); await r.fulfill({ status: 200, contentType: "text/event-stream", body: sseBody([metaEv, { type: "text", delta: "- The two sentences **contradict** each other.\n" }, { type: "text", delta: "- Define “rates” once." }, doneEv]) }); });
  await open(page, p.id); const before = await server(page, p.id);
  await selectAll(page); await page.keyboard.press("ControlOrMeta+j");
  const sheet = page.getByRole("dialog"); const group = sheet.getByTestId("ai-analysis");
  for (const label of ["Check coherence", "Open questions", "Synthesis", "Improve structure", "Suggest links"]) await expect(group.getByRole("button", { name: new RegExp(label) })).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Rewrite" })).toBeVisible(); // the existing actions are still there
  await shot(page, "b1-ai-menu");
  await group.getByRole("button", { name: /Check coherence/ }).click();
  const preview = sheet.getByTestId("ai-preview"); await expect(preview).toContainText("contradict"); await expect(preview.locator(".ai-mark")).toHaveText("AI"); await expect(preview).toContainText("Preview · Check coherence");
  expect(sent[0].action).toBe("coherence"); expect(sent[0].pageId).toBe(p.id); expect(sent[0].text).toContain("Rates rise");
  // nothing was written while previewing; an analysis cannot replace the text it comments on
  await page.waitForTimeout(1200); expect((await server(page, p.id)).version).toBe(before.version);
  await expect(sheet.getByRole("button", { name: "Replace selection" })).toHaveCount(0);
  await shot(page, "b2-ai-preview");
  await sheet.getByRole("button", { name: "Insert below" }).click();
  const block = editor(page).locator(".ai-block"); await expect(block).toContainText("contradict"); await expect(block).toHaveAttribute("data-action", "coherence"); await expect(block.locator(".ai-sources .cite-chip")).toHaveCount(2);
  const tint = await block.evaluate((el) => getComputedStyle(el).borderTopColor); expect(tint).not.toBe("rgba(0, 0, 0, 0)");
  await saved(page);
  const ai = await waitFor(async () => find((await server(page, p.id)).content, "aiBlock")[0]);
  expect(ai.attrs.action).toBe("coherence"); expect(ai.attrs.model).toBe("e2e-model"); expect(ai.attrs.prompt).toBe("Check coherence");
  const ids = (await server(page, p.id)).content.content.filter((n: any) => n.type === "paragraph").map((n: any) => n.attrs.id);
  expect(ai.attrs.sources.map((s: any) => [s.pageId, s.blockId])).toEqual([[p.id, ids[0]], [p.id, ids[1]]]); expect(ai.attrs.sources[0].title).toContain("Rates rise");
  // the original text is untouched, the block sits below it, one undo removes it
  expect((await server(page, p.id)).content.content.map((n: any) => n.type).slice(0, 3)).toEqual(["paragraph", "paragraph", "aiBlock"]); // (the editor keeps an empty paragraph after a trailing block)
  await page.keyboard.press("ControlOrMeta+z"); await expect(editor(page).locator(".ai-block")).toHaveCount(0);
  await shot(page, "b3-ai-inserted");
});

test("contextual AI: suggested links are confirmed one by one — accept adds a link on the words, skip changes nothing", async ({ page }) => {
  await page.goto("/");
  const t1 = await newPage(page, "bank offer", docOf(para("The fixed rate is 4.29 %."))); const t2 = await newPage(page, "refinancing file", docOf(para("Refinancing notes.")));
  const p = await newPage(page, "ai links", docOf(para("Before signing, check the prepayment penalty and the fixed rate offered.")));
  await page.route(/\/api\/ai\/action$/, (r: Route) => r.fulfill({ status: 200, contentType: "text/event-stream", body: sseBody([metaEv, { type: "result", data: { ai: true, model: "e2e-model", candidates: 3, links: [
    { pageId: t1.id, title: t1.title, icon: null, blockId: null, excerpt: "The fixed rate is 4.29 %.", score: 0.02, anchorText: "prepayment penalty", reason: "Gives the conditions of the penalty." },
    { pageId: t2.id, title: t2.title, icon: null, blockId: null, excerpt: "Refinancing notes.", score: 0.01, anchorText: null, reason: "Context of the offer." }] } }, doneEv]) }));
  await open(page, p.id); const before = await server(page, p.id);
  await selectAll(page); await page.keyboard.press("ControlOrMeta+j");
  const sheet = page.getByRole("dialog"); await sheet.getByTestId("ai-analysis").getByRole("button", { name: /Suggest links/ }).click();
  const box = sheet.getByTestId("ai-links"); await expect(box).toContainText("Suggested links · 1 of 2"); await expect(box.locator(".ai-mark")).toHaveText("AI");
  await expect(box.getByTestId("ai-link-suggestion")).toContainText(t1.title); await expect(box).toContainText("Gives the conditions of the penalty."); await expect(box).toContainText("“prepayment penalty”");
  await page.waitForTimeout(1200); expect((await server(page, p.id)).version, "suggestions alone write nothing").toBe(before.version); await expect(editor(page).locator("a[href^='/p/']")).toHaveCount(0);
  await shot(page, "b4-ai-links-review");
  await box.getByRole("button", { name: "Add this link" }).click();
  await expect(editor(page).locator(`a[href='/p/${t1.id}']`)).toHaveText("prepayment penalty"); await expect(box).toContainText("Suggested links · 2 of 2"); await expect(box.getByTestId("ai-link-suggestion")).toContainText(t2.title);
  await box.getByRole("button", { name: "Skip" }).click();
  await expect(box.getByTestId("ai-links-done")).toContainText("1 link added, 1 skipped"); await sheet.getByRole("button", { name: "Done" }).click();
  await saved(page);
  const doc = await waitFor(async () => { const s = await server(page, p.id); return JSON.stringify(s.content).includes(`/p/${t1.id}`) ? s : null; });
  const linked = doc.content.content[0].content.find((n: any) => (n.marks ?? []).some((m: any) => m.type === "link")); expect(linked.text).toBe("prepayment penalty"); expect(JSON.stringify(doc.content)).not.toContain(t2.id);
  expect(find(doc.content, "mention")).toHaveLength(0);
  // the accepted link is a real link of the page: the target lists it as a backlink
  const back = await apiCall(page, "POST", "/api/query", { source: "backlinks", pageId: t1.id }); expect(back.body.rows.map((r: any) => r.id)).toContain(p.id);
});
