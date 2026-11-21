/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/lib/research/overview.ts
 * Module           : lib
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

/** Working-paper tracker: every research page with status, counts and last activity. */
import { sql as dsql } from "drizzle-orm";
import { db, schema } from "@/db";
export const PAPER_STATUSES = ["planning", "research", "development", "writing", "submitted", "published"] as const;
export type PaperStatus = (typeof PAPER_STATUSES)[number];
export interface PaperMeta { status?: PaperStatus; venue?: string; deadline?: string; repoUrl?: string; datasets?: string[]; tags?: string[] }
export interface PaperOverview { id: string; title: string; icon: string | null; status: PaperStatus | null; venue: string | null; deadline: string | null; repoUrl: string | null; datasets: string[]; wordCount: number; references: number; experiments: number; experimentsRunning: number; openTasks: number; overdueTasks: number; attachments: number; updatedAt: string; lastActivity: string; createdAt: string }

export async function researchOverview(wsId: string): Promise<PaperOverview[]> {
  const rows = await db.execute(dsql`
    select p.id, p.title, p.icon, p.properties, p.word_count, p.updated_at, p.created_at,
      (select count(*) from "references" r where r.page_id = p.id and r.deleted_at is null) as refs,
      (select max(r.updated_at) from "references" r where r.page_id = p.id and r.deleted_at is null) as refs_at,
      (select count(*) from experiments e where e.page_id = p.id) as exps,
      (select count(*) from experiments e where e.page_id = p.id and e.status = 'running') as exps_running,
      (select max(e.updated_at) from experiments e where e.page_id = p.id) as exps_at,
      (select count(*) from tasks t where t.page_id = p.id and t.deleted_at is null and t.status <> 'done') as open_tasks,
      (select count(*) from tasks t where t.page_id = p.id and t.deleted_at is null and t.status <> 'done' and t.due_at < now()) as overdue,
      (select max(t.updated_at) from tasks t where t.page_id = p.id and t.deleted_at is null) as tasks_at,
      (select count(*) from attachments a where a.page_id = p.id and a.deleted_at is null) as files
    from pages p where p.workspace_id = ${wsId} and p.type = 'research' and p.deleted_at is null and p.database_id is null
    order by p.updated_at desc`);
  return (rows as any[]).map((r) => {
    const props = (r.properties ?? {}) as PaperMeta; const last = [r.updated_at, r.refs_at, r.exps_at, r.tasks_at].filter(Boolean).map((d) => new Date(d).getTime());
    return { id: r.id, title: r.title, icon: r.icon, status: PAPER_STATUSES.includes(props.status as any) ? (props.status as PaperStatus) : null, venue: props.venue ?? null, deadline: props.deadline ?? null, repoUrl: props.repoUrl ?? null, datasets: Array.isArray(props.datasets) ? props.datasets : [], wordCount: Number(r.word_count), references: Number(r.refs), experiments: Number(r.exps), experimentsRunning: Number(r.exps_running), openTasks: Number(r.open_tasks), overdueTasks: Number(r.overdue), attachments: Number(r.files), updatedAt: new Date(r.updated_at).toISOString(), lastActivity: new Date(Math.max(...last)).toISOString(), createdAt: new Date(r.created_at).toISOString() };
  });
}
