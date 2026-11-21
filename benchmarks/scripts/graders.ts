/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : benchmarks/scripts/graders.ts
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

/** Deterministic graders + LLM judge for writing tasks. */
import vm from "node:vm";
import { call } from "./providers.ts";

export interface Grade { pass: boolean; score: number; detail: string; judged?: { judge: string; score: number; rationale: string }[] }

export function gradeRegex(text: string, expect: string[]): Grade {
  const hits = expect.map((re) => new RegExp(re, "i").test(text));
  const n = hits.filter(Boolean).length;
  return { pass: n === expect.length, score: n / expect.length, detail: `${n}/${expect.length} expected patterns matched` };
}

export function gradeCode(text: string): Grade {
  const m = text.match(/```(?:javascript|js)?\s*([\s\S]*?)```/);
  const code = m ? m[1] : text;
  const tests: [string[], number, string[]][] = [
    [["i", "love", "leetcode", "i", "love", "coding"], 2, ["i", "love"]],
    [["the", "day", "is", "sunny", "the", "the", "the", "sunny", "is", "is"], 4, ["the", "is", "sunny", "day"]],
    [["b", "a", "c", "a", "b"], 3, ["a", "b", "c"]],
    [["x"], 1, ["x"]],
  ];
  let passed = 0; const errs: string[] = [];
  for (const [words, k, want] of tests) {
    try {
      const ctx = vm.createContext({});
      vm.runInContext(code + `\n;globalThis.__out = topKFrequent(${JSON.stringify(words)}, ${k});`, ctx, { timeout: 2000 });
      const got = (ctx as any).__out;
      if (JSON.stringify(got) === JSON.stringify(want)) passed++; else errs.push(`got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
    } catch (e: any) { errs.push(String(e?.message).slice(0, 80)); }
  }
  return { pass: passed === tests.length, score: passed / tests.length, detail: errs.length ? errs.join(" | ").slice(0, 300) : "all tests passed" };
}

function validateSchema(val: any, schema: any, path = "$"): string[] {
  const errs: string[] = [];
  if (!schema) return errs;
  const t = schema.type;
  if (t === "object") {
    if (typeof val !== "object" || val === null || Array.isArray(val)) return [`${path}: not object`];
    for (const r of schema.required ?? []) if (!(r in val)) errs.push(`${path}.${r}: missing`);
    for (const [k, v] of Object.entries(val)) {
      if (schema.properties?.[k]) errs.push(...validateSchema(v, schema.properties[k], `${path}.${k}`));
      else if (schema.additionalProperties === false) errs.push(`${path}.${k}: unexpected`);
    }
  } else if (t === "array") {
    if (!Array.isArray(val)) return [`${path}: not array`];
    val.forEach((x, i) => errs.push(...validateSchema(x, schema.items, `${path}[${i}]`)));
  } else if (t === "string") { if (typeof val !== "string") errs.push(`${path}: not string`); if (schema.enum && !schema.enum.includes(val)) errs.push(`${path}: not in enum`); }
  else if (t === "integer") { if (!Number.isInteger(val)) errs.push(`${path}: not integer`); }
  else if (t === "number") { if (typeof val !== "number") errs.push(`${path}: not number`); }
  return errs;
}

export function gradeJSON(text: string, schema: any, expect: Record<string, any>): Grade {
  let j: any;
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  try { j = JSON.parse(cleaned); } catch { return { pass: false, score: 0, detail: "invalid JSON" }; }
  const errs = validateSchema(j, schema);
  let checks = 0, ok = 0;
  for (const [k, v] of Object.entries(expect)) {
    checks++;
    if (k === "authors_count") { if (Array.isArray(j.authors) && j.authors.length === v) ok++; continue; }
    const got = j[k];
    if (Array.isArray(v)) { if (JSON.stringify((got ?? []).map(String).sort()) === JSON.stringify(v.map(String).sort())) ok++; }
    else if (typeof v === "number") { if (typeof got === "number" && Math.abs(got - v) < 0.01) ok++; }
    else if (String(got).trim() === String(v)) ok++;
  }
  const schemaOk = errs.length === 0;
  const score = (schemaOk ? 0.3 : 0) + 0.7 * (ok / Math.max(1, checks));
  return { pass: schemaOk && ok === checks, score, detail: `${schemaOk ? "schema ok" : "schema errors: " + errs.slice(0, 3).join(", ")}; fields ${ok}/${checks}` };
}

export function gradeTool(toolCalls: { name: string; args: any }[], expect: { name: string; args: Record<string, string>; forbid: string[] }): Grade {
  if (toolCalls.some((c) => expect.forbid.includes(c.name))) return { pass: false, score: 0, detail: "forbidden tool called" };
  const c = toolCalls.find((x) => x.name === expect.name);
  if (!c) return { pass: false, score: 0, detail: "expected tool not called" };
  const keys = Object.keys(expect.args);
  const ok = keys.filter((k) => new RegExp(expect.args[k], "i").test(String(c.args?.[k] ?? ""))).length;
  return { pass: ok === keys.length, score: 0.4 + 0.6 * (ok / keys.length), detail: `tool called; ${ok}/${keys.length} args correct` };
}

const FR_STOP = ["le", "la", "les", "des", "une", "est", "pour", "dans", "que", "qui", "et", "du", "aux", "sont", "en"];
const EN_STOP = ["the", "and", "of", "to", "for", "that", "with", "are", "is", "in", "which", "this", "as", "by", "on"];
function langRatio(text: string, lang: "fr" | "en") {
  const words = text.toLowerCase().match(/[a-zàâçéèêëîïôûùüÿœ'-]+/g) ?? [];
  const stop = new Set(lang === "fr" ? FR_STOP : EN_STOP);
  const other = new Set(lang === "fr" ? EN_STOP : FR_STOP);
  let s = 0, o = 0; for (const w of words) { if (stop.has(w)) s++; if (other.has(w)) o++; }
  return { words: words.length, stopHits: s, otherHits: o };
}

export function gradeWritingDeterministic(text: string, lang: "fr" | "en", mustContain: string[], words: [number, number]): Grade {
  const lr = langRatio(text, lang);
  const contains = mustContain.filter((m) => text.toLowerCase().includes(m.toLowerCase())).length;
  const wc = text.trim().split(/\s+/).length;
  const inRange = wc >= words[0] - 10 && wc <= words[1] + 25;
  const langOk = lr.stopHits >= 5 && lr.otherHits <= Math.max(2, lr.stopHits * 0.15);
  const noList = !/^\s*[-*•]\s|^\s*\d+\.\s/m.test(text);
  const parts = [contains / mustContain.length, inRange ? 1 : 0, langOk ? 1 : 0, noList ? 1 : 0];
  const score = parts.reduce((a, b) => a + b, 0) / parts.length;
  return { pass: score === 1, score, detail: `terms ${contains}/${mustContain.length}; words ${wc} (${inRange ? "ok" : "out of range"}); language ${langOk ? "ok" : "suspect"}; ${noList ? "no list" : "list detected"}` };
}

const JUDGES: { provider: "openai" | "anthropic"; model: string }[] = [
  { provider: "anthropic", model: "claude-sonnet-5-5" },
  { provider: "openai", model: "gpt-5.4" },
];
const JUDGE_SCHEMA = { type: "object", properties: { score: { type: "integer", minimum: 1, maximum: 5 }, rationale: { type: "string" } }, required: ["score", "rationale"], additionalProperties: false };

/** Two-judge LLM rubric (1-5). Clearly labelled as LLM-judged in reports. */
export async function llmJudge(task: string, response: string, rubric: string) {
  const prompt = `You are grading a model response for a benchmark.\n\nTASK GIVEN TO THE MODEL:\n<task>\n${task}\n</task>\n\nMODEL RESPONSE:\n<response>\n${response}\n</response>\n\nRUBRIC: ${rubric}\nScore 1 (poor) to 5 (excellent). Be strict about constraint violations. Return JSON {"score": int, "rationale": string (<= 40 words)}.`;
  const out: { judge: string; score: number; rationale: string }[] = [];
  for (const j of JUDGES) {
    const r = await call(j.provider, { model: j.model, prompt, maxTokens: 2000, jsonSchema: { name: "grade", schema: JUDGE_SCHEMA }, stream: false, reasoning: "low", timeoutMs: 120_000 });
    try { const g = JSON.parse(r.text); out.push({ judge: j.model, score: Number(g.score), rationale: String(g.rationale) }); } catch { out.push({ judge: j.model, score: NaN, rationale: `judge failed: ${r.error ?? r.text.slice(0, 80)}` }); }
  }
  return out;
}

/** Mathematics task: A = 233168 ; B = x^2 e^{2x} (2x+3) in any order/notation. */
export function gradeMath(text: string): Grade {
  const a = /233[,\s]?168/.test(text);
  const bLine = (text.match(/B:[^\n]*/g) ?? []).pop() ?? text.slice(-300);
  const n = bLine.replace(/²/g, "^2").replace(/\\[()\[\]]/g, "").replace(/\\(cdot|times|left|right)/g, "").replace(/[\s{}$*·]/g, "").replace(/\\?/g, "");
  const hasX2 = /x\^2/.test(n);
  const hasExp = /e\^\(?2x\)?/.test(n);
  const hasFactor = /\(?(2x\+3|3\+2x)\)?/.test(n);
  const b = hasX2 && hasExp && hasFactor;
  return { pass: a && b, score: ((a ? 1 : 0) + (b ? 1 : 0)) / 2, detail: `A ${a ? "ok" : "wrong"}; B ${b ? "ok" : "wrong"} (${bLine.slice(0, 60)})` };
}
