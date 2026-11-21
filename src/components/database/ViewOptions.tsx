/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/components/database/ViewOptions.tsx
 * Module           : components
 * Repository       : https://git.spboucher.ai/note-spboucher-ai
 * Project Website  : https://note.spboucher.ai
 * Created          : 2026-11-17
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
import { Check, LayoutGrid, Rows3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useDb, configuredMobileProps, MOBILE_PROP_COUNT, type MobileLayout } from "./hooks";
import { FilterBuilder, SortBuilder, describeFilter } from "./FilterBuilder";
import { PropertyManager } from "./PropertyManager";
import { SheetSection } from "./Responsive";
import { Sel, TypeIcon } from "./meta";

const GROUPABLE_TYPES = ["select", "status", "checkbox"];
const GROUPABLE_VIEWS = ["board", "table", "list"];

/**
 * Body of the phone "View options" sheet: layout (cards / grid), filters, sort, grouping, card properties and
 * property visibility in one place. Every change is saved with the view immediately (optimistic, error toast on failure).
 */
export function ViewOptions({ onDone }: { onDone: () => void }) {
  const ctx = useDb();
  const { view } = ctx;
  const nFilters = describeFilter(view.config.filter);
  const nSorts = view.config.sorts?.length ?? 0;
  const groupable = ctx.props.filter((p) => GROUPABLE_TYPES.includes(p.type));
  const canGroup = GROUPABLE_VIEWS.includes(view.type);
  const usesCards = view.type === "table" || view.type === "list" || view.type === "board" || view.type === "gallery";

  const layouts: { id: MobileLayout; label: string; hint: string; icon: React.ReactNode }[] = [
    { id: "cards", label: "Cards", hint: "One card per row", icon: <Rows3 /> },
    { id: "grid", label: "Grid", hint: "Full table, scrolls sideways", icon: <LayoutGrid /> },
  ];

  // Properties shown on cards: explicit list in view.config.mobileProps, otherwise the first visible ones.
  const candidates = ctx.props.filter((p) => p.type !== "title");
  const chosen = ctx.priorityProps.map((p) => p.id);
  const explicit = configuredMobileProps(view) !== null;
  const toggleCardProp = (id: string) => {
    const next = chosen.includes(id) ? chosen.filter((x) => x !== id) : [...chosen, id];
    // keep the database's property order so cards read the same as the table
    ctx.patchView({ mobileProps: candidates.map((p) => p.id).filter((x) => next.includes(x)) });
  };

  return (
    <div>
      {view.type === "table" && (
        <SheetSection title="Layout on this phone" hint="Cards are easier to read on a small screen; the grid shows every column.">
          <div className="grid grid-cols-2 gap-2">
            {layouts.map((l) => {
              const active = ctx.mobileLayout === l.id;
              return (
                <button key={l.id} type="button" aria-pressed={active} onClick={() => ctx.patchView({ mobileLayout: l.id })} className={cn("flex min-h-14 items-center gap-2.5 rounded-xl border px-3 py-2 text-left [&_svg]:size-5 [&_svg]:shrink-0", active ? "border-accent bg-accent-soft text-accent" : "border-line text-fg-muted active:bg-bg-sunk")}>
                  {l.icon}
                  <span className="min-w-0"><span className="block text-[15px] font-medium">{l.label}</span><span className="block text-[12px] leading-4 opacity-80">{l.hint}</span></span>
                  {active && <Check className="ml-auto" />}
                </button>
              );
            })}
          </div>
        </SheetSection>
      )}

      <SheetSection title={nFilters ? `Filters · ${nFilters} active` : "Filters"}>
        <FilterBuilder fluid />
      </SheetSection>

      <SheetSection title={nSorts ? `Sort · ${nSorts}` : "Sort"}>
        <SortBuilder fluid />
      </SheetSection>

      {canGroup && (
        <SheetSection title="Group by" hint={view.type === "board" ? "Each option becomes a column." : undefined}>
          <Sel aria-label="Group by" value={view.config.groupBy ?? ""} onChange={(e) => ctx.patchView({ groupBy: e.target.value || null })} className="w-full">
            <option value="">None</option>
            {groupable.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Sel>
          {!groupable.length && <p className="mt-1.5 text-[12px] leading-5 text-fg-muted">Add a select, status or checkbox property to group rows.</p>}
          {ctx.groupProp && <div className="mt-2 flex gap-2"><button type="button" onClick={() => ctx.patchView({ collapsed: ctx.groups.map((g) => g.key) })} className="h-11 flex-1 rounded-lg border border-line text-[14px] text-fg-muted active:bg-bg-sunk">Collapse all</button><button type="button" onClick={() => ctx.patchView({ collapsed: [] })} className="h-11 flex-1 rounded-lg border border-line text-[14px] text-fg-muted active:bg-bg-sunk">Expand all</button></div>}
        </SheetSection>
      )}

      {usesCards && candidates.length > 0 && (
        <SheetSection title="Shown on cards" hint={`Also used by the quick “New” form. ${MOBILE_PROP_COUNT} or fewer keeps cards compact.`}>
          <ul className="space-y-1">
            {candidates.map((p) => {
              const on = chosen.includes(p.id);
              return (
                <li key={p.id}>
                  <button type="button" role="checkbox" aria-checked={on} onClick={() => toggleCardProp(p.id)} className="flex h-11 w-full items-center gap-2.5 rounded-lg px-2 text-left text-[15px] active:bg-bg-sunk">
                    <span className={cn("grid size-5 shrink-0 place-items-center rounded border", on ? "border-accent bg-accent text-accent-fg" : "border-line-strong")}>{on && <Check className="size-3.5" />}</span>
                    <TypeIcon type={p.type} />
                    <span className="min-w-0 flex-1 truncate">{p.name}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          {explicit && <button type="button" onClick={() => ctx.patchView({ mobileProps: null })} className="mt-1 h-11 rounded-lg px-2 text-[14px] font-medium text-accent active:bg-accent-soft">Reset to the first {MOBILE_PROP_COUNT} properties</button>}
        </SheetSection>
      )}

      <SheetSection title="Properties" hint="Show, hide, reorder or edit the properties of this view.">
        <PropertyManager onClose={onDone} />
      </SheetSection>

      <div className="sticky bottom-0 -mx-4 border-t border-line bg-bg-elev px-4 pt-3">
        <Button className="h-11 w-full text-[15px]" onClick={onDone}>Done</Button>
      </div>
    </div>
  );
}
