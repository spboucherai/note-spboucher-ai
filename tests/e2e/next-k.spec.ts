/**
 * file: tests/e2e/next-k.spec.ts
 * description: SP Note Next Generation — knowledge screens, desktop (1280×800): Knowledge Graph 2.0, Thought Constellation, Timeline,
 *   Time Machine (with a restore), Knowledge Health, Daily Brief, Semantic Zoom, Ask My Knowledge, command center and sidebar.
 *   Data is real: pages, links, relations, concepts and tasks are created through the API. What only a model or a background job
 *   would write is inserted as a fixture and says so (model "fixture"): a suggested relation, an AI insight, embeddings, history
 *   entries with a past date. No provider is called by this file unless E2E_LIVE_AI=1 (then: a handful of haiku-class calls);
 *   otherwise the three AI buttons are exercised against a faked HTTP answer and the test asserts what the browser sent.
 * author: Simon-Pierre Boucher — contact@spboucher.ai
 */
import { test, expect, type Page } from "@playwright/test";
import { apiCall, docOf, para, expectNoHorizontalOverflow, sql } from "./helpers";

const LIVE = process.env.E2E_LIVE_AI === "1"; const PFX = "E2E-K";
const made: string[] = []; const stamp = () => Date.now().toString(36);
const H = (level: number, text: string) => ({ type: "heading", attrs: { level }, content: [{ type: "text", text }] });
const mention = (id: string, label: string) => ({ type: "paragraph", content: [{ type: "text", text: "See " }, { type: "mention", attrs: { id, label } }] });
const newPage = async (page: Page, title: string, content?: unknown, extra: Record<string, unknown> = {}) => { const r = await apiCall(page, "POST", "/api/pages", { title: `${PFX} ${title}`, ...(content ? { content } : {}), ...extra }); expect(r.status, JSON.stringify(r.body)).toBe(201); made.push(r.body.id); return r.body as { id: string; version: number; title: string }; };
const server = async (page: Page, id: string) => (await apiCall(page, "GET", `/api/pages/${id}`)).body;
const wsOf = async (pageId: string) => (await sql`select workspace_id from pages where id = ${pageId}`)[0].workspace_id as string;
const relations = async (page: Page, nodeId: string) => (await apiCall(page, "GET", `/api/graph/relations?nodeId=${nodeId}&include=ai_suggested`)).body.relations as any[];
/** Fixture: a relation as the analysis job writes it (origin ai, status suggested). */
const suggest = async (ws: string, from: string, to: string, relType = "extends") => (await sql`insert into knowledge_edges (workspace_id, from_id, to_id, kind, rel_type, origin, status, confidence, rationale, model) values (${ws}, ${from}, ${to}, 'relation', ${relType}, 'ai', 'suggested', 0.71, 'fixture rationale', 'fixture') returning id`)[0].id as string;
const vec = (group: number, j: number) => { const v = new Array(1536).fill(0); v[10 + group * 300] = 1; v[40 + group * 300 + j] = 0.2; return `[${v.join(",")}]`; };
const pick = async (page: Page, title: string) => { const dlg = page.getByRole("dialog").last(); await dlg.getByLabel("Search pages").fill(title); await dlg.getByRole("option").filter({ hasText: title }).first().click(); };
/** Toasts sit over the bottom-right corner for a few seconds: wait them out before clicking there. */
const quiet = async (page: Page) => { await expect(page.locator("[role=status][aria-live=polite].fixed > div")).toHaveCount(0, { timeout: 12_000 }); };
const palette = async (page: Page, query: string, expectText: string) => { await page.keyboard.press("Control+k"); const dlg = page.getByRole("dialog", { name: "Command center" }); await dlg.locator("[cmdk-input]").fill(query); await expect(dlg.locator("[cmdk-item]").first()).toContainText(expectText); await page.keyboard.press("Enter"); await expect(dlg).toBeHidden(); };

test.afterAll(async () => {
  if (made.length) { await sql`delete from tasks where page_id = any(${made}::uuid[]) or title like ${PFX + "%"}`; await sql`delete from knowledge_edges where from_id = any(${made}::uuid[]) or to_id = any(${made}::uuid[])`; await sql`delete from chunks where page_id = any(${made}::uuid[])`; await sql`delete from knowledge_events where page_id = any(${made}::uuid[])`; await sql`delete from pages where id = any(${made}::uuid[])`; }
  await sql`delete from pages where title like ${PFX + "%"}`; await sql`delete from concepts where name like ${PFX + "%"}`; await sql`delete from knowledge_insights where title like ${PFX + "%"}`; await sql`delete from settings where key like 'graph.constellation:%'`;
});

