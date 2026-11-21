/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : benchmarks/scripts/bench.ts
 * Module           : benchmarks
 * Repository       : https://git.spboucher.ai/note-spboucher-ai
 * Project Website  : https://note.spboucher.ai
 * Created          : 2026-11-01
 * Last Modified    : 2026-11-01
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
 * Phase Zero §5.3 — real inference benchmarks.
 * Usage: npx tsx benchmarks/scripts/bench.ts [--models a,b] [--prompts x,y] [--trials N] [--concurrency N]
 * Writes benchmarks/results/raw/bench-runs.jsonl (one line per trial) — resumable (skips done trials).
 */
import fs from "node:fs";
import path from "node:path";
import { ROOT, RESULTS, RAW, appendJSONL, estimateCost, pLimit } from "./lib.ts";
import { call } from "./providers.ts";
import { gradeRegex, gradeCode, gradeJSON, gradeTool, gradeWritingDeterministic, gradeMath, llmJudge, type Grade } from "./graders.ts";

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith("--") ? [a.slice(2), arr[i + 1]] : []).filter((x) => x.length));
const trials = Number(args.trials ?? 2);
const concurrency = Number(args.concurrency ?? 8);

const discovery = JSON.parse(fs.readFileSync(path.join(RESULTS, "discovery.json"), "utf8"));
const EXPENSIVE = /-pro$|^o1|^o3-pro/;
let models: { provider: "openai" | "anthropic"; id: string }[] = discovery.models
  .filter((m: any) => m.verdict === "tested" && !EXPENSIVE.test(m.id))
  .map((m: any) => ({ provider: m.provider, id: m.id }));
if (args.models) { const want = args.models.split(","); models = models.filter((m) => want.includes(m.id)); }

const promptFiles = fs.readdirSync(path.join(ROOT, "benchmarks/prompts")).filter((f) => f.endsWith(".json"));
let prompts = promptFiles.map((f) => JSON.parse(fs.readFileSync(path.join(ROOT, "benchmarks/prompts", f), "utf8")));
if (args.prompts) { const want = args.prompts.split(","); prompts = prompts.filter((p) => want.includes(p.id)); }
const haystack = fs.readFileSync(path.join(ROOT, "benchmarks/prompts/long-context.txt"), "utf8");

const RUNS = path.join(RAW, "bench-runs.jsonl");
const done = new Set<string>();
if (fs.existsSync(RUNS)) for (const l of fs.readFileSync(RUNS, "utf8").split("\n").filter(Boolean)) { const j = JSON.parse(l); done.add(`${j.model}|${j.prompt}|${j.trial}`); }

const RUBRICS: Record<string, string> = {
  french_writing: "Quality of formal academic French (grammar, register, fluency), relevance, respect of all constraints (length 150-220 words, the three required expressions present, no title/list, no English words).",
  english_writing: "Quality of formal academic English (grammar, register, fluency), relevance, respect of all constraints (length 150-220 words, the three required expressions, no title/list).",
  knowledge_synthesis: "Accuracy to the three sources, explicit identification of the 41 vs 58 tokens/s contradiction and which is more recent (S2), correct inline citations [S1][S2][S3], concise (120-200 words), no invented facts.",
};

async function runOne(m: { provider: "openai" | "anthropic"; id: string }, p: any, trial: number) {
  const key = `${m.id}|${p.id}|${trial}`;
  if (done.has(key)) return;
  const prompt = p.haystack ? p.prompt.replace("{{HAYSTACK}}", haystack) : p.prompt;
  const r = await call(m.provider, { model: m.id, prompt, maxTokens: p.max_tokens ?? 4000, jsonSchema: p.schema, tools: p.tools, stream: true, timeoutMs: 300_000 });
  let grade: Grade = { pass: false, score: 0, detail: r.error ? `request failed: ${r.error}` : "ungraded" };
  if (r.ok) {
    switch (p.grader) {
      case "regex": grade = gradeRegex(r.text, p.expect); break;
      case "code": grade = gradeCode(r.text); break;
      case "math": grade = gradeMath(r.text); break;
      case "json": grade = gradeJSON(r.text, p.schema.schema, p.expect_json); break;
      case "tool": grade = gradeTool(r.toolCalls, p.expect_tool); break;
      case "writing": case "synthesis": {
        grade = gradeWritingDeterministic(r.text, p.lang ?? "en", p.must_contain, p.words);
        if (p.grader === "synthesis") { // language check is not meaningful here; keep terms+length only
          const terms = p.must_contain.filter((t: string) => r.text.includes(t)).length / p.must_contain.length;
          const wc = r.text.trim().split(/\s+/).length; const inRange = wc >= p.words[0] && wc <= p.words[1] + 30;
          grade = { pass: terms === 1 && inRange, score: (terms + (inRange ? 1 : 0)) / 2, detail: `terms ${Math.round(terms * p.must_contain.length)}/${p.must_contain.length}; words ${wc}` };
        }
        try { grade.judged = await llmJudge(p.prompt, r.text, RUBRICS[p.id]); } catch (e: any) { grade.detail += `; judge error ${e?.message}`; }
        break;
      }
    }
  }
  const u = r.usage;
  const rec = {
    ts: new Date().toISOString(), provider: m.provider, model: m.id, prompt: p.id, category: p.category, trial,
    ok: r.ok, error: r.error, status: r.status, stop: r.stop,
    ttft_ms: r.ttft_ms === null ? null : Math.round(r.ttft_ms), total_ms: Math.round(r.total_ms),
    input_tokens: u?.input_tokens ?? null, output_tokens: u?.output_tokens ?? null, reasoning_tokens: u?.reasoning_tokens ?? null, cached_tokens: u?.cached_tokens ?? null,
    usage_source: u ? "provider" : null,
    output_tps: u && r.ttft_ms !== null && r.total_ms > r.ttft_ms ? +(Math.max(0, u.output_tokens - (u.reasoning_tokens ?? 0)) / ((r.total_ms - r.ttft_ms) / 1000)).toFixed(1) : null, output_tps_note: "visible (non-reasoning) output tokens ÷ (total − TTFT)",
    cost_usd: u ? estimateCost(m.id, u.input_tokens, u.output_tokens, u.cached_tokens) : null, cost_source: "estimated from provider usage × published list price",
    pass: grade.pass, score: +grade.score.toFixed(3), grade_detail: grade.detail, judged: grade.judged ?? null,
    response_excerpt: r.text.slice(0, 1200), tool_calls: r.toolCalls,
  };
  appendJSONL(RUNS, rec);
  console.log(`${m.id.padEnd(28)} ${p.id.padEnd(20)} t${trial} ${r.ok ? (grade.pass ? "PASS" : "fail") : "ERR "} score=${rec.score} ttft=${rec.ttft_ms}ms total=${rec.total_ms}ms out=${rec.output_tokens} $${rec.cost_usd?.toFixed(4) ?? "?"} ${r.error ? r.error.slice(0, 80) : ""}`);
}

const tasks: (() => Promise<void>)[] = [];
for (const m of models) for (const p of prompts) for (let t = 1; t <= trials; t++) tasks.push(() => runOne(m, p, t));
console.log(`${models.length} models × ${prompts.length} prompts × ${trials} trials = ${tasks.length} runs (${done.size} already done)`);
await pLimit(concurrency, tasks);
console.log("bench complete");
