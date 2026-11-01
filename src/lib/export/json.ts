/** Full-fidelity JSON backup of a workspace (every content table). Restored by src/lib/import/restore.ts (merge by id). */
import { eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
export const JSON_FORMAT = "note-spboucher-ai/1";
const ALL = <T>(q: Promise<T[]>) => q;
export async function workspaceJson(wsId: string, opts: { versions?: boolean } = {}) {
  const [ws] = await db.select().from(schema.workspaces).where(eq(schema.workspaces.id, wsId)); if (!ws) throw new Error("Workspace not found");
  const pages = await ALL(db.select().from(schema.pages).where(eq(schema.pages.workspaceId, wsId)));
  const pageIds = pages.map((p) => p.id);
  const inPages = <C extends { pageId: any }>(t: any, col: C["pageId"]) => (pageIds.length ? db.select().from(t).where(inArray(col, pageIds)) : Promise.resolve([] as any[]));
  const databases = await db.select().from(schema.databases).where(eq(schema.databases.workspaceId, wsId));
  const dbIds = databases.map((d) => d.id);
  const byDb = (t: any, col: any) => (dbIds.length ? db.select().from(t).where(inArray(col, dbIds)) : Promise.resolve([] as any[]));
  const databaseProperties = await byDb(schema.databaseProperties, schema.databaseProperties.databaseId);
  const databaseRows = await byDb(schema.databaseRows, schema.databaseRows.databaseId);
  const databaseViews = await byDb(schema.databaseViews, schema.databaseViews.databaseId);
  const propIds = (databaseProperties as any[]).map((p) => p.id);
  const relations = propIds.length ? await db.select().from(schema.relationsTable).where(inArray(schema.relationsTable.propertyId, propIds)) : [];
  const out = {
    format: JSON_FORMAT, exportedAt: new Date().toISOString(), app: "Note SPBoucher AI",
    workspace: { id: ws.id, name: ws.name, slug: ws.slug, settings: ws.settings, createdAt: ws.createdAt, updatedAt: ws.updatedAt },
    counts: {} as Record<string, number>,
    pages: pages.map(({ tsv: _t, ...p }: any) => p),
    pageVersions: opts.versions === false ? [] : await inPages(schema.pageVersions, schema.pageVersions.pageId),
    databases, databaseProperties, databaseRows, databaseViews, relations,
    attachments: await db.select().from(schema.attachments).where(eq(schema.attachments.workspaceId, wsId)),
    tags: await db.select().from(schema.tags).where(eq(schema.tags.workspaceId, wsId)),
    pageTags: await inPages(schema.pageTags, schema.pageTags.pageId),
    tasks: await db.select().from(schema.tasks).where(eq(schema.tasks.workspaceId, wsId)),
    links: await inPages(schema.links, schema.links.fromPageId),
    knowledgeEdges: await db.select().from(schema.knowledgeEdges).where(eq(schema.knowledgeEdges.workspaceId, wsId)),
    references: await db.select().from(schema.researchReferences).where(eq(schema.researchReferences.workspaceId, wsId)),
    experiments: await db.select().from(schema.experiments).where(eq(schema.experiments.workspaceId, wsId)),
  };
  for (const [k, v] of Object.entries(out)) if (Array.isArray(v)) out.counts[k] = v.length;
  return out;
}
export type WorkspaceJson = Awaited<ReturnType<typeof workspaceJson>>;
