/** Shared set-up of the 3.0 suites: the scratch workspace, a registry of what a test created, and one clean-up that removes all of it. */
import "./testdb";
import assert from "node:assert/strict";
import { and, eq, gte, inArray, like } from "drizzle-orm";
import { db, schema, sql } from "../../src/db/index";
import { createPage } from "../../src/lib/pages/service";
import type { PMNode } from "../../src/lib/editor/text";

/** Start of this test process (minus a margin for clock rounding): what the clean-up may remove from shared tables. */
export const STARTED = new Date(Date.now() - 2000);
export const made = { pages: [] as string[], tasks: [] as string[], concepts: [] as string[], references: [] as string[], attachments: [] as string[], tags: [] as string[] };
export async function workspace(): Promise<string> { const [w] = await db.select().from(schema.workspaces).limit(1); assert.ok(w, "workspace missing: run `pnpm run bootstrap` on the scratch database"); return w.id; }
export const doc = (...blocks: (string | PMNode)[]): PMNode => ({ type: "doc", content: blocks.map((b) => (typeof b === "string" ? { type: "paragraph", content: [{ type: "text", text: b }] } : b)) });
export const para = (text: string, id?: string): PMNode => ({ type: "paragraph", ...(id ? { attrs: { id } } : {}), content: [{ type: "text", text }] });
export async function mk(ws: string, title: string, content?: PMNode, extra: Partial<Parameters<typeof createPage>[1]> = {}) { const p = await createPage(ws, { title, content, ...extra }); made.pages.push(p.id); return p; }
export const status = async (p: Promise<unknown>) => { try { await p; return 200; } catch (e: any) { return e.status ?? 500; } };
export const code = async (p: Promise<unknown>) => { try { await p; return "ok"; } catch (e: any) { return e.code ?? `status-${e.status ?? 500}`; } };
export const eventsOf = async (pageId: string) => (await db.select().from(schema.knowledgeEvents).where(eq(schema.knowledgeEvents.pageId, pageId))).sort((a, b) => a.at.getTime() - b.at.getTime());
export const kinds = async (pageId: string) => (await eventsOf(pageId)).map((e) => e.kind);
export async function cleanup(ws: string, prefix: string) {
  const mine = await db.select({ id: schema.pages.id }).from(schema.pages).where(and(eq(schema.pages.workspaceId, ws), like(schema.pages.title, `${prefix}%`)));
  const ids = [...new Set([...made.pages, ...mine.map((m) => m.id)])];
  if (made.tasks.length) await db.delete(schema.tasks).where(inArray(schema.tasks.id, made.tasks));
  if (ids.length) {
    await db.delete(schema.tasks).where(inArray(schema.tasks.pageId, ids));
    await db.delete(schema.knowledgeEdges).where(inArray(schema.knowledgeEdges.fromId, ids)); await db.delete(schema.knowledgeEdges).where(inArray(schema.knowledgeEdges.toId, ids));
    await db.delete(schema.attachments).where(inArray(schema.attachments.pageId, ids));
    await db.delete(schema.pages).where(inArray(schema.pages.id, ids));
    await db.delete(schema.knowledgeEvents).where(inArray(schema.knowledgeEvents.pageId, ids));
    await db.delete(schema.syncTombstones).where(inArray(schema.syncTombstones.id, ids));
  }
  if (made.attachments.length) await db.delete(schema.attachments).where(inArray(schema.attachments.id, made.attachments));
  if (made.references.length) { await db.delete(schema.knowledgeEdges).where(inArray(schema.knowledgeEdges.toId, made.references)); await db.delete(schema.researchReferences).where(inArray(schema.researchReferences.id, made.references)); }
  if (made.concepts.length) await db.delete(schema.concepts).where(inArray(schema.concepts.id, made.concepts));
  await db.delete(schema.concepts).where(and(eq(schema.concepts.workspaceId, ws), like(schema.concepts.name, `${prefix}%`)));
  await db.delete(schema.knowledgeInsights).where(and(eq(schema.knowledgeInsights.workspaceId, ws), like(schema.knowledgeInsights.title, `${prefix}%`)));
  if (made.tags.length) await db.delete(schema.tags).where(and(eq(schema.tags.workspaceId, ws), inArray(schema.tags.name, made.tags)));
  await db.delete(schema.knowledgeEvents).where(and(eq(schema.knowledgeEvents.workspaceId, ws), like(schema.knowledgeEvents.summary, `${prefix}%`)));
  // only the tombstones written since this process started (other clients of the scratch instance keep theirs)
  await db.delete(schema.syncTombstones).where(and(inArray(schema.syncTombstones.kind, ["task", "edge", "concept", "reference", "canvas", "database", "database_property", "database_view", "database_row", "attachment"]), gte(schema.syncTombstones.deletedAt, STARTED)));
  await sql.end();
}
