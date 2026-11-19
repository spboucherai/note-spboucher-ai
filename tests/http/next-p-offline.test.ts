/**
 * HTTP-level checks of what the web offline-first layer relies on, against a RUNNING scratch instance (`pnpm test:http`):
 * the integrity route (new in 3.0), and the server guarantees the mutation journal is built on — a create replayed under the same
 * client id answers the stored row, a stale versioned save is refused with the server copy, an upload replayed under the same id is
 * stored once. The session is created directly in the scratch database — no passkey, never against production.
 */
import "../helpers/testdb";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { db, schema, sql } from "../../src/db/index";
import { createSession, ownerRow } from "../../src/lib/auth/sessions";
import { stableJson } from "../../src/lib/stable-json";

const BASE = (process.env.APP_URL ?? "").replace(/\/$/, ""); const PFX = "nx-p-offline ·"; const UA = "note-web-offline-http-test";
let cookie = ""; const pages: string[] = []; const tasks: string[] = []; const atts: string[] = [];
async function api(method: string, path: string, body?: unknown, extra: Record<string, string> = {}, anonymous = false) {
  const headers: Record<string, string> = { "user-agent": UA, ...extra }; if (!anonymous) headers.cookie = cookie; if (method !== "GET") headers.origin = BASE;
  let payload: any; if (body instanceof FormData) payload = body; else if (body !== undefined) { headers["content-type"] = "application/json"; payload = JSON.stringify(body); }
  const r = await fetch(BASE + path, { method, headers, body: payload, redirect: "manual" }); const text = await r.text(); let json: any = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: r.status, headers: r.headers, json };
}
const doc = (t: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: t }] }] });
before(async () => {
  const host = new URL(BASE).hostname; assert.ok(host === "localhost" || host === "127.0.0.1", "APP_URL must be loopback");
  assert.ok(await fetch(`${BASE}/api/health`).then((r) => r.ok, () => false), `no server on ${BASE}`);
  const u = await ownerRow(); assert.ok(u, "owner missing: pnpm run bootstrap"); const s = await createSession({ userId: u!.id, credentialId: null, userAgent: UA, ip: "127.0.0.1" });
  cookie = `__Host-note_session=${s.token}; note_session=${s.token}`;
});
after(async () => {
  if (tasks.length) await db.delete(schema.tasks).where(inArray(schema.tasks.id, tasks)); if (atts.length) await db.delete(schema.attachments).where(inArray(schema.attachments.id, atts));
  if (pages.length) { await db.delete(schema.knowledgeEvents).where(inArray(schema.knowledgeEvents.pageId, pages)); await db.delete(schema.pages).where(inArray(schema.pages.id, pages)); }
  await db.delete(schema.sessions).where(eq(schema.sessions.userAgent, UA)); await sql.end();
});

