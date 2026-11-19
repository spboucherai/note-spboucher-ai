/**
 * File: src/lib/graph/concepts.ts
 * Description: concepts of the knowledge graph 2.0 (SPEC §3.3): a named idea of the workspace, linked to the pages that are about it
 *   (`page_concepts`). A concept or a page link proposed by a model is `suggested` until the user accepts or rejects it.
 * Author: Simon-Pierre Boucher · contact@spboucher.ai
 */
import { and, eq, inArray, sql as dsql } from "drizzle-orm";
import { db, schema } from "@/db";
import { HttpError } from "@/lib/errors";
import type { Executor } from "@/lib/events/service";

const C = schema.concepts; const PC = schema.pageConcepts;
export type ConceptRow = typeof C.$inferSelect;
export interface ConceptOut { id: string; name: string; description: string | null; origin: string; status: string; model: string | null; createdAt: Date; updatedAt: Date; decidedAt: Date | null; rev: number; pages: number; suggestedPages: number }
export interface ConceptPage { pageId: string; title: string; icon: string | null; origin: string; status: string; confidence: number | null; blockId: string | null; model: string | null; createdAt: Date }
const cleanName = (s: string) => s.replace(/\s+/g, " ").trim().slice(0, 120);

async function counts(ex: Executor, ids: string[]) {
  const m = new Map<string, { pages: number; suggested: number }>(); if (!ids.length) return m;
  const r = await ex.select({ id: PC.conceptId, status: PC.status, n: dsql<number>`count(*)::int` }).from(PC).innerJoin(schema.pages, eq(schema.pages.id, PC.pageId)).where(and(inArray(PC.conceptId, ids), dsql`${schema.pages.deletedAt} is null`)).groupBy(PC.conceptId, PC.status);
  for (const x of r) { const c = m.get(x.id) ?? { pages: 0, suggested: 0 }; if (x.status === "accepted") c.pages = Number(x.n); if (x.status === "suggested") c.suggested = Number(x.n); m.set(x.id, c); }
  return m;
}
const out = (c: ConceptRow, n?: { pages: number; suggested: number }): ConceptOut => ({ id: c.id, name: c.name, description: c.description, origin: c.origin, status: c.status, model: c.model, createdAt: c.createdAt, updatedAt: c.updatedAt, decidedAt: c.decidedAt, rev: c.rev, pages: n?.pages ?? 0, suggestedPages: n?.suggested ?? 0 });

/** Concepts by name. `status`: accepted (default) | suggested | rejected | all. `pageId` → only the concepts of that page. */
export async function listConcepts(wsId: string, q: { status?: string | null; pageId?: string | null } = {}): Promise<ConceptOut[]> {
  const status = q.status ?? "accepted";
  const rowsC = await db.select().from(C).where(and(eq(C.workspaceId, wsId), status === "all" ? undefined : eq(C.status, status), q.pageId ? dsql`exists (select 1 from page_concepts pc where pc.concept_id = ${C.id} and pc.page_id = ${q.pageId} and pc.status <> 'rejected')` : undefined)).orderBy(dsql`lower(${C.name})`, C.id).limit(2000);
  const n = await counts(db, rowsC.map((c) => c.id)); return rowsC.map((c) => out(c, n.get(c.id)));
}
export async function getConcept(wsId: string, id: string): Promise<ConceptOut & { pageLinks: ConceptPage[] }> {
  const [c] = await db.select().from(C).where(and(eq(C.id, id), eq(C.workspaceId, wsId))); if (!c) throw new HttpError(404, "Concept not found", "not_found");
  const links = await db.select({ pageId: PC.pageId, title: schema.pages.title, icon: schema.pages.icon, origin: PC.origin, status: PC.status, confidence: PC.confidence, blockId: PC.blockId, model: PC.model, createdAt: PC.createdAt }).from(PC).innerJoin(schema.pages, eq(schema.pages.id, PC.pageId)).where(and(eq(PC.conceptId, id), dsql`${schema.pages.deletedAt} is null`)).orderBy(schema.pages.title, PC.pageId);
  return { ...out(c, (await counts(db, [id])).get(id)), pageLinks: links };
}
/**
 * Create a concept. Idempotent on a client-chosen `id`; a concept with the same name (case-insensitive) → 409 `concept_exists` with
 * its id for the user, and simply returned for a model (`origin: "ai"`: suggested, never re-created, never changes an existing status).
 */
