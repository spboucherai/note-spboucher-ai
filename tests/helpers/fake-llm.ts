/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : tests/helpers/fake-llm.ts
 * Module           : tests
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
 * Local fake of an OpenAI-compatible endpoint (Chat Completions + SSE, GET /models) for the adapter tests. No network, no key, no cost.
 * Behaviour is chosen by the requested model id:
 *   echo            streams `reply(body)` in small text deltas, then a usage frame, then [DONE]
 *   tools           streams one tool call whose arguments arrive split over several deltas
 *   err-401 / err-429 / err-500   always answer that HTTP status with an OpenAI-style error body
 *   flaky-503       answers 503 `flakyFailures` times, then behaves like echo
 *   midstream       starts streaming, then sends an `{"error":…}` frame
 *   stall           sends one delta, then nothing (idle timeout)
 *   hang            never answers (total timeout / abort)
 *   close-empty     200 with an empty stream
 * Every request body is recorded in `requests` so tests can assert the exact wire contract.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { eq } from "drizzle-orm";
import { db, schema } from "../../src/db/index";
import { invalidateCatalog } from "../../src/lib/ai/catalog";

export interface FakeLLM { url: string; key: string; requests: { path: string; auth: string | null; body: any }[]; reply: (body: any) => string; models: unknown[]; modelsPublic: boolean; flakyFailures: number; close: () => Promise<void> }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function startFakeLLM(): Promise<FakeLLM> {
  const state: FakeLLM = { url: "", key: "sk-fake-" + Math.random().toString(36).slice(2), requests: [], reply: () => "Bonjour du faux modèle.", models: [], modelsPublic: false, flakyFailures: 1, close: async () => {} };
  let flaky = 0; const open = new Set<http.ServerResponse>();
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = []; for await (const c of req) chunks.push(c as Buffer);
    const raw = Buffer.concat(chunks).toString("utf8"); let body: any = null; try { body = raw ? JSON.parse(raw) : null; } catch { /* keep null */ }
    const auth = req.headers.authorization ?? null; const path = (req.url ?? "").split("?")[0];
    state.requests.push({ path, auth, body });
    const json = (status: number, obj: unknown) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
    const authed = auth === `Bearer ${state.key}`;
    if (req.method === "GET" && path === "/v1/models") { if (!authed && !state.modelsPublic) return json(401, { error: { message: "Missing or invalid API key", type: "invalid_request_error" } }); return json(200, { object: "list", data: state.models }); }
    if (req.method !== "POST" || path !== "/v1/chat/completions") return json(404, { error: { message: "not found" } });
    if (!authed) return json(401, { error: { message: "Incorrect API key provided", type: "invalid_request_error" } });
    const model: string = body?.model ?? "";
    if (model === "err-401") return json(401, { error: { message: "Incorrect API key provided", type: "invalid_request_error" } });
    if (model === "err-429") return json(429, { error: { message: "Rate limit reached for requests", type: "rate_limit_error" } });
    if (model === "err-500") return json(500, { error: { message: "The server had an error while processing your request" } });
    if (model === "flaky-503" && flaky < state.flakyFailures) { flaky++; return json(503, { error: { message: "Service temporarily overloaded" } }); }
    if (model === "hang") { open.add(res); return; }
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" }); open.add(res);
    const send = (obj: unknown) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
    const frame = (delta: unknown, finish: string | null = null) => ({ id: "chatcmpl-fake", object: "chat.completion.chunk", model, choices: [{ index: 0, delta, finish_reason: finish }] });
    if (model === "close-empty") { res.end(); return; }
    res.write(": keep-alive comment\n\n");
    if (model === "tools") {
      send(frame({ role: "assistant", tool_calls: [{ index: 0, id: "call_abc", type: "function", function: { name: body.tools?.[0]?.function?.name ?? "tool", arguments: "" } }] }));
      for (const part of ['{"pa', 'geId":"p-1",', '"tags":["a","b"]}']) send(frame({ tool_calls: [{ index: 0, function: { arguments: part } }] }));
      send(frame({}, "tool_calls")); send({ id: "chatcmpl-fake", choices: [], usage: { prompt_tokens: 40, completion_tokens: 12 } }); res.write("data: [DONE]\n\n"); res.end(); return;
    }
    const text = state.reply(body); const parts = text.match(/[\s\S]{1,7}/g) ?? [];
    if (model === "midstream") { send(frame({ role: "assistant", content: parts[0] ?? "x" })); send({ error: { message: "Upstream provider disconnected", code: 502 } }); res.end(); return; }
    if (model === "stall") { send(frame({ role: "assistant", content: parts[0] ?? "x" })); return; }
    send(frame({ role: "assistant", content: "" }));
    for (const p of parts) { send(frame({ content: p })); await sleep(1); }
    send(frame({}, "stop"));
    send({ id: "chatcmpl-fake", choices: [], usage: { prompt_tokens: 120, completion_tokens: parts.length, prompt_tokens_details: { cached_tokens: 20 }, completion_tokens_details: { reasoning_tokens: 3 } } });
    res.write("data: [DONE]\n\n"); res.end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  state.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  state.close = async () => { for (const r of open) r.destroy(); await new Promise<void>((r) => server.close(() => r())); };
  return state;
}

/** Register the fake as an `openai_compatible` provider row + models, with its key in a private env variable. Returns a cleanup. */
export async function registerFakeProvider(fake: FakeLLM, id: string, models: { id: string; capabilities?: Record<string, unknown>; inputPrice?: number; outputPrice?: number; contextWindow?: number; enabled?: boolean }[] = []) {
  const keyEnv = `FAKE_LLM_KEY_${id.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`; process.env[keyEnv] = fake.key;
  await db.insert(schema.aiProviders).values({ id, name: `Fake ${id}`, kind: "openai_compatible", baseUrl: fake.url, keyEnv, label: `Fake ${id}` }).onConflictDoUpdate({ target: schema.aiProviders.id, set: { baseUrl: fake.url, keyEnv, kind: "openai_compatible", enabled: true } });
  for (const m of models) await db.insert(schema.aiModels).values({ id: `${id}:${m.id}`, provider: id, displayName: m.id, category: "text", available: true, enabled: m.enabled ?? true, capabilities: m.capabilities ?? {}, inputPrice: m.inputPrice ?? null, outputPrice: m.outputPrice ?? null, contextWindow: m.contextWindow ?? null, creator: "unknown", route: id }).onConflictDoNothing();
  invalidateCatalog();
  return { keyEnv, cleanup: async () => { await db.delete(schema.aiModels).where(eq(schema.aiModels.provider, id)); await db.delete(schema.aiProviders).where(eq(schema.aiProviders.id, id)); delete process.env[keyEnv]; invalidateCatalog(); } };
}
