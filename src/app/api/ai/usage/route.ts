import { handler } from "@/lib/api";
import { db, schema } from "@/db";
import { gte, sql as dsql, desc } from "drizzle-orm";
export const GET = handler(async ({ req }) => {
  const days = Math.min(90, Number(new URL(req.url).searchParams.get("days") ?? 30)); const since = new Date(Date.now() - days * 864e5);
  const byModel = await db.select({ model: schema.aiUsage.model, provider: schema.aiUsage.provider, calls: dsql<number>`count(*)`, errors: dsql<number>`count(*) filter (where not ok)`, inputTokens: dsql<number>`sum(input_tokens)`, outputTokens: dsql<number>`sum(output_tokens)`, costUsd: dsql<number>`coalesce(sum(cost_usd),0)`, latency: dsql<number>`percentile_cont(0.5) within group (order by latency_ms)`, ttft: dsql<number>`percentile_cont(0.5) within group (order by ttft_ms)` }).from(schema.aiUsage).where(gte(schema.aiUsage.createdAt, since)).groupBy(schema.aiUsage.model, schema.aiUsage.provider).orderBy(desc(dsql`sum(cost_usd)`));
  const byDay = await db.select({ day: dsql<string>`to_char(created_at, 'YYYY-MM-DD')`, costUsd: dsql<number>`coalesce(sum(cost_usd),0)`, calls: dsql<number>`count(*)` }).from(schema.aiUsage).where(gte(schema.aiUsage.createdAt, since)).groupBy(dsql`1`).orderBy(dsql`1`);
  const byTask = await db.select({ task: schema.aiUsage.task, calls: dsql<number>`count(*)`, costUsd: dsql<number>`coalesce(sum(cost_usd),0)` }).from(schema.aiUsage).where(gte(schema.aiUsage.createdAt, since)).groupBy(schema.aiUsage.task).orderBy(desc(dsql`count(*)`));
  const recent = await db.select().from(schema.aiUsage).orderBy(desc(schema.aiUsage.createdAt)).limit(50);
  return Response.json({ days, byModel, byDay, byTask, recent });
});
