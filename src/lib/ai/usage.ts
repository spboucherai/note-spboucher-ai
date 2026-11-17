import { db, schema } from "@/db";
import { eq, gte, sql as dsql } from "drizzle-orm";
import type { AIUsage, Provider, TaskClass } from "./types";
export async function recordUsage(o: { workspaceId?: string | null; provider: Provider; model: string; task: string; usage?: AIUsage | null; costUsd?: number | null; latencyMs?: number | null; ttftMs?: number | null; ok: boolean; error?: string | null; refId?: string | null }) {
  try {
    await db.insert(schema.aiUsage).values({ workspaceId: o.workspaceId ?? null, provider: o.provider, model: o.model, task: o.task, inputTokens: o.usage?.inputTokens ?? 0, outputTokens: o.usage?.outputTokens ?? 0, cachedTokens: o.usage?.cachedTokens ?? 0, reasoningTokens: o.usage?.reasoningTokens ?? 0, costUsd: o.costUsd ?? null, latencyMs: o.latencyMs == null ? null : Math.round(o.latencyMs), ttftMs: o.ttftMs == null ? null : Math.round(o.ttftMs), ok: o.ok, error: o.error ? String(o.error).slice(0, 300) : null, refId: o.refId ?? null });
  } catch (e) { console.error("usage record failed", (e as Error)?.name); }
}

/**
 * Cost guard shared by the assistant, inline actions and agents.
 *  - A request is "expensive" when it is routed to a costly class (deep / reason / longctx) or when its estimated input exceeds
 *    EXPENSIVE_TOKENS. Expensive requests are never sent without an explicit confirmation from the owner (`confirmExpensive`).
 *  - The daily budget (`settings.ai.daily_budget_usd`, default 20 USD, rolling 24 h) is the same one the router enforces: once reached,
 *    deep → reason and reason → chat. `budgetStatus()` exposes it so the UI can say so instead of downgrading silently.
 */
export const EXPENSIVE_CLASSES: TaskClass[] = ["deep", "reason", "longctx"];
export const EXPENSIVE_TOKENS = 30_000;
export function expensiveReason(task: TaskClass, estTokens: number): string | null {
  if (EXPENSIVE_CLASSES.includes(task)) return task === "longctx" ? "This request is long enough to need a long-context model" : `This request is routed to a ${task === "deep" ? "deep-research" : "reasoning"} model, the most expensive class`;
  if (estTokens > EXPENSIVE_TOKENS) return `This request sends about ${Math.round(estTokens / 1000)}K tokens (more than ${EXPENSIVE_TOKENS / 1000}K)`;
  return null;
}
export interface BudgetStatus { budgetUsd: number; spentUsd: number; over: boolean }
export async function budgetStatus(): Promise<BudgetStatus> {
  const [b] = await db.select().from(schema.settings).where(eq(schema.settings.key, "ai.daily_budget_usd"));
  const raw = Number((b?.value as unknown) ?? 20); const budgetUsd = Number.isFinite(raw) ? raw : 20;
  const [{ spent }] = await db.select({ spent: dsql<number>`coalesce(sum(cost_usd),0)` }).from(schema.aiUsage).where(gte(schema.aiUsage.createdAt, new Date(Date.now() - 864e5)));
  const spentUsd = Number(spent) || 0;
  return { budgetUsd, spentUsd, over: spentUsd >= budgetUsd };
}
export const budgetMessage = (b: BudgetStatus) => (b.over ? `Daily AI budget reached ($${b.spentUsd.toFixed(2)} of $${b.budgetUsd.toFixed(2)} in the last 24 h): deep and reasoning requests are downgraded to a cheaper model class until spending drops.` : null);
