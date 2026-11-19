"use client";
/**
 * File: src/components/database/BulkBar.tsx
 * Description: Databases Next Generation — the selection bar of the table: how many rows are selected (possibly every row of the
 *   view, loaded or not), and the bulk actions: edit a property, move to a group, duplicate, delete. Every action is one server call
 *   (`rows/bulk`), journaled, and undoable with ⌘Z or the toast.
 * Author: Simon-Pierre Boucher · contact@spboucher.ai
 */
import { useState } from "react";
import { Copy, Pencil, Trash2, ArrowRightLeft, X, Undo2, Redo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Property } from "@/lib/databases/types";
import { useDb } from "./hooks";
import { ResponsivePanel } from "./Responsive";
import { ValueEditor } from "./cells/ValueEditor";
import { Sel } from "./meta";
import { OPTION_CLASS } from "./colors";

/** `all: false` → `ids` are the selected rows. `all: true` → every row of the view (and search) is selected, except `ids`. */
export interface Selection { all: boolean; ids: Set<string> }
export const selCount = (s: Selection, total: number) => (s.all ? Math.max(0, total - s.ids.size) : s.ids.size);
export const isSelected = (s: Selection, id: string) => (s.all ? !s.ids.has(id) : s.ids.has(id));
const EDITABLE = new Set(["text", "number", "date", "checkbox", "status", "select", "multi_select", "url"]);
const LIMIT = { delete: 5000, duplicate: 200 };

