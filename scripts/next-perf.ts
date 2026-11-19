/**
 * DEVELOPMENT ONLY — performance probe of the running scratch build (Next 16 / Turbopack prints no size table):
 *  1. first-load JavaScript of the main screens: the <script src> of the server-rendered HTML, summed raw and gzipped from .next/static;
 *  2. which heavy libraries are in those first-load scripts (they must be lazy: mermaid, pdf.js, the canvas, the graph renderers…);
 *  3. server timings of the feed, brief, knowledge health, graph, a database query and local hybrid search (median of 5, after 1 warm-up).
 * Creates three pages (note, canvas, database) and deletes them. No model is called (`semantic=0`).
 *   set -a && . ./.env && set +a && node_modules/.bin/tsx scripts/next-perf.ts
 */
import "../tests/helpers/testdb";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { eq, inArray } from "drizzle-orm";
import { db, schema, sql } from "../src/db/index";
import { createSession, ownerRow } from "../src/lib/auth/sessions";

const BASE = (process.env.APP_URL ?? "").replace(/\/$/, ""); const UA = "SPNotes/perf-probe (Macintosh) dev";
if (!["localhost", "127.0.0.1"].includes(new URL(BASE).hostname)) throw new Error("loopback only");
const u = await ownerRow(); if (!u) throw new Error("no owner"); const s = await createSession({ userId: u.id, credentialId: null, userAgent: UA, ip: "127.0.0.1" });
const cookie = `__Host-note_session=${s.token}; note_session=${s.token}`; const made: string[] = [];
const call = async (method: string, p: string, body?: unknown) => { const t0 = performance.now(); const r = await fetch(BASE + p, { method, headers: { cookie, "user-agent": UA, ...(method !== "GET" ? { origin: BASE } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }); const text = await r.text(); return { status: r.status, text, ms: performance.now() - t0, json: (() => { try { return JSON.parse(text); } catch { return null; } })() }; };
const SIGNATURES: Record<string, RegExp> = { mermaid: /mermaidAPI|flowchart-v2|"mermaid"/, "pdf.js": /pdfjs|PDFWorker|getDocument\(/, katex: /katex-html|KaTeX parse error/, "canvas surface": /cv-surface|canvas-surface/, "graph renderer": /knowledge-graph|forceSimulation|graph-canvas/, constellation: /constellation-sky|constellation-canvas/, "database views": /TimelineView|db-grid|database-view/, "highlight (lowlight)": /lowlight|hljs/, tiptap: /prosemirror|ProseMirror/ };
try {
  const mk = async (b: Record<string, unknown>) => { const r = await call("POST", "/api/pages", b); made.push(r.json.id); return r.json.id as string; };
  const note = await mk({ title: "perf · note", content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "hello" }] }] } });
  const canvas = await mk({ title: "perf · canvas", type: "canvas" }); const database = await mk({ title: "perf · database", type: "database", section: "databases" });
  const [bench] = await sql`select d.id from databases d join pages p on p.id = d.page_id where p.title = 'BENCH 20k rows' limit 1`;
  const sizeOf = new Map<string, { raw: number; gz: number; text: string }>();
  const chunk = (src: string) => { let c = sizeOf.get(src); if (!c) { const file = path.join(".next", decodeURIComponent(src.replace(/^\/_next\//, "").split("?")[0])); const buf = fs.readFileSync(file); c = { raw: buf.length, gz: zlib.gzipSync(buf).length, text: buf.toString("utf8") }; sizeOf.set(src, c); } return c; };
  console.log("FIRST-LOAD JS (scripts referenced by the server-rendered HTML)\nscreen".padEnd(86) + "files   raw kB   gzip kB   heavy libraries present");
  const shared: Set<string>[] = [];
  for (const [name, p] of [["/ (home, brief)", "/"], ["/p/[id] note", `/p/${note}`], ["/p/[id] canvas", `/p/${canvas}`], ["/p/[id] database", `/p/${database}`], ["/graph", "/graph"], ["/constellation", "/constellation"], ["/timeline", "/timeline"], ["/health", "/health"], ["/tasks", "/tasks"], ["/inbox", "/inbox"]] as const) {
    const html = (await call("GET", p)).text; const srcs = [...new Set([...html.matchAll(/<script[^>]+src="(\/_next\/static\/[^"]+\.js[^"]*)"/g)].map((m) => m[1]))]; shared.push(new Set(srcs));
    let raw = 0, gz = 0; const heavy = new Set<string>(); for (const src of srcs) { const c = chunk(src); raw += c.raw; gz += c.gz; for (const [lib, re] of Object.entries(SIGNATURES)) if (re.test(c.text)) heavy.add(lib); }
    console.log(name.padEnd(24) + String(srcs.length).padStart(5) + (raw / 1024).toFixed(0).padStart(9) + (gz / 1024).toFixed(0).padStart(10) + "   " + ([...heavy].join(", ") || "—"));
  }
  const common = [...shared[0]].filter((x) => shared.every((set) => set.has(x))); let cr = 0, cg = 0; const ch = new Set<string>(); for (const src of common) { const c = chunk(src); cr += c.raw; cg += c.gz; for (const [lib, re] of Object.entries(SIGNATURES)) if (re.test(c.text)) ch.add(lib); }
  console.log("shared by all of them".padEnd(24) + String(common.length).padStart(5) + (cr / 1024).toFixed(0).padStart(9) + (cg / 1024).toFixed(0).padStart(10) + "   " + ([...ch].join(", ") || "—"));
  // where the heavy libraries live (all static chunks)
  const all = fs.readdirSync(".next/static/chunks", { recursive: true }).map(String).filter((f) => f.endsWith(".js")); const where: Record<string, { n: number; kb: number }> = {};
  for (const f of all) { const t = fs.readFileSync(path.join(".next/static/chunks", f), "utf8"); for (const [lib, re] of Object.entries(SIGNATURES)) if (re.test(t)) { where[lib] ??= { n: 0, kb: 0 }; where[lib].n++; where[lib].kb += t.length / 1024; } }
  console.log("\nall static chunks: " + all.length + " files; chunks carrying each library: " + Object.entries(where).map(([k, v]) => `${k} ${v.n} (${v.kb.toFixed(0)} kB)`).join(" · "));

  console.log("\nSERVER TIMINGS (ms; first call, then median of 5)");
  const pagesN = Number((await sql`select count(*)::int as n from pages`)[0].n);
  const time = async (label: string, fn: () => Promise<{ status: number; text: string; ms: number }>) => { const first = await fn(); const xs: number[] = []; for (let i = 0; i < 5; i++) xs.push((await fn()).ms); xs.sort((a, b) => a - b); console.log(label.padEnd(58) + String(first.status).padStart(4) + first.ms.toFixed(0).padStart(8) + xs[2].toFixed(0).padStart(8) + (first.text.length / 1024).toFixed(0).padStart(9) + " kB"); };
  console.log(`(${pagesN} pages in the scratch database)`);
  await time("GET /api/sync?since=0&limit=500&kinds=all (one window)", () => call("GET", "/api/sync?since=0&limit=500&kinds=all"));
  { const t0 = performance.now(); let since = 0, calls = 0, bytes = 0; for (;;) { const r = await call("GET", `/api/sync?since=${since}&limit=500&kinds=all`); calls++; bytes += r.text.length; if (!r.json.more) break; since = r.json.cursor; } console.log("GET /api/sync full walk (cold client, limit=500)".padEnd(58) + `${calls} calls, ${(performance.now() - t0).toFixed(0)} ms, ${(bytes / 1048576).toFixed(1)} MB`); }
  await time("GET /api/brief", () => call("GET", "/api/brief")); await time("GET /api/health/knowledge", () => call("GET", "/api/health/knowledge"));
  await time("GET /api/graph?view=global", () => call("GET", "/api/graph?view=global")); await time("GET /api/graph/insights", () => call("GET", "/api/graph/insights"));
  if (bench) { await time("POST /api/databases/<20k rows>/query limit 100", () => call("POST", `/api/databases/${bench.id}/query`, { limit: 100 })); await time("POST …/query search \"sierra\" limit 100", () => call("POST", `/api/databases/${bench.id}/query`, { limit: 100, search: "sierra" })); }
  await time("GET /api/search?mode=hybrid&semantic=0&q=sierra+umbra", () => call("GET", "/api/search?mode=hybrid&semantic=0&q=sierra+umbra")); await time("GET /api/search?mode=quick&q=sierra", () => call("GET", "/api/search?mode=quick&q=sierra"));
  await time("GET /api/events", () => call("GET", "/api/events")); await time("GET /api/tree", () => call("GET", "/api/tree"));
} finally {
  if (made.length) { await db.delete(schema.knowledgeEvents).where(inArray(schema.knowledgeEvents.pageId, made)); await db.delete(schema.pages).where(inArray(schema.pages.id, made)); }
  await db.delete(schema.sessions).where(eq(schema.sessions.userAgent, UA)); await sql.end();
}
