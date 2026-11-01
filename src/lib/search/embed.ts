import OpenAI from "openai";
import { EMBEDDING_MODEL } from "@/lib/ai/router";
import { recordUsage } from "@/lib/ai/usage";
let _c: OpenAI | null = null;
export const EMBEDDING_VERSION = 1;
export async function embedTexts(texts: string[], task = "embed"): Promise<number[][]> {
  if (!texts.length) return [];
  const c = (_c ??= new OpenAI({ maxRetries: 3 }));
  const out: number[][] = []; const t0 = performance.now();
  for (let i = 0; i < texts.length; i += 64) {
    const batch = texts.slice(i, i + 64).map((t) => t.slice(0, 8000));
    const r = await c.embeddings.create({ model: EMBEDDING_MODEL, input: batch, encoding_format: "float" });
    for (const d of r.data) out.push(d.embedding);
    await recordUsage({ provider: "openai", model: EMBEDDING_MODEL, task, usage: { inputTokens: r.usage?.prompt_tokens ?? 0, outputTokens: 0, cachedTokens: 0, reasoningTokens: 0 }, costUsd: ((r.usage?.prompt_tokens ?? 0) * 0.02) / 1e6, latencyMs: performance.now() - t0, ok: true });
  }
  return out;
}
