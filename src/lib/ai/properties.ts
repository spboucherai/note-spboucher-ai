/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/lib/ai/properties.ts
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
 * Smart database properties (SPEC "Smart Databases"): the AI column made configurable and observable.
 *
 * Configuration lives in the property's `config.ai` (no schema change; the historical `config.prompt` keeps working as a `custom` task):
 *   task     custom | summarize | classify | extract | detect-date | categorize
 *   prompt   instruction (required for custom and extract; optional extra guidance for the others); `{{Property}}` placeholders
 *   choices  allowed values for classify (exactly one is returned) and categorize (zero or more)
 *   model    model override (catalogue id) — otherwise the measured `quick` / `extract` route
 *   autoRun  recompute when another value of the row changes
 *   managed  the property is AI-managed: the AI may overwrite a value typed by hand
 *
 * Every computation is a row of `ai_property_runs` (queued → running → done | failed | skipped) with model, tokens, cost and error.
 * A value edited by hand — recognised because it differs from the output of the last successful run of that cell — is never overwritten
 * unless the property is `managed` or the owner forces that one cell. The guard runs at queue time, before the cell is marked pending.
 */
import { createHash } from "node:crypto";
import { and, desc, eq, inArray, isNull, sql as dsql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { HttpError } from "@/lib/errors";
import { enqueue, QUEUES } from "@/lib/jobs";
import { ensureDatabase } from "@/lib/databases/service";
import { isError, isPending, type Property } from "@/lib/databases/types";
import { budgetStatus } from "./usage";

export const AI_TASKS = ["custom", "summarize", "classify", "extract", "detect-date", "categorize"] as const;
export type AiTask = (typeof AI_TASKS)[number];
export interface AiPropertyConfig { task: AiTask; prompt: string; choices: string[]; model: string | null; autoRun: boolean; managed: boolean }
export const aiConfigSchema = z.object({
  task: z.enum(AI_TASKS).optional(), prompt: z.string().max(4000).optional(), choices: z.array(z.string().trim().min(1).max(80)).max(40).optional(),
  model: z.string().max(200).nullable().optional(), autoRun: z.boolean().optional(), managed: z.boolean().optional(),
}).strict();
/** Effective configuration of an AI property (defaults + legacy `config.prompt`). */
export function aiConfigOf(p: Pick<Property, "config">): AiPropertyConfig {
  const a = (p.config?.ai && typeof p.config.ai === "object" ? p.config.ai : {}) as Partial<AiPropertyConfig>;
  const task = (AI_TASKS as readonly string[]).includes(a.task as string) ? (a.task as AiTask) : "custom";
  const choices = Array.isArray(a.choices) ? [...new Set(a.choices.filter((c): c is string => typeof c === "string").map((c) => c.trim()).filter(Boolean))].slice(0, 40) : [];
  return { task, prompt: String(a.prompt ?? p.config?.prompt ?? "").trim(), choices, model: typeof a.model === "string" && a.model ? a.model : null, autoRun: a.autoRun === true, managed: a.managed === true };
}
/** Why a configuration cannot run, or null. */
export function configProblem(c: AiPropertyConfig): string | null {
  if ((c.task === "custom" || c.task === "extract") && !c.prompt) return c.task === "custom" ? "No prompt configured" : "Say what to extract (prompt)";
  if (c.task === "classify" && c.choices.length < 2) return "Classification needs at least two choices";
  return null;
}
export const outputHash = (v: unknown) => createHash("sha256").update(typeof v === "string" ? v : JSON.stringify(v ?? null)).digest("hex").slice(0, 32);
const R = schema.aiPropertyRuns;
const plain = (v: unknown) => v != null && v !== "" && !isPending(v) && !isError(v);

// ---------- per-task instruction and output contract
export interface TaskSpec { instruction: string; schema: { name: string; schema: Record<string, unknown> } | null; routeTask: "quick" | "extract"; parse: (text: string) => string | null }
const unquote = (s: string) => s.trim().replace(/^["“](.*)["”]$/s, "$1").trim();
const json = (text: string): any => { try { return JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, "")); } catch { return null; } };
const obj = (properties: Record<string, unknown>) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
/** Real calendar date in ISO form, or null. */
export function isoDate(s: unknown): string | null {
  if (typeof s !== "string") return null; const m = s.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/); if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])); return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] ? `${m[1]}-${m[2]}-${m[3]}` : null;
}
/** What the model is asked for and how its answer becomes a cell value. An answer outside the contract yields null — never a guess. */
export function taskSpec(c: AiPropertyConfig): TaskSpec {
  const extra = c.prompt ? `\nAdditional guidance from the owner: ${c.prompt}` : "";
  switch (c.task) {
    case "summarize": return { routeTask: "quick", schema: null, instruction: `Summarise this row in one or two sentences, using only its properties and page content.${extra}`, parse: (t) => unquote(t) || null };
    case "classify": return { routeTask: "extract", schema: { name: "classification", schema: obj({ value: { type: "string", enum: c.choices } }) }, instruction: `Classify this row into exactly one of these classes: ${c.choices.map((x) => `"${x}"`).join(", ")}. Return JSON {"value": "<class>"}.${extra}`,
      parse: (t) => { const v = json(t)?.value ?? unquote(t); const hit = c.choices.find((x) => x.toLowerCase() === String(v).trim().toLowerCase()); return hit ?? null; } };
    case "categorize": return { routeTask: "extract", schema: { name: "categories", schema: obj({ values: { type: "array", items: c.choices.length ? { type: "string", enum: c.choices } : { type: "string" } } }) },
      instruction: c.choices.length ? `Assign to this row the categories that apply among: ${c.choices.map((x) => `"${x}"`).join(", ")} — none, one or several. Return JSON {"values": [...]}.${extra}` : `Assign to this row up to three short thematic categories (lowercase, one or two words each). Return JSON {"values": [...]}.${extra}`,
      parse: (t) => { const vs = json(t)?.values; if (!Array.isArray(vs)) return null; const out: string[] = []; for (const v of vs) { if (typeof v !== "string") continue; const s = c.choices.length ? c.choices.find((x) => x.toLowerCase() === v.trim().toLowerCase()) : v.trim().toLowerCase().slice(0, 40); if (s && !out.includes(s)) out.push(s); } return out.slice(0, c.choices.length ? 40 : 3).join(", ") || null; } };
    case "detect-date": return { routeTask: "extract", schema: { name: "detected_date", schema: obj({ date: { type: "string" } }) }, instruction: `Find the date this row is about (deadline, event or publication date — the one the owner would file it under). Return JSON {"date": "YYYY-MM-DD"}, or {"date": ""} when the row states no date. Never guess a date that is not written.${extra}`,
      parse: (t) => isoDate(json(t)?.date) };
    case "extract": return { routeTask: "extract", schema: { name: "extraction", schema: obj({ value: { type: "string" } }) }, instruction: `Extract from this row: ${c.prompt}\nReturn JSON {"value": "<what you found, copied faithfully>"}, or {"value": ""} when the row does not contain it. Never invent a value.`,
      parse: (t) => { const v = json(t)?.value; return typeof v === "string" && v.trim() ? v.trim().slice(0, 2000) : null; } };
    default: return { routeTask: "quick", schema: null, instruction: c.prompt, parse: (t) => unquote(t) || null };
  }
}

