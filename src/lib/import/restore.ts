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
import { ImportError, tick, type ImportCtx } from "./pages";
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
/** `overwrite` = rows that already exist (same id) take the backup's version; otherwise they are left untouched and only missing rows are added. */
async function upsert(ctx: ImportCtx, table: any, rows: Row[], wsId: string, overwrite: boolean, conflict: any[] = [table.id]) {
  let written = 0;
  const cols = getTableColumns(table) as Record<string, any>;
  for (let i = 0; i < rows.length; i += 200) {
    const part = rows.slice(i, i + 200).map((r) => coerceRow(table, r, wsId));
    const set: Record<string, unknown> = {}; for (const k of Object.keys(cols)) if (!cols[k].generated && !conflict.includes(cols[k]) && part.some((r) => k in r)) set[k] = dsql.raw(`excluded."${dbName(cols[k])}"`);
    const q = db.insert(table).values(part as any);
    const res = (await (overwrite && Object.keys(set).length ? q.onConflictDoUpdate({ target: conflict, set }) : q.onConflictDoNothing()).returning({ k: conflict[0] })) as unknown[];
    written += res.length;
    await tick(ctx, undefined, part.length);
  }
  return { total: rows.length, written };
}
export const RESTORE_TABLES = ["pages", "pageVersions", "databases", "databaseProperties", "databaseRows", "databaseViews", "relations", "attachments", "tags", "pageTags", "tasks", "links", "knowledgeEdges", "references", "experiments"] as const;
export function checkBackupFormat(data: any): void {
  if (!data || typeof data !== "object" || typeof data.format !== "string" || !data.format.startsWith("note-spboucher-ai/")) throw new ImportError("Not a Note SPBoucher AI JSON backup (expected a top-level \"format\": \"note-spboucher-ai/1\").", 400, "bad_backup");
}
/**
 * Merge by id. ctx.duplicates = "skip" (default): rows whose id already exists are kept as they are, only missing rows are added;
 * "import": existing rows are overwritten with the backup's version. Nothing is ever deleted; re-running is safe in both modes.
 */
export async function restoreJson(ctx: ImportCtx, data: any) {
  checkBackupFormat(data);
  if (data.format !== JSON_FORMAT) ctx.stats.skipped.push(`format ${data.format} ≠ ${JSON_FORMAT} — best effort`);
  const ws = ctx.workspaceId; const overwrite = ctx.duplicates === "import";
  const counts: Record<string, number> = {}; const kept: Record<string, number> = {};
  const arr = (k: string): Row[] => (Array.isArray(data[k]) ? data[k] : []);
  ctx.total = RESTORE_TABLES.reduce((n, t) => n + arr(t).length, 0);
  const step = async (name: string, table: any, conflict?: any[]) => { const r = await upsert(ctx, table, arr(name), ws, overwrite, conflict); counts[name] = r.written; if (r.total - r.written > 0) kept[name] = r.total - r.written; await ctx.progress?.({ message: `Restored ${name}: ${r.written}${r.total - r.written ? ` (${r.total - r.written} already present, kept)` : ""}` }); };
  // pages first (parent/database ids are plain uuids, no FK), then everything that references them
  await step("pages", schema.pages);
  await step("pageVersions", schema.pageVersions);
  await step("databases", schema.databases);
  await step("databaseProperties", schema.databaseProperties);
  await step("databaseRows", schema.databaseRows);
  await step("databaseViews", schema.databaseViews);
  await step("relations", schema.relationsTable);
  await step("attachments", schema.attachments);
  await step("tags", schema.tags);
  await step("pageTags", schema.pageTags, [schema.pageTags.pageId, schema.pageTags.tagId]);
  await step("tasks", schema.tasks);
  await step("links", schema.links);
  await step("knowledgeEdges", schema.knowledgeEdges);
  await step("references", schema.researchReferences);
  await step("experiments", schema.experiments);
  let missingFiles = 0; for (const a of arr("attachments")) { try { if (!fs.existsSync(absPath(String(a.storagePath)))) missingFiles++; } catch { missingFiles++; } }
  if (missingFiles) ctx.stats.skipped.push(`${missingFiles} attachment file(s) missing on disk (restore data/uploads from the encrypted backup)`);
  const keptTotal = Object.values(kept).reduce((a, b) => a + b, 0);
  if (keptTotal) { ctx.stats.duplicates += keptTotal; ctx.stats.skipped.push(`${keptTotal} row(s) already present were kept unchanged (${Object.entries(kept).map(([k, v]) => `${k}: ${v}`).join(", ")})`); }
  ctx.stats.pages += counts.pages ?? 0; ctx.stats.databases += counts.databases ?? 0; ctx.stats.rows += counts.databaseRows ?? 0; ctx.stats.attachments += counts.attachments ?? 0; ctx.stats.references += counts.references ?? 0;
  // chunks/embeddings are rebuilt by the worker (content hashes that changed are re-indexed; unchanged pages are skipped)
  await enqueue(QUEUES.reindexAll, { workspaceId: ws });
  return { counts, kept, missingFiles };
}
