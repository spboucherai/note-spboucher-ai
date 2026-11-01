"use client";
import { useState } from "react";
import { Check, Plus, X } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import type { Property, SelectOption } from "@/lib/databases/types";
import { OPTION_CLASS } from "../colors";

export function OptionChip({ opt, onRemove, className }: { opt: SelectOption | { name: string; color?: string }; onRemove?: () => void; className?: string }) {
  return <span className={cn("inline-flex max-w-full items-center gap-1 rounded-md px-1.5 py-0.5 text-[12px] font-medium leading-4", OPTION_CLASS[(opt.color as keyof typeof OPTION_CLASS) ?? "gray"] ?? OPTION_CLASS.gray, className)}><span className="truncate">{opt.name}</span>{onRemove && <button type="button" onClick={(e) => { e.stopPropagation(); onRemove(); }} className="-mr-0.5 rounded p-0.5 opacity-60 hover:opacity-100"><X className="size-3" /></button>}</span>;
}
/** Popover for select / multi_select / status; `children` is the trigger. */
export function SelectPopover({ p, value, multi, onChange, addOption, open, onOpenChange, children }: { p: Property; value: unknown; multi: boolean; onChange: (v: unknown) => void; addOption: (name: string) => Promise<SelectOption>; open: boolean; onOpenChange: (o: boolean) => void; children: React.ReactNode }) {
  const [q, setQ] = useState(""); const opts = p.config.options ?? []; const sel: string[] = multi ? (Array.isArray(value) ? (value as string[]) : []) : value ? [String(value)] : [];
  const filtered = opts.filter((o) => o.name.toLowerCase().includes(q.trim().toLowerCase())); const canCreate = q.trim() && !opts.some((o) => o.name.toLowerCase() === q.trim().toLowerCase());
  const pick = (id: string) => { if (multi) onChange(sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]); else { onChange(sel[0] === id ? null : id); onOpenChange(false); } };
  const create = async () => { const o = await addOption(q.trim()); setQ(""); pick(o.id); };
  return (
    <Popover open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) setQ(""); }}><PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="w-64 p-1.5" onOpenAutoFocus={(e) => { e.preventDefault(); (e.currentTarget as HTMLElement).querySelector("input")?.focus(); }}>
        {multi && sel.length > 0 && <div className="mb-1 flex flex-wrap gap-1 px-1">{sel.map((id) => { const o = opts.find((x) => x.id === id); return o ? <OptionChip key={id} opt={o} onRemove={() => pick(id)} /> : null; })}</div>}
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={multi ? "Search or create…" : "Search or create…"} className="h-8 w-full rounded-md bg-bg-sunk px-2 text-[13px] outline-none" onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (filtered.length === 1) pick(filtered[0].id); else if (canCreate) create(); } if (e.key === "Escape") onOpenChange(false); }} />
        <div className="mt-1 max-h-60 overflow-y-auto">
          {filtered.map((o) => <button key={o.id} type="button" onClick={() => pick(o.id)} className="flex h-9 w-full items-center gap-2 rounded-md px-2 text-left hover:bg-bg-sunk"><OptionChip opt={o} />{sel.includes(o.id) && <Check className="ml-auto size-3.5 text-fg-muted" />}</button>)}
          {canCreate && <button type="button" onClick={create} className="flex h-9 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] hover:bg-bg-sunk"><Plus className="size-3.5 text-fg-muted" /> Create <OptionChip opt={{ name: q.trim(), color: "gray" }} /></button>}
          {!filtered.length && !canCreate && <div className="px-2 py-2 text-[12px] text-fg-faint">No options yet — type to create one.</div>}
        </div>
      </PopoverContent>
    </Popover>
  );
}
