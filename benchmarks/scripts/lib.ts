/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : benchmarks/scripts/lib.ts
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
 * Shared helpers for Phase Zero (provider discovery + benchmarks).
 * Secrets are read from .env.secrets (symlink to the secrets dir, git-ignored).
 */
import fs from "node:fs";
import path from "node:path";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";

export const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
export const RESULTS = path.join(ROOT, "benchmarks/results");
export const RAW = path.join(RESULTS, "raw");
fs.mkdirSync(RAW, { recursive: true });

export function loadSecrets() {
  const f = path.join(ROOT, ".env.secrets");
  if (!fs.existsSync(f)) throw new Error(".env.secrets missing");
  for (const line of fs.readFileSync(f, "utf8").split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY missing");
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY missing");
}
loadSecrets();

export const openai = new OpenAI({ maxRetries: 2, timeout: 10 * 60_000 });
export const anthropic = new Anthropic({ maxRetries: 2, timeout: 10 * 60_000 });

export type Provider = "openai" | "anthropic";

/** Pricing in USD per 1M tokens. Source + fetch date recorded for the report. */
export const PRICING_SOURCES = {
  openai: { url: "https://developers.openai.com/api/docs/pricing", fetched: "2026-11-01", note: "Standard tier, short context (≤272K input)" },
  anthropic: { url: "https://platform.claude.com/docs/en/about-claude/pricing", fetched: "2026-11-01", note: "First-party API rates" },
};
export const PRICING: Record<string, { input: number; cached: number | null; output: number }> = {
  // OpenAI
  "gpt-6-astra": { input: 10, cached: 1, output: 50 },
  "gpt-6.1-sol": { input: 2, cached: 0.1, output: 10 },
  "gpt-6.1-terra": { input: 1, cached: 0.05, output: 5 },
  "gpt-6-luna": { input: 0.1, cached: 0.01, output: 0.5 },
  "gpt-6-sol": { input: 2, cached: 0.2, output: 10 },
  "gpt-5.6-sol": { input: 4, cached: 0.4, output: 20 },
  "gpt-5.6-terra": { input: 2, cached: 0.2, output: 12 },
  "gpt-5.6-luna": { input: 0.2, cached: 0.02, output: 1.2 },
  "gpt-5.5": { input: 5, cached: 0.5, output: 30 },
  "gpt-5.5-pro": { input: 30, cached: null, output: 180 },
  "gpt-5.4": { input: 2.5, cached: 0.25, output: 15 },
  "gpt-5.4-pro": { input: 30, cached: null, output: 180 },
  "gpt-5.4-mini": { input: 0.75, cached: 0.075, output: 4.5 },
  "gpt-5.4-nano": { input: 0.2, cached: 0.02, output: 1.25 },
  "gpt-5.3-chat-latest": { input: 1.75, cached: 0.175, output: 14 },
  "gpt-5.3-codex": { input: 1.75, cached: 0.175, output: 14 },
  "gpt-5.2": { input: 1.75, cached: 0.175, output: 14 },
  "gpt-5.2-chat-latest": { input: 1.75, cached: 0.175, output: 14 },
  "gpt-5.2-codex": { input: 1.75, cached: 0.175, output: 14 },
  "gpt-5.2-pro": { input: 21, cached: null, output: 168 },
  "gpt-5.1": { input: 1.25, cached: 0.125, output: 10 },
  "gpt-5.1-chat-latest": { input: 1.25, cached: 0.125, output: 10 },
  "gpt-5.1-codex": { input: 1.25, cached: 0.125, output: 10 },
  "gpt-5.1-codex-max": { input: 1.25, cached: 0.125, output: 10 },
  "gpt-5.1-codex-mini": { input: 0.25, cached: 0.025, output: 2 },
  "gpt-5": { input: 1.25, cached: 0.125, output: 10 },
  "gpt-5-chat-latest": { input: 1.25, cached: 0.125, output: 10 },
  "gpt-5-codex": { input: 1.25, cached: 0.125, output: 10 },
  "gpt-5-mini": { input: 0.25, cached: 0.025, output: 2 },
  "gpt-5-nano": { input: 0.05, cached: 0.005, output: 0.4 },
  "gpt-5-pro": { input: 15, cached: null, output: 120 },
  "o1": { input: 15, cached: 7.5, output: 60 },
  "o1-pro": { input: 150, cached: null, output: 600 },
  "o3-pro": { input: 20, cached: null, output: 80 },
  "o3": { input: 2, cached: 0.5, output: 8 },
  "o4-mini": { input: 1.1, cached: 0.275, output: 4.4 },
  "o3-mini": { input: 1.1, cached: 0.55, output: 4.4 },
  "gpt-4.1": { input: 2, cached: 0.5, output: 8 },
  "gpt-4.1-mini": { input: 0.4, cached: 0.1, output: 1.6 },
  "gpt-4.1-nano": { input: 0.1, cached: 0.025, output: 0.4 },
  "gpt-4o": { input: 2.5, cached: 1.25, output: 10 },
  "gpt-4o-mini": { input: 0.15, cached: 0.075, output: 0.6 },
  "chat-latest": { input: 5, cached: 0.5, output: 30 }, // alias; priced as gpt-5.5 (assumption, flagged in report)
  "text-embedding-3-small": { input: 0.02, cached: null, output: 0 },
  "text-embedding-3-large": { input: 0.13, cached: null, output: 0 },
  // Anthropic
  "claude-fable-5-1": { input: 10, cached: 0.25, output: 50 },
  "claude-fable-5": { input: 10, cached: 1, output: 50 },
  "claude-opus-5-5": { input: 4, cached: 0.2, output: 20 },
  "claude-opus-5": { input: 5, cached: 0.5, output: 25 },
  "claude-opus-4-8": { input: 5, cached: 0.5, output: 25 },
  "claude-opus-4-7": { input: 5, cached: 0.5, output: 25 },
  "claude-opus-4-6": { input: 5, cached: 0.5, output: 25 },
  "claude-opus-4-5-20251101": { input: 5, cached: 0.5, output: 25 },
  "claude-sonnet-5-5": { input: 2, cached: 0.1, output: 10 },
  "claude-sonnet-5": { input: 2, cached: 0.2, output: 10 },
  "claude-sonnet-4-6": { input: 3, cached: 0.3, output: 15 },
  "claude-sonnet-4-5-20250929": { input: 3, cached: 0.3, output: 15 },
  "claude-haiku-5-5": { input: 0.1, cached: 0.01, output: 0.5 },
  "claude-haiku-4-5-20251001": { input: 1, cached: 0.1, output: 5 },
};

export function priceFor(model: string) {
  if (PRICING[model]) return PRICING[model];
  // dated snapshot → alias
  const alias = model.replace(/-\d{4}-\d{2}-\d{2}$/, "");
  return PRICING[alias] ?? null;
}

export function estimateCost(model: string, inTok: number, outTok: number, cachedTok = 0) {
  const p = priceFor(model);
  if (!p) return null;
  const uncached = Math.max(0, inTok - cachedTok);
  return (uncached * p.input + cachedTok * (p.cached ?? p.input) + outTok * p.output) / 1e6;
}

export interface Usage { input_tokens: number; output_tokens: number; cached_tokens?: number; reasoning_tokens?: number; source: "provider" }

export interface CallResult {
  ok: boolean;
  text: string;
  toolCalls: { name: string; args: unknown }[];
  usage: Usage | null;
  ttft_ms: number | null;
  total_ms: number;
  error?: string;
  errorType?: string;
  status?: number;
  stop?: string | null;
  raw?: unknown;
}

export const now = () => performance.now();

export function errInfo(e: any) {
  return {
    error: String(e?.message ?? e).slice(0, 600),
    errorType: e?.constructor?.name ?? typeof e,
    status: typeof e?.status === "number" ? e.status : undefined,
  };
}

export function writeJSON(file: string, data: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}
export function appendJSONL(file: string, data: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(data) + "\n");
}

/** 64x64 solid red PNG for vision probes. */
export const RED_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAS0lEQVR42u3PQQkAAAgAsetfWiP4FgYrsKZeS0BAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEDgsqnc8OJg6Ln3AAAAAElFTkSuQmCC";

export async function pLimit<T>(n: number, tasks: (() => Promise<T>)[]): Promise<T[]> {
  const out: T[] = new Array(tasks.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, tasks.length) }, async () => {
    while (i < tasks.length) { const k = i++; out[k] = await tasks[k](); }
  }));
  return out;
}
