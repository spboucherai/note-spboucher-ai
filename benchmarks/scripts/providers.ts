/**
 * Provider adapters used by discovery + benchmarks. One function per provider:
 * streaming text call with optional tools / JSON schema / image / reasoning control.
 */
import { openai, anthropic, now, errInfo, type CallResult, RED_PNG_B64 } from "./lib.ts";

export interface CallOpts {
  model: string;
  system?: string;
  prompt: string;
  maxTokens?: number;
  jsonSchema?: { name: string; schema: Record<string, unknown> };
  tools?: { name: string; description: string; parameters: Record<string, unknown> }[];
  image?: boolean;
  reasoning?: "low" | "medium" | "high" | "none";
  stream?: boolean;
  timeoutMs?: number;
}

const isReasoningOpenAI = (m: string) => /^(o\d|gpt-5|gpt-6)/.test(m) && !/chat-latest|^chat-latest/.test(m);

export async function callOpenAI(o: CallOpts): Promise<CallResult> {
  const t0 = now();
  let ttft: number | null = null;
  const content: any[] = [{ type: "input_text", text: o.prompt }];
  if (o.image) content.unshift({ type: "input_image", image_url: `data:image/png;base64,${RED_PNG_B64}`, detail: "low" });
  const body: any = {
    model: o.model,
    input: [{ role: "user", content }],
    max_output_tokens: o.maxTokens ?? 2048,
  };
  if (o.system) body.instructions = o.system;
  if (o.jsonSchema) body.text = { format: { type: "json_schema", name: o.jsonSchema.name, schema: o.jsonSchema.schema, strict: true } };
  if (o.tools) body.tools = o.tools.map((t) => ({ type: "function", name: t.name, description: t.description, parameters: t.parameters, strict: false }));
  if (o.reasoning && isReasoningOpenAI(o.model)) body.reasoning = { effort: o.reasoning };
  try {
    let text = "";
    let final: any;
    if (o.stream !== false) {
      const stream = await openai.responses.create({ ...body, stream: true }, { timeout: o.timeoutMs });
      for await (const ev of stream as any) {
        if (ev.type === "response.output_text.delta") { if (ttft === null) ttft = now() - t0; text += ev.delta; }
        else if (ev.type === "response.function_call_arguments.delta" && ttft === null) ttft = now() - t0;
        else if (ev.type === "response.completed") final = ev.response;
        else if (ev.type === "response.failed" || ev.type === "error") throw new Error(JSON.stringify(ev.response?.error ?? ev.error ?? ev).slice(0, 500));
        else if (ev.type === "response.incomplete") final = ev.response;
      }
    } else {
      final = await openai.responses.create(body, { timeout: o.timeoutMs });
      text = final.output_text ?? "";
      ttft = now() - t0;
    }
    const total = now() - t0;
    const toolCalls = (final?.output ?? []).filter((x: any) => x.type === "function_call").map((x: any) => ({ name: x.name, args: safeJSON(x.arguments) }));
    if (!text && final?.output_text) text = final.output_text;
    const u = final?.usage;
    return {
      ok: true, text, toolCalls, ttft_ms: ttft, total_ms: total, stop: final?.status ?? null,
      usage: u ? { input_tokens: u.input_tokens, output_tokens: u.output_tokens, cached_tokens: u.input_tokens_details?.cached_tokens ?? 0, reasoning_tokens: u.output_tokens_details?.reasoning_tokens ?? 0, source: "provider" } : null,
      raw: final?.incomplete_details ?? undefined,
    };
  } catch (e: any) {
    return { ok: false, text: "", toolCalls: [], usage: null, ttft_ms: ttft, total_ms: now() - t0, ...errInfo(e) };
  }
}

export async function callAnthropic(o: CallOpts): Promise<CallResult> {
  const t0 = now();
  let ttft: number | null = null;
  const content: any[] = [{ type: "text", text: o.prompt }];
  if (o.image) content.unshift({ type: "image", source: { type: "base64", media_type: "image/png", data: RED_PNG_B64 } });
  const body: any = { model: o.model, max_tokens: o.maxTokens ?? 2048, messages: [{ role: "user", content }] };
  if (o.system) body.system = o.system;
  if (o.jsonSchema) body.output_config = { ...(body.output_config ?? {}), format: { type: "json_schema", schema: o.jsonSchema.schema } };
  if (o.tools) body.tools = o.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));
  if (o.reasoning && o.reasoning !== "none") {
    // Current models: adaptive thinking + effort. Older (4.5) models: budget_tokens.
    if (/4-5-\d{8}$/.test(o.model)) body.thinking = { type: "enabled", budget_tokens: 2048 }, body.max_tokens = Math.max(body.max_tokens, 4096);
    else { body.thinking = { type: "adaptive" }; body.output_config = { ...(body.output_config ?? {}), effort: o.reasoning }; }
  }
  try {
    let text = "";
    let final: any;
    if (o.stream !== false) {
      const stream = anthropic.messages.stream(body, { timeout: o.timeoutMs });
      for await (const ev of stream as any) {
        if (ev.type === "content_block_delta") {
          if (ev.delta.type === "text_delta") { if (ttft === null) ttft = now() - t0; text += ev.delta.text; }
          else if (ev.delta.type === "input_json_delta" && ttft === null) ttft = now() - t0;
        }
      }
      final = await stream.finalMessage();
    } else {
      final = await anthropic.messages.create(body, { timeout: o.timeoutMs });
      ttft = now() - t0;
      text = final.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
    }
    const total = now() - t0;
    const toolCalls = final.content.filter((b: any) => b.type === "tool_use").map((b: any) => ({ name: b.name, args: b.input }));
    const u = final.usage;
    return {
      ok: true, text, toolCalls, ttft_ms: ttft, total_ms: total, stop: final.stop_reason,
      usage: { input_tokens: u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0), output_tokens: u.output_tokens, cached_tokens: u.cache_read_input_tokens ?? 0, reasoning_tokens: u.output_tokens_details?.thinking_tokens ?? 0, source: "provider" },
      raw: final.stop_reason === "refusal" ? final.stop_details : undefined,
    };
  } catch (e: any) {
    return { ok: false, text: "", toolCalls: [], usage: null, ttft_ms: ttft, total_ms: now() - t0, ...errInfo(e) };
  }
}

export function call(provider: "openai" | "anthropic", o: CallOpts) {
  return provider === "openai" ? callOpenAI(o) : callAnthropic(o);
}

export function safeJSON(s: unknown) { try { return typeof s === "string" ? JSON.parse(s) : s; } catch { return s; } }
