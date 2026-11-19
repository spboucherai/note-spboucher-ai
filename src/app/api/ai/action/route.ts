import { z } from "zod";
import { handler, parseBody, HttpError } from "@/lib/api";
import { streamAI } from "@/lib/ai/providers";
import { ACTION_SYSTEMS, INJECTION_GUARD, TRANSLATE_TARGETS, translateSystem } from "@/lib/ai/prompts";
import { recordUsage } from "@/lib/ai/usage";
import { costUsd } from "@/lib/ai/catalog";
import type { AIUsage } from "@/lib/ai/types";
import { sse, planAction, providerErrorMessage, ACTION_IDS } from "@/lib/ai/chat";
import { linkCandidates, pickLinks } from "@/lib/ai/links";
export const maxDuration = 300;
/**
 * Streaming inline AI actions on a selection (rewrite, fix, translate, summarise, expand, explain, convert to list/tasks/table) or a
 * free instruction. The server only returns text: nothing is written to the page here — the editor previews the result and the owner
 * applies it. Expensive requests need `confirmExpensive` (409 `confirm_expensive` otherwise, before any provider call).
 * NEXT (SPEC §4.10): `coherence`, `questions`, `synthesis`, `structure` stream Markdown like the others; `links` streams no text — it
 * answers one `{type:"result", data:{links:[…]}}` event with suggested internal links, as data for the owner to confirm (never written).
 */
export const POST = handler(async ({ req, ws }) => {
  const b = await parseBody(req, z.object({ action: z.enum(ACTION_IDS), text: z.string().max(120_000), instruction: z.string().max(4000).optional(), model: z.string().max(200).nullable().optional(), language: z.string().max(8).optional(), confirmExpensive: z.boolean().optional(), pageId: z.string().uuid().nullable().optional() }));
  if (b.action === "translate" && !(b.language && b.language in TRANSLATE_TARGETS)) throw new HttpError(400, "Choose a target language", "bad_language");
  if (b.action === "custom" && !b.instruction?.trim()) throw new HttpError(400, "Write an instruction first", "no_instruction");
  const system = b.action === "translate" ? translateSystem(b.language!) : ACTION_SYSTEMS[b.action] ?? "Follow the owner's instruction on the given text. Return only the result, no preamble. Keep the language of the text unless the instruction says otherwise.";
  const { plan, dec } = await planAction(b.action, b.text.length + (b.instruction?.length ?? 0), b.model ?? null);
  if (!dec) throw new HttpError(503, plan.error ?? "AI is not configured", plan.configured.any ? "no_model" : "not_configured");
  if (plan.expensive && !b.confirmExpensive) throw new HttpError(409, plan.expensive, "confirm_expensive", { plan });
  const task = plan.task;
  if (b.action === "links") {
    if (!b.text.trim()) throw new HttpError(400, "Nothing to link from", "no_text");
    async function* links() {
      const candidates = await linkCandidates(ws.id, b.text, b.pageId ?? null);
      if (!candidates.length) { // nothing to choose from: no provider is called
        yield { type: "meta", model: null, provider: null, reason: "no candidate page — no provider called", budgetNote: null };
        yield { type: "result", data: { ai: true, links: [], candidates: 0 } }; yield { type: "done", usage: null, costUsd: 0, latencyMs: 0 }; return;
      }
      yield { type: "meta", model: dec!.model.id, provider: dec!.provider, reason: dec!.reason, budgetNote: /budget downgrade/.test(dec!.reason) ? plan.budgetNote : null };
      try {
        const r = await pickLinks(dec!, b.text, candidates, req.signal);
        await recordUsage({ workspaceId: ws.id, provider: dec!.provider, model: dec!.model.id, task: "action:links", usage: r.res.usage, costUsd: r.res.costUsd, latencyMs: r.res.totalMs, ttftMs: r.res.ttftMs, ok: r.parsed !== null && !r.res.refusal, error: r.res.refusal ?? (r.parsed === null ? "invalid JSON" : null) });
        if (r.res.refusal) { yield { type: "error", code: "refused", retryable: true, message: "The model declined this request." }; return; }
        if (r.parsed === null) { yield { type: "error", code: "bad_output", retryable: true, message: "The model did not return valid JSON; nothing is suggested." }; return; }
        yield { type: "result", data: { ai: true, model: dec!.model.id, links: r.links, candidates: candidates.length } };
        yield { type: "done", usage: r.res.usage, costUsd: r.res.costUsd, latencyMs: Math.round(r.res.totalMs) };
      } catch (e) {
        const err = e as { message?: string; status?: number };
        await recordUsage({ workspaceId: ws.id, provider: dec!.provider, model: dec!.model.id, task: "action:links", ok: false, error: req.signal.aborted ? "aborted" : String(err?.message ?? e) });
        if (!req.signal.aborted) yield { type: "error", code: "provider_error", retryable: true, message: providerErrorMessage(String(err?.message ?? e), err?.status) };
      }
    }
    return sse(links(), req.signal);
  }
  async function* gen() {
    yield { type: "meta", model: dec!.model.id, provider: dec!.provider, reason: dec!.reason, budgetNote: /budget downgrade/.test(dec!.reason) ? plan.budgetNote : null };
    let text = ""; let usage: AIUsage | null = null; let ms = 0; let ttft: number | null = null; let err: { message: string; status?: number } | null = null; let refusal: string | undefined; let settled = false;
    const user = `${b.instruction ? `Instruction: ${b.instruction}\n\n` : ""}<workspace kind="text">\n${b.text}\n</workspace>`;
    try {
      for await (const ev of streamAI({ model: dec!.model.id, provider: dec!.provider, system: `${system}\n${INJECTION_GUARD}`, messages: [{ role: "user", content: user }], effort: dec!.effort, maxTokens: 8000, signal: req.signal })) {
        if (ev.type === "text") { text += ev.delta; yield { type: "text", delta: ev.delta }; } else if (ev.type === "done") { usage = ev.usage; ms = ev.totalMs; ttft = ev.ttftMs; refusal = ev.refusal; } else if (ev.type === "error") err = ev;
      }
      const cost = usage ? costUsd(dec!.model, usage) : null; const failed = Boolean(err) || !usage || Boolean(refusal);
      settled = true;
      await recordUsage({ workspaceId: ws.id, provider: dec!.provider, model: dec!.model.id, task: `action:${b.action}`, usage, costUsd: cost, latencyMs: ms, ttftMs: ttft, ok: !failed, error: failed ? refusal ?? err?.message ?? "no completion" : null });
      if (req.signal.aborted) return;
      if (failed) yield { type: "error", code: refusal ? "refused" : "provider_error", retryable: true, message: refusal ? "The model declined this request." : providerErrorMessage(err?.message ?? "The provider returned no answer.", err?.status) };
      else yield { type: "done", usage, costUsd: cost, latencyMs: Math.round(ms) };
    } finally {
      if (!settled) await recordUsage({ workspaceId: ws.id, provider: dec!.provider, model: dec!.model.id, task: `action:${b.action}`, usage, ok: false, error: "aborted" });
    }
  }
  return sse(gen(), req.signal);
});
