import { db, schema } from "@/db";
import type { AIUsage, Provider } from "./types";
export async function recordUsage(o: { workspaceId?: string | null; provider: Provider; model: string; task: string; usage?: AIUsage | null; costUsd?: number | null; latencyMs?: number | null; ttftMs?: number | null; ok: boolean; error?: string | null; refId?: string | null }) {
  try {
    await db.insert(schema.aiUsage).values({ workspaceId: o.workspaceId ?? null, provider: o.provider, model: o.model, task: o.task, inputTokens: o.usage?.inputTokens ?? 0, outputTokens: o.usage?.outputTokens ?? 0, cachedTokens: o.usage?.cachedTokens ?? 0, reasoningTokens: o.usage?.reasoningTokens ?? 0, costUsd: o.costUsd ?? null, latencyMs: o.latencyMs == null ? null : Math.round(o.latencyMs), ttftMs: o.ttftMs == null ? null : Math.round(o.ttftMs), ok: o.ok, error: o.error ?? null, refId: o.refId ?? null });
  } catch (e) { console.error("usage record failed", e); }
}
