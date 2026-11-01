import { z } from "zod";
import { handler, parseBody } from "@/lib/api";
import { callAI } from "@/lib/ai/providers";
import { getModel } from "@/lib/ai/catalog";
import { recordUsage } from "@/lib/ai/usage";
import { db, schema } from "@/db";
import { and, desc, eq } from "drizzle-orm";
import { ASSISTANT_SYSTEM } from "@/lib/ai/prompts";
import { sse } from "@/lib/ai/chat";
export const maxDuration = 600;
/** POST { prompt, models[] } → SSE: one `result` event per model as they finish; then `saved` with the comparison id. */
export const POST = handler(async ({ req, ws }) => {
  const b = await parseBody(req, z.object({ prompt: z.string().min(1).max(60_000), models: z.array(z.string()).min(1).max(6), system: z.string().max(4000).optional() }));
  async function* gen() {
    const results: any[] = [];
    const tasks = b.models.map(async (id) => {
      const m = await getModel(id); if (!m) return { model: id, error: "unknown model" };
      try {
        const r = await callAI({ model: id, provider: m.provider as any, system: b.system ?? ASSISTANT_SYSTEM, messages: [{ role: "user", content: b.prompt }], maxTokens: 6000 });
        await recordUsage({ workspaceId: ws.id, provider: m.provider as any, model: id, task: "compare", usage: r.usage, costUsd: r.costUsd, latencyMs: r.totalMs, ttftMs: r.ttftMs, ok: true });
        return { model: id, provider: m.provider, text: r.text, usage: r.usage, costUsd: r.costUsd, latencyMs: Math.round(r.totalMs), ttftMs: r.ttftMs == null ? null : Math.round(r.ttftMs), refusal: r.refusal ?? null };
      } catch (e: any) { await recordUsage({ workspaceId: ws.id, provider: m.provider as any, model: id, task: "compare", ok: false, error: e.message }); return { model: id, provider: m.provider, error: String(e.message).slice(0, 300) }; }
    });
    const queue = tasks.map((p) => p.then((r) => { results.push(r); return r; }));
    for (const p of queue) { /* yield in completion order */ }
    const pending = new Set(queue);
    while (pending.size) { const r = await Promise.race([...pending].map((p) => p.then((v) => [p, v] as const))); pending.delete(r[0]); yield { type: "result", ...r[1] }; }
    const [saved] = await db.insert(schema.aiComparisons).values({ workspaceId: ws.id, prompt: b.prompt, models: b.models, results }).returning({ id: schema.aiComparisons.id });
    yield { type: "saved", id: saved.id };
  }
  return sse(gen(), req.signal);
});
export const GET = handler(async ({ req, ws }) => {
  const id = new URL(req.url).searchParams.get("id");
  if (id) { const [c] = await db.select().from(schema.aiComparisons).where(and(eq(schema.aiComparisons.id, id), eq(schema.aiComparisons.workspaceId, ws.id))); return Response.json(c ?? null); }
  return Response.json(await db.select({ id: schema.aiComparisons.id, prompt: schema.aiComparisons.prompt, models: schema.aiComparisons.models, createdAt: schema.aiComparisons.createdAt }).from(schema.aiComparisons).where(eq(schema.aiComparisons.workspaceId, ws.id)).orderBy(desc(schema.aiComparisons.createdAt)).limit(50));
});
