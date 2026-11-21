/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/components/ai/models/format.ts
 * Module           : components
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

/** Shared formatting + types for the AI model dashboard. */
export interface Bench { pass_rate?: number; mean_score?: number; judged_mean?: number | null; ttft_median_ms?: number; total_median_ms?: number; tps_median?: number; cost_mean?: number; runs?: number; errors?: number; by_category?: Record<string, { runs: number; errors: number; pass_rate: number; score: number; judged: number | null; ttft_ms: number; total_ms: number; tps: number; cost_mean: number; out_tokens?: number }> }
export interface ModelRow { id: string; provider: "openai" | "anthropic" | string; displayName: string | null; category: string; available: boolean; enabled: boolean; contextWindow: number | null; maxOutput: number | null; inputPrice: number | null; cachedPrice: number | null; outputPrice: number | null; pricingSource: string | null; probes: Record<string, { status: string; detail?: string; ms?: number }>; benchmark: Bench | null; notes: string[]; discoveredAt: string | null; probedAt: string | null; benchmarkedAt: string | null }
export interface ProviderRow { id: string; name: string; enabled: boolean; lastDiscoveryAt: string | null; status: string | null; statusDetail: string | null; configured: boolean }
export interface RouteDef { primary: string; fallback: string; effort: "low" | "medium" | "high"; categories: string[]; avoid?: string[] }
export interface ModelsPayload { models: ModelRow[]; providers: ProviderRow[]; routes: Record<string, RouteDef>; defaultRoutes: Record<string, RouteDef>; taskLabels: Record<string, string>; benchmark: { generated: string; runs: number; categories: { id: string; label: string }[]; judges: string[]; total_cost: number } | null }

export const pct = (v: number | null | undefined, d = 0) => (v == null ? "–" : `${(v * 100).toFixed(d)}%`);
export const ms = (v: number | null | undefined) => (v == null ? "–" : v >= 10_000 ? `${(v / 1000).toFixed(0)} s` : v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${Math.round(v)} ms`);
export const usd = (v: number | null | undefined, d?: number) => (v == null ? "–" : v === 0 ? "$0" : `$${v.toFixed(d ?? (v < 0.001 ? 5 : v < 0.01 ? 4 : v < 1 ? 3 : 2))}`);
export const perM = (v: number | null | undefined) => (v == null ? "–" : `$${v % 1 === 0 ? v.toFixed(0) : v < 1 ? v.toFixed(2) : v.toFixed(2).replace(/\.?0+$/, "")}`);
export const kTok = (v: number | null | undefined) => (v == null ? "–" : v >= 1_000_000 ? `${(v / 1_000_000).toFixed(v % 1_000_000 ? 2 : 0)}M` : v >= 1000 ? `${Math.round(v / 1000)}K` : String(v));
export const score = (v: number | null | undefined, d = 2) => (v == null ? "–" : v.toFixed(d));
export const hasBench = (m: ModelRow) => m.benchmark != null && typeof m.benchmark.pass_rate === "number";
export const providerTone = (p: string) => (p === "openai" ? "bg-accent" : p === "anthropic" ? "bg-ai" : "bg-fg-faint");
export const PROBES: { key: string; label: string; short: string }[] = [
  { key: "text", label: "Text", short: "T" }, { key: "streaming", label: "Streaming", short: "S" }, { key: "tool_use", label: "Tools", short: "F" }, { key: "structured_output", label: "JSON", short: "J" }, { key: "vision", label: "Vision", short: "V" }, { key: "reasoning_control", label: "Reasoning control", short: "R" },
];
