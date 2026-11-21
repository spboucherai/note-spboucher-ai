/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : tests/unit/ai-providers.test.ts
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
 * Multi-provider architecture (SPEC §3.5): provider registry, OpenAI-compatible adapter (Chat Completions + SSE) against a local fake
 * server — streaming, tools, JSON schema, errors, retries, timeouts —, catalogue discovery through /models, manual-only routing of
 * unbenchmarked models, creator derivation, logo registry and the model view of GET /api/ai/models. No real provider is called.
 */
import "../helpers/testdb";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db, schema, sql } from "../../src/db/index";
import { startFakeLLM, registerFakeProvider, type FakeLLM } from "../helpers/fake-llm";
import { streamAI, callAI, outputCap, reasons, REASONING_HEADROOM } from "../../src/lib/ai/providers";
import { buildChatCompletionsBody, normaliseModelEntry, fetchModelList, streamOpenAICompatible } from "../../src/lib/ai/openai-compatible";
import { loadProviders, providerConfigured, providerDef, configuredMap, BUILTIN_PROVIDERS, catalogId, remoteModelId } from "../../src/lib/ai/registry";
import { listModels, refreshDiscovery, invalidateCatalog, getModel, costUsd } from "../../src/lib/ai/catalog";
import { route, DEFAULT_ROUTES, autoRoutable } from "../../src/lib/ai/router";
import { creatorOf, creatorInfo, CREATORS, ROUTE_LOGOS, GENERIC_LOGO, logoOf, SIMPLE_ICONS_VERSION } from "../../src/lib/ai/creators";
import { modelView, normaliseCapabilities, providerView, isKeylessCompat } from "../../src/lib/ai/models-view";
import type { AIEvent } from "../../src/lib/ai/types";
import net from "node:net";
import { CONNECT_ATTEMPT_MS, applyNetDefaults } from "../../src/lib/net-defaults";

const P = `fake_${Date.now().toString(36)}`; let fake: FakeLLM; let cleanup: () => Promise<void>;
const collect = async (g: AsyncGenerator<AIEvent>) => { const out: AIEvent[] = []; for await (const e of g) out.push(e); return out; };
const call = (model: string, extra: Record<string, unknown> = {}) => collect(streamAI({ provider: P, model: `${P}:${model}`, messages: [{ role: "user", content: "Bonjour" }], ...extra } as any));

before(async () => {
  fake = await startFakeLLM();
  const r = await registerFakeProvider(fake, P, [
    { id: "echo", inputPrice: 2, outputPrice: 10, contextWindow: 32_000, capabilities: { tools: true, structured_output: true, vision: false } },
    { id: "tools", capabilities: { tools: true } }, { id: "plain", capabilities: { tools: false, structured_output: false, json_mode: true } },
    { id: "err-401" }, { id: "err-429" }, { id: "err-500" }, { id: "flaky-503" }, { id: "midstream" }, { id: "stall" }, { id: "hang" }, { id: "close-empty" },
  ]);
  cleanup = r.cleanup; await loadProviders(true);
});
after(async () => { await cleanup(); await fake.close(); await sql.end(); });