test("GET /api/sync/integrity: needs a session; one fingerprint per page, equal to sha256(canonical JSON of the content)", async () => {
  assert.equal((await api("GET", "/api/sync/integrity", undefined, {}, true)).status, 401);
  const start = (await api("GET", "/api/sync?since=0&limit=1&kinds=task")).json.head;
  const id = randomUUID(); pages.push(id); const content = doc("integrity é ✓");
  assert.equal((await api("POST", "/api/pages", { id, title: `${PFX} integrity`, content })).status, 201);
  const stored = (await api("GET", `/api/pages/${id}`)).json;
  const r = await api("GET", "/api/sync/integrity"); assert.equal(r.status, 200); assert.equal(r.json.algorithm, "sha256-stable-json-1"); assert.equal(r.json.count, r.json.pages.length);
  assert.match(r.headers.get("cache-control") ?? "", /no-store/);
  const mine = r.json.pages.find((p: any) => p.id === id); assert.ok(mine); assert.equal(mine.version, stored.version); assert.deepEqual(Object.keys(mine).sort(), ["hash", "id", "version"]);
  assert.equal(mine.hash, createHash("sha256").update(stableJson(stored.content)).digest("hex"));
  // the hash follows the content, and the feed delivers the same content the hash was computed from
  const up = await api("PATCH", `/api/pages/${id}`, { content: doc("changed"), baseVersion: stored.version }); assert.equal(up.status, 200);
  const again = (await api("GET", "/api/sync/integrity")).json.pages.find((p: any) => p.id === id); assert.notEqual(again.hash, mine.hash); assert.equal(again.version, up.json.version);
  const feed = (await api("GET", `/api/sync?since=${start}&limit=500&kinds=task`)).json; const row = feed.pages.find((p: any) => p.id === id);
  assert.ok(row, "the page is in the feed read from the cursor taken before it was created"); assert.equal(createHash("sha256").update(stableJson(row.content)).digest("hex"), again.hash);
});
test("journal guarantees: a replayed create answers the stored row; a stale versioned save is refused with the server copy", async () => {
  const id = randomUUID(); pages.push(id); const key = `k-${id}`;
  const a = await api("POST", "/api/pages", { id, title: `${PFX} created offline`, section: "notes" }, { "idempotency-key": key }); assert.equal(a.status, 201); assert.equal(a.json.id, id);
  const b = await api("POST", "/api/pages", { id, title: `${PFX} created offline`, section: "notes" }, { "idempotency-key": key }); assert.ok([200, 201].includes(b.status)); assert.equal(b.json.id, id); assert.equal(b.json.version, a.json.version);
  const c = await api("POST", "/api/pages", { id, title: `${PFX} other title` }); assert.equal(c.status, 200, "same id, other key: still the stored page"); assert.equal(c.headers.get("x-existing"), "1"); assert.equal(c.json.title, `${PFX} created offline`);
  const rows = await db.select({ id: schema.pages.id }).from(schema.pages).where(eq(schema.pages.id, id)); assert.equal(rows.length, 1);
  const ok = await api("PATCH", `/api/pages/${id}`, { content: doc("first"), baseVersion: a.json.version }); assert.equal(ok.status, 200);
  const stale = await api("PATCH", `/api/pages/${id}`, { content: doc("second, from an old base"), baseVersion: a.json.version }); assert.equal(stale.status, 409); assert.equal(stale.json.code, "conflict");
  assert.equal(stale.json.server.version, ok.json.version); assert.deepEqual(stale.json.server.content.content[0].content[0].text, "first");
  // unversioned metadata (pin / archive / move) does not need a base and does not disturb the text version check
  assert.equal((await api("PATCH", `/api/pages/${id}`, { pinned: true })).status, 200);
  assert.equal((await api("PUT", `/api/pages/${id}/tags`, { tags: ["offline", "journal"] })).status, 200);
  assert.equal((await api("DELETE", `/api/pages/${id}`)).status, 200); assert.equal((await api("POST", `/api/pages/${id}?action=restore`)).status, 200);
});
test("journal guarantees: tasks and uploads replayed under their client id are stored once", async () => {
  const pid = randomUUID(); pages.push(pid); await api("POST", "/api/pages", { id: pid, title: `${PFX} with task` });
  const tid = randomUUID(); tasks.push(tid);
  const t1 = await api("POST", "/api/tasks", { id: tid, title: `${PFX} task`, pageId: pid }); assert.equal(t1.status, 201);
  const t2 = await api("POST", "/api/tasks", { id: tid, title: `${PFX} task`, pageId: pid }); assert.equal(t2.status, 200); assert.equal(t2.headers.get("x-existing"), "1");
  assert.equal((await api("PATCH", `/api/tasks/${tid}`, { status: "done" })).json.status, "done"); assert.equal((await api("PATCH", `/api/tasks/${tid}`, { status: "done" })).status, 200, "completing twice is harmless");
  assert.equal((await db.select().from(schema.tasks).where(eq(schema.tasks.id, tid))).length, 1);
  const aid = randomUUID(); atts.push(aid); const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
  const form = () => { const f = new FormData(); f.append("id", aid); f.append("file", new File([png], "queued.png", { type: "image/png" })); f.append("pageId", pid); return f; };
  const u1 = await api("POST", "/api/attachments", form()); assert.ok([200, 201].includes(u1.status)); assert.equal(u1.json.id, aid);
  const u2 = await api("POST", "/api/attachments", form()); assert.equal(u2.status, 200); assert.equal(u2.headers.get("x-existing"), "1"); assert.equal(u2.json.id, aid);
  assert.equal((await db.select().from(schema.attachments).where(eq(schema.attachments.id, aid))).length, 1);
  const feed = (await api("GET", "/api/sync?since=0&limit=500&kinds=task")).json; assert.ok(Array.isArray(feed.entities.task)); assert.ok("cursor" in feed && "more" in feed);
});
