"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Database as DbIcon, Plus, RefreshCw, SearchX, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Empty, Skeleton } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";
import { api } from "@/lib/client/api";
import { useIsPhone, useOnline } from "@/lib/client/hooks";
import type { RowOut, SelectOption, View } from "@/lib/databases/types";
import { sortedProps, newId, pickColor } from "@/lib/databases/values";
import { DbContext, useDatabase, useDb, useRows, useRowMutations, useViewMutations, usePropertyMutations, priorityPropsOf, mobileLayoutOf, type DbCtx } from "./hooks";
import { describeFilter } from "./FilterBuilder";
import { ViewTabs } from "./ViewTabs";
import { Toolbar } from "./Toolbar";
import { TemplateChooser } from "./TemplateChooser";
import { RowPeek } from "./RowPeek";
import { NewRowSheet } from "./NewRowSheet";
import { TableView } from "./views/TableView";
import { BoardView } from "./views/BoardView";
import { CalendarView } from "./views/CalendarView";
import { GalleryView } from "./views/GalleryView";
import { TimelineView } from "./views/TimelineView";
import { ListView } from "./views/ListView";

const VIEWS = { table: TableView, board: BoardView, calendar: CalendarView, gallery: GalleryView, timeline: TimelineView, list: ListView } as const;

