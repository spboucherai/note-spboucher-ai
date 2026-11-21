/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/components/database/views/BoardView.tsx
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
import { useState } from "react";
import { DndContext, DragOverlay, PointerSensor, TouchSensor, useSensor, useSensors, useDraggable, useDroppable, type DragEndEvent } from "@dnd-kit/core";
import { Plus, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Empty } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import type { RowOut } from "@/lib/databases/types";
import { isEmpty } from "@/lib/databases/values";
import { useDb } from "../hooks";
import { CellDisplay } from "../cells/Cell";
import { MoveTo } from "../RowPeek";
import type { ViewGroup } from "../group";
import { rowsOfGroup } from "../growing";
import { groupSummary } from "./TableView";
import { ChevronsLeftRight } from "lucide-react";
import { useEffect } from "react";
import { OPTION_CLASS } from "../colors";

/**
 * Board. Columns scroll horizontally inside the board (scroll-snap, one column ≈ 85 % of a phone screen); the page never
 * scrolls sideways. Cards move by drag with a mouse/trackpad, and without any drag through "Move to…" (on each card and
 * in the row sheet) — on phones drag is off so a horizontal swipe always scrolls the columns.
 */
export function BoardView() {
  const ctx = useDb();
  const gb = ctx.groupProp;
  const [active, setActive] = useState<RowOut | null>(null);
  // 3.0: each column shows its first cards and loads more on demand; counts and sums are those of the whole database (server-side)
  const [shown, setShown] = useState<Record<string, number>>({});
  const groups = ctx.groups; const { ensure } = ctx.win; const per = (g: ViewGroup) => Math.min(g.count, shown[g.key] ?? 30);
  const sig = groups.map((g) => `${g.key}:${g.offset}:${ctx.collapsed.has(g.key) ? 0 : per(g)}`).join("|");
  useEffect(() => { if (gb) ensure(groups.filter((g) => g.count && !ctx.collapsed.has(g.key)).map((g): [number, number] => [g.offset, g.offset + per(g)])); }, [sig, ensure]); // eslint-disable-line react-hooks/exhaustive-deps
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 6 } }));

  if (!gb) {
    return (
      <Empty
        title="Choose a property to group by"
        hint="A board needs a status, select or checkbox property: each option becomes a column."
        action={<Button size="sm" variant="outline" className="max-md:h-11 max-md:px-4" onClick={ctx.openViewSettings}><Settings2 /> Open view settings</Button>}
      />
    );
  }
  const numCols = ctx.visibleProps.filter((p) => ctx.win.aggregates?.[p.id]);

  const onDragEnd = (e: DragEndEvent) => {
    setActive(null);
    const { active: dragged, over } = e;
    if (!over) return;
    const g = groups.find((x) => x.key === over.id);
    const row = ctx.findRow(String(dragged.id));
    if (!g || !row) return;
    const previous = row.values[gb.id] ?? null;
    if (previous === (g.value ?? null)) return;
    ctx.setCell(row.id, { [gb.id]: g.value ?? null });
    toast(`Moved to ${g.label}`, { action: { label: "Undo", run: () => ctx.setCell(row.id, { [gb.id]: previous }) } });
  };

  return (
    <DndContext sensors={sensors} onDragStart={(e) => setActive(ctx.findRow(String(e.active.id)) ?? null)} onDragEnd={onDragEnd} onDragCancel={() => setActive(null)}>
      <div
        role="region"
        aria-label={`Board grouped by ${gb.name}. ${groups.length} columns, scroll sideways.`}
        tabIndex={0}
        className="flex max-w-full snap-x snap-mandatory gap-3 overflow-x-auto overscroll-x-contain pb-3 sm:-mx-5 sm:px-5 md:-mx-10 md:snap-none md:px-10"
      >
        {groups.map((g) => <Column key={g.key} g={g} rows={rowsOfGroup(ctx.win, g, g.offset + per(g))} summary={groupSummary(numCols, g.aggregates)} collapsed={ctx.collapsed.has(g.key)} onToggle={() => ctx.toggleGroup(g.key)} onMore={() => setShown((s) => ({ ...s, [g.key]: per(g) + 50 }))} dragDisabled={ctx.isMobile} onAdd={() => ctx.newRow(g.value === undefined ? {} : { [gb.id]: g.value })} />)}
      </div>
      <DragOverlay>{active ? <Card row={active} overlay /> : null}</DragOverlay>
    </DndContext>
  );
}

