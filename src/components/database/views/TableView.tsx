"use client";
/**
 * File: src/components/database/views/TableView.tsx
 * Description: table view. 3.0 (Databases Next Generation): the grid is virtualised (fixed 36 px rows, only the rows on screen are in
 *   the DOM) and reads the view window by window, so a 20 000-row database scrolls like a 50-row one; full keyboard navigation
 *   (arrows, Enter, Tab / Shift+Tab, type-to-edit, Delete, Escape); multi-selection with select-all and shift-range, bulk actions;
 *   groups with server-side counts and aggregates, collapsible (saved with the view); per-view column order, width and visibility;
 *   column footers. Phones get one card per row by default; the real grid stays one tap away ("View options" → Grid).
 * Author: Simon-Pierre Boucher · contact@spboucher.ai
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { DndContext, PointerSensor, useSensor, useSensors, closestCenter, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Plus, GripVertical, ChevronRight, ChevronLeft, EyeOff } from "lucide-react";
import { api } from "@/lib/client/api";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import type { Property, RowOut, NumAgg } from "@/lib/databases/types";
import { READONLY_TYPES } from "@/lib/databases/types";
import { fmtNumber } from "@/lib/databases/values";
import { useDb } from "../hooks";
import { Cell, type CellNav } from "../cells/Cell";
import { TypeIcon } from "../meta";
import { PropertyEditor } from "../PropertyEditor";
import { layout, entryAt, type Entry } from "../view-logic";
import { ResponsivePanel } from "../Responsive";
import { RowCard } from "./RowCard";
import { OPTION_CLASS } from "../colors";
import { BulkBar, type Selection, selCount, isSelected } from "../BulkBar";
import { useGrowing, rowsOfGroup, LoadMore } from "../growing";
import { AiColumnActions, AiRunsDrawer } from "../SmartProperty";

const MIN_W = 80;
/** Sticky title column on phones: narrow enough to leave room to scroll the other columns at 360 px. */
const PHONE_TITLE_W = 148;
export const ROW_H = 36;
const OVERSCAN = 8;
const TYPABLE = new Set(["title", "text", "number", "url"]);
const FOOTERS = ["sum", "avg", "min", "max"] as const;

/** Table view. Phones get one card per row by default; the real grid stays one tap away ("View options" → Grid). */
export function TableView() {
  const ctx = useDb();
  return ctx.isMobile && ctx.mobileLayout === "cards" ? <CardsLayout /> : <GridLayout />;
}
/** Short text of a group's numeric aggregates: "Estimate Σ 1,234 · ⌀ 61.7" for the first two number columns in view. */
export function groupSummary(cols: Property[], aggs: Record<string, NumAgg>): string {
  return cols.filter((p) => aggs[p.id]).slice(0, 2).map((p) => `${p.name} Σ ${fmtNumber(Math.round(aggs[p.id].sum * 100) / 100, p.config.format)} · ⌀ ${fmtNumber(Math.round(aggs[p.id].avg * 100) / 100, p.config.format === "integer" ? undefined : p.config.format)}`).join("   ");
}