// ---------- registry
test("outbound connections: loading the provider layer raises the per-address connection attempt timeout (a lost SYN is not a provider time-out)", async () => {
  // Found with the real providers on 2026-11-19: with Node's default (500 ms) 6 of 10 calls on a new connection failed after ~0.51 s as
  // "Request timed out." (first SYN retransmitted after 1 s, IPv6 unreachable); see src/lib/net-defaults.ts. `providers.ts` is imported above.
  assert.ok(CONNECT_ATTEMPT_MS >= 3000, "covers the two first TCP retransmissions (1 s + 2 s)");
  assert.ok(net.getDefaultAutoSelectFamilyAttemptTimeout() >= CONNECT_ATTEMPT_MS, `in force after import: ${net.getDefaultAutoSelectFamilyAttemptTimeout()} ms`);
  // idempotent, and it never lowers a larger value chosen by the operator
  net.setDefaultAutoSelectFamilyAttemptTimeout(CONNECT_ATTEMPT_MS + 4000); assert.equal(applyNetDefaults(), CONNECT_ATTEMPT_MS + 4000);
  net.setDefaultAutoSelectFamilyAttemptTimeout(250); assert.equal(applyNetDefaults(), CONNECT_ATTEMPT_MS); assert.equal(applyNetDefaults(), CONNECT_ATTEMPT_MS);
  // every module that opens a provider connection carries the import (a new client added elsewhere must add it too)
  for (const f of ["src/lib/ai/providers.ts", "src/lib/search/embed.ts", "src/lib/ai/transcribe.ts", "src/lib/ai/catalog.ts", "src/worker/index.ts", "src/instrumentation.ts"]) assert.match(fs.readFileSync(path.join(process.cwd(), f), "utf8"), /net-defaults/, f);
  const clients = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? clients(path.join(dir, e.name)) : /\.tsx?$/.test(e.name) && /new (OpenAI|Anthropic)\(/.test(fs.readFileSync(path.join(dir, e.name), "utf8")) ? [path.join(dir, e.name)] : []));
  for (const f of clients(path.join(process.cwd(), "src"))) assert.match(fs.readFileSync(f, "utf8"), /net-defaults/, `${f} creates a provider client without importing net-defaults`);
});
test("output cap: a reasoning call is sent its answer budget PLUS a reasoning allowance; a call without reasoning keeps its budget", () => {
  // Recorded from the real provider (ai_usage, 2026-11-19, task brief-summary, claude-haiku-5-5, effort low, cap sent = 700):
  // output / reasoning tokens of the 7 calls. Six stopped at the cap; two spent everything reasoning and returned no text at all.
  const recorded = [[700, 700], [700, 480], [672, 420], [700, 556], [700, 530], [700, 553], [700, 700]];
  assert.equal(recorded.filter(([out]) => out === 700).length, 6); assert.equal(recorded.filter(([out, r]) => out === r).length, 2);
  const cap = outputCap(700, "low", reasons("anthropic", "claude-haiku-5-5", "low"), 128_000);
  assert.equal(cap, 700 + REASONING_HEADROOM.low); for (const [, r] of recorded) assert.ok(cap - r >= 700, "the whole answer budget is left after the reasoning that was observed");
  // reasoning is on exactly when the request builders turn it on
  assert.equal(reasons("anthropic", "claude-haiku-5-5", undefined), false); assert.equal(reasons("anthropic", "claude-sonnet-4-5-20250929", "low"), false); assert.equal(reasons("anthropic", "claude-sonnet-4-5-20250929", "medium"), true);
  assert.equal(reasons("openai", "gpt-6-sol", "medium"), true); assert.equal(reasons("openai", "gpt-4o", "medium"), false); assert.equal(reasons("openai", "gpt-5-chat-latest", "high"), false);
  // no reasoning → the budget unchanged (and the historical default of 8 000)
  assert.equal(outputCap(400, undefined, false), 400); assert.equal(outputCap(400, "high", false), 400); assert.equal(outputCap(undefined, null, false), 8000);
  // the allowance grows with the effort and never exceeds the model's own output limit
  assert.equal(outputCap(6000, "high", true, 128_000), 18_000); assert.equal(outputCap(6000, "medium", true), 12_000); assert.equal(outputCap(6000, "high", true, 8000), 8000); assert.equal(outputCap(6000, "high", true, 4000), 6000 /* never below the caller's own budget, which is what was sent before */);
  assert.ok(REASONING_HEADROOM.medium > 2048 && REASONING_HEADROOM.high > 2048, "above the fixed 2 048-token thinking budget of the 4.5 models, which think from effort medium up");
});
test("registry: the four SPEC providers are seeded with kind, base URL and key variable NAME; availability = key present", async () => {
  const rows = await db.select().from(schema.aiProviders);
  const by = new Map(rows.map((r) => [r.id, r]));
  assert.deepEqual([by.get("openai")?.kind, by.get("anthropic")?.kind], ["openai", "anthropic"]);
  assert.equal(by.get("openrouter")?.baseUrl, "https://openrouter.ai/api/v1"); assert.equal(by.get("openrouter")?.keyEnv, "OPENROUTER_API_KEY"); assert.equal(by.get("openrouter")?.kind, "openai_compatible");
  assert.equal(by.get("maclustr")?.baseUrl, "https://llm.spboucher.ai/v1"); assert.equal(by.get("maclustr")?.keyEnv, "MACLUSTR_LLM_API_KEY");
  assert.deepEqual(BUILTIN_PROVIDERS.map((p) => p.id), ["openai", "anthropic", "openrouter", "maclustr"]);
  const saved = process.env.OPENROUTER_API_KEY; delete process.env.OPENROUTER_API_KEY;
  assert.equal(providerConfigured("openrouter"), false, "no key → unavailable");
  process.env.OPENROUTER_API_KEY = "x-test"; assert.equal(providerConfigured("openrouter"), true); assert.equal(configuredMap().openrouter, true);
  if (saved === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = saved;
  assert.equal(providerConfigured("nope"), false); assert.equal(providerDef(P)?.kind, "openai_compatible");
  assert.equal(catalogId("openrouter", "anthropic/claude-x"), "openrouter:anthropic/claude-x"); assert.equal(remoteModelId("openrouter", "openrouter:anthropic/claude-x"), "anthropic/claude-x"); assert.equal(remoteModelId("openai", "gpt-6-sol"), "gpt-6-sol");
});
test("registry: a disabled provider row is not configured even with a key; the key value never appears in a provider view", async () => {
  await db.update(schema.aiProviders).set({ enabled: false }).where(eq(schema.aiProviders.id, P)); await loadProviders(true);
  assert.equal(providerConfigured(P), false);
  await db.update(schema.aiProviders).set({ enabled: true }).where(eq(schema.aiProviders.id, P)); await loadProviders(true);
  assert.equal(providerConfigured(P), true);
  const v = providerView(providerDef(P)!, null); assert.equal(v.configured, true); assert.match(v.keyEnv!, /^FAKE_LLM_KEY_/);
  assert.ok(!JSON.stringify(v).includes(fake.key), "the key itself is never serialised");
});

// ---------- adapter: wire contract
test("adapter: request body is Chat Completions — system message, images as image_url parts, stream + usage, tools, strict JSON schema", () => {
  const b: any = buildChatCompletionsBody({ provider: P, model: "x", system: "SYS", maxTokens: 123, messages: [{ role: "user", content: "hi", images: [{ mime: "image/png", dataBase64: "AAAA" }] }, { role: "assistant", content: "yo" }],
    tools: [{ name: "t", description: "d", parameters: { type: "object" } }], jsonSchema: { name: "s", schema: { type: "object" } }, effort: "low" }, "remote/x", { structured_output: true, reasoning: true });
  assert.equal(b.model, "remote/x"); assert.equal(b.stream, true); assert.deepEqual(b.stream_options, { include_usage: true }); assert.equal(b.max_tokens, 123);
  assert.deepEqual(b.messages[0], { role: "system", content: "SYS" });
  assert.deepEqual(b.messages[1].content[0], { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } }); assert.deepEqual(b.messages[1].content[1], { type: "text", text: "hi" });
  assert.deepEqual(b.messages[2], { role: "assistant", content: "yo" });
  assert.deepEqual(b.tools, [{ type: "function", function: { name: "t", description: "d", parameters: { type: "object" } } }]);
  assert.deepEqual(b.response_format, { type: "json_schema", json_schema: { name: "s", schema: { type: "object" }, strict: true } }); assert.equal(b.reasoning_effort, "low");
});
test("adapter: a model without structured outputs gets the schema in the system prompt (+ json_object only when it declares JSON mode)", () => {
  const o = { provider: P, model: "x", system: "SYS", messages: [{ role: "user" as const, content: "hi" }], jsonSchema: { name: "s", schema: { type: "object", properties: { a: { type: "string" } } } }, effort: "high" as const };
  const a: any = buildChatCompletionsBody(o, "x", { json_mode: true });
  assert.deepEqual(a.response_format, { type: "json_object" }); assert.match(a.messages[0].content, /^SYS\n\nReturn ONLY one JSON object/); assert.match(a.messages[0].content, /"properties":\{"a"/); assert.equal(a.reasoning_effort, undefined);
  const b: any = buildChatCompletionsBody(o, "x", {}); assert.equal(b.response_format, undefined); assert.match(b.messages[0].content, /JSON Schema/);
});

// ---------- adapter: streaming against the fake server
test("adapter: streams text deltas, reports usage (cached + reasoning tokens), stop reason and TTFT; sends the bearer key and the remote id", async () => {
  fake.reply = () => "Réponse diffusée en plusieurs morceaux."; fake.requests.length = 0;
  const ev = await call("echo", { system: "Tu es un test." });
  const text = ev.filter((e) => e.type === "text").map((e: any) => e.delta); assert.ok(text.length > 3, "several deltas"); assert.equal(text.join(""), "Réponse diffusée en plusieurs morceaux.");
  const done = ev.at(-1) as Extract<AIEvent, { type: "done" }>; assert.equal(done.type, "done");
  assert.deepEqual(done.usage, { inputTokens: 120, outputTokens: text.length, cachedTokens: 20, reasoningTokens: 3 }); assert.equal(done.stop, "stop"); assert.ok(done.ttftMs !== null && done.ttftMs >= 0); assert.equal(done.refusal, undefined);
  const req = fake.requests.at(-1)!; assert.equal(req.path, "/v1/chat/completions"); assert.equal(req.auth, `Bearer ${fake.key}`);
  assert.equal(req.body.model, "echo", "the catalogue namespace is stripped on the wire"); assert.equal(req.body.messages[0].role, "system");
});
test("adapter: callAI collects the stream and prices it from the catalogue row (USD per 1M tokens, cached tokens at input price)", async () => {
  fake.reply = () => "abcdefg".repeat(3);
  const r = await callAI({ provider: P, model: `${P}:echo`, messages: [{ role: "user", content: "x" }] });
  assert.equal(r.text, "abcdefg".repeat(3)); assert.equal(r.usage.inputTokens, 120); assert.equal(r.usage.outputTokens, 3);
  assert.equal(r.costUsd, (120 * 2 + 3 * 10) / 1e6); assert.equal(costUsd(await getModel(`${P}:plain`), r.usage), null, "no published price → cost unknown, never invented");
});
test("adapter: tool-call arguments split over several deltas are reassembled into one tool_call event", async () => {
  const ev = await call("tools", { tools: [{ name: "propose_tags", description: "d", parameters: { type: "object" } }] });
  const tc = ev.filter((e) => e.type === "tool_call") as Extract<AIEvent, { type: "tool_call" }>[];
  assert.equal(tc.length, 1); assert.equal(tc[0].id, "call_abc"); assert.equal(tc[0].name, "propose_tags"); assert.deepEqual(tc[0].args, { pageId: "p-1", tags: ["a", "b"] });
  assert.equal((ev.at(-1) as any).stop, "tool_calls"); assert.equal(fake.requests.at(-1)!.body.tools[0].function.name, "propose_tags");
});
test("adapter: JSON schema is sent as response_format json_schema to a model that declares structured outputs, as a prompt otherwise", async () => {
  fake.reply = () => '{"ok":true}'; const schemaOpt = { jsonSchema: { name: "r", schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false } } };
  const a = await callAI({ provider: P, model: `${P}:echo`, messages: [{ role: "user", content: "x" }], ...schemaOpt }); assert.deepEqual(JSON.parse(a.text), { ok: true });
  assert.equal(fake.requests.at(-1)!.body.response_format.type, "json_schema"); assert.equal(fake.requests.at(-1)!.body.response_format.json_schema.strict, true);
  await callAI({ provider: P, model: `${P}:plain`, messages: [{ role: "user", content: "x" }], ...schemaOpt });
  const b = fake.requests.at(-1)!.body; assert.deepEqual(b.response_format, { type: "json_object" }); assert.match(b.messages[0].content, /JSON Schema/);
});

