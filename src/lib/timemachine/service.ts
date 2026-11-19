/**
 * File: src/lib/timemachine/service.ts
 * Description: time machine (SPEC §4.4) — the state of a page, or of a project (a page and its sub-pages), at a past date, rebuilt
 *   only from what is stored: the page history (`page_versions`), the creation dates of edges and references, and the journal.
 *   Nothing is interpolated: each page says where its state comes from and whether it is exact.
 * Author: Simon-Pierre Boucher · contact@spboucher.ai
 */
import { and, asc, desc, eq, gt, inArray, lte, sql as dsql } from "drizzle-orm";
import { db, schema } from "@/db";
import { HttpError } from "@/lib/errors";
import { descendants } from "@/lib/pages/service";
import { nodeTitles } from "@/lib/graph/relations";

const P = schema.pages; const V = schema.pageVersions; const K = schema.knowledgeEdges; const R = schema.researchReferences; const E = schema.knowledgeEvents;
/**
 * Where the state of a page at `at` comes from:
 *  - `current`        the page has not changed since `at`: its present state IS the state at that date (`exact: true`);
 *  - `version`        the most recent history entry taken at or before `at` (SPEC: "nearest version ≤ at"). History entries are taken
 *                     every 10 minutes / 20 saves, so edits made between that entry and `at` are not in it (`exact: false`);
 *  - `version_after`  no entry at or before `at`: the first one taken after it, which holds the page as it was just before that later
 *                     save (`exact: false`; it is exact when the page was not saved in between, which is the usual case right after creation);
 *  - `none`           the page did not exist yet at `at` (`existed: false`), or it existed but no history covers that date.
 */
export type StateSource = "current" | "version" | "version_after" | "none";
export interface PageState { id: string; title: string; icon: string | null; section: string; parentId: string | null; existed: boolean; trashedAt: string | null; source: StateSource; exact: boolean; version: number | null; versionId: string | null; versionAt: string | null; wordCount: number | null; currentTitle: string; currentVersion: number; changedSince: boolean; content?: unknown; properties?: unknown }

