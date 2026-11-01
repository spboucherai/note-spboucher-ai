/**
 * Aggregates discovery.json + bench-runs.jsonl into:
 *   benchmarks/results/summary.json   (machine-readable, consumed by the in-app dashboard)
 *   docs/ai-provider-discovery.md, docs/openai-model-benchmarks.md, docs/anthropic-model-benchmarks.md, docs/ai-model-comparison.md
 */
import fs from "node:fs";
import path from "node:path";
import { ROOT, RESULTS, RAW, PRICING_SOURCES, writeJSON } from "./lib.ts";

const disc = JSON.parse(fs.readFileSync(path.join(RESULTS, "discovery.json"), "utf8"));
const runs = fs.existsSync(path.join(RAW, "bench-runs.jsonl")) ? fs.readFileSync(path.join(RAW, "bench-runs.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
const DOCS = path.join(ROOT, "docs"); fs.mkdirSync(DOCS, { recursive: true });
const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : NaN; };
const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const f = (n: number, d = 0) => (Number.isFinite(n) ? n.toFixed(d) : "–");
const money = (n: number) => (Number.isFinite(n) ? (n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(3)}`) : "–");

// ---- per model × category aggregation
const categories = [...new Set(runs.map((r) => r.prompt))];
const CAT_LABEL: Record<string, string> = Object.fromEntries(runs.map((r) => [r.prompt, r.category]));
interface Agg { model: string; provider: string; runs: number; errors: number; pass_rate: number; mean_score: number; judged_mean: number | null; ttft_median_ms: number; total_median_ms: number; tps_median: number; cost_total: number; cost_mean: number; in_tokens: number; out_tokens: number; reasoning_tokens: number; by_category: Record<string, { runs: number; errors: number; pass_rate: number; score: number; judged: number | null; ttft_ms: number; total_ms: number; tps: number | null; cost_mean: number; out_tokens: number }> }
const models = [...new Set(runs.map((r) => r.model))];
const aggs: Agg[] = models.map((m) => {
  const rs = runs.filter((r) => r.model === m);
  const ok = rs.filter((r) => r.ok);
  const judgedScores = rs.flatMap((r) => (r.judged ?? []).map((j: any) => j.score).filter((s: number) => Number.isFinite(s)));
  const by: Agg["by_category"] = {};
  for (const c of categories) {
    const cr = rs.filter((r) => r.prompt === c); if (!cr.length) continue;
    const cok = cr.filter((r) => r.ok);
    const js = cr.flatMap((r) => (r.judged ?? []).map((j: any) => j.score).filter((s: number) => Number.isFinite(s)));
    by[c] = { runs: cr.length, errors: cr.length - cok.length, pass_rate: mean(cr.map((r) => (r.pass ? 1 : 0))), score: mean(cr.map((r) => r.score)), judged: js.length ? mean(js) : null, ttft_ms: median(cok.map((r) => r.ttft_ms).filter((x) => x !== null)), total_ms: median(cok.map((r) => r.total_ms)), tps: cok.some((r) => r.output_tps) ? median(cok.map((r) => r.output_tps).filter(Boolean)) : null, cost_mean: mean(cok.map((r) => r.cost_usd).filter((x) => x !== null)), out_tokens: mean(cok.map((r) => r.output_tokens).filter((x) => x !== null)) };
  }
  return {
    model: m, provider: rs[0].provider, runs: rs.length, errors: rs.length - ok.length,
    pass_rate: mean(rs.map((r) => (r.pass ? 1 : 0))), mean_score: mean(rs.map((r) => r.score)), judged_mean: judgedScores.length ? mean(judgedScores) : null,
    ttft_median_ms: median(ok.map((r) => r.ttft_ms).filter((x) => x !== null)), total_median_ms: median(ok.map((r) => r.total_ms)),
    tps_median: median(ok.map((r) => r.output_tps).filter(Boolean)),
    cost_total: ok.reduce((a, r) => a + (r.cost_usd ?? 0), 0), cost_mean: mean(ok.map((r) => r.cost_usd).filter((x) => x !== null)),
    in_tokens: ok.reduce((a, r) => a + (r.input_tokens ?? 0), 0), out_tokens: ok.reduce((a, r) => a + (r.output_tokens ?? 0), 0), reasoning_tokens: ok.reduce((a, r) => a + (r.reasoning_tokens ?? 0), 0),
    by_category: by,
  };
});
aggs.sort((a, b) => b.mean_score - a.mean_score || a.total_median_ms - b.total_median_ms);

const totalCost = runs.reduce((a, r) => a + (r.cost_usd ?? 0), 0);
writeJSON(path.join(RESULTS, "summary.json"), {
  generated: new Date().toISOString(), runs: runs.length, trials_per_cell: Math.max(...runs.map((r) => r.trial)), total_estimated_cost_usd: +totalCost.toFixed(3) + disc.estimated_cost_usd,
  categories: categories.map((c) => ({ id: c, label: CAT_LABEL[c] })), pricing_sources: PRICING_SOURCES,
  judges: ["claude-sonnet-5-5", "gpt-5.4"], models: aggs,
  discovery: disc.models.map((m: any) => ({ provider: m.provider, id: m.id, display: m.display, category: m.category, aliasOf: m.aliasOf, verdict: m.verdict, context: m.context, maxOutput: m.maxOutput, pricing: m.pricing, probes: m.probes, notes: m.notes, created: m.created })),
});

// ---- docs
const probeCols = ["text", "streaming", "tool_use", "structured_output", "vision", "reasoning_control"];
const mark = (p: any) => (!p ? "·" : p.status === "ok" ? "✅" : p.status === "unsupported" ? "❌" : p.status === "unavailable" ? "⛔" : "⚠️");
function discoveryDoc() {
  const by = (prov: string) => disc.models.filter((m: any) => m.provider === prov);
  let s = `# AI provider discovery — Note SPBoucher AI\n\nGenerated ${disc.generated} by \`benchmarks/scripts/discover.ts\` (real API calls; estimated probe cost $${disc.estimated_cost_usd}).\n\n`;
  s += `Legend: ✅ probe succeeded · ❌ request accepted but feature unsupported/failed check · ⛔ model unavailable to this account (404) · ⚠️ transport/other error · · not probed.\n\n`;
  s += `**Method.** Model identifiers come from \`GET /v1/models\` on each provider. Every general-purpose text model (and every Anthropic model) was then exercised with six real requests: plain text (non-streaming), streaming, one function/tool call, JSON-schema structured output, a 64×64 red PNG vision question, and a reasoning-effort parameter. Specialized models (audio, image, video, realtime, embeddings, moderation, search/deep-research, legacy completion) were deliberately **not** sent chat requests. Dated snapshots were not probed separately from their alias.\n\n`;
  for (const prov of ["openai", "anthropic"]) {
    const ms = by(prov);
    s += `## ${prov === "openai" ? "OpenAI" : "Anthropic"} — ${ms.length} identifiers listed\n\n`;
    const tested = ms.filter((m: any) => m.verdict === "tested"), unav = ms.filter((m: any) => m.verdict === "unavailable"), unsup = ms.filter((m: any) => m.verdict === "unsupported"), untested = ms.filter((m: any) => m.verdict === "untested");
    s += `Tested: ${tested.length} · unavailable (404 for this account): ${unav.length} · unsupported: ${unsup.length} · not probed (specialized or snapshot): ${untested.length}\n\n`;
    s += `| Model | Category | Context | Max out | $/M in | $/M out | ${probeCols.join(" | ")} | Verdict |\n|---|---|---|---|---|---|${probeCols.map(() => "---").join("|")}|---|\n`;
    for (const m of ms.filter((m: any) => m.verdict !== "untested")) {
      s += `| \`${m.id}\` | ${m.category} | ${m.context ? (m.context / 1000) + "K" : "–"} | ${m.maxOutput ? (m.maxOutput / 1000) + "K" : "–"} | ${m.pricing ? m.pricing.input : "–"} | ${m.pricing ? m.pricing.output : "–"} | ${probeCols.map((c) => mark(m.probes[c])).join(" | ")} | ${m.verdict} |\n`;
    }
    s += `\n<details><summary>Not probed (${untested.length})</summary>\n\n` + untested.map((m: any) => `- \`${m.id}\` — ${m.notes.join("; ")}`).join("\n") + "\n\n</details>\n\n";
    const details = ms.flatMap((m: any) => Object.entries(m.probes).filter(([, p]: any) => p.status !== "ok").map(([k, p]: any) => `- \`${m.id}\` / ${k}: ${p.status} — ${(p.detail ?? "").replace(/\n/g, " ").slice(0, 220)}`));
    if (details.length) s += `<details><summary>Probe failures and messages (${details.length})</summary>\n\n${details.join("\n")}\n\n</details>\n\n`;
  }
  s += `## Pricing sources\n\n- OpenAI: ${PRICING_SOURCES.openai.url} (fetched ${PRICING_SOURCES.openai.fetched}; ${PRICING_SOURCES.openai.note}). \`chat-latest\` has no own row on the pricing page; it is priced in this report as gpt-5.5 (assumption).\n- Anthropic: ${PRICING_SOURCES.anthropic.url} (fetched ${PRICING_SOURCES.anthropic.fetched}). Haiku 5.5 prices shown are for prompts ≤100K tokens. Context/max-output for Anthropic come from \`GET /v1/models/{id}\` (anthropic-version 2026-10-21); OpenAI does not expose these fields via API — see the docs catalogue (GPT-6 family: 1.05M context / 128K output).\n\n## Anthropic capability trees (from the Models API)\n\n`;
  for (const m of by("anthropic")) if (m.capabilities) s += `<details><summary>\`${m.id}\` — context ${m.context}, max output ${m.maxOutput}</summary>\n\n\`\`\`json\n${JSON.stringify(m.capabilities)}\n\`\`\`\n\n</details>\n`;
  fs.writeFileSync(path.join(DOCS, "ai-provider-discovery.md"), s);
}

function benchDoc(prov: "openai" | "anthropic") {
  const as = aggs.filter((a) => a.provider === prov);
  let s = `# ${prov === "openai" ? "OpenAI" : "Anthropic"} model benchmarks — Note SPBoucher AI\n\nGenerated ${new Date().toISOString()} from \`benchmarks/results/raw/bench-runs.jsonl\` (${runs.filter((r) => r.provider === prov).length} real runs, ${Math.max(...runs.map((r) => r.trial))} trials per model × task). Reproduce: \`npx tsx benchmarks/scripts/bench.ts\` then \`npx tsx benchmarks/scripts/report.ts\`.\n\n`;
  s += `**Protocol.** Streaming requests, provider default reasoning settings, \`max_tokens\` per task (1.5K–6K). TTFT = first text/tool delta; tok/s = output tokens ÷ (total − TTFT). Tokens are provider-reported; cost = tokens × published list prices (estimate). Deterministic graders for 8 tasks (regex, executed code tests, JSON-schema + field checks, tool-call checks); the three writing/synthesis tasks add a two-judge LLM rubric (claude-sonnet-5-5 + gpt-5.4, 1–5) reported separately and **never mixed into the pass rate**.\n\n`;
  s += `## Overall\n\n| Model | Pass rate | Mean score | LLM-judged (1–5) | TTFT med. | Latency med. | tok/s med. | Cost / run | Total cost | Errors |\n|---|---|---|---|---|---|---|---|---|---|\n`;
  for (const a of as) s += `| \`${a.model}\` | ${f(a.pass_rate * 100)}% | ${f(a.mean_score, 2)} | ${a.judged_mean === null ? "–" : f(a.judged_mean, 2)} | ${f(a.ttft_median_ms)} ms | ${f(a.total_median_ms / 1000, 1)} s | ${f(a.tps_median)} | ${money(a.cost_mean)} | ${money(a.cost_total)} | ${a.errors}/${a.runs} |\n`;
  s += `\n## Pass rate by task\n\n| Model | ${categories.map((c) => CAT_LABEL[c]).join(" | ")} |\n|---|${categories.map(() => "---").join("|")}|\n`;
  for (const a of as) s += `| \`${a.model}\` | ${categories.map((c) => (a.by_category[c] ? `${f(a.by_category[c].pass_rate * 100)}%${a.by_category[c].judged !== null ? ` (j ${f(a.by_category[c].judged!, 1)})` : ""}` : "–")).join(" | ")} |\n`;
  s += `\n## Median latency by task (seconds)\n\n| Model | ${categories.map((c) => CAT_LABEL[c]).join(" | ")} |\n|---|${categories.map(() => "---").join("|")}|\n`;
  for (const a of as) s += `| \`${a.model}\` | ${categories.map((c) => (a.by_category[c] ? f(a.by_category[c].total_ms / 1000, 1) : "–")).join(" | ")} |\n`;
  s += `\n## Mean cost by task (USD)\n\n| Model | ${categories.map((c) => CAT_LABEL[c]).join(" | ")} |\n|---|${categories.map(() => "---").join("|")}|\n`;
  for (const a of as) s += `| \`${a.model}\` | ${categories.map((c) => (a.by_category[c] ? money(a.by_category[c].cost_mean) : "–")).join(" | ")} |\n`;
  const errs = runs.filter((r) => r.provider === prov && !r.ok);
  if (errs.length) s += `\n## Errors (${errs.length})\n\n` + errs.map((r) => `- \`${r.model}\` / ${r.prompt} t${r.trial}: ${r.status ?? ""} ${(r.error ?? "").slice(0, 200)}`).join("\n") + "\n";
  s += `\n## Token usage\n\n| Model | Input tokens | Output tokens | of which reasoning |\n|---|---|---|---|\n` + as.map((a) => `| \`${a.model}\` | ${a.in_tokens} | ${a.out_tokens} | ${a.reasoning_tokens} |`).join("\n") + "\n";
  fs.writeFileSync(path.join(DOCS, `${prov}-model-benchmarks.md`), s);
}

function comparisonDoc() {
  let s = `# AI model comparison — Note SPBoucher AI\n\nGenerated ${new Date().toISOString()}. ${runs.length} real runs across ${aggs.length} models; total estimated spend for Phase Zero ≈ $${(totalCost + disc.estimated_cost_usd).toFixed(2)}.\n\n`;
  s += `## Ranking (deterministic mean score, then latency)\n\n| # | Model | Provider | Pass | Score | Judged | TTFT | Latency | tok/s | $/run |\n|---|---|---|---|---|---|---|---|---|---|\n`;
  aggs.forEach((a, i) => { s += `| ${i + 1} | \`${a.model}\` | ${a.provider} | ${f(a.pass_rate * 100)}% | ${f(a.mean_score, 2)} | ${a.judged_mean === null ? "–" : f(a.judged_mean, 2)} | ${f(a.ttft_median_ms)} ms | ${f(a.total_median_ms / 1000, 1)} s | ${f(a.tps_median)} | ${money(a.cost_mean)} |\n`; });
  s += `\n## Best model per task (deterministic score, ties → cheaper)\n\n| Task | Best | Score | Latency | $/run | Cheapest model with a perfect score |\n|---|---|---|---|---|---|\n`;
  for (const c of categories) {
    const rows = aggs.filter((a) => a.by_category[c]).map((a) => ({ m: a.model, ...a.by_category[c] }));
    rows.sort((x, y) => y.score - x.score || x.cost_mean - y.cost_mean);
    const best = rows[0]; const perfect = rows.filter((r) => r.pass_rate === 1).sort((x, y) => x.cost_mean - y.cost_mean)[0];
    s += `| ${CAT_LABEL[c]} | \`${best.m}\` | ${f(best.score, 2)} | ${f(best.total_ms / 1000, 1)} s | ${money(best.cost_mean)} | ${perfect ? `\`${perfect.m}\` (${money(perfect.cost_mean)})` : "none"} |\n`;
  }
  s += `\n## Writing quality (two-judge LLM rubric, 1–5; experimental, not used for pass rates)\n\n| Model | French writing | English writing | Knowledge synthesis |\n|---|---|---|---|\n`;
  for (const a of aggs) s += `| \`${a.model}\` | ${a.by_category.french_writing?.judged != null ? f(a.by_category.french_writing.judged!, 2) : "–"} | ${a.by_category.english_writing?.judged != null ? f(a.by_category.english_writing.judged!, 2) : "–"} | ${a.by_category.knowledge_synthesis?.judged != null ? f(a.by_category.knowledge_synthesis.judged!, 2) : "–"} |\n`;
  s += `\n## Speed\n\n| Model | TTFT median | Latency median | Output tok/s median |\n|---|---|---|---|\n` + [...aggs].sort((x, y) => x.total_median_ms - y.total_median_ms).map((a) => `| \`${a.model}\` | ${f(a.ttft_median_ms)} ms | ${f(a.total_median_ms / 1000, 1)} s | ${f(a.tps_median)} |`).join("\n") + "\n";
  s += `\n## Caveats\n\n- Two trials per cell: differences of a few points are noise. Latency depends on provider load at run time (${runs[0]?.ts?.slice(0, 10)}).\n- Costs are estimates (provider-reported tokens × list price); provider invoices are authoritative.\n- Writing scores come from LLM judges and are shown separately from deterministic results.\n- Pro-tier models (gpt-5.5-pro, gpt-5.4-pro, gpt-5.2-pro, gpt-5-pro, o3-pro) passed discovery probes but were excluded from the benchmark for cost ($20–$30 per M input tokens); they are selectable manually in the app.\n`;
  fs.writeFileSync(path.join(DOCS, "ai-model-comparison.md"), s);
}

discoveryDoc(); if (runs.length) { benchDoc("openai"); benchDoc("anthropic"); comparisonDoc(); }
console.log(`report: ${runs.length} runs, ${aggs.length} models, est. bench cost $${totalCost.toFixed(2)}`);
