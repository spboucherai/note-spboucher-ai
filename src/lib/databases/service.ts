import { and, eq, inArray, isNull, or, sql as dsql } from "drizzle-orm";
import { db, schema } from "@/db";
import { HttpError } from "@/lib/errors";
import { createPage, softDeletePage } from "@/lib/pages/service";
import { enqueue, QUEUES } from "@/lib/jobs";
import type { Database, Property, PropertyType, PropertyConfig, View, ViewType, ViewConfig, RowOut, SelectOption, RelationRef } from "./types";
import { PROPERTY_TYPES, COMPUTED_TYPES, VIEW_TYPES, AGGREGATES, isGroup } from "./types";
import type { FilterGroup, FilterNode, Sort } from "./types";
import { hydrate, loadProps, loadRaw } from "./query";
import { queryRows, validateFilter, validateSorts, collectRules } from "./engine";
import { formulaCycle } from "./formula";
import { displayValue, ensureOption, newId, numberOf, titleProp, isEmpty } from "./values";

export type DbRow = typeof schema.databases.$inferSelect;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const DEFAULT_STATUS: SelectOption[] = [{ id: "todo", name: "Not started", color: "gray", group: "todo" }, { id: "doing", name: "In progress", color: "blue", group: "in_progress" }, { id: "done", name: "Done", color: "green", group: "done" }];

/** Find a database by its id OR its host page id; create it lazily for a page of type "database". */
export async function ensureDatabase(wsId: string, id: string): Promise<DbRow> {
  if (!UUID.test(id)) throw new HttpError(400, "Invalid id");
  const [d] = await db.select().from(schema.databases).where(and(eq(schema.databases.workspaceId, wsId), or(eq(schema.databases.id, id), eq(schema.databases.pageId, id)), isNull(schema.databases.deletedAt)));
  if (d) return d;
  const [page] = await db.select().from(schema.pages).where(and(eq(schema.pages.id, id), eq(schema.pages.workspaceId, wsId), isNull(schema.pages.deletedAt)));
  if (!page || page.type !== "database") throw new HttpError(404, "Database not found");
  const [created] = await db.insert(schema.databases).values({ workspaceId: wsId, pageId: page.id, name: page.title, icon: page.icon }).returning();
  await db.insert(schema.databaseProperties).values({ databaseId: created.id, name: "Name", type: "title", position: 0, width: 260 });
  await db.insert(schema.databaseViews).values({ databaseId: created.id, name: "Table", type: "table", isDefault: true, position: 0 });
  return created;
}
export async function getDatabase(wsId: string, id: string): Promise<Database> {
  const d = await ensureDatabase(wsId, id);
  const [[page], properties, views] = await Promise.all([db.select({ title: schema.pages.title, icon: schema.pages.icon }).from(schema.pages).where(eq(schema.pages.id, d.pageId)), loadProps(d.id), db.select().from(schema.databaseViews).where(eq(schema.databaseViews.databaseId, d.id)).orderBy(schema.databaseViews.position, schema.databaseViews.createdAt)]);
  if (page && (page.title !== d.name || page.icon !== d.icon)) await db.update(schema.databases).set({ name: page.title, icon: page.icon }).where(eq(schema.databases.id, d.id));
  return { id: d.id, pageId: d.pageId, name: page?.title ?? d.name, description: d.description, icon: page?.icon ?? d.icon, isTemplate: d.isTemplate, templateOf: d.templateOf, properties, views: views as View[] };
}
export async function listDatabases(wsId: string) {
  const rows = await db.select({ id: schema.databases.id, pageId: schema.databases.pageId, name: schema.pages.title, icon: schema.pages.icon, isTemplate: schema.databases.isTemplate, templateOf: schema.databases.templateOf, updatedAt: schema.pages.updatedAt, rowCount: dsql<number>`(select count(*) from database_rows r where r.database_id = ${schema.databases.id} and r.deleted_at is null)` })
    .from(schema.databases).innerJoin(schema.pages, eq(schema.pages.id, schema.databases.pageId)).where(and(eq(schema.databases.workspaceId, wsId), isNull(schema.databases.deletedAt), isNull(schema.pages.deletedAt))).orderBy(schema.pages.title);
  return rows.map((r) => ({ ...r, rowCount: Number(r.rowCount) }));
}
export async function updateDatabase(wsId: string, id: string, patch: Partial<{ name: string; description: string | null; icon: string | null; isTemplate: boolean }>) {
  const d = await ensureDatabase(wsId, id);
  const set: Partial<DbRow> = { updatedAt: new Date() }; for (const k of ["name", "description", "icon", "isTemplate"] as const) if (patch[k] !== undefined) (set as any)[k] = patch[k];
  await db.update(schema.databases).set(set).where(eq(schema.databases.id, d.id));
  if (patch.name !== undefined || patch.icon !== undefined) await db.update(schema.pages).set({ ...(patch.name !== undefined ? { title: patch.name.trim() || "Untitled" } : {}), ...(patch.icon !== undefined ? { icon: patch.icon } : {}), updatedAt: new Date() }).where(eq(schema.pages.id, d.pageId));
  return getDatabase(wsId, d.id);
}

