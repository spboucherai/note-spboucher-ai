/**
 * JSON backup (format note-spboucher-ai/1) → idempotent merge by id into the target workspace.
 * Rows are upserted (`insert … on conflict (id) do update`), so re-running a restore is safe; nothing is deleted.
 * Attachment *files* are not part of the JSON (they live in data/uploads, covered by scripts/backup.sh); rows whose file is missing are counted.
 */
import fs from "node:fs";
import { getTableColumns, sql as dsql } from "drizzle-orm";
import { db, schema } from "@/db";
import { absPath } from "@/lib/files/storage";
import { enqueue, QUEUES } from "@/lib/jobs";
import { ImportError, type ImportCtx } from "./pages";
import { JSON_FORMAT } from "@/lib/export/json";

type Row = Record<string, unknown>;
/** db uses `casing: "snake_case"`: columns declared without an explicit name keep their camelCase key in metadata. */
const dbName = (c: any) => String(c.name).replace(/[A-Z]/g, (m) => "_" + m.toLowerCase());
/** Coerce an exported row to driver-ready values using the table's column metadata (dates ← ISO strings, generated columns dropped). */
function coerceRow(table: any, row: Row, wsId: string): Row {
  const cols = getTableColumns(table) as Record<string, any>; const out: Row = {};
  for (const [k, c] of Object.entries(cols)) {
    if (c.generated) continue; if (!(k in row)) continue;
    let v = row[k];
    if (c.dataType === "date") v = v == null ? null : new Date(String(v));
    if (k === "workspaceId") v = wsId;
    out[k] = v;
  }
  return out;
}
async function upsert(table: any, rows: Row[], wsId: string, conflict: any[] = [table.id]) {
  if (!rows.length) return 0; let n = 0;
  const cols = getTableColumns(table) as Record<string, any>;
  for (let i = 0; i < rows.length; i += 200) {
    const part = rows.slice(i, i + 200).map((r) => coerceRow(table, r, wsId));
    const set: Record<string, unknown> = {}; for (const k of Object.keys(cols)) if (!cols[k].generated && !conflict.includes(cols[k]) && part.some((r) => k in r)) set[k] = dsql.raw(`excluded."${dbName(cols[k])}"`);
    if (Object.keys(set).length) await db.insert(table).values(part as any).onConflictDoUpdate({ target: conflict, set }); else await db.insert(table).values(part as any).onConflictDoNothing();
    n += part.length;
  }
  return n;
}
export async function restoreJson(ctx: ImportCtx, data: any) {
  if (!data || typeof data !== "object" || typeof data.format !== "string" || !data.format.startsWith("note-spboucher-ai/")) throw new ImportError("Not a Note SPBoucher AI JSON backup (expected format note-spboucher-ai/1)");
  if (data.format !== JSON_FORMAT) ctx.stats.skipped.push(`format ${data.format} ≠ ${JSON_FORMAT} — best effort`);
  const ws = ctx.workspaceId; const counts: Record<string, number> = {};
  const step = async (name: string, fn: () => Promise<number>) => { counts[name] = await fn(); await ctx.progress?.({ message: `Restored ${name}: ${counts[name]}` }); };
  const arr = (k: string): Row[] => (Array.isArray(data[k]) ? data[k] : []);
  // pages first (parent/database ids are plain uuids, no FK), then everything that references them
  await step("pages", () => upsert(schema.pages, arr("pages"), ws));
  await step("pageVersions", () => upsert(schema.pageVersions, arr("pageVersions"), ws));
  await step("databases", () => upsert(schema.databases, arr("databases"), ws));
  await step("databaseProperties", () => upsert(schema.databaseProperties, arr("databaseProperties"), ws));
  await step("databaseRows", () => upsert(schema.databaseRows, arr("databaseRows"), ws));
  await step("databaseViews", () => upsert(schema.databaseViews, arr("databaseViews"), ws));
  await step("relations", () => upsert(schema.relationsTable, arr("relations"), ws));
  await step("attachments", () => upsert(schema.attachments, arr("attachments"), ws));
  await step("tags", () => upsert(schema.tags, arr("tags"), ws));
  await step("pageTags", () => upsert(schema.pageTags, arr("pageTags"), ws, [schema.pageTags.pageId, schema.pageTags.tagId]));
  await step("tasks", () => upsert(schema.tasks, arr("tasks"), ws));
  await step("links", () => upsert(schema.links, arr("links"), ws));
  await step("knowledgeEdges", () => upsert(schema.knowledgeEdges, arr("knowledgeEdges"), ws));
  await step("references", () => upsert(schema.researchReferences, arr("references"), ws));
  await step("experiments", () => upsert(schema.experiments, arr("experiments"), ws));
  let missingFiles = 0; for (const a of arr("attachments")) { try { if (!fs.existsSync(absPath(String(a.storagePath)))) missingFiles++; } catch { missingFiles++; } }
  if (missingFiles) ctx.stats.skipped.push(`${missingFiles} attachment file(s) missing on disk (restore data/uploads from the encrypted backup)`);
  ctx.stats.pages += counts.pages ?? 0; ctx.stats.databases += counts.databases ?? 0; ctx.stats.rows += counts.databaseRows ?? 0; ctx.stats.attachments += counts.attachments ?? 0; ctx.stats.references += counts.references ?? 0;
  // chunks/embeddings are rebuilt by the worker (content hashes that changed are re-indexed; unchanged pages are skipped)
  await enqueue(QUEUES.reindexAll, { workspaceId: ws });
  return { counts, missingFiles };
}
