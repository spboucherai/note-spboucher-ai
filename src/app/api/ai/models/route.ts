import { handler } from "@/lib/api";
import { listModels, refreshDiscovery, invalidateCatalog } from "@/lib/ai/catalog";
import { DEFAULT_ROUTES, getRoutes, TASK_LABELS } from "@/lib/ai/router";
import { loadProviders } from "@/lib/ai/registry";
import { modelView, providerView, isKeylessCompat } from "@/lib/ai/models-view";
import { CREATORS, creatorInfo, GENERIC_LOGO } from "@/lib/ai/creators";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { parseBody } from "@/lib/api";
import { audit } from "@/lib/audit";
/**
 * GET → catalogue for the model selector (SPEC §4.11). Historical shape kept (`models`, `providers`, `routes`, `defaultRoutes`,
 * `taskLabels`, `benchmark`); every model gains creator / logo / route / context / prices / normalised capabilities / availability, every
 * provider gains kind / baseUrl / keyEnv (the NAME of the variable, never its value) / label / available, and `creators` lists the logo
 * registry. Filters: `all=1` (also disabled, unlisted and embedding models), `provider=`, `creator=`, `available=1`, `q=`.
 * Models of an OpenAI-compatible provider that has no key (`available:false, unavailableReason:"no_key"` — several hundred for OpenRouter)
 * are left out of the default answer and counted in `hiddenUnavailable`; `unavailable=1` (or `all=1`, or `provider=`) includes them.
 */
export const GET = handler(async ({ req }) => {
  const u = new URL(req.url).searchParams; const all = u.get("all") === "1";
  const provider = u.get("provider"); const creator = u.get("creator"); const onlyAvailable = u.get("available") === "1"; const q = (u.get("q") ?? "").trim().toLowerCase();
  const defs = await loadProviders();
  let models = (await listModels()).filter((m) => all || (m.available && m.enabled && m.category !== "embedding")).map(modelView);
  const includeUnavailable = all || u.get("unavailable") === "1" || Boolean(provider);
  const hiddenUnavailable = includeUnavailable ? 0 : models.filter(isKeylessCompat).length;
  if (!includeUnavailable) models = models.filter((m) => !isKeylessCompat(m));
  if (provider) models = models.filter((m) => m.provider === provider);
  if (creator) models = models.filter((m) => m.creator === creator);
  if (onlyAvailable) models = models.filter((m) => m.available);
  if (q) models = models.filter((m) => `${m.id} ${m.displayName ?? ""} ${m.creatorName} ${m.routeLabel}`.toLowerCase().includes(q));
  const rows = new Map((await db.select().from(schema.aiProviders)).map((p) => [p.id, p]));
  const [summary] = await db.select().from(schema.settings).where(eq(schema.settings.key, "ai.benchmark_summary"));
  const used = new Set(models.map((m) => m.creator));
  const creators = [...CREATORS.map((c) => creatorInfo(c.id)), ...[...used].filter((id) => !CREATORS.some((c) => c.id === id)).map((id) => creatorInfo(id))].map((c) => ({ id: c.id, name: c.name, logo: c.logo, monogram: c.monogram, generic: c.logo === GENERIC_LOGO }));
  return Response.json({
    models: models.sort((a, b) => a.provider.localeCompare(b.provider) || ((b.benchmark as any)?.mean_score ?? -1) - ((a.benchmark as any)?.mean_score ?? -1) || a.id.localeCompare(b.id)),
    providers: defs.filter((d) => rows.has(d.id)).map((d) => providerView(d, rows.get(d.id))),
    creators, hiddenUnavailable, routes: await getRoutes(), defaultRoutes: DEFAULT_ROUTES, taskLabels: TASK_LABELS, benchmark: summary?.value ?? null,
  });
});
/** POST { action: "discover", provider? } → live re-discovery (all providers, or one); { action: "toggle", id, enabled } ; { action: "routes", routes } ; { action: "budget", usd } */
export const POST = handler(async ({ req, user }) => {
  const b = await parseBody(req, z.object({ action: z.enum(["discover", "toggle", "routes", "budget"]), id: z.string().max(200).optional(), provider: z.string().max(60).optional(), enabled: z.boolean().optional(), routes: z.record(z.string(), z.any()).optional(), usd: z.number().min(0).max(10_000).optional() }));
  if (b.action === "discover") { const r = await refreshDiscovery(b.provider ? [b.provider] : undefined); await audit(user.id, "ai.discover", undefined, r); return Response.json(r); }
  if (b.action === "toggle" && b.id) { await db.update(schema.aiModels).set({ enabled: Boolean(b.enabled), updatedAt: new Date() }).where(eq(schema.aiModels.id, b.id)); invalidateCatalog(); await audit(user.id, "ai.model_toggle", { type: "model", id: b.id }, { enabled: b.enabled }); return Response.json({ ok: true }); }
  if (b.action === "routes") { await db.insert(schema.settings).values({ key: "ai.routes", value: b.routes ?? {} }).onConflictDoUpdate({ target: schema.settings.key, set: { value: b.routes ?? {}, updatedAt: new Date() } }); await audit(user.id, "ai.routes_update"); return Response.json({ ok: true }); }
  if (b.action === "budget") { await db.insert(schema.settings).values({ key: "ai.daily_budget_usd", value: b.usd ?? 20 }).onConflictDoUpdate({ target: schema.settings.key, set: { value: b.usd ?? 20, updatedAt: new Date() } }); return Response.json({ ok: true }); }
  return Response.json({ error: "bad request" }, { status: 400 });
});
