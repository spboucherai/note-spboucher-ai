/**
 * File: src/lib/databases/rows.ts
 * Description: Databases Next Generation — row operations beyond the 2.x single-row CRUD: move one row between two others (fractional
 *   position, no full reorder), duplicate rows (values, relations, page body), bulk actions on a list of ids or on "every row of a
 *   query" (edit values, delete, duplicate) with a server-side undo / redo journal (`database_row_ops`), and row templates.
 * Author: Simon-Pierre Boucher · contact@spboucher.ai
 */
import { and, asc, desc, eq, inArray, isNull, lt, sql as dsql } from "drizzle-orm";
import { db, schema } from "@/db";
import { HttpError } from "@/lib/errors";
import { createPage, softDeletePage, restorePage } from "@/lib/pages/service";
import { enqueue, QUEUES } from "@/lib/jobs";
import type { FilterGroup, Property, RowOut, RowTemplate, Sort } from "./types";
import { COMPUTED_TYPES, isPending, isError } from "./types";
import { loadProps } from "./query";
import { queryIds } from "./engine";
import { ensureDatabase, getDatabase, getRows, type DbRow } from "./service";

const R = schema.databaseRows; const P = schema.pages; const OPS = schema.databaseRowOps; const T = schema.databaseRowTemplates;
export const BULK_MAX = { update: 50_000, delete: 5_000, duplicate: 200 } as const;
const chunk = <X>(a: X[], n: number): X[][] => { const out: X[][] = []; for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n)); return out; };
const uuids = (a: string[]) => dsql`${`{${a.join(",")}}`}::uuid[]`;
const texts = (a: string[]) => dsql`${`{${a.map((s) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`).join(",")}}`}::text[]`;

// ---------- move (audit D7: the 2.x reorder rewrote position = 1..n for the ids it received and collided with every row it did not receive)
async function normalize(dbId: string) { await db.execute(dsql`update database_rows r set position = x.rn from (select id, row_number() over (order by position, created_at, id) as rn from database_rows where database_id = ${dbId}::uuid and deleted_at is null) x where r.id = x.id and r.position is distinct from x.rn`); }
const live = (dbId: string) => and(eq(R.databaseId, dbId), isNull(R.deletedAt));
async function slot(dbId: string, anchorId: string, side: "after" | "before"): Promise<number | null> {
  const [a] = await db.select({ position: R.position }).from(R).where(and(eq(R.id, anchorId), live(dbId))); if (!a) throw new HttpError(404, "Anchor row not found", "not_found");
  const anchor = dsql`(select position, created_at from database_rows where id = ${anchorId}::uuid)`; // compared in SQL: created_at keeps its microseconds
  const [n] = side === "after"
    ? await db.select({ position: R.position }).from(R).where(and(live(dbId), dsql`(${R.position}, ${R.createdAt}) > ${anchor}`)).orderBy(asc(R.position), asc(R.createdAt)).limit(1)
    : await db.select({ position: R.position }).from(R).where(and(live(dbId), dsql`(${R.position}, ${R.createdAt}) < ${anchor}`)).orderBy(desc(R.position), desc(R.createdAt)).limit(1);
  if (!n) return side === "after" ? a.position + 1 : a.position - 1;
  const mid = (a.position + n.position) / 2; const lo = Math.min(a.position, n.position), hi = Math.max(a.position, n.position);
  return mid > lo && mid < hi ? mid : null; // no room left between the two (equal positions, or float precision exhausted)
}
/** Place one row right after / before another row of the same database. Only that row is written (the others keep their position). */
export async function moveRow(wsId: string, dbId: string, id: string, to: { after?: string | null; before?: string | null }): Promise<{ id: string; position: number }> {
  const d = await ensureDatabase(wsId, dbId); const anchor = to.after ?? to.before; const side = to.after ? "after" : "before";
  if (!anchor) throw new HttpError(400, "move needs `after` or `before`", "bad_request"); if (anchor === id) throw new HttpError(400, "A row cannot be moved next to itself", "bad_request");
  const [row] = await db.select({ id: R.id }).from(R).where(and(eq(R.id, id), live(d.id))); if (!row) throw new HttpError(404, "Row not found", "not_found");
  let pos = await slot(d.id, anchor, side); if (pos == null) { await normalize(d.id); pos = await slot(d.id, anchor, side); }
  if (pos == null) throw new HttpError(409, "Could not place the row", "conflict");
  await db.update(R).set({ position: pos }).where(eq(R.id, id));
  return { id, position: pos };
}

// ---------- duplicate
const cleanValues = (props: Property[], values: Record<string, unknown>) => { const out: Record<string, unknown> = {}; for (const [k, v] of Object.entries(values)) { const p = props.find((x) => x.id === k); if (!p || COMPUTED_TYPES.has(p.type) || isPending(v) || isError(v)) continue; out[k] = v; } return out; };
/** Copies rows (stored values, forward relations, page body, icon, cover). Each copy is placed right after its source. */
export async function duplicateRows(wsId: string, dbId: string, ids: string[]): Promise<RowOut[]> {
  const d = await ensureDatabase(wsId, dbId); if (!ids.length) return []; if (ids.length > BULK_MAX.duplicate) throw new HttpError(400, `Duplicate at most ${BULK_MAX.duplicate} rows at a time`, "too_many");
  const props = await loadProps(d.id); const tp = props.find((p) => p.type === "title");
  const src = await db.select({ id: R.id, values: R.values, pageId: R.pageId, title: P.title, icon: P.icon, cover: P.cover, content: P.content }).from(R).innerJoin(P, eq(P.id, R.pageId)).where(and(live(d.id), inArray(R.id, ids), isNull(P.deletedAt)));
  const byId = new Map(src.map((s) => [s.id, s])); const fwd = props.filter((p) => p.type === "relation" && !p.config.syncedPropertyId).map((p) => p.id); const out: string[] = [];
  for (const id of ids) {
    const s = byId.get(id); if (!s) continue;
    const title = s.title === "Untitled" || !s.title ? "" : `${s.title} (copy)`; const values = cleanValues(props, s.values); if (tp) values[tp.id] = title;
    const page = await createPage(wsId, { title, parentId: d.pageId, section: "databases", type: "page", databaseId: d.id, content: s.content as any, icon: s.icon });
    if (s.cover) await db.update(P).set({ cover: s.cover }).where(eq(P.id, page.id));
    const [row] = await db.insert(R).values({ databaseId: d.id, pageId: page.id, values, position: 0 }).returning({ id: R.id });
    if (fwd.length) { const rels = await db.select().from(schema.relationsTable).where(and(inArray(schema.relationsTable.propertyId, fwd), eq(schema.relationsTable.fromRowId, id))); if (rels.length) await db.insert(schema.relationsTable).values(rels.map((x) => ({ propertyId: x.propertyId, fromRowId: row.id, toRowId: x.toRowId }))).onConflictDoNothing(); }
    await moveRow(wsId, d.id, row.id, { after: id }); out.push(row.id);
  }
  const rows = await getRows(d, props, out); const order = new Map(out.map((x, i) => [x, i]));
  return rows.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
}

// ---------- bulk actions + undo journal
export interface BulkSelection { ids?: string[]; all?: { viewId?: string; filter?: FilterGroup | null; extraFilter?: FilterGroup | null; search?: string; except?: string[] } }
async function resolveSelection(d: DbRow, props: Property[], sel: BulkSelection, cap: number): Promise<string[]> {
  let ids: string[];
  if (sel.all) {
    const full = await getDatabase(d.workspaceId, d.id); const v = full.views.find((x) => x.id === sel.all!.viewId);
    ids = await queryIds(d.id, props, { filter: sel.all.filter === undefined ? ((v?.config.filter as FilterGroup | null | undefined) ?? null) : sel.all.filter, extraFilter: sel.all.extraFilter ?? null, sorts: (v?.config.sorts as Sort[] | undefined) ?? [], search: sel.all.search }, cap + 1);
    if (sel.all.except?.length) { const ex = new Set(sel.all.except); ids = ids.filter((x) => !ex.has(x)); }
  } else {
    const want = [...new Set(sel.ids ?? [])]; if (!want.length) return [];
    const found = new Set<string>(); for (const c of chunk(want, 5000)) for (const r of await db.select({ id: R.id }).from(R).where(and(live(d.id), inArray(R.id, c)))) found.add(r.id);
    ids = want.filter((x) => found.has(x));
  }
  if (ids.length > cap) throw new HttpError(400, `This action handles at most ${cap.toLocaleString("en-CA")} rows at a time . Narrow the selection with a filter.`, "too_many");
  return ids;
}
async function recordOp(d: DbRow, kind: string, data: Record<string, unknown>, rowCount: number): Promise<string> {
  await db.delete(OPS).where(and(eq(OPS.databaseId, d.id), lt(OPS.createdAt, new Date(Date.now() - 7 * 864e5))));
  const [op] = await db.insert(OPS).values({ workspaceId: d.workspaceId, databaseId: d.id, kind, data, rowCount }).returning({ id: OPS.id }); return op.id;
}
/** Soft-delete rows and their pages. Up to 100 rows: page by page (journal events, sub-pages). Beyond: one statement per table (no per-page journal event). */
async function trashRows(wsId: string, d: DbRow, ids: string[]): Promise<{ at: string | null }> {
  if (!ids.length) return { at: null };
  const rows: { id: string; pageId: string }[] = []; for (const c of chunk(ids, 5000)) rows.push(...(await db.select({ id: R.id, pageId: R.pageId }).from(R).where(and(eq(R.databaseId, d.id), inArray(R.id, c)))));
  const at = new Date();
  for (const c of chunk(rows.map((r) => r.id), 5000)) await db.update(R).set({ deletedAt: at }).where(inArray(R.id, c));
  if (rows.length <= 100) { for (const r of rows) await softDeletePage(wsId, r.pageId).catch(() => {}); return { at: null }; }
  for (const c of chunk(rows.map((r) => r.pageId), 5000)) {
    const done = await db.execute(dsql`with recursive t as (select id from pages where id = any(${uuids(c)}) and workspace_id = ${wsId}::uuid union all select p.id from pages p join t on p.parent_id = t.id where p.deleted_at is null) update pages set deleted_at = ${at.toISOString()}::timestamptz where id in (select id from t) and deleted_at is null returning id`);
    const pids = (done as unknown as { id: string }[]).map((x) => x.id); for (const k of chunk(pids, 5000)) await db.delete(schema.chunks).where(and(eq(schema.chunks.sourceType, "page"), inArray(schema.chunks.sourceId, k)));
  }
  return { at: at.toISOString() };
}
async function untrashRows(wsId: string, d: DbRow, ids: string[], at: string | null): Promise<number> {
  const rows: { id: string; pageId: string }[] = []; for (const c of chunk(ids, 5000)) rows.push(...(await db.select({ id: R.id, pageId: R.pageId }).from(R).where(and(eq(R.databaseId, d.id), inArray(R.id, c), dsql`${R.deletedAt} is not null`))));
  for (const c of chunk(rows.map((r) => r.id), 5000)) await db.update(R).set({ deletedAt: null }).where(inArray(R.id, c));
  if (!at) { for (const r of rows) await restorePage(wsId, r.pageId); return rows.length; }
  // batch path: every page trashed by that action carries the same deleted_at
  const done = await db.execute(dsql`update pages set deleted_at = null where workspace_id = ${wsId}::uuid and deleted_at = ${at}::timestamptz returning id`);
  for (const x of done as unknown as { id: string }[]) await enqueue(QUEUES.index, { sourceType: "page", sourceId: x.id, workspaceId: wsId });
  return rows.length;
}
const BULK_EDITABLE = new Set(["text", "number", "date", "checkbox", "status", "select", "multi_select", "url"]);
async function applyValues(ids: string[], stored: Record<string, unknown>, drop: string[]) {
  for (const c of chunk(ids, 5000)) {
    await db.execute(dsql`update database_rows set "values" = ("values" - ${texts(drop)}) || ${JSON.stringify(stored)}::jsonb, updated_at = now() where id = any(${uuids(c)})`);
    await db.execute(dsql`update pages set updated_at = now() where id in (select page_id from database_rows where id = any(${uuids(c)}))`);
  }
}
export interface BulkResult { ok: true; action: string; affected: number; opId: string | null; rows?: RowOut[] }
/**
 * One action on many rows. `update`: sets / clears stored values (text, number, date, checkbox, status, select, multi-select, URL) in
 * one statement per 5 000 rows. `delete`: moves rows to the trash. `duplicate`: copies rows. Each call writes one undo-journal entry.
 */
export async function bulkRows(wsId: string, dbId: string, sel: BulkSelection, action: { type: "update"; values: Record<string, unknown> } | { type: "delete" } | { type: "duplicate" }): Promise<BulkResult> {
  const d = await ensureDatabase(wsId, dbId); const props = await loadProps(d.id);
  const ids = await resolveSelection(d, props, sel, BULK_MAX[action.type]);
  if (!ids.length) return { ok: true, action: action.type, affected: 0, opId: null };
  if (action.type === "delete") { const { at } = await trashRows(wsId, d, ids); return { ok: true, action: "delete", affected: ids.length, opId: await recordOp(d, "delete", { ids, at }, ids.length) }; }
  if (action.type === "duplicate") { const rows = await duplicateRows(wsId, d.id, ids); return { ok: true, action: "duplicate", affected: rows.length, opId: await recordOp(d, "duplicate", { ids: rows.map((r) => r.id), at: null }, rows.length), rows }; }
  const stored: Record<string, unknown> = {}; const drop: string[] = [];
  for (const [k, v] of Object.entries(action.values)) {
    const p = props.find((x) => x.id === k || x.name === k); if (!p) throw new HttpError(400, `Unknown property "${k}"`, "bad_request");
    if (!BULK_EDITABLE.has(p.type)) throw new HttpError(400, `"${p.name}" (${p.type}) cannot be edited in bulk`, "bad_request");
    if (v == null || v === "" || (Array.isArray(v) && !v.length)) drop.push(p.id); else stored[p.id] = v;
  }
  const keys = [...Object.keys(stored), ...drop]; if (!keys.length) throw new HttpError(400, "No value to set", "bad_request");
  const before: Record<string, Record<string, unknown>> = {};
  for (const c of chunk(ids, 5000)) for (const r of await db.select({ id: R.id, values: R.values }).from(R).where(inArray(R.id, c))) { const b: Record<string, unknown> = {}; for (const k of keys) if (r.values[k] !== undefined) b[k] = r.values[k]; before[r.id] = b; }
  await applyValues(ids, stored, drop);
  return { ok: true, action: "update", affected: ids.length, opId: await recordOp(d, "update", { ids, keys, before, stored, drop }, ids.length) };
}
/** Revert (or re-apply, `redo`) a journaled bulk action. Idempotent per direction: undoing twice is refused with 409. */
export async function undoOp(wsId: string, dbId: string, opId: string, redo = false): Promise<{ ok: true; kind: string; affected: number; undone: boolean }> {
  const d = await ensureDatabase(wsId, dbId);
  const [op] = await db.select().from(OPS).where(and(eq(OPS.id, opId), eq(OPS.databaseId, d.id))); if (!op) throw new HttpError(404, "This action can no longer be undone", "not_found");
  if (redo ? !op.undoneAt : !!op.undoneAt) throw new HttpError(409, redo ? "This action is not undone" : "This action is already undone", "conflict");
  const data = op.data as { ids: string[]; at?: string | null; keys?: string[]; before?: Record<string, Record<string, unknown>>; stored?: Record<string, unknown>; drop?: string[] };
  if (op.kind === "update") {
    if (redo) await applyValues(data.ids, data.stored ?? {}, data.drop ?? []);
    else for (const c of chunk(data.ids, 5000)) {
      const part: Record<string, unknown> = {}; for (const id of c) part[id] = data.before?.[id] ?? {};
      await db.execute(dsql`update database_rows r set "values" = (r."values" - ${texts(data.keys ?? [])}) || x.b, updated_at = now() from jsonb_each(${JSON.stringify(part)}::jsonb) as x(id, b) where r.id = x.id::uuid`);
      await db.execute(dsql`update pages set updated_at = now() where id in (select page_id from database_rows where id = any(${uuids(c)}))`);
    }
  } else if (op.kind === "delete" || op.kind === "duplicate") {
    // delete: undo = restore, redo = trash again · duplicate: undo = trash the copies, redo = restore them
    const restore = (op.kind === "delete") !== redo;
    if (restore) await untrashRows(wsId, d, data.ids, data.at ?? null);
    else { const { at } = await trashRows(wsId, d, data.ids); await db.update(OPS).set({ data: { ...data, at } }).where(eq(OPS.id, op.id)); }
  } else throw new HttpError(400, "Unknown action kind", "bad_request");
  await db.update(OPS).set({ undoneAt: redo ? null : new Date() }).where(eq(OPS.id, op.id));
  return { ok: true, kind: op.kind, affected: op.rowCount, undone: !redo };
}

// ---------- row templates
const tplOut = (t: typeof T.$inferSelect): RowTemplate => ({ id: t.id, databaseId: t.databaseId, name: t.name, icon: t.icon, values: t.values, content: t.content ?? null, position: t.position, isDefault: t.isDefault, createdAt: t.createdAt.toISOString(), updatedAt: t.updatedAt.toISOString() });
export async function listRowTemplates(wsId: string, dbId: string): Promise<RowTemplate[]> { const d = await ensureDatabase(wsId, dbId); return (await db.select().from(T).where(eq(T.databaseId, d.id)).orderBy(T.position, T.createdAt)).map(tplOut); }
/** Values a template may hold: stored values and relation targets, keyed by property id (title, computed and AI cells are left out). */
function templateValues(props: Property[], values: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(values ?? {})) { const p = props.find((x) => x.id === k || x.name === k); if (!p || p.type === "title" || p.type === "ai" || COMPUTED_TYPES.has(p.type) || v == null || v === "" || isPending(v) || isError(v)) continue; out[p.id] = p.type === "relation" && Array.isArray(v) ? v.map((x: any) => (typeof x === "string" ? x : x?.rowId)).filter(Boolean) : v; }
  return out;
}
export async function createRowTemplate(wsId: string, dbId: string, input: { id?: string; name: string; icon?: string | null; values?: Record<string, unknown>; content?: unknown; fromRowId?: string; isDefault?: boolean }): Promise<RowTemplate> {
  const d = await ensureDatabase(wsId, dbId); const props = await loadProps(d.id);
  if (input.id) { const [old] = await db.select().from(T).where(eq(T.id, input.id)); if (old) { if (old.databaseId !== d.id) throw new HttpError(409, "This id is already in use", "id_taken"); return tplOut(old); } }
  let values = input.values ?? {}; let content = input.content ?? null; let icon = input.icon ?? null;
  if (input.fromRowId) {
    const [row] = await getRows(d, props, [input.fromRowId]); if (!row) throw new HttpError(404, "Row not found", "not_found");
    const [page] = await db.select({ content: P.content, icon: P.icon }).from(P).where(eq(P.id, row.pageId));
    values = { ...row.values, ...values }; content = input.content ?? page?.content ?? null; icon = input.icon ?? page?.icon ?? null;
  }
  const [{ max }] = await db.select({ max: dsql<number>`coalesce(max(position),0)` }).from(T).where(eq(T.databaseId, d.id));
  if (input.isDefault) await db.update(T).set({ isDefault: false }).where(eq(T.databaseId, d.id));
  const [t] = await db.insert(T).values({ ...(input.id ? { id: input.id } : {}), workspaceId: wsId, databaseId: d.id, name: input.name.trim() || "Template", icon, values: templateValues(props, values), content, position: Number(max) + 1, isDefault: !!input.isDefault }).returning();
  return tplOut(t);
}
export async function updateRowTemplate(wsId: string, dbId: string, id: string, patch: Partial<{ name: string; icon: string | null; values: Record<string, unknown>; content: unknown; isDefault: boolean; position: number }>): Promise<RowTemplate> {
  const d = await ensureDatabase(wsId, dbId); const [prev] = await db.select().from(T).where(and(eq(T.id, id), eq(T.databaseId, d.id))); if (!prev) throw new HttpError(404, "Template not found", "not_found");
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.name !== undefined) set.name = patch.name.trim() || prev.name; if (patch.icon !== undefined) set.icon = patch.icon; if (patch.content !== undefined) set.content = patch.content; if (patch.position !== undefined) set.position = patch.position;
  if (patch.values !== undefined) set.values = templateValues(await loadProps(d.id), patch.values);
  if (patch.isDefault !== undefined) { if (patch.isDefault) await db.update(T).set({ isDefault: false }).where(eq(T.databaseId, d.id)); set.isDefault = patch.isDefault; }
  const [t] = await db.update(T).set(set).where(eq(T.id, id)).returning(); return tplOut(t);
}
export async function deleteRowTemplate(wsId: string, dbId: string, id: string) { const d = await ensureDatabase(wsId, dbId); const r = await db.delete(T).where(and(eq(T.id, id), eq(T.databaseId, d.id))).returning({ id: T.id }); if (!r.length) throw new HttpError(404, "Template not found", "not_found"); }
