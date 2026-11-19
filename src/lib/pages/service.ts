import { and, asc, desc, eq, gt, inArray, isNull, sql as dsql, ne } from "drizzle-orm";
import { db, schema } from "@/db";
import fs from "node:fs/promises";
import { docText, wordCount, extractRefs, docTaskItems, docMarkers, emptyDoc, ensureBlockIds, type PMNode } from "@/lib/editor/text";
import { enqueue, QUEUES } from "@/lib/jobs";
import { HttpError } from "@/lib/errors";
import { sameJson } from "@/lib/same-json";
import { absPath } from "@/lib/files/storage";
import { recordEvent, recordEvents, recordCoalesced, type EventInput, type Executor } from "@/lib/events/service";
import { EMPTY_CANVAS } from "@/lib/canvas/format";
import { parseDue } from "@/lib/tasks/due";
/** Postgres array literal for parameterised any()/all() */
const pgArr = (a: string[]) => `{${a.map((x) => `"${x.replace(/"/g, "")}"`).join(",")}}`;

export type Page = typeof schema.pages.$inferSelect;
/** Client-chosen id (native apps create notes offline): the page already stored under that id, in any state, or null. */
export async function findPageAnyState(workspaceId: string, id: string) {
  const [p] = await db.select().from(schema.pages).where(eq(schema.pages.id, id));
  if (p && p.workspaceId !== workspaceId) throw new HttpError(409, "This id is already in use", "id_taken");
  return p ?? null;
}
export const pageSummary = { id: schema.pages.id, parentId: schema.pages.parentId, databaseId: schema.pages.databaseId, type: schema.pages.type, section: schema.pages.section, title: schema.pages.title, icon: schema.pages.icon, cover: schema.pages.cover, position: schema.pages.position, pinned: schema.pages.pinned, archived: schema.pages.archived, inboxAt: schema.pages.inboxAt, wordCount: schema.pages.wordCount, updatedAt: schema.pages.updatedAt, createdAt: schema.pages.createdAt, lastOpenedAt: schema.pages.lastOpenedAt, properties: schema.pages.properties };

