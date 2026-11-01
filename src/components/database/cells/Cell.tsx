"use client";
import { useEffect, useRef, useState } from "react";
import { Check, ExternalLink, Sparkles, RefreshCw, AlertCircle, Maximize2 } from "lucide-react";
import { Spinner, Tip } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import type { Property, RowOut, RelationRef, FileRef } from "@/lib/databases/types";
import { isError, isPending, READONLY_TYPES } from "@/lib/databases/types";
import { displayValue, fmtDateValue, relativeDate, numberOf, optionOf, fmtNumber, isEmpty } from "@/lib/databases/values";
import { useDb } from "../hooks";
import { OptionChip, SelectPopover } from "./SelectCell";
import { RelationChip, RelationPopover } from "./RelationCell";
import { FileChip, FilePopover } from "./FileCell";

const toLocalInput = (v: unknown, time: boolean) => { if (typeof v !== "string" || !v) return ""; if (!time) return v.slice(0, 10); const d = new Date(v); if (Number.isNaN(d.getTime())) return ""; const z = (n: number) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}T${z(d.getHours())}:${z(d.getMinutes())}`; };

/** Read-only rendering used by every view. */
export function CellDisplay({ p, value, row, compact }: { p: Property; value: unknown; row?: RowOut; compact?: boolean }) {
  if (isPending(value)) return <span className="inline-flex items-center gap-1 text-[12px] text-ai"><Spinner className="size-3" /> generating…</span>;
  if (isError(value)) return <Tip label={value.error}><span className="inline-flex items-center gap-1 text-[12px] text-danger"><AlertCircle className="size-3" /> error</span></Tip>;
  if (isEmpty(value)) return null;
  switch (p.type) {
    case "title": return <span className="font-medium">{row?.icon ? `${row.icon} ` : ""}{String(value)}</span>;
    case "checkbox": return <span className={cn("grid size-4 place-items-center rounded border", value ? "border-accent bg-accent text-accent-fg" : "border-line-strong")}>{value ? <Check className="size-3" /> : null}</span>;
    case "select": case "status": { const o = optionOf(p, value); return o ? <OptionChip opt={o} /> : <span>{String(value)}</span>; }
    case "multi_select": return <span className="flex flex-wrap gap-1">{(Array.isArray(value) ? value : [value]).map((id) => { const o = optionOf(p, id); return <OptionChip key={String(id)} opt={o ?? { name: String(id), color: "gray" }} />; })}</span>;
    case "relation": return <span className="flex flex-wrap gap-1">{(value as RelationRef[]).slice(0, compact ? 3 : 50).map((r) => <RelationChip key={r.rowId} r={r} />)}{compact && (value as RelationRef[]).length > 3 && <span className="text-[11px] text-fg-faint">+{(value as RelationRef[]).length - 3}</span>}</span>;
    case "file": return <span className="flex flex-wrap gap-1">{(value as FileRef[]).map((f) => <FileChip key={f.id} f={f} />)}</span>;
    case "url": { const s = String(value); return <a href={/^https?:\/\//i.test(s) ? s : `https://${s}`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="inline-flex max-w-full items-center gap-1 truncate text-accent hover:underline"><span className="truncate">{s.replace(/^https?:\/\/(www\.)?/, "")}</span><ExternalLink className="size-3 shrink-0 opacity-60" /></a>; }
    case "date": return <span className="inline-flex items-baseline gap-1.5"><span>{fmtDateValue(value, p.config.includeTime)}</span>{!compact && <span className="text-[11px] text-fg-faint">{relativeDate(value)}</span>}</span>;
    case "created_time": case "last_edited_time": return <span className="text-fg-muted">{fmtDateValue(value, true)}</span>;
    case "number": return <span className="tabular-nums">{fmtNumber(numberOf(value), p.config.format)}</span>;
    case "formula": return typeof value === "boolean" ? <CellDisplay p={{ ...p, type: "checkbox" }} value={value} /> : <span className={cn(typeof value === "number" && "tabular-nums")}>{displayValue(p, value)}</span>;
    case "rollup": return Array.isArray(value) ? <span className="flex flex-wrap gap-1">{value.map((x, i) => <span key={i} className="rounded bg-bg-sunk px-1 text-[12px]">{String(x)}</span>)}</span> : <span className="tabular-nums">{displayValue(p, value)}</span>;
    case "ai": return <span className={cn("whitespace-pre-wrap text-[13px]", compact && "line-clamp-2")}>{String(value)}</span>;
    default: return <span className={cn(compact && "line-clamp-2")}>{String(value)}</span>;
  }
}
/** Editable cell (table + side peek). Controlled editing state so the table can drive it from the keyboard. */
export function Cell({ p, row, editing, onEdit, mode = "table" }: { p: Property; row: RowOut; editing: boolean; onEdit: (o: boolean) => void; mode?: "table" | "form" }) {
  const ctx = useDb(); const value = row.values[p.id]; const set = (v: unknown) => ctx.setCell(row.id, { [p.id]: v });
  const readonly = READONLY_TYPES.has(p.type);
  const base = cn("flex min-h-9 w-full items-center gap-1 px-2 py-1 text-[13px]", mode === "form" && "min-h-10 rounded-md hover:bg-bg-sunk", !readonly && "cursor-text");
  if (p.type === "checkbox") return <button type="button" onClick={() => set(!value)} className={cn(base, "cursor-pointer")}><span className={cn("grid size-5 place-items-center rounded border transition-colors", value ? "border-accent bg-accent text-accent-fg" : "border-line-strong hover:border-fg-faint")}>{value ? <Check className="size-3.5" /> : null}</span></button>;
  if (p.type === "ai") return <AiCell p={p} row={row} mode={mode} />;
  if (readonly) return <div className={cn(base, "cursor-default text-fg-muted")}><CellDisplay p={p} value={value} compact={mode === "table"} /></div>;
  if (p.type === "select" || p.type === "status" || p.type === "multi_select") return <SelectPopover p={p} value={value} multi={p.type === "multi_select"} onChange={set} addOption={(n) => ctx.addOption(p.id, n)} open={editing} onOpenChange={onEdit}><div className={cn(base, "cursor-pointer flex-wrap")}><CellDisplay p={p} value={value} /></div></SelectPopover>;
  if (p.type === "relation") return <RelationPopover p={p} value={value} onChange={set} open={editing} onOpenChange={onEdit}><div className={cn(base, "cursor-pointer flex-wrap")}><CellDisplay p={p} value={value} compact={mode === "table"} /></div></RelationPopover>;
  if (p.type === "file") return <FilePopover value={value} pageId={row.pageId} onChange={set} open={editing} onOpenChange={onEdit}><div className={cn(base, "cursor-pointer flex-wrap")}><CellDisplay p={p} value={value} /></div></FilePopover>;
  if (p.type === "date") return <DateCell p={p} value={value} editing={editing} onEdit={onEdit} onChange={set} className={base} />;
  return <TextCell p={p} row={row} value={value} editing={editing} onEdit={onEdit} onChange={set} className={base} mode={mode} />;
}
function TextCell({ p, row, value, editing, onEdit, onChange, className, mode }: { p: Property; row: RowOut; value: unknown; editing: boolean; onEdit: (o: boolean) => void; onChange: (v: unknown) => void; className: string; mode: "table" | "form" }) {
  const ctx = useDb(); const [draft, setDraft] = useState(""); const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  useEffect(() => { if (editing) { setDraft(value == null ? "" : String(value)); setTimeout(() => { ref.current?.focus(); ref.current?.select?.(); }, 0); } }, [editing]); // eslint-disable-line react-hooks/exhaustive-deps
  const commit = () => { if (!editing) return; const v = p.type === "number" ? (draft.trim() === "" ? null : numberOf(draft)) : draft; if (v !== (value ?? (p.type === "number" ? null : ""))) onChange(v); onEdit(false); };
  if (editing) {
    const common = { ref: ref as any, value: draft, onChange: (e: any) => setDraft(e.target.value), onBlur: commit, onKeyDown: (e: React.KeyboardEvent) => { if (e.key === "Enter" && !(e.shiftKey && mode === "form")) { e.preventDefault(); commit(); } if (e.key === "Escape") { e.preventDefault(); onEdit(false); } e.stopPropagation(); }, className: "w-full bg-transparent text-[13px] outline-none" };
    return <div className={cn(className, "ring-2 ring-accent/40 ring-inset", mode === "form" && "bg-bg-sunk")}>{mode === "form" && p.type === "text" ? <textarea rows={3} {...common} /> : <input type={p.type === "number" ? "text" : "text"} inputMode={p.type === "number" ? "decimal" : undefined} {...common} />}</div>;
  }
  return (
    <div className={cn(className, "group/cell relative", p.type === "number" && "justify-end")} onClick={() => onEdit(true)}>
      <span className={cn("min-w-0 flex-1", mode === "table" ? "truncate" : "whitespace-pre-wrap")}><CellDisplay p={p} value={value} row={row} compact={mode === "table"} /></span>
      {p.type === "title" && mode === "table" && <button type="button" onClick={(e) => { e.stopPropagation(); ctx.open(row.id); }} className="ml-auto hidden h-7 shrink-0 items-center gap-1 rounded-md border border-line bg-bg-elev px-1.5 text-[11px] text-fg-muted shadow-card group-hover/cell:flex hover:text-fg"><Maximize2 className="size-3" /> Open</button>}
    </div>
  );
}
function DateCell({ p, value, editing, onEdit, onChange, className }: { p: Property; value: unknown; editing: boolean; onEdit: (o: boolean) => void; onChange: (v: unknown) => void; className: string }) {
  const time = !!p.config.includeTime; const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (editing) setTimeout(() => { ref.current?.focus(); try { ref.current?.showPicker?.(); } catch {} }, 0); }, [editing]);
  if (editing) return <div className={cn(className, "ring-2 ring-accent/40 ring-inset")}><input ref={ref} type={time ? "datetime-local" : "date"} defaultValue={toLocalInput(value, time)} className="w-full bg-transparent text-[13px] outline-none" onChange={(e) => { const v = e.target.value; onChange(!v ? null : time ? new Date(v).toISOString() : v); }} onBlur={() => onEdit(false)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Escape") { e.preventDefault(); onEdit(false); } if (e.key === "Backspace" || e.key === "Delete") { if (!e.currentTarget.value) onChange(null); } e.stopPropagation(); }} /></div>;
  return <div className={className} onClick={() => onEdit(true)}><CellDisplay p={p} value={value} /></div>;
}
function AiCell({ p, row, mode }: { p: Property; row: RowOut; mode: "table" | "form" }) {
  const ctx = useDb(); const v = row.values[p.id]; const pending = isPending(v);
  return (
    <div className={cn("group/cell relative flex min-h-9 w-full items-start gap-1 px-2 py-1.5 text-[13px]", mode === "form" && "min-h-10 rounded-md")}>
      <span className="min-w-0 flex-1">{isEmpty(v) && !pending && !isError(v) ? <button type="button" onClick={() => ctx.regenerate(row.id, p.id)} className="inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-[12px] text-ai hover:bg-ai-soft"><Sparkles className="size-3.5" /> Generate</button> : <CellDisplay p={p} value={v} compact={mode === "table"} />}</span>
      {!isEmpty(v) && !pending && <Tip label="Regenerate"><button type="button" onClick={() => ctx.regenerate(row.id, p.id)} className={cn("grid size-7 shrink-0 place-items-center rounded-md text-ai hover:bg-ai-soft", mode === "table" && "opacity-0 group-hover/cell:opacity-100 focus:opacity-100")}><RefreshCw className="size-3.5" /></button></Tip>}
    </div>
  );
}
