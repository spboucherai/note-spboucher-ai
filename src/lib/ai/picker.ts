/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/lib/ai/picker.ts
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
 * Pure logic of the model selector (src/components/ai/ModelPicker.tsx): search, grouping by creator, ordering, labels and keyboard
 * navigation. No React, no DOM — shared with the unit tests (and a reference for the native pickers, which read the same endpoint).
 */
export interface PickerModel {
  id: string; displayName: string | null; provider: string; category?: string;
  creator: string; creatorName: string; logo: string; monogram: string;
  route: string; routeLabel: string; remoteId?: string;
  context: number | null; priceIn: number | null; priceOut: number | null;
  capabilities: { tools?: boolean | null; structuredOutput?: boolean | null; vision?: boolean | null; reasoning?: boolean | null; source?: string };
  available: boolean; unavailableReason: string | null; autoRoutable: boolean;
  benchmark?: { mean_score?: number | null } | null;
}
export interface PickerGroup { creator: string; creatorName: string; logo: string; monogram: string; models: PickerModel[] }

export const modelName = (m: Pick<PickerModel, "id" | "displayName" | "remoteId">) => (m.displayName && m.displayName.trim()) || m.remoteId || m.id;
/** 200000 → "200K", 1000000 → "1M", 128000 → "128K", 1048576 → "1M". */
export function formatContext(n: number | null | undefined): string | null {
  if (!n || n <= 0) return null;
  if (n >= 1_000_000) { const v = n / 1_000_000; return `${v >= 10 || Math.abs(v - Math.round(v)) < 0.06 ? Math.round(v) : v.toFixed(1)}M`; }
  return n >= 1000 ? `${Math.round(n / 1000)}K` : String(n);
}
const usd = (v: number) => (v === 0 ? "0" : v >= 100 ? v.toFixed(0) : v >= 1 ? v.toFixed(2).replace(/\.?0+$/, "") : v.toFixed(4).replace(/0+$/, "").replace(/\.$/, ""));
/** "$3 / $15" (input / output, USD per 1M tokens); "free" when both are 0; null when the price is not published. */
export function formatPrice(priceIn: number | null | undefined, priceOut: number | null | undefined): string | null {
  if (priceIn == null || priceOut == null) return null;
  if (priceIn === 0 && priceOut === 0) return "free";
  return `$${usd(priceIn)} / $${usd(priceOut)}`;
}
export const REASON_LABEL: Record<string, string> = { no_key: "no API key", provider_disabled: "provider disabled", not_listed: "no longer listed", disabled: "disabled" };
export function capabilityChips(m: Pick<PickerModel, "capabilities">): string[] {
  const c = m.capabilities ?? {}; const out: string[] = [];
  if (c.vision) out.push("vision"); if (c.tools) out.push("tools"); if (c.structuredOutput) out.push("JSON"); if (c.reasoning) out.push("reasoning");
  return out;
}
const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
/** Every word of the query must appear in the model's name, id, creator or route. */
export function matches(m: PickerModel, query: string): boolean {
  const q = norm(query).split(/\s+/).filter(Boolean); if (!q.length) return true;
  const hay = norm(`${modelName(m)} ${m.id} ${m.creatorName} ${m.creator} ${m.routeLabel} ${m.route}`);
  return q.every((w) => hay.includes(w));
}
/**
 * Models grouped by creator. Inside a group: available first, then benchmarked (best measured score first), then by name.
 * Groups: those with an available model first, then by creator name. Unavailable models are hidden unless asked for.
 */
export function groupModels(models: PickerModel[], query = "", opts: { showUnavailable?: boolean } = {}): PickerGroup[] {
  const by = new Map<string, PickerGroup>();
  for (const m of models) {
    if (m.category === "embedding" || !matches(m, query) || (!m.available && !opts.showUnavailable)) continue;
    const g = by.get(m.creator) ?? { creator: m.creator, creatorName: m.creatorName, logo: m.logo, monogram: m.monogram, models: [] };
    g.models.push(m); by.set(m.creator, g);
  }
  const score = (m: PickerModel) => (typeof m.benchmark?.mean_score === "number" ? m.benchmark.mean_score : -1);
  for (const g of by.values()) g.models.sort((a, b) => Number(b.available) - Number(a.available) || Number(b.autoRoutable) - Number(a.autoRoutable) || score(b) - score(a) || modelName(a).localeCompare(modelName(b)) || a.id.localeCompare(b.id));
  return [...by.values()].sort((a, b) => Number(b.models.some((m) => m.available)) - Number(a.models.some((m) => m.available)) || a.creatorName.localeCompare(b.creatorName));
}
/** Flat list of selectable ids in display order (`null` = automatic routing, always first when the query is empty or matches "auto"). */
export function selectableIds(groups: PickerGroup[], query = ""): (string | null)[] {
  const auto = !query.trim() || "auto automatique measured routing".includes(norm(query.trim()));
  return [...(auto ? [null] : []), ...groups.flatMap((g) => g.models.filter((m) => m.available).map((m) => m.id))];
}
/** Keyboard navigation over `count` options: ArrowDown/ArrowUp wrap, Home/End jump, PageUp/PageDown move by 8. */
export function moveActive(current: number, key: string, count: number): number {
  if (count <= 0) return -1;
  switch (key) {
    case "ArrowDown": return current < 0 ? 0 : (current + 1) % count;
    case "ArrowUp": return current <= 0 ? count - 1 : current - 1;
    case "Home": return 0;
    case "End": return count - 1;
    case "PageDown": return Math.min(count - 1, Math.max(0, current) + 8);
    case "PageUp": return Math.max(0, current - 8);
    default: return Math.min(Math.max(current, -1), count - 1);
  }
}
