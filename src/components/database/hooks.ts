"use client";
import { createContext, useContext, useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { api } from "@/lib/client/api";
import { toast } from "@/components/ui/toast";
import type { Database, Property, View, ViewConfig, RowOut, QueryResult, FilterGroup, Sort, SelectOption } from "@/lib/databases/types";
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
  newRow: (preset?: Record<string, unknown>) => void;
  /** Moves rows to the trash and offers Undo. */
  removeRows: (ids: string[]) => Promise<void>;
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
const patchRows = (qc: ReturnType<typeof useQueryClient>, dbId: string, fn: (rows: RowOut[]) => RowOut[]) => qc.setQueriesData<QueryResult>({ queryKey: ["db-rows", dbId] }, (old) => (old ? { ...old, rows: fn(old.rows), total: old.total } : old));
export function useRowMutations(db: Database | undefined) {
  const qc = useQueryClient(); const dbId = db?.id ?? ""; const tp = db ? titleProp(db.properties) : undefined;
  const update = useMutation({
    mutationFn: ({ rowId, values }: { rowId: string; values: Record<string, unknown> }) => api<RowOut>(`/api/databases/${dbId}/rows`, { method: "PATCH", json: { id: rowId, values } }),
    onMutate: async ({ rowId, values }) => { await qc.cancelQueries({ queryKey: ["db-rows", dbId] }); const prev = qc.getQueriesData<QueryResult>({ queryKey: ["db-rows", dbId] }); patchRows(qc, dbId, (rows) => rows.map((r) => (r.id === rowId ? { ...r, values: { ...r.values, ...values }, title: tp && tp.id in values ? String(values[tp.id] ?? "") : r.title } : r))); return { prev }; },
    onError: (e: any, _v, ctx) => { ctx?.prev.forEach(([k, d]) => qc.setQueryData(k, d)); toast("Save failed", { description: e?.message, tone: "danger" }); },
    onSuccess: (row) => patchRows(qc, dbId, (rows) => rows.map((r) => (r.id === row.id ? row : r))),
  });
  const create = useMutation({
    mutationFn: (input: { values?: Record<string, unknown>; title?: string }) => api<RowOut>(`/api/databases/${dbId}/rows`, { method: "POST", json: input }),
    onSuccess: (row) => { patchRows(qc, dbId, (rows) => (rows.some((r) => r.id === row.id) ? rows : [...rows, row])); qc.invalidateQueries({ queryKey: ["db-rows", dbId] }); },
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
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["tree"] }); },
  });
  return { update, create, remove, restore };
}
export function useViewMutations(db: Database | undefined, pageId: string) {
  const qc = useQueryClient(); const dbId = db?.id ?? ""; const inv = () => qc.invalidateQueries({ queryKey: ["db", pageId] });
  const patchView = useMutation({
    mutationFn: ({ id, ...patch }: { id: string; name?: string; type?: string; config?: Partial<ViewConfig>; isDefault?: boolean }) => api<View>(`/api/databases/${dbId}/views`, { method: "PATCH", json: { id, ...patch } }),
    onMutate: async (v) => { await qc.cancelQueries({ queryKey: ["db", pageId] }); qc.setQueryData<Database>(["db", pageId], (old) => old ? { ...old, views: old.views.map((x) => (x.id === v.id ? { ...x, ...(v.name ? { name: v.name } : {}), ...(v.type ? { type: v.type as any } : {}), config: { ...x.config, ...(v.config ?? {}) } } : x)) } : old); },
    onSuccess: (view) => { qc.setQueryData<Database>(["db", pageId], (old) => old ? { ...old, views: old.views.map((x) => (x.id === view.id ? view : x)) } : old); qc.invalidateQueries({ queryKey: ["db-rows", dbId] }); },
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
  const reorder = useMutation({ mutationFn: (order: string[]) => api(`/api/databases/${dbId}/properties`, { method: "PATCH", json: { order } }), onMutate: (order) => { qc.setQueryData<Database>(["db", pageId], (old) => old ? { ...old, properties: sortedProps(old.properties).map((p) => ({ ...p, position: order.indexOf(p.id) + 1 })) } : old); }, onSuccess: inv });
  return { create, update, remove, reorder };
}
export function useMedia(query: string) {
  const [m, setM] = useState(false);
  useEffect(() => { const mq = matchMedia(query); const h = () => setM(mq.matches); h(); mq.addEventListener("change", h); return () => mq.removeEventListener("change", h); }, [query]);
  return m;
}
export const useAllDatabases = () => useQuery<{ id: string; pageId: string; name: string; icon: string | null; rowCount: number; isTemplate: boolean }[]>({ queryKey: ["databases"], queryFn: () => api("/api/databases") });
export const useRemoteDatabase = (id: string | undefined | null) => useQuery<Database>({ queryKey: ["db", id], enabled: !!id, queryFn: () => api(`/api/databases/${id}`) });