export function DatabaseView({ pageId }: { pageId: string }) {
  const qc = useQueryClient();
  const dbQ = useDatabase(pageId);
  const db = dbQ.data;
  const [viewId, setViewId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [newRow, setNewRow] = useState<{ preset: Record<string, unknown> } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [skipTemplates, setSkipTemplates] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const isMobile = useIsPhone();
  const online = useOnline();

  const view: View | undefined = useMemo(() => db?.views.find((v) => v.id === viewId) ?? db?.views.find((v) => v.isDefault) ?? db?.views[0], [db, viewId]);
  useEffect(() => {
    if (!db || viewId) return;
    const saved = localStorage.getItem(`db-view-${db.id}`);
    if (saved && db.views.some((v) => v.id === saved)) setViewId(saved);
  }, [db, viewId]);
  const select = (id: string) => { setViewId(id); if (db) localStorage.setItem(`db-view-${db.id}`, id); };

  const rowsQ = useRows(db?.id, view?.id, search);
  const rm = useRowMutations(db);
  const vm = useViewMutations(db, pageId);
  const pm = usePropertyMutations(db, pageId);
  const props = useMemo(() => (db ? sortedProps(db.properties) : []), [db]);

  // mutateAsync functions are stable across renders (the mutation result objects are not): keeps the context memo effective.
  const removeMut = rm.remove.mutateAsync; const restoreMut = rm.restore.mutateAsync;
  const removeRows = useCallback(async (ids: string[]) => {
    if (!ids.length) return;
    try { await removeMut(ids); } catch { return; } // rolled back + toast by the mutation
    toast(ids.length === 1 ? "Row moved to the trash" : `${ids.length} rows moved to the trash`, {
      action: { label: "Undo", run: async () => { try { await restoreMut(ids); } catch { /* toast shown by the mutation */ } } },
    });
  }, [removeMut, restoreMut]);

  const ctx: DbCtx | null = useMemo(() => db && view ? {
    db, props, view, isMobile, search,
    visibleProps: props.filter((p) => p.type === "title" || !(view.config.hidden ?? []).includes(p.id)),
    priorityProps: priorityPropsOf(props, view),
    mobileLayout: mobileLayoutOf(view),
    rows: rowsQ.data?.rows ?? [], total: rowsQ.data?.total ?? 0, loading: rowsQ.isLoading,
    error: rowsQ.isError ? (rowsQ.error as Error) : null, fetching: rowsQ.isFetching, retry: () => { void rowsQ.refetch(); },
    setCell: (rowId, values) => rm.update.mutate({ rowId, values }),
    addRow: async (values, title, opts) => {
      const r = await rm.create.mutateAsync({ values, title });
      if (opts?.open ?? view.type !== "table") setOpenRow(r.id);
      return r;
    },
    newRow: (preset) => {
      if (isMobile) setNewRow({ preset: preset ?? {} });
      else rm.create.mutateAsync({ values: preset }).then((r) => { if (view.type !== "table") setOpenRow(r.id); }).catch(() => { /* toast shown by the mutation */ });
    },
    removeRows,
    open: setOpenRow,
    openViewSettings: () => setSettingsOpen(true),
    patchView: (config) => vm.patchView.mutate({ id: view.id, config }),
    refresh: () => { qc.invalidateQueries({ queryKey: ["db", pageId] }); qc.invalidateQueries({ queryKey: ["db-rows", db.id] }); },
    regenerate: async (rowId, propertyId) => {
      try {
        await api(`/api/databases/${db.id}/ai`, { method: "POST", json: { rowId, propertyId } });
        qc.setQueriesData<{ rows: RowOut[] }>({ queryKey: ["db-rows", db.id] }, (old: any) => old ? { ...old, rows: old.rows.map((r: RowOut) => (r.id === rowId ? { ...r, values: { ...r.values, [propertyId]: { pending: true, at: new Date().toISOString() } } } : r)) } : old);
      } catch (e: any) { toast("Could not queue AI job", { description: e?.message, tone: "danger" }); }
    },
    addOption: async (propId, name) => {
      const p = props.find((x) => x.id === propId)!;
      const o: SelectOption = { id: newId(), name, color: pickColor((p.config.options ?? []).length), ...(p.type === "status" ? { group: "todo" as const } : {}) };
      await pm.update.mutateAsync({ id: propId, config: { ...p.config, options: [...(p.config.options ?? []), o] } });
      return o;
    },
  } : null, [db, props, view, rowsQ.data, rowsQ.isLoading, rowsQ.isError, rowsQ.isFetching, isMobile, search, removeRows]); // eslint-disable-line react-hooks/exhaustive-deps

  if (dbQ.isLoading) return <DatabaseSkeleton />;
  if (dbQ.isError || !db || !view || !ctx) {
    return (
      <div role="alert">
        <Empty
          icon={<DbIcon />}
          title="Database unavailable"
          hint={(dbQ.error as any)?.message ?? "The database could not be loaded."}
          action={<Button size="sm" className="max-md:h-11 max-md:px-4" onClick={() => dbQ.refetch()}><RefreshCw /> Retry</Button>}
        />
      </div>
    );
  }

  const fresh = db.properties.length <= 1 && (rowsQ.data ? rowsQ.data.total === 0 : false);
  const choosingTemplate = showTemplates || (fresh && !skipTemplates);
  const V = VIEWS[view.type] ?? TableView;
  return (
    <DbContext.Provider value={ctx}>
      <div className="min-w-0 space-y-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-line pb-1">
          <ViewTabs db={db} view={view} onSelect={select} settingsOpen={settingsOpen} onSettingsOpenChange={setSettingsOpen} />
          <div className="ml-auto min-w-0 max-md:w-full"><Toolbar search={search} setSearch={setSearch} onShowTemplates={() => setShowTemplates(true)} /></div>
        </div>
        {!online && (
          <div role="status" className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/15 px-3 py-2 text-[13px] leading-5">
            <WifiOff className="mt-0.5 size-4 shrink-0" />
            <span>You are offline. Changes to rows cannot be saved until the connection is back; a new-row draft stays on this device.</span>
          </div>
        )}
        {choosingTemplate ? (
          <TemplateChooser
            dbId={db.id}
            onDone={() => { setShowTemplates(false); setSkipTemplates(true); ctx.refresh(); qc.invalidateQueries({ queryKey: ["tree"] }); }}
            onSkip={() => { setShowTemplates(false); setSkipTemplates(true); }}
          />
        ) : null}
        {!(fresh && !skipTemplates) && (
          <div className={rowsQ.isFetching && !rowsQ.isLoading ? "min-w-0 opacity-90 transition-opacity" : "min-w-0"} aria-busy={rowsQ.isFetching}>
            <ViewBody><V /></ViewBody>
          </div>
        )}
      </div>
      <RowPeek rowId={openRow} onClose={() => setOpenRow(null)} />
      <NewRowSheet open={!!newRow} preset={newRow?.preset ?? {}} onClose={() => setNewRow(null)} />
    </DbContext.Provider>
  );
}

/** Loading, error and empty states shared by the six views. */
function ViewBody({ children }: { children: React.ReactNode }) {
  const ctx = useDb();
  const { view } = ctx;
  if (ctx.loading) return <RowsSkeleton cards={ctx.isMobile || view.type !== "table"} />;

  if (ctx.error && !ctx.rows.length) {
    return (
      <div role="alert">
        <Empty
          icon={<AlertTriangle />}
          title="Could not load the rows"
          hint={ctx.error.message || "Check your connection and try again."}
          action={<Button size="sm" className="max-md:h-11 max-md:px-4" onClick={ctx.retry}><RefreshCw /> Retry</Button>}
        />
      </div>
    );
  }

  // A view that still needs a property (board group, calendar date, timeline start) explains that itself.
  const needsSetup = (view.type === "board" && !view.config.groupBy) || (view.type === "calendar" && !view.config.dateProperty) || (view.type === "timeline" && !view.config.startProperty);
  // On desktop the grid and the board keep their structure when empty: header / columns with their own "New" buttons.
  const keepsStructure = !ctx.isMobile && (view.type === "table" || view.type === "board");
  const filters = describeFilter(view.config.filter);
  const narrowed = !!ctx.search || filters > 0;

  let body = children;
  if (!ctx.rows.length && !needsSetup && !keepsStructure) {
    body = narrowed ? (
      <Empty
        icon={<SearchX />}
        title="No row matches"
        hint={ctx.search ? `Nothing matches “${ctx.search}”${filters ? ` with ${filters} filter${filters > 1 ? "s" : ""}` : ""}.` : `${filters} filter${filters > 1 ? "s are" : " is"} hiding every row of this view.`}
        action={
          <div className="flex flex-wrap justify-center gap-2">
            {filters > 0 && <Button size="sm" variant="outline" className="max-md:h-11 max-md:px-4" onClick={() => ctx.patchView({ filter: null })}>Clear filters</Button>}
            <Button size="sm" className="max-md:h-11 max-md:px-4" onClick={() => ctx.newRow()}><Plus /> New</Button>
          </div>
        }
      />
    ) : (
      <Empty
        icon={<DbIcon />}
        title="No rows yet"
        hint="Add the first row to this database."
        action={<Button size="sm" className="max-md:h-11 max-md:px-4" onClick={() => ctx.newRow()}><Plus /> New</Button>}
      />
    );
  }
  return (
    <>
      {ctx.error && ctx.rows.length > 0 && (
        <div role="alert" className="mb-2 flex items-center gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-1.5 text-[13px]">
          <AlertTriangle className="size-4 shrink-0 text-danger" />
          <span className="min-w-0 flex-1">Could not refresh — showing the last loaded rows.</span>
          <button type="button" onClick={ctx.retry} className="h-8 shrink-0 rounded-md px-2 font-medium underline-offset-2 hover:underline max-md:h-11 max-md:px-3">Retry</button>
        </div>
      )}
      {body}
    </>
  );
}

function DatabaseSkeleton() {
  return (
    <div role="status" aria-label="Loading database" className="space-y-3 py-2">
      <div className="flex gap-2"><Skeleton className="h-9 w-24" /><Skeleton className="h-9 w-20" /><Skeleton className="ml-auto h-9 w-20" /></div>
      <RowsSkeleton cards />
    </div>
  );
}
function RowsSkeleton({ cards }: { cards: boolean }) {
  return (
    <div role="status" aria-label="Loading rows" className={cards ? "space-y-2" : "space-y-px overflow-hidden rounded-lg border border-line"}>
      {Array.from({ length: cards ? 4 : 7 }, (_, i) => <Skeleton key={i} className={cards ? "h-20 rounded-xl" : "h-9 rounded-none"} />)}
    </div>
  );
}
