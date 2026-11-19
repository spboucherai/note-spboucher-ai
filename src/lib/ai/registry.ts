/**
 * Provider registry (SPEC §3.5). A provider is one API route: `openai` (Responses API), `anthropic` (Messages API) or any number of
 * `openai_compatible` endpoints (Chat Completions + SSE) described by a base URL and the NAME of the environment variable holding
 * their key. The key itself never leaves `process.env`: it is not stored in the database, not logged, not returned by any route.
 *
 * Availability rule: a provider is usable when its row is enabled AND its key variable is set. A provider without key is listed as
 * unavailable and is never routed to.
 *
 * `providerConfigured()` is synchronous (the router calls it inside filters): it reads an in-process copy of the `ai_providers` rows,
 * refreshed by `loadProviders()` (called by the catalogue on every refresh, at most once a minute). Before the first load the built-in
 * definitions below — identical to the rows seeded by migration 0004 — are used.
 */
import { db, schema } from "@/db";
import type { Provider } from "./types";

export type ProviderKind = "openai" | "anthropic" | "openai_compatible";
export interface ProviderDef { id: string; kind: ProviderKind; name: string; label: string; baseUrl: string | null; keyEnv: string | null; enabled: boolean }

export const BUILTIN_PROVIDERS: ProviderDef[] = [
  { id: "openai", kind: "openai", name: "OpenAI", label: "OpenAI API", baseUrl: null, keyEnv: "OPENAI_API_KEY", enabled: true },
  { id: "anthropic", kind: "anthropic", name: "Anthropic", label: "Anthropic API", baseUrl: null, keyEnv: "ANTHROPIC_API_KEY", enabled: true },
  { id: "openrouter", kind: "openai_compatible", name: "OpenRouter", label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", keyEnv: "OPENROUTER_API_KEY", enabled: true },
  { id: "maclustr", kind: "openai_compatible", name: "MacLustr LLM", label: "MacLustr", baseUrl: "https://llm.spboucher.ai/v1", keyEnv: "MACLUSTR_LLM_API_KEY", enabled: true },
];
const KINDS = new Set<ProviderKind>(["openai", "anthropic", "openai_compatible"]);
const ENV_NAME = /^[A-Z][A-Z0-9_]{2,63}$/;

let defs = new Map<string, ProviderDef>(BUILTIN_PROVIDERS.map((p) => [p.id, p]));
let loadedAt = 0;
type Row = typeof schema.aiProviders.$inferSelect;
const toDef = (r: Row): ProviderDef => {
  const kind = (KINDS.has(r.kind as ProviderKind) ? r.kind : "openai_compatible") as ProviderKind;
  return { id: r.id, kind, name: r.name, label: r.label ?? r.name, baseUrl: r.baseUrl ? r.baseUrl.replace(/\/+$/, "") : null, keyEnv: r.keyEnv && ENV_NAME.test(r.keyEnv) ? r.keyEnv : null, enabled: r.enabled };
};
/** Re-read `ai_providers` (cached 60 s unless forced). Rows win over the built-ins; built-ins missing from the table stay known. */
export async function loadProviders(force = false): Promise<ProviderDef[]> {
  if (!force && loadedAt && Date.now() - loadedAt < 60_000) return [...defs.values()];
  const rows = await db.select().from(schema.aiProviders);
  const next = new Map<string, ProviderDef>(BUILTIN_PROVIDERS.map((p) => [p.id, p]));
  for (const r of rows) next.set(r.id, toDef(r));
  defs = next; loadedAt = Date.now();
  return [...defs.values()];
}
export function invalidateProviders() { loadedAt = 0; }
export const providerDef = (id: Provider | string): ProviderDef | null => defs.get(id) ?? null;
export const listProviderDefs = (): ProviderDef[] => [...defs.values()];
/** The provider's API key, or null. Only the adapters call this. */
export function providerKey(id: Provider | string): string | null {
  const d = providerDef(id); if (!d?.keyEnv) return null;
  const v = process.env[d.keyEnv]; return v && v.trim() ? v.trim() : null;
}
/** Usable = known, enabled, key present in the environment. */
export function providerConfigured(id: Provider | string): boolean { const d = providerDef(id); return Boolean(d && d.enabled && providerKey(id)); }
export const anyProviderConfigured = (): boolean => listProviderDefs().some((d) => providerConfigured(d.id));
/** `{ openai, anthropic, …every other provider…, any }` — the shape returned in chat/action plans (the two historical keys are always present). */
export function configuredMap(): { openai: boolean; anthropic: boolean; any: boolean } & Record<string, boolean> {
  const out: Record<string, boolean> = { openai: providerConfigured("openai"), anthropic: providerConfigured("anthropic") };
  for (const d of listProviderDefs()) out[d.id] = providerConfigured(d.id);
  out.any = Object.entries(out).some(([k, v]) => k !== "any" && v);
  return out as { openai: boolean; anthropic: boolean; any: boolean } & Record<string, boolean>;
}
/** Catalogue ids of OpenAI-compatible providers are namespaced `<provider>:<remote id>` so they can never collide with a native id. */
export const catalogId = (provider: string, remoteId: string) => `${provider}:${remoteId}`;
export const remoteModelId = (provider: string, id: string) => (id.startsWith(`${provider}:`) ? id.slice(provider.length + 1) : id);