// ---------- adapter: errors and timeouts
test("adapter: HTTP 401 surfaces the provider message and status, is not retried, and never leaks the key", async () => {
  fake.requests.length = 0; const ev = await call("err-401");
  assert.equal(ev.length, 1); const e = ev[0] as Extract<AIEvent, { type: "error" }>; assert.equal(e.type, "error"); assert.equal(e.status, 401); assert.match(e.message, /Incorrect API key/);
  assert.ok(!e.message.includes(fake.key)); assert.equal(fake.requests.length, 1, "no retry on 401");
});
test("adapter: 429 and 500 are retried (2 retries) then reported with their status; a 503 followed by success succeeds", async () => {
  fake.requests.length = 0; const a = await collect(streamOpenAICompatible({ provider: P, model: `${P}:err-429`, messages: [{ role: "user", content: "x" }] }, { retries: 2 }));
  assert.equal((a[0] as any).status, 429); assert.match((a[0] as any).message, /Rate limit/); assert.equal(fake.requests.length, 3, "1 try + 2 retries");
  fake.requests.length = 0; const b = await collect(streamOpenAICompatible({ provider: P, model: `${P}:err-500`, messages: [{ role: "user", content: "x" }] }, { retries: 1 }));
  assert.equal((b[0] as any).status, 500); assert.equal(fake.requests.length, 2);
  fake.requests.length = 0; fake.flakyFailures = 1; fake.reply = () => "ok après reprise"; const c = await call("flaky-503");
  assert.equal(c.at(-1)!.type, "done"); assert.equal(c.filter((e) => e.type === "text").map((e: any) => e.delta).join(""), "ok après reprise"); assert.equal(fake.requests.length, 2);
});
test("adapter: an error frame in the middle of the stream ends the call as an error (the partial text is not a completed answer)", async () => {
  fake.reply = () => "début de réponse"; const ev = await call("midstream");
  assert.equal(ev.at(-1)!.type, "error"); assert.match((ev.at(-1) as any).message, /Upstream provider disconnected/); assert.equal((ev.at(-1) as any).status, 502);
  assert.ok(!ev.some((e) => e.type === "done")); await assert.rejects(callAI({ provider: P, model: `${P}:midstream`, messages: [{ role: "user", content: "x" }] }), /Upstream provider disconnected/);
});
test("adapter: idle timeout (stream stalls), total timeout (no answer) and caller abort are three distinct, bounded outcomes", async () => {
  const t0 = Date.now(); const stall = await collect(streamOpenAICompatible({ provider: P, model: `${P}:stall`, messages: [{ role: "user", content: "x" }] }, { idleTimeoutMs: 300 }));
  assert.equal(stall.at(-1)!.type, "error"); assert.match((stall.at(-1) as any).message, /^timeout: no data/); assert.equal((stall.at(-1) as any).status, 408); assert.ok(Date.now() - t0 < 5000);
  const t1 = Date.now(); const hang = await collect(streamOpenAICompatible({ provider: P, model: `${P}:hang`, messages: [{ role: "user", content: "x" }], timeoutMs: 400 }, { retries: 0 }));
  assert.match((hang.at(-1) as any).message, /^timeout: no complete answer/); assert.ok(Date.now() - t1 < 5000);
  const ac = new AbortController(); setTimeout(() => ac.abort(), 150);
  const ab = await collect(streamOpenAICompatible({ provider: P, model: `${P}:hang`, messages: [{ role: "user", content: "x" }], signal: ac.signal }, { retries: 0 }));
  assert.deepEqual(ab, [{ type: "error", message: "aborted" }]);
});
test("adapter: an empty 200 stream is an error, a missing key is an error before any request, an unknown provider is refused", async () => {
  const e = await call("close-empty"); assert.equal(e.at(-1)!.type, "error"); assert.match((e.at(-1) as any).message, /without an answer/);
  const env = providerDef(P)!.keyEnv!; const saved = process.env[env]; delete process.env[env]; fake.requests.length = 0;
  const nk = await call("echo"); assert.equal(nk[0].type, "error"); assert.match((nk[0] as any).message, new RegExp(`${env} is not set`)); assert.equal(fake.requests.length, 0);
  process.env[env] = saved;
  const un = await collect(streamAI({ provider: "does-not-exist", model: "m", messages: [{ role: "user", content: "x" }] })); assert.match((un[0] as any).message, /Unknown AI provider/);
});

