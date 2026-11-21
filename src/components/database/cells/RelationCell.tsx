/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/components/database/cells/RelationCell.tsx
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
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Check, X } from "lucide-react";
import { Skeleton } from "@/components/ui/primitives";
import { api } from "@/lib/client/api";
import { cn } from "@/lib/utils";
import type { Property, RelationRef } from "@/lib/databases/types";
import { ResponsivePanel } from "../Responsive";

export function RelationChip({ r, onRemove, className }: { r: RelationRef; onRemove?: () => void; className?: string }) {
  return (
    <span className={cn("inline-flex max-w-full items-center gap-1 rounded-md border border-line bg-bg-elev px-1.5 py-0.5 text-[12px] leading-4", className)}>
      <Link href={`/p/${r.pageId}`} onClick={(e) => e.stopPropagation()} className="truncate underline decoration-line underline-offset-2 hover:text-accent">
        {r.icon ? `${r.icon} ` : ""}{r.title || "Untitled"}
      </Link>
      {onRemove && (
        <button type="button" aria-label={`Remove ${r.title || "Untitled"}`} onClick={(e) => { e.stopPropagation(); onRemove(); }} className="-mr-0.5 rounded p-0.5 text-fg-faint hover:text-fg max-md:-my-2 max-md:p-2">
          <X className="size-3" />
        </button>
      )}
    </span>
  );
}

/** Relation picker: searchable list of the target database's rows (popover on desktop, bottom sheet on phones). */
export function RelationPopover({ p, value, onChange, open, onOpenChange, children }: {
  p: Property; value: unknown; onChange: (v: RelationRef[]) => void; open: boolean; onOpenChange: (o: boolean) => void; children: React.ReactNode;
}) {
  const [q, setQ] = useState("");
  const sel = (Array.isArray(value) ? value : []) as RelationRef[];
  const target = p.config.targetDatabaseId as string | undefined;
  const query = useQuery<RelationRef[]>({
    queryKey: ["db-rel", target, q],
    enabled: open && !!target,
    queryFn: () => api(`/api/databases/${target}/rows?q=${encodeURIComponent(q)}&limit=50`),
  });
  const data = query.data;

  const toggle = (r: RelationRef) => {
    const has = sel.some((x) => x.rowId === r.rowId);
    if (p.config.single) { onChange(has ? [] : [r]); onOpenChange(false); }
    else onChange(has ? sel.filter((x) => x.rowId !== r.rowId) : [...sel, r]);
  };

  return (
    <ResponsivePanel
      open={open}
      onOpenChange={(o) => { onOpenChange(o); if (!o) setQ(""); }}
      trigger={children}
      title={p.name}
      description={p.config.single ? "Link one row." : "Link one or more rows."}
      className="w-72 p-1.5"
      focusFirstInput
    >
      {sel.length > 0 && (
        <div className="mb-1 flex flex-wrap gap-1 px-1 max-md:mb-2 max-md:gap-2 max-md:px-0">
          {sel.map((r) => <RelationChip key={r.rowId} r={r} onRemove={() => toggle(r)} className="max-md:py-1 max-md:text-[14px] max-md:leading-5" />)}
        </div>
      )}
      {!target ? (
        <div role="alert" className="px-2 py-2 text-[12px] text-danger-text max-md:text-[14px]">No target database configured for this relation. Edit the property to choose one.</div>
      ) : (
        <>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search rows…"
            aria-label={`Search rows to link in ${p.name}`}
            className="h-8 w-full rounded-md bg-bg-sunk px-2 text-[13px] outline-none max-md:h-11 max-md:px-3"
            onKeyDown={(e) => { if (e.key === "Escape") onOpenChange(false); if (e.key === "Enter" && data?.length === 1) toggle(data[0]); }}
          />
          <div role="listbox" aria-label={`Rows for ${p.name}`} aria-multiselectable={!p.config.single} className="mt-1 max-h-60 overflow-y-auto max-md:max-h-none">
            {query.isLoading && <div className="space-y-2 p-2" role="status" aria-label="Loading rows"><Skeleton className="h-6" /><Skeleton className="h-6" /><Skeleton className="h-6" /></div>}
            {query.isError && (
              <div role="alert" className="flex items-center gap-2 px-2 py-2 text-[12px] text-danger-text max-md:text-[14px]">
                <span className="min-w-0 flex-1">Could not load rows.</span>
                <button type="button" onClick={() => query.refetch()} className="h-8 shrink-0 rounded-md border border-line px-2 text-fg max-md:h-11 max-md:px-3">Retry</button>
              </div>
            )}
            {(data ?? []).map((r) => {
              const selected = sel.some((x) => x.rowId === r.rowId);
              return (
                <button key={r.rowId} type="button" role="option" aria-selected={selected} onClick={() => toggle(r)} className={cn("flex h-9 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] hover:bg-bg-sunk max-md:h-12 max-md:px-3 max-md:text-[15px]", selected && "bg-bg-sunk")}>
                  <span aria-hidden className="w-4 shrink-0 text-center">{r.icon ?? "📄"}</span>
                  <span className="min-w-0 flex-1 truncate">{r.title || "Untitled"}</span>
                  {selected && <Check className="size-3.5 shrink-0 text-accent max-md:size-5" />}
                </button>
              );
            })}
            {data && !data.length && <div className="px-2 py-2 text-[12px] text-fg-faint max-md:py-4 max-md:text-[14px]">{q ? "No row matches this search." : "The linked database has no rows yet."}</div>}
          </div>
        </>
      )}
    </ResponsivePanel>
  );
}
