import { and, asc, desc, eq, gt, inArray, isNull, sql as dsql, ne } from "drizzle-orm";
import { db, schema } from "@/db";
import { docText, wordCount, extractPageRefs, emptyDoc, type PMNode } from "@/lib/editor/text";
import { enqueue, QUEUES } from "@/lib/jobs";
import { HttpError } from "@/lib/auth/guard";
/** Postgres array literal for parameterised any()/all() */
const pgArr = (a: string[]) => `{${a.map((x) => `"${x.replace(/"/g, "")}"`).join(",")}}`;

export type Page = typeof schema.pages.$inferSelect;
export const pageSummary = { id: schema.pages.id, parentId: schema.pages.parentId, databaseId: schema.pages.databaseId, type: schema.pages.type, section: schema.pages.section, title: schema.pages.title, icon: schema.pages.icon, cover: schema.pages.cover, position: schema.pages.position, pinned: schema.pages.pinned, archived: schema.pages.archived, inboxAt: schema.pages.inboxAt, wordCount: schema.pages.wordCount, updatedAt: schema.pages.updatedAt, createdAt: schema.pages.createdAt, lastOpenedAt: schema.pages.lastOpenedAt, properties: schema.pages.properties };

export async function getPage(workspaceId: string, id: string, opts: { includeDeleted?: boolean } = {}) {
  const [p] = await db.select().from(schema.pages).where(and(eq(schema.pages.id, id), eq(schema.pages.workspaceId, workspaceId), opts.includeDeleted ? undefined : isNull(schema.pages.deletedAt)));
  if (!p) throw new HttpError(404, "Page not found");
  return p;
}
export async function listTree(workspaceId: string) {
  return db.select(pageSummary).from(schema.pages).where(and(eq(schema.pages.workspaceId, workspaceId), isNull(schema.pages.deletedAt), isNull(schema.pages.databaseId), eq(schema.pages.archived, false))).orderBy(asc(schema.pages.position), asc(schema.pages.createdAt));
}
export async function createPage(workspaceId: string, input: { title?: string; parentId?: string | null; section?: string; type?: string; content?: PMNode; icon?: string | null; properties?: Record<string, unknown>; databaseId?: string | null; inboxAt?: Date | null; captureKind?: string | null }) {
  const [{ max }] = await db.select({ max: dsql<number>`coalesce(max(position),0)` }).from(schema.pages).where(and(eq(schema.pages.workspaceId, workspaceId), input.parentId ? eq(schema.pages.parentId, input.parentId) : isNull(schema.pages.parentId)));
  const content = input.content ?? emptyDoc(); const plain = docText(content);
  const [p] = await db.insert(schema.pages).values({ workspaceId, title: input.title?.trim() || "Untitled", parentId: input.parentId ?? null, section: input.section ?? "notes", type: input.type ?? "page", content, plainText: plain, wordCount: wordCount(plain), icon: input.icon ?? null, properties: input.properties ?? {}, databaseId: input.databaseId ?? null, position: Number(max) + 1, inboxAt: input.inboxAt ?? null, captureKind: input.captureKind ?? null }).returning();
  await afterContentChange(p);
  return p;
}
/** Fields whose change bumps `pages.version` and is protected by optimistic concurrency. */
const VERSIONED = ["title", "content", "properties"] as const;
export type PagePatch = Partial<{ title: string; content: PMNode; icon: string | null; cover: string | null; properties: Record<string, unknown>; parentId: string | null; section: string; position: number; pinned: boolean; archived: boolean; type: string; inboxAt: Date | null }>;
export const conflictPayload = (p: Page) => ({ server: { version: p.version, title: p.title, content: p.content, properties: p.properties, updatedAt: p.updatedAt } });
/**
 * Update a page. When `opts.baseVersion` is given (every interactive save sends it), the write only happens if the row is still at that
 * version: the check and the write are ONE statement, so two sessions can never silently overwrite each other — the loser gets
 * HttpError 409 `conflict` carrying the current server copy, and nothing is written. Callers without a base version (imports, agents after
 * approval, restore) keep "apply on top of whatever is there", but still bump the version so open editors notice.
 */