export async function getPage(workspaceId: string, id: string, opts: { includeDeleted?: boolean } = {}) {
  const [p] = await db.select().from(schema.pages).where(and(eq(schema.pages.id, id), eq(schema.pages.workspaceId, workspaceId), opts.includeDeleted ? undefined : isNull(schema.pages.deletedAt)));
  if (!p) throw new HttpError(404, "Page not found");
  return p;
}
export async function listTree(workspaceId: string) {
  return db.select(pageSummary).from(schema.pages).where(and(eq(schema.pages.workspaceId, workspaceId), isNull(schema.pages.deletedAt), isNull(schema.pages.databaseId), eq(schema.pages.archived, false))).orderBy(asc(schema.pages.position), asc(schema.pages.createdAt));
}
export async function createPage(workspaceId: string, input: { id?: string; title?: string; parentId?: string | null; section?: string; type?: string; content?: PMNode; icon?: string | null; properties?: Record<string, unknown>; databaseId?: string | null; inboxAt?: Date | null; captureKind?: string | null }) {
  const [{ max }] = await db.select({ max: dsql<number>`coalesce(max(position),0)` }).from(schema.pages).where(and(eq(schema.pages.workspaceId, workspaceId), input.parentId ? eq(schema.pages.parentId, input.parentId) : isNull(schema.pages.parentId)));
  const content = ensureBlockIds(input.content ?? emptyDoc()).doc; const plain = docText(content);
  // the page, its canvas row (type "canvas") and its journal entry are one transaction
  const p = await db.transaction(async (tx) => {
    const [row] = await tx.insert(schema.pages).values({ ...(input.id ? { id: input.id } : {}), workspaceId, title: input.title?.trim() || "Untitled", parentId: input.parentId ?? null, section: input.section ?? "notes", type: input.type ?? "page", content, plainText: plain, wordCount: wordCount(plain), icon: input.icon ?? null, properties: input.properties ?? {}, databaseId: input.databaseId ?? null, position: Number(max) + 1, inboxAt: input.inboxAt ?? null, captureKind: input.captureKind ?? null }).returning();
    if (row.type === "canvas") await tx.insert(schema.canvases).values({ pageId: row.id, workspaceId, data: EMPTY_CANVAS() }).onConflictDoNothing();
    await recordEvent(tx, { workspaceId, kind: "page.created", pageId: row.id, summary: row.title, data: { section: row.section, type: row.type, ...(row.parentId ? { parentId: row.parentId } : {}), ...(row.databaseId ? { databaseId: row.databaseId } : {}) } });
    return row;
  });
  await afterContentChange(p, null);
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
  if (patch.parentId && patch.parentId !== prev.parentId) await assertParent(workspaceId, id, patch.parentId);
  const versioned = VERSIONED.some((k) => patch[k] !== undefined);
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.title !== undefined) set.title = patch.title.trim() || "Untitled";
  if (patch.content !== undefined) { const withIds = ensureBlockIds(patch.content, prev.content as PMNode).doc; const plain = docText(withIds); set.content = withIds; set.plainText = plain; set.wordCount = wordCount(plain); }
  for (const k of ["icon", "cover", "properties", "parentId", "section", "position", "pinned", "archived", "type", "inboxAt"] as const) if (patch[k] !== undefined) set[k] = patch[k];
  if (versioned) set.version = dsql`${schema.pages.version} + 1`;
  const expect = versioned && opts.baseVersion !== undefined ? opts.baseVersion : null;
  if (expect !== null && prev.version !== expect) throw new HttpError(409, "This note was changed in another session", "conflict", conflictPayload(prev));
  // the write and its journal entries are one transaction: a refused or failed save leaves no event
  const p = await db.transaction(async (tx) => {
    const [row] = await tx.update(schema.pages).set(set as any).where(and(eq(schema.pages.id, id), eq(schema.pages.workspaceId, workspaceId), expect !== null ? eq(schema.pages.version, expect) : undefined)).returning();
    if (row) await recordEvents(tx, pageChangeEvents(prev, row));
    return row;
  });
  if (!p) { const cur = await getPage(workspaceId, id); throw new HttpError(409, "This note was changed in another session", "conflict", conflictPayload(cur)); }
  const contentChanged = patch.content !== undefined && !sameJson(prev.content, p.content);
  if (contentChanged) await recordCoalesced({ workspaceId, kind: "page.edited", pageId: id, summary: p.title, data: { version: p.version, wordCount: p.wordCount } });
  // Versioning: snapshot the PREVIOUS state when content/title changed and (every 20 versions, or > 10 min since last snapshot, or explicit reason)
  if (patch.content !== undefined || patch.title !== undefined) {
    const [last] = await db.select({ v: schema.pageVersions.version, at: schema.pageVersions.createdAt }).from(schema.pageVersions).where(and(eq(schema.pageVersions.pageId, id), gt(schema.pageVersions.version, 0))).orderBy(desc(schema.pageVersions.version)).limit(1);
    const due = !last || opts.versionReason || prev.version - last.v >= 20 || Date.now() - last.at.getTime() > 10 * 60_000;
    if (due) { await snapshot(prev, opts.versionReason ?? "autosave"); await pruneVersions(id); }
    await afterContentChange(p, prev);
  }
  return p;
}
/** Journal entries for what a page update actually changed (compared on the stored rows, so a no-op write records nothing). `page.edited` is separate: it is coalesced. */
function pageChangeEvents(prev: Page, p: Page): EventInput[] {
  const base = { workspaceId: p.workspaceId, pageId: p.id, summary: p.title }; const out: EventInput[] = [];
  if (p.title !== prev.title) out.push({ ...base, kind: "page.renamed", data: { from: prev.title, to: p.title } });
  if (p.parentId !== prev.parentId || p.section !== prev.section) out.push({ ...base, kind: "page.moved", data: { from: { parentId: prev.parentId, section: prev.section }, to: { parentId: p.parentId, section: p.section } } });
  if (p.archived !== prev.archived) out.push({ ...base, kind: p.archived ? "page.archived" : "page.unarchived", data: {} });
  if (prev.inboxAt && !p.inboxAt) out.push({ ...base, kind: "capture.filed", data: { action: "keep", section: p.section } });
  const before = docMarkers(prev.content as PMNode); const after = docMarkers(p.content as PMNode);
  const hadAi = new Set(before.ai.map((x) => x.blockId)); const hadDecision = new Set(before.decisions.map((x) => x.blockId));
  for (const a of after.ai) if (!hadAi.has(a.blockId)) out.push({ ...base, kind: "ai.applied", entityKind: "block", entityId: a.blockId, data: { blockId: a.blockId, model: a.model, action: a.action } });
  for (const d of after.decisions) if (!hadDecision.has(d.blockId)) out.push({ ...base, kind: "decision.recorded", entityKind: "block", entityId: d.blockId, summary: d.text || p.title, data: { blockId: d.blockId } });
  return out;
}
/**
 * A new parent must be a page of the workspace and must not be the page itself or one of its descendants (3.0, defect D-4: A → B then
 * B → A used to be accepted and made the recursive tree queries loop).
 */
