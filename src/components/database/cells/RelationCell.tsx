"use client";
import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Check, X } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent, Spinner } from "@/components/ui/primitives";
import { api } from "@/lib/client/api";
import { cn } from "@/lib/utils";
import type { Property, RelationRef } from "@/lib/databases/types";

export function RelationChip({ r, onRemove, className }: { r: RelationRef; onRemove?: () => void; className?: string }) {
  return <span className={cn("inline-flex max-w-full items-center gap-1 rounded-md border border-line bg-bg-elev px-1.5 py-0.5 text-[12px] leading-4", className)}><Link href={`/p/${r.pageId}`} onClick={(e) => e.stopPropagation()} className="truncate underline decoration-line underline-offset-2 hover:text-accent">{r.icon ? `${r.icon} ` : ""}{r.title || "Untitled"}</Link>{onRemove && <button type="button" onClick={(e) => { e.stopPropagation(); onRemove(); }} className="-mr-0.5 rounded p-0.5 text-fg-faint hover:text-fg"><X className="size-3" /></button>}</span>;
}
export function RelationPopover({ p, value, onChange, open, onOpenChange, children }: { p: Property; value: unknown; onChange: (v: RelationRef[]) => void; open: boolean; onOpenChange: (o: boolean) => void; children: React.ReactNode }) {
  const [q, setQ] = useState(""); const sel = (Array.isArray(value) ? value : []) as RelationRef[]; const target = p.config.targetDatabaseId as string | undefined;
  const { data, isLoading } = useQuery<RelationRef[]>({ queryKey: ["db-rel", target, q], enabled: open && !!target, queryFn: () => api(`/api/databases/${target}/rows?q=${encodeURIComponent(q)}&limit=50`) });
  const toggle = (r: RelationRef) => { const has = sel.some((x) => x.rowId === r.rowId); if (p.config.single) { onChange(has ? [] : [r]); onOpenChange(false); } else onChange(has ? sel.filter((x) => x.rowId !== r.rowId) : [...sel, r]); };
  return (
    <Popover open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) setQ(""); }}><PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="w-72 p-1.5" onOpenAutoFocus={(e) => { e.preventDefault(); (e.currentTarget as HTMLElement).querySelector("input")?.focus(); }}>
        {sel.length > 0 && <div className="mb-1 flex flex-wrap gap-1 px-1">{sel.map((r) => <RelationChip key={r.rowId} r={r} onRemove={() => toggle(r)} />)}</div>}
        {!target ? <div className="px-2 py-2 text-[12px] text-danger">No target database configured.</div> : <>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search rows…" className="h-8 w-full rounded-md bg-bg-sunk px-2 text-[13px] outline-none" onKeyDown={(e) => { if (e.key === "Escape") onOpenChange(false); if (e.key === "Enter" && data?.length === 1) toggle(data[0]); }} />
          <div className="mt-1 max-h-60 overflow-y-auto">{isLoading ? <div className="p-3"><Spinner /></div> : (data ?? []).map((r) => <button key={r.rowId} type="button" onClick={() => toggle(r)} className="flex h-9 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] hover:bg-bg-sunk"><span className="w-4 text-center">{r.icon ?? "📄"}</span><span className="truncate">{r.title || "Untitled"}</span>{sel.some((x) => x.rowId === r.rowId) && <Check className="ml-auto size-3.5 text-fg-muted" />}</button>)}{data && !data.length && <div className="px-2 py-2 text-[12px] text-fg-faint">No matching rows.</div>}</div>
        </>}
      </PopoverContent>
    </Popover>
  );
}
