"use client";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DndContext, closestCenter, PointerSensor, TouchSensor, KeyboardSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, rectSortingStrategy, useSortable, arrayMove, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, X, Plus, Settings2, RotateCcw, Check, Columns2, Columns3, RectangleHorizontal } from "lucide-react";
import { nanoid } from "nanoid";
import { api } from "@/lib/client/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Popover, PopoverTrigger, PopoverContent, Spinner, Tip, Skeleton } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";
import { WIDGET_META, WIDGET_TYPES, type Widget, type WidgetSize, type WidgetType } from "./types";
import { WIDGET_COMPONENTS, type DashboardData } from "./widgets";

const SIZE_CLASS: Record<WidgetSize, string> = { third: "md:col-span-2", half: "md:col-span-3", wide: "md:col-span-6" };
const SIZES: { id: WidgetSize; label: string; icon: React.ReactNode }[] = [{ id: "third", label: "Third", icon: <Columns3 /> }, { id: "half", label: "Half", icon: <Columns2 /> }, { id: "wide", label: "Full width", icon: <RectangleHorizontal /> }];
function greeting(d: Date) { const h = d.getHours(); return h < 5 ? "Good night" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening"; }

function WidgetCard({ w, editing, data, refresh, onRemove, onResize }: { w: Widget; editing: boolean; data: DashboardData | undefined; refresh: () => void; onRemove: () => void; onResize: (s: WidgetSize) => void }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: w.id, disabled: !editing });
  const meta = WIDGET_META[w.type]; const Comp = WIDGET_COMPONENTS[w.type];
  return (
    <section ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={cn("flex min-h-[200px] flex-col rounded-2xl border border-line bg-bg-elev shadow-card", SIZE_CLASS[w.size], isDragging && "z-10 opacity-80 shadow-pop ring-2 ring-accent/40", editing && "border-dashed border-line-strong")}>
      <header className="flex h-11 shrink-0 items-center gap-1 border-b border-line/70 px-4">
        {editing && <button ref={setActivatorNodeRef} {...attributes} {...listeners} className="-ml-1.5 grid size-8 cursor-grab touch-none place-items-center rounded-md text-fg-faint hover:bg-bg-sunk hover:text-fg active:cursor-grabbing" aria-label="Drag to reorder"><GripVertical className="size-4" /></button>}
        <h2 className="min-w-0 flex-1 truncate text-[12.5px] font-semibold tracking-[-0.005em] text-fg-muted">{meta.label}</h2>
        {editing ? (
          <div className="flex items-center gap-0.5">
            {SIZES.map((s) => <Tip key={s.id} label={s.label}><button onClick={() => onResize(s.id)} className={cn("grid size-8 place-items-center rounded-md text-fg-faint hover:bg-bg-sunk [&_svg]:size-4", w.size === s.id && "bg-bg-sunk text-accent")} aria-label={s.label}>{s.icon}</button></Tip>)}
            <Tip label="Remove widget"><button onClick={onRemove} className="grid size-8 place-items-center rounded-md text-fg-faint hover:bg-danger/10 hover:text-danger" aria-label="Remove"><X className="size-4" /></button></Tip>
          </div>
        ) : null}
      </header>
      <div className={cn("flex min-h-0 flex-1 flex-col p-4", editing && "pointer-events-none select-none opacity-60")}>
        {data ? <Comp data={data} refresh={refresh} config={w.config} /> : <div className="space-y-2.5 pt-1" aria-hidden><Skeleton className="h-3.5 w-3/4" /><Skeleton className="h-3.5 w-full" /><Skeleton className="h-3.5 w-2/3" /><Skeleton className="h-3.5 w-5/6" /></div>}
      </div>
    </section>
  );
}

