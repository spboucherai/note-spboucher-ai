/**
 * File: src/lib/graph/relations.ts
 * Description: typed relations of the knowledge graph 2.0 (SPEC §3.3 / §4.3). A relation is a `knowledge_edges` row of kind
 *   `relation` between two nodes (page | reference | concept) with a meaning (`relType`), an origin (user | ai | system), an optional
 *   validity interval and optional block anchors. User relations are accepted at creation; anything created by a model is stored
 *   `suggested` and only an explicit user decision changes that (never auto-accepted). Edges derived from documents (`link`, `cites`)
 *   are read-only here: they change when the document changes.
 * Author: Simon-Pierre Boucher · contact@spboucher.ai
 */
import { and, desc, eq, inArray, or, sql as dsql, type SQL } from "drizzle-orm";
import { db, schema } from "@/db";
import { HttpError } from "@/lib/errors";
import { recordEvent, type Executor } from "@/lib/events/service";
import { decideSuggestion, revertSuggestion } from "./service";

export const REL_TYPES = ["related", "supports", "contradicts", "extends", "example_of", "part_of", "cites", "precedes", "follows", "about", "answers", "duplicates"] as const;
export type RelType = (typeof REL_TYPES)[number];
export const NODE_KINDS2 = ["page", "reference", "concept"] as const;
export type NodeKind2 = (typeof NODE_KINDS2)[number];
const K = schema.knowledgeEdges;
export type EdgeRow = typeof K.$inferSelect;
export interface RelationInput { id?: string; fromId: string; toId: string; sourceKind?: NodeKind2; targetKind?: NodeKind2; relType: RelType; note?: string | null; validFrom?: Date | null; validTo?: Date | null; sourceBlockId?: string | null; targetBlockId?: string | null }
export interface RelationOut { id: string; fromId: string; toId: string; sourceKind: string; targetKind: string; kind: string; relType: string; origin: string; status: string; confidence: number | null; rationale: string | null; note: string | null; model: string | null; validFrom: Date | null; validTo: Date | null; sourceBlockId: string | null; targetBlockId: string | null; createdAt: Date; updatedAt: Date; decidedAt: Date | null; rev: number; fromTitle: string | null; toTitle: string | null }

const out = (k: EdgeRow, titles: Map<string, string>): RelationOut => ({ id: k.id, fromId: k.fromId, toId: k.toId, sourceKind: k.sourceKind, targetKind: k.targetKind, kind: k.kind, relType: k.relType, origin: k.origin, status: k.status, confidence: k.confidence, rationale: k.rationale, note: k.note, model: k.model, validFrom: k.validFrom, validTo: k.validTo, sourceBlockId: k.sourceBlockId, targetBlockId: k.targetBlockId, createdAt: k.createdAt, updatedAt: k.updatedAt, decidedAt: k.decidedAt, rev: k.rev, fromTitle: titles.get(k.fromId) ?? null, toTitle: titles.get(k.toId) ?? null });
/** Titles of the nodes of a set of edges, whatever their kind (3 queries at most). */
export async function nodeTitles(ex: Executor, wsId: string, edges: Pick<EdgeRow, "fromId" | "toId" | "sourceKind" | "targetKind">[]): Promise<Map<string, string>> {
  const by: Record<string, Set<string>> = { page: new Set(), reference: new Set(), concept: new Set() };
  for (const e of edges) { by[e.sourceKind]?.add(e.fromId); by[e.targetKind]?.add(e.toId); }
  const m = new Map<string, string>();
  if (by.page.size) for (const r of await ex.select({ id: schema.pages.id, t: schema.pages.title }).from(schema.pages).where(and(eq(schema.pages.workspaceId, wsId), inArray(schema.pages.id, [...by.page])))) m.set(r.id, r.t);
  if (by.reference.size) for (const r of await ex.select({ id: schema.researchReferences.id, t: schema.researchReferences.title }).from(schema.researchReferences).where(and(eq(schema.researchReferences.workspaceId, wsId), inArray(schema.researchReferences.id, [...by.reference])))) m.set(r.id, r.t);
  if (by.concept.size) for (const r of await ex.select({ id: schema.concepts.id, t: schema.concepts.name }).from(schema.concepts).where(and(eq(schema.concepts.workspaceId, wsId), inArray(schema.concepts.id, [...by.concept])))) m.set(r.id, r.t);
  return m;
}
/** The node must exist in the workspace (a trashed page is refused: a relation to it could not be shown). */
async function assertNode(ex: Executor, wsId: string, kind: NodeKind2, id: string, side: "fromId" | "toId") {
  const found = kind === "page" ? await ex.select({ id: schema.pages.id }).from(schema.pages).where(and(eq(schema.pages.id, id), eq(schema.pages.workspaceId, wsId), dsql`${schema.pages.deletedAt} is null`))
    : kind === "reference" ? await ex.select({ id: schema.researchReferences.id }).from(schema.researchReferences).where(and(eq(schema.researchReferences.id, id), eq(schema.researchReferences.workspaceId, wsId), dsql`${schema.researchReferences.deletedAt} is null`))
    : await ex.select({ id: schema.concepts.id }).from(schema.concepts).where(and(eq(schema.concepts.id, id), eq(schema.concepts.workspaceId, wsId)));
  if (!found.length) throw new HttpError(400, `Unknown ${kind} for ${side}`, "bad_node", { field: side });
}
const pageOf = (k: Pick<EdgeRow, "fromId" | "toId" | "sourceKind" | "targetKind">) => (k.sourceKind === "page" ? k.fromId : k.targetKind === "page" ? k.toId : null);
const eventData = (k: EdgeRow, titles: Map<string, string>) => ({ relationId: k.id, relType: k.relType, origin: k.origin, fromId: k.fromId, toId: k.toId, sourceKind: k.sourceKind, targetKind: k.targetKind, fromTitle: titles.get(k.fromId) ?? null, toTitle: titles.get(k.toId) ?? null, ...(k.model ? { model: k.model } : {}) });