// ---------- configuration
export async function setAiConfig(wsId: string, dbId: string, propertyId: string, patch: z.infer<typeof aiConfigSchema>) {
  const d = await ensureDatabase(wsId, dbId);
  const [p] = await db.select().from(schema.databaseProperties).where(and(eq(schema.databaseProperties.id, propertyId), eq(schema.databaseProperties.databaseId, d.id)));
  if (!p) throw new HttpError(404, "Property not found"); if (p.type !== "ai") throw new HttpError(400, "Not an AI property", "not_ai_property");
  const cur = aiConfigOf(p as Property); const next: AiPropertyConfig = { ...cur, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) } as AiPropertyConfig;
  next.choices = [...new Set(next.choices.map((c) => c.trim()).filter(Boolean))]; next.prompt = next.prompt.trim(); next.model = next.model || null;
  // `config.prompt` is kept in step so a client that only knows the historical field still sees the instruction
  const config = { ...(p.config as Record<string, unknown>), prompt: next.prompt, ai: next };
  await db.update(schema.databaseProperties).set({ config }).where(eq(schema.databaseProperties.id, propertyId));
  return { propertyId, name: p.name, ai: next, problem: configProblem(next) };
}
export async function listAiConfig(wsId: string, dbId: string) {
  const d = await ensureDatabase(wsId, dbId);
  const props = (await db.select().from(schema.databaseProperties).where(and(eq(schema.databaseProperties.databaseId, d.id), eq(schema.databaseProperties.type, "ai")))) as Property[];
  const stats = props.length ? await db.select({ propertyId: R.propertyId, status: R.status, n: dsql<number>`count(*)::int`, cost: dsql<number>`coalesce(sum(${R.costUsd}),0)::float8`, last: dsql<Date>`max(${R.createdAt})` }).from(R).where(inArray(R.propertyId, props.map((p) => p.id))).groupBy(R.propertyId, R.status) : [];
  return props.map((p) => { const c = aiConfigOf(p); const s = stats.filter((x) => x.propertyId === p.id); const count = (st: string) => s.find((x) => x.status === st)?.n ?? 0;
    return { propertyId: p.id, name: p.name, ai: c, problem: configProblem(c), runs: { queued: count("queued") + count("running"), done: count("done"), failed: count("failed"), skipped: count("skipped"), costUsd: s.reduce((a, x) => a + Number(x.cost), 0), lastAt: s.length ? new Date(Math.max(...s.map((x) => new Date(x.last).getTime()))).toISOString() : null } }; });
}
export async function listRuns(wsId: string, dbId: string, f: { propertyId?: string | null; rowId?: string | null; status?: string | null; limit?: number } = {}) {
  const d = await ensureDatabase(wsId, dbId);
  const rows = await db.select().from(R).where(and(eq(R.workspaceId, wsId), eq(R.databaseId, d.id), f.propertyId ? eq(R.propertyId, f.propertyId) : undefined, f.rowId ? eq(R.rowId, f.rowId) : undefined, f.status ? eq(R.status, f.status) : undefined)).orderBy(desc(R.createdAt)).limit(Math.min(500, Math.max(1, f.limit ?? 100)));
  return rows.map(({ outputHash: _h, workspaceId: _w, ...r }) => r);
}