export function Dashboard({ displayName }: { displayName: string }) {
  const qc = useQueryClient();
  const { data, isError, error } = useQuery({ queryKey: ["dashboard"], queryFn: () => api<DashboardData>("/api/dashboard"), staleTime: 20_000 });
  const refresh = () => { qc.invalidateQueries({ queryKey: ["dashboard"] }); };
  const [editing, setEditing] = useState(false); const [draft, setDraft] = useState<Widget[] | null>(null); const [saving, setSaving] = useState(false);
  const widgets = draft ?? data?.layout.widgets ?? [];
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const now = useMemo(() => new Date(), []);
  const [dateLabel, setDateLabel] = useState(""); useEffect(() => { setDateLabel(new Intl.DateTimeFormat("en-CA", { weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(new Date())); }, []);
  useEffect(() => { if (!editing) return; const k = (e: KeyboardEvent) => { if (e.key === "Escape" && !e.defaultPrevented && !document.querySelector("[role=dialog][data-state=open]")) cancel(); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); /* eslint-disable-next-line */ }, [editing]);

  function start() { setDraft(data?.layout.widgets ?? []); setEditing(true); }
  function cancel() { setDraft(null); setEditing(false); }
  function onDragEnd(e: DragEndEvent) { const { active, over } = e; if (!over || active.id === over.id) return; setDraft((d) => { const list = d ?? []; const from = list.findIndex((w) => w.id === active.id); const to = list.findIndex((w) => w.id === over.id); return from < 0 || to < 0 ? list : arrayMove(list, from, to); }); }
  function add(type: WidgetType) { setDraft((d) => [...(d ?? []), { id: `w-${nanoid(8)}`, type, size: WIDGET_META[type].defaultSize }]); }
  async function save() {
    if (!draft) return; setSaving(true);
    try { const r = await api("/api/dashboard", { method: "PUT", json: { widgets: draft } }); qc.setQueryData<DashboardData>(["dashboard"], (old) => (old ? { ...old, layout: r } : old)); setEditing(false); setDraft(null); toast("Dashboard saved", { tone: "success" }); refresh(); }
    catch (e: any) { toast("Could not save layout", { description: e.message, tone: "danger" }); } finally { setSaving(false); }
  }
  async function reset() {
    setSaving(true);
    try { const r = await api("/api/dashboard", { method: "PUT", json: { reset: true } }); qc.setQueryData<DashboardData>(["dashboard"], (old) => (old ? { ...old, layout: r } : old)); setDraft(null); setEditing(false); toast("Default layout restored"); refresh(); }
    catch (e: any) { toast("Reset failed", { description: e.message, tone: "danger" }); } finally { setSaving(false); }
  }
  const missing = WIDGET_TYPES.filter((t) => !widgets.some((w) => w.type === t));
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-8 sm:py-10">
      <div className="mb-7 flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <p className="mb-1 text-[12px] font-medium uppercase tracking-[0.08em] text-fg-faint">{dateLabel || " "}</p>
          <h1 className="text-[1.75rem] font-bold leading-tight tracking-[-0.025em] sm:text-h1">{greeting(now)}, {displayName.split(" ")[0]}</h1>
          {data && data.tasks.length > 0 && <p className="mt-1 text-[13px] text-fg-muted">{data.tasks.length} task{data.tasks.length === 1 ? "" : "s"} due soon</p>}
        </div>
        {editing ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <Popover><PopoverTrigger asChild><Button size="sm" variant="outline"><Plus /> Add widget</Button></PopoverTrigger>
              <PopoverContent className="w-80 p-1.5" align="end">
                <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-fg-faint">{missing.length ? "Available widgets" : "All widgets are on the board"}</div>
                {(missing.length ? missing : WIDGET_TYPES).map((t) => <button key={t} onClick={() => add(t)} className="flex w-full flex-col items-start rounded-md px-2 py-1.5 text-left hover:bg-bg-sunk"><span className="text-[13px] font-medium">{WIDGET_META[t].label}{!missing.includes(t) && <span className="ml-1 text-[10px] font-normal text-fg-faint">(duplicate)</span>}</span><span className="text-[11px] text-fg-muted">{WIDGET_META[t].description}</span></button>)}
              </PopoverContent></Popover>
            <Button size="sm" variant="ghost" onClick={reset} disabled={saving}><RotateCcw /> Reset</Button>
            <Button size="sm" variant="ghost" onClick={cancel} disabled={saving}>Cancel</Button>
            <Button size="sm" onClick={save} disabled={saving}>{saving ? <Spinner className="size-3.5 border-white/40 border-t-white" /> : <Check />} Save</Button>
          </div>
        ) : <Button size="sm" variant="ghost" onClick={start} disabled={!data}><Settings2 /> Customize</Button>}
      </div>
      {isError && <div className="mb-4 rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-[13px] text-danger">Could not load the dashboard: {(error as Error).message}</div>}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={widgets.map((w) => w.id)} strategy={rectSortingStrategy}>
          <div className="grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-[repeat(6,minmax(0,1fr))]">
            {widgets.map((w) => <WidgetCard key={w.id} w={w} editing={editing} data={data} refresh={refresh} onRemove={() => setDraft((d) => (d ?? []).filter((x) => x.id !== w.id))} onResize={(size) => setDraft((d) => (d ?? []).map((x) => (x.id === w.id ? { ...x, size } : x)))} />)}
            {!widgets.length && data && <div className="col-span-full rounded-xl border border-dashed border-line-strong py-16 text-center text-[13px] text-fg-muted">{editing ? "Add widgets with the button above." : "Your dashboard is empty."} {!editing && <button className="text-accent hover:underline" onClick={start}>Customize</button>}</div>}
          </div>
        </SortableContext>
      </DndContext>
      {editing && <p className="mt-4 text-center text-[12px] text-fg-faint">Drag the handle to reorder (touch: press and hold). Resize with the column buttons. Esc cancels.</p>}
    </div>
  );
}