/**
 * Create a typed relation. `origin: "user"` (the API) → accepted at once, event `relation.created`. `origin: "ai"` (analysis jobs) →
 * always `suggested`, no event until the user decides. A client-chosen `id` makes the call idempotent; the same (from, to, relType)
 * relation stored under another id → 409 `relation_exists` with that id.
 */
export async function createRelation(wsId: string, input: RelationInput, opts: { origin?: "user" | "ai"; model?: string | null; confidence?: number | null; rationale?: string | null } = {}): Promise<{ relation: RelationOut; existing: boolean }> {
  const origin = opts.origin ?? "user"; const sourceKind = input.sourceKind ?? "page"; const targetKind = input.targetKind ?? "page";
  if (input.fromId === input.toId && sourceKind === targetKind) throw new HttpError(400, "A relation needs two different nodes", "bad_node");
  if (input.validFrom && input.validTo && input.validTo < input.validFrom) throw new HttpError(400, "validTo is before validFrom", "bad_request");
  return db.transaction(async (tx) => {
    if (input.id) { const [old] = await tx.select().from(K).where(eq(K.id, input.id)); if (old) { if (old.workspaceId !== wsId) throw new HttpError(409, "This id is already in use", "id_taken"); return { relation: out(old, await nodeTitles(tx, wsId, [old])), existing: true }; } }
    await assertNode(tx, wsId, sourceKind, input.fromId, "fromId"); await assertNode(tx, wsId, targetKind, input.toId, "toId");
    const [dup] = await tx.select().from(K).where(and(eq(K.workspaceId, wsId), eq(K.fromId, input.fromId), eq(K.toId, input.toId), eq(K.kind, "relation"), eq(K.relType, input.relType)));
    if (dup) {
      if (origin === "ai") return { relation: out(dup, await nodeTitles(tx, wsId, [dup])), existing: true }; // already known (in any status, a rejected one included): a model never re-proposes it
      throw new HttpError(409, "This relation already exists", "relation_exists", { id: dup.id, status: dup.status });
    }
    const [k] = await tx.insert(K).values({ ...(input.id ? { id: input.id } : {}), workspaceId: wsId, fromId: input.fromId, toId: input.toId, fromType: sourceKind, toType: targetKind, sourceKind, targetKind, kind: "relation", relType: input.relType, origin, status: origin === "user" ? "accepted" : "suggested", decidedAt: origin === "user" ? new Date() : null, note: input.note?.slice(0, 2000) ?? null, validFrom: input.validFrom ?? null, validTo: input.validTo ?? null, sourceBlockId: input.sourceBlockId ?? null, targetBlockId: input.targetBlockId ?? null, model: opts.model ?? null, confidence: opts.confidence ?? null, rationale: opts.rationale?.slice(0, 600) ?? null }).returning();
    const titles = await nodeTitles(tx, wsId, [k]);
    if (origin === "user") await recordEvent(tx, { workspaceId: wsId, kind: "relation.created", pageId: pageOf(k), entityKind: "edge", entityId: k.id, summary: `${titles.get(k.fromId) ?? "?"} — ${k.relType} → ${titles.get(k.toId) ?? "?"}`, data: eventData(k, titles) });
    return { relation: out(k, titles), existing: false };
  });
}
export async function getRelation(wsId: string, id: string): Promise<RelationOut> {
  const [k] = await db.select().from(K).where(and(eq(K.id, id), eq(K.workspaceId, wsId))); if (!k) throw new HttpError(404, "Relation not found", "not_found");
  return out(k, await nodeTitles(db, wsId, [k]));
}
export interface RelationPatch { status?: "accepted" | "rejected" | "suggested"; relType?: RelType; note?: string | null; validFrom?: Date | null; validTo?: Date | null }
/**
 * Accept / reject / put back in review, or edit a relation. Derived edges (`link`, `cites`) → 409 `derived_edge`. An `ai_suggested`
 * link suggestion keeps its 2.x behaviour (accepting it creates the backlink) and only accepts a status change.
 */
