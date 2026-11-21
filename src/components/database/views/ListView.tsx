/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/components/database/views/ListView.tsx
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
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { isEmpty } from "@/lib/databases/values";
import { useDb } from "../hooks";
import { CellDisplay } from "../cells/Cell";
import { ChevronRight } from "lucide-react";
import { useGrowing, rowsOfGroup, LoadMore } from "../growing";
import { groupSummary } from "./TableView";
import { OPTION_CLASS } from "../colors";

/** List: one line per row on desktop; on phones the title sits above its priority properties (rows ≥ 48 px). */
export function ListView() {
  const ctx = useDb();
  const gb = ctx.groupProp; const groups = ctx.groups; const { shown, more } = useGrowing();
  const numCols = ctx.visibleProps.filter((p) => ctx.win.aggregates?.[p.id]);
  const side = (ctx.isMobile ? ctx.priorityProps : ctx.visibleProps).filter((p) => p.type !== "title" && p.id !== gb?.id);
  const max = ctx.isMobile ? 3 : 5;
  return (
    <div className="space-y-3">
      {groups.map((g) => (g.count || !gb) ? (
        <section key={g.key} aria-label={gb ? g.label : "Rows"}>
          {gb && <h3 className="mb-1 flex min-w-0 items-center gap-1.5"><button type="button" aria-expanded={!ctx.collapsed.has(g.key)} aria-label={`${ctx.collapsed.has(g.key) ? "Expand" : "Collapse"} group ${g.label}`} onClick={() => ctx.toggleGroup(g.key)} className="grid size-7 shrink-0 place-items-center rounded-md text-fg-muted hover:bg-bg-sunk max-md:size-11"><ChevronRight className={cn("size-4 transition-transform motion-reduce:transition-none", !ctx.collapsed.has(g.key) && "rotate-90")} /></button><span className={cn("shrink-0 rounded-md px-1.5 py-0.5 text-[12px] font-medium max-md:text-[13px]", OPTION_CLASS[g.color])}>{g.label}</span><span className="shrink-0 text-[12px] tabular-nums text-fg-muted max-md:text-[13px]" data-group-count={g.key}>{g.count.toLocaleString("en-CA")}</span><span className="truncate text-[11px] tabular-nums text-fg-muted" data-group-agg={g.key}>{groupSummary(numCols, g.aggregates)}</span></h3>}
          {!(gb && ctx.collapsed.has(g.key)) && <div className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-bg-elev shadow-card">
            {rowsOfGroup(ctx.win, g, shown).map((r) => {
              const shown = side.filter((p) => !isEmpty(r.values[p.id])).slice(0, max);
              return (
                <div key={r.id} className="relative transition-colors hover:bg-bg-hover">
                  <button type="button" aria-label={`Open ${r.title || "Untitled"}`} onClick={() => ctx.open(r.id)} className="absolute inset-0 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/50" />
                  <div className="pointer-events-none relative flex min-h-10 items-center gap-3 px-3.5 py-1.5 max-md:min-h-12 max-md:flex-col max-md:items-stretch max-md:justify-center max-md:gap-1 max-md:py-2.5">
                    <span className="min-w-0 flex-1 truncate text-[13px] font-medium max-md:flex-none max-md:whitespace-normal max-md:text-[15px] max-md:[overflow-wrap:anywhere]">{r.icon ? `${r.icon} ` : ""}{r.title || <span className="font-normal text-fg-faint">Untitled</span>}</span>
                    {shown.length > 0 && (
                      <span className="flex shrink-0 items-center gap-2 text-[12px] text-fg-muted max-md:min-w-0 max-md:shrink max-md:flex-wrap max-md:gap-x-3 max-md:gap-y-1 max-md:text-[13px]">
                        {shown.map((p) => <span key={p.id} className="max-w-[10rem] truncate max-md:max-w-full [&_a]:pointer-events-auto"><CellDisplay p={p} value={r.values[p.id]} compact /></span>)}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
            <button type="button" onClick={() => ctx.newRow(gb && g.value !== undefined ? { [gb.id]: g.value } : {})} className="flex h-9 w-full items-center gap-1.5 px-3.5 text-[12px] text-fg-faint hover:bg-bg-hover hover:text-fg max-md:h-11 max-md:text-[14px] max-md:text-fg-muted"><Plus className="size-3.5" /> New</button>
          </div>}
        </section>
      ) : null)}
      <LoadMore shown={shown} more={more} />
    </div>
  );
}
