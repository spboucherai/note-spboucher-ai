/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : tests/http/next-contract.test.ts
 * Description      : HTTP regression tests of the contract defects found by the
 *                    native client's live tests during the 3.0 integration
 *                    (BACKEND-DEFECTS-FROM-CORE): every error carries a stable
 *                    `code`, DELETE is idempotent, a bare filter rule is
 *                    honoured, lists are capped by `limit`, no raw PostgreSQL
 *                    value leaks, a trashed database is trashed in the feed,
 *                    bare dates are stored at 12:00 UTC, the time machine says
 *                    "did not exist", a deleted reference is not resurrected,
 *                    /api/health and /api/meta agree on the version. Against a
 *                    RUNNING scratch instance (`pnpm test:http`). No model is
 *                    ever called. Everything created is removed in `after`.
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

import "../helpers/testdb";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import { and, eq, inArray, like } from "drizzle-orm";
import { db, schema, sql } from "../../src/db/index";
import { createSession, ownerRow } from "../../src/lib/auth/sessions";

const BASE = (process.env.APP_URL ?? "").replace(/\/$/, ""); const PFX = "nx-contract ·"; const UA = "SPNotes/3.0.0 (Macintosh; Mac OS X 27.0) nx-contract-tests";
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
let cookie = ""; let ws = ""; const pages: string[] = []; const tasks: string[] = []; const refs: string[] = []; const concepts: string[] = []; const insights: string[] = [];
type Res = { status: number; headers: Headers; json: any; text: string };
async function api(method: string, path: string, body?: unknown): Promise<Res> {
  const headers: Record<string, string> = { "user-agent": UA, cookie }; if (method !== "GET") headers.origin = BASE; if (body !== undefined) headers["content-type"] = "application/json";
  const r = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual" }); const text = await r.text();
  let json: any = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: r.status, headers: r.headers, json, text };
}
const page = async (title: string, extra: Record<string, unknown> = {}) => { const r = await api("POST", "/api/pages", { title: `${PFX} ${title}`, ...extra }); assert.equal(r.status, 201, r.text); pages.push(r.json.id); return r.json; };
/** A database with a number property and three rows (1, 2, 3). */
async function database() {
  const host = await page("db", { type: "database", section: "databases" }); const d = await api("GET", `/api/databases/${host.id}`); assert.equal(d.status, 200, d.text);
  const prop = await api("POST", `/api/databases/${host.id}/properties`, { name: "Score", type: "number" }); assert.equal(prop.status, 201, prop.text);
  for (const n of [1, 2, 3]) { const r = await api("POST", `/api/databases/${host.id}/rows`, { title: `${PFX} row ${n}`, values: { [prop.json.id]: n } }); assert.ok(r.status < 300, r.text); }
  return { host, id: d.json.id as string, prop: prop.json.id as string };
}

before(async () => {
  const host = new URL(BASE).hostname; assert.ok(host === "localhost" || host === "127.0.0.1", "APP_URL must be loopback");
  assert.ok(await fetch(`${BASE}/api/health`).then((r) => r.ok, () => false), `no server on ${BASE}`);
  const u = await ownerRow(); assert.ok(u, "owner missing: pnpm run bootstrap"); const s = await createSession({ userId: u!.id, credentialId: null, userAgent: UA, ip: "127.0.0.1" });
  cookie = `__Host-note_session=${s.token}; note_session=${s.token}`; const [w] = await db.select().from(schema.workspaces).limit(1); ws = w.id;
});
after(async () => {
  const mine = await db.select({ id: schema.pages.id }).from(schema.pages).where(and(eq(schema.pages.workspaceId, ws), like(schema.pages.title, `${PFX}%`))); const ids = [...new Set([...pages, ...mine.map((m) => m.id)])];
  if (tasks.length) await db.delete(schema.tasks).where(inArray(schema.tasks.id, tasks));
  if (refs.length) await db.delete(schema.researchReferences).where(inArray(schema.researchReferences.id, refs));
  if (concepts.length) await db.delete(schema.concepts).where(inArray(schema.concepts.id, concepts));
  if (insights.length) await db.delete(schema.knowledgeInsights).where(inArray(schema.knowledgeInsights.id, insights));
  if (ids.length) {
    await db.delete(schema.tasks).where(inArray(schema.tasks.pageId, ids)); await db.delete(schema.knowledgeEdges).where(inArray(schema.knowledgeEdges.fromId, ids));
    const dbs = await db.select({ id: schema.databases.id }).from(schema.databases).where(inArray(schema.databases.pageId, ids));
    if (dbs.length) await db.delete(schema.pages).where(inArray(schema.pages.databaseId, dbs.map((d) => d.id)));
    await db.delete(schema.pages).where(inArray(schema.pages.id, ids)); await db.delete(schema.knowledgeEvents).where(inArray(schema.knowledgeEvents.pageId, ids));
  }
  await db.delete(schema.pages).where(and(eq(schema.pages.workspaceId, ws), like(schema.pages.title, `${PFX}%`)));
  await db.delete(schema.sessions).where(eq(schema.sessions.userAgent, UA)); await sql.end();
});

