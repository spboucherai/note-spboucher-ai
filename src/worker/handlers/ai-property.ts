/**
 * ai-property job: { rowId, propertyId, runId? } — compute an AI property from the row's other values and store it in database_rows.values.
 * NEXT-AI: the property's `config.ai` chooses the task (custom | summarize | classify | extract | detect-date | categorize), an optional
 * model override, and every attempt is logged in `ai_property_runs` (status, model, tokens, cost, error). See src/lib/ai/properties.ts.
 */
import { and, eq, inArray, sql as dsql } from "drizzle-orm";
import { db, schema } from "../../db/index";
import { route } from "../../lib/ai/router";
import { callAI } from "../../lib/ai/providers";
import { recordUsage } from "../../lib/ai/usage";
import { INJECTION_GUARD } from "../../lib/ai/prompts";
import { displayValue, sortedProps } from "../../lib/databases/values";
import type { Property } from "../../lib/databases/types";
import { aiConfigOf, configProblem, taskSpec, outputHash } from "../../lib/ai/properties";

const SYSTEM = `You fill in one cell of a database in the user's private knowledge workspace. You receive the instruction for the cell and the other properties of the same row. Return only the value of the cell: plain text, no preamble, no Markdown headings, no quotes around the answer. Keep it concise unless the instruction asks otherwise. Answer in the language of the row's content (French or English).
${INJECTION_GUARD}`;