// ---------- properties
function normalizeConfig(type: PropertyType, config: PropertyConfig = {}): PropertyConfig {
  const c: PropertyConfig = { ...config };
  if (type === "status" && !c.options?.length) c.options = DEFAULT_STATUS.map((o) => ({ ...o }));
  if ((type === "select" || type === "multi_select") && !c.options) c.options = [];
  if (c.options) c.options = c.options.map((o, i) => ({ id: o.id || newId(), name: String(o.name ?? `Option ${i + 1}`).trim() || `Option ${i + 1}`, color: o.color || "gray", ...(o.group ? { group: o.group } : {}) }));
  return c;
}
/**
 * 3.0: a formula that ends up reading itself is refused when it is saved (400 `formula_cycle`, with the path), instead of being stored and
 * failing on every cell; a rollup must name a known aggregate. A syntax error is NOT refused (the editor shows it; the cell shows it).
 */
function checkComputed(props: Property[], self: { id?: string; name: string; type: PropertyType; config: PropertyConfig }) {
  if (self.type === "formula" && typeof self.config.expression === "string" && self.config.expression.trim()) {
    const others = props.filter((p) => p.id !== self.id); const cycle = formulaCycle(others, self.name, self.config.expression);
    if (cycle) throw new HttpError(400, `Circular formula: ${cycle.join(" → ")}`, "formula_cycle", { cycle });
  }
  if (self.type === "rollup" && self.config.aggregate !== undefined && !(AGGREGATES as readonly string[]).includes(String(self.config.aggregate))) throw new HttpError(400, `Unknown aggregate "${String(self.config.aggregate)}"`, "bad_request");
}
export async function createProperty(wsId: string, dbId: string, input: { id?: string; name: string; type: PropertyType; config?: PropertyConfig; width?: number | null; position?: number }): Promise<Property> {
  const d = await ensureDatabase(wsId, dbId);
  if (input.id) { const [old] = await db.select().from(schema.databaseProperties).where(eq(schema.databaseProperties.id, input.id)); if (old) { if (old.databaseId !== d.id) throw new HttpError(409, "This id is already in use", "id_taken"); return old as Property; } } // 3.0: client-chosen id, idempotent
  if (!PROPERTY_TYPES.includes(input.type)) throw new HttpError(400, "Unknown property type");
  if (input.type === "title") throw new HttpError(400, "A database has exactly one title property");
  const [{ max }] = await db.select({ max: dsql<number>`coalesce(max(position),0)` }).from(schema.databaseProperties).where(eq(schema.databaseProperties.databaseId, d.id));
  const config = normalizeConfig(input.type, input.config);
  checkComputed(await loadProps(d.id), { name: input.name.trim() || "Property", type: input.type, config });
  if (input.type === "relation" && config.targetDatabaseId) await ensureDatabase(wsId, config.targetDatabaseId);
  const [p] = await db.insert(schema.databaseProperties).values({ ...(input.id ? { id: input.id } : {}), databaseId: d.id, name: input.name.trim() || "Property", type: input.type, config, width: input.width ?? (input.type === "checkbox" ? 90 : 180), position: input.position ?? Number(max) + 1 }).returning();
  if (input.type === "relation" && config.twoWay && config.targetDatabaseId) {
    const target = await ensureDatabase(wsId, config.targetDatabaseId);
    const [{ tmax }] = await db.select({ tmax: dsql<number>`coalesce(max(position),0)` }).from(schema.databaseProperties).where(eq(schema.databaseProperties.databaseId, target.id));
    await db.insert(schema.databaseProperties).values({ databaseId: target.id, name: target.id === d.id ? `${p.name} (reverse)` : d.name, type: "relation", config: { targetDatabaseId: d.id, syncedPropertyId: p.id }, position: Number(tmax) + 1 });
  }
  return p as Property;
}
export async function updateProperty(wsId: string, dbId: string, propId: string, patch: Partial<{ name: string; type: PropertyType; config: PropertyConfig; width: number | null; position: number }>): Promise<Property> {
  const d = await ensureDatabase(wsId, dbId);
  const [prev] = await db.select().from(schema.databaseProperties).where(and(eq(schema.databaseProperties.id, propId), eq(schema.databaseProperties.databaseId, d.id))); if (!prev) throw new HttpError(404, "Property not found");
  const set: Record<string, unknown> = {};
  if (patch.name !== undefined) set.name = patch.name.trim() || prev.name;
  if (patch.width !== undefined) set.width = patch.width; if (patch.position !== undefined) set.position = patch.position;
  const type = patch.type ?? (prev.type as PropertyType);
  if (patch.type && patch.type !== prev.type) {
    if (prev.type === "title" || patch.type === "title") throw new HttpError(400, "The title property cannot change type");
    if (!PROPERTY_TYPES.includes(patch.type)) throw new HttpError(400, "Unknown property type");
    set.type = patch.type;
  }
  if (patch.config !== undefined || set.type) set.config = normalizeConfig(type, { ...(patch.config ?? (set.type ? {} : prev.config)) });
  if (type === "formula" || type === "rollup") { const all = await loadProps(d.id); const name = (set.name as string | undefined) ?? prev.name; checkComputed(all, { id: prev.id, name, type, config: (set.config as PropertyConfig | undefined) ?? (prev.config as PropertyConfig) }); }
  else if (set.name && set.name !== prev.name) { /* a rename can close a cycle only through a formula that already reads the new name: checked when that formula is evaluated */ }
  if (set.type && set.type !== "relation" && prev.type === "relation") await deleteRelationPair(prev as Property, d.id, true);
  if (prev.type === "relation" && type === "relation" && patch.config && patch.config.targetDatabaseId && patch.config.targetDatabaseId !== prev.config.targetDatabaseId) { await db.delete(schema.relationsTable).where(eq(schema.relationsTable.propertyId, prev.id)); }
  const [p] = await db.update(schema.databaseProperties).set(set).where(eq(schema.databaseProperties.id, propId)).returning();
  if (set.type && set.type !== prev.type) await convertValues(d.id, prev as Property, p as Property);
  return p as Property;
}
async function deleteRelationPair(p: Property, dbId: string, keepSelf: boolean) {
  const synced = p.config.syncedPropertyId as string | undefined;
  if (synced) {
    // 3.0 (audit D21): removing the reverse side leaves the forward property a plain one-way relation (it kept `twoWay: true` with no counterpart)
    await db.update(schema.databaseProperties).set({ config: dsql`${schema.databaseProperties.config} - 'twoWay'` }).where(eq(schema.databaseProperties.id, synced));
    if (!keepSelf) await db.delete(schema.databaseProperties).where(eq(schema.databaseProperties.id, p.id)); return;
  }
  await db.delete(schema.databaseProperties).where(dsql`${schema.databaseProperties.config}->>'syncedPropertyId' = ${p.id}`);
  await db.delete(schema.relationsTable).where(eq(schema.relationsTable.propertyId, p.id));
  if (!keepSelf) await db.delete(schema.databaseProperties).where(eq(schema.databaseProperties.id, p.id));
}
export async function deleteProperty(wsId: string, dbId: string, propId: string) {
  const d = await ensureDatabase(wsId, dbId);
  const [p] = await db.select().from(schema.databaseProperties).where(and(eq(schema.databaseProperties.id, propId), eq(schema.databaseProperties.databaseId, d.id))); if (!p) return false; // nothing to delete: DELETE is idempotent
  if (p.type === "title") throw new HttpError(400, "The title property cannot be deleted");
  if (p.type === "relation") await deleteRelationPair(p as Property, d.id, false); else await db.delete(schema.databaseProperties).where(eq(schema.databaseProperties.id, propId));
  await db.update(schema.databaseRows).set({ values: dsql`${schema.databaseRows.values} - ${propId}` }).where(eq(schema.databaseRows.databaseId, d.id));
  await pruneViews(d.id, propId);
  return true;
}
const pruneFilter = (f: FilterNode, propId: string): FilterNode | null => { if (!isGroup(f)) return f.property === propId ? null : f; const key = f.or ? "or" : "and"; const items = (f.or ?? f.and ?? []).map((n) => pruneFilter(n, propId)).filter((n): n is FilterNode => !!n && (!isGroup(n) || (n.and ?? n.or ?? []).length > 0)); return { [key]: items } as FilterGroup; };
/** 3.0: a deleted property leaves no dead reference in the saved views (filter rules, sorts, grouping, date / cover properties, hidden, order, widths, card properties). */
async function pruneViews(dbId: string, propId: string) {
  for (const v of await db.select().from(schema.databaseViews).where(eq(schema.databaseViews.databaseId, dbId))) {
    const c = { ...(v.config as ViewConfig) }; const before = JSON.stringify(c);
    if (c.filter) { const f = pruneFilter(c.filter, propId) as FilterGroup | null; c.filter = f && (f.and ?? f.or ?? []).length ? f : null; }
    if (c.sorts) c.sorts = c.sorts.filter((s) => s.property !== propId);
    for (const k of ["groupBy", "dateProperty", "startProperty", "endProperty", "coverProperty"] as const) if (c[k] === propId) c[k] = null;
    for (const k of ["hidden", "order", "cardProps", "mobileProps"] as const) if (Array.isArray(c[k])) (c as any)[k] = (c[k] as string[]).filter((x) => x !== propId);
    for (const k of ["widths", "footers"] as const) if (c[k] && typeof c[k] === "object" && propId in (c[k] as object)) { const o = { ...(c[k] as Record<string, unknown>) }; delete o[propId]; (c as any)[k] = o; }
    if (JSON.stringify(c) !== before) await db.update(schema.databaseViews).set({ config: c }).where(eq(schema.databaseViews.id, v.id));
  }
}
export async function reorderProperties(wsId: string, dbId: string, ids: string[]) {
  const d = await ensureDatabase(wsId, dbId);
  for (let i = 0; i < ids.length; i++) await db.update(schema.databaseProperties).set({ position: i + 1 }).where(and(eq(schema.databaseProperties.id, ids[i]), eq(schema.databaseProperties.databaseId, d.id)));
}
/** Best-effort conversion of stored values when a property changes type. */
async function convertValues(dbId: string, prev: Property, next: Property) {
  const raws = await loadRaw([eq(schema.databaseRows.databaseId, dbId)]); const opts = (next.config.options ??= []); let optsChanged = false;
  for (const r of raws) {
    const v = r.values[prev.id]; if (v == null) continue; let nv: unknown = null; const s = displayValue(prev, v);
    if (next.type === "text" || next.type === "url" || next.type === "ai") nv = s || null;
    else if (next.type === "number") nv = numberOf(typeof v === "number" ? v : s);
    else if (next.type === "checkbox") nv = Boolean(v) && v !== "false";
    else if (next.type === "date") nv = typeof v === "string" && !Number.isNaN(Date.parse(v)) ? v : null;
    else if (next.type === "select" || next.type === "status") { if (s) { const o = ensureOption(next, s.split(",")[0].trim()); nv = o.id; optsChanged = true; } }
    else if (next.type === "multi_select") { nv = s.split(",").map((x) => x.trim()).filter(Boolean).map((x) => { optsChanged = true; return ensureOption(next, x).id; }); }
    await db.update(schema.databaseRows).set({ values: nv == null ? dsql`${schema.databaseRows.values} - ${prev.id}` : dsql`${schema.databaseRows.values} || ${JSON.stringify({ [prev.id]: nv })}::jsonb` }).where(eq(schema.databaseRows.id, r.id));
  }
  if (optsChanged) await db.update(schema.databaseProperties).set({ config: { ...next.config, options: opts } }).where(eq(schema.databaseProperties.id, next.id));
}

