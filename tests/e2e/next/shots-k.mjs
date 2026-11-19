// file: tests/e2e/next/shots-k.mjs
// description: screenshots (light + dark, desktop + phone) of the knowledge screens — Graph 2.0, Thought Constellation, Timeline,
//   Time Machine, Knowledge Health, Daily Brief, Semantic Zoom, Ask My Knowledge — on a small demo workspace created through the API
//   (pages, links, typed relations, a concept, tasks, a capture). The two rows a model would normally produce (one suggested
//   relation, one contradiction insight) are inserted as fixtures and carry the model name "fixture".
// author: Simon-Pierre Boucher — contact@spboucher.ai
// usage: set -a; . ./.env; set +a; E2E_BASE_URL=http://localhost:8487 node tests/e2e/next/shots-k.mjs <outDir> <sessionTokenFile> [--only name,name]
import { chromium } from "@playwright/test"; import fs from "node:fs"; import postgres from "postgres";
const base = process.env.E2E_BASE_URL ?? "http://localhost:8487"; const out = process.argv[2] ?? "test-results/shots-k"; const token = fs.readFileSync(process.argv[3], "utf8").trim(); fs.mkdirSync(out, { recursive: true });
const only = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1].split(",") : null;
if (!/(_dev|_test|_scratch)$/.test((process.env.DATABASE_URL ?? "").split("/").pop() ?? "")) throw new Error("scratch database only");
const sql = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} });
const T = (text, marks) => ({ type: "text", text, ...(marks ? { marks } : {}) }); const P = (...c) => ({ type: "paragraph", content: c.map((x) => (typeof x === "string" ? T(x) : x)) }); const H = (level, text) => ({ type: "heading", attrs: { level }, content: [T(text)] });
const M = (id, label) => ({ type: "mention", attrs: { id, label } });
const auth = { extraHTTPHeaders: { cookie: `__Host-note_session=${token}` } }; // a __Host- cookie cannot be planted on http://localhost through CDP: the header is sent instead
const b = await chromium.launch();
const seedCtx = await b.newContext({ baseURL: base, ...auth }); const rq = seedCtx.request;
const call = async (method, url, data) => { const r = await rq.fetch(url, { method, data, headers: { origin: base, ...(data ? { "content-type": "application/json" } : {}) } }); const j = await r.json().catch(() => null); if (!r.ok()) throw new Error(`${method} ${url} → ${r.status()} ${JSON.stringify(j)}`); return j; };
const tree = await call("GET", "/api/tree"); let demo = Object.fromEntries(tree.filter((n) => n.title.startsWith("Demo · ")).map((n) => [n.title.slice(7), n.id]));
if (!demo["Mortgage renewal"]) {
  const mk = async (title, content, extra = {}) => (await call("POST", "/api/pages", { title: `Demo · ${title}`, content: { type: "doc", content }, ...extra })).id;
  const project = await mk("Mortgage renewal", [H(1, "Goal"), P("Renew the mortgage before March with the lowest total cost over five years."), H(2, "Open points"), P("Fixed or variable rate? The bank offer expires in 90 days.")], { section: "projects", icon: "🏦" });
  const offer = await mk("Bank offer", [H(1, "Conditions"), P("The five-year fixed rate offered is 4.29 %, guaranteed for 90 days."), P("The prepayment penalty equals three months of interest."), H(2, "Amortisation"), P("Twenty-two years remain on the amortisation schedule."), H(2, "Decision"), { type: "callout", attrs: { kind: "decision", icon: "⚖️" }, content: [P("Ask the broker for a competing quote before signing.")] }], { parentId: project, section: "projects", icon: "📄" });
  const broker = await mk("Broker quote", [H(1, "Quote"), P("The broker found a five-year fixed rate of 4.04 % with another lender."), P("The prepayment penalty is the greater of three months of interest and the interest rate differential."), P("See ", M(offer, "Demo · Bank offer"), " for the bank's conditions.")], { parentId: project, section: "projects", icon: "🤝" });
  const rates = await mk("Rate outlook", [H(1, "Outlook"), P("Most forecasts expect the policy rate to fall by 50 basis points within a year."), P("A variable rate would then become cheaper than the fixed offers in ", M(offer, "Demo · Bank offer"), " and ", M(broker, "Demo · Broker quote"), "."), H(2, "Risk"), P("If inflation returns, the variable rate rises and the monthly payment with it.")], { section: "notes", icon: "📈" });
  const budget = await mk("Household budget", [H(1, "Monthly"), P("The mortgage payment must stay under 2 100 $ a month."), P("Related: ", M(project, "Demo · Mortgage renewal"), ".")], { section: "notes", icon: "🧮" });
  const reading = await mk("Reading notes — fixed vs variable", [H(1, "Summary"), P("Historically the variable rate has cost less than the fixed rate about two times out of three."), P("The study does not cover periods of rapidly rising rates.")], { section: "documents", icon: "📚" });
  const lonely = await mk("Garden ideas", [P("Plant tomatoes along the south wall; nothing links here yet.")], { section: "notes", icon: "🌱" });
  await mk("Reading notes — fixed vs variable", [P("Second copy of the reading notes, to be merged.")], { section: "notes" });
  await call("POST", "/api/pages", { title: "", content: { type: "doc", content: [P("An untitled thought about renewal dates.")] } });
  await call("POST", "/api/graph/relations", { fromId: reading, toId: rates, relType: "supports", note: "The historical study backs the outlook." });
  await call("POST", "/api/graph/relations", { fromId: broker, toId: offer, relType: "contradicts", note: "Different penalty formula." });
  await call("POST", "/api/graph/relations", { fromId: budget, toId: project, relType: "part_of" });
  await call("POST", "/api/graph/relations", { fromId: rates, toId: project, relType: "answers", validFrom: "2026-10-01T00:00:00.000Z" });
  await call("POST", "/api/concepts", { name: "Demo · Prepayment penalty", description: "What it costs to break the mortgage early.", pageIds: [offer, broker] });
  const day = 86_400_000; const due = (d) => new Date(Date.now() + d * day).toISOString();
  await call("POST", "/api/tasks", { title: "Demo · Call the broker back", pageId: broker, dueAt: due(-2), priority: "high" }); await call("POST", "/api/tasks", { title: "Demo · Send pay stubs to the bank", pageId: offer, dueAt: due(0) });
  await call("POST", "/api/tasks", { title: "Demo · Compare the two penalties", pageId: project, dueAt: due(3) }); await call("POST", "/api/tasks", { title: "Demo · Read the lender's fine print", pageId: null });
  await call("POST", "/api/capture", { kind: "note", text: "Demo · Ask about portability of the mortgage" }).catch((e) => console.log("capture:", e.message));
await rq.fetch(`/api/pages/${offer}/tags`, { method: "PUT", data: { tags: ["finance", "mortgage"] }, headers: { origin: base, "content-type": "application/json" } }); await rq.fetch(`/api/pages/${broker}/tags`, { method: "PUT", data: { tags: ["finance", "mortgage"] }, headers: { origin: base, "content-type": "application/json" } }); await rq.fetch(`/api/pages/${rates}/tags`, { method: "PUT", data: { tags: ["finance"] }, headers: { origin: base, "content-type": "application/json" } });
  // a second saved state for the time machine: a history entry dated two days ago, then an edit today
  const cur = await call("GET", `/api/pages/${offer}`);
  await call("PATCH", `/api/pages/${offer}`, { content: cur.content, title: cur.title, baseVersion: cur.version }).catch(() => {});
  await sql`update page_versions set created_at = now() - interval '2 days', title = 'Demo · Bank offer (draft)', content = ${sql.json({ type: "doc", content: [H(1, "Conditions"), P("The five-year fixed rate offered is 4.49 %."), P("Penalty to be confirmed.")] })} where page_id = ${offer} and version = (select min(version) from page_versions where page_id = ${offer} and version > 0)`;
  await sql`update pages set created_at = now() - interval '5 days' where id = ${offer}`; await sql`update knowledge_events set at = now() - interval '5 days' where page_id = ${offer} and kind = 'page.created'`; void cur;
  // fixtures standing for model output (never produced by this script): one suggested relation, one contradiction insight
  const [ws] = await sql`select workspace_id from pages where id = ${offer}`;
  const blocks = (await call("GET", `/api/pages/${offer}/zoom?level=2`)).sections; const bblocks = (await call("GET", `/api/pages/${broker}/zoom?level=2`)).sections;
  await sql`insert into knowledge_edges (workspace_id, from_id, to_id, kind, rel_type, origin, status, confidence, rationale, model) values (${ws.workspace_id}, ${budget}, ${rates}, 'relation', 'extends', 'ai', 'suggested', 0.74, 'The budget ceiling depends on the rate scenario described in the outlook.', 'fixture') on conflict do nothing`;
  await sql`insert into knowledge_insights (workspace_id, kind, status, title, detail, data, origin, model, fingerprint) values (${ws.workspace_id}, 'contradiction', 'suggested', 'Demo · Two different prepayment penalties', 'One note says the penalty is three months of interest; the other says it is the greater of three months and the rate differential.', ${sql.json({ pageIds: [offer, broker], blockIds: [blocks[0]?.blockId, bblocks[0]?.blockId].filter(Boolean), a: { pageId: offer, blockId: blocks[0]?.blockId ?? null }, b: { pageId: broker, blockId: bblocks[0]?.blockId ?? null }, confidence: 0.8 })}, 'ai', 'fixture', ${"demo-" + offer}) on conflict do nothing`;
  await sql`insert into knowledge_insights (workspace_id, kind, status, title, detail, data, origin, model, fingerprint) values (${ws.workspace_id}, 'open_question', 'suggested', 'Demo · Is the mortgage portable to another property?', 'The notes mention a move as a possibility but never say whether the loan can follow.', ${sql.json({ pageIds: [project], blockIds: [], source: { pageId: project, blockId: null } })}, 'ai', 'fixture', ${"demo-q-" + project}) on conflict do nothing`;
  demo = { "Mortgage renewal": project, "Bank offer": offer, "Broker quote": broker, "Rate outlook": rates, "Household budget": budget, "Garden ideas": lonely };
  console.log("demo workspace created");
}
await seedCtx.close(); await sql.end();
const offer = demo["Bank offer"], project = demo["Mortgage renewal"];
const SHOTS = [
  ["brief", "/", async (p) => { await p.getByTestId("brief-tasks").waitFor(); }],
  ["graph-global", "/graph", async (p) => { await p.getByTestId("graph-canvas").waitFor(); await p.waitForTimeout(2500); }],
  ["graph-local-inspector", `/graph?view=local&pageId=${offer}&panel=suggested`, async (p) => { await p.getByTestId("graph-canvas").waitFor(); await p.waitForTimeout(2500); }],
  ["graph-insights", "/graph?view=concepts&panel=insights", async (p) => { await p.getByTestId("insights-panel").waitFor(); await p.waitForTimeout(2500); }],
  ["constellation", "/constellation", async (p) => { await p.locator("[data-testid=constellation],[data-testid=constellation-empty]").first().waitFor(); await p.waitForTimeout(2200); const c = p.getByTestId("constellation-canvas"); if (await c.count()) { const bb = await c.boundingBox(); for (let i = 0; i < 4; i++) { await p.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2); await p.mouse.wheel(0, -260); } await p.waitForTimeout(500); await c.focus(); await p.keyboard.press("ArrowRight"); await p.waitForTimeout(600); } }],
  ["timeline", "/timeline", async (p) => { await p.getByTestId("event-list").waitFor(); }],
  ["timemachine", `/timemachine?pageId=${offer}&at=${encodeURIComponent(new Date(Date.now() - 86_400_000).toISOString())}`, async (p) => { await p.getByTestId("tm-honesty").waitFor(); await p.getByTestId("tm-diff-tab").click(); await p.getByTestId("tm-diff").waitFor(); }],
  ["health", "/health?show=brokenLinks", async (p) => { await p.getByTestId("health-score").waitFor(); await p.getByTestId("health-orphans").click(); await p.getByTestId("health-detail").waitFor(); }],
  ["zoom-outline", `/p/${offer}`, async (p) => { await p.getByTestId("zoom-2").click(); await p.getByTestId("zoom-outline").waitFor(); }],
  ["zoom-synopsis", `/p/${offer}`, async (p) => { await p.getByTestId("zoom-1").click(); await p.getByTestId("zoom-synopsis").waitFor(); await p.waitForTimeout(600); }],
  ["zoom-connections", `/p/${offer}`, async (p) => { await p.getByTestId("zoom-4").click(); await p.getByTestId("zoom-connections").waitFor(); }],
  ["ask", "/ai", async (p) => { await p.getByTestId("ask-page").waitFor(); await p.getByTestId("starter-questions").waitFor(); }],
].filter((s) => !only || only.includes(s[0]));
const problems = [];
for (const theme of ["light", "dark"]) for (const [dev, w, h] of [["desktop", 1280, 800], ["phone", 375, 667]]) {
  const ctx = await b.newContext({ baseURL: base, viewport: { width: w, height: h }, hasTouch: dev === "phone", isMobile: dev === "phone", deviceScaleFactor: 2, colorScheme: theme, locale: "en-CA", timezoneId: "America/Toronto", ...auth });
  await ctx.addInitScript((t) => { try { localStorage.setItem("note-theme", t); const u = JSON.parse(localStorage.getItem("note-ui") ?? '{"state":{},"version":0}'); u.state.theme = t; localStorage.setItem("note-ui", JSON.stringify(u)); } catch {} }, theme);
  const p = await ctx.newPage(); p.on("pageerror", (e) => problems.push(`${dev}-${theme}: pageerror at ${p.url()} ${e.message.slice(0, 120)}`)); p.on("console", (m) => { if (m.type() === "error" && !/favicon|Failed to load resource/.test(m.text())) problems.push(`${dev}-${theme}: console ${m.text().slice(0, 200)}`); });
  for (const [name, url, ready] of SHOTS) {
    try { await p.goto(url); await ready(p); await p.waitForTimeout(700); const over = await p.evaluate(() => { const d = document.documentElement; const m = document.getElementById("main-scroll"); return d.scrollWidth > d.clientWidth + 1 || (m ? m.scrollWidth > m.clientWidth + 1 : false); }); if (over) problems.push(`${dev}-${theme}-${name}: horizontal overflow`); await p.screenshot({ path: `${out}/${name}-${dev}-${theme}.png` }); }
    catch (e) { problems.push(`${dev}-${theme}-${name}: ${String(e.message).split("\n")[0].slice(0, 200)}`); await p.screenshot({ path: `${out}/${name}-${dev}-${theme}-FAILED.png` }).catch(() => {}); }
  }
  await ctx.close();
}
await b.close(); console.log(problems.length ? `PROBLEMS:\n${[...new Set(problems)].join("\n")}` : "no problem detected"); console.log(`shots in ${out}`);
