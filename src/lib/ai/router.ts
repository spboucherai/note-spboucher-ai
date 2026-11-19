import { listModels, type ModelRow, providerConfigured } from "./catalog";
import { providerDef } from "./registry";
import type { Provider, TaskClass, Effort } from "./types";
import { db, schema } from "@/db";
import { eq, gte, sql as dsql } from "drizzle-orm";

/** Default routes — see docs/ai-routing-strategy.md (measured 2026-11-01). Read from settings `ai.routes` when overridden. */
export const DEFAULT_ROUTES: Record<TaskClass, { primary: string; fallback: string; effort: Effort; categories: string[]; avoid?: string[] }> = {
  chat:    { primary: "gpt-6-sol",         fallback: "claude-sonnet-5-5", effort: "medium", categories: ["knowledge_synthesis", "simple_reasoning", "document_analysis"] },
  quick:   { primary: "claude-haiku-5-5",  fallback: "gpt-5.4-mini",      effort: "low",    categories: ["simple_reasoning", "json_generation"] },
  write:   { primary: "gpt-6-sol",         fallback: "claude-sonnet-4-6", effort: "medium", categories: ["french_writing", "english_writing"] },
  reason:  { primary: "claude-opus-5-5",   fallback: "gpt-6-astra",       effort: "high",   categories: ["complex_reasoning", "mathematics"] },
  deep:    { primary: "claude-fable-5-1",  fallback: "gpt-6-astra",       effort: "high",   categories: ["complex_reasoning", "knowledge_synthesis", "mathematics"] },
  code:    { primary: "gpt-5.3-codex",     fallback: "claude-sonnet-5-5", effort: "medium", categories: ["programming"] },
  extract: { primary: "gpt-5.4-mini",      fallback: "claude-haiku-5-5",  effort: "low",    categories: ["json_generation", "document_analysis", "tool_calling"] },
  longctx: { primary: "gpt-6.1-terra",     fallback: "claude-sonnet-5-5", effort: "medium", categories: ["long_context"], avoid: ["gpt-5.6-terra", "gpt-6-luna", "claude-fable-5"] },
  agent:   { primary: "claude-sonnet-5-5", fallback: "gpt-5.4",           effort: "medium", categories: ["tool_calling", "complex_reasoning"] },
  judge:   { primary: "claude-haiku-5-5",  fallback: "gpt-5.4-mini",      effort: "low",    categories: ["json_generation"] },
};
export const EMBEDDING_MODEL = "text-embedding-3-small";
export const TASK_LABELS: Record<TaskClass, string> = { chat: "Chat & Q&A", quick: "Quick tasks", write: "Writing", reason: "Reasoning", deep: "Deep research", code: "Code", extract: "Extraction", longctx: "Long context", agent: "Agents", judge: "Validation" };

export interface RouteNeeds { task: TaskClass; tools?: boolean; schema?: boolean; vision?: boolean; estTokens?: number; preferred?: string | null; }
export interface RouteDecision { model: ModelRow; provider: Provider; effort: Effort; reason: string; alternatives: string[] }

/**
 * Can this model serve the request?
 *  - automatic routing (`manual=false`): unchanged rule — the model must have passed the measured probes (`probes.text === ok`, plus the
 *    probe of each needed capability). Models of new providers have no probe data, so they are never picked automatically.
 *  - manual selection (`manual=true`, the owner chose this model): an unprobed model of an OpenAI-compatible provider is accepted on
 *    the capabilities its provider declares (tools, vision). A JSON schema is always accepted: the adapter states the schema in the
 *    prompt when the model does not declare structured outputs, and every caller validates the JSON it gets back.
 */
function eligible(m: ModelRow, n: RouteNeeds, manual = false) {
  if (!m.available || !m.enabled || m.category === "embedding" || !providerConfigured(m.provider as Provider)) return false;
  const p = m.probes ?? {};
  if (p.text?.status !== "ok") {
    if (!manual || providerDef(m.provider)?.kind !== "openai_compatible") return false;
    const c = (m.capabilities ?? {}) as { tools?: boolean | null; vision?: boolean | null };
    if (n.tools && c.tools !== true) return false;
    if (n.vision && c.vision !== true) return false;
    if (n.estTokens && m.contextWindow && m.contextWindow < n.estTokens * 1.2) return false;
    return true;
  }
  if (n.tools && p.tool_use?.status !== "ok") return false;
  if (n.schema && p.structured_output?.status !== "ok") return false;
  if (n.vision && p.vision?.status !== "ok") return false;
  if (n.estTokens && m.contextWindow && m.contextWindow < n.estTokens * 1.2) return false;
  return true;
}
/** True when the model takes part in automatic routing (it passed the measured text probe). */
export const autoRoutable = (m: Pick<ModelRow, "probes" | "category">) => m.category !== "embedding" && (m.probes ?? {}).text?.status === "ok";
function measured(m: ModelRow, cats: string[]) {
  const by = (m.benchmark as any)?.by_category ?? {}; const vals = cats.map((c) => by[c]?.score).filter((x) => typeof x === "number");
  return vals.length ? vals.reduce((a: number, b: number) => a + b, 0) / vals.length : -1;
}