// ---------- rows
async function propsOf(d: DbRow) { return loadProps(d.id); }
const relIds = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => (typeof x === "string" ? x : (x as RelationRef)?.rowId)).filter((x): x is string => typeof x === "string" && UUID.test(x)) : typeof v === "string" && UUID.test(v) ? [v] : []);
export async function setRelations(p: Property, rowId: string, targetIds: string[]) {
  const synced = p.config.syncedPropertyId as string | undefined; let ids = [...new Set(targetIds)];
  // 3.0 (audit D20): only live rows of the target database can be linked (any existing row id used to be accepted)
  if (ids.length && p.config.targetDatabaseId) { const ok = new Set((await db.select({ id: schema.databaseRows.id }).from(schema.databaseRows).where(and(inArray(schema.databaseRows.id, ids), eq(schema.databaseRows.databaseId, p.config.targetDatabaseId as string)))).map((r) => r.id)); ids = ids.filter((x) => ok.has(x)); }
  const single = p.config.single ? ids.slice(0, 1) : ids;
  if (synced) { await db.delete(schema.relationsTable).where(and(eq(schema.relationsTable.propertyId, synced), eq(schema.relationsTable.toRowId, rowId))); if (single.length) await db.insert(schema.relationsTable).values(single.map((f) => ({ propertyId: synced, fromRowId: f, toRowId: rowId }))).onConflictDoNothing(); }
  else { await db.delete(schema.relationsTable).where(and(eq(schema.relationsTable.propertyId, p.id), eq(schema.relationsTable.fromRowId, rowId))); if (single.length) await db.insert(schema.relationsTable).values(single.map((t) => ({ propertyId: p.id, fromRowId: rowId, toRowId: t }))).onConflictDoNothing(); }
}
/** Split incoming values into stored jsonb, title, and relation writes. */
function splitValues(props: Property[], values: Record<string, unknown>) {
  const stored: Record<string, unknown> = {}; const drop: string[] = []; let title: string | undefined; const rels: { p: Property; ids: string[] }[] = [];
  for (const [k, v] of Object.entries(values)) {
    const p = props.find((x) => x.id === k || x.name === k); if (!p) continue;
    if (p.type === "title") { title = v == null ? "" : String(v); stored[p.id] = title; continue; }
    if (p.type === "relation") { rels.push({ p, ids: relIds(v) }); continue; }
    if (COMPUTED_TYPES.has(p.type)) continue;
    if (v == null || v === "" || (Array.isArray(v) && !v.length)) drop.push(p.id); else stored[p.id] = v;
  }
  return { stored, drop, title, rels };
}
export async function createRow(wsId: string, dbId: string, input: { id?: string; pageId?: string; title?: string; values?: Record<string, unknown>; position?: number; content?: any; icon?: string | null; templateId?: string }): Promise<RowOut> {
  const d = await ensureDatabase(wsId, dbId); const props = await propsOf(d);
  // 3.0: client-chosen ids (row `id`, and `pageId` for the row's page). The same row id twice → the stored row, untouched.
  if (input.id) { const [old] = await db.select({ id: schema.databaseRows.id, databaseId: schema.databaseRows.databaseId }).from(schema.databaseRows).where(eq(schema.databaseRows.id, input.id)); if (old) { if (old.databaseId !== d.id) throw new HttpError(409, "This id is already in use", "id_taken"); const [row] = await getRows(d, props, [old.id]); if (row) return row; throw new HttpError(409, "This row was deleted", "row_deleted"); } }
  if (input.pageId) { const [taken] = await db.select({ id: schema.pages.id }).from(schema.pages).where(eq(schema.pages.id, input.pageId)); if (taken) throw new HttpError(409, "This page id is already in use", "id_taken"); }
  // 3.0: `templateId` = a row template of this database: its values are the defaults (explicit values win), its body and icon fill what is not sent
  if (input.templateId) { const [t] = await db.select().from(schema.databaseRowTemplates).where(and(eq(schema.databaseRowTemplates.id, input.templateId), eq(schema.databaseRowTemplates.databaseId, d.id))); if (!t) throw new HttpError(404, "Template not found", "not_found"); input = { ...input, values: { ...t.values, ...(input.values ?? {}) }, content: input.content ?? t.content ?? undefined, icon: input.icon ?? t.icon }; }
  const { stored, title, rels } = splitValues(props, input.values ?? {}); const tp = titleProp(props);
  const t = (input.title ?? title ?? "").trim(); if (tp) stored[tp.id] = t;
  const page = await createPage(wsId, { ...(input.pageId ? { id: input.pageId } : {}), title: t, parentId: d.pageId, section: "databases", type: "page", databaseId: d.id, content: input.content, icon: input.icon ?? null });
  const [{ max }] = await db.select({ max: dsql<number>`coalesce(max(position),0)` }).from(schema.databaseRows).where(eq(schema.databaseRows.databaseId, d.id));
  const [row] = await db.insert(schema.databaseRows).values({ ...(input.id ? { id: input.id } : {}), databaseId: d.id, pageId: page.id, values: stored, position: input.position ?? Number(max) + 1 }).returning();
  for (const r of rels) await setRelations(r.p, row.id, r.ids);
  return (await getRows(d, props, [row.id]))[0];
}
export async function updateRow(wsId: string, dbId: string, rowId: string, values: Record<string, unknown>): Promise<RowOut> {
  const d = await ensureDatabase(wsId, dbId); const props = await propsOf(d);
  const [row] = await db.select().from(schema.databaseRows).where(and(eq(schema.databaseRows.id, rowId), eq(schema.databaseRows.databaseId, d.id), isNull(schema.databaseRows.deletedAt))); if (!row) throw new HttpError(404, "Row not found");
  const { stored, drop, title, rels } = splitValues(props, values);
  const next = { ...row.values, ...stored }; for (const k of drop) delete next[k];
  await db.update(schema.databaseRows).set({ values: next, updatedAt: new Date() }).where(eq(schema.databaseRows.id, rowId));
  if (title !== undefined) await db.update(schema.pages).set({ title: title.trim() || "Untitled", updatedAt: new Date() }).where(eq(schema.pages.id, row.pageId));
  else await db.update(schema.pages).set({ updatedAt: new Date() }).where(eq(schema.pages.id, row.pageId));
  for (const r of rels) await setRelations(r.p, rowId, r.ids);
  return (await getRows(d, props, [rowId]))[0];
}
export async function getRows(d: DbRow, props: Property[], ids: string[]): Promise<RowOut[]> { return hydrate(props, await loadRaw([eq(schema.databaseRows.databaseId, d.id), inArray(schema.databaseRows.id, ids.length ? ids : ["00000000-0000-0000-0000-000000000000"])])); }
export async function reorderRows(wsId: string, dbId: string, ids: string[]) {
  const d = await ensureDatabase(wsId, dbId);
  for (let i = 0; i < ids.length; i++) await db.update(schema.databaseRows).set({ position: i + 1 }).where(and(eq(schema.databaseRows.id, ids[i]), eq(schema.databaseRows.databaseId, d.id)));
}
export async function deleteRows(wsId: string, dbId: string, ids: string[]) {
  const d = await ensureDatabase(wsId, dbId); if (!ids.length) return 0;
  const rows = await db.select({ id: schema.databaseRows.id, pageId: schema.databaseRows.pageId }).from(schema.databaseRows).where(and(eq(schema.databaseRows.databaseId, d.id), inArray(schema.databaseRows.id, ids)));
  if (!rows.length) return 0;
  await db.update(schema.databaseRows).set({ deletedAt: new Date() }).where(inArray(schema.databaseRows.id, rows.map((r) => r.id)));
  for (const r of rows) await softDeletePage(wsId, r.pageId).catch(() => {});
  return rows.length;
}
export async function listRowsSimple(wsId: string, dbId: string, q: string | undefined, limit = 50) {
  const d = await ensureDatabase(wsId, dbId); // 3.0: LIMIT in SQL (the 2.x version loaded every row of the database for each keystroke of a relation picker)
  const rows = await db.select({ rowId: schema.databaseRows.id, pageId: schema.databaseRows.pageId, title: schema.pages.title, icon: schema.pages.icon }).from(schema.databaseRows).innerJoin(schema.pages, eq(schema.pages.id, schema.databaseRows.pageId))
    .where(and(eq(schema.databaseRows.databaseId, d.id), isNull(schema.databaseRows.deletedAt), isNull(schema.pages.deletedAt), ...(q?.trim() ? [dsql`${schema.pages.title} ilike ${"%" + q.trim().replace(/[%_\\]/g, "\\$&") + "%"}`] : [])))
    .orderBy(schema.databaseRows.position, schema.databaseRows.createdAt).limit(Math.max(1, Math.min(500, limit)));
  return rows as RelationRef[];
}
export async function enqueueAi(wsId: string, dbId: string, rowId: string, propertyId: string) {
  const d = await ensureDatabase(wsId, dbId); const props = await propsOf(d); const p = props.find((x) => x.id === propertyId);
  if (!p || p.type !== "ai") throw new HttpError(400, "Not an AI property");
  await db.update(schema.databaseRows).set({ values: dsql`${schema.databaseRows.values} || ${JSON.stringify({ [p.id]: { pending: true, at: new Date().toISOString() } })}::jsonb` }).where(and(eq(schema.databaseRows.id, rowId), eq(schema.databaseRows.databaseId, d.id)));
  await enqueue(QUEUES.aiProperty, { rowId, propertyId, workspaceId: wsId }, { singletonKey: `ai:${rowId}:${propertyId}`, singletonSeconds: 5 });
}

