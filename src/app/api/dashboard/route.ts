/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/app/api/dashboard/route.ts
 * Module           : app
 * Repository       : https://git.spboucher.ai/note-spboucher-ai
 * Project Website  : https://note.spboucher.ai
 * Created          : 2026-11-01
 * Last Modified    : 2026-11-01
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

import { z } from "zod";
import { and, desc, eq, gte, inArray, isNull, lte, ne, or, sql as dsql } from "drizzle-orm";
import { handler, parseBody } from "@/lib/api";
import { db, schema } from "@/db";
import { audit } from "@/lib/audit";
import { WIDGET_TYPES, DEFAULT_WIDGETS, type Widget } from "@/components/dashboard/types";

const widgetSchema = z.object({ id: z.string().min(1).max(64), type: z.enum(WIDGET_TYPES), size: z.enum(["half", "wide", "third"]), config: z.record(z.string(), z.unknown()).optional() });

const PROJECT_STATUSES = ["planning", "research", "development", "writing", "active", "in_progress"];
const pageCols = { id: schema.pages.id, title: schema.pages.title, icon: schema.pages.icon, section: schema.pages.section, type: schema.pages.type, updatedAt: schema.pages.updatedAt, lastOpenedAt: schema.pages.lastOpenedAt, wordCount: schema.pages.wordCount, pinned: schema.pages.pinned, properties: schema.pages.properties };

async function getLayout(userId: string): Promise<{ widgets: Widget[]; custom: boolean }> {
  const [row] = await db.select().from(schema.dashboardLayouts).where(and(eq(schema.dashboardLayouts.userId, userId), eq(schema.dashboardLayouts.isDefault, true))).limit(1);
  const parsed = row ? z.array(widgetSchema).safeParse(row.widgets) : null;
  if (parsed?.success && parsed.data.length) return { widgets: parsed.data, custom: true };
  return { widgets: DEFAULT_WIDGETS, custom: false };
}

