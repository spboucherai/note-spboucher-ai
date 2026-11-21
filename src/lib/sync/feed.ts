/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/lib/sync/feed.ts
 * Description      : the change feed served by GET /api/sync (2.x contract +
 *                    the 3.0 entity kinds). Kept out of the route file so it
 *                    can be tested without an HTTP session.
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

import { and, asc, eq, gt, inArray, lte, sql as dsql } from "drizzle-orm";
import { HttpError } from "@/lib/errors";
import { db, schema } from "@/db";
import { listTags } from "@/lib/inbox/service";
import { ENTITY_KINDS, entityHead, entityWindow, isEntityKind, type EntityKind } from "@/lib/sync/entities";

export async function syncFeed(ws: { id: string; name: string }, user: { displayName: string }, params: URLSearchParams): Promise<Record<string, unknown>> {
  const u = { searchParams: params }; const since = Number(u.searchParams.get("since") ?? 0);
  if (!Number.isSafeInteger(since) || since < 0) throw new HttpError(400, "since must be a non-negative integer", "bad_cursor");
  const limit = Math.min(500, Math.max(1, Number(u.searchParams.get("limit") ?? 200) || 200));
  const raw = u.searchParams.get("kinds"); let kinds: EntityKind[] = [];
  if (raw !== null && raw.trim() !== "") {
    const asked = [...new Set(raw.split(",").map((k) => k.trim()).filter(Boolean))];
    if (asked.length === 1 && asked[0] === "all") kinds = [...ENTITY_KINDS];
    else { const bad = asked.filter((k) => !isEntityKind(k)); if (bad.length) throw new HttpError(400, `Unknown kind: ${bad.join(", ")}`, "bad_kinds", { kinds: [...ENTITY_KINDS] }); kinds = ENTITY_KINDS.filter((k) => asked.includes(k)); }
  }
  const tombKinds = ["page", "attachment", ...kinds];
  const [h] = (await db.execute(dsql`select greatest((select coalesce(max(rev), 0) from pages where workspace_id = ${ws.id}), (select coalesce(max(rev), 0) from attachments where workspace_id = ${ws.id}), (select coalesce(max(rev), 0) from sync_tombstones where workspace_id = ${ws.id} and kind in (${dsql.join(tombKinds.map((k) => dsql`${k}`), dsql`, `)})))::bigint as head`)) as unknown as { head: string }[];
  const head = Math.max(Number(h.head), await entityHead(ws.id, kinds));
  const withEntities = <T extends object>(body: T, lists: Record<string, unknown[]>): T => (kinds.length ? { ...body, entities: Object.fromEntries(kinds.map((k) => [k, lists[k] ?? []])) } : body);
  // A cursor ahead of the server means the database was restored from an older backup: the client must start again from zero.
  if (since > head) return (withEntities({ reset: true, cursor: 0, head, more: true, pages: [], attachments: [], tombstones: [], tags: [], workspace: { id: ws.id, name: ws.name }, serverTime: new Date().toISOString() }, {}));
  const P = schema.pages; const A = schema.attachments; const T = schema.syncTombstones;
  const window = (rev: typeof P.rev | typeof A.rev | typeof T.rev) => and(gt(rev, since), lte(rev, head));
  let pages = await db.select({ id: P.id, parentId: P.parentId, databaseId: P.databaseId, type: P.type, section: P.section, title: P.title, icon: P.icon, cover: P.cover, content: P.content, properties: P.properties, position: P.position, pinned: P.pinned, archived: P.archived, version: P.version, wordCount: P.wordCount, createdAt: P.createdAt, updatedAt: P.updatedAt, lastOpenedAt: P.lastOpenedAt, deletedAt: P.deletedAt, inboxAt: P.inboxAt, captureKind: P.captureKind, rev: P.rev })
    .from(P).where(and(eq(P.workspaceId, ws.id), window(P.rev))).orderBy(asc(P.rev)).limit(limit);
  let attachments = await db.select({ id: A.id, pageId: A.pageId, filename: A.filename, mime: A.mime, size: A.size, sha256: A.sha256, pageCount: A.pageCount, createdAt: A.createdAt, deletedAt: A.deletedAt, rev: A.rev })
    .from(A).where(and(eq(A.workspaceId, ws.id), window(A.rev))).orderBy(asc(A.rev)).limit(limit);
  let tombstones = await db.select({ id: T.id, kind: T.kind, rev: T.rev, deletedAt: T.deletedAt }).from(T).where(and(eq(T.workspaceId, ws.id), inArray(T.kind, tombKinds), window(T.rev))).orderBy(asc(T.rev)).limit(limit);
  const entities: Record<string, { rev: number }[]> = {}; for (const k of kinds) entities[k] = await entityWindow(ws.id, k, since, head, limit);
  // When a list was cut, the cursor stops at the lowest cut point and the other lists are trimmed to it: nothing is skipped.
  const cuts = [pages, attachments, tombstones, ...Object.values(entities)].filter((l) => l.length === limit).map((l) => l[l.length - 1].rev);
  const more = cuts.length > 0; const cursor = more ? Math.min(...cuts) : head;
  if (more) { pages = pages.filter((x) => x.rev <= cursor); attachments = attachments.filter((x) => x.rev <= cursor); tombstones = tombstones.filter((x) => x.rev <= cursor); for (const k of kinds) entities[k] = entities[k].filter((x) => x.rev <= cursor); }
  const tagRows = pages.length ? await db.select({ pageId: schema.pageTags.pageId, name: schema.tags.name }).from(schema.pageTags).innerJoin(schema.tags, eq(schema.tags.id, schema.pageTags.tagId)).where(inArray(schema.pageTags.pageId, pages.map((p) => p.id))) : [];
  const byPage = new Map<string, string[]>(); for (const t of tagRows) byPage.set(t.pageId, [...(byPage.get(t.pageId) ?? []), t.name]);
  return withEntities({
    cursor, head, more, reset: false, serverTime: new Date().toISOString(), workspace: { id: ws.id, name: ws.name }, user: { displayName: user.displayName },
    pages: pages.map((p) => ({ ...p, tags: (byPage.get(p.id) ?? []).sort() })), attachments, tombstones,
    tags: (await listTags(ws.id)).map((t) => ({ name: t.name, color: t.color })),
  }, entities);
}
