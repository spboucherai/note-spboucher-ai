/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : tests/http/next-api.test.ts
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

/**
 * HTTP-level checks of the 3.0 API against a RUNNING scratch instance (the routes themselves: auth, same-origin rule, status codes,
 * headers, Range, idempotency). Needs `bash scripts/next-dev-server.sh start` first; run with `pnpm test:http`.
 * The session is created directly in the scratch database (same as scripts/dev-session.ts) — no passkey, never against production.
 */
import "../helpers/testdb";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { randomUUID, createHash } from "node:crypto";
import { eq, gte, inArray, like, and } from "drizzle-orm";
import { db, schema, sql } from "../../src/db/index";
import { createSession, ownerRow } from "../../src/lib/auth/sessions";

const BASE = (process.env.APP_URL ?? "").replace(/\/$/, ""); const PFX = "nx-http ·"; const STARTED = new Date(Date.now() - 2000);
const UA = "SPNotes/2.0.0 (Macintosh; Mac OS X 27.0) nx-http-tests";
let cookie = ""; let ws = ""; const pages: string[] = []; const tasks: string[] = []; const atts: string[] = [];
type Res = { status: number; headers: Headers; json: any; text: string; bytes: Buffer };
async function api(method: string, path: string, body?: unknown, extra: Record<string, string> = {}, opts: { anonymous?: boolean; noOrigin?: boolean } = {}): Promise<Res> {
  const headers: Record<string, string> = { "user-agent": UA, ...extra }; if (!opts.anonymous) headers.cookie = cookie;
  if (method !== "GET" && !opts.noOrigin) headers.origin = BASE;
  let payload: any; if (body instanceof FormData) payload = body; else if (body !== undefined) { headers["content-type"] = "application/json"; payload = JSON.stringify(body); }
  const r = await fetch(BASE + path, { method, headers, body: payload, redirect: "manual" }); const bytes = Buffer.from(await r.arrayBuffer()); const text = bytes.toString("utf8");
  let json: any = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: r.status, headers: r.headers, json, text, bytes };
}
before(async () => {
  const host = new URL(BASE).hostname; assert.ok(host === "localhost" || host === "127.0.0.1", "APP_URL must be loopback");
  const up = await fetch(`${BASE}/api/health`).then((r) => r.ok, () => false); assert.ok(up, `no server on ${BASE}: run  bash scripts/next-dev-server.sh start`);
  const u = await ownerRow(); assert.ok(u, "owner missing: pnpm run bootstrap"); const s = await createSession({ userId: u!.id, credentialId: null, userAgent: "SPNotes/2.0.0 (Macintosh; Mac OS X 27.0) nx-http-tests", ip: "127.0.0.1" });
  cookie = `__Host-note_session=${s.token}; note_session=${s.token}`; const [w] = await db.select().from(schema.workspaces).limit(1); ws = w.id;
});
after(async () => {
  const mine = await db.select({ id: schema.pages.id }).from(schema.pages).where(and(eq(schema.pages.workspaceId, ws), like(schema.pages.title, `${PFX}%`))); const ids = [...new Set([...pages, ...mine.map((m) => m.id)])];
  if (tasks.length) await db.delete(schema.tasks).where(inArray(schema.tasks.id, tasks)); if (atts.length) await db.delete(schema.attachments).where(inArray(schema.attachments.id, atts));
  if (ids.length) { await db.delete(schema.knowledgeEdges).where(inArray(schema.knowledgeEdges.fromId, ids)); await db.delete(schema.pages).where(inArray(schema.pages.id, ids)); await db.delete(schema.knowledgeEvents).where(inArray(schema.knowledgeEvents.pageId, ids)); await db.delete(schema.syncTombstones).where(inArray(schema.syncTombstones.id, ids)); }
  await db.delete(schema.knowledgeEvents).where(and(eq(schema.knowledgeEvents.workspaceId, ws), like(schema.knowledgeEvents.summary, `${PFX}%`)));
  await db.delete(schema.syncTombstones).where(and(inArray(schema.syncTombstones.kind, ["task", "attachment", "canvas", "edge"]), gte(schema.syncTombstones.deletedAt, STARTED))); // only the tombstones of this run
  await db.delete(schema.sessions).where(eq(schema.sessions.userAgent, "SPNotes/2.0.0 (Macintosh; Mac OS X 27.0) nx-http-tests")); await sql.end();
});
/** A request with exactly the headers given (fetch adds its own): what a client that forgets `Origin` sends. */
const raw = (method: string, path: string, body: unknown, headers: Record<string, string>) => new Promise<{ status: number; json: any }>((resolve, reject) => {
  const data = JSON.stringify(body); const u = new URL(BASE + path);
  const req = http.request({ host: u.hostname, port: u.port, path: u.pathname + u.search, method, headers: { "content-type": "application/json", "content-length": Buffer.byteLength(data), ...headers } }, (res) => { let t = ""; res.on("data", (c) => (t += c)); res.on("end", () => { let json: any = null; try { json = JSON.parse(t); } catch { /* */ } resolve({ status: res.statusCode ?? 0, json }); }); });
  req.on("error", reject); req.end(data);
});
const page = async (title: string, extra: Record<string, unknown> = {}) => { const r = await api("POST", "/api/pages", { title: `${PFX} ${title}`, ...extra }); assert.equal(r.status, 201, r.text); pages.push(r.json.id); return r.json; };