// ---------- catalogue discovery
const OPENROUTER_ENTRY = { id: "anthropic/claude-test-9", name: "Anthropic: Claude Test 9", created: 1760000000, context_length: 200000, architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] }, pricing: { prompt: "0.000003", completion: "0.000015", input_cache_read: "0.0000003" }, top_provider: { max_completion_tokens: 64000 }, supported_parameters: ["tools", "structured_outputs", "response_format", "reasoning", "max_tokens"] };
test("discovery: an OpenRouter-style /models entry gives context, USD-per-1M prices and declared capabilities; a bare entry stays unknown", () => {
  const m = normaliseModelEntry(OPENROUTER_ENTRY)!;
  assert.equal(m.remoteId, "anthropic/claude-test-9"); assert.equal(m.contextWindow, 200000); assert.equal(m.maxOutput, 64000);
  assert.equal(m.inputPrice, 3); assert.equal(m.outputPrice, 15); assert.equal(m.cachedPrice, 0.3);
  assert.deepEqual({ tools: m.capabilities.tools, so: m.capabilities.structured_output, jm: m.capabilities.json_mode, vision: m.capabilities.vision, reasoning: m.capabilities.reasoning }, { tools: true, so: true, jm: true, vision: true, reasoning: true });
  const bare = normaliseModelEntry({ id: "mlx-community/Qwen3-30B-A3B-4bit", object: "model" })!;
  assert.equal(bare.contextWindow, null); assert.equal(bare.inputPrice, null); assert.equal(bare.capabilities.tools, null); assert.equal(bare.textOutput, true);
  assert.equal(normaliseModelEntry({ id: "img/gen", architecture: { output_modalities: ["image"] } })!.textOutput, false); assert.equal(normaliseModelEntry({ name: "no id" }), null);
  assert.equal(normaliseModelEntry({ id: "free/model", pricing: { prompt: "0", completion: "0" } })!.inputPrice, 0, "a published price of 0 is 0, not unknown");
});
test("discovery: /models is listed with the key, refused without it, and readable keyless when the catalogue is public", async () => {
  fake.models = [OPENROUTER_ENTRY, { id: "mlx-community/Qwen3-30B-A3B-4bit", object: "model" }, { id: "img/gen", architecture: { output_modalities: ["image"] } }];
  fake.modelsPublic = false; assert.equal((await fetchModelList(fake.url, fake.key)).length, 3);
  await assert.rejects(fetchModelList(fake.url, null), /HTTP 401/);
  fake.modelsPublic = true; assert.equal((await fetchModelList(fake.url, null)).length, 3);
});
test("discovery: refresh inserts namespaced models (creator, route, price, context), enabled for manual use, with no probe data; a vanished model becomes unlisted; `enabled` set by the owner survives", async () => {
  fake.modelsPublic = false; fake.models = [OPENROUTER_ENTRY, { id: "mlx-community/Qwen3-30B-A3B-4bit", object: "model" }, { id: "img/gen", architecture: { output_modalities: ["image"] } }];
  const rep = await refreshDiscovery([P]); assert.deepEqual(rep[P], { listed: 2, status: "ok" });
  const m = await getModel(`${P}:anthropic/claude-test-9`); assert.ok(m);
  assert.equal(m!.creator, "anthropic"); assert.equal(m!.route, P); assert.equal(m!.provider, P); assert.equal(m!.inputPrice, 3); assert.equal(m!.outputPrice, 15); assert.equal(m!.contextWindow, 200000);
  assert.equal(m!.enabled, true); assert.deepEqual(m!.probes, {}); assert.deepEqual(m!.benchmark, {}); assert.equal(autoRoutable(m!), false);
  assert.equal((await getModel(`${P}:mlx-community/Qwen3-30B-A3B-4bit`))!.creator, "qwen"); assert.equal(await getModel(`${P}:img/gen`), null, "image-only models are not text models");
  await db.update(schema.aiModels).set({ enabled: false }).where(eq(schema.aiModels.id, `${P}:anthropic/claude-test-9`));
  fake.models = [OPENROUTER_ENTRY]; await refreshDiscovery([P]);
  assert.equal((await getModel(`${P}:anthropic/claude-test-9`))!.enabled, false, "owner's toggle kept"); assert.equal((await getModel(`${P}:mlx-community/Qwen3-30B-A3B-4bit`))!.available, false);
  const [prov] = await db.select().from(schema.aiProviders).where(eq(schema.aiProviders.id, P)); assert.equal(prov.status, "ok"); assert.ok(prov.lastDiscoveryAt);
  // the hand-registered test models are not in the fake /models list: put them back for the following tests
  await db.update(schema.aiModels).set({ enabled: true, available: true }).where(eq(schema.aiModels.provider, P)); invalidateCatalog();
});
test("discovery: a provider without key is reported `no key` and nothing is called", async () => {
  const env = providerDef(P)!.keyEnv!; const saved = process.env[env]; delete process.env[env]; fake.requests.length = 0;
  const rep = await refreshDiscovery([P]); assert.deepEqual(rep[P], { listed: 0, status: "no key" }); assert.equal(fake.requests.length, 0);
  const [prov] = await db.select().from(schema.aiProviders).where(eq(schema.aiProviders.id, P)); assert.equal(prov.status, "no_key");
  process.env[env] = saved; await loadProviders(true);
});

