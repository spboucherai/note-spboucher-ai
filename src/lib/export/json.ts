/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/lib/export/json.ts
 * Module           : lib
 * Repository       : https://git.spboucher.ai/note-spboucher-ai
 * Project Website  : https://note.spboucher.ai
 * Created          : 2026-11-01
 * Last Modified    : 2026-11-17
 *
 * Author           : Simon-Pierre Boucher
 * Position         : Professor of Finance
 * Institution      : Université du Québec en Outaouais (UQO)
 * Organization     : SP Boucher
 * Website          : https://spboucher.ai
 * Git              : https://git.spboucher.ai
 *
 * Preferred Contact: contact@spboucher.ai
 * Development      : dev@spboucher.ai
 * Support          : support@spboucher.ai
 * Security/Admin   : admin@spboucher.ai
 *
 * Copyright (c) 2026
 * Simon-Pierre Boucher
 * All rights reserved where applicable. This file is governed by the
 * applicable project license, copyright notices and relevant law.
 * Existing third-party rights and notices remain unaffected.
 *
 * License          : None specified (no license file in this repository)
 *
 * Do not embed credentials, private keys, access tokens,
 * certificates or confidential personal information.
 *
 * =============================================================================
 * END OF SP BOUCHER SOURCE HEADER
 * =============================================================================
 */

/** Full-fidelity JSON backup of a workspace (every content table). Restored by src/lib/import/restore.ts (merge by id). */
import fs from "node:fs";
import { eq, inArray } from "drizzle-orm";
import { absPath } from "@/lib/files/storage";
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
  // explicit report: what is in the file, what is not (by design) and what is missing on this server right now
  const live = out.attachments.filter((a) => !a.deletedAt); const missing: { id: string; filename: string; pageId: string | null; size: number }[] = []; let bytes = 0;
  for (const a of live) { let ok = false; try { ok = fs.existsSync(absPath(a.storagePath)); } catch { ok = false; } if (ok) bytes += a.size; else missing.push({ id: a.id, filename: a.filename, pageId: a.pageId, size: a.size }); }
  const report = {
    format: "note-spboucher-ai/export-report/1", kind: "json-backup", exportedAt: out.exportedAt, counts: { ...out.counts, livePages: pages.filter((p) => !p.deletedAt).length, trashedPages: pages.filter((p) => p.deletedAt).length },
    complete: missing.length === 0,
    notIncluded: [
      { what: "attachment files", count: live.length, bytes, reason: "a JSON backup holds the attachment rows only; the files live in data/uploads and are covered by the encrypted backup (scripts/backup.sh) or by the workspace ZIP" },
      ...(opts.versions === false ? [{ what: "page versions", reason: "excluded on request (versions=0)" }] : []),
      { what: "search chunks and embeddings", reason: "rebuilt by the worker after a restore" },
      { what: "AI conversations, usage records, audit log, sessions and passkeys", reason: "not workspace content" },
    ],
    missingAttachmentFiles: { count: missing.length, listed: missing.slice(0, 500), note: missing.length ? "these attachment rows point to files that are not on this server: restoring this backup elsewhere cannot bring them back" : undefined },
  };
  return { ...out, report };
}
export type WorkspaceJson = Awaited<ReturnType<typeof workspaceJson>>;
