import { and, asc, eq, gt, inArray, lte, sql as dsql } from "drizzle-orm";
import { handler, HttpError } from "@/lib/api";
import { db, schema } from "@/db";
import { listTags } from "@/lib/inbox/service";
export const dynamic = "force-dynamic";
/**
 * GET /api/sync?since=<rev>&limit=<n> — change feed for native clients (SP Notes on macOS / iOS), which keep a full local copy.
 *
 * Returns everything whose revision is greater than `since`, oldest first: whole pages (content included, in every state — live, inbox,
 * archived, in the trash), attachment metadata, and tombstones of permanently deleted rows. `cursor` is the revision to send next time;
 * `more: true` means the answer was cut at `limit` and the client should call again at once. `since=0` is a full copy.
 *
 * Revisions come from one sequence taken under an advisory lock (migration 0002), so they are visible in commit order: every change
 * numbered ≤ `head` is committed when `head` is read, and nothing can later appear below a cursor the client already holds.
 * Read-only; nothing is marked as opened.
 */
export const GET = handler(async ({ req, ws, user }) => {
  const u = new URL(req.url); const since = Number(u.searchParams.get("since") ?? 0);
  if (!Number.isSafeInteger(since) || since < 0) throw new HttpError(400, "since must be a non-negative integer", "bad_cursor");
  const limit = Math.min(500, Math.max(1, Number(u.searchParams.get("limit") ?? 200) || 200));
  const [h] = (await db.execute(dsql`select greatest((select coalesce(max(rev), 0) from pages where workspace_id = ${ws.id}), (select coalesce(max(rev), 0) from attachments where workspace_id = ${ws.id}), (select coalesce(max(rev), 0) from sync_tombstones where workspace_id = ${ws.id}))::bigint as head`)) as unknown as { head: string }[];
  const head = Number(h.head);
  // A cursor ahead of the server means the database was restored from an older backup: the client must start again from zero.
  if (since > head) return Response.json({ reset: true, cursor: 0, head, more: true, pages: [], attachments: [], tombstones: [], tags: [], workspace: { id: ws.id, name: ws.name }, serverTime: new Date().toISOString() });
  const P = schema.pages; const A = schema.attachments; const T = schema.syncTombstones;
  const window = (rev: typeof P.rev | typeof A.rev | typeof T.rev) => and(gt(rev, since), lte(rev, head));
  let pages = await db.select({ id: P.id, parentId: P.parentId, databaseId: P.databaseId, type: P.type, section: P.section, title: P.title, icon: P.icon, cover: P.cover, content: P.content, properties: P.properties, position: P.position, pinned: P.pinned, archived: P.archived, version: P.version, wordCount: P.wordCount, createdAt: P.createdAt, updatedAt: P.updatedAt, lastOpenedAt: P.lastOpenedAt, deletedAt: P.deletedAt, inboxAt: P.inboxAt, captureKind: P.captureKind, rev: P.rev })
    .from(P).where(and(eq(P.workspaceId, ws.id), window(P.rev))).orderBy(asc(P.rev)).limit(limit);
  let attachments = await db.select({ id: A.id, pageId: A.pageId, filename: A.filename, mime: A.mime, size: A.size, sha256: A.sha256, pageCount: A.pageCount, createdAt: A.createdAt, deletedAt: A.deletedAt, rev: A.rev })
    .from(A).where(and(eq(A.workspaceId, ws.id), window(A.rev))).orderBy(asc(A.rev)).limit(limit);
  let tombstones = await db.select({ id: T.id, kind: T.kind, rev: T.rev, deletedAt: T.deletedAt }).from(T).where(and(eq(T.workspaceId, ws.id), window(T.rev))).orderBy(asc(T.rev)).limit(limit);
  // When a list was cut, the cursor stops at the lowest cut point and the other lists are trimmed to it: nothing is skipped.
  const cuts = [pages, attachments, tombstones].filter((l) => l.length === limit).map((l) => l[l.length - 1].rev);
  const more = cuts.length > 0; const cursor = more ? Math.min(...cuts) : head;
  if (more) { pages = pages.filter((x) => x.rev <= cursor); attachments = attachments.filter((x) => x.rev <= cursor); tombstones = tombstones.filter((x) => x.rev <= cursor); }
  const tagRows = pages.length ? await db.select({ pageId: schema.pageTags.pageId, name: schema.tags.name }).from(schema.pageTags).innerJoin(schema.tags, eq(schema.tags.id, schema.pageTags.tagId)).where(inArray(schema.pageTags.pageId, pages.map((p) => p.id))) : [];
  const byPage = new Map<string, string[]>(); for (const t of tagRows) byPage.set(t.pageId, [...(byPage.get(t.pageId) ?? []), t.name]);
  return Response.json({
    cursor, head, more, reset: false, serverTime: new Date().toISOString(), workspace: { id: ws.id, name: ws.name }, user: { displayName: user.displayName },
    pages: pages.map((p) => ({ ...p, tags: (byPage.get(p.id) ?? []).sort() })), attachments, tombstones,
    tags: (await listTags(ws.id)).map((t) => ({ name: t.name, color: t.color })),
  });
});