// ---------- routing
test("routing: the measured routing table is unchanged and never points at a new-provider model", () => {
  assert.deepEqual(Object.fromEntries(Object.entries(DEFAULT_ROUTES).map(([k, v]) => [k, [v.primary, v.fallback]])), {
    chat: ["gpt-6-sol", "claude-sonnet-5-5"], quick: ["claude-haiku-5-5", "gpt-5.4-mini"], write: ["gpt-6-sol", "claude-sonnet-4-6"], reason: ["claude-opus-5-5", "gpt-6-astra"], deep: ["claude-fable-5-1", "gpt-6-astra"],
    code: ["gpt-5.3-codex", "claude-sonnet-5-5"], extract: ["gpt-5.4-mini", "claude-haiku-5-5"], longctx: ["gpt-6.1-terra", "claude-sonnet-5-5"], agent: ["claude-sonnet-5-5", "gpt-5.4"], judge: ["claude-haiku-5-5", "gpt-5.4-mini"] });
});
test("routing: an unbenchmarked model is used only when chosen by hand, on its declared capabilities; it is never picked automatically", async () => {
  const manual = await route({ task: "chat", preferred: `${P}:echo` }); assert.equal(manual.model.id, `${P}:echo`); assert.equal(manual.provider, P); assert.equal(manual.reason, "user selection");
  assert.equal((await route({ task: "agent", tools: true, preferred: `${P}:echo` })).model.id, `${P}:echo`, "declares tools");
  // a model that does not declare tools / vision is refused for a request that needs them → falls back to the measured route (or to nothing)
  const savedO = process.env.OPENAI_API_KEY, savedA = process.env.ANTHROPIC_API_KEY; delete process.env.OPENAI_API_KEY; delete process.env.ANTHROPIC_API_KEY;
  try {
    await assert.rejects(route({ task: "agent", tools: true, preferred: `${P}:plain` }), /No eligible AI model/);
    await assert.rejects(route({ task: "chat", vision: true, preferred: `${P}:echo` }), /No eligible AI model/);
    await assert.rejects(route({ task: "chat", estTokens: 100_000, preferred: `${P}:echo` }), /No eligible AI model/, "context window respected");
    // with only the fake provider configured, automatic routing finds NOTHING: new-provider models are not in automatic routing
    for (const task of Object.keys(DEFAULT_ROUTES) as (keyof typeof DEFAULT_ROUTES)[]) await assert.rejects(route({ task }), /No eligible AI model/, task);
    assert.equal((await route({ task: "chat", schema: true, preferred: `${P}:plain` })).model.id, `${P}:plain`, "schema accepted: enforced by prompt + validation");
  } finally { if (savedO) process.env.OPENAI_API_KEY = savedO; if (savedA) process.env.ANTHROPIC_API_KEY = savedA; }
  const all = await listModels(true); assert.ok(all.filter((m) => m.provider === P).every((m) => !autoRoutable(m)));
});
test("routing: a disabled or unlisted new-provider model cannot be selected, nor one whose provider has no key", async () => {
  await db.update(schema.aiModels).set({ enabled: false }).where(eq(schema.aiModels.id, `${P}:tools`)); invalidateCatalog();
  const savedO = process.env.OPENAI_API_KEY, savedA = process.env.ANTHROPIC_API_KEY; delete process.env.OPENAI_API_KEY; delete process.env.ANTHROPIC_API_KEY;
  try {
    await assert.rejects(route({ task: "chat", preferred: `${P}:tools` }), /No eligible AI model/);
    const env = providerDef(P)!.keyEnv!; const saved = process.env[env]; delete process.env[env];
    await assert.rejects(route({ task: "chat", preferred: `${P}:echo` }), /No eligible AI model/); process.env[env] = saved;
  } finally { if (savedO) process.env.OPENAI_API_KEY = savedO; if (savedA) process.env.ANTHROPIC_API_KEY = savedA; }
  await db.update(schema.aiModels).set({ enabled: true }).where(eq(schema.aiModels.id, `${P}:tools`)); invalidateCatalog();
});

