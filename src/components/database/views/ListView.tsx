"use client";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { isEmpty } from "@/lib/databases/values";
import { useDb } from "../hooks";
import { CellDisplay } from "../cells/Cell";
import { groupRows } from "../group";
import { OPTION_CLASS } from "../colors";

/** List: one line per row on desktop; on phones the title sits above its priority properties (rows ≥ 48 px). */
export function ListView() {
  const ctx = useDb();
  const gb = ctx.props.find((p) => p.id === ctx.view.config.groupBy);
  const groups = groupRows(ctx.rows, gb);
  const side = (ctx.isMobile ? ctx.priorityProps : ctx.visibleProps).filter((p) => p.type !== "title" && p.id !== gb?.id);
  const max = ctx.isMobile ? 3 : 5;
  return (
    <div className="space-y-3">
      {groups.map((g) => (g.rows.length || !gb) ? (
        <section key={g.key} aria-label={gb ? g.label : "Rows"}>
          {gb && <h3 className="mb-1 flex items-center gap-1.5"><span className={cn("rounded-md px-1.5 py-0.5 text-[12px] font-medium max-md:text-[13px]", OPTION_CLASS[g.color])}>{g.label}</span><span className="text-[12px] tabular-nums text-fg-faint max-md:text-[13px] max-md:text-fg-muted">{g.rows.length}</span></h3>}
          <div className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-bg-elev shadow-card">
            {g.rows.map((r) => {
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
          </div>
        </section>
      ) : null)}
    </div>
  );
}
