import { z } from "zod";
import { handler, parseBody } from "@/lib/api";
import { streamAI } from "@/lib/ai/providers";
import { route } from "@/lib/ai/router";
import { ACTION_SYSTEMS, INJECTION_GUARD } from "@/lib/ai/prompts";
import { recordUsage } from "@/lib/ai/usage";
import { costUsd } from "@/lib/ai/catalog";
import { sse } from "@/lib/ai/chat";
import type { TaskClass } from "@/lib/ai/types";
export const maxDuration = 300;
const TASK_FOR: Record<string, TaskClass> = { explain_math: "reason", contradictions: "reason", outline: "write", study_notes: "write", table: "extract", action_items: "extract" };
/** Streaming inline AI actions on a selection or a whole page (rewrite, summarize, translate, …) or a free instruction. */
export const POST = handler(async ({ req, ws }) => {
  const b = await parseBody(req, z.object({ action: z.string().max(40), text: z.string().max(120_000), instruction: z.string().max(4000).optional(), model: z.string().nullable().optional(), language: z.string().max(8).optional() }));
  const system = ACTION_SYSTEMS[b.action] ?? `Follow the user's instruction on the given text. Return only the result, no preamble. ${b.language ? `Answer in ${b.language}.` : "Keep the language of the text."}`;
  const task: TaskClass = TASK_FOR[b.action] ?? (b.action === "custom" ? "chat" : "write");
  const dec = await route({ task, preferred: b.model ?? null, estTokens: Math.ceil(b.text.length / 3.6) + 2000 });
  async function* gen() {
    yield { type: "meta", model: dec.model.id, provider: dec.provider, reason: dec.reason };
    let text = ""; let usage: any = null; let ms = 0; let ttft: number | null = null; let err: string | null = null;
    const user = `${b.instruction ? `Instruction: ${b.instruction}\n\n` : ""}<workspace kind="text">\n${b.text}\n</workspace>`;
    for await (const ev of streamAI({ model: dec.model.id, provider: dec.provider, system: `${system}\n${INJECTION_GUARD}`, messages: [{ role: "user", content: user }], effort: dec.effort, maxTokens: 8000, signal: req.signal })) {
      if (ev.type === "text") { text += ev.delta; yield { type: "text", delta: ev.delta }; } else if (ev.type === "done") { usage = ev.usage; ms = ev.totalMs; ttft = ev.ttftMs; } else if (ev.type === "error") err = ev.message;
    }
    const cost = usage ? costUsd(dec.model, usage) : null;
    await recordUsage({ workspaceId: ws.id, provider: dec.provider, model: dec.model.id, task: `action:${b.action}`, usage, costUsd: cost, latencyMs: ms, ttftMs: ttft, ok: !err, error: err });
    if (err && !text) yield { type: "error", message: err }; else yield { type: "done", usage, costUsd: cost, latencyMs: Math.round(ms) };
  }
  return sse(gen(), req.signal);
});