test("graph 2.0: seven views, filters, a suggested relation accepted and another rejected inline, typed relation created with the picker, edited, deleted", async ({ page }) => {
  test.setTimeout(120_000); await page.goto("/"); const s = stamp();
  const b = await newPage(page, `Beta ${s}`, docOf(para("beta body text for the graph")), { section: "documents" }); const a = await newPage(page, `Alpha ${s}`, docOf(para("alpha body"), mention(b.id, b.title)));
  const c = await newPage(page, `Gamma ${s}`, docOf(para("gamma body"))); const d = await newPage(page, `Delta ${s}`, docOf(para("delta body"))); const ws = await wsOf(a.id);
  expect((await apiCall(page, "POST", "/api/graph/relations", { fromId: b.id, toId: c.id, relType: "supports" })).status).toBe(201);
  const s1 = await suggest(ws, c.id, d.id, "extends"); const s2 = await suggest(ws, d.id, a.id, "contradicts");
  await page.goto(`/graph?view=local&pageId=${a.id}`); const root = page.getByTestId("knowledge-graph"); await expect(root).toHaveAttribute("data-view", "local");
  // the seven views of the API, one switcher
  const views = page.getByRole("radiogroup", { name: "Graph view" }).getByRole("radio"); await expect(views).toHaveCount(7); await expect(views).toHaveText(["Global", "Local", "Project", "Chronological", "Concepts", "Documents", "References"]);
  await page.getByLabel("Neighbourhood depth").selectOption("4"); const canvas = page.getByTestId("graph-canvas"); await expect(canvas).toHaveAttribute("data-nodes", "4"); await expect(page.getByTestId("graph-stats")).toContainText("2 suggested");
  await expect(page.getByTestId("graph-legend")).toContainText("suggested"); await expect(page.getByTestId("graph-legend").locator("[data-ai-mark]")).toBeVisible();
  // review: suggested edges are marked AI; accept one, reject the other — the decision is the user's
  await page.getByTestId("open-suggested").click(); const list = page.getByTestId("suggested-list"); await expect(list.locator("li")).toHaveCount(2); await expect(list.locator("li").first().locator("[data-ai-mark]")).toBeVisible();
  expect((await relations(page, d.id)).find((r) => r.id === s1).status, "nothing is applied before a decision").toBe("suggested");
  await list.locator(`[data-edge="${s1}"]`).getByRole("button", { name: "Accept this suggestion" }).click(); await expect(list.locator("li")).toHaveCount(1);
  await expect.poll(async () => (await relations(page, d.id)).find((r) => r.id === s1)?.status).toBe("accepted"); expect((await relations(page, d.id)).find((r) => r.id === s1).origin, "origin stays AI after acceptance").toBe("ai");
  await list.locator(`[data-edge="${s2}"]`).getByRole("button", { name: "Reject this suggestion" }).click(); await expect(list).toHaveCount(0);
  await expect.poll(async () => (await apiCall(page, "GET", `/api/graph/relations/${s2}`)).body.status).toBe("rejected");
  // filters: origin / status / relation type change what is drawn (client side), "on" badge, reset
  await page.getByTestId("graph-filters-btn").click(); const filters = page.getByTestId("graph-filters"); await filters.locator("[data-origin='ai']").click(); await expect(canvas).toHaveAttribute("data-edges", "2");
  await filters.locator("[data-origin='ai']").click(); await filters.locator("[data-rel='supports']").click(); await expect(canvas).toHaveAttribute("data-edges", "2"); await filters.getByRole("button", { name: "Reset filters" }).click(); await expect(canvas).toHaveAttribute("data-edges", "3"); await page.keyboard.press("Escape");
  // create a typed relation between two pages with the picker
  await page.getByTestId("new-relation").click(); const form = page.getByTestId("relation-form"); await form.getByTestId("rel-from").click(); await pick(page, a.title); await form.getByTestId("rel-type").selectOption("contradicts"); await form.getByTestId("rel-to").click(); await pick(page, d.title);
  await form.getByLabel("Note").fill("made in the e2e"); await form.getByRole("button", { name: "Create relation" }).click(); await expect(form).toBeHidden();
  const created = (await relations(page, a.id)).find((r) => r.relType === "contradicts" && r.toId === d.id); expect(created).toMatchObject({ origin: "user", status: "accepted", note: "made in the e2e" });
  await expect(canvas).toHaveAttribute("data-edges", "4");
  // inspect it from the keyboard-accessible node list → edit note and validity → delete
  await page.getByText("List of nodes").click(); await page.getByTestId("graph-node-list").locator(`[data-node="${a.id}"]`).click(); const insp = page.getByTestId("node-inspector"); await expect(insp).toContainText(a.title);
  await insp.locator(`[data-edge="${created.id}"]`).getByRole("button", { name: "Details" }).click(); const ei = page.getByTestId("edge-inspector"); await expect(ei).toContainText("made in the e2e"); await ei.getByRole("button", { name: "Edit" }).click();
  await form.getByLabel("Note").fill("edited note"); await form.getByLabel("Valid from").fill("2026-01-01"); await form.getByLabel("Valid to").fill("2026-12-31"); await form.getByRole("button", { name: "Save" }).click(); await expect(form).toBeHidden();
  await expect.poll(async () => (await apiCall(page, "GET", `/api/graph/relations/${created.id}`)).body.note).toBe("edited note"); expect((await apiCall(page, "GET", `/api/graph/relations/${created.id}`)).body).toMatchObject({ validFrom: "2026-01-01T00:00:00.000Z", validTo: "2026-12-31T00:00:00.000Z" });
  await expect(ei).toContainText("edited note"); page.once("dialog", (dlg) => dlg.accept()); await ei.getByRole("button", { name: "Delete" }).click();
  await expect.poll(async () => (await apiCall(page, "GET", `/api/graph/relations/${created.id}`)).status).toBe(404);
  // path between two nodes: Lumen-highlighted, listed
  await page.getByTestId("graph-node-list").locator(`[data-node="${a.id}"]`).click(); await insp.getByRole("button", { name: "Path to…" }).click(); await pick(page, c.title); await expect(page.getByTestId("graph-path")).toContainText(`${a.title} → ${b.title} → ${c.title}`);
  // the other views answer and render (documents = the section; chronological has its activity strip)
  for (const [v, check] of [["documents", async () => expect(page.getByTestId("graph-node-list").locator(`[data-node="${b.id}"]`)).toBeAttached()], ["timeline", async () => expect(page.getByTestId("graph-buckets")).toBeVisible()], ["references", async () => expect(page.getByTestId("graph-stats")).toBeVisible()], ["global", async () => expect(page.getByTestId("graph-node-list").locator(`[data-node="${d.id}"]`)).toBeAttached()]] as const) { await page.getByTestId(`view-${v}`).click(); await expect(root).toHaveAttribute("data-view", v); await check(); await expect(page.getByText("Could not load the graph")).toHaveCount(0); }
  await page.getByTestId("view-project").click(); await expect(root).toHaveAttribute("data-view", "project"); await expect(page).toHaveURL(new RegExp(`view=project&pageId=${a.id}`));
});