export async function handleAiProperty(d: { rowId: string; propertyId: string; workspaceId?: string; runId?: string }) {
  if (!d?.rowId || !d?.propertyId) return { ignored: true };
  const [row] = await db.select({ id: schema.databaseRows.id, databaseId: schema.databaseRows.databaseId, values: schema.databaseRows.values, title: schema.pages.title, plainText: schema.pages.plainText, deletedAt: schema.databaseRows.deletedAt }).from(schema.databaseRows).innerJoin(schema.pages, eq(schema.pages.id, schema.databaseRows.pageId)).where(eq(schema.databaseRows.id, d.rowId));
  if (!row || row.deletedAt) return { ignored: "row missing" };
  const props = (await db.select().from(schema.databaseProperties).where(eq(schema.databaseProperties.databaseId, row.databaseId))) as Property[];
  const prop = props.find((p) => p.id === d.propertyId); if (!prop || prop.type !== "ai") return { ignored: "not an ai property" };
  const [dbRow] = await db.select({ workspaceId: schema.databases.workspaceId, name: schema.databases.name }).from(schema.databases).where(eq(schema.databases.id, row.databaseId));
  const wsId = dbRow?.workspaceId ?? d.workspaceId ?? null;
  const write = (v: unknown) => db.update(schema.databaseRows).set({ values: dsql`${schema.databaseRows.values} || ${JSON.stringify({ [prop.id]: v })}::jsonb`, updatedAt: new Date() }).where(eq(schema.databaseRows.id, row.id));
  const cfg = aiConfigOf(prop); const spec = taskSpec(cfg); const Runs = schema.aiPropertyRuns;
  // run log: the row created at queue time, or a new one when the job was queued by an older client without a run id
  let runId = d.runId ?? null;
  if (runId) await db.update(Runs).set({ status: "running", startedAt: new Date() }).where(eq(Runs.id, runId));
  else if (wsId) { const [r] = await db.insert(Runs).values({ workspaceId: wsId, databaseId: row.databaseId, propertyId: prop.id, rowId: row.id, status: "running", trigger: "manual", task: cfg.task, startedAt: new Date() }).returning({ id: Runs.id }); runId = r.id; }
  const log = (set: Record<string, unknown>) => (runId ? db.update(Runs).set({ ...set, finishedAt: new Date() }).where(eq(Runs.id, runId)) : Promise.resolve());
  const problem = configProblem(cfg);
  if (problem) { await write({ error: problem }); await log({ status: "failed", error: problem }); return { error: "bad config" }; }
  const promptTpl = spec.instruction;
  // relation titles for context
  const relProps = props.filter((p) => p.type === "relation"); const relTitles = new Map<string, string[]>();
  if (relProps.length) {
    const fwd = relProps.filter((p) => !p.config.syncedPropertyId).map((p) => p.id); const syn = relProps.filter((p) => p.config.syncedPropertyId);
    const links: { propertyId: string; other: string }[] = [];
    if (fwd.length) for (const r of await db.select().from(schema.relationsTable).where(and(inArray(schema.relationsTable.propertyId, fwd), eq(schema.relationsTable.fromRowId, row.id)))) links.push({ propertyId: r.propertyId, other: r.toRowId });
    if (syn.length) for (const r of await db.select().from(schema.relationsTable).where(and(inArray(schema.relationsTable.propertyId, syn.map((p) => p.config.syncedPropertyId as string)), eq(schema.relationsTable.toRowId, row.id)))) links.push({ propertyId: syn.find((p) => p.config.syncedPropertyId === r.propertyId)!.id, other: r.fromRowId });
    if (links.length) { const titles = new Map((await db.select({ id: schema.databaseRows.id, title: schema.pages.title }).from(schema.databaseRows).innerJoin(schema.pages, eq(schema.pages.id, schema.databaseRows.pageId)).where(inArray(schema.databaseRows.id, links.map((l) => l.other)))).map((t) => [t.id, t.title])); for (const l of links) { const a = relTitles.get(l.propertyId) ?? []; const t = titles.get(l.other); if (t) a.push(t); relTitles.set(l.propertyId, a); } }
  }
  const lines: string[] = []; const byName: Record<string, string> = {};
  for (const p of sortedProps(props)) {
    if (p.id === prop.id || p.type === "ai" || p.type === "rollup" || p.type === "formula") continue;
    const v = p.type === "title" ? row.title : p.type === "relation" ? (relTitles.get(p.id) ?? []).join(", ") : displayValue(p, row.values[p.id]);
    byName[p.name] = v; if (v) lines.push(`${p.name}: ${v}`);
  }
  const prompt = promptTpl.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, n) => byName[n] ?? "");
  const body = row.plainText ? `\n\nPage content:\n${row.plainText.slice(0, 6000)}` : "";
  const user = `Instruction for the cell "${prop.name}" of the database "${dbRow?.name ?? "database"}":\n${prompt}\n\n<workspace>\nRow properties:\n${lines.join("\n") || "(empty row)"}${body}\n</workspace>`;
  const t0 = Date.now(); let used: { provider: string; model: string } | null = null;
  try {
    const r = await route({ task: spec.routeTask, preferred: cfg.model, schema: Boolean(spec.schema), estTokens: Math.ceil(user.length / 3) + 800 });
    used = { provider: r.provider, model: r.model.id };
    const res = await callAI({ model: r.model.id, provider: r.provider, system: SYSTEM, messages: [{ role: "user", content: user }], effort: r.effort, maxTokens: 1200, timeoutMs: 120_000, ...(spec.schema ? { jsonSchema: spec.schema } : {}) });
    const value = res.refusal ? null : spec.parse(res.text);
    await write(res.refusal ? { error: res.refusal } : value);
    await recordUsage({ workspaceId: wsId, provider: res.provider, model: res.model, task: "ai_property", usage: res.usage, costUsd: res.costUsd, latencyMs: res.totalMs, ttftMs: res.ttftMs, ok: !res.refusal, error: res.refusal ?? null, refId: row.id });
    await log({ status: res.refusal ? "failed" : "done", model: res.model, provider: res.provider, inputTokens: res.usage.inputTokens, outputTokens: res.usage.outputTokens, costUsd: res.costUsd, outputHash: res.refusal ? null : outputHash(value), error: res.refusal ?? null });
    return { model: res.model, chars: (value ?? "").length, costUsd: res.costUsd };
  } catch (e: any) {
    const msg = String(e?.message ?? e).slice(0, 300);
    await write({ error: msg });
    await recordUsage({ workspaceId: wsId, provider: used?.provider ?? "none", model: used?.model ?? "unknown", task: "ai_property", ok: false, error: msg, latencyMs: Date.now() - t0, refId: row.id });
    await log({ status: "failed", model: used?.model ?? null, provider: used?.provider ?? null, error: msg });
    return { error: msg };
  }
}
