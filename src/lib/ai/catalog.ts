import "@/lib/net-defaults";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import type { Provider } from "./types";
import { loadProviders, invalidateProviders, providerConfigured, providerKey, providerDef, catalogId, type ProviderDef } from "./registry";
import { fetchModelList } from "./openai-compatible";
import { creatorOf } from "./creators";

export type ModelRow = typeof schema.aiModels.$inferSelect;
let cache: { at: number; rows: ModelRow[] } | null = null;
export async function listModels(force = false): Promise<ModelRow[]> {
  if (!force && cache && Date.now() - cache.at < 60_000) return cache.rows;
  await loadProviders(force);
  const rows = await db.select().from(schema.aiModels);
  cache = { at: Date.now(), rows }; return rows;
}
export async function getModel(id: string) { return (await listModels()).find((m) => m.id === id) ?? null; }
export function invalidateCatalog() { cache = null; invalidateProviders(); }

export function costUsd(m: ModelRow | null, u: { inputTokens: number; outputTokens: number; cachedTokens?: number }) {
  if (!m || m.inputPrice == null || m.outputPrice == null) return null;
  const cached = u.cachedTokens ?? 0;
  return ((u.inputTokens - cached) * m.inputPrice + cached * (m.cachedPrice ?? m.inputPrice) + u.outputTokens * m.outputPrice) / 1e6;
}

export { providerConfigured };

const UNBENCHMARKED = "listed by the provider's /models; not probed or benchmarked — selectable manually, never routed automatically";
/** Catalogue hosts whose `/models` is documented as public: listed even without a key (the models stay unavailable until a key exists). */
const PUBLIC_CATALOGUES = new Set(["openrouter.ai"]);

async function discoverNative(p: "openai" | "anthropic", existing: ModelRow[], now: Date): Promise<number> {
  const seen = new Set<string>();
  const ids: { id: string; display?: string; created?: string }[] = [];
  if (p === "openai") { const c = new OpenAI(); for await (const m of c.models.list() as any) ids.push({ id: m.id, created: new Date(m.created * 1000).toISOString() }); }
  else { const c = new Anthropic(); for await (const m of c.models.list({ limit: 100 }) as any) ids.push({ id: m.id, display: m.display_name, created: m.created_at }); }
  for (const m of ids) {
    seen.add(m.id);
    const ex = existing.find((e) => e.id === m.id);
    if (ex) { if (!ex.available) await db.update(schema.aiModels).set({ available: true, discoveredAt: now, updatedAt: now }).where(eq(schema.aiModels.id, m.id)); }
    else if (p === "anthropic" || /^(gpt|o\d|chat-latest)/.test(m.id) && !/(image|audio|tts|transcribe|whisper|realtime|live|sora|embedding|moderation|search|deep-research|instruct|davinci|babbage)/.test(m.id)) {
      await db.insert(schema.aiModels).values({ id: m.id, provider: p, displayName: m.display ?? m.id, category: "text", available: true, enabled: false, creator: creatorOf(m.id, p), route: p, notes: ["discovered live; not probed/benchmarked yet — run pnpm bench:discover"], discoveredAt: now }).onConflictDoNothing();
    }
  }
  for (const e of existing) if (e.provider === p && e.available && !seen.has(e.id)) await db.update(schema.aiModels).set({ available: false, updatedAt: now }).where(eq(schema.aiModels.id, e.id));
  return ids.length;
}

/**
 * Catalogue of an OpenAI-compatible provider through `GET {base_url}/models`: context window, prices (USD per 1M tokens) and declared
 * capabilities are stored exactly as the provider publishes them (unknown stays null). New models are inserted enabled — selectable by
 * hand — with empty `probes`/`benchmark`, which is what keeps them out of automatic routing. An existing row keeps its `enabled` flag.
 */