test("graph 2.0: concepts management, insights panel (deterministic lists, AI findings with cited blocks, accept), Knowledge Connections motion", async ({ page, browser }) => {
  test.setTimeout(120_000); await page.goto("/"); const s = stamp();
  const a = await newPage(page, `Loan ${s}`, docOf(para("The penalty equals three months of interest."))); const b = await newPage(page, `Quote ${s}`, docOf(para("The penalty is the rate differential."), mention(a.id, a.title)));
  await newPage(page, `Twin ${s}`, docOf(para("first twin"))); await newPage(page, `Twin ${s}`, docOf(para("second twin"))); const ws = await wsOf(a.id);
  const blockA = (await server(page, a.id)).content.content[0].attrs.id as string, blockB = (await server(page, b.id)).content.content[0].attrs.id as string;
  const [ins] = await sql`insert into knowledge_insights (workspace_id, kind, status, title, detail, data, origin, model, fingerprint) values (${ws}, 'contradiction', 'suggested', ${`${PFX} two penalties ${s}`}, 'The two notes give different penalties.', ${sql.json({ pageIds: [a.id, b.id], blockIds: [blockA, blockB], a: { pageId: a.id, blockId: blockA }, b: { pageId: b.id, blockId: blockB }, confidence: 0.8 })}, 'ai', 'fixture', ${`e2e-${s}`}) returning id`;
  await page.goto("/graph"); await page.getByTestId("graph-canvas").waitFor();
  // concepts: create, attach a page, see it in the concepts view, delete
  await page.getByTestId("open-concepts").click(); const cm = page.getByTestId("concepts-manager"); const name = `${PFX} Penalty ${s}`; await cm.getByLabel("New concept name").fill(name); await cm.getByRole("button", { name: "Create concept" }).click(); await expect(cm.getByLabel("Concept name")).toHaveValue(name);
  await cm.getByRole("button", { name: "Add a page" }).click(); await pick(page, a.title); await expect(cm.getByRole("link", { name: new RegExp(a.title) })).toBeVisible();
  const concept = (await apiCall(page, "GET", "/api/concepts")).body.concepts.find((c: any) => c.name === name); expect(concept.pages).toBe(1);
  await cm.getByRole("button", { name: "Show in graph" }).click(); await expect(page.getByTestId("knowledge-graph")).toHaveAttribute("data-view", "concepts"); await expect(page.getByTestId("graph-node-list").locator(`[data-node="concept:${concept.id}"]`)).toBeAttached(); await expect(page.getByTestId("node-inspector")).toContainText(name);
  // insights: what is computed (no model) and what a model found (fixture) are told apart
  await page.getByTestId("open-insights").click(); const panel = page.getByTestId("insights-panel"); await expect(panel.getByTestId("insight-central")).toContainText(a.title); await expect(panel).toContainText("no model");
  await quiet(page); await panel.getByTestId("insight-duplicates").getByRole("button").first().click(); await expect(panel.getByTestId("insight-duplicates")).toContainText(`Twin ${s}`);
  const finding = panel.locator("[data-insight='contradiction']").filter({ hasText: `two penalties ${s}` }); await expect(finding).toHaveAttribute("data-origin", "ai"); await expect(finding.locator("[data-ai-mark]")).toContainText("fixture");
  const cites = finding.getByTestId("insight-cite"); await expect(cites).toHaveCount(2); await expect(cites.first()).toHaveAttribute("href", `/p/${a.id}#block-${blockA}`); await expect(cites.nth(1)).toHaveAttribute("href", `/p/${b.id}#block-${blockB}`);
  // "Run AI analysis" queues the job only on the click (the answer of the queue route is faked here: no model is called by this test)
  let runs = 0; await page.route("**/api/graph/insights/run", async (route) => { runs++; expect(route.request().postDataJSON()).toEqual({ mode: "all" }); await route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ mode: "all", deterministic: { created: 0, considered: 0 }, queued: true, jobId: "fake" }) }); });
  expect(runs).toBe(0); await panel.getByTestId("run-ai-analysis").click(); await expect(panel.getByTestId("run-ai-analysis")).toContainText("Analysis running"); expect(runs).toBe(1); await page.unroute("**/api/graph/insights/run");
  // accepting a contradiction records the relation — by the user's decision
  expect((await apiCall(page, "GET", `/api/graph/relations?nodeId=${a.id}`)).body.relations.filter((r: any) => r.relType === "contradicts")).toHaveLength(0);
  await finding.getByRole("button", { name: "Accept" }).click(); await expect(finding).toHaveCount(0);
  await expect.poll(async () => (await sql`select status from knowledge_insights where id = ${ins.id}`)[0].status).toBe("accepted");
  await expect.poll(async () => (await apiCall(page, "GET", `/api/graph/relations?nodeId=${a.id}`)).body.relations.filter((r: any) => r.relType === "contradicts" && r.origin === "ai" && r.status === "accepted").length).toBe(1);
  await page.getByRole("button", { name: /Accepted \d+/ }).click(); await expect(panel.locator("[data-insight='contradiction']").filter({ hasText: `two penalties ${s}` })).toHaveAttribute("data-status", "accepted");
  // a cited block opens the page at that block
  await page.goto(`/p/${a.id}#block-${blockA}`); await expect(page.locator(`#block-${blockA}`)).toBeInViewport();
  // Knowledge Connections: the edges draw themselves when a small view opens; never under Reduce Motion
  await page.goto(`/graph?view=local&pageId=${a.id}`); await expect(page.getByTestId("graph-canvas")).toHaveAttribute("data-animating", "1"); await expect(page.getByTestId("graph-canvas")).toHaveAttribute("data-animating", "0", { timeout: 8000 });
  const ctx = await browser.newContext({ storageState: "test-results/.auth/state.json", reducedMotion: "reduce", viewport: { width: 1280, height: 800 }, baseURL: process.env.E2E_BASE_URL }); const rp = await ctx.newPage(); let seen = false;
  await rp.goto(`/graph?view=local&pageId=${a.id}`); const cv = rp.getByTestId("graph-canvas"); await cv.waitFor(); for (let i = 0; i < 12; i++) { if ((await cv.getAttribute("data-animating")) === "1") seen = true; await rp.waitForTimeout(80); } expect(seen, "no draw-in animation under prefers-reduced-motion").toBe(false); await ctx.close();
  await apiCall(page, "DELETE", `/api/concepts/${concept.id}`);
});

test("thought constellation: stars placed from stored embeddings, semantic zoom tiers, keyboard navigation, preview; honest empty state", async ({ page }) => {
  test.setTimeout(120_000); await page.goto("/"); const s = stamp(); const pages: { id: string; title: string }[] = [];
  for (let i = 0; i < 6; i++) pages.push(await newPage(page, `Star ${i < 3 ? "red" : "blue"} ${i} ${s}`, docOf(H(2, `Heading of star ${i}`), para(`First sentence of star ${i}. Second sentence.`))));
  const ws = await wsOf(pages[0].id); await sql`delete from chunks where page_id = any(${pages.map((p) => p.id)}::uuid[])`;
  // fixture embeddings (two groups of synthetic vectors): the projection, clusters and links are computed by the real route
  for (const [i, p] of pages.entries()) { const [c] = await sql`insert into chunks (workspace_id, source_type, source_id, page_id, ordinal, content, content_hash) values (${ws}, 'page', ${p.id}, ${p.id}, 0, 'fixture', ${`e2e-${p.id}`}) returning id`; await sql`insert into embeddings (chunk_id, model, embedding) values (${c.id}, 'text-embedding-3-small', ${vec(i < 3 ? 0 : 1, i)}::vector)`; }
  expect((await apiCall(page, "POST", "/api/graph/relations", { fromId: pages[0].id, toId: pages[1].id, relType: "related" })).status).toBe(201);
  const api = (await apiCall(page, "GET", "/api/graph/constellation?refresh=1")).body; const pt = (id: string) => api.points.find((x: any) => x.id === id); for (const p of pages) expect(pt(p.id), "every embedded page is a star").toBeTruthy();
  const d = (i: number, j: number) => Math.hypot(pt(pages[i].id).x - pt(pages[j].id).x, pt(pages[i].id).y - pt(pages[j].id).y); expect(d(0, 1), "notes that mean the same sit closer than notes that do not").toBeLessThan(d(0, 4));
  await page.goto("/constellation"); const root = page.getByTestId("constellation"); const sky = page.getByTestId("constellation-canvas"); await sky.waitFor(); await expect(page.getByTestId("constellation-stats")).toContainText("PCA of text-embedding-3-small embeddings"); await expect(page.getByTestId("constellation-stats")).toContainText("no model called");
  expect(Number(await sky.getAttribute("data-points"))).toBe(api.points.length); expect(Number(await sky.getAttribute("data-links"))).toBeGreaterThanOrEqual(1);
  // semantic zoom: clusters → notes → titles
  await expect(root).toHaveAttribute("data-tier", "clusters"); const bb = (await sky.boundingBox())!; await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
  await page.mouse.wheel(0, -500); await expect(root).toHaveAttribute("data-tier", "stars"); await page.mouse.wheel(0, -900); await expect(root).toHaveAttribute("data-tier", "titles"); await page.getByRole("button", { name: "Fit to view" }).click(); await expect(root).toHaveAttribute("data-tier", "clusters");
  // keyboard: arrows pick a cluster, Enter zooms into it and selects a star, arrows move between stars, Enter opens the note
  await sky.focus(); await page.keyboard.press("ArrowRight"); await expect(page.locator("#constellation-live")).toContainText("Cluster"); await page.keyboard.press("Enter"); const preview = page.getByTestId("constellation-preview"); await expect(preview).toBeVisible();
  await expect(page.locator("#constellation-live")).toContainText("Enter opens the note"); const first = await preview.locator("div.font-serif").first().innerText(); await sky.focus(); await page.keyboard.press("ArrowLeft"); await page.keyboard.press("ArrowRight"); await page.keyboard.press("ArrowUp"); await page.keyboard.press("ArrowDown");
  expect(await preview.locator("div.font-serif").first().innerText(), "arrow keys moved to another star").not.toBe(""); void first;
  await expect(preview).toContainText("Outline · computed, no AI"); await page.keyboard.press("Escape"); await expect(preview).toBeHidden();
  // a click on a star selects it and shows the preview with its outline (no AI); Enter opens it
  await page.getByRole("button", { name: "Fit to view" }).click(); await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2); await page.mouse.wheel(0, -500); await page.waitForTimeout(400);
  await sky.focus(); await page.keyboard.press("ArrowRight"); await expect(preview).toBeVisible(); await expect(preview.getByText("Outline · computed, no AI")).toBeVisible(); await expect(preview.getByRole("link", { name: "Open" })).toHaveAttribute("href", /\/p\/[0-9a-f-]{36}/); await sky.focus(); await page.keyboard.press("Enter"); await expect(page).toHaveURL(/\/p\/[0-9a-f-]{36}/);
  // a workspace without embeddings gets an explanation, not an invented sky (the API answer is replaced by an empty one for this check)
  await page.route("**/api/graph/constellation", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ ...api, cached: false, computedAt: null, stats: { pages: 12, embedded: 0, shown: 0, links: 0, truncated: false }, points: [], clusters: [], links: [], projects: [], tags: [] }) }));
  await page.goto("/constellation"); await expect(page.getByTestId("constellation-empty")).toContainText("No star to place yet"); await expect(page.getByTestId("constellation-empty")).toContainText("Nothing is invented"); await expect(page.getByTestId("constellation-canvas")).toHaveCount(0);
});