test("every error answer carries a stable `code` (defect 7)", async () => {
  const R = randomUUID(); const p = await page("codes");
  const cases: [string, string, unknown, number, string][] = [
    ["GET", `/api/events?projectId=${R}`, undefined, 404, "not_found"], ["GET", `/api/pages/${R}/zoom`, undefined, 404, "not_found"], ["GET", `/api/pages/${R}`, undefined, 404, "not_found"],
    ["POST", "/api/query", { source: "database", databaseId: R }, 404, "not_found"], ["GET", `/api/databases/${R}`, undefined, 404, "not_found"], ["POST", `/api/databases/${R}/query`, {}, 404, "not_found"],
    ["PATCH", `/api/databases/${R}`, { name: "x" }, 404, "not_found"], ["DELETE", `/api/databases/${R}/views?id=${R}`, undefined, 404, "not_found"], ["DELETE", `/api/databases/${R}/rows?id=${R}`, undefined, 404, "not_found"],
    ["PATCH", `/api/pages/${p.id}`, { parentId: p.id }, 400, "bad_request"], ["POST", "/api/pages", { title: 5 }, 400, "bad_request"], ["GET", "/api/research/tasks", undefined, 400, "bad_request"],
    ["GET", `/api/research/references/${R}`, undefined, 404, "not_found"], ["GET", `/api/tasks/${R}`, undefined, 404, "not_found"], ["GET", `/api/canvases/${R}`, undefined, 404, "not_found"],
  ];
  for (const [m, path, body, status, code] of cases) { const r = await api(m, path, body); assert.deepEqual([r.status, r.json?.code], [status, code], `${m} ${path} → ${r.text.slice(0, 160)}`); assert.equal(typeof r.json.error, "string"); }
  // invalid JSON body, and without a session
  const bad = await fetch(`${BASE}/api/pages`, { method: "POST", headers: { cookie, origin: BASE, "content-type": "application/json", "user-agent": UA }, body: "{nope" }); assert.equal(bad.status, 400); assert.equal((await bad.json()).code, "bad_request");
  const anon = await fetch(`${BASE}/api/brief`); assert.equal(anon.status, 401); assert.equal((await anon.json()).code, "unauthenticated");
  // extras the documentation promises
  const same = await api("POST", "/api/graph/relations", { fromId: p.id, toId: p.id, relType: "supports" }); assert.deepEqual([same.status, same.json.code, same.json.field], [400, "bad_node", "toId"]);
  const unknownNode = await api("POST", "/api/graph/relations", { fromId: p.id, toId: R, relType: "supports" }); assert.deepEqual([unknownNode.json.code, unknownNode.json.field], ["bad_node", "toId"]);
  const c1 = await api("POST", "/api/concepts", { name: `${PFX} one ${R.slice(0, 6)}` }); const c2 = await api("POST", "/api/concepts", { name: `${PFX} two ${R.slice(0, 6)}` }); concepts.push(c1.json.id, c2.json.id);
  const clash = await api("PATCH", "/api/concepts", { id: c2.json.id, name: c1.json.name }); assert.deepEqual([clash.status, clash.json.code, clash.json.id, clash.json.status], [409, "concept_exists", c1.json.id, c1.json.status]);
  const clash2 = await api("PATCH", `/api/concepts/${c2.json.id}`, { name: c1.json.name.toUpperCase() }); assert.deepEqual([clash2.status, clash2.json.code, clash2.json.status], [409, "concept_exists", c1.json.status]);
});

