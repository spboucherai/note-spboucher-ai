/**
 * Phase Zero §5.2 — real model discovery.
 * Lists models from both providers, classifies them, and PROBES each candidate text model with
 * real requests: text, streaming, tool use, structured output, vision, reasoning control.
 * Output: benchmarks/results/discovery.json (+ raw per-probe log).
 */
import fs from "node:fs";
import path from "node:path";
import { openai, anthropic, RESULTS, RAW, writeJSON, appendJSONL, priceFor, pLimit, estimateCost } from "./lib.ts";
import { call, type CallOpts } from "./providers.ts";

type ProbeStatus = "ok" | "unsupported" | "error" | "untested" | "unavailable";
interface Probe { status: ProbeStatus; ms?: number; detail?: string; }
interface ModelRecord {
  provider: "openai" | "anthropic"; id: string; display?: string; created?: string; family: string;
  category: "text" | "text-specialized" | "embedding" | "audio" | "image" | "video" | "moderation" | "legacy-completion" | "search" | "deep-research" | "realtime" | "unknown";
  aliasOf?: string | null;
  context?: number | null; maxOutput?: number | null; capabilities?: unknown;
  pricing: ReturnType<typeof priceFor>;
  probes: Record<string, Probe>;
  verdict: "tested" | "unsupported" | "untested" | "unavailable";
  notes: string[];
}

const SCHEMA = { type: "object", properties: { city: { type: "string" }, population_millions: { type: "number" } }, required: ["city", "population_millions"], additionalProperties: false };
const TOOL = [{ name: "get_weather", description: "Get current weather for a city", parameters: { type: "object", properties: { city: { type: "string" } }, required: ["city"], additionalProperties: false } }];

function classifyOpenAI(id: string): ModelRecord["category"] {
  if (/embedding/.test(id)) return "embedding";
  if (/moderation/.test(id)) return "moderation";
  if (/sora/.test(id)) return "video";
  if (/image|dall-e/.test(id)) return "image";
  if (/realtime|live/.test(id)) return "realtime";
  if (/audio|tts|transcribe|whisper/.test(id)) return "audio";
  if (/deep-research/.test(id)) return "deep-research";
  if (/search/.test(id)) return "search";
  if (/babbage|davinci|instruct/.test(id)) return "legacy-completion";
  if (/codex/.test(id)) return "text-specialized";
  if (/^(gpt|o\d|chat-latest)/.test(id)) return "text";
  return "unknown";
}
const family = (id: string) => id.replace(/-\d{4}-\d{2}-\d{2}$/, "").replace(/-(mini|nano|pro|chat-latest|codex.*|astra|luna|sol|terra)$/, "");

async function probeModel(rec: ModelRecord, log: string) {
  const p = rec.provider;
  const base: Partial<CallOpts> = { model: rec.id, maxTokens: 4000, timeoutMs: 180_000 };
  const run = async (name: string, o: CallOpts, check: (r: any) => string | null) => {
    const r = await call(p, o);
    appendJSONL(log, { model: rec.id, probe: name, ok: r.ok, ms: Math.round(r.total_ms), error: r.error, status: r.status, usage: r.usage, text: r.text.slice(0, 200), tools: r.toolCalls });
    if (!r.ok) {
      const unsupported = r.status === 400 || r.status === 404 || /not supported|does not support|unsupported|invalid model|not found|does not exist|Unsupported/i.test(r.error ?? "");
      rec.probes[name] = { status: r.status === 404 || /not found|does not exist|no access/i.test(r.error ?? "") ? "unavailable" : unsupported ? "unsupported" : "error", ms: Math.round(r.total_ms), detail: `${r.status ?? ""} ${r.error}`.trim() };
      return r;
    }
    const fail = check(r);
    rec.probes[name] = fail ? { status: "unsupported", ms: Math.round(r.total_ms), detail: fail } : { status: "ok", ms: Math.round(r.total_ms) };
    return r;
  };
  // 1. text (non-stream)
  const t = await run("text", { ...base, prompt: "Reply with exactly the word PONG.", stream: false } as CallOpts, (r) => (/pong/i.test(r.text) ? null : `unexpected: ${r.text.slice(0, 80)}`));
  if (!t.ok) { rec.verdict = rec.probes.text.status === "unavailable" ? "unavailable" : "unsupported"; return; }
  // 2. streaming
  await run("streaming", { ...base, prompt: "Count from 1 to 10 separated by spaces.", stream: true } as CallOpts, (r) => (r.ttft_ms !== null ? null : "no streamed delta"));
  // 3. tool use
  await run("tool_use", { ...base, prompt: "What is the weather in Gatineau right now? Use the get_weather tool.", tools: TOOL, stream: false } as CallOpts, (r) => (r.toolCalls.some((c: any) => c.name === "get_weather") ? null : "no tool call emitted"));
  // 4. structured output
  await run("structured_output", { ...base, prompt: "Give the city Montreal and its population in millions as JSON.", jsonSchema: { name: "city", schema: SCHEMA }, stream: false } as CallOpts, (r) => { try { const j = JSON.parse(r.text); return typeof j.city === "string" && typeof j.population_millions === "number" ? null : "schema mismatch"; } catch { return "invalid JSON"; } });
  // 5. vision
  await run("vision", { ...base, prompt: "What single colour is this image? Answer with one word.", image: true, stream: false } as CallOpts, (r) => (/red/i.test(r.text) ? null : `answer: ${r.text.slice(0, 60)}`));
  // 6. reasoning control
  await run("reasoning_control", { ...base, prompt: "What is 17*23? Answer with the number only.", reasoning: "low", stream: false } as CallOpts, (r) => (/391/.test(r.text) ? null : `answer: ${r.text.slice(0, 60)}`));
  rec.verdict = "tested";
}

