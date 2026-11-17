"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { DndContext, PointerSensor, useSensor, useSensors, closestCenter, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Plus, GripVertical, Trash2 } from "lucide-react";
import { api } from "@/lib/client/api";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import type { Property, RowOut } from "@/lib/databases/types";
import { useDb } from "../hooks";
import { Cell } from "../cells/Cell";
import { TypeIcon } from "../meta";
import { PropertyEditor } from "../PropertyEditor";
import { groupRows } from "../group";
import { ResponsivePanel } from "../Responsive";
import { RowCard } from "./RowCard";
import { OPTION_CLASS } from "../colors";

const MIN_W = 80;
/** Sticky title column on phones: narrow enough to leave room to scroll the other columns at 360 px. */
const PHONE_TITLE_W = 148;

/** Table view. Phones get one card per row by default; the real grid stays one tap away ("View options" → Grid). */
export function TableView() {
  const ctx = useDb();
  return ctx.isMobile && ctx.mobileLayout === "cards" ? <CardsLayout /> : <GridLayout />;
}

function CardsLayout() {
  const ctx = useDb();
  const gb = ctx.view.config.groupBy ? ctx.props.find((p) => p.id === ctx.view.config.groupBy) : undefined;
  const groups = groupRows(ctx.rows, gb);
  return (
    <div className="space-y-4">
      {groups.map((g) => (g.rows.length || !gb) ? (
        <section key={g.key} aria-label={gb ? g.label : "Rows"}>
          {gb && (
            <h3 className="mb-1.5 flex items-center gap-1.5">
              <span className={cn("rounded-md px-2 py-0.5 text-[13px] font-medium", OPTION_CLASS[g.color])}>{g.label}</span>
              <span className="text-[13px] tabular-nums text-fg-muted">{g.rows.length}</span>
            </h3>
          )}
          <ul className="space-y-2">{g.rows.map((r) => <li key={r.id}><RowCard row={r} exclude={gb?.id} /></li>)}</ul>
          {gb && (
            <button type="button" onClick={() => ctx.newRow(g.value === undefined ? {} : { [gb.id]: g.value })} className="mt-1.5 flex h-11 w-full items-center gap-1.5 rounded-xl border border-dashed border-line px-3 text-[14px] text-fg-muted active:bg-bg-sunk">
              <Plus className="size-4" /> New in {g.label}
            </button>
          )}
        </section>
      ) : null)}
      <p className="text-[12px] tabular-nums text-fg-faint">{ctx.total} row{ctx.total === 1 ? "" : "s"}{ctx.rows.length < ctx.total ? ` · showing ${ctx.rows.length}` : ""}</p>
    </div>
  );
}

