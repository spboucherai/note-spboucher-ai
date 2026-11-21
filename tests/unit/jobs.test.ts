/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : tests/unit/jobs.test.ts
 * Module           : tests
 * Repository       : https://git.spboucher.ai/note-spboucher-ai
 * Project Website  : https://note.spboucher.ai
 * Created          : 2026-11-17
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
 * Background jobs: policy, de-duplication, retry → dead letter, orphaned job after a killed worker, timeout.
 * Uses throw-away queues (prefix t-) in the scratch database's pgboss schema.
 */
import "../helpers/testdb";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { PgBoss } from "pg-boss";
import { ensureQueues } from "../../src/lib/jobs/index";
import { QUEUES, QUEUE_POLICY, DEAD_LETTER } from "../../src/lib/jobs/queues";
import { wrap, withTimeout, safeSummary, JobTimeout } from "../../src/worker/run";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const until = async (fn: () => Promise<boolean>, ms: number) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await sleep(250); } return false; };
const mk = () => new PgBoss({ connectionString: process.env.DATABASE_URL!, schema: "pgboss", max: Math.max(1, Math.min(3, Number(process.env.DB_POOL_MAX ?? 3) || 3)), superviseIntervalSeconds: 1, monitorIntervalSeconds: 1, maintenanceIntervalSeconds: 1 } as any);
let boss: PgBoss; const tag = `t-${Date.now().toString(36)}`; const queues: string[] = [];
const q = async (name: string, opts: Record<string, unknown>) => { const n = `${tag}-${name}`; queues.push(n); await boss.createQueue(n, opts as any); return n; };
before(async () => { boss = mk(); boss.on("error", () => {}); await boss.start(); await ensureQueues(boss); });
after(async () => { for (const n of queues) await boss.deleteQueue(n).catch(() => {}); await boss.stop({ graceful: false, timeout: 2000 } as any).catch(() => {}); });

test("queue policy is applied: safe work retries with backoff, paid or long work does not", async () => {
  const idx = await boss.getQueue(QUEUES.index); assert.equal(idx?.retryLimit, 4); assert.equal(idx?.retryBackoff, true); assert.equal(idx?.deadLetter, DEAD_LETTER);
  for (const name of [QUEUES.agent, QUEUES.backup, QUEUES.suggestLinks]) assert.equal((await boss.getQueue(name))?.retryLimit, 0, name);
  for (const [name, p] of Object.entries(QUEUE_POLICY)) { assert.ok(p.timeoutMs < p.expireInSeconds * 1000, `${name}: in-process timeout must be below the expiry`); assert.equal((await boss.getQueue(name))?.expireInSeconds, p.expireInSeconds, name); }
});
test("the same singleton key cannot be queued twice in its window (no duplicate job)", async () => {
  const name = await q("dedupe", { retryLimit: 0 });
  const a = await boss.send(name, { n: 1 }, { singletonKey: "page:1", singletonSeconds: 60 }); const b = await boss.send(name, { n: 1 }, { singletonKey: "page:1", singletonSeconds: 60 }); const c = await boss.send(name, { n: 2 }, { singletonKey: "page:2", singletonSeconds: 60 });
  assert.ok(a); assert.equal(b, null); assert.ok(c);
});
test("throttled indexing is deferred to the next slot, never dropped (an edit right after an indexing still gets indexed)", async () => {
  const name = await q("slot", { retryLimit: 0 }); const o = { singletonKey: "page:9", singletonSeconds: 20, singletonNextSlot: true };
  const a = await boss.send(name, {}, o); const b = await boss.send(name, {}, o); const c = await boss.send(name, {}, o);
  assert.ok(a); assert.ok(b, "second send is scheduled for the next slot"); assert.equal(c, null, "a third one in the same window adds nothing");
  const jb = await boss.getJobById(name, b!); assert.ok(jb && new Date(jb.startAfter).getTime() > Date.now(), "the deferred job starts later");
});
test("a failing job is retried, then fails for good and is copied to the dead-letter queue", async () => {
  const dlq = await q("dead", { retryLimit: 0 }); const name = await q("fail", { retryLimit: 2, retryDelay: 1, deadLetter: dlq });
  let attempts = 0; await boss.work(name, { batchSize: 1, pollingIntervalSeconds: 0.5, includeMetadata: true } as any, wrap(name, async () => { attempts++; throw new Error("provider unreachable"); }, 5000) as any);
  const id = await boss.send(name, { sourceId: "x" }); assert.ok(id);
  assert.ok(await until(async () => (await boss.getJobById(name, id!))?.state === "failed", 25_000), "job ends in failed");
  assert.equal(attempts, 3, "1 try + 2 retries");
  assert.ok(await until(async () => (await boss.findJobs(dlq)).length === 1, 10_000), "dead-letter copy exists");
  await boss.offWork(name);
});
test("a job that succeeds on a later attempt is not lost and runs to completion once", async () => {
  const name = await q("flaky", { retryLimit: 3, retryDelay: 1 }); let attempts = 0, done = 0;
  await boss.work(name, { batchSize: 1, pollingIntervalSeconds: 0.5, includeMetadata: true } as any, wrap(name, async () => { if (++attempts < 2) throw new Error("network interrupted"); done++; return { indexed: 1 }; }, 5000) as any);
  const id = await boss.send(name, {});
  assert.ok(await until(async () => (await boss.getJobById(name, id!))?.state === "completed", 20_000)); assert.equal(done, 1); assert.equal(attempts, 2);
  await boss.offWork(name);
});
test("a job left active by a killed worker is released at expiry and picked up again", async () => {
  const name = await q("orphan", { retryLimit: 2, retryDelay: 1, expireInSeconds: 2 });
  const id = await boss.send(name, {}); const dead = mk(); dead.on("error", () => {}); await dead.start();
  const taken = await dead.fetch(name); assert.equal(taken.length, 1); // "worker" takes the job …
  await dead.stop({ graceful: false, timeout: 500 } as any).catch(() => {});       // … and dies without completing it
  let ran = 0; await boss.work(name, { batchSize: 1, pollingIntervalSeconds: 0.5, includeMetadata: true } as any, wrap(name, async () => { ran++; return { ok: true }; }, 5000) as any);
  assert.ok(await until(async () => (await boss.getJobById(name, id!))?.state === "completed", 40_000), "the orphaned job completes on the surviving worker"); assert.equal(ran, 1);
  await boss.offWork(name);
});
test("in-process timeout fails a job that hangs; log summaries never carry text", async () => {
  await assert.rejects(withTimeout(new Promise(() => {}), 50, "test"), JobTimeout);
  assert.equal(await withTimeout(Promise.resolve(7), 50, "test"), 7);
  assert.deepEqual(safeSummary({ indexed: 3, skipped: true, pageId: "7d3c2b1a-0000-4000-8000-000000000000", title: "My private note", message: "secret text" }), { indexed: 3, skipped: true, pageId: "7d3c2b1a-0000-4000-8000-000000000000" });
});
