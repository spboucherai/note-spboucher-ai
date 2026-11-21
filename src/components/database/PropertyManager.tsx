/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/components/database/PropertyManager.tsx
 * Module           : components
 * Repository       : https://git.spboucher.ai/note-spboucher-ai
 * Project Website  : https://note.spboucher.ai
 * Created          : 2026-11-01
 * Last Modified    : 2026-11-17
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
import { DndContext, PointerSensor, useSensor, useSensors, closestCenter, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Eye, EyeOff, GripVertical, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Property } from "@/lib/databases/types";
import { useDb, usePropertyMutations } from "./hooks";
import { TypeIcon } from "./meta";
import { PropertyEditor } from "./PropertyEditor";

/** Popover body: visibility toggles, drag reorder, open editor, add property. */
export function PropertyManager({ onClose }: { onClose: () => void }) {
  const ctx = useDb(); const m = usePropertyMutations(ctx.db, ctx.db.pageId); const [editing, setEditing] = useState<Property | "new" | null>(null);
  const hidden = ctx.view.config.hidden ?? []; const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  if (editing) return <PropertyEditor prop={editing === "new" ? undefined : editing} onClose={() => setEditing(null)} onBack={() => setEditing(null)} />;
  const onDragEnd = (e: DragEndEvent) => { const { active, over } = e; if (!over || active.id === over.id) return; const ids = ctx.props.map((p) => p.id); const next = arrayMove(ids, ids.indexOf(String(active.id)), ids.indexOf(String(over.id))); m.reorder.mutate(next); };
  const toggle = (id: string) => ctx.patchView({ hidden: hidden.includes(id) ? hidden.filter((x) => x !== id) : [...hidden, id] });
  return (
    <div className="w-64 max-md:w-full">
      <div className="mb-1 flex items-center justify-between text-[12px] font-medium text-fg-muted">Properties<span className="text-fg-faint">{ctx.props.length}</span></div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}><SortableContext items={ctx.props.map((p) => p.id)} strategy={verticalListSortingStrategy}>
        <div className="max-h-72 space-y-0.5 overflow-y-auto max-md:max-h-none">{ctx.props.map((p) => <Row key={p.id} p={p} hidden={hidden.includes(p.id)} onToggle={() => toggle(p.id)} onEdit={() => setEditing(p)} />)}</div>
      </SortableContext></DndContext>
      <button type="button" onClick={() => setEditing("new")} className="mt-1 flex h-9 w-full items-center gap-2 rounded-md px-2 text-[13px] text-fg-muted hover:bg-bg-sunk hover:text-fg max-md:h-11 max-md:text-[15px]"><Plus className="size-4" /> New property</button>
    </div>
  );
}
function Row({ p, hidden, onToggle, onEdit }: { p: Property; hidden: boolean; onToggle: () => void; onEdit: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: p.id, disabled: p.type === "title" });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={cn("flex h-9 items-center gap-1 rounded-md pr-1 hover:bg-bg-sunk max-md:h-11", isDragging && "z-10 bg-bg-elev shadow-pop", hidden && "opacity-60")}>
      <button type="button" {...attributes} {...listeners} aria-label={`Reorder ${p.name}`} className={cn("grid size-7 shrink-0 cursor-grab touch-none place-items-center text-fg-faint max-md:size-9", p.type === "title" && "invisible")}><GripVertical className="size-3.5" /></button>
      <button type="button" onClick={onEdit} aria-label={`Edit property ${p.name}`} className="flex h-full min-w-0 flex-1 items-center gap-1.5 text-left text-[13px] max-md:text-[15px]"><TypeIcon type={p.type} /><span className="truncate">{p.name}</span></button>
      {p.type !== "title" && <button type="button" onClick={onToggle} aria-pressed={!hidden} aria-label={hidden ? `Show ${p.name} in this view` : `Hide ${p.name} from this view`} className="grid size-7 shrink-0 place-items-center rounded text-fg-faint hover:text-fg max-md:size-11 max-md:[&_svg]:size-5">{hidden ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}</button>}
    </div>
  );
}