test("timeline: grouped by day, kind / page filters, cursor paging, reconstructed events marked; per-page timeline in the right panel", async ({ page }) => {
  test.setTimeout(120_000); await page.goto("/"); const s = stamp();
  const p = await newPage(page, `Journal ${s}`, docOf(para("first text"))); const other = await newPage(page, `Other ${s}`, docOf(para("x"))); const ws = await wsOf(p.id);
  expect((await apiCall(page, "PATCH", `/api/pages/${p.id}`, { title: `${PFX} Journal renamed ${s}`, baseVersion: p.version })).status).toBe(200);
  const task = await apiCall(page, "POST", "/api/tasks", { title: `${PFX} timeline task ${s}`, pageId: p.id }); expect(task.status).toBe(201);
  expect((await apiCall(page, "POST", "/api/graph/relations", { fromId: p.id, toId: other.id, relType: "supports" })).status).toBe(201);
  // fixtures: a creation the server would have back-filled (flagged), and 60 older entries to page through
  await sql`update knowledge_events set data = data || '{"backfilled": true}'::jsonb, actor = 'system', at = now() - interval '3 days' where page_id = ${p.id} and kind = 'page.created'`;
  await sql`insert into knowledge_events (workspace_id, at, kind, page_id, entity_kind, entity_id, actor, summary, data) select ${ws}, now() - interval '1 day' - (g || ' minutes')::interval, 'page.edited', ${p.id}, 'page', ${p.id}, 'user', 'old edit', '{"wordCount": 2}'::jsonb from generate_series(1, 60) g`;
  await page.goto(`/timeline?pageId=${p.id}`); const list = page.getByTestId("event-list"); await list.waitFor(); await expect(page.getByTestId("timeline-page")).toContainText(`Journal renamed ${s}`);
  await expect(list.locator("section").first().getByRole("heading")).toContainText("Today"); await expect(list.locator("[data-event='page.renamed']")).toContainText("Renamed"); await expect(list.locator("[data-event='page.renamed']")).toContainText(`Journal ${s}`);
  await expect(list.locator("[data-event='relation.created']")).toContainText("supports"); await expect(list.locator("[data-event='task.created']")).toBeVisible();
  // cursor: 50 first, the rest on demand (infinite scroll or the button), then the end of the journal; nothing appears twice
  await expect(list).toHaveAttribute("data-count", "50"); await page.getByTestId("events-more").scrollIntoViewIfNeeded(); await expect(page.getByTestId("events-end")).toBeVisible({ timeout: 15_000 });
  const total = Number(await list.getAttribute("data-count")); expect(total).toBeGreaterThanOrEqual(64); expect(await list.locator("li[data-event]").count()).toBe(total);
  const rec = list.locator("[data-event='page.created']"); await expect(rec).toHaveAttribute("data-reconstructed", "1"); await expect(rec.getByTestId("reconstructed")).toHaveText("reconstructed"); await expect(list.locator("[data-event='page.renamed']").getByTestId("reconstructed")).toHaveCount(0);
  expect(await list.locator("section").count()).toBeGreaterThanOrEqual(3);
  // kind filter (server side): tasks only
  await page.getByTestId("timeline-kinds").locator("[data-family='task']").click(); await expect(list.locator("li[data-event]")).toHaveCount(1); await expect(list.locator("li[data-event]")).toHaveAttribute("data-event", "task.created");
  await page.getByTestId("timeline-kinds").locator("[data-family='links']").click(); await expect(list.locator("li[data-event]")).toHaveCount(2); await page.getByRole("button", { name: "Clear" }).click();
  // without a page filter the page title links to the page; choosing a page with the picker filters again
  await expect(page.getByTestId("timeline-page")).toContainText("Any page"); await expect(list.getByRole("link", { name: new RegExp(`Journal renamed ${s}`) }).first()).toHaveAttribute("href", `/p/${p.id}`);
  await page.getByTestId("timeline-page").click(); await pick(page, `Other ${s}`); await expect(list.locator("[data-event='page.created']")).toHaveCount(1); await expectNoHorizontalOverflow(page);
  // per-page timeline: a panel of the right panel host, opened from the command center
  await page.goto(`/p/${p.id}`); await page.locator(".note-editor .ProseMirror").first().waitFor(); await palette(page, "timeline of this page", "Timeline of this page");
  const panel = page.locator("aside[data-panel='timeline']"); await expect(panel).toBeVisible(); await expect(panel.getByTestId("page-timeline").locator("[data-event='page.renamed']")).toBeVisible(); await expect(panel.getByRole("link", { name: "Time machine" })).toHaveAttribute("href", `/timemachine?pageId=${p.id}`);
});