export async function updateRelation(wsId: string, id: string, patch: RelationPatch): Promise<RelationOut> {
  const [cur] = await db.select().from(K).where(and(eq(K.id, id), eq(K.workspaceId, wsId))); if (!cur) throw new HttpError(404, "Relation not found", "not_found");
  if (cur.kind === "link" || cur.kind === "cites") throw new HttpError(409, "This edge is derived from a document: edit the document instead", "derived_edge");
  if (cur.kind === "ai_suggested") {
    if (patch.relType !== undefined || patch.note !== undefined || patch.validFrom !== undefined || patch.validTo !== undefined) throw new HttpError(409, "A link suggestion can only be accepted or rejected", "derived_edge");
    if (patch.status === "suggested") await revertSuggestion(wsId, id); else if (patch.status) await decideSuggestion(wsId, id, patch.status);
    return getRelation(wsId, id);
  }
  return db.transaction(async (tx) => {
    const set: Partial<typeof K.$inferInsert> = { updatedAt: new Date() };
    if (patch.relType !== undefined && patch.relType !== cur.relType) {
      const [dup] = await tx.select({ id: K.id }).from(K).where(and(eq(K.fromId, cur.fromId), eq(K.toId, cur.toId), eq(K.kind, "relation"), eq(K.relType, patch.relType)));
      if (dup) throw new HttpError(409, "This relation already exists", "relation_exists", { id: dup.id }); set.relType = patch.relType;
    }
    if (patch.note !== undefined) set.note = patch.note?.slice(0, 2000) ?? null;
    if (patch.validFrom !== undefined) set.validFrom = patch.validFrom; if (patch.validTo !== undefined) set.validTo = patch.validTo;
    const vf = set.validFrom !== undefined ? set.validFrom : cur.validFrom; const vt = set.validTo !== undefined ? set.validTo : cur.validTo;
    if (vf && vt && vt < vf) throw new HttpError(400, "validTo is before validFrom", "bad_request");
    const decided = patch.status !== undefined && patch.status !== cur.status;
    if (decided) { set.status = patch.status; set.decidedAt = patch.status === "suggested" ? null : new Date(); }
    const [k] = await tx.update(K).set(set).where(eq(K.id, id)).returning(); const titles = await nodeTitles(tx, wsId, [k]);
    if (decided && k.status !== "suggested") await recordEvent(tx, { workspaceId: wsId, kind: k.status === "accepted" ? "relation.accepted" : "relation.rejected", pageId: pageOf(k), entityKind: "edge", entityId: k.id, summary: `${titles.get(k.fromId) ?? "?"} — ${k.relType} → ${titles.get(k.toId) ?? "?"}`, data: eventData(k, titles) });
    return out(k, titles);
  });
}
/** Delete a relation (user or AI one). Derived edges → 409 `derived_edge`. The tombstone comes from the trigger. */
export async function deleteRelation(wsId: string, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [cur] = await tx.select().from(K).where(and(eq(K.id, id), eq(K.workspaceId, wsId))); if (!cur) throw new HttpError(404, "Relation not found", "not_found");
    if (cur.kind !== "relation") throw new HttpError(409, cur.kind === "ai_suggested" ? "A link suggestion is rejected, not deleted" : "This edge is derived from a document: edit the document instead", "derived_edge");
    const titles = await nodeTitles(tx, wsId, [cur]);
    await tx.delete(K).where(eq(K.id, id));
    await recordEvent(tx, { workspaceId: wsId, kind: "relation.removed", pageId: pageOf(cur), entityKind: "edge", entityId: cur.id, summary: `${titles.get(cur.fromId) ?? "?"} — ${cur.relType} → ${titles.get(cur.toId) ?? "?"}`, data: eventData(cur, titles) });
  });
}
/** Relations (kind `relation`, plus `cites` / `ai_suggested` when asked) touching a node, or all of them. Newest first, ≤ 500. */
export async function listRelations(wsId: string, q: { nodeId?: string | null; status?: string | null; relType?: string | null; origin?: string | null; kinds?: string[]; limit?: number } = {}): Promise<RelationOut[]> {
  const where: (SQL | undefined)[] = [eq(K.workspaceId, wsId), inArray(K.kind, q.kinds?.length ? q.kinds : ["relation"])];
  if (q.nodeId) where.push(or(eq(K.fromId, q.nodeId), eq(K.toId, q.nodeId)));
  if (q.status) where.push(eq(K.status, q.status)); if (q.relType) where.push(eq(K.relType, q.relType)); if (q.origin) where.push(eq(K.origin, q.origin));
  const rows = await db.select().from(K).where(and(...where)).orderBy(desc(K.createdAt), desc(K.id)).limit(Math.min(500, q.limit ?? 200));
  const titles = await nodeTitles(db, wsId, rows); return rows.map((k) => out(k, titles));
}
