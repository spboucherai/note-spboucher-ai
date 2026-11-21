/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/app/api/jobs/route.ts
 * Module           : app
 * Repository       : https://git.spboucher.ai/note-spboucher-ai
 * Project Website  : https://note.spboucher.ai
 * Created          : 2026-11-17
 * Last Modified    : 2026-11-17
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

import { z } from "zod";
import { eq, sql as dsql } from "drizzle-orm";
import { handler, parseBody, HttpError } from "@/lib/api";
import { db, schema } from "@/db";
import { getBoss, QUEUES, DEAD_LETTER, QUEUE_POLICY } from "@/lib/jobs";
import { audit } from "@/lib/audit";
const NAMES = new Set<string>(Object.values(QUEUES));
/**
 * GET → background-work diagnostics: worker heartbeat, per-queue counts, jobs active for too long (stuck), recent failures with the
 * queue's error text, dead-letter size. Payloads are reduced to ids: note content never appears here.
 */
export const GET = handler(async ({ ws }) => {
  const [hb] = await db.select().from(schema.settings).where(eq(schema.settings.key, "worker.heartbeat"));
  const beat = hb?.value as { at?: string; pid?: number; version?: string } | undefined; const age = beat?.at ? Date.now() - new Date(beat.at).getTime() : null;
  let counts: any[] = [], failed: any[] = [], active: any[] = [], dead = 0;
  try {
    counts = (await db.execute(dsql`select name, state, count(*)::int as n from pgboss.job where name <> ${DEAD_LETTER} group by 1, 2`)) as any[];
    failed = (await db.execute(dsql`select id, name, data, output, completed_on, retry_count from pgboss.job where state = 'failed' and name <> ${DEAD_LETTER} and completed_on > now() - interval '7 days' order by completed_on desc limit 30`)) as any[];
    active = (await db.execute(dsql`select id, name, started_on, retry_count from pgboss.job where state = 'active' order by started_on asc limit 30`)) as any[];
    dead = Number(((await db.execute(dsql`select count(*)::int as n from pgboss.job where name = ${DEAD_LETTER} and state in ('created','retry')`)) as any[])[0]?.n ?? 0);
  } catch { /* queue tables not created yet */ }
  const mine = (d: any) => !d?.workspaceId || d.workspaceId === ws.id;
  const ref = (d: any) => ({ sourceType: d?.sourceType ?? null, sourceId: d?.sourceId ?? null, executionId: d?.executionId ?? null, jobId: d?.jobId ?? null, kind: d?.kind ?? null });
  return Response.json({
    worker: { alive: age !== null && age < 120_000, lastBeatAt: beat?.at ?? null, version: beat?.version ?? null },
    queues: Object.values(QUEUES).map((q) => ({ name: q, policy: QUEUE_POLICY[q] ? { retryLimit: QUEUE_POLICY[q].retryLimit, backoff: Boolean(QUEUE_POLICY[q].retryBackoff), expireInSeconds: QUEUE_POLICY[q].expireInSeconds } : null, ...Object.fromEntries(["created", "retry", "active", "completed", "failed"].map((s) => [s, counts.find((c) => c.name === q && c.state === s)?.n ?? 0])) })),
    stuck: active.filter((j) => Date.now() - new Date(j.started_on).getTime() > (QUEUE_POLICY[j.name]?.expireInSeconds ?? 900) * 1000).map((j) => ({ id: j.id, name: j.name, startedAt: j.started_on })),
    active: active.map((j) => ({ id: j.id, name: j.name, startedAt: j.started_on, attempt: (j.retry_count ?? 0) + 1 })),
    failed: failed.filter((j) => mine(j.data)).map((j) => ({ id: j.id, name: j.name, at: j.completed_on, attempts: (j.retry_count ?? 0) + 1, error: String(j.output?.message ?? j.output?.value ?? "failed").slice(0, 240), ...ref(j.data) })),
    deadLetter: dead,
  });
});
/** POST { action: "retry", name, id } → put a failed job back in its queue (explicit, audited — nothing is retried silently for paid or long work). */
export const POST = handler(async ({ req, user }) => {
  const b = await parseBody(req, z.object({ action: z.literal("retry"), name: z.string().max(64), id: z.string().uuid() }));
  if (!NAMES.has(b.name)) throw new HttpError(400, "Unknown queue");
  const boss = await getBoss(); const job = await boss.getJobById(b.name, b.id); if (!job) throw new HttpError(404, "Job not found");
  if ((job as any).state !== "failed") throw new HttpError(409, "Only failed jobs can be retried", "not_failed");
  await boss.retry(b.name, b.id); await audit(user.id, "jobs.retry", { type: "job", id: b.id }, { queue: b.name });
  return Response.json({ ok: true });
});