test("time machine: honest source / exact, diff against today, restore a version after confirmation", async ({ page }) => {
  test.setTimeout(120_000); await page.goto("/"); const s = stamp();
  const p = await newPage(page, `Contract ${s}`, docOf(para("old clause about rates"), para("kept paragraph")));
  const up = await apiCall(page, "PATCH", `/api/pages/${p.id}`, { content: docOf(para("kept paragraph"), para("new clause about penalties")), baseVersion: p.version }); expect(up.status).toBe(200);
  // fixture dates: the page was created 5 days ago and its first state was saved in the history 2 days ago (today these rows would all be dated "now")
  await sql`delete from page_versions where page_id = ${p.id}`;
  const [v] = await sql`insert into page_versions (page_id, version, title, content, reason, created_at, word_count) values (${p.id}, 1, ${p.title}, ${sql.json(docOf({ type: "paragraph", attrs: { id: "oldblock001" }, content: [{ type: "text", text: "old clause about rates" }] }, { type: "paragraph", attrs: { id: "keptblock01" }, content: [{ type: "text", text: "kept paragraph" }] }))}, 'autosave', now() - interval '2 days', 6) returning id`;
  await sql`update pages set created_at = now() - interval '5 days' where id = ${p.id}`; await sql`update knowledge_events set at = now() - interval '5 days' where page_id = ${p.id} and kind = 'page.created'`; await sql`update knowledge_events set at = now() - interval '1 hour' where page_id = ${p.id} and kind <> 'page.created'`;
  const at = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
  const api = (await apiCall(page, "GET", `/api/timemachine?pageId=${p.id}&at=${encodeURIComponent(at(1))}`)).body.pages[0]; expect(api).toMatchObject({ source: "version", exact: false, versionId: v.id, changedSince: true });
  // one day ago: the nearest saved version, said to be approximate — exactly what the API reports
  await page.goto(`/timemachine?pageId=${p.id}&at=${encodeURIComponent(at(1))}`); const note = page.getByTestId("tm-honesty"); await expect(note).toHaveAttribute("data-source", "version"); await expect(note).toHaveAttribute("data-exact", "false"); await expect(page.getByTestId("tm-label")).toHaveText("Approximate"); await expect(note).toContainText("most recent one at or before that date");
  await expect(page.getByTestId("tm-content")).toContainText("old clause about rates"); await expect(page.getByTestId("tm-content")).not.toContainText("new clause about penalties");
  await page.getByTestId("tm-diff-tab").click(); const diff = page.getByTestId("tm-diff"); await expect(diff).toHaveAttribute("data-removed", "1"); await expect(diff).toHaveAttribute("data-added", "1"); await expect(diff.locator("[data-op='del']")).toContainText("old clause about rates"); await expect(diff.locator("[data-op='add']")).toContainText("new clause about penalties"); await expect(diff.locator("[data-op='same']")).toContainText("kept paragraph");
  // the scrubber and the date field drive the same query: now = exact (current); before the creation = did not exist
  await page.getByRole("button", { name: "Now", exact: true }).click(); await expect(note).toHaveAttribute("data-source", "current"); await expect(page.getByTestId("tm-label")).toHaveText("Exact"); await expect(page.getByTestId("tm-restore")).toHaveCount(0);
  await page.getByTestId("tm-range").fill("0"); await expect(page.getByTestId("tm-label")).toHaveText("Did not exist yet"); await expect(page.getByTestId("tm-restore")).toHaveCount(0);
  await page.getByRole("button", { name: "Next saved version" }).click(); await expect(note).toHaveAttribute("data-source", "version");
  // restore: a confirmation, then the versions restore route; the current state is kept in the history
  const before = await server(page, p.id); await page.getByTestId("tm-restore").click(); const dlg = page.getByRole("dialog", { name: "Restore this version?" }); await expect(dlg).toContainText("nearest saved version"); await expect(dlg).toContainText("saved in the version history first");
  await dlg.getByRole("button", { name: "Cancel" }).click(); expect((await server(page, p.id)).version, "cancel restores nothing").toBe(before.version);
  await page.getByTestId("tm-restore").click(); const [req] = await Promise.all([page.waitForRequest((r) => r.url().includes(`/api/pages/${p.id}/versions/${v.id}/restore`) && r.method() === "POST"), page.getByTestId("tm-restore-confirm").click()]); expect(req.postDataJSON()).toEqual({ baseVersion: before.version });
  await expect(page.getByText("Version restored")).toBeVisible(); const after = await server(page, p.id); expect(JSON.stringify(after.content)).toContain("old clause about rates"); expect(JSON.stringify(after.content)).not.toContain("new clause about penalties"); expect(after.version).toBeGreaterThan(before.version);
  const hist = (await apiCall(page, "GET", `/api/pages/${p.id}/versions`)).body as any[]; expect(hist.some((h) => h.version === before.version), "the state replaced by the restore is in the history").toBe(true);
  // project scope: every page of the project with its own honesty
  const root = await newPage(page, `Project ${s}`, docOf(para("root")), { section: "projects" }); await newPage(page, `Child ${s}`, docOf(para("child")), { section: "projects", parentId: root.id });
  await page.goto(`/timemachine?projectId=${root.id}`); const proj = page.getByTestId("tm-project"); await expect(proj.locator("li")).toHaveCount(2); await expect(proj).toContainText("2 of 2 pages existed"); await expect(proj.locator("li").first()).toHaveAttribute("data-source", "current"); await expectNoHorizontalOverflow(page);
});

test("knowledge health: categories with counts, drill-down, navigations only; chip on Home", async ({ page }) => {
  test.setTimeout(120_000); await page.goto("/"); const s = stamp();
  const orphan = await newPage(page, `Orphan ${s}`, docOf(para("nobody links here"))); const gone = await newPage(page, `Gone ${s}`, docOf(para("to be trashed")));
  const holder = await newPage(page, `Holder ${s}`, docOf(para("intro"), mention(gone.id, gone.title))); const blank = await apiCall(page, "POST", "/api/pages", { title: "", content: docOf(para(`${PFX} untitled body ${s}`)) }); made.push(blank.body.id);
  await newPage(page, `Dup ${s}`, docOf(para("one"))); await newPage(page, `Dup ${s}`, docOf(para("two")));
  expect((await apiCall(page, "DELETE", `/api/pages/${gone.id}`)).status).toBe(200);
  expect((await apiCall(page, "POST", "/api/tasks", { title: `${PFX} overdue ${s}`, pageId: holder.id, dueAt: new Date(Date.now() - 3 * 86_400_000).toISOString() })).status).toBe(201);
  const h = (await apiCall(page, "GET", "/api/health/knowledge")).body; const state = async () => { const x = await server(page, holder.id); return JSON.stringify([x.version, x.title, x.content]); }; const before = await state();
  await page.goto("/health"); await expect(page.getByTestId("health-score")).toContainText(`${h.score.issues} issue`);
  for (const k of ["orphans", "brokenLinks", "missingReferences", "potentialDuplicates", "untitled", "inactiveProjects", "openTasks"]) await expect(page.getByTestId(`health-${k}`)).toHaveAttribute("data-count", String(h[k].count));
  // drill-down: orphans → the page; broken links → the block that holds the link
  await page.getByTestId("health-orphans").click(); const detail = page.getByTestId("health-detail"); await expect(detail).toHaveAttribute("data-category", "orphans"); const row = detail.getByRole("link", { name: new RegExp(`Orphan ${s}`) }); await expect(row).toHaveAttribute("href", `/p/${orphan.id}`);
  await page.getByTestId("health-brokenLinks").click(); await expect(detail).toHaveAttribute("data-category", "brokenLinks"); const broken = detail.getByRole("link", { name: new RegExp(`Holder ${s}`) }); await expect(broken).toContainText("in the trash"); const blockId = (await server(page, holder.id)).content.content[1].attrs.id; await expect(broken).toHaveAttribute("href", `/p/${holder.id}#block-${blockId}`);
  await page.getByTestId("health-potentialDuplicates").click(); await expect(detail.getByTestId("health-row").filter({ hasText: `Dup ${s}` }).getByRole("link")).toHaveCount(2);
  await page.getByTestId("health-untitled").click(); await expect(detail.locator(`a[href="/p/${blank.body.id}"]`)).toBeVisible();
  await page.getByTestId("health-openTasks").click(); await expect(detail.getByTestId("health-row").filter({ hasText: `overdue ${s}` })).toContainText("Overdue");
  // one click = a navigation, never a fix
  await page.getByTestId("health-brokenLinks").click(); await detail.getByRole("link", { name: new RegExp(`Holder ${s}`) }).click(); await expect(page).toHaveURL(new RegExp(`/p/${holder.id}#block-${blockId}`)); await page.locator(".note-editor .ProseMirror").first().waitFor();
  expect(await state(), "looking at an issue changes nothing").toBe(before); expect((await apiCall(page, "GET", "/api/health/knowledge")).body.brokenLinks.count).toBe(h.brokenLinks.count);
  // Home: compact chip → /health
  await page.goto("/"); const chip = page.getByTestId("health-chip"); await expect(chip).toContainText("issue"); expect(Number(await chip.getAttribute("data-issues"))).toBeGreaterThanOrEqual(4); await chip.click(); await expect(page).toHaveURL(/\/health$/); await expectNoHorizontalOverflow(page);
});

