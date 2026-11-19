/**
 * File: src/lib/knowledge/health.ts
 * Description: knowledge health (SPEC §4.5) — what needs attention, computed from real data at each call, no model: orphan pages,
 *   broken links (page, block and file targets that no longer exist), citations of missing references, potential duplicates (same
 *   title / same text), untitled pages, inactive projects, open tasks. Every section returns a count and the ids.
 * Author: Simon-Pierre Boucher · contact@spboucher.ai
 */
import { sql as dsql } from "drizzle-orm";
import { db } from "@/db";
import { extractRefs, docBlocks, type PMNode } from "@/lib/editor/text";
import { computeIntelligence } from "@/lib/graph/intelligence";

const rows = async <T = any>(q: ReturnType<typeof dsql>): Promise<T[]> => (await db.execute(q)) as unknown as T[];
const cap = <T>(a: T[], n = 200) => a.slice(0, n);
/**
 * Pages read for one health computation: the most recently changed ones first. The cut used to be an unordered `limit 20000`, so a
 * workspace just above it (one 20 000-row database) lost an arbitrary set of pages — including the ones just written. The answer says
 * when the cut applies (`score.truncated`).
 */
export const SCAN_MAX = 50_000;
export interface HealthOpts { inactiveDays?: number }

export async function knowledgeHealth(wsId: string, opts: HealthOpts = {}) {
  const inactiveDays = Math.min(3650, Math.max(1, opts.inactiveDays ?? 30)); const now = new Date();
  const [intel, scanned, trashed, atts, refs, taskRows] = await Promise.all([
    computeIntelligence(wsId, { limit: 50 }),
    rows<{ id: string; title: string; icon: string | null; section: string; parent_id: string | null; archived: boolean; updated_at: Date; content: PMNode }>(dsql`select id, title, icon, section, parent_id, archived, updated_at, content from pages where workspace_id = ${wsId} and deleted_at is null order by updated_at desc, id limit ${SCAN_MAX + 1}`),
    rows<{ id: string }>(dsql`select id from pages where workspace_id = ${wsId} and deleted_at is not null`),
    rows<{ id: string; gone: boolean }>(dsql`select id, (deleted_at is not null) as gone from attachments where workspace_id = ${wsId}`),
    rows<{ id: string; gone: boolean }>(dsql`select id, (deleted_at is not null) as gone from "references" where workspace_id = ${wsId}`),
    rows<{ id: string; title: string; due_at: Date | null; page_id: string | null; priority: string | null }>(dsql`select id, title, due_at, page_id, priority from tasks where workspace_id = ${wsId} and deleted_at is null and status <> 'done' order by due_at asc nulls last, created_at desc`),
  ]);
  const truncated = scanned.length > SCAN_MAX; const pages = truncated ? scanned.slice(0, SCAN_MAX) : scanned;
  const live = new Map(pages.map((p) => [p.id, p])); const inTrash = new Set(trashed.map((t) => t.id));
  const attOk = new Set(atts.filter((a) => !a.gone).map((a) => a.id)); const refOk = new Set(refs.filter((r) => !r.gone).map((r) => r.id));
  const blockIds = new Map<string, Set<string>>(); const idsOf = (pageId: string) => { let s = blockIds.get(pageId); if (!s) { s = new Set(); const walk = (n: PMNode) => { if (typeof n.attrs?.id === "string") s!.add(n.attrs.id); (n.content ?? []).forEach(walk); }; walk(live.get(pageId)!.content); blockIds.set(pageId, s); } return s; };
  const brokenLinks: { pageId: string; title: string; kind: "page" | "block" | "file"; targetId: string; targetBlockId?: string | null; blockId: string | null; reason: "missing" | "trashed" }[] = [];
  const missingReferences: { pageId: string; title: string; refId: string; blockId: string | null; reason: "missing" | "deleted" }[] = [];
  for (const p of pages) {
    const r = extractRefs(p.content);
    for (const l of r.pages) {
      if (l.pageId === p.id) continue;
      if (!live.has(l.pageId)) brokenLinks.push({ pageId: p.id, title: p.title, kind: "page", targetId: l.pageId, blockId: l.sourceBlockId, reason: inTrash.has(l.pageId) ? "trashed" : "missing" });
    }
    for (const b of r.blocks) if (b.pageId !== p.id && live.has(b.pageId) && !idsOf(b.pageId).has(b.blockId)) brokenLinks.push({ pageId: p.id, title: p.title, kind: "block", targetId: b.pageId, targetBlockId: b.blockId, blockId: b.sourceBlockId, reason: "missing" });
    for (const a of r.attachments) if (!attOk.has(a)) brokenLinks.push({ pageId: p.id, title: p.title, kind: "file", targetId: a, blockId: null, reason: "missing" });
    for (const c of r.references) if (!refOk.has(c.refId)) missingReferences.push({ pageId: p.id, title: p.title, refId: c.refId, blockId: c.sourceBlockId, reason: refs.some((x) => x.id === c.refId) ? "deleted" : "missing" });
  }
  const untitled = pages.filter((p) => !p.archived && ["", "untitled", "sans titre"].includes(p.title.trim().toLowerCase())).map((p) => ({ id: p.id, section: p.section, updatedAt: new Date(p.updated_at).toISOString(), empty: docBlocks(p.content).length === 0 }));
  // a project = a top-level page of the section `projects`; its activity = the latest change in its whole subtree
  const kids = new Map<string, string[]>(); for (const p of pages) if (p.parent_id) kids.set(p.parent_id, [...(kids.get(p.parent_id) ?? []), p.id]);
  const latest = (id: string, seen = new Set<string>()): number => { if (seen.has(id)) return 0; seen.add(id); let t = new Date(live.get(id)!.updated_at).getTime(); for (const k of kids.get(id) ?? []) t = Math.max(t, latest(k, seen)); return t; };
  const projects = pages.filter((p) => p.section === "projects" && !p.archived && (!p.parent_id || live.get(p.parent_id)?.section !== "projects"));
  const inactiveProjects = projects.map((p) => ({ id: p.id, title: p.title, icon: p.icon, lastActivityAt: new Date(latest(p.id)).toISOString(), idleDays: Math.floor((now.getTime() - latest(p.id)) / 864e5) })).filter((p) => p.idleDays >= inactiveDays).sort((a, b) => b.idleDays - a.idleDays || a.id.localeCompare(b.id));
  const overdue = taskRows.filter((t) => t.due_at && new Date(t.due_at) < now);
  const section = <T>(items: T[], idOf: (x: T) => string) => ({ count: items.length, ids: cap([...new Set(items.map(idOf))]), items: cap(items) });
  return {
    computedAt: now.toISOString(), inactiveDays,
    score: { pages: pages.length, truncated, issues: intel.stats.orphans + brokenLinks.length + missingReferences.length + intel.duplicates.length + untitled.length + inactiveProjects.length + overdue.length },
    orphans: { count: intel.stats.orphans, ids: intel.orphans.map((o) => o.id), items: intel.orphans },
    brokenLinks: section(brokenLinks, (x) => x.pageId),
    missingReferences: section(missingReferences, (x) => x.pageId),
    potentialDuplicates: { count: intel.duplicates.length, ids: cap([...new Set(intel.duplicates.flatMap((d) => d.pageIds))]), items: intel.duplicates },
    untitled: section(untitled, (x) => x.id),
    inactiveProjects: section(inactiveProjects, (x) => x.id),
    openTasks: { count: taskRows.length, overdue: overdue.length, withoutDate: taskRows.filter((t) => !t.due_at).length, ids: cap(taskRows.map((t) => t.id)), items: cap(taskRows.map((t) => ({ id: t.id, title: t.title, dueAt: t.due_at ? new Date(t.due_at).toISOString() : null, pageId: t.page_id, priority: t.priority, overdue: Boolean(t.due_at && new Date(t.due_at) < now) })), 100) },
  };
}
