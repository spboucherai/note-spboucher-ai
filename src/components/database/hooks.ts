/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/components/database/hooks.ts
 * Module           : components
 * Repository       : https://git.spboucher.ai/note-spboucher-ai
 * Project Website  : https://note.spboucher.ai
 * Created          : 2026-11-01
 * Last Modified    : 2026-11-19
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

"use client";
import { createContext, useContext, useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { api } from "@/lib/client/api";
import { toast } from "@/components/ui/toast";
import type { Database, Property, View, ViewConfig, RowOut, QueryResult, FilterGroup, Sort, SelectOption, RowTemplate } from "@/lib/databases/types";
import type { Win } from "./window";
import type { ViewGroup } from "./group";
import type { UndoStack } from "./undo";
import { isPending } from "@/lib/databases/types";
import { sortedProps, titleProp } from "@/lib/databases/values";

export interface DbCtx {
  db: Database; props: Property[]; visibleProps: Property[]; view: View; rows: RowOut[]; total: number; loading: boolean; isMobile: boolean; search: string;
  /** Properties shown on phone cards and in the quick-create sheet (view.config.mobileProps, else the first visible ones). */
  priorityProps: Property[];
  /** Phone layout of a table view: vertical cards (default) or the real grid. */
  mobileLayout: MobileLayout;
  /** Rows query failed (rows may still hold the last good copy). */
  error: Error | null; fetching: boolean; retry: () => void;
  setCell: (rowId: string, values: Record<string, unknown>) => void;
  /** Creates the row immediately. `open: false` keeps the row sheet closed (quick-create form). Rejects on failure (a toast is already shown). */
  addRow: (values?: Record<string, unknown>, title?: string, opts?: { open?: boolean }) => Promise<RowOut>;
  /** The "New" action of every view: on phones opens the quick-create sheet (prefilled with `preset`), on desktop creates the row inline. */
  newRow: (preset?: Record<string, unknown>, templateId?: string | null) => void;
  /** Moves rows to the trash and offers Undo. */
  removeRows: (ids: string[]) => Promise<void>;
  // ---------- 3.0 (Databases Next Generation)
  /** Windowed rows of the view (table, board, list, gallery): `rows` above = the rows loaded so far, `total` = the whole result. */
  win: Win;
  /** Property the view is grouped by (table / board / list), its groups with whole-database counts, and the collapsed ones (saved with the view). */
  groupProp: Property | undefined; groups: ViewGroup[]; collapsed: Set<string>; toggleGroup: (key: string) => void;
  /** A row from any loaded window of this database. */
  findRow: (rowId: string) => RowOut | undefined;
  undo: UndoStack;
  /** One action on many rows (ids, or every row of the view / search except some); journaled on the server, pushed on the undo stack. Resolves false on failure (toast shown). */
  bulk: (sel: { ids: string[] } | { all: { except: string[] } }, action: { type: "update"; values: Record<string, unknown> } | { type: "delete" } | { type: "duplicate" }, label: string) => Promise<boolean>;
  duplicateRow: (rowId: string) => Promise<RowOut | null>;
  /** Row templates of the database; `newRow(preset, templateId)` creates from one. */
  templates: RowTemplate[];
  /** Id of the row the "New" action just created in a table (the grid scrolls to it, or says where it is). */
  created: string | null;
  open: (rowId: string | null) => void; openViewSettings: () => void; patchView: (config: Partial<ViewConfig>) => void; refresh: () => void; regenerate: (rowId: string, propertyId: string) => Promise<void>; addOption: (propId: string, name: string) => Promise<SelectOption>;
}
export type MobileLayout = "cards" | "grid";
export const MOBILE_PROP_COUNT = 4;
/** `database_views.config.mobileLayout` — anything but "grid" means cards. */
export const mobileLayoutOf = (view: View): MobileLayout => (view.config.mobileLayout === "grid" ? "grid" : "cards");
/** Ids explicitly chosen for phone cards (`database_views.config.mobileProps`), or null when the default applies. */
export function configuredMobileProps(view: View): string[] | null {
  const raw = view.config.mobileProps;
  return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : null;
}
/** The 3–4 properties a phone card shows under the title. `props` must already be sorted by position. */
export function priorityPropsOf(props: Property[], view: View): Property[] {
  const configured = configuredMobileProps(view);
  if (configured) return configured.map((id) => props.find((p) => p.id === id)).filter((p): p is Property => !!p && p.type !== "title");
  const hidden = new Set(view.config.hidden ?? []);
  return props.filter((p) => p.type !== "title" && !hidden.has(p.id)).slice(0, MOBILE_PROP_COUNT);
}
export const DbContext = createContext<DbCtx | null>(null);
export const useDb = () => { const c = useContext(DbContext); if (!c) throw new Error("DbContext missing"); return c; };

export const useDatabase = (id: string) => useQuery<Database>({ queryKey: ["db", id], queryFn: () => api(`/api/databases/${id}`) });
export function useRows(dbId: string | undefined, viewId: string | undefined, search: string, over: { filter?: FilterGroup | null; sorts?: Sort[] } = {}) {
  const q = useQuery<QueryResult>({ queryKey: ["db-rows", dbId, viewId, search, over], enabled: !!dbId && !!viewId, placeholderData: keepPreviousData, queryFn: () => api(`/api/databases/${dbId}/query`, { method: "POST", json: { viewId, search: search || undefined, limit: 500, ...over } }),
    refetchInterval: (query) => (query.state.data?.rows.some((r) => Object.values(r.values).some(isPending)) ? 2500 : false) });
  return q;
}
const patchRows = (qc: ReturnType<typeof useQueryClient>, dbId: string, fn: (rows: RowOut[]) => RowOut[]) => qc.setQueriesData<QueryResult>({ queryKey: ["db-rows", dbId] }, (old) => { if (!old?.rows) return old; const rows = fn(old.rows); return { ...old, rows, total: Math.max(0, old.total + rows.length - old.rows.length) }; }); // 3.0 (U3): the total follows an optimistic insert / delete
export function useRowMutations(db: Database | undefined) {
  const qc = useQueryClient(); const dbId = db?.id ?? ""; const tp = db ? titleProp(db.properties) : undefined;
  const update = useMutation({
    mutationFn: ({ rowId, values }: { rowId: string; values: Record<string, unknown> }) => api<RowOut>(`/api/databases/${dbId}/rows`, { method: "PATCH", json: { id: rowId, values } }),
    onMutate: async ({ rowId, values }) => { await qc.cancelQueries({ queryKey: ["db-rows", dbId] }); const prev = qc.getQueriesData<QueryResult>({ queryKey: ["db-rows", dbId] }); patchRows(qc, dbId, (rows) => rows.map((r) => (r.id === rowId ? { ...r, values: { ...r.values, ...values }, title: tp && tp.id in values ? String(values[tp.id] ?? "") : r.title } : r))); return { prev }; },
    onError: (e: any, _v, ctx) => { ctx?.prev.forEach(([k, d]) => qc.setQueryData(k, d)); toast("Save failed", { description: e?.message, tone: "danger" }); },
    // An edit can move the row to another group, day or bar, or in / out of a "no date" list: grouped windows (counts, offsets) and the
    // date-bounded queries are reconciled with the server; plain windows keep their order until the next load (as in 2.x).
    onSuccess: (row) => { patchRows(qc, dbId, (rows) => rows.map((r) => (r.id === row.id ? row : r))); qc.invalidateQueries({ queryKey: ["db-rows", dbId], predicate: (q) => { const k = q.queryKey[4] as { tag?: string; g?: string | null } | undefined; return !!k && typeof k === "object" && (k.tag === "calendar" || k.tag === "timeline" || k.tag === "undated" || !!k.g); } }); },
  });
  const create = useMutation({
    mutationFn: (input: { values?: Record<string, unknown>; title?: string; templateId?: string }) => api<RowOut>(`/api/databases/${dbId}/rows`, { method: "POST", json: input }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["db-rows", dbId] }); },
    onError: (e: any) => toast("Could not create row", { description: e?.message, tone: "danger" }),
  });
  const restore = useMutation({
    mutationFn: (ids: string[]) => api(`/api/databases/${dbId}/rows/restore`, { method: "POST", json: { ids } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["db-rows", dbId] }); qc.invalidateQueries({ queryKey: ["tree"] }); },
    onError: (e: any) => toast("Could not restore", { description: e?.message ?? "The rows are still in the trash.", tone: "danger" }),
  });
  const remove = useMutation({
    mutationFn: (ids: string[]) => api(`/api/databases/${dbId}/rows?ids=${ids.join(",")}`, { method: "DELETE" }),
    onMutate: async (ids) => { await qc.cancelQueries({ queryKey: ["db-rows", dbId] }); const prev = qc.getQueriesData<QueryResult>({ queryKey: ["db-rows", dbId] }); patchRows(qc, dbId, (rows) => rows.filter((r) => !ids.includes(r.id))); return { prev }; },
    onError: (e: any, _v, ctx) => { ctx?.prev.forEach(([k, d]) => qc.setQueryData(k, d)); toast("Delete failed", { description: e?.message, tone: "danger" }); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["tree"] }); qc.invalidateQueries({ queryKey: ["db-rows", dbId] }); },
  });
  return { update, create, remove, restore };
}
const ROW_KEYS = ["filter", "sorts"];
/** View patches in flight per database: the server copy of a view is applied only when the last one has answered (an earlier answer must not undo a newer optimistic change). */
const inFlight = new Map<string, number>();
export function useViewMutations(db: Database | undefined, pageId: string) {
  const qc = useQueryClient(); const dbId = db?.id ?? ""; const inv = () => qc.invalidateQueries({ queryKey: ["db", pageId] });
  const patchView = useMutation({
    mutationKey: ["db-view", dbId],
    mutationFn: ({ id, ...patch }: { id: string; name?: string; type?: string; config?: Partial<ViewConfig>; isDefault?: boolean }) => api<View>(`/api/databases/${dbId}/views`, { method: "PATCH", json: { id, ...patch } }),
    onMutate: async (v) => { inFlight.set(dbId, (inFlight.get(dbId) ?? 0) + 1); await qc.cancelQueries({ queryKey: ["db", pageId] }); qc.setQueryData<Database>(["db", pageId], (old) => old ? { ...old, views: old.views.map((x) => (x.id === v.id ? { ...x, ...(v.name ? { name: v.name } : {}), ...(v.type ? { type: v.type as any } : {}), ...(v.isDefault ? { isDefault: true } : {}), config: { ...x.config, ...(v.config ?? {}) } } : v.isDefault ? { ...x, isDefault: false } : x)) } : old); },
    // 3.0 (U3): rows are refetched only when the change can alter them (filter, sorts, layout) — not for a column width, a collapsed group, a hidden property…; a patch that is not the latest one does not overwrite the newer optimistic state
    onSettled: () => { inFlight.set(dbId, Math.max(0, (inFlight.get(dbId) ?? 1) - 1)); },
    onSuccess: (view, v) => { if ((inFlight.get(dbId) ?? 1) <= 1) qc.setQueryData<Database>(["db", pageId], (old) => old ? { ...old, views: old.views.map((x) => (x.id === view.id ? view : v.isDefault ? { ...x, isDefault: false } : x)) } : old); if (v.type || (v.config && ROW_KEYS.some((k) => k in v.config!))) qc.invalidateQueries({ queryKey: ["db-rows", dbId] }); },
    onError: (e: any) => { toast("View update failed", { description: e?.message, tone: "danger" }); inv(); },
  });
  const createView = useMutation({ mutationFn: (input: { name: string; type: string; config?: ViewConfig }) => api<View>(`/api/databases/${dbId}/views`, { method: "POST", json: input }), onSuccess: inv, onError: (e: any) => toast("Could not create the view", { description: e?.message, tone: "danger" }) });
  const deleteView = useMutation({ mutationFn: (id: string) => api(`/api/databases/${dbId}/views?id=${id}`, { method: "DELETE" }), onSuccess: inv, onError: (e: any) => toast(e?.message, { tone: "danger" }) });
  return { patchView, createView, deleteView, invalidate: inv };
}
export function usePropertyMutations(db: Database | undefined, pageId: string) {
  const qc = useQueryClient(); const dbId = db?.id ?? ""; const inv = () => { qc.invalidateQueries({ queryKey: ["db", pageId] }); qc.invalidateQueries({ queryKey: ["db-rows", dbId] }); };
  const create = useMutation({ mutationFn: (input: { name: string; type: string; config?: Record<string, unknown>; width?: number | null }) => api<Property>(`/api/databases/${dbId}/properties`, { method: "POST", json: input }), onSuccess: inv, onError: (e: any) => toast("Could not add property", { description: e?.message, tone: "danger" }) });
  const update = useMutation({
    mutationFn: ({ id, ...patch }: { id: string; name?: string; type?: string; config?: Record<string, unknown>; width?: number | null }) => api<Property>(`/api/databases/${dbId}/properties`, { method: "PATCH", json: { id, ...patch } }),
    onMutate: async (v) => { await qc.cancelQueries({ queryKey: ["db", pageId] }); qc.setQueryData<Database>(["db", pageId], (old) => old ? { ...old, properties: old.properties.map((p) => (p.id === v.id ? { ...p, ...(v.name !== undefined ? { name: v.name } : {}), ...(v.width !== undefined ? { width: v.width } : {}), ...(v.config ? { config: v.config as any } : {}) } : p)) } : old); },
    onSuccess: inv, onError: (e: any) => { toast("Property update failed", { description: e?.message, tone: "danger" }); inv(); },
  });
  const remove = useMutation({ mutationFn: (id: string) => api(`/api/databases/${dbId}/properties?id=${id}`, { method: "DELETE" }), onSuccess: inv, onError: (e: any) => toast(e?.message, { tone: "danger" }) });
  const reorder = useMutation({ mutationFn: (order: string[]) => api(`/api/databases/${dbId}/properties`, { method: "PATCH", json: { order } }), onMutate: (order) => { qc.setQueryData<Database>(["db", pageId], (old) => old ? { ...old, properties: sortedProps(old.properties).map((p) => ({ ...p, position: order.indexOf(p.id) + 1 })) } : old); }, onSuccess: inv, onError: (e: any) => { toast("Could not reorder the properties", { description: e?.message, tone: "danger" }); inv(); } });
  return { create, update, remove, reorder };
}
export function useMedia(query: string) {
  const [m, setM] = useState(false);
  useEffect(() => { const mq = matchMedia(query); const h = () => setM(mq.matches); h(); mq.addEventListener("change", h); return () => mq.removeEventListener("change", h); }, [query]);
  return m;
}
export const useAllDatabases = () => useQuery<{ id: string; pageId: string; name: string; icon: string | null; rowCount: number; isTemplate: boolean }[]>({ queryKey: ["databases"], queryFn: () => api("/api/databases") });
export const useRemoteDatabase = (id: string | undefined | null) => useQuery<Database>({ queryKey: ["db", id], enabled: !!id, queryFn: () => api(`/api/databases/${id}`) });
/** One-off rows query of a view with an extra filter (calendar month, timeline, "no date" lists). Lives under ["db-rows", dbId] like every window. */
export function useRowsQuery(dbId: string | undefined, viewId: string | undefined, search: string, extra: { extraFilter?: FilterGroup | null; limit?: number; enabled?: boolean; tag: string }) {
  return useQuery<QueryResult>({ queryKey: ["db-rows", dbId, viewId, search, { tag: extra.tag, x: extra.extraFilter ?? null, limit: extra.limit ?? 200 }], enabled: !!dbId && !!viewId && extra.enabled !== false, placeholderData: keepPreviousData, staleTime: 10_000,
    queryFn: () => api(`/api/databases/${dbId}/query`, { method: "POST", idempotencyKey: false, json: { viewId, search: search || undefined, limit: extra.limit ?? 200, ...(extra.extraFilter ? { extraFilter: extra.extraFilter } : {}) } }),
    refetchInterval: (query) => (query.state.data?.rows.some((r) => Object.values(r.values).some(isPending)) ? 2500 : false) });
}
export const useRowTemplates = (dbId: string | undefined) => useQuery<RowTemplate[]>({ queryKey: ["db-row-templates", dbId], enabled: !!dbId, staleTime: 60_000, queryFn: () => api(`/api/databases/${dbId}/row-templates`) });
export { orderedProps } from "./view-logic";
