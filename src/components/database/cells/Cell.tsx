"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Check, ExternalLink, Sparkles, RefreshCw, AlertCircle, Maximize2, Pencil } from "lucide-react";
import { Spinner, Tip } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import type { Property, RowOut, RelationRef, FileRef } from "@/lib/databases/types";
import { isError, isPending, READONLY_TYPES } from "@/lib/databases/types";
import { displayValue, fmtDateValue, relativeDate, numberOf, optionOf, fmtNumber, isEmpty } from "@/lib/databases/values";
import { useDb } from "../hooks";
import { OptionChip, SelectPopover } from "./SelectCell";
import { RelationChip, RelationPopover } from "./RelationCell";
import { FileChip, FilePopover } from "./FileCell";
import { ValueEditor } from "./ValueEditor";

const toLocalInput = (v: unknown, time: boolean) => { if (typeof v !== "string" || !v) return ""; if (!time) return v.slice(0, 10); const d = new Date(v); if (Number.isNaN(d.getTime())) return ""; const z = (n: number) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}T${z(d.getHours())}:${z(d.getMinutes())}`; };

/** Read-only rendering used by every view. */
export function CellDisplay({ p, value, row, compact }: { p: Property; value: unknown; row?: RowOut; compact?: boolean }) {
  if (isPending(value)) return <span className="inline-flex items-center gap-1 text-[12px] text-ai"><Spinner className="size-3" /> generating…</span>;
  if (isError(value)) return <Tip label={value.error}><span data-cell-error title={value.error} className="inline-flex max-w-full items-center gap-1 text-[12px] text-danger-text"><AlertCircle className="size-3 shrink-0" /><span className="truncate">{p.type === "formula" || p.type === "rollup" ? value.error : "error"}</span></span></Tip>;
  if (isEmpty(value)) return null;
  switch (p.type) {
    case "title": return <span className="font-medium">{row?.icon ? `${row.icon} ` : ""}{String(value)}</span>;
    case "checkbox": return <span className={cn("grid size-4 place-items-center rounded border", value ? "border-accent bg-accent text-accent-fg" : "border-line-strong")}>{value ? <Check className="size-3" /> : null}</span>;
    case "select": case "status": { const o = optionOf(p, value); return o ? <OptionChip opt={o} /> : <span>{String(value)}</span>; }
    case "multi_select": return <span className="flex flex-wrap gap-1">{(Array.isArray(value) ? value : [value]).map((id) => { const o = optionOf(p, id); return <OptionChip key={String(id)} opt={o ?? { name: String(id), color: "gray" }} />; })}</span>;
    case "relation": if (!Array.isArray(value)) return <span>{String(value)}</span>; return <span className="flex flex-wrap gap-1">{(value as RelationRef[]).slice(0, compact ? 3 : 50).map((r) => <RelationChip key={r.rowId} r={r} />)}{compact && (value as RelationRef[]).length > 3 && <span className="text-[11px] text-fg-faint">+{(value as RelationRef[]).length - 3}</span>}</span>;
    case "file": if (!Array.isArray(value)) return <span>{String(value)}</span>; return <span className="flex flex-wrap gap-1">{(value as FileRef[]).map((f) => <FileChip key={f.id} f={f} />)}</span>;
    case "url": { const s = String(value); return <a href={/^https?:\/\//i.test(s) ? s : `https://${s}`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="inline-flex max-w-full items-center gap-1 truncate text-accent hover:underline"><span className="truncate">{s.replace(/^https?:\/\/(www\.)?/, "")}</span><ExternalLink className="size-3 shrink-0 opacity-60" /></a>; }
    case "date": return <span className="inline-flex items-baseline gap-1.5"><span>{fmtDateValue(value, p.config.includeTime)}</span>{!compact && <span className="text-[11px] text-fg-faint">{relativeDate(value)}</span>}</span>;
    case "created_time": case "last_edited_time": return <span className="text-fg-muted">{fmtDateValue(value, true)}</span>;
    case "number": return <span className="tabular-nums">{fmtNumber(numberOf(value), p.config.format)}</span>;
    case "formula": return typeof value === "boolean" ? <CellDisplay p={{ ...p, type: "checkbox" }} value={value} /> : <span className={cn(typeof value === "number" && "tabular-nums")}>{displayValue(p, value)}</span>;
    case "rollup": return Array.isArray(value) ? <span className="flex flex-wrap gap-1">{value.map((x, i) => <span key={i} className="rounded bg-bg-sunk px-1 text-[12px]">{typeof x === "object" && x && "title" in x ? String((x as { title: unknown }).title) : String(x)}</span>)}</span> : <span className="tabular-nums">{displayValue(p, value)}</span>;
    case "ai": return <span className={cn("whitespace-pre-wrap text-[13px]", compact && "line-clamp-2")}><Tip label="Written by AI"><Sparkles aria-label="AI-generated" className="mr-1 inline size-3 -translate-y-px text-ai" /></Tip>{String(value)}</span>;
    default: return <span className={cn(compact && "line-clamp-2")}>{String(value)}</span>;
  }
}
/** Editable cell (table + side peek). Controlled editing state so the table can drive it from the keyboard. */
/** Where the grid should go after an in-cell editor closes with the keyboard (Enter ↓, Tab →, Shift+Tab ←, Escape: stay). */
export type CellNav = "down" | "right" | "left" | "stay";
export function Cell({ p, row, editing, onEdit, mode = "table", seed, onNav }: { p: Property; row: RowOut; editing: boolean; onEdit: (o: boolean) => void; mode?: "table" | "form"; /** type-to-edit: the character that opened the editor replaces the value */ seed?: string | null; onNav?: (d: CellNav) => void }) {
  const ctx = useDb(); const value = row.values[p.id]; const set = (v: unknown) => ctx.setCell(row.id, { [p.id]: v });
  const readonly = READONLY_TYPES.has(p.type);
  const base = cn("flex min-h-9 w-full items-center gap-1 px-2 py-1 text-[13px]", mode === "form" && "min-h-10 rounded-md hover:bg-bg-sunk", !readonly && "cursor-text");
  // Phones, row sheet: always-visible touch controls (sheets with large options, native date picker, switch) instead of tap-to-edit cells.
  if (mode === "form" && ctx.isMobile && !readonly) return <ValueEditor p={p} value={value} onChange={set} pageId={row.pageId} addOption={(n) => ctx.addOption(p.id, n)} labelId={`prop-label-${p.id}`} />;
  if (p.type === "checkbox") return <button type="button" role="checkbox" aria-checked={!!value} aria-label={p.name} onClick={() => set(!value)} className={cn(base, "cursor-pointer")}><span className={cn("grid size-5 place-items-center rounded border transition-colors", value ? "border-accent bg-accent text-accent-fg" : "border-line-strong hover:border-fg-faint")}>{value ? <Check className="size-3.5" /> : null}</span></button>;
  // An AI cell can also be typed by hand (pencil / Enter): the API then protects that value from being overwritten by a run.
  if (p.type === "ai") return editing ? <TextCell p={p} row={row} value={typeof value === "string" ? value : ""} editing onEdit={onEdit} onChange={set} className={base} mode={mode} seed={seed} onNav={onNav} /> : <AiCell p={p} row={row} mode={mode} onEdit={() => onEdit(true)} />;
  if (readonly) return <div className={cn(base, "cursor-default text-fg-muted")}><CellDisplay p={p} value={value} compact={mode === "table"} /></div>;
  if (p.type === "select" || p.type === "status" || p.type === "multi_select") return <SelectPopover p={p} value={value} multi={p.type === "multi_select"} onChange={set} addOption={(n) => ctx.addOption(p.id, n)} open={editing} onOpenChange={onEdit}><div className={cn(base, "cursor-pointer flex-wrap")}><CellDisplay p={p} value={value} /></div></SelectPopover>;
  if (p.type === "relation") return <RelationPopover p={p} value={value} onChange={set} open={editing} onOpenChange={onEdit}><div className={cn(base, "cursor-pointer flex-wrap")}><CellDisplay p={p} value={value} compact={mode === "table"} /></div></RelationPopover>;
  if (p.type === "file") return <FilePopover value={value} pageId={row.pageId} onChange={set} open={editing} onOpenChange={onEdit}><div className={cn(base, "cursor-pointer flex-wrap")}><CellDisplay p={p} value={value} /></div></FilePopover>;
  if (p.type === "date") return <DateCell p={p} value={value} editing={editing} onEdit={onEdit} onChange={set} className={base} />;
  return <TextCell p={p} row={row} value={value} editing={editing} onEdit={onEdit} onChange={set} className={base} mode={mode} seed={seed} onNav={onNav} />;
}
function TextCell({ p, row, value, editing, onEdit, onChange, className, mode, seed, onNav }: { p: Property; row: RowOut; value: unknown; editing: boolean; onEdit: (o: boolean) => void; onChange: (v: unknown) => void; className: string; mode: "table" | "form"; seed?: string | null; onNav?: (d: CellNav) => void }) {
  const ctx = useDb(); const [draft, setDraft] = useState(""); const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const cancelled = useRef(false); const opened = useRef(false);
  // Focus is taken synchronously when the editor opens (layout effect): with type-to-edit the 2nd keystroke must already land in the input.
  const initial = useRef("");
  useLayoutEffect(() => { if (editing) { cancelled.current = false; opened.current = true; initial.current = seed != null ? seed : value == null ? "" : String(value); setDraft(initial.current); ref.current?.focus(); } }, [editing]); // eslint-disable-line react-hooks/exhaustive-deps
  // once the input shows the initial text: select it all (Enter / click: typing replaces) or put the caret at its end (type-to-edit)
  useLayoutEffect(() => { const el = ref.current; if (editing && opened.current && el && el.value === initial.current) { opened.current = false; if (seed == null) el.select?.(); else el.setSelectionRange?.(el.value.length, el.value.length); } }, [draft, editing]); // eslint-disable-line react-hooks/exhaustive-deps
  const commit = () => {
    if (!editing || cancelled.current) return;
    // 3.0 (U1): text that is not a number is refused and the stored value is kept (it used to be erased silently)
    if (p.type === "number" && draft.trim() !== "" && numberOf(draft) == null) { toast("Not a number", { description: `“${draft.trim().slice(0, 40)}” was not saved; the previous value is kept.`, tone: "danger" }); onEdit(false); return; }
    const v = p.type === "number" ? (draft.trim() === "" ? null : numberOf(draft)) : draft; if (v !== (value ?? (p.type === "number" ? null : ""))) onChange(v); onEdit(false);
  };
  if (editing) {
    const common = { ref: ref as any, value: draft, onChange: (e: any) => setDraft(e.target.value), onBlur: commit, onKeyDown: (e: React.KeyboardEvent) => { if (e.key === "Enter" && !(e.shiftKey && mode === "form")) { e.preventDefault(); commit(); onNav?.("down"); } else if (e.key === "Tab" && mode === "table" && onNav) { e.preventDefault(); commit(); onNav(e.shiftKey ? "left" : "right"); } else if (e.key === "Escape") { e.preventDefault(); cancelled.current = true; onEdit(false); onNav?.("stay"); } e.stopPropagation(); }, className: "w-full bg-transparent text-[13px] outline-none" };
    return <div className={cn(className, "ring-2 ring-accent/40 ring-inset", mode === "form" && "bg-bg-sunk")}>{mode === "form" && p.type === "text" ? <textarea rows={3} {...common} /> : <input type={p.type === "number" ? "text" : "text"} inputMode={p.type === "number" ? "decimal" : undefined} {...common} />}</div>;
  }
  return (
    <div className={cn(className, "group/cell relative", p.type === "number" && "justify-end")} onClick={() => onEdit(true)}>
      <span className={cn("min-w-0 flex-1", mode === "table" ? "truncate" : "whitespace-pre-wrap")}><CellDisplay p={p} value={value} row={row} compact={mode === "table"} /></span>
      {p.type === "title" && mode === "table" && <button type="button" onClick={(e) => { e.stopPropagation(); ctx.open(row.id); }} aria-label={`Open ${row.title || "Untitled"}`} className="ml-auto hidden h-7 shrink-0 items-center gap-1 rounded-md border border-line bg-bg-elev px-1.5 text-[11px] text-fg-muted shadow-card group-hover/cell:flex group-focus-within/cell:flex hover:text-fg [@media(hover:none)]:flex [@media(hover:none)]:h-9 [@media(hover:none)]:px-2"><Maximize2 className="size-3" /> Open</button>}
    </div>
  );
}
function DateCell({ p, value, editing, onEdit, onChange, className }: { p: Property; value: unknown; editing: boolean; onEdit: (o: boolean) => void; onChange: (v: unknown) => void; className: string }) {
  const time = !!p.config.includeTime; const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (editing) setTimeout(() => { ref.current?.focus(); try { ref.current?.showPicker?.(); } catch {} }, 0); }, [editing]);
  if (editing) return <div className={cn(className, "ring-2 ring-accent/40 ring-inset")}><input ref={ref} type={time ? "datetime-local" : "date"} defaultValue={toLocalInput(value, time)} className="w-full bg-transparent text-[13px] outline-none" onChange={(e) => { const v = e.target.value; onChange(!v ? null : time ? new Date(v).toISOString() : v); }} onBlur={() => onEdit(false)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Escape") { e.preventDefault(); onEdit(false); } if (e.key === "Backspace" || e.key === "Delete") { if (!e.currentTarget.value) onChange(null); } e.stopPropagation(); }} /></div>;
  return <div className={className} onClick={() => onEdit(true)}><CellDisplay p={p} value={value} /></div>;
}
/**
 * AI cell. Nothing is computed without a click (or the auto-run the owner switched on for the property); the text carries the AI mark.
 * 3.0 (D8): a failed cell shows its error and a Retry button; a filled cell can be regenerated — a hand-typed value is protected by the API.
 */