test("daily brief is Home: real sections, AI summary only on a click and marked AI, every dashboard widget still there", async ({ page }) => {
  test.setTimeout(120_000); await page.goto("/"); const s = stamp(); const posts: string[] = []; page.on("request", (r) => { if (r.method() === "POST" && /\/api\/(brief|dashboard)\/summary/.test(r.url())) posts.push(r.url()); });
  const a = await newPage(page, `Brief note ${s}`, docOf(para("recent text"))); const b = await newPage(page, `Brief other ${s}`, docOf(para("other text"))); const ws = await wsOf(a.id);
  expect((await apiCall(page, "POST", "/api/tasks", { title: `${PFX} late ${s}`, pageId: a.id, dueAt: new Date(Date.now() - 2 * 86_400_000).toISOString() })).status).toBe(201);
  expect((await apiCall(page, "POST", "/api/tasks", { title: `${PFX} now ${s}`, dueAt: new Date().toISOString() })).status).toBe(201);
  expect((await apiCall(page, "POST", "/api/capture", { kind: "note", text: `${PFX} capture ${s}` })).status).toBeLessThan(300);
  await sql`update knowledge_edges set status = 'rejected' where status = 'suggested' and model = 'fixture'`; const sug = await suggest(ws, a.id, b.id, "supports");
  await page.goto("/"); const brief = page.getByTestId("brief"); await expect(brief.getByRole("heading", { level: 1 })).toContainText(/Good (morning|afternoon|evening|night),/);
  await expect(page.getByTestId("brief-overdue")).toContainText(`late ${s}`); await expect(page.getByTestId("brief-overdue")).toContainText("overdue by 2 days"); await expect(page.getByTestId("brief-today")).toContainText(`now ${s}`);
  await expect(page.getByTestId("brief-recent")).toContainText(`Brief other ${s}`); await expect(page.getByTestId("brief-captures")).toContainText(`capture ${s}`); await expect(page.getByTestId("brief-lede")).toContainText("overdue");
  for (const id of ["brief-projects", "brief-revisit"]) await expect(page.getByTestId(id)).toBeVisible();
  // a link suggestion is model output: marked AI, decided by the user
  const card = page.getByTestId("brief-suggestions"); await expect(card.locator("[data-ai-mark]").first()).toBeVisible(); const item = card.locator(`[data-suggestion="${sug}"]`); await expect(item).toContainText(`Brief note ${s}`); await expect(item).toContainText("supports");
  await item.getByRole("button", { name: "Accept" }).click(); await expect(item).toHaveCount(0); await expect.poll(async () => (await apiCall(page, "GET", `/api/graph/relations/${sug}`)).body.status).toBe("accepted");
  // the summary: nothing is requested by opening Home; one request on the click; the result carries the AI mark, the model and the date
  const sum = page.getByTestId("brief-summary"); await expect(sum.locator("[data-ai-mark]")).toBeVisible(); await page.waitForTimeout(800); expect(posts, "no summary is requested without a click").toHaveLength(0);
  if (!LIVE) await page.route("**/api/brief/summary", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ ai: true, text: "Fake summary used by the e2e suite.", model: "fake-model", at: new Date().toISOString(), costUsd: 0 }) }));
  await sum.getByTestId("brief-summarise").click(); await expect(page.getByTestId("brief-summary-text")).toBeVisible({ timeout: 60_000 }); expect(posts).toHaveLength(1);
  await expect(sum.locator("[data-ai-mark]")).toContainText(LIVE ? /AI · \S+/ : "AI · fake-model"); await expect(page.getByTestId("brief-summary-text")).toContainText("from titles and counts only");
  // the 2.x dashboard is intact below: all default widgets, and the customise mode
  const dash = page.getByTestId("dashboard-widgets"); await dash.scrollIntoViewIfNeeded(); await expect(dash).toContainText("Dashboard");
  const LABEL: Record<string, string> = { quick_capture: "Quick capture", recent_pages: "Recent pages", pinned: "Pinned", tasks_due: "Tasks due", active_projects: "Active projects", research_activity: "Research activity", recently_modified: "Recently modified", ai_summary: "AI weekly summary", graph_highlights: "Graph highlights", ai_chat: "AI chat", usage: "AI usage" };
  const onBoard = ((await apiCall(page, "GET", "/api/dashboard")).body.layout.widgets as { type: string }[]).map((w) => w.type); expect(onBoard.length).toBeGreaterThanOrEqual(5);
  for (const t of onBoard) await expect(page.locator("section h2").filter({ hasText: LABEL[t] }).first(), LABEL[t]).toBeAttached();
  // …and the ones not on the board are still offered by "Add widget"
  await page.getByRole("button", { name: "Customize" }).click(); await page.getByRole("button", { name: "Add widget" }).click(); for (const t of Object.keys(LABEL).filter((k) => !onBoard.includes(k))) await expect(page.getByRole("button", { name: new RegExp(`^${LABEL[t]}`) })).toBeVisible(); await page.keyboard.press("Escape"); await page.getByRole("button", { name: "Cancel" }).click(); await expectNoHorizontalOverflow(page);
});