/** GET → everything the home widgets need in one round trip. */
export const GET = handler(async ({ ws, user }) => {
  const now = new Date(); const in7 = new Date(now.getTime() + 7 * 864e5); const since7 = new Date(now.getTime() - 7 * 864e5);
  const dayStart = new Date(now); dayStart.setHours(0, 0, 0, 0);
  const live = [eq(schema.pages.workspaceId, ws.id), isNull(schema.pages.deletedAt), isNull(schema.pages.databaseId)];
  const [layout, recent, pinned, modified, tasks, projects, researchPages, experiments, [refCount], [expCount], [resCount], suggested, usageToday, [budgetRow], [summaryRow]] = await Promise.all([
    getLayout(user.id),
    db.select(pageCols).from(schema.pages).where(and(...live)).orderBy(dsql`greatest(coalesce(last_opened_at, 'epoch'), updated_at) desc`).limit(8),
    db.select(pageCols).from(schema.pages).where(and(...live, eq(schema.pages.pinned, true))).orderBy(desc(schema.pages.updatedAt)).limit(8),
    db.select(pageCols).from(schema.pages).where(and(...live)).orderBy(desc(schema.pages.updatedAt)).limit(8),
    db.select({ id: schema.tasks.id, title: schema.tasks.title, status: schema.tasks.status, priority: schema.tasks.priority, dueAt: schema.tasks.dueAt, project: schema.tasks.project, pageId: schema.tasks.pageId })
      .from(schema.tasks).where(and(eq(schema.tasks.workspaceId, ws.id), isNull(schema.tasks.deletedAt), ne(schema.tasks.status, "done"), lte(schema.tasks.dueAt, in7))).orderBy(schema.tasks.dueAt).limit(30),
    db.select(pageCols).from(schema.pages).where(and(...live, or(eq(schema.pages.section, "projects"), and(eq(schema.pages.type, "research"), dsql`${schema.pages.properties}->>'status' in (${dsql.join(PROJECT_STATUSES.map((s) => dsql`${s}`), dsql`, `)})`)))).orderBy(desc(schema.pages.updatedAt)).limit(8),
    db.select(pageCols).from(schema.pages).where(and(...live, or(eq(schema.pages.type, "research"), eq(schema.pages.section, "research")))).orderBy(desc(schema.pages.updatedAt)).limit(5),
    db.select({ id: schema.experiments.id, name: schema.experiments.name, status: schema.experiments.status, pageId: schema.experiments.pageId, updatedAt: schema.experiments.updatedAt }).from(schema.experiments).where(eq(schema.experiments.workspaceId, ws.id)).orderBy(desc(schema.experiments.updatedAt)).limit(5),
    db.select({ n: dsql<number>`count(*)` }).from(schema.researchReferences).where(and(eq(schema.researchReferences.workspaceId, ws.id), isNull(schema.researchReferences.deletedAt))),
    db.select({ n: dsql<number>`count(*)` }).from(schema.experiments).where(eq(schema.experiments.workspaceId, ws.id)),
    db.select({ n: dsql<number>`count(*)` }).from(schema.pages).where(and(...live, eq(schema.pages.type, "research"))),
    db.select({ n: dsql<number>`count(*)` }).from(schema.knowledgeEdges).where(and(eq(schema.knowledgeEdges.workspaceId, ws.id), eq(schema.knowledgeEdges.status, "suggested"))),
    db.select({ calls: dsql<number>`count(*)`, costUsd: dsql<number>`coalesce(sum(cost_usd),0)`, errors: dsql<number>`count(*) filter (where not ok)` }).from(schema.aiUsage).where(gte(schema.aiUsage.createdAt, dayStart)),
    db.select().from(schema.settings).where(eq(schema.settings.key, "ai.daily_budget_usd")),
    db.select().from(schema.settings).where(eq(schema.settings.key, "dashboard.summary")),
  ]);
  // graph: top-degree pages among accepted edges
  const degree = await db.execute<{ id: string; degree: number }>(dsql`select id, count(*)::int as degree from (select from_id as id from knowledge_edges where workspace_id = ${ws.id} and status = 'accepted' union all select to_id from knowledge_edges where workspace_id = ${ws.id} and status = 'accepted') d group by id order by degree desc limit 6`);
  const degRows = Array.from(degree as Iterable<{ id: string; degree: number }>);
  const topPages = degRows.length ? await db.select({ id: schema.pages.id, title: schema.pages.title, icon: schema.pages.icon, section: schema.pages.section }).from(schema.pages).where(and(inArray(schema.pages.id, degRows.map((d) => d.id)), isNull(schema.pages.deletedAt))) : [];
  const top = degRows.map((d) => { const p = topPages.find((x) => x.id === d.id); return p ? { ...p, degree: Number(d.degree) } : null; }).filter(Boolean);
  const [edgeCount] = await db.select({ n: dsql<number>`count(*)` }).from(schema.knowledgeEdges).where(and(eq(schema.knowledgeEdges.workspaceId, ws.id), eq(schema.knowledgeEdges.status, "accepted")));
  const editedThisWeek = await db.select({ n: dsql<number>`count(*)` }).from(schema.pages).where(and(...live, gte(schema.pages.updatedAt, since7)));
  const taskPageIds = tasks.map((t) => t.pageId).filter((x): x is string => Boolean(x));
  const taskPages = taskPageIds.length ? await db.select({ id: schema.pages.id, title: schema.pages.title }).from(schema.pages).where(inArray(schema.pages.id, taskPageIds)) : [];
  return Response.json({
    layout, user: { displayName: user.displayName, username: user.username, preferences: user.preferences },
    recent, pinned, modified, projects, tasks: tasks.map((t) => ({ ...t, pageTitle: taskPages.find((p) => p.id === t.pageId)?.title ?? null })),
    research: { pages: researchPages, experiments, counts: { references: Number(refCount.n), experiments: Number(expCount.n), researchPages: Number(resCount.n) } },
    graph: { top, suggested: Number(suggested[0]?.n ?? 0), edges: Number(edgeCount.n) },
    usage: { today: { calls: Number(usageToday[0]?.calls ?? 0), costUsd: Number(usageToday[0]?.costUsd ?? 0), errors: Number(usageToday[0]?.errors ?? 0) }, budgetUsd: Number((budgetRow?.value as any) ?? 20) },
    summary: summaryRow?.value ?? null, stats: { editedThisWeek: Number(editedThisWeek[0]?.n ?? 0) },
  });
});

/** PUT { widgets } → save layout; PUT { reset: true } → back to defaults. */
export const PUT = handler(async ({ req, user }) => {
  const b = await parseBody(req, z.object({ widgets: z.array(widgetSchema).max(40).optional(), reset: z.boolean().optional() }));
  if (b.reset) { await db.delete(schema.dashboardLayouts).where(eq(schema.dashboardLayouts.userId, user.id)); await audit(user.id, "dashboard.reset"); return Response.json({ widgets: DEFAULT_WIDGETS, custom: false }); }
  if (!b.widgets) return Response.json({ error: "widgets required" }, { status: 400 });
  const [existing] = await db.select({ id: schema.dashboardLayouts.id }).from(schema.dashboardLayouts).where(and(eq(schema.dashboardLayouts.userId, user.id), eq(schema.dashboardLayouts.isDefault, true))).limit(1);
  if (existing) await db.update(schema.dashboardLayouts).set({ widgets: b.widgets, updatedAt: new Date() }).where(eq(schema.dashboardLayouts.id, existing.id));
  else await db.insert(schema.dashboardLayouts).values({ userId: user.id, name: "Home", widgets: b.widgets, isDefault: true });
  await audit(user.id, "dashboard.layout", undefined, { widgets: b.widgets.length });
  return Response.json({ widgets: b.widgets, custom: true });
});