export async function getRoutes(): Promise<typeof DEFAULT_ROUTES> {
  const [row] = await db.select().from(schema.settings).where(eq(schema.settings.key, "ai.routes"));
  return row ? { ...DEFAULT_ROUTES, ...(row.value as any) } : DEFAULT_ROUTES;
}

/** Daily spend guard: downgrade expensive classes when over budget. */
async function overBudget(): Promise<boolean> {
  const [b] = await db.select().from(schema.settings).where(eq(schema.settings.key, "ai.daily_budget_usd"));
  const budget = Number((b?.value as any) ?? 20);
  const [{ spent }] = await db.select({ spent: dsql<number>`coalesce(sum(cost_usd),0)` }).from(schema.aiUsage).where(gte(schema.aiUsage.createdAt, new Date(Date.now() - 864e5)));
  return Number(spent) >= budget;
}

export async function route(n: RouteNeeds): Promise<RouteDecision> {
  const models = await listModels();
  const routes = await getRoutes();
  let task = n.task;
  if ((task === "deep" || task === "reason") && (await overBudget())) task = task === "deep" ? "reason" : "chat";
  const r = routes[task];
  const avoid = new Set(r.avoid ?? []);
  const pick = (id: string | null | undefined, manual = false) => (id ? models.find((m) => m.id === id && eligible(m, n, manual) && !avoid.has(m.id)) ?? null : null);
  const pref = pick(n.preferred, true);
  if (pref) return { model: pref, provider: pref.provider as Provider, effort: r.effort, reason: "user selection", alternatives: [r.primary, r.fallback].filter((x) => x !== pref.id) };
  const prim = pick(r.primary); if (prim) return { model: prim, provider: prim.provider as Provider, effort: r.effort, reason: `primary route for ${task}${task !== n.task ? " (budget downgrade)" : ""}`, alternatives: [r.fallback] };
  const fb = pick(r.fallback); if (fb) return { model: fb, provider: fb.provider as Provider, effort: r.effort, reason: `fallback for ${task} (${r.primary} unavailable)`, alternatives: [] };
  const rest = models.filter((m) => eligible(m, n) && !avoid.has(m.id) && (m.benchmark as any)?.pass_rate != null)
    .sort((a, b) => measured(b, r.categories) - measured(a, r.categories) || ((a.benchmark as any).total_median_ms ?? 1e9) - ((b.benchmark as any).total_median_ms ?? 1e9) || ((a.benchmark as any).cost_mean ?? 1e9) - ((b.benchmark as any).cost_mean ?? 1e9));
  if (!rest.length) throw new Error("No eligible AI model (check provider keys and the model catalogue)");
  return { model: rest[0], provider: rest[0].provider as Provider, effort: r.effort, reason: `best measured model for ${task} (${rest[0].benchmark && (rest[0].benchmark as any).pass_rate != null ? Math.round((rest[0].benchmark as any).pass_rate * 100) + "% pass" : "untested"})`, alternatives: rest.slice(1, 3).map((m) => m.id) };
}

/** Heuristic task classifier used when the caller does not state the class. */
export function classifyTask(prompt: string, ctx: { hasSelection?: boolean; contextTokens?: number; wantsCode?: boolean } = {}): TaskClass {
  const p = prompt.toLowerCase();
  if (ctx.contextTokens && ctx.contextTokens > 60_000) return "longctx";
  if (ctx.wantsCode || /\b(code|function|script|regex|sql|python|typescript|javascript|formula)\b/.test(p)) return "code";
  if (/\b(prove|derive|theorem|equation|integral|probability|why does|contradict|compare.*(method|approach)|step by step)\b/.test(p)) return "reason";
  if (/\b(literature|synthesi[sz]e|research (question|plan)|review the papers|state of the art|deep dive|think hard)\b/.test(p)) return "deep";
  if (/\b(rewrite|rephrase|translate|traduis|réécris|improve the (tone|style)|draft|write (a|an|the)|rédige|paragraph|email|abstract|summar)/.test(p)) return "write";
  if (/\b(extract|as json|table of|list the fields|structured)\b/.test(p)) return "extract";
  if (p.length < 60 && /^(title|tag|label|name)\b/.test(p)) return "quick";
  return "chat";
}