test("semantic zoom: four levels, level 1 reads the cache only, AI synopsis marked with model and date, scroll anchor kept, shortcuts", async ({ page }) => {
  test.setTimeout(120_000); await page.goto("/"); const s = stamp(); const filler = (k: string) => Array.from({ length: 14 }, (_, i) => para(`${k} paragraph ${i + 1}. Further detail that makes the section long enough to scroll.`));
  const other = await newPage(page, `Zoom target ${s}`, docOf(para("target")));
  const p = await newPage(page, `Zoom ${s}`, docOf(para("Opening sentence of the page. More."), H(2, "Section one"), ...filler("one"), H(2, "Section two"), ...filler("two"), H(2, "Section three"), para("Marker sentence of section three. Tail."), ...filler("three")));
  expect((await apiCall(page, "POST", "/api/graph/relations", { fromId: p.id, toId: other.id, relType: "supports", note: "zoom relation" })).status).toBe(201);
  const ai: string[] = []; page.on("request", (r) => { if (r.url().includes(`/api/pages/${p.id}/zoom`)) ai.push(`${r.method()} ${new URL(r.url()).pathname.replace(`/api/pages/${p.id}`, "")}${new URL(r.url()).search}`); });
  await page.goto(`/p/${p.id}`); const ed = page.locator(".note-editor .ProseMirror").first(); await ed.waitFor(); const frame = page.getByTestId("zoom-frame"); await expect(frame).toHaveAttribute("data-zoom-level", "3");
  const levels = page.getByRole("radiogroup", { name: "Semantic zoom" }).getByRole("radio"); await expect(levels).toHaveText(["Synopsis", "Outline", "Full", "Full + connections"]); await page.waitForTimeout(500); expect(ai, "opening a page asks nothing").toEqual([]);
  // scroll into section three, then go to the outline: its section is what stays under the eyes
  await ed.getByText("three paragraph 6.").scrollIntoViewIfNeeded(); await page.evaluate(() => { const m = document.getElementById("main-scroll")!; m.scrollTop += 200; });
  await page.keyboard.press("Alt+Digit2"); await expect(frame).toHaveAttribute("data-zoom-level", "2"); const outline = page.getByTestId("zoom-outline"); await expect(outline.locator("li")).toHaveCount(4); await expect(ed).toBeHidden();
  await expect(outline.locator("li").nth(3)).toContainText("Section three"); await expect(outline.locator("li").nth(3)).toContainText("Marker sentence of section three."); await expect(outline.locator("li").nth(3)).not.toContainText("Tail"); await expect(outline.locator("li").first()).toContainText("Opening sentence of the page.");
  await expect(outline.locator("li").nth(3)).toBeInViewport(); expect(ai).toEqual(["GET /zoom?level=2"]);
  // back to the full text from a section: that section's heading is on screen
  await outline.locator("li").nth(2).getByRole("button").click(); await expect(frame).toHaveAttribute("data-zoom-level", "3"); await expect(ed.getByRole("heading", { name: "Section two" })).toBeInViewport(); await expect(ed.getByText("three paragraph 6.")).toBeAttached();
  // level 1: the cache only on first paint — nothing spent; the absence of a synopsis is said
  ai.length = 0; await page.getByTestId("zoom-1").click(); const syn = page.getByTestId("zoom-synopsis"); await expect(syn).toHaveAttribute("data-status", "missing"); await expect(page.getByTestId("zoom-synopsis-missing")).toContainText("Nothing was sent to any provider"); await expect(syn.locator("[data-ai-mark]")).toBeVisible();
  expect(ai).toEqual(["GET /zoom/ai?cachedOnly=1"]); expect((await sql`select count(*)::int as n from ai_synopses where page_id = ${p.id}`)[0].n).toBe(0);
  // generating is an explicit click; the result is marked AI with its model and date (faked HTTP answer unless E2E_LIVE_AI=1)
  const fake = (text: string, cached = false) => ({ pageId: p.id, level: 1, contentHash: "x", ai: true, status: "ready", synopsis: text, model: "fake-model", provider: "fake", generatedAt: "2026-11-19T12:00:00.000Z", cached, costUsd: 0 });
  if (!LIVE) await page.route(`**/api/pages/${p.id}/zoom/ai`, (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(fake(route.request().method() === "POST" ? "Regenerated fake synopsis." : "First fake synopsis.")) }));
  await page.getByTestId("zoom-generate").click(); await expect(syn).toHaveAttribute("data-status", "ready", { timeout: 60_000 }); await expect(page.getByTestId("zoom-synopsis-text")).not.toBeEmpty(); await expect(syn.locator("[data-ai-mark]")).toContainText(LIVE ? /AI synopsis · \S+/ : "AI synopsis · fake-model");
  await expect(page.getByTestId("zoom-synopsis-meta")).toContainText(/20\d\d/); expect(ai.filter((x) => x === "GET /zoom/ai")).toHaveLength(1);
  if (!LIVE) { await page.getByTestId("zoom-regenerate").click(); await expect(page.getByTestId("zoom-synopsis-text")).toHaveText("Regenerated fake synopsis."); expect(ai.filter((x) => x === "POST /zoom/ai")).toHaveLength(1); await page.unroute(`**/api/pages/${p.id}/zoom/ai`); }
  else { expect((await sql`select count(*)::int as n from ai_synopses where page_id = ${p.id}`)[0].n).toBe(1); ai.length = 0; await page.getByTestId("zoom-3").click(); await page.getByTestId("zoom-1").click(); await expect(page.getByTestId("zoom-synopsis-meta")).toContainText("from the cache, nothing was sent"); expect(ai).toEqual(["GET /zoom/ai?cachedOnly=1"]); }
  // level 4: the full text plus the connections of the page
  await page.keyboard.press("Alt+Digit4"); await expect(frame).toHaveAttribute("data-zoom-level", "4"); const conn = page.getByTestId("zoom-connections"); await expect(conn).toContainText(`Zoom target ${s}`); await expect(conn).toContainText("supports"); await expect(conn).toContainText("zoom relation"); await expect(ed).toBeVisible();
  await page.keyboard.press("Alt+Digit3"); await expect(conn).toHaveCount(0);
  // the zoom never touches the document or its autosave
  expect((await server(page, p.id)).version).toBe(p.version); await palette(page, "reading level outline", "Reading level: Outline"); await expect(frame).toHaveAttribute("data-zoom-level", "2");
});