test("DELETE is idempotent: the second call and an unknown id answer the same 200 (defect 8)", async () => {
  const R = randomUUID(); const a = await page("del a"); const b = await page("del b");
  const rel = await api("POST", "/api/graph/relations", { fromId: a.id, toId: b.id, relType: "supports" }); assert.equal(rel.status, 201, rel.text);
  for (let i = 0; i < 2; i++) { const d = await api("DELETE", `/api/graph/relations/${rel.json.id}`); assert.deepEqual([d.status, d.json], [200, { ok: true }], `relation, call ${i + 1}`); }
  assert.deepEqual((await api("DELETE", `/api/graph/relations/${R}`)).json, { ok: true });
  assert.equal((await api("GET", `/api/events?pageId=${a.id}&kinds=relation.removed`)).json.events.length, 1, "one event: the second DELETE wrote nothing");
  const con = await api("POST", "/api/concepts", { name: `${PFX} del ${R.slice(0, 6)}` }); concepts.push(con.json.id);
  for (let i = 0; i < 2; i++) { const d = await api("DELETE", `/api/concepts/${con.json.id}`); assert.deepEqual([d.status, d.json], [200, { ok: true }], `concept, call ${i + 1}`); }
  assert.equal((await api("DELETE", `/api/concepts/${R}`)).status, 200);
  const t = await api("POST", "/api/tasks", { title: `${PFX} del` }); tasks.push(t.json.id);
  assert.deepEqual((await api("DELETE", `/api/tasks/${t.json.id}`)).json, { ok: true, deleted: true }); assert.deepEqual((await api("DELETE", `/api/tasks/${t.json.id}`)).json, { ok: true, deleted: false });
  assert.deepEqual([(await api("DELETE", `/api/tasks/${R}`)).status, (await api("DELETE", `/api/research/tasks/${R}`)).status, (await api("DELETE", `/api/research/references/${R}`)).status, (await api("DELETE", `/api/research/experiments/${R}`)).status, (await api("DELETE", `/api/attachments?id=${R}`)).status], [200, 200, 200, 200, 200]);
  // inside an existing database: unknown view / property / row / row template → 200; the database itself unknown → 404 (the container is missing)
  const d = await database();
  for (const sub of ["views", "properties", "rows", "row-templates"]) { const r = await api("DELETE", `/api/databases/${d.id}/${sub}?id=${R}`); assert.equal(r.status, 200, `${sub}: ${r.text}`); assert.equal(r.json.ok, true); }
  assert.equal((await api("DELETE", `/api/databases/${R}/properties?id=${R}`)).status, 404);
  // a derived edge is still refused (it exists and cannot be deleted this way) — covered by the unit suite; a malformed id is still 400
  assert.equal((await api("DELETE", "/api/concepts/not-a-uuid")).status, 400);
});

test("database query: a bare rule as `filter` is honoured, nonsense is refused, never ignored (defect 3)", async () => {
  const d = await database(); const rule = { property: d.prop, op: "gt", value: 1 };
  const all = await api("POST", `/api/databases/${d.id}/query`, {}); assert.equal(all.json.total, 3);
  const bare = await api("POST", `/api/databases/${d.id}/query`, { filter: rule }); assert.equal(bare.status, 200, bare.text); assert.equal(bare.json.total, 2, "the bare rule filters");
  const grouped = await api("POST", `/api/databases/${d.id}/query`, { filter: { and: [rule] } }); assert.equal(grouped.json.total, 2);
  assert.equal((await api("POST", `/api/databases/${d.id}/query`, { extraFilter: rule })).json.total, 2);
  assert.equal((await api("POST", `/api/databases/${d.id}/query`, { filter: {} })).json.total, 3); assert.equal((await api("POST", `/api/databases/${d.id}/query`, { filter: null })).json.total, 3);
  for (const f of [{ foo: 1 }, "x", [rule], { and: [rule], property: d.prop }, { property: d.prop }, { property: "nope", op: "gt", value: 1 }, { property: d.prop, op: "nope" }]) {
    const r = await api("POST", `/api/databases/${d.id}/query`, { filter: f }); assert.deepEqual([r.status, r.json.code], [400, "bad_filter"], JSON.stringify(f));
  }
  // the same rule for a bulk selection: a bare rule must not turn "the matching rows" into "every row"
  const bulk = await api("POST", `/api/databases/${d.id}/rows/bulk`, { action: "delete", all: { filter: { property: d.prop, op: "gt", value: 2 } } }); assert.equal(bulk.status, 200, bulk.text);
  assert.equal((await api("POST", `/api/databases/${d.id}/query`, {})).json.total, 2, "one row deleted, not three");
  assert.equal((await api("POST", `/api/databases/${d.id}/rows/bulk`, { action: "delete", all: { filter: { foo: 1 } } })).json.code, "bad_filter");
});

