import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import type { AICallOptions, AIEvent, AIResult, AIUsage } from "./types";
import { getModel, costUsd } from "./catalog";

let _oa: OpenAI | null = null, _an: Anthropic | null = null;
const oa = () => (_oa ??= new OpenAI({ maxRetries: 2, timeout: 10 * 60_000 }));
const an = () => (_an ??= new Anthropic({ maxRetries: 2, timeout: 10 * 60_000 }));
const isReasoningOpenAI = (m: string) => /^(o\d|gpt-5|gpt-6)/.test(m) && !/chat-latest/.test(m);
const now = () => performance.now();
const reqOpts = (o: AICallOptions) => ({ ...(o.signal ? { signal: o.signal } : {}), ...(o.timeoutMs ? { timeout: o.timeoutMs } : {}) });
const REFUSAL_RE = /^(I can['’]t|I cannot|I['’]m unable to) (provide|share|help with|give)[^.]{0,80}(access code|credential|password|secret)/i;

export async function* streamAI(o: AICallOptions): AsyncGenerator<AIEvent> {
  const t0 = now(); let ttft: number | null = null;
  try {
    if (o.provider === "openai") {
      const input: any[] = o.messages.map((m) => ({ role: m.role, content: m.role === "user" ? [...(m.images ?? []).map((im) => ({ type: "input_image", image_url: `data:${im.mime};base64,${im.dataBase64}`, detail: "auto" })), { type: "input_text", text: m.content }] : m.content }));
      const body: any = { model: o.model, input, max_output_tokens: o.maxTokens ?? 8000, stream: true };
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
      const body: any = { model: o.model, max_tokens: o.maxTokens ?? 8000, messages };
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