function GridLayout() {
  const ctx = useDb(); const cols = ctx.visibleProps; const widths = ctx.view.config.widths ?? {};
  const [editing, setEditing] = useState<string | null>(null); const [sel, setSel] = useState<Set<string>>(new Set()); const [editProp, setEditProp] = useState<string | null>(null); const [adding, setAdding] = useState(false);
  const [localW, setLocalW] = useState<Record<string, number>>({}); const w = (p: Property) => { const base = localW[p.id] ?? widths[p.id] ?? p.width ?? (p.type === "title" ? 260 : 180); return ctx.isMobile && p.type === "title" ? Math.min(base, PHONE_TITLE_W) : base; };
  const gb = ctx.view.config.groupBy ? ctx.props.find((p) => p.id === ctx.view.config.groupBy) : undefined; const groups = groupRows(ctx.rows, gb);
  const canReorder = !gb && !(ctx.view.config.sorts?.length) && !ctx.search; const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const flat = groups.flatMap((g) => g.rows);
  const nav = useCallback((e: React.KeyboardEvent) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-cell]"); if (!el || editing) return; const [r, c] = el.dataset.cell!.split(":").map(Number);
    const go = (nr: number, nc: number) => { const t = el.closest("table")?.querySelector<HTMLElement>(`[data-cell="${nr}:${nc}"]`); if (t) { e.preventDefault(); t.focus(); } };
    if (e.key === "ArrowDown") go(r + 1, c); else if (e.key === "ArrowUp") go(r - 1, c); else if (e.key === "ArrowRight" || (e.key === "Tab" && !e.shiftKey)) go(r, c + 1); else if (e.key === "ArrowLeft" || (e.key === "Tab" && e.shiftKey)) go(r, c - 1);
    else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); const row = flat[r], p = cols[c]; if (row && p) { if (p.type === "checkbox") ctx.setCell(row.id, { [p.id]: !row.values[p.id] }); else setEditing(`${row.id}:${p.id}`); } }
    else if (e.key === "Escape") setEditing(null);
  }, [editing, flat, cols, ctx]);
  const startResize = (p: Property, e: React.PointerEvent) => { e.preventDefault(); const x0 = e.clientX, w0 = w(p); let cur = w0; const move = (ev: PointerEvent) => { cur = Math.max(MIN_W, w0 + ev.clientX - x0); setLocalW((s) => ({ ...s, [p.id]: cur })); }; const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); ctx.patchView({ widths: { ...widths, [p.id]: cur } }); }; window.addEventListener("pointermove", move); window.addEventListener("pointerup", up); };
  const onDragEnd = (e: DragEndEvent) => { const { active, over } = e; if (!over || active.id === over.id) return; const ids = flat.map((r) => r.id); const next = arrayMove(ids, ids.indexOf(String(active.id)), ids.indexOf(String(over.id))); api(`/api/databases/${ctx.db.id}/rows`, { method: "PATCH", json: { order: next } }).then(() => ctx.refresh()).catch((err: any) => { toast("Could not reorder", { description: err?.message ?? "The rows keep their previous order.", tone: "danger" }); ctx.refresh(); }); };
  useEffect(() => { setSel((s) => new Set([...s].filter((id) => flat.some((r) => r.id === id)))); }, [ctx.rows.length]); // eslint-disable-line react-hooks/exhaustive-deps
  let ri = 0;
  return (
    <div className="relative">
      {sel.size > 0 && <div role="status" className="mb-2 flex items-center gap-2 rounded-md border border-line bg-bg-elev px-2 py-1 text-[12px] shadow-card max-md:text-[14px]"><span className="font-medium">{sel.size} selected</span><button type="button" onClick={async () => { if (sel.size > 1 && !confirm(`Move ${sel.size} rows to the trash? You can undo this right after.`)) return; const ids = [...sel]; setSel(new Set()); await ctx.removeRows(ids); }} className="flex h-7 items-center gap-1 rounded-md px-2 text-danger hover:bg-danger/10 max-md:h-11 max-md:px-3"><Trash2 className="size-3.5" /> Delete</button><button type="button" onClick={() => setSel(new Set())} className="ml-auto text-fg-muted hover:text-fg max-md:h-11 max-md:px-3">Clear</button></div>}
      {/* Horizontal scrolling stays inside this container (never the page); the title column is sticky. */}
      <div className="db-scroll max-w-full overscroll-x-contain" role="region" aria-label={`${ctx.view.name} grid`} tabIndex={0}>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}><SortableContext items={flat.map((r) => r.id)} strategy={verticalListSortingStrategy}>
          <table className="w-max min-w-full border-collapse text-[13px]" onKeyDown={nav}>
            <thead><tr>
              <th className="sticky left-0 z-[5] w-8 border-b border-line p-0"><div className="h-9" /></th>
              {cols.map((p, ci) => (
                <th key={p.id} style={{ width: w(p), minWidth: w(p), maxWidth: w(p) }} className={cn("group/h relative border-b border-line p-0 text-left font-normal", ci > 0 && "border-l", ci === 0 && "sticky left-8 z-[5]")}>
                  <ResponsivePanel open={editProp === p.id} onOpenChange={(o) => setEditProp(o ? p.id : null)} title={`Property “${p.name}”`} className="w-auto" trigger={<button type="button" aria-label={`Edit property ${p.name}`} className="flex h-9 w-full items-center gap-1.5 truncate px-2.5 text-[12px] font-medium text-fg-muted hover:bg-bg-hover hover:text-fg max-md:h-11 max-md:text-[13px] [&_svg]:size-3.5 [&_svg]:text-fg-faint"><TypeIcon type={p.type} /><span className="truncate">{p.name}</span></button>}><PropertyEditor prop={p} onClose={() => setEditProp(null)} /></ResponsivePanel>
                  <div onPointerDown={(e) => startResize(p, e)} className="absolute right-0 top-0 z-[1] h-full w-2 cursor-col-resize touch-none opacity-0 hover:opacity-100 group-hover/h:opacity-100"><div className="mx-auto h-full w-px bg-line-strong" /></div>
                </th>))}
              <th className="w-10 border-b border-line p-0 max-md:w-11"><ResponsivePanel open={adding} onOpenChange={setAdding} title="New property" className="w-auto" trigger={<button type="button" aria-label="Add property" className="grid h-9 w-10 place-items-center text-fg-faint hover:bg-bg-hover hover:text-fg max-md:h-11 max-md:w-11"><Plus className="size-4" /></button>}><PropertyEditor onClose={() => setAdding(false)} /></ResponsivePanel></th>
            </tr></thead>
            <tbody>
              {groups.map((g) => (g.rows.length || !gb ? [
                gb && <tr key={`g-${g.key}`}><td colSpan={cols.length + 2} className="sticky left-0 bg-bg-elev px-2 pb-1.5 pt-4"><span className={cn("inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[12px] font-medium", OPTION_CLASS[g.color])}>{g.label}<span className="opacity-60">{g.rows.length}</span></span></td></tr>,
                ...g.rows.map((row) => <Row key={row.id} row={row} ri={ri++} cols={cols} w={w} editing={editing} setEditing={setEditing} selected={sel.has(row.id)} onSelect={(v) => setSel((s) => { const n = new Set(s); v ? n.add(row.id) : n.delete(row.id); return n; })} canReorder={canReorder} />),
                gb && <tr key={`a-${g.key}`}><td colSpan={cols.length + 2} className="sticky left-0 bg-bg-elev p-0"><button type="button" onClick={() => ctx.newRow(g.value === undefined ? {} : { [gb.id]: g.value })} className="flex h-8 items-center gap-1 px-2 text-[12px] text-fg-faint hover:text-fg max-md:h-11 max-md:px-3 max-md:text-[14px] max-md:text-fg-muted"><Plus className="size-3.5" /> New</button></td></tr>,
              ] : null))}
              {!gb && <tr><td colSpan={cols.length + 2} className="sticky left-0 bg-bg-elev p-0"><button type="button" onClick={() => ctx.newRow()} className="flex h-9 w-full items-center gap-1.5 px-2.5 text-[13px] text-fg-faint hover:bg-bg-hover hover:text-fg max-md:h-11 max-md:w-auto max-md:px-3 max-md:text-[14px] max-md:text-fg-muted"><Plus className="size-4" /> New row</button></td></tr>}
            </tbody>
            <tfoot><tr><td colSpan={cols.length + 2} className="sticky left-0 bg-bg-sunk/60 px-2.5 py-1.5 text-[11px] tabular-nums text-fg-faint">{ctx.total} row{ctx.total === 1 ? "" : "s"}{ctx.rows.length < ctx.total ? ` · showing ${ctx.rows.length}` : ""}</td></tr></tfoot>
          </table>
        </SortableContext></DndContext>
      </div>
    </div>
  );
}
function Row({ row, ri, cols, w, editing, setEditing, selected, onSelect, canReorder }: { row: RowOut; ri: number; cols: Property[]; w: (p: Property) => number; editing: string | null; setEditing: (k: string | null) => void; selected: boolean; onSelect: (v: boolean) => void; canReorder: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: row.id, disabled: !canReorder });
  return (
    <tr ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={cn("group/row h-9 border-b border-line bg-bg-elev transition-colors hover:bg-bg-hover", isDragging && "relative z-10 bg-bg-elev shadow-pop", selected && "bg-accent-soft hover:bg-accent-soft")}>
      <td className="sticky left-0 z-[2] w-8 bg-inherit p-0 align-top"><div className="flex h-9 items-center justify-center gap-0.5"><input type="checkbox" checked={selected} onChange={(e) => onSelect(e.target.checked)} className={cn("size-3.5 accent-[var(--accent)] [@media(hover:none)]:size-5", !selected && "opacity-0 focus-visible:opacity-100 group-hover/row:opacity-100 [@media(hover:none)]:opacity-100")} aria-label={`Select ${row.title || "Untitled"}`} />{canReorder && <button type="button" {...attributes} {...listeners} aria-label={`Reorder ${row.title || "Untitled"}`} className="hidden cursor-grab text-fg-faint focus-visible:opacity-100 group-hover/row:block md:block md:opacity-0 md:group-hover/row:opacity-100"><GripVertical className="size-3.5" /></button>}</div></td>
      {cols.map((p, ci) => { const key = `${row.id}:${p.id}`; return (
        <td key={p.id} style={{ width: w(p), minWidth: w(p), maxWidth: w(p) }} className={cn("p-0 align-top", ci === 0 && "sticky left-8 z-[2] bg-inherit font-medium", ci > 0 && "border-l border-line")}>
          <div data-cell={`${ri}:${ci}`} tabIndex={0} className="h-full min-h-9 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40"><Cell p={p} row={row} editing={editing === key} onEdit={(o) => setEditing(o ? key : null)} /></div>
        </td>); })}
      <td className="p-0" />
    </tr>
  );
}