test("change feed: reset answer has one empty list per kind; a trashed database is trashed in the feed and comes back on restore (defects 4, 11)", async () => {
  const head = (await api("GET", "/api/sync?kinds=all&since=0&limit=1")).json.head as number;
  const reset = await api("GET", `/api/sync?kinds=all&since=${head + 10_000_000}`); assert.equal(reset.json.reset, true);
  assert.deepEqual(reset.json.entities, { task: [], database: [], database_property: [], database_view: [], database_row: [], edge: [], reference: [], canvas: [], concept: [] });
  assert.equal("entities" in (await api("GET", `/api/sync?since=${head + 10_000_000}`)).json, false, "2.x reset answer unchanged");
  const d = await database(); const start = (await api("GET", "/api/sync?kinds=database&since=0&limit=1")).json.head as number;
  assert.equal((await api("DELETE", `/api/pages/${d.host.id}`)).status, 200);
  const trashed = (await api("GET", `/api/sync?kinds=database&since=${start}&limit=500`)).json; const row = trashed.entities.database.find((x: any) => x.id === d.id);
  assert.ok(row, "the database row is in the feed after its host page was trashed"); assert.match(row.deletedAt, ISO); assert.ok(row.rev > start);
  assert.equal(trashed.pages.find((x: any) => x.id === d.host.id).deletedAt, row.deletedAt, "same instant as its host page");
  assert.equal((await api("POST", `/api/pages/${d.host.id}?action=restore`)).status, 200);
  const back = (await api("GET", `/api/sync?kinds=database&since=${row.rev}&limit=500`)).json.entities.database.find((x: any) => x.id === d.id); assert.ok(back); assert.equal(back.deletedAt, null); assert.ok(back.rev > row.rev);
});

test("lists are capped by `limit`; out-of-range values are clamped and the applied value is visible (defect 9)", async () => {
  for (let i = 0; i < 3; i++) { const [r] = await db.insert(schema.knowledgeInsights).values({ workspaceId: ws, kind: "open_question", status: "suggested", title: `${PFX} insight ${i}`, detail: "", data: {}, origin: "system", fingerprint: `nx-contract-${randomUUID()}` }).returning({ id: schema.knowledgeInsights.id }); insights.push(r.id); }
  const two = await api("GET", "/api/graph/insights?limit=2&intelligence=0"); assert.equal(two.status, 200); assert.equal(two.json.insights.length, 2, "limit caps `insights`"); assert.ok(two.json.counts.suggested >= 3, "counts are not capped");
  const zero = await api("GET", "/api/graph/insights?limit=0&intelligence=0"); assert.equal(zero.status, 200); assert.equal(zero.json.insights.length, 1, "limit=0 is clamped to 1");
  assert.ok((await api("GET", "/api/graph/insights?intelligence=0")).json.insights.length >= 3);
  const intel = await api("GET", "/api/graph/insights?limit=1"); for (const k of ["centralPages", "centralConcepts", "clusters", "recurringTopics"]) assert.ok(intel.json.intelligence[k].length <= 1, k);
  assert.equal((await api("GET", "/api/graph/insights?limit=abc")).json.code, "bad_request");
  assert.equal((await api("GET", "/api/health/knowledge?inactiveDays=0")).json.inactiveDays, 1, "clamped to the minimum, and echoed"); assert.equal((await api("GET", "/api/health/knowledge?inactiveDays=9999")).json.inactiveDays, 3650);
});