function AiCell({ p, row, mode, onEdit }: { p: Property; row: RowOut; mode: "table" | "form"; onEdit: () => void }) {
  const ctx = useDb(); const v = row.values[p.id]; const pending = isPending(v); const failed = isError(v);
  const btn = "inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-[12px] text-ai hover:bg-ai-soft max-md:h-11 max-md:px-3 max-md:text-[14px]";
  return (
    <div className={cn("group/cell relative flex min-h-9 w-full items-start gap-1 px-2 py-1 text-[13px]", mode === "form" && "min-h-10 rounded-md")}>
      <span className="min-w-0 flex-1">
        {failed ? <span className="flex min-w-0 items-center gap-1"><CellDisplay p={p} value={v} compact={mode === "table"} /><button type="button" onClick={() => ctx.regenerate(row.id, p.id)} aria-label={`Retry ${p.name}`} className={btn}><RefreshCw className="size-3.5" /> Retry</button></span>
          : isEmpty(v) && !pending ? <button type="button" onClick={() => ctx.regenerate(row.id, p.id)} className={btn}><Sparkles className="size-3.5" /> Generate</button>
          : <CellDisplay p={p} value={v} compact={mode === "table"} />}
      </span>
      {!pending && <Tip label="Type a value by hand"><button type="button" aria-label={`Edit ${p.name} by hand`} onClick={onEdit} className={cn("grid size-7 shrink-0 place-items-center rounded-md text-fg-muted hover:bg-bg-sunk max-md:size-11", mode === "table" && "opacity-0 group-hover/cell:opacity-100 focus:opacity-100 [@media(hover:none)]:opacity-100")}><Pencil className="size-3.5" /></button></Tip>}
      {!isEmpty(v) && !pending && <Tip label="Regenerate"><button type="button" aria-label={`Regenerate ${p.name}`} onClick={() => ctx.regenerate(row.id, p.id)} className={cn("grid size-7 shrink-0 place-items-center rounded-md text-ai hover:bg-ai-soft max-md:size-11", mode === "table" && "opacity-0 group-hover/cell:opacity-100 focus:opacity-100 [@media(hover:none)]:opacity-100")}><RefreshCw className="size-3.5" /></button></Tip>}
    </div>
  );
}