export async function updatePage(workspaceId: string, id: string, patch: PagePatch, opts: { versionReason?: string; baseVersion?: number } = {}) {
  const prev = await getPage(workspaceId, id);
  if (patch.parentId !== undefined && patch.parentId === id) throw new HttpError(400, "A page cannot be its own parent");
  const versioned = VERSIONED.some((k) => patch[k] !== undefined);
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.title !== undefined) set.title = patch.title.trim() || "Untitled";
  if (patch.content !== undefined) { const plain = docText(patch.content); set.content = patch.content; set.plainText = plain; set.wordCount = wordCount(plain); }
  for (const k of ["icon", "cover", "properties", "parentId", "section", "position", "pinned", "archived", "type", "inboxAt"] as const) if (patch[k] !== undefined) set[k] = patch[k];
  if (versioned) set.version = dsql`${schema.pages.version} + 1`;
  const expect = versioned && opts.baseVersion !== undefined ? opts.baseVersion : null;
  if (expect !== null && prev.version !== expect) throw new HttpError(409, "This note was changed in another session", "conflict", conflictPayload(prev));
  const [p] = await db.update(schema.pages).set(set as any).where(and(eq(schema.pages.id, id), eq(schema.pages.workspaceId, workspaceId), expect !== null ? eq(schema.pages.version, expect) : undefined)).returning();
  if (!p) { const cur = await getPage(workspaceId, id); throw new HttpError(409, "This note was changed in another session", "conflict", conflictPayload(cur)); }
  // Versioning: snapshot the PREVIOUS state when content/title changed and (every 20 versions, or > 10 min since last snapshot, or explicit reason)
  if (patch.content !== undefined || patch.title !== undefined) {
    const [last] = await db.select({ v: schema.pageVersions.version, at: schema.pageVersions.createdAt }).from(schema.pageVersions).where(and(eq(schema.pageVersions.pageId, id), gt(schema.pageVersions.version, 0))).orderBy(desc(schema.pageVersions.version)).limit(1);
    const due = !last || opts.versionReason || prev.version - last.v >= 20 || Date.now() - last.at.getTime() > 10 * 60_000;
    if (due) { await snapshot(prev, opts.versionReason ?? "autosave"); await pruneVersions(id); }
    await afterContentChange(p);
  }
  return p;
}
/** History entries for copies that were never the live state of the page (discarded side of a conflict, closed-tab leftovers) use negative, time-based numbers so they never collide with real versions. */
export const unappliedVersion = () => -Math.floor(Date.now() / 1000);
/** Keep a copy of a page state in the history (idempotent per version number). */
export async function snapshot(p: Pick<Page, "id" | "version" | "title" | "content" | "properties" | "wordCount">, reason: string, version = p.version) {
  await db.insert(schema.pageVersions).values({ pageId: p.id, version, title: p.title, content: p.content, properties: p.properties, reason: reason.slice(0, 100), wordCount: p.wordCount }).onConflictDoNothing();
}
/**
 * Resolve a save conflict. BOTH copies always survive in the version history, whatever the choice:
 *   mine   → the server copy is snapshotted, then replaced by the local copy;
 *   theirs → the local copy is stored as a (non-applied) history entry, the page keeps the server copy;
 *   both   → the local copy becomes a new sibling page "… (conflict copy)", the page keeps the server copy.
 * `serverVersion` is the version the user was shown; if the page moved again meanwhile, a fresh 409 is returned instead of guessing.
 */