test("no raw PostgreSQL value: dates are ISO-8601 UTC, counts are JSON numbers (defect 10); search default mode is the 2.x quick search", async () => {
  await page("values needle");
  for (const path of ["/api/search?q=nx-contract&mode=quick", "/api/search?q=nx-contract", "/api/search?mode=quick&q="]) {
    const r = await api("GET", path); assert.equal(r.status, 200); assert.ok(Array.isArray(r.json) && r.json.length >= 1, path);
    assert.deepEqual(Object.keys(r.json[0]), ["id", "title", "icon", "type", "section", "updatedAt"], "quick-search row (also the answer when `mode` is absent, as in 2.x)"); for (const row of r.json) assert.match(row.updatedAt, ISO, path);
  }
  const usage = (await api("GET", "/api/ai/usage?days=90")).json;
  for (const m of usage.byModel) for (const k of ["calls", "errors", "inputTokens", "outputTokens", "costUsd"]) assert.equal(typeof m[k], "number", `byModel.${k}`);
  for (const d of usage.byDay) { assert.equal(typeof d.calls, "number"); assert.equal(typeof d.costUsd, "number"); } for (const t of usage.byTask) { assert.equal(typeof t.calls, "number"); assert.equal(typeof t.costUsd, "number"); }
  const idx = (await api("GET", "/api/search/index-state")).json;
  for (const k of ["pages", "attachments", "chunks", "embedded", "indexed_sources", "stale"]) assert.equal(typeof idx[k], "number", k); assert.ok(idx.last_indexed === null || ISO.test(idx.last_indexed));
  for (const p of idx.health.pending) assert.match(p.updatedAt, ISO); for (const f of idx.health.failed) assert.match(f.at, ISO);
  const health = await fetch(`${BASE}/api/health`).then((r) => r.json()); assert.match(health.time, ISO);
  const meta = (await api("GET", "/api/meta")).json; assert.equal(health.version, meta.version, "/api/health and /api/meta report the same version"); assert.match(health.version, /^3\./);
});

test("bare dates are stored at 12:00 UTC by both task routes (defect 12); the time machine says a page did not exist yet (defect 13)", async () => {
  const p = await page("dates");
  const rt = await api("POST", "/api/research/tasks", { pageId: p.id, title: `${PFX} research due`, dueAt: "2026-12-05" }); assert.equal(rt.status, 201, rt.text); tasks.push(rt.json.id);
  const t = await api("POST", "/api/tasks", { title: `${PFX} due`, due: "2026-12-05" }); tasks.push(t.json.id);
  assert.equal(rt.json.dueAt, "2026-12-05T12:00:00.000Z"); assert.equal(t.json.dueAt, rt.json.dueAt, "one rule for a bare date");
  assert.equal((await api("PATCH", `/api/research/tasks/${rt.json.id}`, { dueAt: "2026-12-06" })).json.dueAt, "2026-12-06T12:00:00.000Z");
  assert.equal((await api("PATCH", `/api/research/tasks/${rt.json.id}`, { dueAt: "2026-12-06T08:30:00-05:00" })).json.dueAt, "2026-12-06T13:30:00.000Z", "a datetime with offset is kept");
  const bad = await api("POST", "/api/research/tasks", { pageId: p.id, title: `${PFX} bad`, dueAt: "tomorrow" }); assert.deepEqual([bad.status, bad.json.code], [400, "bad_request"]);
  const tm = await api("GET", `/api/timemachine?at=2020-01-01T00:00:00Z&pageId=${p.id}`); assert.equal(tm.status, 200); const s = tm.json.pages[0];
  assert.deepEqual([s.existed, s.source, s.exact, s.version, s.versionId], [false, "none", false, null, null]); assert.equal("content" in s, false);
  const now = (await api("GET", `/api/timemachine?at=${encodeURIComponent(new Date().toISOString())}&pageId=${p.id}`)).json.pages[0]; assert.deepEqual([now.existed, now.source, now.exact], [true, "current", true]);
});

