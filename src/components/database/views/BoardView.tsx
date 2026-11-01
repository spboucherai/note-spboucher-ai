"use client";
import { useState } from "react";
import { DndContext, DragOverlay, PointerSensor, TouchSensor, useSensor, useSensors, useDraggable, useDroppable, type DragEndEvent } from "@dnd-kit/core";
import { Plus } from "lucide-react";
import { Empty } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import type { RowOut } from "@/lib/databases/types";
import { isEmpty } from "@/lib/databases/values";
import { useDb } from "../hooks";
import { CellDisplay } from "../cells/Cell";
import { groupRows, type Group } from "../group";
import { OPTION_CLASS } from "../colors";

export function BoardView() {
  const ctx = useDb(); const gb = ctx.props.find((p) => p.id === ctx.view.config.groupBy); const [active, setActive] = useState<RowOut | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 6 } }));
  if (!gb) return <Empty title="Choose a property to group by" hint="Open the view settings (click the active tab) and pick a status or select property." />;
  const groups = groupRows(ctx.rows, gb);
  const onDragEnd = (e: DragEndEvent) => { setActive(null); const { active, over } = e; if (!over) return; const g = groups.find((x) => x.key === over.id); const row = ctx.rows.find((r) => r.id === active.id); if (!g || !row) return; if ((row.values[gb.id] ?? null) !== (g.value ?? null)) ctx.setCell(row.id, { [gb.id]: g.value ?? null }); };
  return (
    <DndContext sensors={sensors} onDragStart={(e) => setActive(ctx.rows.find((r) => r.id === e.active.id) ?? null)} onDragEnd={onDragEnd} onDragCancel={() => setActive(null)}>
      <div className="-mx-5 flex snap-x gap-3 overflow-x-auto px-5 pb-3 md:-mx-10 md:px-10">
        {groups.map((g) => <Column key={g.key} g={g} onAdd={() => ctx.addRow(g.value === undefined ? {} : { [gb.id]: g.value })} />)}
      </div>
      <DragOverlay>{active ? <Card row={active} overlay /> : null}</DragOverlay>
    </DndContext>
  );
}
function Column({ g, onAdd }: { g: Group; onAdd: () => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: g.key });
  return (
    <div ref={setNodeRef} className={cn("flex w-[17rem] shrink-0 snap-start flex-col rounded-lg bg-bg-sunk/60 p-2 transition-colors", isOver && "bg-accent-soft/60")}>
      <div className="mb-2 flex items-center gap-1.5 px-1"><span className={cn("rounded-md px-1.5 py-0.5 text-[12px] font-medium", OPTION_CLASS[g.color])}>{g.label}</span><span className="text-[12px] text-fg-faint">{g.rows.length}</span><button type="button" onClick={onAdd} className="ml-auto grid size-7 place-items-center rounded-md text-fg-faint hover:bg-bg-elev hover:text-fg"><Plus className="size-4" /></button></div>
      <div className="flex min-h-12 flex-1 flex-col gap-1.5">{g.rows.map((r) => <Draggable key={r.id} row={r} />)}</div>
      <button type="button" onClick={onAdd} className="mt-1.5 flex h-8 items-center gap-1 rounded-md px-2 text-[12px] text-fg-faint hover:bg-bg-elev hover:text-fg"><Plus className="size-3.5" /> New</button>
    </div>
  );
}
function Draggable({ row }: { row: RowOut }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: row.id });
  return <div ref={setNodeRef} {...attributes} {...listeners} className={cn("touch-manipulation", isDragging && "opacity-30")}><Card row={row} /></div>;
}
export function Card({ row, overlay }: { row: RowOut; overlay?: boolean }) {
  const ctx = useDb(); const gb = ctx.view.config.groupBy; const props = ctx.visibleProps.filter((p) => p.type !== "title" && p.id !== gb && !isEmpty(row.values[p.id])).slice(0, 4);
  return (
    <div onClick={() => !overlay && ctx.open(row.id)} className={cn("cursor-pointer rounded-md border border-line bg-bg-elev p-2.5 shadow-card transition-shadow hover:shadow-pop", overlay && "rotate-1 shadow-pop")}>
      <div className="text-[13px] font-medium leading-5">{row.icon ? `${row.icon} ` : ""}{row.title || <span className="text-fg-faint">Untitled</span>}</div>
      {props.length > 0 && <div className="mt-1.5 space-y-1">{props.map((p) => <div key={p.id} className="text-[12px] text-fg-muted"><CellDisplay p={p} value={row.values[p.id]} compact /></div>)}</div>}
    </div>
  );
}
