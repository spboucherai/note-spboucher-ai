/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/lib/ai/providers.ts
 * Module           : lib
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

import "@/lib/net-defaults"; // connection attempt timeout of the process: without it a provider call can fail in 3 s as "Request timed out."
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import type { AICallOptions, AIEvent, AIResult, AIUsage, Effort } from "./types";
import { getModel, costUsd } from "./catalog";
import { providerDef } from "./registry";
import { streamOpenAICompatible, type CompatCapabilities } from "./openai-compatible";

let _oa: OpenAI | null = null, _an: Anthropic | null = null;
const oa = () => (_oa ??= new OpenAI({ maxRetries: 2, timeout: 10 * 60_000 }));
const an = () => (_an ??= new Anthropic({ maxRetries: 2, timeout: 10 * 60_000 }));
const isReasoningOpenAI = (m: string) => /^(o\d|gpt-5|gpt-6)/.test(m) && !/chat-latest/.test(m);
const now = () => performance.now();
/**
 * `maxTokens` of a call is the budget of the ANSWER. Both native APIs count the model's reasoning ("thinking") tokens inside the same
 * output cap, so a reasoning model given exactly the answer budget can spend it thinking and return a cut — or empty — answer. Seen
 * with the real providers on 2026-11-19: the daily-brief summary (answer budget 700, `claude-haiku-5-5`, effort low) hit the cap in 6
 * of 7 calls and spent all 700 tokens reasoning in 2 of them (→ "The model returned an empty summary"); both research calls stopped
 * at exactly 6 000. When reasoning is on, the cap sent to the provider is therefore the answer budget plus a reasoning allowance that
 * grows with the effort, within the model's own output limit. A call without reasoning is sent its budget unchanged.
 */
export const REASONING_HEADROOM: Record<Effort, number> = { low: 2000, medium: 6000, high: 12_000 };
export function outputCap(maxTokens: number | undefined, effort: Effort | null | undefined, reasons: boolean, modelMax?: number | null): number {
  const answer = maxTokens ?? 8000; if (!reasons || !effort) return answer;
  const cap = answer + (REASONING_HEADROOM[effort] ?? REASONING_HEADROOM.low);
  return modelMax ? Math.max(answer, Math.min(cap, modelMax)) : cap; // never below what the caller asked for (the historical value)
}
/** Does this request make the model reason? (the same conditions as the request builders below) */
export function reasons(kind: "openai" | "anthropic", model: string, effort: Effort | null | undefined): boolean {
  if (!effort) return false;
  if (kind === "openai") return isReasoningOpenAI(model);
  return /4-5-\d{8}$/.test(model) ? effort !== "low" : true;
}
const reqOpts = (o: AICallOptions) => ({ ...(o.signal ? { signal: o.signal } : {}), ...(o.timeoutMs ? { timeout: o.timeoutMs } : {}) });
const REFUSAL_RE = /^(I can['’]t|I cannot|I['’]m unable to) (provide|share|help with|give)[^.]{0,80}(access code|credential|password|secret)/i;