// ---------- creators and logos
test("creator: derived from the vendor prefix, else from the model name, else the native provider; packagers and namespaces are ignored", () => {
  const cases: [string, string | null, string][] = [
    ["claude-haiku-5-5", "anthropic", "anthropic"], ["gpt-6-sol", "openai", "openai"], ["o3-mini", "openai", "openai"], ["text-embedding-3-small", "openai", "openai"],
    ["openrouter:anthropic/claude-sonnet-4.5", "openrouter", "anthropic"], ["openrouter:openai/gpt-5", "openrouter", "openai"], ["openrouter:google/gemini-2.5-pro", "openrouter", "google"],
    ["openrouter:meta-llama/llama-4-maverick", "openrouter", "meta"], ["openrouter:mistralai/mistral-large", "openrouter", "mistral"], ["openrouter:qwen/qwen3-max", "openrouter", "qwen"],
    ["openrouter:deepseek/deepseek-r1", "openrouter", "deepseek"], ["openrouter:x-ai/grok-4", "openrouter", "xai"], ["openrouter:cohere/command-r-plus", "openrouter", "cohere"],
    ["openrouter:microsoft/phi-4", "openrouter", "microsoft"], ["openrouter:amazon/nova-pro-v1", "openrouter", "amazon"], ["openrouter:nvidia/nemotron-70b", "openrouter", "nvidia"],
    ["openrouter:moonshotai/kimi-k2", "openrouter", "moonshot"], ["openrouter:z-ai/glm-4.6", "openrouter", "zhipu"], ["openrouter:perplexity/sonar-pro", "openrouter", "perplexity"],
    ["maclustr:mlx-community/Qwen3-30B-A3B-Instruct-4bit", "maclustr", "qwen"], ["maclustr:mlx-community/DeepSeek-R1-Distill-Qwen-32B-4bit", "maclustr", "deepseek"], ["maclustr:mlx-community/Mistral-Small-3.2-24B", "maclustr", "mistral"],
    ["maclustr:maclustr-coder", "maclustr", "unknown"], ["openrouter:somelab/new-model", "openrouter", "somelab"], ["openrouter:Some_Lab/x", "openrouter", "some-lab"], ["mystery", null, "unknown"], ["", "openai", "openai"],
  ];
  for (const [id, provider, want] of cases) assert.equal(creatorOf(id, provider), want, `${id} via ${provider}`);
});
test("logos: every registered logo file exists and comes from simple-icons or is the generic mark; registry.json mirrors creators.ts", () => {
  const dir = path.resolve("public/model-logos"); const reg = JSON.parse(fs.readFileSync(path.join(dir, "registry.json"), "utf8"));
  assert.equal(reg.generatedFrom, `simple-icons@${SIMPLE_ICONS_VERSION}`); assert.equal(reg.fallback, "generic.svg");
  assert.equal(reg.entries.length, CREATORS.length + ROUTE_LOGOS.length);
  for (const c of CREATORS) {
    const e = reg.entries.find((x: any) => x.id === c.id && x.kind === "creator"); assert.ok(e, c.id);
    assert.equal(e.logo, logoOf(c)); assert.equal(e.generic, c.simpleIcon === null); assert.equal(creatorInfo(c.id).logo, e.logo);
    const file = path.join(dir, e.file); assert.ok(fs.existsSync(file), e.file); const svg = fs.readFileSync(file, "utf8"); assert.match(svg, /^<svg[^>]*viewBox="0 0 24 24"/);
    if (c.simpleIcon) { assert.equal(e.source, `simple-icons@${SIMPLE_ICONS_VERSION}:${c.simpleIcon}`); assert.equal(svg.trim(), fs.readFileSync(path.resolve(`node_modules/simple-icons/icons/${c.simpleIcon}.svg`), "utf8").trim(), `${c.id}.svg is the simple-icons file, byte for byte`); }
    else { assert.equal(e.file, "generic.svg"); assert.equal(e.logo, GENERIC_LOGO); assert.ok(c.monogram.length === 2); }
  }
  assert.equal(creatorInfo("openai").logo, GENERIC_LOGO, "OpenAI is not in simple-icons 16: generic mark, not a redrawn logo");
  const odd = creatorInfo("somelab"); assert.equal(odd.logo, GENERIC_LOGO); assert.equal(odd.name, "Somelab"); assert.equal(odd.monogram, "SO"); assert.equal(creatorInfo(null).id, "unknown");
});

