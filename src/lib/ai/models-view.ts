/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/lib/ai/models-view.ts
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
 * Shape of a model and of a provider in `GET /api/ai/models` (SPEC §4.11). Every historical field of the `ai_models` / `ai_providers`
 * rows is kept as it was; the fields below are added. Pure functions over rows + the provider registry (no DB access).
 */
import type { ModelRow } from "./catalog";
import { creatorInfo, creatorOf, routeLogo } from "./creators";
import { providerConfigured, providerDef, remoteModelId, type ProviderDef } from "./registry";

export interface NormalisedCapabilities { text: boolean | null; streaming: boolean | null; tools: boolean | null; structuredOutput: boolean | null; jsonMode: boolean | null; vision: boolean | null; reasoning: boolean | null; source: "measured" | "declared" | "unknown" }
const ok = (p: { status: string } | undefined): boolean | null => (p ? p.status === "ok" : null);
const bool = (v: unknown): boolean | null => (typeof v === "boolean" ? v : v && typeof v === "object" && typeof (v as { supported?: unknown }).supported === "boolean" ? (v as { supported: boolean }).supported : null);
/** Measured probes win (they were run against the real API); otherwise what the provider's catalogue declares; otherwise unknown (null). */
export function normaliseCapabilities(m: Pick<ModelRow, "probes" | "capabilities">): NormalisedCapabilities {
  const p = m.probes ?? {}; const c = (m.capabilities ?? {}) as Record<string, unknown>;
  if (p.text) return { text: ok(p.text), streaming: ok(p.streaming), tools: ok(p.tool_use), structuredOutput: ok(p.structured_output), jsonMode: ok(p.structured_output), vision: ok(p.vision), reasoning: ok(p.reasoning_control), source: "measured" };
  const declared = { tools: bool(c.tools), structuredOutput: bool(c.structured_output ?? c.structured_outputs), jsonMode: bool(c.json_mode), vision: bool(c.vision ?? c.image_input), reasoning: bool(c.reasoning ?? c.effort) };
  const any = Object.values(declared).some((v) => v !== null);
  return { text: any ? true : null, streaming: any ? true : null, ...declared, source: any ? "declared" : "unknown" };
}
export type UnavailableReason = "no_key" | "provider_disabled" | "not_listed" | "disabled" | null;
export function modelView(m: ModelRow) {
  const def = providerDef(m.provider); const creatorId = m.creator ?? creatorOf(m.id, m.provider); const c = creatorInfo(creatorId);
  const configured = providerConfigured(m.provider);
  const reason: UnavailableReason = !def?.enabled ? "provider_disabled" : !configured ? "no_key" : !m.available ? "not_listed" : !m.enabled ? "disabled" : null;
  const benchmarked = (m.probes ?? {}).text?.status === "ok";
  return {
    ...m,
    listed: m.available, available: reason === null, unavailableReason: reason,
    creator: c.id, creatorName: c.name, logo: c.logo, monogram: c.monogram,
    route: m.route ?? m.provider, routeLabel: def?.label ?? m.provider, routeKind: def?.kind ?? null, routeLogo: routeLogo(m.provider), remoteId: remoteModelId(m.provider, m.id),
    context: m.contextWindow ?? null, priceIn: m.inputPrice ?? null, priceOut: m.outputPrice ?? null, priceCached: m.cachedPrice ?? null, priceUnit: "USD per 1M tokens" as const,
    capabilities: { ...((m.capabilities ?? {}) as Record<string, unknown>), ...normaliseCapabilities(m) },
    benchmarked, autoRoutable: benchmarked && m.category !== "embedding",
  };
}
export type ModelView = ReturnType<typeof modelView>;
/** Model of an OpenAI-compatible provider that has no key: left out of the default catalogue answer (counted in `hiddenUnavailable`). */
export const isKeylessCompat = (m: Pick<ModelView, "unavailableReason" | "routeKind">) => m.unavailableReason === "no_key" && m.routeKind === "openai_compatible";
export function providerView(def: ProviderDef, row?: { lastDiscoveryAt: Date | null; status: string | null; statusDetail: string | null } | null) {
  const configured = providerConfigured(def.id);
  return { id: def.id, name: def.name, enabled: def.enabled, lastDiscoveryAt: row?.lastDiscoveryAt ?? null, status: row?.status ?? "unknown", statusDetail: row?.statusDetail ?? null,
    kind: def.kind, baseUrl: def.baseUrl, keyEnv: def.keyEnv, label: def.label, configured, available: configured && def.enabled, logo: routeLogo(def.id) };
}
