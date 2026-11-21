/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : tests/http/next-k-api.test.ts
 * Description      : HTTP-level checks of the route added by the
 *                    knowledge-screens workstream, against a RUNNING scratch
 *                    instance: GET /api/graph/constellation (auth, shape, cache
 *                    flag, refresh) and the `constellation` feature flag of GET
 *                    /api/meta. The session is created directly in the scratch
 *                    database — never against production.
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
import { eq } from "drizzle-orm";
import { db, schema, sql } from "../../src/db/index";
import { createSession, ownerRow } from "../../src/lib/auth/sessions";

const BASE = (process.env.APP_URL ?? "").replace(/\/$/, ""); const UA = "SPNotes/2.0.0 (Macintosh; Mac OS X 27.0) next-k"; let cookie = "";
const get = async (path: string, anonymous = false) => { const r = await fetch(BASE + path, { headers: { "user-agent": UA, ...(anonymous ? {} : { cookie }) }, redirect: "manual" }); return { status: r.status, headers: r.headers, json: await r.json().catch(() => null) }; };
before(async () => {
  const host = new URL(BASE).hostname; assert.ok(host === "localhost" || host === "127.0.0.1", "APP_URL must be loopback");
  assert.ok(await fetch(`${BASE}/api/health`).then((r) => r.ok, () => false), `no server on ${BASE}`);
  const u = await ownerRow(); assert.ok(u); const s = await createSession({ userId: u!.id, credentialId: null, userAgent: UA, ip: "127.0.0.1" }); cookie = `__Host-note_session=${s.token}; note_session=${s.token}`;
});
after(async () => { await db.delete(schema.sessions).where(eq(schema.sessions.userAgent, UA)); await sql.end(); });

test("GET /api/graph/constellation: needs a session; shape, honest counts, cache flag; meta announces the feature", async () => {
  const anon = await get("/api/graph/constellation", true); assert.equal(anon.status, 401); assert.equal(anon.json.code, "unauthenticated");
  const r = await get("/api/graph/constellation?refresh=1"); assert.equal(r.status, 200); assert.match(r.headers.get("cache-control") ?? "", /no-store/); const c = r.json;
  for (const k of ["model", "computedAt", "cached", "signature", "explained", "stats", "points", "clusters", "links", "projects", "tags"]) assert.ok(k in c, `key ${k}`);
  assert.equal(c.model, "text-embedding-3-small"); assert.equal(c.stats.shown, c.points.length); assert.ok(c.stats.embedded <= c.stats.pages); assert.equal(c.cached, false);
  if (c.stats.embedded === 0) { assert.deepEqual(c.points, []); assert.equal(c.computedAt, null); assert.equal(c.signature, null); }
  else {
    for (const p of c.points) { assert.match(p.id, /^[0-9a-f-]{36}$/); assert.ok(Math.abs(p.x) <= 1.05 && Math.abs(p.y) <= 1.05); assert.ok(p.cluster >= 0 && p.cluster < c.clusters.length); assert.ok(Array.isArray(p.tags)); }
    assert.equal(c.clusters.reduce((s: number, k: any) => s + k.size, 0), c.points.length); const ids = new Set(c.points.map((p: any) => p.id)); for (const l of c.links) assert.ok(ids.has(l.source) && ids.has(l.target));
    const again = await get("/api/graph/constellation"); assert.equal(again.json.cached, true); assert.equal(again.json.signature, c.signature); assert.deepEqual(again.json.points.map((p: any) => [p.id, p.x, p.y]), c.points.map((p: any) => [p.id, p.x, p.y]));
  }
  const meta = await get("/api/meta"); assert.ok(meta.json.features.includes("constellation")); assert.ok(meta.json.features.includes("graph-v2"), "existing flags are untouched");
});
