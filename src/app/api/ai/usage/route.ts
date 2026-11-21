/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/app/api/ai/usage/route.ts
 * Module           : app
 * Repository       : https://git.spboucher.ai/note-spboucher-ai
 * Project Website  : https://note.spboucher.ai
 * Created          : 2026-11-01
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

import { handler } from "@/lib/api";
import { db, schema } from "@/db";
import { gte, sql as dsql, desc } from "drizzle-orm";
export const GET = handler(async ({ req }) => {
  const days = Math.min(90, Number(new URL(req.url).searchParams.get("days") ?? 30)); const since = new Date(Date.now() - days * 864e5);
  const byModel = await db.select({ model: schema.aiUsage.model, provider: schema.aiUsage.provider, calls: dsql<number>`count(*)::int`, errors: dsql<number>`(count(*) filter (where not ok))::int`, inputTokens: dsql<number>`coalesce(sum(input_tokens),0)::float8`.mapWith(Number), outputTokens: dsql<number>`coalesce(sum(output_tokens),0)::float8`.mapWith(Number), costUsd: dsql<number>`coalesce(sum(cost_usd),0)::float8`.mapWith(Number), latency: dsql<number>`percentile_cont(0.5) within group (order by latency_ms)`, ttft: dsql<number>`percentile_cont(0.5) within group (order by ttft_ms)` }).from(schema.aiUsage).where(gte(schema.aiUsage.createdAt, since)).groupBy(schema.aiUsage.model, schema.aiUsage.provider).orderBy(desc(dsql`sum(cost_usd)`));
  const byDay = await db.select({ day: dsql<string>`to_char(created_at, 'YYYY-MM-DD')`, costUsd: dsql<number>`coalesce(sum(cost_usd),0)::float8`.mapWith(Number), calls: dsql<number>`count(*)::int` }).from(schema.aiUsage).where(gte(schema.aiUsage.createdAt, since)).groupBy(dsql`1`).orderBy(dsql`1`);
  const byTask = await db.select({ task: schema.aiUsage.task, calls: dsql<number>`count(*)::int`, costUsd: dsql<number>`coalesce(sum(cost_usd),0)::float8`.mapWith(Number) }).from(schema.aiUsage).where(gte(schema.aiUsage.createdAt, since)).groupBy(schema.aiUsage.task).orderBy(desc(dsql`count(*)`));
  const recent = await db.select().from(schema.aiUsage).orderBy(desc(schema.aiUsage.createdAt)).limit(50);
  return Response.json({ days, byModel, byDay, byTask, recent });
});
