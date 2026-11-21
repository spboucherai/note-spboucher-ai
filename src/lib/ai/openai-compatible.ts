/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/lib/ai/openai-compatible.ts
 * Module           : lib
 * Repository       : https://git.spboucher.ai/note-spboucher-ai
 * Project Website  : https://note.spboucher.ai
 * Created          : 2026-11-19
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

/**
 * Adapter for OpenAI-compatible endpoints (SPEC §3.5): Chat Completions over HTTP with SSE streaming. Serves OpenRouter, the MacLustr
 * LLM API and any other row of `ai_providers` with kind `openai_compatible` (base URL + NAME of the key variable).
 *
 * It speaks plain `fetch` rather than an SDK so that the wire behaviour is explicit and testable against a local fake server:
 *   - request: POST {base_url}/chat/completions, `stream: true`, `stream_options.include_usage`, `max_tokens`;
 *   - tools → `tools: [{type:"function", function:{…}}]`; tool-call deltas are accumulated and emitted once complete;
 *   - JSON schema → `response_format: {type:"json_schema", …strict}` when the model declares structured outputs, otherwise the schema
 *     is stated in the system prompt (+ `response_format: {type:"json_object"}` when the model declares JSON mode);
 *   - errors: HTTP status and the provider's `error.message` are surfaced (never the key); an `{"error":…}` frame inside the stream
 *     ends the call as an error; 408/429/5xx and network failures are retried (2 retries, backoff) only while nothing was received;
 *   - timeouts: `timeoutMs` for the whole call and an idle timeout between two frames, both reported as `timeout`.
 * Model capabilities come from the catalogue row (`ai_models.capabilities`, filled by discovery) — nothing is assumed.
 */
import type { AICallOptions, AIEvent, AIUsage } from "./types";
import { providerDef, providerKey, remoteModelId } from "./registry";

export interface CompatCapabilities { tools?: boolean | null; structured_output?: boolean | null; json_mode?: boolean | null; vision?: boolean | null; reasoning?: boolean | null }
export interface CompatExtra { capabilities?: CompatCapabilities | null; idleTimeoutMs?: number; retries?: number; fetchImpl?: typeof fetch }
const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);
const now = () => performance.now();
const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((res, rej) => { const t = setTimeout(res, ms); signal?.addEventListener("abort", () => { clearTimeout(t); rej(new Error("aborted")); }, { once: true }); });
class TimeoutError extends Error { constructor(what: string) { super(`timeout: ${what}`); } }

/** Body of a Chat Completions request for these options (exported for tests: this is the exact wire contract). */
export function buildChatCompletionsBody(o: AICallOptions, remoteId: string, caps: CompatCapabilities = {}): Record<string, unknown> {
  const messages: unknown[] = [];
  let system = o.system ?? "";
  const body: Record<string, unknown> = { model: remoteId, stream: true, stream_options: { include_usage: true }, max_tokens: o.maxTokens ?? 8000 };
  if (o.jsonSchema) {
    if (caps.structured_output) body.response_format = { type: "json_schema", json_schema: { name: o.jsonSchema.name, schema: o.jsonSchema.schema, strict: true } };
    else {
      system = `${system}${system ? "\n\n" : ""}Return ONLY one JSON object, with no prose and no Markdown fence, that validates against this JSON Schema:\n${JSON.stringify(o.jsonSchema.schema)}`;
      if (caps.json_mode) body.response_format = { type: "json_object" };
    }
  }
  if (system) messages.push({ role: "system", content: system });
  for (const m of o.messages) {
    if (m.role === "user" && m.images?.length) messages.push({ role: "user", content: [...m.images.map((im) => ({ type: "image_url", image_url: { url: `data:${im.mime};base64,${im.dataBase64}` } })), { type: "text", text: m.content }] });
    else messages.push({ role: m.role, content: m.content });
  }
  body.messages = messages;
  if (o.tools?.length) body.tools = o.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }));
  if (o.effort && caps.reasoning) body.reasoning_effort = o.effort;
  return body;
}

async function errorMessage(res: Response): Promise<string> {
  const raw = (await res.text().catch(() => "")).slice(0, 2000);
  try { const j = JSON.parse(raw); const m = j?.error?.message ?? j?.error ?? j?.message ?? j?.detail; if (typeof m === "string" && m) return m.slice(0, 400); if (m) return JSON.stringify(m).slice(0, 400); } catch { /* not JSON */ }
  return raw.replace(/\s+/g, " ").slice(0, 300) || res.statusText || `HTTP ${res.status}`;
}