async function main() {
  const log = path.join(RAW, "discovery-probes.jsonl");
  fs.rmSync(log, { force: true });
  const records: ModelRecord[] = [];

  // ---- OpenAI
  const oa = await openai.models.list();
  const oaIds: { id: string; created: number; owned_by: string }[] = [];
  for await (const m of oa as any) oaIds.push(m);
  oaIds.sort((a, b) => a.id.localeCompare(b.id));
  const aliasSet = new Set(oaIds.map((m) => m.id));
  for (const m of oaIds) {
    const cat = classifyOpenAI(m.id);
    const aliasOf = /-\d{4}-\d{2}-\d{2}$/.test(m.id) && aliasSet.has(m.id.replace(/-\d{4}-\d{2}-\d{2}$/, "")) ? m.id.replace(/-\d{4}-\d{2}-\d{2}$/, "") : null;
    records.push({ provider: "openai", id: m.id, created: new Date(m.created * 1000).toISOString().slice(0, 10), family: family(m.id), category: cat, aliasOf, pricing: priceFor(m.id), probes: {}, verdict: "untested", notes: [] });
  }
  // ---- Anthropic
  const an = await anthropic.models.list({ limit: 100 });
  for await (const m of an as any) {
    let detail: any = null;
    try { detail = await (anthropic.models as any).retrieve(m.id, null, { headers: { "anthropic-version": "2026-10-21" } }); } catch (e: any) { }
    records.push({ provider: "anthropic", id: m.id, display: m.display_name, created: String(m.created_at).slice(0, 10), family: m.id.replace(/-\d{8}$/, ""), category: "text", aliasOf: null, context: detail?.max_input_tokens ?? null, maxOutput: detail?.max_tokens ?? null, capabilities: detail?.capabilities ?? null, pricing: priceFor(m.id), probes: {}, verdict: "untested", notes: [] });
  }

  // Which to probe: all text / text-specialized aliases (no dated snapshots), all Anthropic models.
  // Pro models are probed for "text" only via the same path (they are slow/expensive) → still real.
  const toProbe = records.filter((r) => (r.provider === "anthropic") || ((r.category === "text" || r.category === "text-specialized") && !r.aliasOf));
  for (const r of records) if (r.aliasOf) r.notes.push(`dated snapshot of ${r.aliasOf}; not probed separately`);
  for (const r of records) if (!toProbe.includes(r) && !r.aliasOf) r.notes.push(`category ${r.category}: not a general text model, not probed (inappropriate request type)`);
  const expensive = (id: string) => /-pro$|^o1-pro|^o3-pro/.test(id);
  console.log(`Probing ${toProbe.length} models…`);
  await pLimit(6, toProbe.map((r) => async () => {
    if (expensive(r.id)) {
      // only text + structured output, small budgets; marks the rest untested for cost reasons.
      r.notes.push("pro/expensive tier: only text + structured_output probed; benchmark skipped for cost ($30-$150/M input)");
    }
    const t0 = Date.now();
    try { await probeModel(r, log); } catch (e: any) { r.notes.push(`probe crashed: ${e?.message}`); r.verdict = "untested"; }
    console.log(`${r.id.padEnd(30)} ${r.verdict.padEnd(12)} ${Object.entries(r.probes).map(([k, v]) => `${k}=${v.status}`).join(" ")}  (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  }));
  // Estimated cost of this discovery run
  let cost = 0;
  for (const line of fs.readFileSync(log, "utf8").split("\n").filter(Boolean)) { const j = JSON.parse(line); if (j.usage) cost += estimateCost(j.model, j.usage.input_tokens, j.usage.output_tokens, j.usage.cached_tokens) ?? 0; }
  writeJSON(path.join(RESULTS, "discovery.json"), { generated: new Date().toISOString(), estimated_cost_usd: +cost.toFixed(4), models: records });
  console.log(`\nDone. ${records.length} models recorded, estimated probe cost $${cost.toFixed(4)}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