test("references: client id replay answers the stored row (200 + x-existing), a deleted one is not resurrected (409), ids= / projectId= (defects 6, 14)", async () => {
  const id = randomUUID(); refs.push(id); const project = await page("refs project", { section: "projects" });
  const first = await api("POST", "/api/research/references", { id, title: `${PFX} ref`, authors: ["Boucher, S.-P."], year: 2026, pageId: project.id }); assert.equal(first.status, 201, first.text); assert.equal(first.headers.get("x-existing"), null);
  const again = await api("POST", "/api/research/references", { id, title: `${PFX} another title` }); assert.equal(again.status, 200); assert.equal(again.headers.get("x-existing"), "1"); assert.equal(again.json.title, `${PFX} ref`, "the stored row, untouched");
  const R = randomUUID(); const list = await api("GET", `/api/research/references?ids=${id},${R}`); assert.equal(list.status, 200); assert.deepEqual(list.json.map((r: any) => r.id), [id]); assert.equal(list.headers.get("x-missing-ids"), R);
  assert.equal(typeof list.json[0].label, "string"); assert.equal(typeof list.json[0].citation, "string");
  assert.ok((await api("GET", `/api/research/references?projectId=${project.id}`)).json.some((r: any) => r.id === id));
  assert.equal((await api("GET", "/api/research/references?ids=abc")).status, 400);
  assert.equal((await api("DELETE", `/api/research/references/${id}`)).status, 200);
  const dead = await api("POST", "/api/research/references", { id, title: `${PFX} ref` }); assert.deepEqual([dead.status, dead.json.code, dead.json.id], [409, "reference_deleted", id]); assert.match(dead.json.deletedAt, ISO);
  assert.equal((await api("GET", `/api/research/references?ids=${id}`)).headers.get("x-missing-ids"), id, "a deleted reference is missing");
  assert.equal((await api("POST", `/api/research/references/${id}?action=restore`)).status, 200); assert.equal((await api("POST", "/api/research/references", { id, title: "x" })).status, 200);
});

test("capture kinds screenshot / selection / document are accepted (defect 5); the brief never serves a summary nobody asked for", async () => {
  for (const kind of ["screenshot", "selection", "document"]) {
    const r = await api("POST", "/api/capture", { kind, text: `${PFX} captured ${kind}` }); assert.equal(r.status, 201, `${kind}: ${r.text}`); pages.push(r.json.id); assert.equal(r.json.kind, kind); assert.match(r.json.inboxAt, ISO);
    assert.equal((await api("GET", `/api/pages/${r.json.id}`)).json.captureKind, kind);
  }
  assert.equal((await api("POST", "/api/capture", { kind: "hologram", text: "x" })).status, 400);
  const before = await db.select().from(schema.settings).where(eq(schema.settings.key, `brief.summary:${ws}`));
  const brief = (await api("GET", "/api/brief")).json; const s = brief.aiSummary;
  if (!before.length) assert.equal(s, null, "no stored summary → aiSummary is null: GET /api/brief never calls a model");
  else { assert.equal(s.ai, true); assert.equal(typeof s.model, "string"); assert.match(s.at, ISO); assert.doesNotMatch(s.model, /^fake/, "a test fixture must not be left in the scratch workspace"); }
  assert.deepEqual((await db.select().from(schema.settings).where(eq(schema.settings.key, `brief.summary:${ws}`))).length, before.length, "reading the brief stores nothing");
});

test("every mutating method of every route.ts refuses a signed-in request without (or with a foreign) Origin: 403 csrf", async () => {
  const PUBLIC = new Set(["/api/health", "/api/auth/login/options", "/api/auth/login/verify", "/api/auth/enroll/options", "/api/auth/enroll/verify", "/api/auth/logout"]);
  const found: [string, string][] = []; const unwrapped: string[] = [];
  const walk = (d: string) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (e.isDirectory()) walk(`${d}/${e.name}`); else if (e.name === "route.ts") {
    const route = d.replace("src/app", "").replace(/\[[^\]]+\]/g, "00000000-0000-4000-8000-000000000000"); const src = fs.readFileSync(`${d}/route.ts`, "utf8");
    for (const m of src.matchAll(/^export (?:const|async function) (GET|POST|PUT|PATCH|DELETE)\b(.*)$/gm)) { if (PUBLIC.has(route)) continue; if (!/=\s*handler\(/.test(m[2])) unwrapped.push(`${m[1]} ${route}`); if (m[1] !== "GET") found.push([m[1], route]); }
  } } };
  walk("src/app/api");
  assert.deepEqual(unwrapped, [], "every non-public route method goes through the authenticated `handler` wrapper"); assert.ok(found.length > 100, `walked ${found.length} mutating methods`);
  const raw = (method: string, path: string, headers: Record<string, string>) => new Promise<{ status: number; json: any }>((resolve, reject) => {
    const u = new URL(BASE + path); const data = "{}"; const req = http.request({ host: u.hostname, port: u.port, path: u.pathname, method, headers: { "content-type": "application/json", "content-length": Buffer.byteLength(data), "user-agent": UA, cookie, ...headers } }, (res) => { let t = ""; res.on("data", (c) => (t += c)); res.on("end", () => { let json: any = null; try { json = JSON.parse(t); } catch { /* */ } resolve({ status: res.statusCode ?? 0, json }); }); });
    req.on("error", reject); req.end(data);
  });
  for (const [method, route] of found) {
    const none = await raw(method, route, {}); assert.deepEqual([none.status, none.json?.code], [403, "csrf"], `${method} ${route} without Origin`);
    const foreign = await raw(method, route, { origin: "https://evil.example" }); assert.deepEqual([foreign.status, foreign.json?.code], [403, "csrf"], `${method} ${route} with a foreign Origin`);
  }
});

