"use client";
import { useState } from "react";
import { Check, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Property, SelectOption } from "@/lib/databases/types";
import { OPTION_CLASS } from "../colors";
import { ResponsivePanel } from "../Responsive";

export function OptionChip({ opt, onRemove, className }: { opt: SelectOption | { name: string; color?: string }; onRemove?: () => void; className?: string }) {
  return (
    <span className={cn("inline-flex max-w-full items-center gap-1 rounded-md px-1.5 py-0.5 text-[12px] font-medium leading-4", OPTION_CLASS[(opt.color as keyof typeof OPTION_CLASS) ?? "gray"] ?? OPTION_CLASS.gray, className)}>
      <span className="truncate">{opt.name}</span>
      {onRemove && (
        <button type="button" aria-label={`Remove ${opt.name}`} onClick={(e) => { e.stopPropagation(); onRemove(); }} className="-mr-0.5 rounded p-0.5 opacity-60 hover:opacity-100 max-md:-my-2 max-md:p-2">
          <X className="size-3" />
        </button>
      )}
    </span>
  );
}

/**
 * Picker for select / multi_select / status; `children` is the trigger.
 * Desktop: popover with search. Phone: bottom sheet listing the options as large rows (≥ 48 px).
 */
export function SelectPopover({ p, value, multi, onChange, addOption, open, onOpenChange, children }: {
  p: Property; value: unknown; multi: boolean; onChange: (v: unknown) => void; addOption: (name: string) => Promise<SelectOption>;
  open: boolean; onOpenChange: (o: boolean) => void; children: React.ReactNode;
}) {
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const opts = p.config.options ?? [];
  const sel: string[] = multi ? (Array.isArray(value) ? (value as string[]) : []) : value ? [String(value)] : [];
  const needle = q.trim().toLowerCase();
  const filtered = opts.filter((o) => o.name.toLowerCase().includes(needle));
  const canCreate = !!needle && !opts.some((o) => o.name.toLowerCase() === needle);

  const pick = (id: string) => {
    if (multi) onChange(sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]);
    else { onChange(sel[0] === id ? null : id); onOpenChange(false); }
  };
  const create = async () => {
    if (creating) return;
    setCreating(true);
    try { const o = await addOption(q.trim()); setQ(""); pick(o.id); }
    catch { /* the property mutation already showed an error toast; keep the typed name */ }
    finally { setCreating(false); }
  };

  return (
    <ResponsivePanel
      open={open}
      onOpenChange={(o) => { onOpenChange(o); if (!o) setQ(""); }}
      trigger={children}
      title={p.name}
      description={multi ? "Choose one or more options." : "Choose an option. Tap the selected one again to clear it."}
      className="w-64 p-1.5"
      focusFirstInput
    >
      {multi && sel.length > 0 && (
        <div className="mb-1 flex flex-wrap gap-1 px-1 max-md:mb-2 max-md:gap-2 max-md:px-0">
          {sel.map((id) => { const o = opts.find((x) => x.id === id); return o ? <OptionChip key={id} opt={o} onRemove={() => pick(id)} /> : null; })}
        </div>
      )}
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search or create…"
        aria-label={`Search or create an option for ${p.name}`}
        className="h-8 w-full rounded-md bg-bg-sunk px-2 text-[13px] outline-none max-md:h-11 max-md:px-3"
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); if (filtered.length === 1) pick(filtered[0].id); else if (canCreate) void create(); }
          if (e.key === "Escape") onOpenChange(false);
        }}
      />
      <div role="listbox" aria-label={p.name} aria-multiselectable={multi} className="mt-1 max-h-60 overflow-y-auto max-md:max-h-none">
        {filtered.map((o) => {
          const selected = sel.includes(o.id);
          return (
            <button key={o.id} type="button" role="option" aria-selected={selected} onClick={() => pick(o.id)} className={cn("flex h-9 w-full items-center gap-2 rounded-md px-2 text-left hover:bg-bg-sunk max-md:h-12 max-md:px-3", selected && "bg-bg-sunk")}>
              <OptionChip opt={o} className="max-md:px-2 max-md:py-1 max-md:text-[14px] max-md:leading-5" />
              {selected && <Check className="ml-auto size-3.5 text-accent max-md:size-5" />}
            </button>
          );
        })}
        {canCreate && (
          <button type="button" onClick={create} disabled={creating} className="flex h-9 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] hover:bg-bg-sunk disabled:opacity-60 max-md:h-12 max-md:px-3 max-md:text-[15px]">
            <Plus className="size-3.5 text-fg-muted max-md:size-5" /> Create <OptionChip opt={{ name: q.trim(), color: "gray" }} />
          </button>
        )}
        {!filtered.length && !canCreate && <div className="px-2 py-2 text-[12px] text-fg-faint max-md:py-4 max-md:text-[14px]">No options yet — type a name to create one.</div>}
      </div>
    </ResponsivePanel>
  );
}