export async function discoverCompatible(def: ProviderDef, existing: ModelRow[], now = new Date(), fetchImpl?: typeof fetch): Promise<{ listed: number; keyless: boolean }> {
  if (!def.baseUrl) throw new Error("no base URL");
  const key = providerKey(def.id);
  const list = (await fetchModelList(def.baseUrl, key, { fetchImpl })).filter((m) => m.textOutput);
  const seen = new Set<string>();
  for (const m of list) {
    const id = catalogId(def.id, m.remoteId); seen.add(id);
    const meta = { displayName: m.name, available: true, contextWindow: m.contextWindow, maxOutput: m.maxOutput, inputPrice: m.inputPrice, cachedPrice: m.cachedPrice, outputPrice: m.outputPrice, pricingSource: m.inputPrice != null ? `${def.baseUrl}/models` : null, capabilities: m.capabilities, creator: creatorOf(m.remoteId, def.id), route: def.id, discoveredAt: now, updatedAt: now };
    await db.insert(schema.aiModels).values({ id, provider: def.id, category: "text", enabled: true, notes: [UNBENCHMARKED], ...meta }).onConflictDoUpdate({ target: schema.aiModels.id, set: meta });
  }
  for (const e of existing) if (e.provider === def.id && e.available && !seen.has(e.id)) await db.update(schema.aiModels).set({ available: false, updatedAt: now }).where(eq(schema.aiModels.id, e.id));
  return { listed: list.length, keyless: !key };
}

/**
 * Live discovery: re-list every provider and flip `available`. Native providers: new ids are inserted as untested (enabled=false).
 * OpenAI-compatible providers: see `discoverCompatible`. A provider without key is reported `no key`; its catalogue is still read when
 * the endpoint is a documented public catalogue (OpenRouter), so the models can be shown — as unavailable — before a key exists.
 */
export async function refreshDiscovery(only?: string[]) {
  const now = new Date(); const report: Record<string, { listed: number; status: string }> = {};
  const existing = await listModels(true);
  const defs = (await loadProviders(true)).filter((d) => d.enabled && (!only || only.includes(d.id)));
  for (const d of defs) {
    const p = d.id; const hasKey = providerConfigured(p);
    try {
      if (d.kind === "openai_compatible") {
        let host = ""; try { host = new URL(d.baseUrl ?? "").hostname; } catch { /* invalid URL → error below */ }
        if (!hasKey && !PUBLIC_CATALOGUES.has(host)) { report[p] = { listed: 0, status: "no key" }; await db.update(schema.aiProviders).set({ status: "no_key", statusDetail: `${d.keyEnv ?? "key variable"} is not set`, lastDiscoveryAt: now }).where(eq(schema.aiProviders.id, p)); continue; }
        const r = await discoverCompatible(d, existing, now);
        report[p] = { listed: r.listed, status: hasKey ? "ok" : "no key" };
        await db.update(schema.aiProviders).set({ status: hasKey ? "ok" : "no_key", statusDetail: hasKey ? `${r.listed} models` : `${r.listed} models listed from the public catalogue; ${d.keyEnv} is not set`, lastDiscoveryAt: now }).where(eq(schema.aiProviders.id, p));
        continue;
      }
      if (!hasKey) { report[p] = { listed: 0, status: "no key" }; await db.update(schema.aiProviders).set({ status: "no_key", lastDiscoveryAt: now }).where(eq(schema.aiProviders.id, p)); continue; }
      const n = await discoverNative(d.kind, existing, now);
      report[p] = { listed: n, status: "ok" };
      await db.update(schema.aiProviders).set({ status: "ok", statusDetail: `${n} models`, lastDiscoveryAt: now }).where(eq(schema.aiProviders.id, p));
    } catch (e: any) { report[p] = { listed: 0, status: String(e.message).slice(0, 200) }; await db.update(schema.aiProviders).set({ status: "error", statusDetail: String(e.message).slice(0, 200), lastDiscoveryAt: now }).where(eq(schema.aiProviders.id, p)); }
  }
  invalidateCatalog(); return report;
}
export { providerDef };
