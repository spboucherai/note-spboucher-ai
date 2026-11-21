/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/lib/events/service.ts
 * Description      : the events journal (`knowledge_events`, SPEC §3.2). Every
 *                    event is written by the service that performs the
 *                    mutation, through the same executor (the transaction when
 *                    there is one), so a rolled-back mutation leaves no event.
 *                    Only real events are recorded; `page.edited` (and
 *                    `canvas.edited`) are coalesced to at most one per page per
 *                    10 minutes.
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

import { and, desc, eq, gte, inArray, lt, lte, or, sql as dsql, type SQL } from "drizzle-orm";
import { db, schema } from "@/db";
import { HttpError } from "@/lib/errors";
import { currentActor, type Actor } from "./context";

export const EVENT_KINDS = [
  "page.created", "page.renamed", "page.edited", "page.moved", "page.archived", "page.unarchived", "page.trashed", "page.restored", "page.purged", "page.version",
  "tag.added", "tag.removed", "link.added", "link.removed", "relation.created", "relation.accepted", "relation.rejected", "relation.removed",
  "reference.added", "reference.linked", "attachment.added", "task.created", "task.completed", "task.reopened", "capture.created", "capture.filed",
  "ai.applied", "agent.applied", "decision.recorded", "canvas.edited",
] as const;
export type EventKind = (typeof EVENT_KINDS)[number];
export const COALESCE_MS = 10 * 60_000;
/** Anything that can run a statement: the pool or an open transaction. */
export type Executor = Pick<typeof db, "insert" | "select" | "update" | "delete" | "execute">;
export interface EventInput { workspaceId: string; kind: EventKind; pageId?: string | null; entityKind?: string | null; entityId?: string | null; summary?: string; data?: Record<string, unknown>; actor?: Actor; device?: string | null; at?: Date }
const E = schema.knowledgeEvents;

const rowOf = (e: EventInput) => { const c = currentActor(); return { workspaceId: e.workspaceId, kind: e.kind, pageId: e.pageId ?? null, entityKind: e.entityKind ?? (e.pageId ? "page" : null), entityId: e.entityId ?? e.pageId ?? null, actor: e.actor ?? c.actor, device: e.device ?? c.device ?? null, summary: (e.summary ?? "").slice(0, 300), data: e.data ?? {}, ...(e.at ? { at: e.at } : {}) }; };
/** Append one event. Pass the transaction of the mutation as `ex` whenever there is one. */
export async function recordEvent(ex: Executor, e: EventInput): Promise<void> { await ex.insert(E).values(rowOf(e)); }
export async function recordEvents(ex: Executor, list: EventInput[]): Promise<void> { if (list.length) await ex.insert(E).values(list.map(rowOf)); }
/**
 * Coalesced event (page.edited, canvas.edited): at most one per (kind, page) per 10 minutes. The check and the insert are serialised per
 * page by a transaction-level advisory lock, so two simultaneous saves cannot both pass the check. Returns true when a row was written.
 */
export async function recordCoalesced(e: EventInput & { pageId: string }): Promise<boolean> {
  return db.transaction(async (tx) => {
    await tx.execute(dsql`select pg_advisory_xact_lock(778202, hashtext(${e.kind + ":" + e.pageId}))`);
    const [recent] = await tx.select({ id: E.id }).from(E).where(and(eq(E.pageId, e.pageId), eq(E.kind, e.kind), gte(E.at, new Date(Date.now() - COALESCE_MS)))).limit(1);
    if (recent) return false;
    await tx.insert(E).values(rowOf(e)); return true;
  });
}

export interface EventOut { id: string; at: string; kind: string; pageId: string | null; pageTitle: string | null; pageIcon: string | null; entityKind: string | null; entityId: string | null; actor: string; device: string | null; summary: string; data: Record<string, unknown> }
export interface EventQuery { pageId?: string | null; pageIds?: string[] | null; from?: Date | null; to?: Date | null; kinds?: string[] | null; cursor?: string | null; limit?: number }
const encodeCursor = (at: Date, id: string) => Buffer.from(`${at.toISOString()}|${id}`).toString("base64url");
function decodeCursor(c: string): { at: Date; id: string } {
  const [iso, id] = Buffer.from(c, "base64url").toString("utf8").split("|"); const at = new Date(iso);
  if (!id || isNaN(at.getTime()) || !/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(400, "Invalid cursor", "bad_cursor");
  return { at, id };
}
/** Newest first; `cursor` is opaque and stable (keyset on (at, id)), so new events never shift a page being read. */
export async function listEvents(wsId: string, q: EventQuery = {}): Promise<{ events: EventOut[]; nextCursor: string | null }> {
  const limit = Math.min(200, Math.max(1, q.limit ?? 50)); const where: (SQL | undefined)[] = [eq(E.workspaceId, wsId)];
  if (q.pageId) where.push(eq(E.pageId, q.pageId));
  if (q.pageIds) where.push(q.pageIds.length ? inArray(E.pageId, q.pageIds) : dsql`false`);
  if (q.from) where.push(gte(E.at, q.from)); if (q.to) where.push(lte(E.at, q.to));
  if (q.kinds?.length) where.push(inArray(E.kind, q.kinds));
  // keyset on (at truncated to the millisecond, id): JavaScript dates carry milliseconds, PostgreSQL microseconds
  const atMs = dsql`date_trunc('milliseconds', ${E.at})`;
  if (q.cursor) { const c = decodeCursor(q.cursor); const iso = c.at.toISOString(); where.push(or(dsql`${atMs} < ${iso}::timestamptz`, and(dsql`${atMs} = ${iso}::timestamptz`, lt(E.id, c.id)))); }
  const rows = await db.select({ id: E.id, at: E.at, kind: E.kind, pageId: E.pageId, pageTitle: schema.pages.title, pageIcon: schema.pages.icon, entityKind: E.entityKind, entityId: E.entityId, actor: E.actor, device: E.device, summary: E.summary, data: E.data })
    .from(E).leftJoin(schema.pages, eq(schema.pages.id, E.pageId)).where(and(...where)).orderBy(dsql`${atMs} desc`, desc(E.id)).limit(limit + 1);
  const page = rows.slice(0, limit); const last = page[page.length - 1];
  return { events: page.map((r) => ({ ...r, at: r.at.toISOString() })), nextCursor: rows.length > limit && last ? encodeCursor(last.at, last.id) : null };
}