function Column({ g, rows, summary, collapsed, onToggle, onMore, onAdd, dragDisabled }: { g: ViewGroup; rows: RowOut[]; summary: string; collapsed: boolean; onToggle: () => void; onMore: () => void; onAdd: () => void; dragDisabled: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: g.key });
  if (collapsed) return (
    <section ref={setNodeRef} aria-label={`${g.label}, ${g.count} card${g.count === 1 ? "" : "s"}, collapsed`} className={cn("flex w-12 shrink-0 snap-start flex-col items-center gap-2 rounded-xl border border-line/60 bg-bg-sunk py-2 transition-colors motion-reduce:transition-none", isOver && "border-accent/40 bg-accent-soft")}>
      <button type="button" aria-expanded={false} aria-label={`Expand column ${g.label}`} onClick={onToggle} className="grid size-8 place-items-center rounded-md text-fg-muted hover:bg-bg-elev max-md:size-11"><ChevronsLeftRight className="size-4" /></button>
      <span className="text-[12px] tabular-nums text-fg-muted" data-group-count={g.key}>{g.count.toLocaleString("en-CA")}</span>
      <span className={cn("rounded-md px-1 py-1.5 text-[12px] font-medium [writing-mode:vertical-rl]", OPTION_CLASS[g.color])}>{g.label}</span>
    </section>
  );
  return (
    <section
      ref={setNodeRef}
      aria-label={`${g.label}, ${g.count} card${g.count === 1 ? "" : "s"}`}
      className={cn("flex max-h-[min(75dvh,60rem)] w-[85%] max-w-[20rem] shrink-0 snap-start flex-col rounded-xl border border-line/60 bg-bg-sunk p-2 transition-colors md:w-[17.5rem]", isOver && "border-accent/40 bg-accent-soft")}
    >
      <div className="mb-2 flex h-8 items-center gap-1.5 px-1 max-md:h-11">
        <span className={cn("truncate rounded-md px-1.5 py-0.5 text-[12px] font-medium max-md:text-[13px]", OPTION_CLASS[g.color])}>{g.label}</span>
        <span className="text-[12px] tabular-nums text-fg-muted max-md:text-[13px]" data-group-count={g.key}>{g.count.toLocaleString("en-CA")}</span>
        <button type="button" aria-expanded aria-label={`Collapse column ${g.label}`} onClick={onToggle} className="ml-auto grid size-7 shrink-0 place-items-center rounded-md text-fg-faint hover:bg-bg-elev hover:text-fg max-md:size-11 max-md:text-fg-muted"><ChevronsLeftRight className="size-3.5 max-md:size-5" /></button>
        <button type="button" aria-label={`New card in ${g.label}`} onClick={onAdd} className="grid size-7 shrink-0 place-items-center rounded-md text-fg-faint hover:bg-bg-elev hover:text-fg max-md:size-11 max-md:text-fg-muted"><Plus className="size-4 max-md:size-5" /></button>
      </div>
      {summary && <div className="-mt-1 mb-2 truncate px-1 text-[11px] tabular-nums text-fg-muted" data-group-agg={g.key}>{summary}</div>}
      <div className="flex min-h-12 flex-1 flex-col gap-1.5 overflow-y-auto overscroll-y-contain max-md:gap-2">
        {rows.map((r) => <Draggable key={r.id} row={r} disabled={dragDisabled} />)}
        {!g.count && <p className="px-1 py-2 text-[12px] text-fg-muted max-md:text-[13px]">No card here.</p>}
        {rows.length < g.count && <button type="button" onClick={onMore} className="flex h-8 shrink-0 items-center justify-center rounded-md border border-dashed border-line text-[12px] text-fg-muted hover:bg-bg-elev max-md:h-11 max-md:text-[14px]">Load more · {(g.count - rows.length).toLocaleString("en-CA")} more</button>}
      </div>
      <button type="button" onClick={onAdd} className="mt-1.5 flex h-8 shrink-0 items-center gap-1 rounded-md px-2 text-[12px] text-fg-faint hover:bg-bg-elev hover:text-fg max-md:h-11 max-md:text-[14px] max-md:text-fg-muted"><Plus className="size-3.5" /> New</button>
    </section>
  );
}

function Draggable({ row, disabled }: { row: RowOut; disabled: boolean }) {
  const { listeners, setNodeRef, isDragging } = useDraggable({ id: row.id, disabled });
  return <div ref={setNodeRef} {...(disabled ? {} : listeners)} className={cn(isDragging && "opacity-30")}><Card row={row} /></div>;
}

export function Card({ row, overlay }: { row: RowOut; overlay?: boolean }) {
  const ctx = useDb();
  const gb = ctx.view.config.groupBy;
  const source = ctx.isMobile ? ctx.priorityProps : ctx.visibleProps;
  const props = source.filter((p) => p.type !== "title" && p.id !== gb && !isEmpty(row.values[p.id])).slice(0, 4);
  return (
    <div className={cn("relative rounded-lg border border-line bg-bg-elev shadow-card transition-[box-shadow,border-color] hover:border-line-strong hover:shadow-pop", overlay && "rotate-[1.5deg] shadow-pop")}>
      {!overlay && <button type="button" aria-label={`Open ${row.title || "Untitled"}`} onClick={() => ctx.open(row.id)} className="absolute inset-0 cursor-pointer rounded-lg focus-visible:ring-2 focus-visible:ring-accent/50" />}
      <div className="pointer-events-none relative px-3 py-2.5">
        <div className="text-[13px] font-medium leading-5 [overflow-wrap:anywhere] max-md:text-[15px]">{row.icon ? `${row.icon} ` : ""}{row.title || <span className="text-fg-faint">Untitled</span>}</div>
        {props.length > 0 && <div className="mt-1.5 space-y-1">{props.map((p) => <div key={p.id} className="text-[12px] text-fg-muted [overflow-wrap:anywhere] max-md:text-[13px] [&_a]:pointer-events-auto"><CellDisplay p={p} value={row.values[p.id]} compact /></div>)}</div>}
      </div>
      {/* Non-drag way to change column: always visible on phones and on any touch screen (drag stays the mouse way). */}
      {!overlay && (
        <div className="relative px-1.5 pb-1.5 md:hidden [@media(hover:none)]:md:block" onPointerDown={(e) => e.stopPropagation()}>
          <MoveTo row={row} className="flex h-11 w-full items-center gap-1.5 rounded-md px-2 text-[13px] text-fg-muted hover:bg-bg-sunk hover:text-fg" />
        </div>
      )}
    </div>
  );
}