function CardsLayout() {
  const ctx = useDb(); const gb = ctx.groupProp; const { shown, more } = useGrowing();
  return (
    <div className="space-y-4">
      {ctx.groups.map((g) => (g.count || !gb) ? (
        <section key={g.key} aria-label={gb ? g.label : "Rows"}>
          {gb && (
            <h3 className="mb-1.5 flex items-center gap-1.5">
              <button type="button" aria-expanded={!ctx.collapsed.has(g.key)} aria-label={`${ctx.collapsed.has(g.key) ? "Expand" : "Collapse"} group ${g.label}`} onClick={() => ctx.toggleGroup(g.key)} className="grid size-11 shrink-0 place-items-center rounded-lg text-fg-muted active:bg-bg-sunk"><ChevronRight className={cn("size-5 transition-transform motion-reduce:transition-none", !ctx.collapsed.has(g.key) && "rotate-90")} /></button>
              <span className={cn("rounded-md px-2 py-0.5 text-[13px] font-medium", OPTION_CLASS[g.color])}>{g.label}</span>
              <span className="text-[13px] tabular-nums text-fg-muted" data-group-count={g.key}>{g.count}</span>
            </h3>
          )}
          {!(gb && ctx.collapsed.has(g.key)) && <>
            <ul className="space-y-2">{rowsOfGroup(ctx.win, g, shown).map((r) => <li key={r.id}><RowCard row={r} exclude={gb?.id} /></li>)}</ul>
            {gb && (
              <button type="button" onClick={() => ctx.newRow(g.value === undefined ? {} : { [gb.id]: g.value })} className="mt-1.5 flex h-11 w-full items-center gap-1.5 rounded-xl border border-dashed border-line px-3 text-[14px] text-fg-muted active:bg-bg-sunk">
                <Plus className="size-4" /> New in {g.label}
              </button>
            )}
          </>}
        </section>
      ) : null)}
      <LoadMore shown={shown} more={more} />
      <p className="text-[12px] tabular-nums text-fg-faint">{ctx.total} row{ctx.total === 1 ? "" : "s"}{ctx.rows.length < ctx.total ? ` · ${ctx.rows.length} loaded` : ""}</p>
    </div>
  );
}