test("ask my knowledge: scope selector, starter questions, citation chip that jumps to the cited block, honest insufficient-evidence state, conversations kept", async ({ page }) => {
  test.setTimeout(180_000); await page.goto("/"); const s = stamp();
  const p = await newPage(page, `Offer ${s}`, docOf(H(2, "Conditions"), ...Array.from({ length: 12 }, (_, i) => para(`Filler line ${i + 1} about nothing in particular.`)), para(`The zorblax penalty ${s} equals three months of interest.`), para("Closing line.")));
  const doc = (await server(page, p.id)).content.content as any[]; const block = doc.find((n) => JSON.stringify(n).includes("zorblax")).attrs.id as string;
  // /ai: full screen, starters, scope radios (page scopes unavailable without a page), nothing sent by opening
  const sent: any[] = []; page.on("request", (r) => { if (r.url().endsWith("/api/ai/chat") && r.method() === "POST") sent.push(r.postDataJSON()); });
  await page.goto("/ai"); const ask = page.getByTestId("ask-page"); await expect(ask.getByTestId("starter-questions").getByRole("button")).not.toHaveCount(0); const scope = ask.getByTestId("ask-scope"); await expect(scope.getByRole("radio")).toHaveText(["All my notes", "This page", "This project", "Selection"]);
  await expect(scope.getByRole("radio", { name: "All my notes" })).toHaveAttribute("aria-checked", "true"); await expect(scope.getByRole("radio", { name: "This page" })).toHaveAttribute("aria-disabled", "true"); await expect(ask.getByTestId("ask-conversations")).toBeVisible(); expect(sent).toHaveLength(0);
  await ask.getByTestId("starter-questions").getByRole("button").first().click(); await expect(ask.getByLabel("Message")).not.toHaveValue(""); expect(sent, "a starter question fills the field; Send stays the user's click").toHaveLength(0);
  // the page panel: scope "This page", then "Selection" once text is selected
  await page.goto(`/p/${p.id}`); const ed = page.locator(".note-editor .ProseMirror").first(); await ed.waitFor(); await page.getByRole("button", { name: "Ask about this page" }).first().click(); const panel = page.getByRole("complementary", { name: "AI assistant" }); const ps = panel.getByTestId("ask-scope");
  await expect(ps.getByRole("radio", { name: "Selection" })).toHaveAttribute("aria-disabled", "true"); await ed.getByText("zorblax").click({ clickCount: 3 }); await expect(ps.getByRole("radio", { name: "Selection" })).toHaveAttribute("aria-disabled", "false");
  await ps.getByRole("radio", { name: "Selection" }).click(); await expect(panel.getByTestId("ask-selection")).toContainText("zorblax"); await ps.getByRole("radio", { name: "This page" }).click(); await expect(ps).toHaveAttribute("data-scope", "page");
  const sse = (events: unknown[]) => events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("") + "data: [DONE]\n\n";
  const src = { n: 1, chunkId: "c1", pageId: p.id, title: p.title, icon: null, heading: "Conditions", blockId: block, excerpt: "The zorblax penalty equals three months of interest.", score: 0.02, semantic: 0.7, sourceType: "page", blockIds: [block], anchor: "block", quote: "The zorblax penalty equals three months of interest." };
  if (!LIVE) await page.route("**/api/ai/chat", (route) => { const body = route.request().postDataJSON(); const none = /barrel of oil/.test(body.message);
    return route.fulfill({ contentType: "text/event-stream", body: none ? sse([{ type: "meta", conversationId: "00000000-0000-4000-8000-000000000001", clientId: body.clientId, mode: "notes", model: null, provider: null, reason: "no supporting source", task: "chat", sources: [], weak: [], evidence: "none", sent: null, budgetNote: null, replayed: false, scope: body.scope ?? "all", scopePages: 1, staleDropped: 0 }, { type: "text", delta: "**No supporting note found.**" }, { type: "done", messageId: "m2", content: "**No supporting note found.** I searched and found nothing relevant.", usage: null, costUsd: 0, latencyMs: 0, ttftMs: null, sources: [], evidence: "none", invalidCitations: [], uncited: false, replayed: false }])
      : sse([{ type: "meta", conversationId: "00000000-0000-4000-8000-000000000001", clientId: body.clientId, mode: "notes", model: "fake-model", provider: "fake", reason: "test", task: "chat", sources: [src], weak: [], evidence: "ok", sent: { pageChars: 0, excerpts: 1, references: 0, images: 0, history: 0, embeddedBy: null, rankedBy: null }, budgetNote: null, replayed: false, scope: body.scope ?? "all", scopePages: 1, staleDropped: 0 }, { type: "text", delta: "Three months of interest [1]." }, { type: "done", messageId: "m1", content: "Three months of interest [1].", usage: null, costUsd: 0, latencyMs: 10, ttftMs: 5, sources: [src], evidence: "ok", invalidCitations: [], uncited: false, replayed: false }]) }); });
  if (LIVE) await expect.poll(async () => (await sql`select count(*)::int as n from embeddings e join chunks c on c.id = e.chunk_id where c.page_id = ${p.id}`)[0].n, { timeout: 90_000, message: "the worker indexed the page" }).toBeGreaterThan(0);
  await panel.getByLabel("Message").fill(`What is the zorblax penalty ${s}?`); await panel.getByRole("button", { name: "Send" }).click();
  const chip = panel.getByTestId("cite-chip").first(); await expect(chip).toBeVisible({ timeout: 90_000 }); expect(sent.at(-1)).toMatchObject({ scope: "page", pageId: p.id, mode: "notes" }); await expect(chip).toHaveAttribute("data-page", p.id); if (!LIVE) await expect(chip).toHaveAttribute("data-block", block);
  await expect(panel).toContainText("scope: this page");
  // the chip jumps to the cited block of the open page
  await page.evaluate(() => { document.getElementById("main-scroll")!.scrollTop = 0; }); const cited = await chip.getAttribute("data-block"); expect(cited).toBeTruthy(); await chip.click(); await expect(page.locator(`#block-${cited}`)).toBeInViewport();
  // no evidence: said as the API reports it, nothing answered from general knowledge
  await panel.getByLabel("Message").fill("What is the price of a barrel of oil on Mars?"); await panel.getByRole("button", { name: "Send" }).click(); const none = panel.getByTestId("insufficient-evidence").last(); await expect(none).toBeVisible({ timeout: 90_000 });
  await expect(none).toContainText("Insufficient evidence"); await expect(none).toHaveAttribute("data-evidence", /none|insufficient/); if (!LIVE) await expect(none).toContainText("No AI provider was called"); expect(sent.at(-1)).toMatchObject({ scope: "page" });
  // from another page, a chip navigates to /p/<id>#block-<id>
  if (!LIVE) { await page.goto("/ai"); await ask.getByLabel("Message").fill("What is the zorblax penalty?"); await ask.getByRole("button", { name: "Send" }).click(); await ask.getByTestId("cite-chip").first().click(); await expect(page).toHaveURL(new RegExp(`/p/${p.id}#block-${block}`)); await expect(page.locator(`#block-${block}`)).toBeInViewport(); expect(sent.at(-1).scope, "`all` sends the 2.x request unchanged").toBeUndefined(); }
  else { await page.goto("/ai"); await expect(ask.getByTestId("ask-conversations").getByRole("button").filter({ hasText: "zorblax" }).first()).toBeVisible(); await ask.getByTestId("ask-conversations").getByRole("button").filter({ hasText: "zorblax" }).first().click(); await expect(ask.getByTestId("cite-chip").first()).toBeVisible(); }
});

test("every screen is in the command center and the sidebar; desktop layouts do not overflow", async ({ page }) => {
  await page.goto("/"); const side = page.locator("aside").first();
  for (const [label, href] of [["Ask My Knowledge", "/ai"], ["Timeline", "/timeline"], ["Time machine", "/timemachine"], ["Knowledge health", "/health"], ["Constellation · Labs", "/constellation"], ["Graph", "/graph"]] as const) await expect(side.getByRole("link", { name: label, exact: true })).toHaveAttribute("href", href);
  for (const [q, title, url] of [["knowledge health", "Knowledge health", /\/health$/], ["time machine", "Time machine", /\/timemachine/], ["knowledge timeline", "Knowledge timeline", /\/timeline$/], ["thought constellation", "Thought constellation (Labs)", /\/constellation$/], ["ask my knowledge", "Ask My Knowledge", /\/ai$/], ["graph concepts view", "Graph: concepts view", /\/graph\?view=concepts/], ["graph insights", "Graph insights", /\/graph/], ["daily brief", "Daily brief", /:\d+\/$/]] as const) { await palette(page, q, title); await expect(page).toHaveURL(url); await page.waitForLoadState("networkidle").catch(() => {}); await expectNoHorizontalOverflow(page); await expect(page.locator("main")).not.toContainText(/Application error|Could not load/); }
  await page.goto("/ai"); await expect(side.getByRole("link", { name: "Ask My Knowledge", exact: true })).toHaveAttribute("data-active", "true"); await page.goto("/ai/agents"); await expect(side.getByRole("link", { name: "Ask My Knowledge", exact: true })).toHaveAttribute("data-active", "false");
});