export async function stateAt(wsId: string, at: Date, scope: { pageId?: string | null; projectId?: string | null }, opts: { content?: boolean } = {}) {
  const rootId = scope.pageId ?? scope.projectId; if (!rootId) throw new HttpError(400, "pageId or projectId is required", "bad_request");
  const [root] = await db.select({ id: P.id }).from(P).where(and(eq(P.id, rootId), eq(P.workspaceId, wsId))); if (!root) throw new HttpError(404, "Page not found", "not_found");
  const ids = scope.projectId ? [rootId, ...(await descendants(wsId, rootId, true))] : [rootId];
  const withContent = opts.content ?? Boolean(scope.pageId);
  const pages = await db.select().from(P).where(and(eq(P.workspaceId, wsId), inArray(P.id, ids)));
  pages.sort((a, b) => (a.id === rootId ? -1 : b.id === rootId ? 1 : a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))); // the root, then by creation date
  const states: PageState[] = [];
  for (const p of pages) {
    const base = { id: p.id, icon: p.icon, section: p.section, parentId: p.parentId, trashedAt: p.deletedAt && p.deletedAt <= at ? p.deletedAt.toISOString() : null, currentTitle: p.title, currentVersion: p.version };
    if (p.createdAt > at) { states.push({ ...base, title: p.title, existed: false, source: "none", exact: false, version: null, versionId: null, versionAt: null, wordCount: null, changedSince: true }); continue; }
    if (p.updatedAt <= at) { states.push({ ...base, title: p.title, existed: true, source: "current", exact: true, version: p.version, versionId: null, versionAt: p.updatedAt.toISOString(), wordCount: p.wordCount, changedSince: false, ...(withContent ? { content: p.content, properties: p.properties } : {}) }); continue; }
    const cols = withContent ? undefined : { id: V.id, version: V.version, title: V.title, createdAt: V.createdAt, wordCount: V.wordCount };
    const pick = async (after: boolean) => (cols ? await db.select(cols).from(V).where(and(eq(V.pageId, p.id), gt(V.version, 0), after ? gt(V.createdAt, at) : lte(V.createdAt, at))).orderBy(after ? asc(V.createdAt) : desc(V.createdAt)).limit(1)
      : await db.select().from(V).where(and(eq(V.pageId, p.id), gt(V.version, 0), after ? gt(V.createdAt, at) : lte(V.createdAt, at))).orderBy(after ? asc(V.createdAt) : desc(V.createdAt)).limit(1))[0] as (typeof V.$inferSelect) | undefined;
    const before = await pick(false); const v = before ?? (await pick(true));
    if (!v) { states.push({ ...base, title: p.title, existed: true, source: "none", exact: false, version: null, versionId: null, versionAt: null, wordCount: null, changedSince: true }); continue; }
    states.push({ ...base, title: v.title, existed: true, source: before ? "version" : "version_after", exact: false, version: v.version, versionId: v.id, versionAt: v.createdAt.toISOString(), wordCount: v.wordCount ?? null, changedSince: true, ...(withContent ? { content: v.content, properties: v.properties ?? {} } : {}) });
  }
  const existing = states.filter((s) => s.existed).map((s) => s.id);
  // relations that existed at that date: created by then, accepted by then, and valid at that date when they carry a validity interval
  const edges = existing.length ? await db.select().from(K).where(and(eq(K.workspaceId, wsId), dsql`(${K.fromId} = any(${`{${existing.join(",")}}`}::uuid[]) or ${K.toId} = any(${`{${existing.join(",")}}`}::uuid[]))`, lte(K.createdAt, at), eq(K.status, "accepted"), dsql`(${K.decidedAt} is null or ${K.decidedAt} <= ${at.toISOString()}::timestamptz)`, dsql`(${K.validFrom} is null or ${K.validFrom} <= ${at.toISOString()}::timestamptz)`, dsql`(${K.validTo} is null or ${K.validTo} >= ${at.toISOString()}::timestamptz)`)).orderBy(asc(K.createdAt), asc(K.id)).limit(2000) : [];
  const titles = await nodeTitles(db, wsId, edges);
  const relations = edges.map((k) => ({ id: k.id, fromId: k.fromId, toId: k.toId, sourceKind: k.sourceKind, targetKind: k.targetKind, kind: k.kind, relType: k.relType, origin: k.origin, note: k.note, validFrom: k.validFrom, validTo: k.validTo, sourceBlockId: k.sourceBlockId, targetBlockId: k.targetBlockId, createdAt: k.createdAt, fromTitle: titles.get(k.fromId) ?? null, toTitle: titles.get(k.toId) ?? null }));
  const citedIds = edges.filter((k) => k.targetKind === "reference").map((k) => k.toId);
  const references = existing.length ? await db.select({ id: R.id, citeKey: R.citeKey, title: R.title, authors: R.authors, year: R.year, pageId: R.pageId, createdAt: R.createdAt }).from(R).where(and(eq(R.workspaceId, wsId), lte(R.createdAt, at), dsql`(${R.deletedAt} is null or ${R.deletedAt} > ${at.toISOString()}::timestamptz)`, citedIds.length ? dsql`(${R.pageId} = any(${`{${existing.join(",")}}`}::uuid[]) or ${R.id} = any(${`{${citedIds.join(",")}}`}::uuid[]))` : dsql`${R.pageId} = any(${`{${existing.join(",")}}`}::uuid[])`)).orderBy(asc(R.createdAt), asc(R.id)).limit(1000) : [];
  // what existed at that date and has been removed since, as far as the journal knows (events are recorded since 3.0 only)
  const removed = existing.length ? await db.select({ id: E.id, at: E.at, kind: E.kind, pageId: E.pageId, summary: E.summary, data: E.data }).from(E).where(and(eq(E.workspaceId, wsId), inArray(E.pageId, existing), inArray(E.kind, ["link.removed", "relation.removed"]), gt(E.at, at))).orderBy(asc(E.at)).limit(500) : [];
  const [j] = await db.select({ first: dsql<Date | null>`min(${E.at}) filter (where not coalesce((${E.data}->>'backfilled')::boolean, false))` }).from(E).where(eq(E.workspaceId, wsId));
  return { at: at.toISOString(), scope: scope.projectId ? { projectId: rootId } : { pageId: rootId }, pages: states, relations, references, removedSince: removed, journalSince: j?.first ? new Date(j.first).toISOString() : null };
}
