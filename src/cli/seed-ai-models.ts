/** Seeds ai_providers / ai_models from Phase Zero artefacts (discovery.json + summary.json). Idempotent. */
import fs from "node:fs";
import path from "node:path";
import { db, schema, sql } from "../db/index";
const disc = JSON.parse(fs.readFileSync(path.resolve("benchmarks/results/discovery.json"), "utf8"));
const summary = fs.existsSync("benchmarks/results/summary.json") ? JSON.parse(fs.readFileSync("benchmarks/results/summary.json", "utf8")) : { models: [] };
const bench = new Map<string, any>(summary.models.map((m: any) => [m.model, m]));
await db.insert(schema.aiProviders).values([{ id: "openai", name: "OpenAI" }, { id: "anthropic", name: "Anthropic" }]).onConflictDoNothing();
let n = 0;
for (const m of disc.models) {
  if (m.verdict === "untested" && !m.aliasOf && !["text", "text-specialized", "embedding"].includes(m.category)) continue;
  const b = bench.get(m.id);
  const row = {
    id: m.id, provider: m.provider, displayName: m.display ?? m.id, category: m.category, available: m.verdict !== "unavailable", enabled: m.verdict === "tested" || m.category === "embedding",
    contextWindow: m.context ?? null, maxOutput: m.maxOutput ?? null,
    inputPrice: m.pricing?.input ?? null, cachedPrice: m.pricing?.cached ?? null, outputPrice: m.pricing?.output ?? null, pricingSource: m.provider === "openai" ? summary.pricing_sources?.openai?.url : summary.pricing_sources?.anthropic?.url,
    probes: m.probes ?? {}, benchmark: b ? { pass_rate: b.pass_rate, mean_score: b.mean_score, judged_mean: b.judged_mean, ttft_median_ms: b.ttft_median_ms, total_median_ms: b.total_median_ms, tps_median: b.tps_median, cost_mean: b.cost_mean, by_category: b.by_category, runs: b.runs, errors: b.errors } : {},
    capabilities: m.capabilities ?? {}, notes: m.notes ?? [], discoveredAt: new Date(disc.generated), probedAt: m.verdict === "tested" ? new Date(disc.generated) : null, benchmarkedAt: b ? new Date(summary.generated) : null, updatedAt: new Date(),
  };
  await db.insert(schema.aiModels).values(row).onConflictDoUpdate({ target: schema.aiModels.id, set: row });
  n++;
}
await db.insert(schema.settings).values({ key: "ai.benchmark_summary", value: { generated: summary.generated, runs: summary.runs, categories: summary.categories, judges: summary.judges, total_cost: summary.total_estimated_cost_usd } }).onConflictDoUpdate({ target: schema.settings.key, set: { value: { generated: summary.generated, runs: summary.runs, categories: summary.categories, judges: summary.judges, total_cost: summary.total_estimated_cost_usd }, updatedAt: new Date() } });
console.log(`seeded ${n} models`); await sql.end();