export function BulkBar({ sel, setSel }: { sel: Selection; setSel: (s: Selection) => void }) {
  const ctx = useDb(); const n = selCount(sel, ctx.total); const [panel, setPanel] = useState<"edit" | "move" | null>(null);
  const [propId, setPropId] = useState(""); const [value, setValue] = useState<unknown>(null); const [busy, setBusy] = useState(false);
  const editable = ctx.props.filter((p) => EDITABLE.has(p.type)); const p: Property | undefined = editable.find((x) => x.id === propId) ?? editable[0];
  const target = () => (sel.all ? { all: { except: [...sel.ids] } } : { ids: [...sel.ids] });
  const clear = () => setSel({ all: false, ids: new Set() });
  const run = async (action: Parameters<typeof ctx.bulk>[1], label: string) => { setBusy(true); const ok = await ctx.bulk(target(), action, label); setBusy(false); if (ok) { setPanel(null); clear(); } };
  const btn = "flex h-7 shrink-0 items-center gap-1 rounded-md px-2 hover:bg-bg-sunk disabled:opacity-40 max-md:h-11 max-md:px-3 [&_svg]:size-3.5";
  const undoBtns = (ctx.undo.canUndo || ctx.undo.canRedo) && (
    <span className="ml-auto flex items-center gap-0.5">
      <button type="button" onClick={() => void ctx.undo.undo()} disabled={!ctx.undo.canUndo} aria-label={ctx.undo.undoLabel ? `Undo ${ctx.undo.undoLabel}` : "Undo"} title={ctx.undo.undoLabel ? `Undo: ${ctx.undo.undoLabel} (⌘Z)` : "Undo (⌘Z)"} className={cn(btn, "text-fg-muted")}><Undo2 /> <span className="max-sm:sr-only">Undo</span></button>
      <button type="button" onClick={() => void ctx.undo.redo()} disabled={!ctx.undo.canRedo} aria-label={ctx.undo.redoLabel ? `Redo ${ctx.undo.redoLabel}` : "Redo"} title={ctx.undo.redoLabel ? `Redo: ${ctx.undo.redoLabel} (⇧⌘Z)` : "Redo (⇧⌘Z)"} className={cn(btn, "text-fg-muted")}><Redo2 /> <span className="max-sm:sr-only">Redo</span></button>
    </span>
  );
  if (!n) return undoBtns ? <div className="mb-1 flex items-center text-[12px] max-md:text-[14px]">{undoBtns}</div> : null;
  return (
    <div role="toolbar" aria-label="Selected rows" className="mb-2 flex flex-wrap items-center gap-1 rounded-md border border-line bg-bg-elev px-2 py-1 text-[12px] shadow-card max-md:text-[14px]">
      <span role="status" className="mr-1 font-medium tabular-nums">{n.toLocaleString("en-CA")} selected</span>
      {!sel.all && n < ctx.total && <button type="button" onClick={() => setSel({ all: true, ids: new Set() })} className={cn(btn, "text-accent")}>Select all {ctx.total.toLocaleString("en-CA")}</button>}
      <ResponsivePanel open={panel === "edit"} onOpenChange={(o) => { setPanel(o ? "edit" : null); if (o) setValue(null); }} title="Edit a property" description={`Sets the value for the ${n.toLocaleString("en-CA")} selected rows.`} className="w-72"
        trigger={<button type="button" disabled={!editable.length || busy} className={btn}><Pencil /> Edit property</button>}>
        {p && (
          <div className="space-y-2">
            <div className="text-[12px] font-medium text-fg-muted max-md:hidden">Edit {n.toLocaleString("en-CA")} rows</div>
            <Sel aria-label="Property to edit" value={p.id} onChange={(e) => { setPropId(e.target.value); setValue(null); }} className="w-full">{editable.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Sel>
            <div id="bulk-value-label" className="sr-only">New value of {p.name}</div>
            <div data-testid="bulk-value"><ValueEditor key={p.id} p={p} value={value} onChange={setValue} commit="change" addOption={(name) => ctx.addOption(p.id, name)} labelId="bulk-value-label" /></div>
            <div className="flex items-center gap-1.5 pt-1">
              <Button size="sm" className="max-md:h-11" disabled={busy} onClick={() => run({ type: "update", values: { [p.id]: p.type === "checkbox" ? !!value : value } }, `Edit ${p.name}`)}>Apply to {n.toLocaleString("en-CA")}</Button>
              {p.type !== "checkbox" && <Button size="sm" variant="ghost" className="max-md:h-11" disabled={busy} onClick={() => run({ type: "update", values: { [p.id]: null } }, `Clear ${p.name}`)}>Clear value</Button>}
            </div>
          </div>
        )}
      </ResponsivePanel>
      {ctx.groupProp && (
        <ResponsivePanel open={panel === "move"} onOpenChange={(o) => setPanel(o ? "move" : null)} title="Move to group" description={`Sets “${ctx.groupProp.name}” for the selected rows.`} className="w-60 p-1.5"
          trigger={<button type="button" disabled={busy} className={btn}><ArrowRightLeft /> Move to group</button>}>
          <ul className="space-y-0.5">{ctx.groups.map((g) => <li key={g.key}><button type="button" disabled={busy} onClick={() => run({ type: "update", values: { [ctx.groupProp!.id]: g.value ?? null } }, `Move to ${g.label}`)} className="flex h-9 w-full items-center gap-2 rounded-md px-2 text-left hover:bg-bg-sunk max-md:h-12"><span className={cn("truncate rounded-md px-1.5 py-0.5 text-[12px] font-medium max-md:text-[14px]", OPTION_CLASS[g.color])}>{g.label}</span></button></li>)}</ul>
        </ResponsivePanel>
      )}
      <button type="button" disabled={busy || n > LIMIT.duplicate} title={n > LIMIT.duplicate ? `Duplicate at most ${LIMIT.duplicate} rows at a time` : undefined} onClick={() => run({ type: "duplicate" }, "Duplicate")} className={btn}><Copy /> Duplicate</button>
      <button type="button" disabled={busy || n > LIMIT.delete} title={n > LIMIT.delete ? `Delete at most ${LIMIT.delete.toLocaleString("en-CA")} rows at a time` : undefined} onClick={() => { if (n > 1 && !confirm(`Move ${n.toLocaleString("en-CA")} rows to the trash? You can undo this right after.`)) return; void run({ type: "delete" }, "Delete"); }} className={cn(btn, "text-danger hover:bg-danger/10")}><Trash2 /> Delete</button>
      <button type="button" onClick={clear} aria-label="Clear the selection" className={cn(btn, "text-fg-muted")}><X /> Clear</button>
      {undoBtns}
    </div>
  );
}