export async function createConcept(wsId: string, input: { id?: string; name: string; description?: string | null; pageIds?: string[] }, opts: { origin?: "user" | "ai"; model?: string | null } = {}, ex?: Executor): Promise<{ concept: ConceptRow; existing: boolean }> {
  const name = cleanName(input.name); if (!name) throw new HttpError(400, "A concept needs a name", "bad_request"); const origin = opts.origin ?? "user";
  const run = async (tx: Executor) => {
    if (input.id) { const [old] = await tx.select().from(C).where(eq(C.id, input.id)); if (old) { if (old.workspaceId !== wsId) throw new HttpError(409, "This id is already in use", "id_taken"); return { concept: old, existing: true }; } }
    const [same] = await tx.select().from(C).where(and(eq(C.workspaceId, wsId), dsql`lower(${C.name}) = ${name.toLowerCase()}`));
    if (same) { if (origin === "ai") return { concept: same, existing: true }; throw new HttpError(409, "A concept with this name already exists", "concept_exists", { id: same.id, status: same.status }); }
    const [c] = await tx.insert(C).values({ ...(input.id ? { id: input.id } : {}), workspaceId: wsId, name, description: input.description?.slice(0, 2000) ?? null, origin, status: origin === "user" ? "accepted" : "suggested", decidedAt: origin === "user" ? new Date() : null, model: opts.model ?? null }).returning();
    if (input.pageIds?.length && origin === "user") await linkPages(tx, wsId, c.id, input.pageIds.map((pageId) => ({ pageId })), { origin: "user" });
    return { concept: c, existing: false };
  };
  return ex ? run(ex) : db.transaction(run);
}
/** Attach pages to a concept. User links are accepted; model links are suggested and never overwrite an existing link (whatever its status). */
export async function linkPages(ex: Executor, wsId: string, conceptId: string, links: { pageId: string; confidence?: number | null; blockId?: string | null }[], opts: { origin: "user" | "ai"; model?: string | null }) {
  if (!links.length) return 0;
  const ok = new Set((await ex.select({ id: schema.pages.id }).from(schema.pages).where(and(eq(schema.pages.workspaceId, wsId), inArray(schema.pages.id, links.map((l) => l.pageId)), dsql`${schema.pages.deletedAt} is null`))).map((p) => p.id));
  const bad = links.filter((l) => !ok.has(l.pageId)); if (bad.length && opts.origin === "user") throw new HttpError(400, "Unknown page", "bad_page", { pageIds: bad.map((b) => b.pageId) });
  const values = links.filter((l) => ok.has(l.pageId)).map((l) => ({ pageId: l.pageId, conceptId, origin: opts.origin, status: opts.origin === "user" ? "accepted" : "suggested", decidedAt: opts.origin === "user" ? new Date() : null, confidence: l.confidence ?? null, blockId: l.blockId ?? null, model: opts.model ?? null }));
  if (!values.length) return 0;
  if (opts.origin === "user") { await ex.insert(PC).values(values).onConflictDoUpdate({ target: [PC.pageId, PC.conceptId], set: { status: "accepted", decidedAt: new Date() } }); return values.length; }
  return (await ex.insert(PC).values(values).onConflictDoNothing().returning({ pageId: PC.pageId })).length;
}
export interface ConceptPatch { name?: string; description?: string | null; status?: "accepted" | "rejected" | "suggested"; addPages?: string[]; removePages?: string[]; pageLinks?: { pageId: string; status: "accepted" | "rejected" | "suggested" }[] }
export async function updateConcept(wsId: string, id: string, patch: ConceptPatch): Promise<ConceptOut & { pageLinks: ConceptPage[] }> {
  await db.transaction(async (tx) => {
    const [cur] = await tx.select().from(C).where(and(eq(C.id, id), eq(C.workspaceId, wsId))); if (!cur) throw new HttpError(404, "Concept not found", "not_found");
    const set: Partial<typeof C.$inferInsert> = {};
    if (patch.name !== undefined) { const name = cleanName(patch.name); if (!name) throw new HttpError(400, "A concept needs a name", "bad_request"); if (name.toLowerCase() !== cur.name.toLowerCase()) { const [same] = await tx.select({ id: C.id, status: C.status }).from(C).where(and(eq(C.workspaceId, wsId), dsql`lower(${C.name}) = ${name.toLowerCase()}`)); if (same) throw new HttpError(409, "A concept with this name already exists", "concept_exists", { id: same.id, status: same.status }); } set.name = name; }
    if (patch.description !== undefined) set.description = patch.description?.slice(0, 2000) ?? null;
    if (patch.status !== undefined && patch.status !== cur.status) { set.status = patch.status; set.decidedAt = patch.status === "suggested" ? null : new Date(); }
    if (Object.keys(set).length) await tx.update(C).set({ ...set, updatedAt: new Date() }).where(eq(C.id, id));
    if (patch.addPages?.length) await linkPages(tx, wsId, id, patch.addPages.map((pageId) => ({ pageId })), { origin: "user" });
    if (patch.removePages?.length) await tx.delete(PC).where(and(eq(PC.conceptId, id), inArray(PC.pageId, patch.removePages)));
    for (const l of patch.pageLinks ?? []) await tx.update(PC).set({ status: l.status, decidedAt: l.status === "suggested" ? null : new Date() }).where(and(eq(PC.conceptId, id), eq(PC.pageId, l.pageId)));
    // any change to the page links is a change of the concept for the feed
    if (!Object.keys(set).length && (patch.addPages?.length || patch.removePages?.length || patch.pageLinks?.length)) await tx.update(C).set({ updatedAt: new Date() }).where(eq(C.id, id));
  });
  return getConcept(wsId, id);
}
/** Returns false when there was nothing to delete: DELETE is idempotent, the route answers 200 both times. */
export async function deleteConcept(wsId: string, id: string): Promise<boolean> {
  const r = await db.delete(C).where(and(eq(C.id, id), eq(C.workspaceId, wsId))).returning({ id: C.id }); if (!r.length) return false;
  await db.delete(schema.knowledgeEdges).where(and(eq(schema.knowledgeEdges.workspaceId, wsId), dsql`((${schema.knowledgeEdges.fromId} = ${id} and ${schema.knowledgeEdges.sourceKind} = 'concept') or (${schema.knowledgeEdges.toId} = ${id} and ${schema.knowledgeEdges.targetKind} = 'concept'))`));
  return true;
}