async function assertParent(workspaceId: string, id: string, parentId: string) {
  const [parent] = await db.select({ id: schema.pages.id }).from(schema.pages).where(and(eq(schema.pages.id, parentId), eq(schema.pages.workspaceId, workspaceId)));
  if (!parent) throw new HttpError(400, "Unknown parent page", "bad_parent");
  if ((await descendants(workspaceId, id, true)).includes(parentId)) throw new HttpError(409, "A page cannot be moved under one of its own sub-pages", "cycle");
}
/** History entries for copies that were never the live state of the page (discarded side of a conflict, closed-tab leftovers) use negative, time-based numbers so they never collide with real versions. */
export const unappliedVersion = () => -Math.floor(Date.now() / 1000);
/** Keep a copy of a page state in the history (idempotent per version number). */
export async function snapshot(p: Pick<Page, "id" | "version" | "title" | "content" | "properties" | "wordCount">, reason: string, version = p.version) {
  await db.transaction(async (tx) => {
    const [v] = await tx.insert(schema.pageVersions).values({ pageId: p.id, version, title: p.title, content: p.content, properties: p.properties, reason: reason.slice(0, 100), wordCount: p.wordCount }).onConflictDoNothing().returning({ id: schema.pageVersions.id });
    if (!v) return; // this version was already in the history: no second event
    const [w] = await tx.select({ workspaceId: schema.pages.workspaceId }).from(schema.pages).where(eq(schema.pages.id, p.id));
    if (w) await recordEvent(tx, { workspaceId: w.workspaceId, kind: "page.version", pageId: p.id, entityKind: "page_version", entityId: v.id, summary: p.title, data: { version, reason: reason.slice(0, 100), ...(version < 0 ? { unapplied: true } : {}) } });
  });
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
/**
 * After a content/title change: links + backlinks, knowledge edges (page → page `link`, page → reference `cites`), tasks linked to
 * `taskItem.taskId`, journal entries, then async indexing. One transaction (3.0: a reader never sees a page without its links, D-19).
 * `prev` is the page before the write (null on creation).
 */
async function afterContentChange(p: Page, prev: Page | null) {
  const refs = extractRefs(p.content as PMNode); const pageRefs = refs.pages.filter((r) => r.pageId !== p.id);
  const K = schema.knowledgeEdges; const base = { workspaceId: p.workspaceId, pageId: p.id, summary: p.title };
  await db.transaction(async (tx) => {
    const before = (await tx.select({ to: schema.links.toPageId }).from(schema.links).where(and(eq(schema.links.fromPageId, p.id), eq(schema.links.kind, "link")))).map((r) => r.to);
    const valid = pageRefs.length ? await tx.select({ id: schema.pages.id, title: schema.pages.title }).from(schema.pages).where(and(inArray(schema.pages.id, pageRefs.map((r) => r.pageId)), eq(schema.pages.workspaceId, p.workspaceId))) : [];
    const validIds = new Set(valid.map((v) => v.id)); const titleOf = new Map(valid.map((v) => [v.id, v.title]));
    await tx.delete(schema.links).where(and(eq(schema.links.fromPageId, p.id), eq(schema.links.kind, "link")));
    const kept = pageRefs.filter((r) => validIds.has(r.pageId));
    if (kept.length) {
      await tx.insert(schema.links).values(kept.map((r) => ({ fromPageId: p.id, toPageId: r.pageId, kind: "link" }))).onConflictDoNothing();
      await tx.insert(K).values(kept.map((r) => ({ workspaceId: p.workspaceId, fromId: p.id, toId: r.pageId, kind: "link", status: "accepted", relType: "related", origin: "system", sourceBlockId: r.sourceBlockId, targetBlockId: r.targetBlockId }))).onConflictDoNothing();
    }
    await tx.delete(K).where(and(eq(K.fromId, p.id), eq(K.kind, "link"), kept.length ? dsql`to_id <> all(${pgArr(kept.map((r) => r.pageId))}::uuid[])` : dsql`true`));
    const was = new Set(before); const now = new Set(kept.map((r) => r.pageId)); const events: EventInput[] = [];
    for (const r of kept) if (!was.has(r.pageId)) events.push({ ...base, kind: "link.added", entityKind: "page", entityId: r.pageId, data: { toId: r.pageId, toTitle: titleOf.get(r.pageId) ?? null, sourceBlockId: r.sourceBlockId, targetBlockId: r.targetBlockId } });
    for (const to of before) if (!now.has(to)) events.push({ ...base, kind: "link.removed", entityKind: "page", entityId: to, data: { toId: to } });
    // citations: one `cites` edge per reference of the workspace cited in the document
    const citedBefore = (await tx.select({ to: K.toId }).from(K).where(and(eq(K.fromId, p.id), eq(K.kind, "cites"), eq(K.origin, "system")))).map((r) => r.to);
    const R = schema.researchReferences;
    const known = refs.references.length ? await tx.select({ id: R.id, title: R.title, citeKey: R.citeKey }).from(R).where(and(inArray(R.id, refs.references.map((r) => r.refId)), eq(R.workspaceId, p.workspaceId))) : [];
    const knownIds = new Map(known.map((k) => [k.id, k])); const cited = refs.references.filter((r) => knownIds.has(r.refId));
    if (cited.length) await tx.insert(K).values(cited.map((r) => ({ workspaceId: p.workspaceId, fromId: p.id, toId: r.refId, fromType: "page", toType: "reference", sourceKind: "page", targetKind: "reference", kind: "cites", relType: "cites", origin: "system", status: "accepted", sourceBlockId: r.sourceBlockId }))).onConflictDoNothing();
    await tx.delete(K).where(and(eq(K.fromId, p.id), eq(K.kind, "cites"), eq(K.origin, "system"), cited.length ? dsql`to_id <> all(${pgArr(cited.map((r) => r.refId))}::uuid[])` : dsql`true`));
    const citedWas = new Set(citedBefore);
    for (const r of cited) if (!citedWas.has(r.refId)) events.push({ ...base, kind: "reference.linked", entityKind: "reference", entityId: r.refId, data: { referenceId: r.refId, citeKey: knownIds.get(r.refId)!.citeKey, title: knownIds.get(r.refId)!.title, sourceBlockId: r.sourceBlockId, via: "citation" } });
    events.push(...(await syncTaskItems(tx, p, prev)));
    await recordEvents(tx, events);
  });
  await enqueue(QUEUES.index, { sourceType: "page", sourceId: p.id, workspaceId: p.workspaceId }, { singletonKey: `page:${p.id}`, singletonSeconds: 20, singletonNextSlot: true }); // at most one indexing per page per 20 s, and an edit inside that window is indexed in the next one — never dropped
}
/**
 * Tasks linked to the document (3.0, `taskItem.taskId`). The `tasks` table stays the source of truth of a task; the document is one of
 * its editors:
 *  - a taskItem carrying a `taskId` that is not stored yet creates the task (title = the item's text, status from `checked`, `due`,
 *    `priority`), so an offline client needs only one write path;
 *  - for a stored task, only what CHANGED in the document since the previous save is applied (checked ↔ status, text → title, due,
 *    priority): a task completed from the task list is therefore never undone by a later, unrelated save of the page;
 *  - the task is anchored to the item (`pageId`, `blockId`). A task of another workspace, or one in the trash, is left alone.
 * Removing the item from the document does not delete the task.
 */
async function syncTaskItems(tx: Executor, p: Page, prev: Page | null): Promise<EventInput[]> {
  const items = docTaskItems(p.content as PMNode).filter((i) => i.taskId); if (!items.length) return [];
  const T = schema.tasks; const events: EventInput[] = []; const seen = new Set<string>();
  const before = new Map(docTaskItems(prev?.content as PMNode | undefined).filter((i) => i.taskId).map((i) => [i.taskId!, i]));
  const stored = new Map((await tx.select().from(T).where(inArray(T.id, items.map((i) => i.taskId!)))).map((t) => [t.id, t]));
  for (const it of items) {
    const id = it.taskId!; if (seen.has(id)) continue; seen.add(id); // a duplicated item (copy/paste) keeps the first occurrence
    const t = stored.get(id); const due = parseDue(it.due);
    if (!t) {
      const title = it.text || "Tâche";
      await tx.insert(T).values({ id, workspaceId: p.workspaceId, pageId: p.id, blockId: it.blockId, title, status: it.checked ? "done" : "todo", completedAt: it.checked ? new Date() : null, priority: it.priority ?? "medium", dueAt: due }).onConflictDoNothing();
      events.push({ workspaceId: p.workspaceId, kind: "task.created", pageId: p.id, entityKind: "task", entityId: id, summary: title, data: { blockId: it.blockId, via: "document" } });
      continue;
    }
    if (t.workspaceId !== p.workspaceId || t.deletedAt) continue;
    const was = before.get(id); const set: Partial<typeof T.$inferInsert> = {};
    if (t.pageId !== p.id) set.pageId = p.id; if (t.blockId !== it.blockId) set.blockId = it.blockId;
    if (was) {
      if (was.checked !== it.checked && (t.status === "done") !== it.checked) { set.status = it.checked ? "done" : "todo"; set.completedAt = it.checked ? new Date() : null; events.push({ workspaceId: p.workspaceId, kind: it.checked ? "task.completed" : "task.reopened", pageId: p.id, entityKind: "task", entityId: id, summary: it.text || t.title, data: { blockId: it.blockId, via: "document" } }); }
      if (was.text !== it.text && it.text && it.text !== t.title) set.title = it.text;
      if (was.due !== it.due) set.dueAt = due;
      if (was.priority !== it.priority && it.priority) set.priority = it.priority;
    }
    if (Object.keys(set).length) await tx.update(T).set({ ...set, updatedAt: new Date() }).where(eq(T.id, id));
  }
  return events;
}
export async function softDeletePage(workspaceId: string, id: string) {
  const ids = await descendants(workspaceId, id); ids.push(id);
  await db.transaction(async (tx) => {
    const done = await tx.update(schema.pages).set({ deletedAt: new Date() }).where(and(inArray(schema.pages.id, ids), eq(schema.pages.workspaceId, workspaceId))).returning({ id: schema.pages.id, title: schema.pages.title });
    const root = done.find((d) => d.id === id); if (root) await recordEvent(tx, { workspaceId, kind: "page.trashed", pageId: id, summary: root.title, data: { count: done.length } });
  });
  await db.delete(schema.chunks).where(and(eq(schema.chunks.sourceType, "page"), inArray(schema.chunks.sourceId, ids)));
  return ids.length;
}
export async function restorePage(workspaceId: string, id: string) {
  const ids = await descendants(workspaceId, id, true); ids.push(id);
  await db.transaction(async (tx) => {
    const done = await tx.update(schema.pages).set({ deletedAt: null }).where(and(inArray(schema.pages.id, ids), eq(schema.pages.workspaceId, workspaceId))).returning({ id: schema.pages.id, title: schema.pages.title });
    const root = done.find((d) => d.id === id); if (root) await recordEvent(tx, { workspaceId, kind: "page.restored", pageId: id, summary: root.title, data: { count: done.length } });
  });
  for (const pid of ids) await enqueue(QUEUES.index, { sourceType: "page", sourceId: pid, workspaceId });
}
/**
 * Permanent deletion of one page ("Delete forever").
 * What goes with it (3.0): the sub-pages that were moved to the trash BY THE SAME ACTION as this page (same `deleted_at`: trashing a page
 * trashes its live sub-pages in one statement), and the attachments of the deleted pages (rows + files, see `purgePages`).
 * What never goes with it: a live sub-page (restored on its own, or moved under a trashed page) and a sub-page that was trashed
 * separately, earlier or later — the user did not choose those. They are kept and re-attached to the top level instead of pointing
 * at a parent that no longer exists (2.x left them orphaned).
 */
export async function purgePage(workspaceId: string, id: string) {
  const [root] = await db.select({ id: schema.pages.id, deletedAt: schema.pages.deletedAt }).from(schema.pages).where(and(eq(schema.pages.id, id), eq(schema.pages.workspaceId, workspaceId)));
  if (!root) return { purged: 0, attachments: 0, kept: 0 };
  const kids = await descendants(workspaceId, id, true); let together: string[] = [];
  if (kids.length && root.deletedAt) together = (await db.select({ id: schema.pages.id }).from(schema.pages).where(and(inArray(schema.pages.id, kids), eq(schema.pages.deletedAt, root.deletedAt)))).map((r) => r.id);
  return purgePages(workspaceId, [id, ...together]);
}
/**
 * Hard-delete the given pages (single page purge, "empty the trash", auto-purge). In one transaction: journal entries, attachments of
 * these pages, their index rows, surviving children re-attached to the top level, then the pages (tombstones come from the triggers).
 * An attachment is kept when something that survives still uses it: another page whose document references it, or a research
 * reference whose PDF it is. Files are removed from disk after the commit, and only when no other attachment row shares the same
 * content-addressed file.
 */
export async function purgePages(workspaceId: string, ids: string[]) {
  if (!ids.length) return { purged: 0, attachments: 0, kept: 0 };
  const A = schema.attachments; const P = schema.pages;
  const result = await db.transaction(async (tx) => {
    const gone = await tx.select({ id: P.id, title: P.title }).from(P).where(and(inArray(P.id, ids), eq(P.workspaceId, workspaceId)));
    if (!gone.length) return { purged: 0, attachments: 0, kept: 0, files: [] as string[] };
    const goneIds = gone.map((g) => g.id);
    const atts = await tx.select({ id: A.id, storagePath: A.storagePath }).from(A).where(and(eq(A.workspaceId, workspaceId), inArray(A.pageId, goneIds)));
    const doomed: typeof atts = []; let kept = 0;
    for (const a of atts) {
      const [used] = (await tx.execute(dsql`select (exists (select 1 from pages where workspace_id = ${workspaceId} and id <> all(${pgArr(goneIds)}::uuid[]) and position(${a.id} in content::text) > 0) or exists (select 1 from "references" where attachment_id = ${a.id})) as used`)) as unknown as { used: boolean }[];
      if (used?.used) kept++; else doomed.push(a);
    }
    await recordEvents(tx, gone.map((g) => ({ workspaceId, kind: "page.purged" as const, pageId: g.id, summary: g.title, data: { attachments: doomed.length && g.id === ids[0] ? doomed.length : 0 } })));
    if (doomed.length) {
      await tx.delete(schema.chunks).where(and(eq(schema.chunks.sourceType, "attachment"), inArray(schema.chunks.sourceId, doomed.map((a) => a.id))));
      await tx.delete(schema.indexState).where(and(eq(schema.indexState.sourceType, "attachment"), inArray(schema.indexState.sourceId, doomed.map((a) => a.id))));
      await tx.delete(A).where(inArray(A.id, doomed.map((a) => a.id)));
    }
    const files: string[] = [];
    for (const path of new Set(doomed.map((a) => a.storagePath))) { const [other] = await tx.select({ id: A.id }).from(A).where(eq(A.storagePath, path)).limit(1); if (!other) files.push(path); }
    await tx.delete(schema.chunks).where(and(eq(schema.chunks.sourceType, "page"), inArray(schema.chunks.sourceId, goneIds)));
    await tx.update(P).set({ parentId: null }).where(and(eq(P.workspaceId, workspaceId), inArray(P.parentId, goneIds), dsql`${P.id} <> all(${pgArr(goneIds)}::uuid[])`));
    await tx.delete(P).where(and(inArray(P.id, goneIds), eq(P.workspaceId, workspaceId)));
    return { purged: goneIds.length, attachments: doomed.length, kept, files };
  });
  for (const rel of result.files) { try { await fs.unlink(absPath(rel)); } catch { /* already gone: nothing to do */ } }
  return { purged: result.purged, attachments: result.attachments, kept: result.kept };
}
/** Sub-pages of a page, at any depth. Guarded against parent cycles (CYCLE clause): a loop in old data ends the walk instead of hanging it. */
export async function descendants(workspaceId: string, id: string, includeDeleted = false): Promise<string[]> {
  const rows = await db.execute(dsql`with recursive t as (select id from pages where parent_id = ${id} and workspace_id = ${workspaceId} ${includeDeleted ? dsql`` : dsql`and deleted_at is null`} union all select p.id from pages p join t on p.parent_id = t.id where p.workspace_id = ${workspaceId} ${includeDeleted ? dsql`` : dsql`and p.deleted_at is null`}) cycle id set is_cycle using path select distinct id from t where not is_cycle and id <> ${id}`);
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
