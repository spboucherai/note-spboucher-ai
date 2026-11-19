/**
 * File: src/lib/sync/entities.ts
 * Description: the entity kinds of the change feed added in 3.0 (SPEC §3.1) — for each kind, the table, the exact row shape sent to
 *   clients, and how its rows are scoped to a workspace. `GET /api/sync?kinds=` and docs/next/API-NEXT.md are generated from this
 *   single table, so the documented shapes cannot drift from the served ones.
 * Author: Simon-Pierre Boucher · contact@spboucher.ai
 */
import { and, asc, eq, gt, lte, sql as dsql, type SQL } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import { db, schema } from "@/db";

export const ENTITY_KINDS = ["task", "database", "database_property", "database_view", "database_row", "edge", "reference", "canvas", "concept"] as const;
export type EntityKind = (typeof ENTITY_KINDS)[number];
interface Def { table: PgTable; name: string; rev: PgColumn; ws: PgColumn; cols: Record<string, PgColumn> }
const { tasks: T, databases: D, databaseProperties: DP, databaseViews: DV, databaseRows: DR, knowledgeEdges: K, researchReferences: R, canvases: C, concepts: CO } = schema;

export const ENTITIES: Record<EntityKind, Def> = {
  task: { table: T, name: "tasks", rev: T.rev, ws: T.workspaceId, cols: { id: T.id, pageId: T.pageId, blockId: T.blockId, title: T.title, status: T.status, priority: T.priority, dueAt: T.dueAt, completedAt: T.completedAt, project: T.project, createdAt: T.createdAt, updatedAt: T.updatedAt, deletedAt: T.deletedAt, rev: T.rev } },
  database: { table: D, name: "databases", rev: D.rev, ws: D.workspaceId, cols: { id: D.id, pageId: D.pageId, name: D.name, description: D.description, icon: D.icon, isTemplate: D.isTemplate, templateOf: D.templateOf, createdAt: D.createdAt, updatedAt: D.updatedAt, deletedAt: D.deletedAt, rev: D.rev } },
  database_property: { table: DP, name: "database_properties", rev: DP.rev, ws: DP.workspaceId, cols: { id: DP.id, databaseId: DP.databaseId, name: DP.name, type: DP.type, config: DP.config, position: DP.position, width: DP.width, createdAt: DP.createdAt, rev: DP.rev } },
  database_view: { table: DV, name: "database_views", rev: DV.rev, ws: DV.workspaceId, cols: { id: DV.id, databaseId: DV.databaseId, name: DV.name, type: DV.type, config: DV.config, position: DV.position, isDefault: DV.isDefault, createdAt: DV.createdAt, rev: DV.rev } },
  database_row: { table: DR, name: "database_rows", rev: DR.rev, ws: DR.workspaceId, cols: { id: DR.id, databaseId: DR.databaseId, pageId: DR.pageId, values: DR.values, position: DR.position, createdAt: DR.createdAt, updatedAt: DR.updatedAt, deletedAt: DR.deletedAt, rev: DR.rev } },
  edge: { table: K, name: "knowledge_edges", rev: K.rev, ws: K.workspaceId, cols: { id: K.id, fromId: K.fromId, toId: K.toId, sourceKind: K.sourceKind, targetKind: K.targetKind, kind: K.kind, relType: K.relType, origin: K.origin, status: K.status, confidence: K.confidence, rationale: K.rationale, note: K.note, model: K.model, validFrom: K.validFrom, validTo: K.validTo, sourceBlockId: K.sourceBlockId, targetBlockId: K.targetBlockId, createdAt: K.createdAt, updatedAt: K.updatedAt, decidedAt: K.decidedAt, rev: K.rev } },
  reference: { table: R, name: "references", rev: R.rev, ws: R.workspaceId, cols: { id: R.id, pageId: R.pageId, citeKey: R.citeKey, entryType: R.entryType, title: R.title, authors: R.authors, year: R.year, journal: R.journal, doi: R.doi, url: R.url, bibtex: R.bibtex, fields: R.fields, verified: R.verified, attachmentId: R.attachmentId, createdAt: R.createdAt, updatedAt: R.updatedAt, deletedAt: R.deletedAt, rev: R.rev } },
  canvas: { table: C, name: "canvases", rev: C.rev, ws: C.workspaceId, cols: { id: C.pageId, pageId: C.pageId, data: C.data, version: C.version, createdAt: C.createdAt, updatedAt: C.updatedAt, rev: C.rev } },
  concept: { table: CO, name: "concepts", rev: CO.rev, ws: CO.workspaceId, cols: { id: CO.id, name: CO.name, description: CO.description, origin: CO.origin, status: CO.status, model: CO.model, createdAt: CO.createdAt, updatedAt: CO.updatedAt, decidedAt: CO.decidedAt, rev: CO.rev } },
};
export const isEntityKind = (k: string): k is EntityKind => (ENTITY_KINDS as readonly string[]).includes(k);

/** Greatest revision of the given kinds in the workspace (0 when none). */
export async function entityHead(wsId: string, kinds: EntityKind[]): Promise<number> {
  if (!kinds.length) return 0;
  const parts = kinds.map((k) => dsql`(select coalesce(max(rev), 0) from ${dsql.identifier(ENTITIES[k].name)} where workspace_id = ${wsId})`);
  const [h] = (await db.execute(dsql`select greatest(${dsql.join(parts, dsql`, `)})::bigint as head`)) as unknown as { head: string }[];
  return Number(h.head);
}
/** One window of one kind: rev in (since, head], oldest first, at most `limit` rows. Every state is returned (soft-deleted rows carry `deletedAt`). */
export async function entityWindow(wsId: string, kind: EntityKind, since: number, head: number, limit: number): Promise<({ rev: number } & Record<string, unknown>)[]> {
  const d = ENTITIES[kind]; const where: SQL | undefined = and(eq(d.ws, wsId), gt(d.rev, since), lte(d.rev, head));
  return (await db.select(d.cols).from(d.table).where(where).orderBy(asc(d.rev)).limit(limit)) as ({ rev: number } & Record<string, unknown>)[];
}