// ---------- views
export async function createView(wsId: string, dbId: string, input: { id?: string; name: string; type: ViewType; config?: ViewConfig }): Promise<View> {
  const d = await ensureDatabase(wsId, dbId); if (!VIEW_TYPES.includes(input.type)) throw new HttpError(400, "Unknown view type");
  if (input.config) await checkViewConfig(d.id, input.config);
  if (input.id) { const [old] = await db.select().from(schema.databaseViews).where(eq(schema.databaseViews.id, input.id)); if (old) { if (old.databaseId !== d.id) throw new HttpError(409, "This id is already in use", "id_taken"); return old as View; } } // 3.0: client-chosen id, idempotent
  const [{ max }] = await db.select({ max: dsql<number>`coalesce(max(position),0)` }).from(schema.databaseViews).where(eq(schema.databaseViews.databaseId, d.id));
  const [v] = await db.insert(schema.databaseViews).values({ ...(input.id ? { id: input.id } : {}), databaseId: d.id, name: input.name.trim() || input.type, type: input.type, config: input.config ?? {}, position: Number(max) + 1 }).returning(); return v as View;
}
export async function updateView(wsId: string, dbId: string, viewId: string, patch: Partial<{ name: string; type: ViewType; config: ViewConfig; position: number; isDefault: boolean }>): Promise<View> {
  const d = await ensureDatabase(wsId, dbId);
  const [prev] = await db.select().from(schema.databaseViews).where(and(eq(schema.databaseViews.id, viewId), eq(schema.databaseViews.databaseId, d.id))); if (!prev) throw new HttpError(404, "View not found");
  if (patch.config) await checkViewConfig(d.id, patch.config);
  if (patch.isDefault) await db.update(schema.databaseViews).set({ isDefault: false }).where(eq(schema.databaseViews.databaseId, d.id));
  const set: Record<string, unknown> = {}; if (patch.name !== undefined) set.name = patch.name.trim() || prev.name; if (patch.type) set.type = patch.type; if (patch.config !== undefined) set.config = { ...(prev.config as ViewConfig), ...patch.config }; if (patch.position !== undefined) set.position = patch.position; if (patch.isDefault !== undefined) set.isDefault = patch.isDefault;
  const [v] = await db.update(schema.databaseViews).set(set).where(eq(schema.databaseViews.id, viewId)).returning(); return v as View;
}
/** 3.0 (audit D10): the filter and the sorts saved with a view are validated (unknown property / operator, `and` + `or` in one group → 400 `bad_filter` / `bad_sort`). */
async function checkViewConfig(dbId: string, config: ViewConfig) {
  if (config.filter == null && config.sorts == null) return; const props = await loadProps(dbId);
  if (config.filter != null) validateFilter(config.filter, props, "config.filter"); if (config.sorts != null) validateSorts(config.sorts, props);
}
export async function deleteView(wsId: string, dbId: string, viewId: string) {
  const d = await ensureDatabase(wsId, dbId);
  const all = await db.select({ id: schema.databaseViews.id }).from(schema.databaseViews).where(eq(schema.databaseViews.databaseId, d.id)); if (!all.some((v) => v.id === viewId)) return false; /* nothing to delete: DELETE is idempotent */ if (all.length <= 1) throw new HttpError(400, "A database needs at least one view", "last_view");
  await db.delete(schema.databaseViews).where(and(eq(schema.databaseViews.id, viewId), eq(schema.databaseViews.databaseId, d.id)));
}

