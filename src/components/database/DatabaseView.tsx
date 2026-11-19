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
import { DbContext, useDatabase, useDb, useRowMutations, useViewMutations, usePropertyMutations, priorityPropsOf, mobileLayoutOf, useRowTemplates, orderedProps, type DbCtx } from "./hooks";
import { useWindow, findCachedRow } from "./window";
import { useUndoStack } from "./undo";
import { viewGroups } from "./group";
import { GROUPABLE } from "@/lib/databases/group";
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

export const SKIP_REASONS: Record<string, string> = { user_edited: "The value was typed by hand.", bad_config: "The AI property is not configured (prompt or choices missing).", already_queued: "A run is already in progress for this cell.", over_budget: "The daily AI budget is reached.", queue_unavailable: "The job queue is unavailable. Try again in a moment." };
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
  const [created, setFocusRow] = useState<string | null>(null);
  const isMobile = useIsPhone();
  const online = useOnline();

  const view: View | undefined = useMemo(() => db?.views.find((v) => v.id === viewId) ?? db?.views.find((v) => v.isDefault) ?? db?.views[0], [db, viewId]);
  useEffect(() => {
    if (!db || viewId) return;
    const saved = localStorage.getItem(`db-view-${db.id}`);
    if (saved && db.views.some((v) => v.id === saved)) setViewId(saved);
  }, [db, viewId]);
  const select = (id: string) => { setViewId(id); if (db) localStorage.setItem(`db-view-${db.id}`, id); };

  // 3.0: rows are loaded window by window. Table, board, list and gallery read this window (grouped views ask the server for the
  // group-first order and the whole-database counts); calendar and timeline run their own date-bounded queries.
  const groupProp = useMemo(() => (view && ["table", "board", "list"].includes(view.type) ? db?.properties.find((p) => p.id === view.config.groupBy && GROUPABLE.has(p.type)) : undefined), [db, view]);
  const windowed = !!view && view.type !== "calendar" && view.type !== "timeline";
  const win = useWindow(db?.id, view?.id, search, { groupBy: groupProp?.id ?? null, keep: view?.type === "table" && !(isMobile && view.config.mobileLayout !== "grid") ? 12 : 250, enabled: true });
  const rowsQ = { data: win.total || win.loaded.length || !win.loading ? { rows: win.loaded, total: win.total } : undefined, isLoading: win.loading, isError: !!win.error, error: win.error, isFetching: win.fetching, refetch: win.refetch };
  const undo = useUndoStack(!!db);
  const tplQ = useRowTemplates(db?.id);
  const rm = useRowMutations(db);
  const vm = useViewMutations(db, pageId);
  const pm = usePropertyMutations(db, pageId);
  const props = useMemo(() => (db ? sortedProps(db.properties) : []), [db]);
  const collapsedKey = (view?.config.collapsed ?? []).join("|");
  const collapsed = useMemo(() => new Set(view?.config.collapsed ?? []), [collapsedKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const groups = useMemo(() => viewGroups(groupProp, win.groups, win.total), [groupProp, win.groups, win.total]);
  const findRow = useCallback((rowId: string) => (db ? findCachedRow(qc, db.id, rowId) : undefined), [qc, db]);
  const updateMut = rm.update.mutateAsync;
  const bulk: DbCtx["bulk"] = useCallback(async (sel, action, label) => {
    if (!db || !view) return false;
    try {
      const r = await api<{ affected: number; opId: string | null }>(`/api/databases/${db.id}/rows/bulk`, { method: "POST", json: { action: action.type, ...(action.type === "update" ? { values: action.values } : {}), ...("ids" in sel ? { ids: sel.ids } : { all: { viewId: view.id, search: search || undefined, except: sel.all.except } }) } });
      const refresh = () => { qc.invalidateQueries({ queryKey: ["db-rows", db.id] }); if (action.type !== "update") qc.invalidateQueries({ queryKey: ["tree"] }); };
      refresh();
      if (r.opId) { const op = (redo: boolean) => api(`/api/databases/${db.id}/rows/undo`, { method: "POST", json: { opId: r.opId, redo } }).then(refresh); undo.push({ label: `${label} (${r.affected} row${r.affected === 1 ? "" : "s"})`, undo: () => op(false), redo: () => op(true) }); }
      toast(`${label}: ${r.affected} row${r.affected === 1 ? "" : "s"}`, r.opId ? { action: { label: "Undo", run: () => { void undo.undo(); } } } : {});
      return true;
    } catch (e: any) { toast(`${label} failed`, { description: e?.message, tone: "danger" }); return false; }
  }, [db, view, search, qc, undo]);

  // mutateAsync functions are stable across renders (the mutation result objects are not): keeps the context memo effective.
  const removeMut = rm.remove.mutateAsync; const restoreMut = rm.restore.mutateAsync;
  const removeRows = useCallback(async (ids: string[]) => {
    if (!ids.length || !db) return;
    try { await removeMut(ids); } catch { return; } // rolled back + toast by the mutation
    const again = () => api(`/api/databases/${db.id}/rows?ids=${ids.join(",")}`, { method: "DELETE" }).then(() => { qc.invalidateQueries({ queryKey: ["db-rows", db.id] }); qc.invalidateQueries({ queryKey: ["tree"] }); });
    undo.push({ label: ids.length === 1 ? "delete row" : `delete ${ids.length} rows`, undo: () => restoreMut(ids), redo: again });
    toast(ids.length === 1 ? "Row moved to the trash" : `${ids.length} rows moved to the trash`, {
      action: { label: "Undo", run: () => { void undo.undo(); } },
    });
  }, [removeMut, restoreMut, db, qc, undo]);
  const duplicateRow: DbCtx["duplicateRow"] = useCallback(async (rowId) => {
    if (!db) return null;
    try {
      const row = await api<RowOut>(`/api/databases/${db.id}/rows/duplicate`, { method: "POST", json: { id: rowId } });
      const refresh = () => { qc.invalidateQueries({ queryKey: ["db-rows", db.id] }); qc.invalidateQueries({ queryKey: ["tree"] }); }; refresh();
      undo.push({ label: "duplicate row", undo: () => api(`/api/databases/${db.id}/rows?ids=${row.id}`, { method: "DELETE" }).then(refresh), redo: () => restoreMut([row.id]) });
      toast("Row duplicated", { action: { label: "Undo", run: () => { void undo.undo(); } } }); return row;
    } catch (e: any) { toast("Could not duplicate the row", { description: e?.message, tone: "danger" }); return null; }
  }, [db, qc, undo, restoreMut]);

  const defaultTemplate = tplQ.data?.find((t) => t.isDefault)?.id ?? null;
  const ctx: DbCtx | null = useMemo(() => db && view ? {
    db, props, view, isMobile, search,
    visibleProps: orderedProps(props, view).filter((p) => p.type === "title" || !(view.config.hidden ?? []).includes(p.id)),
    win, groupProp, groups, collapsed, findRow, undo, bulk, duplicateRow, templates: tplQ.data ?? [], created,
    toggleGroup: (key) => { const next = new Set(collapsed); if (next.has(key)) next.delete(key); else next.add(key); vm.patchView.mutate({ id: view.id, config: { collapsed: [...next] } }); },
    priorityProps: priorityPropsOf(props, view),
    mobileLayout: mobileLayoutOf(view),
    rows: rowsQ.data?.rows ?? [], total: rowsQ.data?.total ?? 0, loading: rowsQ.isLoading,
    error: rowsQ.isError ? (rowsQ.error as Error) : null, fetching: rowsQ.isFetching, retry: () => { void rowsQ.refetch(); },
    // every cell edit is undoable: the previous values of the edited keys are re-sent on ⌘Z
    setCell: (rowId, values) => {
      const prev = findRow(rowId); const before: Record<string, unknown> = {}; for (const k of Object.keys(values)) before[k] = prev?.values[k] ?? null;
      rm.update.mutate({ rowId, values });
      if (prev) { const names = Object.keys(values).map((k) => props.find((p) => p.id === k)?.name ?? "value").join(", "); undo.push({ label: `edit ${names}`, undo: () => updateMut({ rowId, values: before }), redo: () => updateMut({ rowId, values }) }); }
    },
    addRow: async (values, title, opts) => {
      const r = await rm.create.mutateAsync({ values, title, ...(defaultTemplate ? { templateId: defaultTemplate } : {}) });
      if (opts?.open ?? view.type !== "table") setOpenRow(r.id);
      return r;
    },
    // `templateId`: a row template (undefined = the default template of the database when there is one, null = none)
    newRow: (preset, templateId) => {
      const tpl = templateId === undefined ? defaultTemplate : templateId;
      if (isMobile && !tpl) setNewRow({ preset: preset ?? {} });
      else rm.create.mutateAsync({ values: preset, ...(tpl ? { templateId: tpl } : {}) }).then((r) => {
        undo.push({ label: "new row", undo: () => removeMut([r.id]), redo: () => restoreMut([r.id]) });
        if (view.type !== "table" || tpl) setOpenRow(r.id); else setFocusRow(r.id);
      }).catch(() => { /* toast shown by the mutation */ });
    },
    removeRows,
    open: setOpenRow,
    openViewSettings: () => setSettingsOpen(true),
    patchView: (config) => vm.patchView.mutate({ id: view.id, config }),
    refresh: () => { qc.invalidateQueries({ queryKey: ["db", pageId] }); qc.invalidateQueries({ queryKey: ["db-rows", db.id] }); },
    // An AI cell is computed only on this explicit action. A value typed by hand is protected exactly as the API does: the run is
    // skipped (`user_edited`) and the user is asked before `force` is sent.
    regenerate: async (rowId, propertyId) => {
      const run = async (force: boolean) => {
        const r = await api<{ queued: number; skipped: { rowId: string; reason: string }[] }>(`/api/databases/${db.id}/ai`, { method: "POST", json: { rowId, propertyId, ...(force ? { force: true } : {}) } });
        if (r.queued) qc.setQueriesData<{ rows: RowOut[] }>({ queryKey: ["db-rows", db.id] }, (old: any) => old?.rows ? { ...old, rows: old.rows.map((x: RowOut) => (x.id === rowId ? { ...x, values: { ...x.values, [propertyId]: { pending: true, at: new Date().toISOString() } } } : x)) } : old);
        return r;
      };
      try {
        const r = await run(false); const why = r.skipped[0]?.reason;
        if (why === "user_edited") toast("This value was typed by hand", { description: "The AI did not replace it.", action: { label: "Replace with AI", run: () => { run(true).catch((e: any) => toast("Could not queue AI job", { description: e?.message, tone: "danger" })); } } });
        else if (why) toast("AI run skipped", { description: SKIP_REASONS[why] ?? why, tone: why === "already_queued" ? undefined : "danger" });
        qc.invalidateQueries({ queryKey: ["db-ai-runs", db.id] });
      } catch (e: any) { toast("Could not queue AI job", { description: e?.message, tone: "danger" }); }
    },
    addOption: async (propId, name) => {
      const p = props.find((x) => x.id === propId)!;
      const o: SelectOption = { id: newId(), name, color: pickColor((p.config.options ?? []).length), ...(p.type === "status" ? { group: "todo" as const } : {}) };
      await pm.update.mutateAsync({ id: propId, config: { ...p.config, options: [...(p.config.options ?? []), o] } });
      return o;
    },
  } : null, [db, props, view, win, groups, collapsed, isMobile, search, removeRows, bulk, duplicateRow, tplQ.data, undo.canUndo, undo.canRedo, created]); // eslint-disable-line react-hooks/exhaustive-deps

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

  void windowed;
  const fresh = db.properties.length <= 1 && (rowsQ.data ? rowsQ.data.total === 0 : false) && !search;
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