// ---------- GET /api/ai/models view
test("model view: creator ≠ route, logo, context, prices, normalised capabilities and availability with its reason", async () => {
  const v = modelView((await getModel(`${P}:anthropic/claude-test-9`))!);
  assert.equal(v.creator, "anthropic"); assert.equal(v.creatorName, "Anthropic"); assert.equal(v.logo, "/model-logos/anthropic.svg"); assert.equal(v.route, P); assert.equal(v.routeKind, "openai_compatible"); assert.equal(v.remoteId, "anthropic/claude-test-9");
  assert.equal(v.context, 200000); assert.equal(v.priceIn, 3); assert.equal(v.priceOut, 15); assert.equal(v.priceCached, 0.3);
  assert.deepEqual({ t: v.capabilities.tools, s: v.capabilities.structuredOutput, v: v.capabilities.vision, src: v.capabilities.source }, { t: true, s: true, v: true, src: "declared" });
  assert.equal(v.available, true); assert.equal(v.unavailableReason, null); assert.equal(v.autoRoutable, false); assert.equal(v.benchmarked, false);
  const env = providerDef(P)!.keyEnv!; const saved = process.env[env]; delete process.env[env];
  const nk = modelView((await getModel(`${P}:anthropic/claude-test-9`))!); assert.equal(nk.available, false); assert.equal(nk.unavailableReason, "no_key"); assert.equal(nk.listed, true);
  assert.equal(isKeylessCompat(nk), true, "left out of the default catalogue answer"); assert.equal(isKeylessCompat(v), false); assert.equal(isKeylessCompat({ unavailableReason: "no_key", routeKind: "openai" }), false, "native providers keep their historical listing");
  process.env[env] = saved;
  const haiku = await getModel("claude-haiku-5-5"); assert.ok(haiku, "seeded catalogue present (pnpm seed:ai)");
  const h = modelView(haiku!); assert.equal(h.creator, "anthropic"); assert.equal(h.route, "anthropic"); assert.equal(h.capabilities.source, "measured"); assert.equal(h.capabilities.tools, true); assert.equal(h.autoRoutable, true);
  assert.equal(h.priceIn, haiku!.inputPrice); assert.equal(h.inputPrice, haiku!.inputPrice, "historical fields are still there");
  assert.deepEqual(normaliseCapabilities({ probes: {}, capabilities: {} }), { text: null, streaming: null, tools: null, structuredOutput: null, jsonMode: null, vision: null, reasoning: null, source: "unknown" });
});