// ---------- duplicate (templates)
const remapConfig = (c: Record<string, unknown>, map: Map<string, string>): Record<string, unknown> => JSON.parse(JSON.stringify(c), (k, v) => (typeof v === "string" && map.has(v) ? map.get(v) : v));
export async function duplicateDatabase(wsId: string, dbId: string, opts: { withRows?: boolean; title?: string; asTemplate?: boolean; parentId?: string | null } = {}) {
  const src = await getDatabase(wsId, dbId);
  const page = await createPage(wsId, { title: opts.title ?? `${src.name} (copy)`, type: "database", section: "databases", icon: src.icon, parentId: opts.parentId ?? null });
  const [d] = await db.insert(schema.databases).values({ workspaceId: wsId, pageId: page.id, name: page.title, icon: src.icon, description: src.description, isTemplate: opts.asTemplate ?? false, templateOf: src.isTemplate ? src.id : null }).returning();
  const pmap = new Map<string, string>();
  for (const p of src.properties) { const [np] = await db.insert(schema.databaseProperties).values({ databaseId: d.id, name: p.name, type: p.type, config: p.config, position: p.position, width: p.width }).returning(); pmap.set(p.id, np.id); }
  pmap.set(src.id, d.id);
  for (const id of pmap.keys()) if (id !== src.id) { const p = src.properties.find((x) => x.id === id)!; const c = remapConfig(p.config, pmap); if (p.type === "relation") { delete c.syncedPropertyId; delete c.twoWay; } if (JSON.stringify(c) !== JSON.stringify(p.config)) await db.update(schema.databaseProperties).set({ config: c }).where(eq(schema.databaseProperties.id, pmap.get(id)!)); }
  for (const v of src.views) await db.insert(schema.databaseViews).values({ databaseId: d.id, name: v.name, type: v.type, config: remapConfig(v.config, pmap), position: v.position, isDefault: v.isDefault });
  if (opts.withRows) {
    const raws = await loadRaw([eq(schema.databaseRows.databaseId, src.id)]); const rmap = new Map<string, string>();
    const pagesById = new Map((await db.select({ id: schema.pages.id, content: schema.pages.content }).from(schema.pages).where(inArray(schema.pages.id, raws.length ? raws.map((r) => r.pageId) : ["00000000-0000-0000-0000-000000000000"]))).map((p) => [p.id, p.content]));
    for (const r of raws) {
      const np = await createPage(wsId, { title: r.title, parentId: page.id, section: "databases", databaseId: d.id, icon: r.icon, content: pagesById.get(r.pageId) as any });
      const values: Record<string, unknown> = {}; for (const [k, v] of Object.entries(r.values)) if (pmap.has(k)) values[pmap.get(k)!] = v;
      const [nr] = await db.insert(schema.databaseRows).values({ databaseId: d.id, pageId: np.id, values, position: r.position }).returning(); rmap.set(r.id, nr.id);
    }
    const relProps = src.properties.filter((p) => p.type === "relation" && !p.config.syncedPropertyId);
    if (relProps.length && raws.length) {
      const rels = await db.select().from(schema.relationsTable).where(and(inArray(schema.relationsTable.propertyId, relProps.map((p) => p.id)), inArray(schema.relationsTable.fromRowId, raws.map((r) => r.id))));
      const self = (pid: string) => relProps.find((p) => p.id === pid)?.config.targetDatabaseId === src.id;
      const vals = rels.map((x) => ({ propertyId: pmap.get(x.propertyId)!, fromRowId: rmap.get(x.fromRowId)!, toRowId: self(x.propertyId) ? rmap.get(x.toRowId) : x.toRowId })).filter((x) => x.toRowId) as { propertyId: string; fromRowId: string; toRowId: string }[];
      if (vals.length) await db.insert(schema.relationsTable).values(vals).onConflictDoNothing();
    }
  }
  return getDatabase(wsId, d.id);
}
export { queryRows, isEmpty, collectRules };
export type { Sort };
