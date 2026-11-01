import { and, desc, eq, gte, isNull, ne, sql as dsql } from "drizzle-orm";
import { handler, HttpError } from "@/lib/api";
import { db, schema } from "@/db";
import { route } from "@/lib/ai/router";
import { callAI } from "@/lib/ai/providers";
import { INJECTION_GUARD } from "@/lib/ai/prompts";
import { recordUsage } from "@/lib/ai/usage";
import { audit } from "@/lib/audit";

const SYSTEM = `You write the weekly digest for the owner of a private knowledge workspace (a professor of real-estate finance and AI researcher). Using only the workspace data provided, write a concise, useful summary of the past 7 days in Markdown: 1) what was worked on (group by theme, mention page titles in **bold**), 2) notable progress or decisions, 3) open tasks and what deserves attention next week. Be specific and dense; 120–220 words; no preamble, no headings larger than ###. Answer in the dominant language of the content (French or English).
${INJECTION_GUARD}`;

export const GET = handler(async () => { const [row] = await db.select().from(schema.settings).where(eq(schema.settings.key, "dashboard.summary")); return Response.json(row?.value ?? null); });

/** POST → summarize the week (pages edited in the last 7 days + open tasks), store under settings `dashboard.summary`. */
export const POST = handler(async ({ ws, user }) => {
  const since = new Date(Date.now() - 7 * 864e5);
  const pages = await db.select({ id: schema.pages.id, title: schema.pages.title, section: schema.pages.section, type: schema.pages.type, plainText: schema.pages.plainText, updatedAt: schema.pages.updatedAt })
    .from(schema.pages).where(and(eq(schema.pages.workspaceId, ws.id), isNull(schema.pages.deletedAt), gte(schema.pages.updatedAt, since))).orderBy(desc(schema.pages.updatedAt)).limit(40);
  const tasks = await db.select({ title: schema.tasks.title, dueAt: schema.tasks.dueAt, priority: schema.tasks.priority, project: schema.tasks.project })
    .from(schema.tasks).where(and(eq(schema.tasks.workspaceId, ws.id), isNull(schema.tasks.deletedAt), ne(schema.tasks.status, "done"))).orderBy(dsql`due_at asc nulls last`).limit(40);
  if (!pages.length && !tasks.length) throw new HttpError(400, "Nothing was edited in the last 7 days and there are no open tasks.");
  const esc = (s: string) => s.replace(/</g, "‹").replace(/>/g, "›");
  const block = [
    `<workspace kind="pages-edited-last-7-days" count="${pages.length}">`,
    ...pages.map((p) => `## ${esc(p.title)} (${p.section}/${p.type}, edited ${p.updatedAt.toISOString().slice(0, 10)})\n${esc(p.plainText.slice(0, 400).replace(/\s+/g, " "))}`),
    `</workspace>`,
    `<workspace kind="open-tasks" count="${tasks.length}">`,
    ...tasks.map((t) => `- ${esc(t.title)}${t.dueAt ? ` (due ${t.dueAt.toISOString().slice(0, 10)})` : ""}${t.priority && t.priority !== "medium" ? ` [${t.priority}]` : ""}${t.project ? ` #${esc(t.project)}` : ""}`),
    `</workspace>`,
  ].join("\n");
  const dec = await route({ task: "chat", estTokens: Math.ceil(block.length / 3.5) + 2000 });
  const t0 = Date.now();
  try {
    const res = await callAI({ model: dec.model.id, provider: dec.provider, system: SYSTEM, effort: dec.effort, maxTokens: 1200, messages: [{ role: "user", content: `${block}\n\nWrite my weekly summary.` }] });
    await recordUsage({ workspaceId: ws.id, provider: dec.provider, model: dec.model.id, task: "chat", usage: res.usage, costUsd: res.costUsd, latencyMs: res.totalMs, ttftMs: res.ttftMs, ok: true });
    const value = { text: res.text.trim(), model: res.model, provider: res.provider, costUsd: res.costUsd, latencyMs: Math.round(res.totalMs), at: new Date().toISOString(), pages: pages.length, tasks: tasks.length, reason: dec.reason };
    await db.insert(schema.settings).values({ key: "dashboard.summary", value }).onConflictDoUpdate({ target: schema.settings.key, set: { value, updatedAt: new Date() } });
    await audit(user.id, "dashboard.summary", undefined, { model: res.model, costUsd: res.costUsd, pages: pages.length });
    return Response.json(value);
  } catch (e: any) {
    await recordUsage({ workspaceId: ws.id, provider: dec.provider, model: dec.model.id, task: "chat", ok: false, error: String(e?.message ?? e), latencyMs: Date.now() - t0 });
    throw new HttpError(502, `AI call failed: ${e?.message ?? e}`);
  }
});