/** Split a byte stream into SSE `data:` payloads (comments and other fields are ignored), enforcing the idle timeout. */
async function* sseData(body: ReadableStream<Uint8Array>, idleMs: number): AsyncGenerator<string> {
  const reader = body.getReader(); const dec = new TextDecoder(); let buf = "";
  try {
    for (;;) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const idle = new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new TimeoutError(`no data for ${Math.round(idleMs / 1000)} s`)), idleMs); });
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try { chunk = await Promise.race([reader.read(), idle]); } finally { clearTimeout(timer); }
      if (chunk.done) break;
      buf += dec.decode(chunk.value, { stream: true });
      let i: number;
      while ((i = buf.search(/\r?\n/)) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + (buf[i] === "\r" ? 2 : 1));
        if (line.startsWith("data:")) yield line.slice(5).trimStart();
      }
    }
    if (buf.startsWith("data:")) yield buf.slice(5).trimStart();
  } finally { reader.cancel().catch(() => {}); }
}

export async function* streamOpenAICompatible(o: AICallOptions, extra: CompatExtra = {}): AsyncGenerator<AIEvent> {
  const t0 = now(); let ttft: number | null = null;
  const def = providerDef(o.provider);
  if (!def || def.kind !== "openai_compatible" || !def.baseUrl) { yield { type: "error", message: `Provider "${o.provider}" is not an OpenAI-compatible endpoint with a base URL.` }; return; }
  const key = providerKey(o.provider);
  if (!key) { yield { type: "error", message: `Provider "${def.name}" is not configured: the environment variable ${def.keyEnv ?? "(none)"} is not set.`, status: 401 }; return; }
  const totalMs = o.timeoutMs ?? 10 * 60_000; const idleMs = extra.idleTimeoutMs ?? 120_000; const maxRetries = extra.retries ?? 2;
  const doFetch = extra.fetchImpl ?? fetch;
  const timeout = new AbortController(); const timer = setTimeout(() => timeout.abort(), totalMs);
  const signal = o.signal ? AbortSignal.any([o.signal, timeout.signal]) : timeout.signal;
  const body = JSON.stringify(buildChatCompletionsBody(o, remoteModelId(o.provider, o.model), extra.capabilities ?? {}));
  try {
    let res: Response | null = null; let lastErr: { message: string; status?: number } | null = null;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (attempt) await sleep(Math.min(4000, 300 * 2 ** (attempt - 1)), signal);
      try {
        const r = await doFetch(`${def.baseUrl}/chat/completions`, { method: "POST", headers: { "content-type": "application/json", accept: "text/event-stream", authorization: `Bearer ${key}` }, body, signal });
        if (r.ok && r.body) { res = r; break; }
        lastErr = { message: await errorMessage(r), status: r.status };
        if (!RETRYABLE.has(r.status)) break;
      } catch (e) {
        if (signal.aborted) throw e;
        lastErr = { message: `network error: ${String((e as Error)?.message ?? e).slice(0, 200)}` };
      }
    }
    if (!res) { yield { type: "error", message: lastErr?.message ?? "no response", status: lastErr?.status }; return; }

    let text = ""; let stop: string | null = null; let refusal = ""; let u: any = null;
    const calls = new Map<number, { id: string; name: string; args: string }>();
    for await (const data of sseData(res.body!, idleMs)) {
      if (data === "[DONE]") break;
      let j: any; try { j = JSON.parse(data); } catch { continue; }
      if (j?.error) { const m = typeof j.error === "string" ? j.error : j.error.message ?? JSON.stringify(j.error); yield { type: "error", message: String(m).slice(0, 400), status: typeof j.error?.code === "number" ? j.error.code : undefined }; return; }
      if (j?.usage) u = j.usage;
      const ch = j?.choices?.[0]; if (!ch) continue;
      const d = ch.delta ?? {};
      if (typeof d.content === "string" && d.content) { if (ttft === null) ttft = now() - t0; text += d.content; yield { type: "text", delta: d.content }; }
      else if ((d.reasoning || d.reasoning_content || d.tool_calls) && ttft === null) ttft = now() - t0;
      if (typeof d.refusal === "string") refusal += d.refusal;
      for (const tc of d.tool_calls ?? []) {
        const idx = typeof tc.index === "number" ? tc.index : calls.size;
        const cur = calls.get(idx) ?? { id: "", name: "", args: "" };
        if (tc.id) cur.id = tc.id; if (tc.function?.name) cur.name = tc.function.name; if (typeof tc.function?.arguments === "string") cur.args += tc.function.arguments;
        calls.set(idx, cur);
      }
      if (ch.finish_reason) stop = ch.finish_reason;
    }
    for (const [idx, c] of [...calls.entries()].sort((a, b) => a[0] - b[0])) { let args: unknown = c.args; try { args = JSON.parse(c.args || "{}"); } catch { /* keep the raw string */ } yield { type: "tool_call", id: c.id || `call_${idx}`, name: c.name, args }; }
    if (stop === null && !text && !calls.size) { yield { type: "error", message: "The provider closed the stream without an answer." }; return; }
    const usage: AIUsage = { inputTokens: u?.prompt_tokens ?? 0, outputTokens: u?.completion_tokens ?? 0, cachedTokens: u?.prompt_tokens_details?.cached_tokens ?? 0, reasoningTokens: u?.completion_tokens_details?.reasoning_tokens ?? 0 };
    yield { type: "done", usage, stop, ttftMs: ttft, totalMs: now() - t0, refusal: stop === "content_filter" ? "content filter" : refusal ? "refusal" : undefined };
  } catch (e) {
    if (o.signal?.aborted) { yield { type: "error", message: "aborted" }; return; }
    if (timeout.signal.aborted) { yield { type: "error", message: `timeout: no complete answer within ${Math.round(totalMs / 1000)} s`, status: 408 }; return; }
    if (e instanceof TimeoutError) { yield { type: "error", message: e.message, status: 408 }; return; }
    yield { type: "error", message: String((e as Error)?.message ?? e).slice(0, 500) };
  } finally { clearTimeout(timer); }
}