export async function* streamAI(o: AICallOptions): AsyncGenerator<AIEvent> {
  const t0 = now(); let ttft: number | null = null;
  // Route by provider KIND (SPEC §3.5): openai → Responses API, anthropic → Messages API, openai_compatible → Chat Completions adapter.
  const row = await getModel(o.model).catch(() => null); // also refreshes the provider registry
  const kind = providerDef(o.provider)?.kind ?? (o.provider === "openai" || o.provider === "anthropic" ? o.provider : null);
  if (kind === null) { yield { type: "error", message: `Unknown AI provider "${o.provider}".` }; return; }
  if (kind === "openai_compatible") { yield* streamOpenAICompatible(o, { capabilities: (row?.capabilities ?? null) as CompatCapabilities | null }); return; }
  try {
    if (kind === "openai") {
      const input: any[] = o.messages.map((m) => ({ role: m.role, content: m.role === "user" ? [...(m.images ?? []).map((im) => ({ type: "input_image", image_url: `data:${im.mime};base64,${im.dataBase64}`, detail: "auto" })), { type: "input_text", text: m.content }] : m.content }));
      const body: any = { model: o.model, input, max_output_tokens: outputCap(o.maxTokens, o.effort, reasons("openai", o.model, o.effort), row?.maxOutput), stream: true };
      if (o.system) body.instructions = o.system;
      if (o.jsonSchema) body.text = { format: { type: "json_schema", name: o.jsonSchema.name, schema: o.jsonSchema.schema, strict: true } };
      if (o.tools) body.tools = o.tools.map((t) => ({ type: "function", name: t.name, description: t.description, parameters: t.parameters, strict: false }));
      if (o.effort && isReasoningOpenAI(o.model)) body.reasoning = { effort: o.effort };
      const stream: any = await oa().responses.create(body, reqOpts(o));
      let final: any = null; let text = "";
      for await (const ev of stream) {
        if (ev.type === "response.output_text.delta") { if (ttft === null) ttft = now() - t0; text += ev.delta; yield { type: "text", delta: ev.delta }; }
        else if (ev.type === "response.function_call_arguments.delta" && ttft === null) ttft = now() - t0;
        else if (ev.type === "response.completed" || ev.type === "response.incomplete") final = ev.response;
        else if (ev.type === "response.failed" || ev.type === "error") throw new Error(JSON.stringify(ev.response?.error ?? ev.error ?? ev).slice(0, 400));
      }
      for (const item of final?.output ?? []) if (item.type === "function_call") { let args: unknown = item.arguments; try { args = JSON.parse(item.arguments); } catch {} yield { type: "tool_call", id: item.call_id, name: item.name, args }; }
      const u = final?.usage;
      const usage: AIUsage = { inputTokens: u?.input_tokens ?? 0, outputTokens: u?.output_tokens ?? 0, cachedTokens: u?.input_tokens_details?.cached_tokens ?? 0, reasoningTokens: u?.output_tokens_details?.reasoning_tokens ?? 0 };
      yield { type: "done", usage, stop: final?.status ?? null, ttftMs: ttft, totalMs: now() - t0, refusal: REFUSAL_RE.test(text.trim()) ? "credential-style refusal text" : undefined };
    } else {
      const messages: any[] = o.messages.map((m) => ({ role: m.role, content: m.role === "user" && m.images?.length ? [...m.images.map((im) => ({ type: "image", source: { type: "base64", media_type: im.mime, data: im.dataBase64 } })), { type: "text", text: m.content }] : m.content }));
      const body: any = { model: o.model, max_tokens: outputCap(o.maxTokens, o.effort, reasons("anthropic", o.model, o.effort), row?.maxOutput), messages };
      if (o.system) body.system = [{ type: "text", text: o.system, cache_control: { type: "ephemeral" } }];
      if (o.jsonSchema) body.output_config = { ...(body.output_config ?? {}), format: { type: "json_schema", schema: o.jsonSchema.schema } };
      if (o.tools) body.tools = o.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));
      if (/4-5-\d{8}$/.test(o.model)) { if (o.effort && o.effort !== "low") body.thinking = { type: "enabled", budget_tokens: 2048 }; }
      else if (o.effort) { body.thinking = { type: "adaptive" }; body.output_config = { ...(body.output_config ?? {}), effort: o.effort }; }
      const stream = an().messages.stream(body, reqOpts(o));
      for await (const ev of stream as any) {
        if (ev.type === "content_block_delta") {
          if (ev.delta.type === "text_delta") { if (ttft === null) ttft = now() - t0; yield { type: "text", delta: ev.delta.text }; }
          else if (ev.delta.type === "input_json_delta" && ttft === null) ttft = now() - t0;
        }
      }
      const final: any = await stream.finalMessage();
      for (const b of final.content) if (b.type === "tool_use") yield { type: "tool_call", id: b.id, name: b.name, args: b.input };
      const u = final.usage;
      const usage: AIUsage = { inputTokens: (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0), outputTokens: u.output_tokens ?? 0, cachedTokens: u.cache_read_input_tokens ?? 0, reasoningTokens: u.output_tokens_details?.thinking_tokens ?? 0 };
      yield { type: "done", usage, stop: final.stop_reason, ttftMs: ttft, totalMs: now() - t0, refusal: final.stop_reason === "refusal" ? `refusal (${final.stop_details?.category ?? "?"})` : undefined };
    }
  } catch (e: any) {
    if (o.signal?.aborted) { yield { type: "error", message: "aborted" }; return; }
    yield { type: "error", message: String(e?.message ?? e).slice(0, 500), status: typeof e?.status === "number" ? e.status : undefined };
  }
}

/** Non-streaming convenience: collects the stream into a result. */
export async function callAI(o: AICallOptions): Promise<AIResult> {
  let text = ""; const toolCalls: AIResult["toolCalls"] = []; let done: Extract<AIEvent, { type: "done" }> | null = null; let err: Extract<AIEvent, { type: "error" }> | null = null;
  for await (const ev of streamAI(o)) { if (ev.type === "text") text += ev.delta; else if (ev.type === "tool_call") toolCalls.push(ev); else if (ev.type === "done") done = ev; else if (ev.type === "error") err = ev; }
  if (err) throw Object.assign(new Error(err.message), { status: err.status });
  const m = await getModel(o.model);
  const usage = done!.usage;
  return { text, toolCalls, usage, stop: done!.stop, ttftMs: done!.ttftMs, totalMs: done!.totalMs, costUsd: costUsd(m, usage), model: o.model, provider: o.provider, refusal: done!.refusal };
}