test("offline-first capture through POST /api/pages: inboxAt | inbox + captureKind land in the server inbox, idempotent on id, in the feed, journaled", async () => {
  const start = (await api("GET", "/api/sync?since=0&limit=1")).json.head as number; const id = randomUUID(); pages.push(id); const at = "2026-11-19T14:05:06.000Z";
  const first = await api("POST", "/api/pages", { id, title: `${PFX} captured offline`, inboxAt: at, captureKind: "selection", content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "typed in the tunnel" }] }] } });
  assert.equal(first.status, 201, first.text); assert.deepEqual([first.json.inboxAt, first.json.captureKind], [at, "selection"]);
  const again = await api("POST", "/api/pages", { id, title: "other", inbox: true, captureKind: "link" }); assert.equal(again.status, 200); assert.equal(again.headers.get("x-existing"), "1"); assert.deepEqual([again.json.inboxAt, again.json.captureKind, again.json.title], [at, "selection", `${PFX} captured offline`]);
  assert.ok((await api("GET", "/api/inbox")).text.includes(id), "listed by the inbox");
  const row = (await api("GET", `/api/sync?since=${start}&limit=500`)).json.pages.find((p: any) => p.id === id); assert.deepEqual([row.inboxAt, row.captureKind], [at, "selection"]);
  assert.deepEqual((await api("GET", `/api/events?pageId=${id}`)).json.events.map((e: any) => e.kind).sort(), ["capture.created", "page.created"]);
  const now = await api("POST", "/api/pages", { title: `${PFX} inbox true`, inbox: true }); pages.push(now.json.id); assert.match(now.json.inboxAt, ISO); assert.equal(now.json.captureKind, "note");
  const kindOnly = await api("POST", "/api/pages", { title: `${PFX} kind only`, captureKind: "voice-memo" }); pages.push(kindOnly.json.id); assert.match(kindOnly.json.inboxAt, ISO); assert.equal(kindOnly.json.captureKind, "voice-memo", "open string");
  const plain = await api("POST", "/api/pages", { title: `${PFX} plain` }); pages.push(plain.json.id); assert.deepEqual([plain.json.inboxAt, plain.json.captureKind], [null, null]); assert.deepEqual((await api("GET", `/api/events?pageId=${plain.json.id}`)).json.events.map((e: any) => e.kind), ["page.created"]);
  assert.deepEqual([(await api("POST", "/api/pages", { title: "x", inboxAt: "yesterday" })).json.code, (await api("POST", "/api/pages", { title: "x", captureKind: "k".repeat(33) })).status], ["bad_request", 400]);
});

test("universal links: the app-site association keeps webcredentials and hands /p/* to the iOS app", async () => {
  const r = await fetch(`${BASE}/.well-known/apple-app-site-association`); assert.equal(r.status, 200); assert.match(r.headers.get("content-type") ?? "", /json/); const j = await r.json();
  assert.deepEqual(j.webcredentials, { apps: ["3YM54G49SN.ai.spboucher.spnotes", "3YM54G49SN.ai.spboucher.spnotes.ios"] });
  assert.deepEqual(j.applinks, { details: [{ appIDs: ["3YM54G49SN.ai.spboucher.spnotes.ios"], components: [{ "/": "/p/*", comment: "a page, optional #blockId" }] }] });
});
