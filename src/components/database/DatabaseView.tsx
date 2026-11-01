"use client";
import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Database as DbIcon } from "lucide-react";
import { Spinner, Empty } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";
import { api } from "@/lib/client/api";
import type { RowOut, SelectOption, View } from "@/lib/databases/types";
import { sortedProps, newId, pickColor } from "@/lib/databases/values";
import { DbContext, useDatabase, useRows, useRowMutations, useViewMutations, usePropertyMutations, useMedia, type DbCtx } from "./hooks";
import { ViewTabs } from "./ViewTabs";
import { Toolbar } from "./Toolbar";
import { TemplateChooser } from "./TemplateChooser";
import { RowPeek } from "./RowPeek";
import { TableView } from "./views/TableView";
import { BoardView } from "./views/BoardView";
import { CalendarView } from "./views/CalendarView";
import { GalleryView } from "./views/GalleryView";
import { TimelineView } from "./views/TimelineView";
import { ListView } from "./views/ListView";

const VIEWS = { table: TableView, board: BoardView, calendar: CalendarView, gallery: GalleryView, timeline: TimelineView, list: ListView } as const;
export function DatabaseView({ pageId }: { pageId: string }) {
  const qc = useQueryClient(); const { data: db, isLoading, error } = useDatabase(pageId);
  const [viewId, setViewId] = useState<string | null>(null); const [search, setSearch] = useState(""); const [openRow, setOpenRow] = useState<string | null>(null); const [skipTemplates, setSkipTemplates] = useState(false); const [showTemplates, setShowTemplates] = useState(false);
  const isMobile = useMedia("(max-width: 639px)");
  const view: View | undefined = useMemo(() => db?.views.find((v) => v.id === viewId) ?? db?.views.find((v) => v.isDefault) ?? db?.views[0], [db, viewId]);
  useEffect(() => { if (db && !viewId) { const saved = localStorage.getItem(`db-view-${db.id}`); if (saved && db.views.some((v) => v.id === saved)) setViewId(saved); } }, [db, viewId]);
  const select = (id: string) => { setViewId(id); if (db) localStorage.setItem(`db-view-${db.id}`, id); };
  const rowsQ = useRows(db?.id, view?.id, search); const rm = useRowMutations(db); const vm = useViewMutations(db, pageId); const pm = usePropertyMutations(db, pageId);
  const props = useMemo(() => (db ? sortedProps(db.properties) : []), [db]);
  const ctx: DbCtx | null = useMemo(() => db && view ? {
    db, props, visibleProps: props.filter((p) => p.type === "title" || !(view.config.hidden ?? []).includes(p.id)), view, rows: rowsQ.data?.rows ?? [], total: rowsQ.data?.total ?? 0, loading: rowsQ.isLoading, isMobile, search,
    setCell: (rowId, values) => rm.update.mutate({ rowId, values }),
    addRow: async (values, title) => { const r = await rm.create.mutateAsync({ values, title }); if (view.type !== "table") setOpenRow(r.id); return r; },
    removeRows: async (ids) => { await rm.remove.mutateAsync(ids); },
    open: setOpenRow, patchView: (config) => vm.patchView.mutate({ id: view.id, config }), refresh: () => { qc.invalidateQueries({ queryKey: ["db", pageId] }); qc.invalidateQueries({ queryKey: ["db-rows", db.id] }); },
    regenerate: async (rowId, propertyId) => { try { await api(`/api/databases/${db.id}/ai`, { method: "POST", json: { rowId, propertyId } }); qc.setQueriesData<{ rows: RowOut[] }>({ queryKey: ["db-rows", db.id] }, (old: any) => old ? { ...old, rows: old.rows.map((r: RowOut) => (r.id === rowId ? { ...r, values: { ...r.values, [propertyId]: { pending: true, at: new Date().toISOString() } } } : r)) } : old); } catch (e: any) { toast("Could not queue AI job", { description: e?.message, tone: "danger" }); } },
    addOption: async (propId, name) => { const p = props.find((x) => x.id === propId)!; const o: SelectOption = { id: newId(), name, color: pickColor((p.config.options ?? []).length), ...(p.type === "status" ? { group: "todo" as const } : {}) }; await pm.update.mutateAsync({ id: propId, config: { ...p.config, options: [...(p.config.options ?? []), o] } }); return o; },
  } : null, [db, props, view, rowsQ.data, rowsQ.isLoading, isMobile, search]); // eslint-disable-line react-hooks/exhaustive-deps
  if (isLoading) return <div className="flex items-center gap-2 py-8 text-[13px] text-fg-muted"><Spinner /> Loading database…</div>;
  if (error || !db || !view || !ctx) return <Empty icon={<DbIcon />} title="Database unavailable" hint={(error as any)?.message} />;
  const fresh = db.properties.length <= 1 && (rowsQ.data ? rowsQ.data.total === 0 : false);
  const V = VIEWS[view.type] ?? TableView;
  return (
    <DbContext.Provider value={ctx}>
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-line pb-1"><ViewTabs db={db} view={view} onSelect={select} /><div className="ml-auto"><Toolbar search={search} setSearch={setSearch} onShowTemplates={() => setShowTemplates(true)} /></div></div>
        {(showTemplates || (fresh && !skipTemplates)) ? <TemplateChooser dbId={db.id} onDone={() => { setShowTemplates(false); setSkipTemplates(true); ctx.refresh(); qc.invalidateQueries({ queryKey: ["tree"] }); }} onSkip={() => { setShowTemplates(false); setSkipTemplates(true); }} /> : null}
        {!(fresh && !skipTemplates) && <div className={rowsQ.isFetching && !rowsQ.isLoading ? "opacity-90 transition-opacity" : ""}><V /></div>}
      </div>
      <RowPeek rowId={openRow} onClose={() => setOpenRow(null)} />
    </DbContext.Provider>
  );
}
