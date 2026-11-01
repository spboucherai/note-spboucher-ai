import { db, schema } from "@/db";
import { eq } from "drizzle-orm";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import type { Provider } from "./types";

export type ModelRow = typeof schema.aiModels.$inferSelect;
let cache: { at: number; rows: ModelRow[] } | null = null;
export async function listModels(force = false): Promise<ModelRow[]> {
  if (!force && cache && Date.now() - cache.at < 60_000) return cache.rows;
  const rows = await db.select().from(schema.aiModels);
  cache = { at: Date.now(), rows }; return rows;
}
export async function getModel(id: string) { return (await listModels()).find((m) => m.id === id) ?? null; }
export function invalidateCatalog() { cache = null; }

export function costUsd(m: ModelRow | null, u: { inputTokens: number; outputTokens: number; cachedTokens?: number }) {
  if (!m || m.inputPrice == null || m.outputPrice == null) return null;
  const cached = u.cachedTokens ?? 0;
  return ((u.inputTokens - cached) * m.inputPrice + cached * (m.cachedPrice ?? m.inputPrice) + u.outputTokens * m.outputPrice) / 1e6;
}

export function providerConfigured(p: Provider) { return Boolean(p === "openai" ? process.env.OPENAI_API_KEY : process.env.ANTHROPIC_API_KEY); }

/** Live discovery: re-list both providers and flip `available`; new ids are inserted as untested (enabled=false). */
export async function refreshDiscovery() {
  const now = new Date(); const seen = new Set<string>(); const report: Record<string, { listed: number; status: string }> = {};
  const existing = await listModels(true);
  for (const p of ["openai", "anthropic"] as Provider[]) {
    if (!providerConfigured(p)) { report[p] = { listed: 0, status: "no key" }; await db.update(schema.aiProviders).set({ status: "no_key", lastDiscoveryAt: now }).where(eq(schema.aiProviders.id, p)); continue; }
    try {
      const ids: { id: string; display?: string; created?: string }[] = [];
      if (p === "openai") { const c = new OpenAI(); for await (const m of c.models.list() as any) ids.push({ id: m.id, created: new Date(m.created * 1000).toISOString() }); }
      else { const c = new Anthropic(); for await (const m of c.models.list({ limit: 100 }) as any) ids.push({ id: m.id, display: m.display_name, created: m.created_at }); }
      for (const m of ids) {
        seen.add(m.id);
        const ex = existing.find((e) => e.id === m.id);
        if (ex) { if (!ex.available) await db.update(schema.aiModels).set({ available: true, discoveredAt: now, updatedAt: now }).where(eq(schema.aiModels.id, m.id)); }
        else if (p === "anthropic" || /^(gpt|o\d|chat-latest)/.test(m.id) && !/(image|audio|tts|transcribe|whisper|realtime|live|sora|embedding|moderation|search|deep-research|instruct|davinci|babbage)/.test(m.id)) {
          await db.insert(schema.aiModels).values({ id: m.id, provider: p, displayName: m.display ?? m.id, category: "text", available: true, enabled: false, notes: ["discovered live; not probed/benchmarked yet — run pnpm bench:discover"], discoveredAt: now }).onConflictDoNothing();
        }
      }
      for (const e of existing) if (e.provider === p && e.available && !seen.has(e.id)) await db.update(schema.aiModels).set({ available: false, updatedAt: now }).where(eq(schema.aiModels.id, e.id));
      report[p] = { listed: ids.length, status: "ok" };
      await db.update(schema.aiProviders).set({ status: "ok", statusDetail: `${ids.length} models`, lastDiscoveryAt: now }).where(eq(schema.aiProviders.id, p));
    } catch (e: any) { report[p] = { listed: 0, status: e.message }; await db.update(schema.aiProviders).set({ status: "error", statusDetail: String(e.message).slice(0, 200), lastDiscoveryAt: now }).where(eq(schema.aiProviders.id, p)); }
  }
  invalidateCatalog(); return report;
}