test("GET /api/meta announces API 3 and its features; every new route needs a session", async () => {
  const m = await api("GET", "/api/meta"); assert.equal(m.status, 200); assert.equal(m.json.api, 3); assert.match(m.json.version, /^3\.0\.0/); assert.ok(m.json.features.includes("entities") && m.json.features.includes("canvas")); assert.equal(m.headers.get("cache-control"), "private, no-store"); assert.ok(m.headers.get("x-request-id"));
  for (const p of ["/api/meta", "/api/events", "/api/timemachine?at=2026-01-01", "/api/health/knowledge", "/api/brief", "/api/graph/insights", "/api/graph/relations", "/api/concepts", `/api/canvases/${randomUUID()}`, `/api/tasks/${randomUUID()}`, "/api/sync?kinds=all", `/api/pages/${randomUUID()}/zoom`]) { const r = await api("GET", p, undefined, {}, { anonymous: true }); assert.equal(r.status, 401, p); assert.equal(r.json.code, "unauthenticated"); }
  const pub = await api("GET", "/api/health", undefined, {}, { anonymous: true }); assert.equal(pub.status, 200, "the liveness probe stays public");
});
test("mutations of the new routes need the Origin header (same rule as 2.x)", async () => {
  for (const [m, p, b] of [["POST", "/api/tasks", { title: "x" }], ["POST", "/api/query", { source: "tasks" }], ["POST", "/api/graph/relations", {}], ["PUT", `/api/canvases/${randomUUID()}`, {}], ["POST", "/api/concepts", { name: "x" }], ["POST", "/api/graph/insights/run", {}]] as const) { const r = await raw(m, p, b, { cookie }); assert.equal(r.status, 403, `${m} ${p}`); assert.equal(r.json.code, "csrf"); }
  const ok = await raw("POST", "/api/query", { source: "tasks", limit: 1 }, { cookie, origin: BASE }); assert.equal(ok.status, 200, "the same request with Origin passes");
  const evil = await raw("POST", "/api/tasks", { title: "x" }, { cookie, origin: "https://evil.example" }); assert.deepEqual([evil.status, evil.json.code], [403, "csrf"], "another origin is refused");
});
test("malformed identifiers answer 400 everywhere (they answered 500)", async () => {
  const bad = "not-a-uuid"; const hyphens = "-".repeat(36);
  const gets = [`/api/pages/${bad}`, `/api/pages/${bad}/tags`, `/api/pages/${bad}/versions`, `/api/pages/${bad}/zoom`, `/api/files/${bad}`, `/api/tasks/${bad}`, `/api/canvases/${bad}`, `/api/graph/relations/${bad}`, `/api/concepts/${bad}`, `/api/pages?view=children:${bad}`, `/api/attachments?pageId=${bad}`, `/api/graph?view=local&pageId=${bad}`, `/api/graph?view=local&pageId=${hyphens}`, `/api/events?pageId=${bad}`, `/api/timemachine?at=2026-01-01&pageId=${bad}`, `/api/tasks?pageId=${bad}`, `/api/graph/relations?nodeId=${bad}`, `/api/concepts?pageId=${bad}`, `/api/inbox/${bad}`];
  for (const p of gets) { const r = await api(p.startsWith("/api/inbox/") ? "POST" : "GET", p, p.startsWith("/api/inbox/") ? { action: "archive" } : undefined); assert.equal(r.status, 400, `${p} → ${r.status} ${r.text.slice(0, 80)}`); assert.ok(r.json?.error); }
  for (const [m, p] of [["DELETE", `/api/pages/${bad}`], ["DELETE", `/api/attachments?id=${bad}`], ["DELETE", "/api/attachments"], ["DELETE", `/api/tasks?id=${bad}`], ["DELETE", `/api/tasks/${bad}`], ["PATCH", `/api/graph/insights/${bad}`], ["POST", `/api/pages/${bad}/versions/1/restore`]] as const) { const r = await api(m, p, m === "PATCH" ? { status: "dismissed" } : undefined); assert.equal(r.status, 400, `${m} ${p} → ${r.status}`); }
  const legacy = await api("GET", `/api/graph?pageId=${hyphens}`); assert.equal(legacy.status, 200, "2.x form: an unusable pageId is ignored (whole graph), no longer a 500");
  for (const p of ["/api/sync?since=abc", "/api/sync?kinds=bogus", "/api/events?kinds=nope", "/api/events?cursor=zzz", "/api/timemachine", "/api/timemachine?at=hier&pageId=" + randomUUID(), "/api/graph?view=bogus", "/api/graph?view=local", "/api/pages/" + randomUUID() + "/zoom?level=9", "/api/tasks?since=x", "/api/health/knowledge?inactiveDays=x", "/api/brief?tz=Nowhere/Land"]) { const r = await api("GET", p); assert.equal(r.status, 400, `${p} → ${r.status}`); }
  const missing = await api("GET", `/api/pages/${randomUUID()}`); assert.equal(missing.status, 404, "a well-formed unknown id stays a 404");
});
test("GET /api/sync without kinds is the 2.x payload; with kinds it adds `entities` last", async () => {
  await page("sync"); const a = await api("GET", "/api/sync?since=0&limit=500");
  assert.equal(a.status, 200); assert.deepEqual(Object.keys(a.json), ["cursor", "head", "more", "reset", "serverTime", "workspace", "user", "pages", "attachments", "tombstones", "tags"]);
  assert.match(a.text, /^\{"cursor":\d+,"head":\d+,"more":(true|false),"reset":false,"serverTime":"[^"]+","workspace":\{"id":"[0-9a-f-]{36}","name":"[^"]*"\},"user":\{"displayName":"[^"]*"\},"pages":\[/, "byte layout of the 2.x answer");
  assert.ok(!a.text.includes('"entities"')); assert.ok(a.json.tombstones.every((t: any) => ["page", "attachment"].includes(t.kind)));
  const b = await api("GET", "/api/sync?since=0&limit=500&kinds=task,canvas"); assert.deepEqual(Object.keys(b.json).slice(-1), ["entities"]); assert.deepEqual(Object.keys(b.json.entities), ["task", "canvas"]); assert.ok(b.json.head >= a.json.head);
});
test("tasks over HTTP: client id, idempotent POST, PATCH and DELETE by id, 2.x forms kept", async () => {
  const id = randomUUID(); tasks.push(id); const p = await page("task host");
  const c = await api("POST", "/api/tasks", { id, title: `${PFX} task`, due: "2026-12-24", priority: "high", pageId: p.id, blockId: "blk1" }); assert.equal(c.status, 201, c.text); assert.equal(c.json.id, id); assert.equal(c.json.dueAt, "2026-12-24T12:00:00.000Z"); assert.equal(c.json.blockId, "blk1"); assert.ok(c.json.rev > 0);
  const again = await api("POST", "/api/tasks", { id, title: "retry" }); assert.equal(again.status, 200); assert.equal(again.headers.get("x-existing"), "1"); assert.equal(again.json.title, `${PFX} task`);
  const one = await api("GET", `/api/tasks/${id}`); assert.equal(one.status, 200); assert.equal(one.json.pageId, p.id);
  const done = await api("PATCH", `/api/tasks/${id}`, { status: "done" }); assert.equal(done.status, 200); assert.ok(done.json.completedAt); assert.ok(done.json.rev > c.json.rev);
  const legacy = await api("PATCH", "/api/tasks", { id, status: "todo", title: `${PFX} task v2` }); assert.equal(legacy.status, 200, "2.x PATCH with the id in the body"); assert.equal(legacy.json.completedAt, null);
  const list = await api("GET", `/api/tasks?pageId=${p.id}`); assert.equal(list.json.length, 1); assert.deepEqual(Object.keys(list.json[0]).slice(0, 12), ["id", "title", "status", "priority", "dueAt", "completedAt", "project", "pageId", "createdAt", "updatedAt", "pageTitle", "pageIcon"], "2.x keys first, in the same order"); assert.equal(list.json[0].pageTitle, `${PFX} task host`);
  assert.equal((await api("POST", "/api/tasks", { title: "x", pageId: randomUUID() })).json.code, "bad_page"); assert.equal((await api("POST", "/api/tasks", { title: "" })).status, 400); assert.equal((await api("PATCH", `/api/tasks/${randomUUID()}`, { title: "x" })).status, 404);
  const d1 = await api("DELETE", `/api/tasks/${id}`); assert.deepEqual(d1.json, { ok: true, deleted: true }); const d2 = await api("DELETE", `/api/tasks/${id}`); assert.deepEqual([d2.status, d2.json], [200, { ok: true, deleted: false }], "idempotent");
  assert.equal((await api("DELETE", `/api/tasks?id=${id}`)).status, 404, "2.x DELETE keeps its 404 on an already deleted task"); const unknown = await api("DELETE", `/api/tasks/${randomUUID()}`); assert.deepEqual([unknown.status, unknown.json], [200, { ok: true, deleted: false }], "DELETE is idempotent: an unknown id answers 200");
  const ev = await api("GET", `/api/events?pageId=${p.id}&kinds=task.*`); assert.deepEqual(ev.json.events.map((e: any) => e.kind), ["task.reopened", "task.completed", "task.created"]); assert.equal(ev.json.events[0].actor, "user"); assert.equal(ev.json.events[0].device, "SP Notes · Mac", "events carry the device label of the session");
});
test("files: Accept-Ranges, 206 with the exact bytes, 416, If-Range, and a deleted attachment is no longer served", async () => {
  const body = Buffer.from(Array.from({ length: 5000 }, (_, i) => String.fromCharCode(97 + (i % 26))).join("") + randomUUID()); const id = randomUUID(); atts.push(id);
  const form = new FormData(); form.set("file", new Blob([body], { type: "audio/mpeg" }), "memo.mp3"); form.set("id", id);
  const up = await api("POST", "/api/attachments", form); assert.equal(up.status, 201, up.text); assert.equal(up.json.url, `/api/files/${id}`);
  const full = await api("GET", `/api/files/${id}`); assert.equal(full.status, 200); assert.equal(full.headers.get("accept-ranges"), "bytes"); assert.equal(full.headers.get("content-length"), String(body.length)); assert.ok(full.bytes.equals(body));
  const etag = full.headers.get("etag")!; assert.equal(etag, `"${createHash("sha256").update(body).digest("hex")}"`); assert.equal(full.headers.get("content-type"), "audio/mpeg"); assert.match(full.headers.get("content-disposition")!, /^inline/);
  const r1 = await api("GET", `/api/files/${id}`, undefined, { range: "bytes=100-199" }); assert.equal(r1.status, 206); assert.equal(r1.headers.get("content-range"), `bytes 100-199/${body.length}`); assert.equal(r1.headers.get("content-length"), "100"); assert.ok(r1.bytes.equals(body.subarray(100, 200)));
  const r2 = await api("GET", `/api/files/${id}`, undefined, { range: "bytes=-36" }); assert.equal(r2.status, 206); assert.ok(r2.bytes.equals(body.subarray(body.length - 36)), "suffix range = the last bytes");
  const r3 = await api("GET", `/api/files/${id}`, undefined, { range: `bytes=${body.length - 10}-` }); assert.equal(r3.status, 206); assert.equal(r3.bytes.length, 10); assert.equal(r3.headers.get("content-range"), `bytes ${body.length - 10}-${body.length - 1}/${body.length}`);
  const r4 = await api("GET", `/api/files/${id}`, undefined, { range: `bytes=${body.length}-` }); assert.equal(r4.status, 416); assert.equal(r4.headers.get("content-range"), `bytes */${body.length}`);
  const r5 = await api("GET", `/api/files/${id}`, undefined, { range: "bytes=0-9,20-29" }); assert.equal(r5.status, 200, "several ranges: the whole file"); assert.equal(r5.bytes.length, body.length);
  const r6 = await api("GET", `/api/files/${id}`, undefined, { range: "bytes=0-9", "if-range": '"another-etag"' }); assert.equal(r6.status, 200, "If-Range with another ETag: the whole file");
  const r7 = await api("GET", `/api/files/${id}`, undefined, { range: "bytes=0-9", "if-range": etag }); assert.equal(r7.status, 206);
  const ev = await api("GET", "/api/events?kinds=attachment.added&limit=5"); assert.ok(ev.json.events.some((e: any) => e.entityId === id && e.summary === "memo.mp3"));
  assert.equal((await api("DELETE", `/api/attachments?id=${id}`)).status, 200); const gone = await api("GET", `/api/files/${id}`); assert.equal(gone.status, 404, "a soft-deleted attachment is not served any more");
  assert.equal((await api("GET", `/api/files/${id}`, undefined, { range: "bytes=0-9" })).status, 404);
});
test("canvas over HTTP: page of type canvas, GET, PUT with baseVersion, 409 with the server copy", async () => {
  const start = (await api("GET", "/api/sync?kinds=canvas&since=0&limit=1")).json.head; // the feed is read from here: the scratch workspace may hold more than one window of older changes
  const id = randomUUID(); const p = await page("canvas", { id, type: "canvas" }); assert.equal(p.type, "canvas");
  const g = await api("GET", `/api/canvases/${id}`); assert.equal(g.status, 200); assert.deepEqual(Object.keys(g.json), ["pageId", "title", "data", "version", "rev", "updatedAt"]); assert.equal(g.json.version, 1);
  const data = { format: "spn-canvas-1", nodes: [{ id: "n1", kind: "text", x: 10, y: 20, w: 200, h: 80, z: 0, text: "Idée" }], edges: [], viewport: { x: 0, y: 0, zoom: 1 } };
  const put = await api("PUT", `/api/canvases/${id}`, { data, baseVersion: 1 }); assert.equal(put.status, 200, put.text); assert.deepEqual([put.json.version, put.json.unchanged], [2, false]);
  const stale = await api("PUT", `/api/canvases/${id}`, { data: { ...data, nodes: [] }, baseVersion: 1 }); assert.equal(stale.status, 409); assert.equal(stale.json.code, "conflict"); assert.equal(stale.json.server.version, 2); assert.equal(stale.json.server.data.nodes[0].text, "Idée");
  assert.equal((await api("PUT", `/api/canvases/${id}`, { data: { format: "x" }, baseVersion: 2 })).json.code, "bad_canvas"); assert.equal((await api("PUT", `/api/canvases/${id}`, { data })).status, 400, "baseVersion is required");
  const plain = await page("plain"); assert.equal((await api("GET", `/api/canvases/${plain.id}`)).json.code, "not_canvas");
  const feed = await api("GET", `/api/sync?kinds=canvas&since=${start}&limit=500`); assert.ok(feed.json.entities.canvas.some((c: any) => c.id === id && c.version === 2));
});
test("graph, relations, concepts, insights, events, time machine, health, brief, query and zoom answer over HTTP", async () => {
  const a = await page("G a", { content: { type: "doc", content: [{ type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Titre" }] }, { type: "paragraph", content: [{ type: "text", text: "Première phrase. Seconde." }] }] } }); const b = await page("G b");
  const rel = await api("POST", "/api/graph/relations", { fromId: a.id, toId: b.id, relType: "supports", note: "n" }); assert.equal(rel.status, 201, rel.text); assert.deepEqual([rel.json.origin, rel.json.status, rel.json.kind], ["user", "accepted", "relation"]);
  assert.equal((await api("POST", "/api/graph/relations", { fromId: a.id, toId: b.id, relType: "supports" })).status, 409); assert.equal((await api("POST", "/api/graph/relations", { fromId: a.id, toId: b.id, relType: "likes" })).status, 400);
  const list = await api("GET", `/api/graph/relations?nodeId=${a.id}`); assert.equal(list.json.relations.length, 1);
  assert.equal((await api("PATCH", `/api/graph/relations/${rel.json.id}`, { relType: "extends" })).json.relType, "extends");
  for (const v of ["global", "timeline", "concepts", "documents", "references"]) { const g = await api("GET", `/api/graph?view=${v}`); assert.equal(g.status, 200, v); assert.equal(g.json.view, v); assert.ok(Array.isArray(g.json.nodes) && Array.isArray(g.json.edges)); }
  const local = await api("GET", `/api/graph?view=local&pageId=${a.id}`); assert.equal(local.json.center, a.id); assert.ok(local.json.edges.some((e: any) => e.id === rel.json.id && e.kind === "typed" && e.relType === "extends"));
  assert.equal((await api("GET", `/api/graph?view=project&pageId=${a.id}`)).status, 200);
  const old = await api("GET", "/api/graph"); assert.deepEqual(Object.keys(old.json), ["nodes", "edges", "center", "stats"], "no view → the 2.x answer");
  const con = await api("POST", "/api/concepts", { name: `${PFX} concept ${randomUUID().slice(0, 8)}`, pageIds: [a.id] }); assert.equal(con.status, 201, con.text); assert.equal(con.json.pages, 1); assert.equal(con.json.pageLinks[0].pageId, a.id);
  assert.equal((await api("PATCH", "/api/concepts", { id: con.json.id, description: "d" })).json.description, "d"); assert.ok((await api("GET", "/api/concepts")).json.concepts.some((c: any) => c.id === con.json.id)); assert.equal((await api("DELETE", `/api/concepts/${con.json.id}`)).status, 200);
  const ins = await api("GET", "/api/graph/insights"); assert.equal(ins.status, 200); assert.deepEqual(Object.keys(ins.json), ["intelligence", "insights", "counts"]); assert.ok(ins.json.intelligence.centralPages.some((p: any) => p.id === b.id));
  const run = await api("POST", "/api/graph/insights/run", { mode: "deterministic" }); assert.equal(run.status, 200, run.text); assert.deepEqual([run.json.mode, run.json.queued, run.json.jobId], ["deterministic", false, null]); assert.ok(run.json.deterministic.considered >= 0);
  const ev = await api("GET", `/api/events?pageId=${a.id}`); assert.deepEqual(ev.json.events.map((e: any) => e.kind), ["relation.created", "page.created"]); assert.deepEqual(Object.keys(ev.json.events[0]), ["id", "at", "kind", "pageId", "pageTitle", "pageIcon", "entityKind", "entityId", "actor", "device", "summary", "data"]);
  const tm = await api("GET", `/api/timemachine?at=${encodeURIComponent(new Date().toISOString())}&pageId=${a.id}`); assert.equal(tm.status, 200); assert.equal(tm.json.pages[0].source, "current"); assert.ok(tm.json.pages[0].content); assert.equal(tm.json.relations[0].id, rel.json.id);
  assert.equal((await api("GET", "/api/health/knowledge")).status, 200); const brief = await api("GET", "/api/brief"); assert.equal(brief.status, 200); assert.ok(brief.json.recentNotes.length >= 1); assert.equal(brief.json.aiSummary === null || brief.json.aiSummary.ai === true, true);
  const q = await api("POST", "/api/query", { source: "pages", filter: { text: `${PFX} G` }, limit: 10 }); assert.equal(q.status, 200, q.text); assert.equal(q.json.total, 2); assert.equal((await api("POST", "/api/query", { source: "nope" })).status, 400);
  const z2 = await api("GET", `/api/pages/${a.id}/zoom?level=2`); assert.deepEqual(z2.json.sections.map((s: any) => [s.heading, s.firstSentence]), [["Titre", "Première phrase."]]); assert.equal((await api("GET", `/api/pages/${a.id}/zoom?level=3`)).json.content.type, "doc");
  const z1 = await api("GET", `/api/pages/${a.id}/zoom?level=1&cachedOnly=1`); /* cachedOnly: this suite never makes a paid model call */ assert.ok(z1.status === 200 || ["not_implemented", "ai_unavailable", "no_provider"].includes(z1.json.code) || z1.status >= 500, `zoom level 1 (AI synopsis, implemented by the AI workstream): ${z1.status}`);
  assert.equal((await api("DELETE", `/api/graph/relations/${rel.json.id}`)).status, 200); assert.equal((await api("GET", `/api/graph/relations/${rel.json.id}`)).status, 404);
});
test("parent cycles are refused over HTTP (409 cycle) and a restore by version id works", async () => {
  const start = (await api("GET", "/api/sync?since=0&limit=1")).json.head;
  const a = await page("cyc a"); const b = await page("cyc b", { parentId: a.id });
  const r = await api("PATCH", `/api/pages/${a.id}`, { parentId: b.id }); assert.deepEqual([r.status, r.json.code], [409, "cycle"]);
  const s1 = await api("PATCH", `/api/pages/${a.id}`, { content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "v2" }] }] }, baseVersion: 1 }); assert.equal(s1.status, 200);
  const versions = await api("GET", `/api/pages/${a.id}/versions`); assert.ok(versions.json.length >= 1); const v = versions.json[versions.json.length - 1];
  const stale = await api("POST", `/api/pages/${a.id}/versions/${v.id}/restore`, { baseVersion: 1 }); assert.equal(stale.status, 409, "refused when the page changed since baseVersion");
  const ok = await api("POST", `/api/pages/${a.id}/versions/${v.id}/restore`, { baseVersion: s1.json.version }); assert.deepEqual([ok.status, ok.json.ok, ok.json.restored], [200, true, v.version]);
  assert.equal((await api("POST", `/api/pages/${a.id}/versions/${randomUUID()}/restore`)).status, 404); assert.equal((await api("POST", `/api/pages/${a.id}/versions/abc/restore`)).status, 400);
  // a session made by scripts/dev-session.ts counts as freshly verified, so a purge passes here; with a real session older than 5 minutes it answers 403 reauth_required (unchanged from 2.x)
  assert.equal((await api("DELETE", `/api/pages/${b.id}`)).json.trashed, 1); const purge = await api("DELETE", `/api/pages/${b.id}?purge=1`); assert.equal(purge.status, 200); assert.equal((await api("GET", `/api/pages/${b.id}`)).status, 404);
  const tomb = await api("GET", `/api/sync?since=${start}&limit=500`); assert.ok(tomb.json.tombstones.some((t: any) => t.id === b.id && t.kind === "page"));
});