function GridLayout() {
  const ctx = useDb(); const cols = ctx.visibleProps; const widths = ctx.view.config.widths ?? {}; const { win } = ctx;
  const [editing, setEditing] = useState<{ key: string; seed: string | null } | null>(null); const [sel, setSel] = useState<Selection>({ all: false, ids: new Set() }); const [editProp, setEditProp] = useState<string | null>(null); const [adding, setAdding] = useState(false);
  const [runs, setRuns] = useState<string | null>(null);
  const [localW, setLocalW] = useState<Record<string, number>>({}); const w = (p: Property) => { const base = localW[p.id] ?? widths[p.id] ?? p.width ?? (p.type === "title" ? 260 : 180); return ctx.isMobile && p.type === "title" ? Math.min(base, PHONE_TITLE_W) : base; };
  const gb = ctx.groupProp; const filtered = !!ctx.view.config.filter && (ctx.view.config.filter.and ?? ctx.view.config.filter.or ?? []).length > 0;
  const canReorder = !gb && !(ctx.view.config.sorts?.length) && !ctx.search && !filtered; const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const { segs, lines } = useMemo(() => layout(ctx.groups, !!gb, ctx.collapsed, win.total), [ctx.groups, gb, ctx.collapsed, win.total]);

  // ---------- virtual window
  const box = useRef<HTMLDivElement>(null); const [scroll, setScroll] = useState({ top: 0, height: 600 }); const raf = useRef(0);
  const measure = useCallback(() => { const el = box.current; if (el) setScroll((s) => (s.top === el.scrollTop && s.height === el.clientHeight ? s : { top: el.scrollTop, height: el.clientHeight })); }, []);
  useLayoutEffect(() => { measure(); const el = box.current; if (!el || typeof ResizeObserver === "undefined") return; const ro = new ResizeObserver(measure); ro.observe(el); return () => ro.disconnect(); }, [measure]);
  const onScroll = () => { cancelAnimationFrame(raf.current); raf.current = requestAnimationFrame(measure); };
  const first = Math.max(0, Math.floor(scroll.top / ROW_H) - OVERSCAN); const last = Math.min(lines, Math.ceil((scroll.top + scroll.height) / ROW_H) + OVERSCAN);
  const entries: { v: number; e: Entry }[] = []; for (let v = first; v < last; v++) { const e = entryAt(segs, v); if (e) entries.push({ v, e }); }
  const visRows = entries.filter((x) => x.e.t === "row").map((x) => (x.e as { i: number }).i); const lo = visRows.length ? Math.min(...visRows) : 0, hi = visRows.length ? Math.max(...visRows) + 1 : 0;
  useEffect(() => { win.ensure(hi > lo ? [[Math.max(0, lo - 40), Math.min(Math.max(win.total, 1), hi + 40)]] : [[0, 1]]); }, [lo, hi, win.ensure]); // eslint-disable-line react-hooks/exhaustive-deps
  const visRowIds = entries.map((x) => (x.e.t === "row" ? win.rowAt(x.e.i)?.id : undefined)).filter((x): x is string => !!x);

  // A row created with "New" lands at the end of the manual order: the grid goes there. In a sorted, grouped, filtered or searched
  // view its place is not known without loading everything: a toast offers to open it instead.
  const goEnd = useRef<string | null>(null); const seen = useRef<string | null>(ctx.created);
  useEffect(() => {
    if (!ctx.created || ctx.created === seen.current) return; seen.current = ctx.created;
    if (canReorder) { goEnd.current = ctx.created; setTimeout(() => { goEnd.current = null; }, 4000); } else { const id = ctx.created; toast("Row created", { description: "It is placed by the sort, group or filter of this view.", action: { label: "Open", run: () => ctx.open(id) } }); }
  }, [ctx.created]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (goEnd.current && box.current) { box.current.scrollTop = box.current.scrollHeight; if (visRowIds.includes(goEnd.current)) goEnd.current = null; } });

  // ---------- keyboard navigation: one active cell (line, column); focus follows it, the window scrolls to it
  const [active, setActive] = useState<{ v: number; c: number } | null>(null); const wantFocus = useRef(false);
  const focusCell = useCallback((v: number, c: number) => {
    const el = box.current; if (!el) return; const y = v * ROW_H; const chrome = 2 * ROW_H; // sticky header + footer
    if (y < el.scrollTop) el.scrollTop = y; else if (y + ROW_H > el.scrollTop + el.clientHeight - chrome) el.scrollTop = y + ROW_H - (el.clientHeight - chrome);
    wantFocus.current = true; setActive({ v, c }); measure();
  }, [measure]);
  useEffect(() => { if (!wantFocus.current || !active || editing) return; const t = box.current?.querySelector<HTMLElement>(`[data-cell="${active.v}:${active.c}"]`); if (t) { wantFocus.current = false; t.focus({ preventScroll: true }); t.scrollIntoView({ block: "nearest", inline: "nearest" }); } });
  /** Next line holding a row, from `v` in direction `d` (skips group headers and "New" lines). */
  const rowLine = useCallback((v: number, d: 1 | -1): number => { for (let x = v + d; x >= 0 && x < lines; x += d) if (entryAt(segs, x)?.t === "row") return x; return -1; }, [segs, lines]);
  const move = useCallback((v: number, c: number, d: CellNav | "up") => {
    if (d === "stay") return focusCell(v, c);
    if (d === "down" || d === "up") { const n = rowLine(v, d === "down" ? 1 : -1); return focusCell(n < 0 ? v : n, c); }
    let nc = c + (d === "right" ? 1 : -1), nv = v;
    if (nc >= cols.length) { const n = rowLine(v, 1); if (n < 0) nc = c; else { nv = n; nc = 0; } } else if (nc < 0) { const n = rowLine(v, -1); if (n < 0) nc = c; else { nv = n; nc = cols.length - 1; } }
    focusCell(nv, nc);
  }, [cols.length, rowLine, focusCell]);
  const stopEdit = useCallback((d: CellNav | null) => { setEditing(null); if (active) { if (d) move(active.v, active.c, d); else { wantFocus.current = true; } } }, [active, move]);
  const nav = (e: React.KeyboardEvent) => {
    const target = e.target as HTMLElement; const el = target.closest<HTMLElement>("[data-cell]"); if (!el || editing) return;
    const [v, c] = el.dataset.cell!.split(":").map(Number); const ent = entryAt(segs, v); const row = ent?.t === "row" ? win.rowAt(ent.i) : undefined; const p = cols[c];
    // 3.0 (U5): Enter / Space on a real control inside the cell (the "Open" button, an AI action, a link) belong to that control
    const inner = target !== el && !!target.closest("button:not([role='checkbox']), a, input, textarea, select");
    if (e.key === "ArrowDown") { e.preventDefault(); move(v, c, "down"); } else if (e.key === "ArrowUp") { e.preventDefault(); move(v, c, "up"); }
    else if (e.key === "ArrowRight") { e.preventDefault(); if (c + 1 < cols.length) focusCell(v, c + 1); } else if (e.key === "ArrowLeft") { e.preventDefault(); if (c > 0) focusCell(v, c - 1); }
    else if (e.key === "Tab") { const edge = e.shiftKey ? (c === 0 && rowLine(v, -1) < 0) : (c === cols.length - 1 && rowLine(v, 1) < 0); if (!edge) { e.preventDefault(); move(v, c, e.shiftKey ? "left" : "right"); } } // at the last / first cell Tab leaves the grid
    else if (e.key === "Home") { e.preventDefault(); focusCell(e.ctrlKey || e.metaKey ? rowLine(-1, 1) : v, 0); } else if (e.key === "End") { e.preventDefault(); focusCell(e.ctrlKey || e.metaKey ? rowLine(lines, -1) : v, cols.length - 1); }
    else if (e.key === "PageDown" || e.key === "PageUp") { e.preventDefault(); const jump = Math.max(1, Math.floor(scroll.height / ROW_H) - 3); let n = v; for (let k = 0; k < jump; k++) { const x = rowLine(n, e.key === "PageDown" ? 1 : -1); if (x < 0) break; n = x; } focusCell(n, c); }
    else if (!row || !p || inner) return;
    else if (e.key === "Enter" || e.key === "F2") { e.preventDefault(); if (p.type === "checkbox") ctx.setCell(row.id, { [p.id]: !row.values[p.id] }); else if (READONLY_TYPES.has(p.type) && p.type !== "ai") ctx.open(row.id); else { setActive({ v, c }); setEditing({ key: `${row.id}:${p.id}`, seed: null }); } }
    else if (e.key === " ") { e.preventDefault(); if (p.type === "checkbox") ctx.setCell(row.id, { [p.id]: !row.values[p.id] }); else if (p.type === "title") ctx.open(row.id); else if (!READONLY_TYPES.has(p.type)) { setActive({ v, c }); setEditing({ key: `${row.id}:${p.id}`, seed: null }); } }
    else if ((e.key === "Backspace" || e.key === "Delete") && !READONLY_TYPES.has(p.type) && p.type !== "title") { e.preventDefault(); if (row.values[p.id] != null && row.values[p.id] !== "" && row.values[p.id] !== false) ctx.setCell(row.id, { [p.id]: p.type === "checkbox" ? false : null }); }
    else if (e.key === "Escape") { if (selCount(sel, win.total)) { e.preventDefault(); setSel({ all: false, ids: new Set() }); } }
    else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && TYPABLE.has(p.type)) { e.preventDefault(); setActive({ v, c }); setEditing({ key: `${row.id}:${p.id}`, seed: e.key }); } // type-to-edit
  };

  // ---------- columns: width (drag the edge), order (drag the header, or Move left / right), visibility — all saved with the view
  const resizing = useRef(false);
  const startResize = (p: Property, e: React.PointerEvent) => { e.preventDefault(); e.stopPropagation(); resizing.current = true; const x0 = e.clientX, w0 = w(p); let cur = w0; const mv = (ev: PointerEvent) => { cur = Math.max(MIN_W, w0 + ev.clientX - x0); setLocalW((s) => ({ ...s, [p.id]: cur })); }; const up = () => { window.removeEventListener("pointermove", mv); window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", up); setTimeout(() => { resizing.current = false; }, 0); if (cur !== w0) ctx.patchView({ widths: { ...widths, [p.id]: Math.round(cur) } }); }; window.addEventListener("pointermove", mv); window.addEventListener("pointerup", up); window.addEventListener("pointercancel", up); };
  const dragCol = useRef<string | null>(null); const [dropCol, setDropCol] = useState<string | null>(null);
  const reorderCol = (id: string, anchorId: string | null, after = false) => {
    const ids = cols.filter((p) => p.type !== "title").map((p) => p.id).filter((x) => x !== id); let at = anchorId ? ids.indexOf(anchorId) : ids.length; if (at < 0) at = 0; if (after) at += 1; ids.splice(at, 0, id);
    const hidden = ctx.props.filter((p) => p.type !== "title" && !ids.includes(p.id)).map((p) => p.id); ctx.patchView({ order: [...ids, ...hidden] });
  };
  const shiftCol = (p: Property, d: 1 | -1) => { const ids = cols.filter((x) => x.type !== "title").map((x) => x.id); const i = ids.indexOf(p.id); const j = i + d; if (i < 0 || j < 0 || j >= ids.length) return; reorderCol(p.id, ids[j], d === 1); };
  const hideCol = (p: Property) => { ctx.patchView({ hidden: [...new Set([...(ctx.view.config.hidden ?? []), p.id])] }); setEditProp(null); toast(`“${p.name}” hidden in this view`, { action: { label: "Undo", run: () => ctx.patchView({ hidden: (ctx.view.config.hidden ?? []).filter((x) => x !== p.id) }) } }); };

  // ---------- rows: drag to reorder (one row written: audit D7), selection
  const onDragEnd = (e: DragEndEvent) => {
    const { active: a, over } = e; if (!over || a.id === over.id) return; const from = visRowIds.indexOf(String(a.id)), to = visRowIds.indexOf(String(over.id)); if (from < 0 || to < 0) return;
    api(`/api/databases/${ctx.db.id}/rows`, { method: "PATCH", json: { move: { id: a.id, ...(to > from ? { after: over.id } : { before: over.id }) } } }).then(() => ctx.refresh()).catch((err: any) => { toast("Could not reorder", { description: err?.message ?? "The rows keep their previous order.", tone: "danger" }); ctx.refresh(); });
  };
  const anchor = useRef<number | null>(null);
  const toggleRow = async (row: RowOut, index: number, on: boolean, shift: boolean) => {
    if (shift && anchor.current != null && anchor.current !== index) {
      const a = Math.min(anchor.current, index), b = Math.max(anchor.current, index) + 1; if (b - a > 5000) { toast("Select at most 5 000 rows with Shift; use “Select all” for more."); return; }
      const ids = await win.idsInRange(a, b); setSel((s) => { const n = new Set(s.ids); for (const id of ids) { if (s.all ? !on : on) n.add(id); else n.delete(id); } return { all: s.all, ids: n }; });
    } else setSel((s) => { const n = new Set(s.ids); if (s.all ? !on : on) n.add(row.id); else n.delete(row.id); return { all: s.all, ids: n }; });
    anchor.current = index;
  };
  const nSel = selCount(sel, win.total); const allOn = win.total > 0 && nSel === win.total;
  useEffect(() => { setSel({ all: false, ids: new Set() }); anchor.current = null; }, [ctx.view.id, ctx.search]);
  const numCols = cols.filter((p) => win.aggregates?.[p.id]); const footers = ctx.view.config.footers ?? {};
  const span = cols.length + 2;
  return (
    <div className="relative">
      <BulkBar sel={sel} setSel={setSel} />
      <AiRunsDrawer key={runs ?? "none"} open={!!runs} propertyId={runs} onClose={() => setRuns(null)} />
      {/* Scrolling (both axes) stays inside this container, never the page; the header, the footer and the title column are sticky. */}
      <div ref={box} onScroll={onScroll} className="db-scroll !max-h-[min(72vh,56rem)] max-w-full overscroll-contain max-md:!max-h-[70dvh]" role="region" aria-label={`${ctx.view.name} grid`} tabIndex={0} data-total={win.total} data-lines={lines}>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}><SortableContext items={visRowIds} strategy={verticalListSortingStrategy}>
          <table className="w-max min-w-full border-separate border-spacing-0 text-[13px]" onKeyDown={nav} aria-rowcount={win.total}>
            <thead><tr>
              <th className="sticky left-0 z-[5] w-8 border-b border-line p-0"><div className="flex h-9 items-center justify-center"><input type="checkbox" aria-label={allOn ? "Clear the selection" : `Select all ${win.total} rows`} checked={allOn} ref={(el) => { if (el) el.indeterminate = nSel > 0 && !allOn; }} onChange={(e) => { setSel(e.target.checked ? { all: true, ids: new Set() } : { all: false, ids: new Set() }); anchor.current = null; }} className="size-3.5 accent-[var(--accent)] [@media(hover:none)]:size-5" /></div></th>
              {cols.map((p, ci) => (
                <th key={p.id} data-col={p.id} style={{ width: w(p), minWidth: w(p), maxWidth: w(p) }} draggable={ci > 0 && !ctx.isMobile} onDragStart={(e) => { if (resizing.current) { e.preventDefault(); return; } /* the resize handle lives inside this draggable header */ dragCol.current = p.id; e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", p.id); }} onDragOver={(e) => { if (dragCol.current && ci > 0 && dragCol.current !== p.id) { e.preventDefault(); setDropCol(p.id); } }} onDragLeave={() => setDropCol((d) => (d === p.id ? null : d))} onDragEnd={() => { dragCol.current = null; setDropCol(null); }} onDrop={(e) => { e.preventDefault(); const id = dragCol.current; dragCol.current = null; setDropCol(null); if (id && id !== p.id && ci > 0) reorderCol(id, p.id, cols.findIndex((x) => x.id === id) < ci); }}
                  className={cn("group/h relative border-b border-line p-0 text-left font-normal", ci > 0 && "border-l", ci === 0 && "sticky left-8 z-[5]", dropCol === p.id && "shadow-[inset_2px_0_0_var(--accent)]")}>
                  <ResponsivePanel open={editProp === p.id} onOpenChange={(o) => setEditProp(o ? p.id : null)} title={`Property “${p.name}”`} className="w-auto" trigger={<button type="button" aria-label={`Edit property ${p.name}`} className="flex h-9 w-full items-center gap-1.5 truncate px-2.5 text-[12px] font-medium text-fg-muted hover:bg-bg-hover hover:text-fg max-md:h-11 max-md:text-[13px] [&_svg]:size-3.5 [&_svg]:text-fg-faint"><TypeIcon type={p.type} /><span className="truncate">{p.name}</span></button>}>
                    {p.type !== "title" && (
                      <div role="group" aria-label="Column in this view" className="mb-2 flex items-center gap-1 border-b border-line pb-2 text-[12px] max-md:text-[14px]">
                        <button type="button" onClick={() => shiftCol(p, -1)} disabled={ci <= 1} className="flex h-8 items-center gap-1 rounded-md px-2 text-fg-muted hover:bg-bg-sunk hover:text-fg disabled:opacity-40 max-md:h-11"><ChevronLeft className="size-3.5" /> Move left</button>
                        <button type="button" onClick={() => shiftCol(p, 1)} disabled={ci >= cols.length - 1} className="flex h-8 items-center gap-1 rounded-md px-2 text-fg-muted hover:bg-bg-sunk hover:text-fg disabled:opacity-40 max-md:h-11">Move right <ChevronRight className="size-3.5" /></button>
                        <button type="button" onClick={() => hideCol(p)} className="ml-auto flex h-8 items-center gap-1 rounded-md px-2 text-fg-muted hover:bg-bg-sunk hover:text-fg max-md:h-11"><EyeOff className="size-3.5" /> Hide</button>
                      </div>
                    )}
                    {p.type === "ai" && <AiColumnActions prop={p} onRuns={() => { setEditProp(null); setRuns(p.id); }} />}
                    <PropertyEditor prop={p} onClose={() => setEditProp(null)} />
                  </ResponsivePanel>
                  <div onPointerDown={(e) => startResize(p, e)} draggable={false} role="separator" aria-orientation="vertical" aria-label={`Resize ${p.name}`} className="absolute right-0 top-0 z-[1] h-full w-2 cursor-col-resize touch-none opacity-0 hover:opacity-100 group-hover/h:opacity-100"><div className="mx-auto h-full w-px bg-line-strong" /></div>
                </th>))}
              <th className="w-10 border-b border-line p-0 max-md:w-11"><ResponsivePanel open={adding} onOpenChange={setAdding} title="New property" className="w-auto" trigger={<button type="button" aria-label="Add property" className="grid h-9 w-10 place-items-center text-fg-faint hover:bg-bg-hover hover:text-fg max-md:h-11 max-md:w-11"><Plus className="size-4" /></button>}><PropertyEditor onClose={() => setAdding(false)} /></ResponsivePanel></th>
            </tr></thead>
            <tbody>
              {first > 0 && <tr aria-hidden style={{ height: first * ROW_H }}><td colSpan={span} className="p-0" /></tr>}
              {entries.map(({ v, e }) => {
                if (e.t === "group") { const open = !ctx.collapsed.has(e.g.key); const sum = groupSummary(numCols, e.g.aggregates); return (
                  <tr key={`g-${e.g.key}`} style={{ height: ROW_H }} data-group={e.g.key}><td colSpan={span} className="border-b border-line bg-bg-elev p-0"><div className="sticky left-0 flex h-9 w-fit max-w-[92vw] items-center gap-1.5 px-1.5">
                    <button type="button" aria-expanded={open} aria-label={`${open ? "Collapse" : "Expand"} group ${e.g.label}`} onClick={() => ctx.toggleGroup(e.g.key)} className="grid size-7 shrink-0 place-items-center rounded-md text-fg-muted hover:bg-bg-sunk max-md:size-9"><ChevronRight className={cn("size-4 transition-transform motion-reduce:transition-none", open && "rotate-90")} /></button>
                    <span className={cn("inline-flex shrink-0 items-center rounded-md px-1.5 py-0.5 text-[12px] font-medium", OPTION_CLASS[e.g.color])}>{e.g.label}</span>
                    <span className="shrink-0 text-[12px] tabular-nums text-fg-muted" data-group-count={e.g.key}>{e.g.count.toLocaleString("en-CA")}</span>
                    {sum && <span className="truncate text-[11px] tabular-nums text-fg-muted" data-group-agg={e.g.key}>{sum}</span>}
                  </div></td></tr>); }
                if (e.t === "add") return (
                  <tr key={`a-${e.g?.key ?? "end"}`} style={{ height: ROW_H }}><td colSpan={span} className="border-b border-line bg-bg-elev p-0"><button type="button" onClick={() => ctx.newRow(e.g && gb && e.g.value !== undefined ? { [gb.id]: e.g.value } : {})} className="sticky left-0 flex h-9 items-center gap-1.5 px-2.5 text-[13px] text-fg-faint hover:text-fg max-md:px-3 max-md:text-[14px] max-md:text-fg-muted"><Plus className="size-4" /> {e.g ? "New" : "New row"}</button></td></tr>);
                const row = win.rowAt(e.i);
                if (!row) return <tr key={`s-${e.i}`} style={{ height: ROW_H }} data-skeleton><td colSpan={span} className="border-b border-line p-0"><div className="skeleton sticky left-10 ml-10 h-3 w-40 rounded" /></td></tr>;
                return <Row key={row.id} row={row} v={v} index={e.i} cols={cols} w={w} editing={editing} setEditing={(k) => { if (k) { setActive({ v, c: cols.findIndex((p) => `${row.id}:${p.id}` === k) }); setEditing({ key: k, seed: null }); } else stopEdit(null); }} onNav={stopEdit} activeCol={active?.v === v ? active.c : -1} onFocusCell={(c) => setActive({ v, c })} selected={isSelected(sel, row.id)} onSelect={(on, shift) => void toggleRow(row, e.i, on, shift)} canReorder={canReorder} />;
              })}
              {last < lines && <tr aria-hidden style={{ height: (lines - last) * ROW_H }}><td colSpan={span} className="p-0" /></tr>}
            </tbody>
            <tfoot><tr style={{ height: ROW_H }}>
              <td colSpan={2} className="sticky bottom-0 left-0 z-[6] border-t border-line bg-bg-sunk px-2.5 text-[11px] tabular-nums text-fg-muted"><span data-testid="row-count">{win.total.toLocaleString("en-CA")} row{win.total === 1 ? "" : "s"}</span>{win.engine === "js" && <span title={`This view filters, sorts or searches on a computed property (${(win.fallback ?? []).join(", ")}): it is evaluated row by row on the server.`} className="ml-1.5 rounded bg-bg-elev px-1">computed</span>}</td>
              {cols.slice(1).map((p) => { const a = win.aggregates?.[p.id]; const f = footers[p.id]; return (
                <td key={p.id} className="sticky bottom-0 z-[4] border-l border-t border-line bg-bg-sunk p-0 text-right text-[11px] tabular-nums text-fg-muted">
                  {a ? <label className="flex h-9 items-center justify-end gap-1 px-2"><select aria-label={`Footer of ${p.name}`} value={f ?? ""} onChange={(ev) => ctx.patchView({ footers: { ...footers, [p.id]: ev.target.value } })} className="max-w-[4.5rem] cursor-pointer bg-transparent text-[11px] text-fg-muted outline-none"><option value="">Calculate</option>{FOOTERS.map((k) => <option key={k} value={k}>{k === "avg" ? "Average" : k[0].toUpperCase() + k.slice(1)}</option>)}</select>{f && (FOOTERS as readonly string[]).includes(f) && <span className="font-medium text-fg" data-footer={p.id}>{fmtNumber(Math.round(a[f as "sum"] * 100) / 100, p.config.format)}</span>}</label> : null}
                </td>); })}
              <td className="sticky bottom-0 z-[4] border-t border-line bg-bg-sunk p-0" />
            </tr></tfoot>
          </table>
        </SortableContext></DndContext>
      </div>
    </div>
  );
}
function Row({ row, v, index, cols, w, editing, setEditing, onNav, activeCol, onFocusCell, selected, onSelect, canReorder }: { row: RowOut; v: number; index: number; cols: Property[]; w: (p: Property) => number; editing: { key: string; seed: string | null } | null; setEditing: (k: string | null) => void; onNav: (d: CellNav) => void; activeCol: number; onFocusCell: (c: number) => void; selected: boolean; onSelect: (v: boolean, shift: boolean) => void; canReorder: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: row.id, disabled: !canReorder });
  return (
    <tr ref={setNodeRef} data-row={row.id} data-index={index} aria-rowindex={index + 1} aria-selected={selected} style={{ transform: CSS.Transform.toString(transform), transition, height: ROW_H }} className={cn("group/row bg-bg-elev hover:bg-bg-hover", isDragging && "relative z-10 bg-bg-elev shadow-pop", selected && "bg-accent-soft hover:bg-accent-soft")}>
      <td className="sticky left-0 z-[2] w-8 border-b border-line bg-inherit p-0 align-top"><div className="flex h-9 items-center justify-center gap-0.5"><input type="checkbox" checked={selected} onChange={() => { /* handled on click: the Shift key is only known there */ }} onClick={(e) => onSelect(!selected, e.shiftKey)} className={cn("size-3.5 accent-[var(--accent)] [@media(hover:none)]:size-5", !selected && "opacity-0 focus-visible:opacity-100 group-hover/row:opacity-100 [@media(hover:none)]:opacity-100")} aria-label={`Select ${row.title || "Untitled"}`} />{canReorder && <button type="button" {...attributes} {...listeners} aria-label={`Reorder ${row.title || "Untitled"}`} className="hidden cursor-grab text-fg-faint focus-visible:opacity-100 group-hover/row:block md:block md:opacity-0 md:group-hover/row:opacity-100"><GripVertical className="size-3.5" /></button>}</div></td>
      {cols.map((p, ci) => { const key = `${row.id}:${p.id}`; const on = editing?.key === key; return (
        <td key={p.id} style={{ width: w(p), minWidth: w(p), maxWidth: w(p) }} className={cn("border-b border-line p-0 align-top", ci === 0 && "sticky left-8 z-[2] bg-inherit font-medium", ci > 0 && "border-l")}>
          <div data-cell={`${v}:${ci}`} data-prop={p.id} tabIndex={activeCol === ci || (activeCol < 0 && ci === 0) ? 0 : -1} onFocus={(e) => { if (e.target === e.currentTarget) onFocusCell(ci); }} onMouseDown={() => onFocusCell(ci)} className="h-9 overflow-hidden outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40"><Cell p={p} row={row} editing={on} seed={on ? editing!.seed : null} onNav={onNav} onEdit={(o) => setEditing(o ? key : null)} /></div>
        </td>); })}
      <td className="border-b border-line p-0" />
    </tr>
  );
}