// ---------- queueing
export type SkipReason = "user_edited" | "bad_config" | "already_queued" | "over_budget" | "queue_unavailable";
/** True when the cell holds a value that the AI did not write (differs from the last successful run's output). */
export async function isUserEdited(rowId: string, propertyId: string, value: unknown): Promise<boolean> {
  if (!plain(value)) return false;
  const [last] = await db.select({ h: R.outputHash }).from(R).where(and(eq(R.rowId, rowId), eq(R.propertyId, propertyId), eq(R.status, "done"))).orderBy(desc(R.createdAt)).limit(1);
  return !last?.h || last.h !== outputHash(value);
}
/**
 * Queue one computation (manual click or auto-run). Returns the run id and whether a job was queued; a skipped request leaves the cell
 * exactly as it was and is logged as a `skipped` run with its reason.
 */
export async function queueAiProperty(wsId: string, dbId: string, rowId: string, propertyId: string, opts: { trigger?: "manual" | "auto"; force?: boolean } = {}): Promise<{ runId: string; queued: boolean; skipped: SkipReason | null }> {
  const d = await ensureDatabase(wsId, dbId); const trigger = opts.trigger ?? "manual";
  const [p] = await db.select().from(schema.databaseProperties).where(and(eq(schema.databaseProperties.id, propertyId), eq(schema.databaseProperties.databaseId, d.id)));
  if (!p || p.type !== "ai") throw new HttpError(400, "Not an AI property", "not_ai_property");
  const [row] = await db.select({ id: schema.databaseRows.id, values: schema.databaseRows.values }).from(schema.databaseRows).where(and(eq(schema.databaseRows.id, rowId), eq(schema.databaseRows.databaseId, d.id), isNull(schema.databaseRows.deletedAt)));
  if (!row) throw new HttpError(404, "Row not found");
  const c = aiConfigOf(p as Property); const baseRun = { workspaceId: wsId, databaseId: d.id, propertyId, rowId, trigger, task: c.task, model: c.model };
  const skip = async (reason: SkipReason, msg: string) => { const [r] = await db.insert(R).values({ ...baseRun, status: "skipped", error: msg, finishedAt: new Date() }).returning({ id: R.id }); return { runId: r.id, queued: false, skipped: reason }; };
  const problem = configProblem(c);
  // historical behaviour for a manual click on an unconfigured property: the cell shows the error
  if (problem) { if (trigger === "manual") await db.update(schema.databaseRows).set({ values: dsql`${schema.databaseRows.values} || ${JSON.stringify({ [propertyId]: { error: problem } })}::jsonb` }).where(eq(schema.databaseRows.id, rowId)); return skip("bad_config", problem); }
  if (!c.managed && !opts.force && (await isUserEdited(rowId, propertyId, row.values[propertyId]))) return skip("user_edited", "The cell holds a value edited by hand and the property is not AI-managed: not overwritten.");
  if (trigger === "auto" && (await budgetStatus()).over) return skip("over_budget", "Daily AI budget reached: automatic runs are paused.");
  if (isPending(row.values[propertyId]) && Date.now() - new Date((row.values[propertyId] as { at: string }).at).getTime() < 300_000) return skip("already_queued", "A computation of this cell is already queued.");
  const [run] = await db.insert(R).values({ ...baseRun, status: "queued" }).returning({ id: R.id });
  const before = row.values[propertyId] ?? null;
  await db.update(schema.databaseRows).set({ values: dsql`${schema.databaseRows.values} || ${JSON.stringify({ [propertyId]: { pending: true, at: new Date().toISOString() } })}::jsonb` }).where(eq(schema.databaseRows.id, rowId));
  const job = await enqueue(QUEUES.aiProperty, { rowId, propertyId, workspaceId: wsId, runId: run.id }); // de-duplication = the pending marker checked above (a queue-level time slot would also refuse a legitimate "regenerate")
  if (!job) {
    // queue down: give the cell its previous value back and say so in the log
    await db.update(schema.databaseRows).set({ values: before === null ? dsql`${schema.databaseRows.values} - ${propertyId}` : dsql`${schema.databaseRows.values} || ${JSON.stringify({ [propertyId]: before })}::jsonb` }).where(eq(schema.databaseRows.id, rowId));
    await db.update(R).set({ status: "skipped", error: "Not queued: the job queue is unavailable.", finishedAt: new Date() }).where(eq(R.id, run.id));
    return { runId: run.id, queued: false, skipped: "queue_unavailable" };
  }
  return { runId: run.id, queued: true, skipped: null };
}
/**
 * Auto-run hook, called after a row was created or updated through the API: every AI property with `autoRun` is recomputed, unless the
 * change only touched AI cells (which would loop). Failures here never fail the row write.
 */
export async function autoRunForRow(wsId: string, dbId: string, rowId: string, changedKeys: string[]) {
  try {
    const d = await ensureDatabase(wsId, dbId);
    const props = (await db.select().from(schema.databaseProperties).where(eq(schema.databaseProperties.databaseId, d.id))) as Property[];
    const ai = props.filter((p) => p.type === "ai" && aiConfigOf(p).autoRun); if (!ai.length) return [];
    const aiKeys = new Set(props.filter((p) => p.type === "ai").flatMap((p) => [p.id, p.name]));
    if (changedKeys.length && changedKeys.every((k) => aiKeys.has(k))) return [];
    const out = []; for (const p of ai) out.push({ propertyId: p.id, ...(await queueAiProperty(wsId, dbId, rowId, p.id, { trigger: "auto" })) });
    return out;
  } catch (e) { console.error("ai auto-run failed", (e as Error)?.message); return []; }
}