export async function resolveConflict(workspaceId: string, id: string, input: { choice: "mine" | "theirs" | "both"; serverVersion: number; mine: { title?: string; content?: PMNode } }) {
  const cur = await getPage(workspaceId, id);
  if (cur.version !== input.serverVersion) throw new HttpError(409, "The note changed again while you were deciding", "conflict", conflictPayload(cur));
  const mineTitle = input.mine.title?.trim() || cur.title; const mineContent = input.mine.content ?? (cur.content as PMNode); const minePlain = docText(mineContent);
  if (input.choice === "mine") {
    await snapshot(cur, "conflict · other session's copy");
    const p = await updatePage(workspaceId, id, { title: mineTitle, content: mineContent }, { baseVersion: cur.version, versionReason: "conflict · other session's copy" });
    return { page: p, copyId: null as string | null };
  }
  if (input.choice === "theirs") {
    await snapshot({ id, version: unappliedVersion(), title: mineTitle, content: mineContent, properties: cur.properties, wordCount: wordCount(minePlain) }, "conflict · this device's copy (not applied)");
    await pruneVersions(id);
    return { page: cur, copyId: null as string | null };
  }
  const copy = await createPage(workspaceId, { title: `${mineTitle} (conflict copy)`.slice(0, 500), parentId: cur.parentId, section: cur.section, type: cur.type === "page" ? "page" : cur.type, content: mineContent, icon: cur.icon, properties: {} });
  return { page: cur, copyId: copy.id };
}
async function pruneVersions(pageId: string) {
  const old = await db.select({ id: schema.pageVersions.id }).from(schema.pageVersions).where(eq(schema.pageVersions.pageId, pageId)).orderBy(desc(schema.pageVersions.createdAt)).offset(200);
  if (old.length) await db.delete(schema.pageVersions).where(inArray(schema.pageVersions.id, old.map((o) => o.id)));
}
/** Links/backlinks + knowledge edges + async indexing. */
async function afterContentChange(p: Page) {
  const refs = extractPageRefs(p.content as PMNode).filter((r) => r !== p.id);
  await db.delete(schema.links).where(and(eq(schema.links.fromPageId, p.id), eq(schema.links.kind, "link")));
  if (refs.length) {
    const valid = await db.select({ id: schema.pages.id }).from(schema.pages).where(and(inArray(schema.pages.id, refs), eq(schema.pages.workspaceId, p.workspaceId)));
    if (valid.length) {
      await db.insert(schema.links).values(valid.map((v) => ({ fromPageId: p.id, toPageId: v.id, kind: "link" }))).onConflictDoNothing();
      await db.insert(schema.knowledgeEdges).values(valid.map((v) => ({ workspaceId: p.workspaceId, fromId: p.id, toId: v.id, kind: "link", status: "accepted" }))).onConflictDoNothing();
    }
  }
  await db.delete(schema.knowledgeEdges).where(and(eq(schema.knowledgeEdges.fromId, p.id), eq(schema.knowledgeEdges.kind, "link"), refs.length ? dsql`to_id <> all(${pgArr(refs)}::uuid[])` : dsql`true`));
  await enqueue(QUEUES.index, { sourceType: "page", sourceId: p.id, workspaceId: p.workspaceId }, { singletonKey: `page:${p.id}`, singletonSeconds: 20 });
}
export async function softDeletePage(workspaceId: string, id: string) {
  const ids = await descendants(workspaceId, id); ids.push(id);
  await db.update(schema.pages).set({ deletedAt: new Date() }).where(inArray(schema.pages.id, ids));
  await db.delete(schema.chunks).where(and(eq(schema.chunks.sourceType, "page"), inArray(schema.chunks.sourceId, ids)));
  return ids.length;
}
export async function restorePage(workspaceId: string, id: string) {
  const ids = await descendants(workspaceId, id, true); ids.push(id);
  await db.update(schema.pages).set({ deletedAt: null }).where(inArray(schema.pages.id, ids));
  for (const pid of ids) await enqueue(QUEUES.index, { sourceType: "page", sourceId: pid, workspaceId });
}
export async function purgePage(workspaceId: string, id: string) { await db.delete(schema.pages).where(and(eq(schema.pages.id, id), eq(schema.pages.workspaceId, workspaceId))); }
export async function descendants(workspaceId: string, id: string, includeDeleted = false): Promise<string[]> {
  const rows = await db.execute(dsql`with recursive t as (select id from pages where parent_id = ${id} and workspace_id = ${workspaceId} ${includeDeleted ? dsql`` : dsql`and deleted_at is null`} union all select p.id from pages p join t on p.parent_id = t.id ${includeDeleted ? dsql`` : dsql`where p.deleted_at is null`}) select id from t`);
  return (rows as any[]).map((r) => r.id);
}
export async function backlinks(workspaceId: string, id: string) {
  return db.select({ id: schema.pages.id, title: schema.pages.title, icon: schema.pages.icon, section: schema.pages.section, updatedAt: schema.pages.updatedAt }).from(schema.links).innerJoin(schema.pages, eq(schema.pages.id, schema.links.fromPageId)).where(and(eq(schema.links.toPageId, id), eq(schema.pages.workspaceId, workspaceId), isNull(schema.pages.deletedAt), ne(schema.pages.id, id)));
}
export async function breadcrumb(workspaceId: string, id: string) {
  const rows = await db.execute(dsql`with recursive t as (select id, parent_id, title, icon, 0 as d from pages where id = ${id} and workspace_id = ${workspaceId} union all select p.id, p.parent_id, p.title, p.icon, t.d + 1 from pages p join t on p.id = t.parent_id where t.d < 20) select id, title, icon from t order by d desc`);
  return rows as unknown as { id: string; title: string; icon: string | null }[];
}
export async function touchOpened(id: string) { await db.update(schema.pages).set({ lastOpenedAt: new Date() }).where(eq(schema.pages.id, id)); }
export async function duplicatePage(workspaceId: string, id: string) {
  const p = await getPage(workspaceId, id);
  return createPage(workspaceId, { title: `${p.title} (copy)`, parentId: p.parentId, section: p.section, type: p.type, content: p.content as PMNode, icon: p.icon, properties: p.properties as any });
}