// ---------- catalogue discovery through GET {base_url}/models
export interface DiscoveredModel { remoteId: string; name: string; contextWindow: number | null; maxOutput: number | null; inputPrice: number | null; cachedPrice: number | null; outputPrice: number | null; capabilities: CompatCapabilities & { modalities?: string[]; source: string }; textOutput: boolean; created: Date | null }
const perMillion = (v: unknown): number | null => { if (v == null || v === "") return null; const n = Number(v); return Number.isFinite(n) && n >= 0 ? Math.round(n * 1e6 * 1e6) / 1e6 : null; };
/**
 * Normalise one entry of a `/models` list. OpenRouter documents `context_length`, `pricing.{prompt,completion,input_cache_read}` (USD per
 * token, as strings), `architecture.{input_modalities,output_modalities}`, `supported_parameters`, `top_provider.max_completion_tokens`.
 * A bare OpenAI-style entry (`{id, object:"model"}`, e.g. mlx_lm.server) yields nulls: unknown stays unknown.
 */
export function normaliseModelEntry(m: any): DiscoveredModel | null {
  if (!m || typeof m.id !== "string" || !m.id.trim()) return null;
  const sp: string[] | null = Array.isArray(m.supported_parameters) ? m.supported_parameters : null;
  const inMod: string[] | null = Array.isArray(m.architecture?.input_modalities) ? m.architecture.input_modalities : null;
  const outMod: string[] | null = Array.isArray(m.architecture?.output_modalities) ? m.architecture.output_modalities : null;
  const has = (p: string) => (sp ? sp.includes(p) : null);
  const ctx = Number(m.context_length ?? m.context_window ?? m.max_context_length); const maxOut = Number(m.top_provider?.max_completion_tokens ?? m.max_output_tokens ?? m.max_completion_tokens);
  return {
    remoteId: m.id.trim(), name: typeof m.name === "string" && m.name.trim() ? m.name.trim() : m.id.trim(),
    contextWindow: Number.isFinite(ctx) && ctx > 0 ? Math.round(ctx) : null, maxOutput: Number.isFinite(maxOut) && maxOut > 0 ? Math.round(maxOut) : null,
    inputPrice: perMillion(m.pricing?.prompt), cachedPrice: perMillion(m.pricing?.input_cache_read), outputPrice: perMillion(m.pricing?.completion),
    capabilities: { tools: has("tools"), structured_output: has("structured_outputs"), json_mode: has("response_format"), vision: inMod ? inMod.includes("image") : null, reasoning: sp ? sp.includes("reasoning") || sp.includes("include_reasoning") : null, ...(inMod ? { modalities: inMod } : {}), source: "provider /models" },
    textOutput: outMod ? outMod.includes("text") : true,
    created: typeof m.created === "number" && m.created > 0 ? new Date(m.created * 1000) : null,
  };
}
/** List the models of an OpenAI-compatible endpoint. `key` may be null for a public catalogue (OpenRouter's `/models` is keyless). */
export async function fetchModelList(baseUrl: string, key: string | null, opts: { timeoutMs?: number; fetchImpl?: typeof fetch } = {}): Promise<DiscoveredModel[]> {
  const res = await (opts.fetchImpl ?? fetch)(`${baseUrl.replace(/\/+$/, "")}/models`, { headers: { accept: "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) }, signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000) });
  if (!res.ok) throw Object.assign(new Error(`GET /models → HTTP ${res.status}: ${await errorMessage(res)}`), { status: res.status });
  const j: any = await res.json(); const list: unknown[] = Array.isArray(j) ? j : Array.isArray(j?.data) ? j.data : Array.isArray(j?.models) ? j.models : [];
  const out: DiscoveredModel[] = []; const seen = new Set<string>();
  for (const m of list) { const n = normaliseModelEntry(m); if (n && !seen.has(n.remoteId)) { seen.add(n.remoteId); out.push(n); } }
  return out;
}
