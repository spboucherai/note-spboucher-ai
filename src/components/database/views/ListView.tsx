"use client";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { isEmpty } from "@/lib/databases/values";
import { useDb } from "../hooks";
import { CellDisplay } from "../cells/Cell";
import { groupRows } from "../group";
import { OPTION_CLASS } from "../colors";

export function ListView() {
  const ctx = useDb(); const gb = ctx.props.find((p) => p.id === ctx.view.config.groupBy); const groups = groupRows(ctx.rows, gb);
  const side = ctx.visibleProps.filter((p) => p.type !== "title" && p.id !== gb?.id);
  return (
    <div className="space-y-3">
      {groups.map((g) => (g.rows.length || !gb) ? (
        <div key={g.key}>
          {gb && <div className="mb-1 flex items-center gap-1.5"><span className={cn("rounded-md px-1.5 py-0.5 text-[12px] font-medium", OPTION_CLASS[g.color])}>{g.label}</span><span className="text-[12px] text-fg-faint">{g.rows.length}</span></div>}
          <div className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-bg-elev shadow-card">
            {g.rows.map((r) => <button key={r.id} type="button" onClick={() => ctx.open(r.id)} className="flex h-10 w-full items-center gap-3 px-3.5 text-left transition-colors hover:bg-bg-hover"><span className="min-w-0 flex-1 truncate text-[13px] font-medium">{r.icon ? `${r.icon} ` : ""}{r.title || <span className="font-normal text-fg-faint">Untitled</span>}</span><span className="flex shrink-0 items-center gap-2 text-[12px] text-fg-muted">{side.filter((p) => !isEmpty(r.values[p.id])).slice(0, ctx.isMobile ? 2 : 5).map((p) => <span key={p.id} className="max-w-[10rem] truncate"><CellDisplay p={p} value={r.values[p.id]} compact /></span>)}</span></button>)}
            <button type="button" onClick={() => ctx.addRow(gb && g.value !== undefined ? { [gb.id]: g.value } : {})} className="flex h-9 w-full items-center gap-1.5 px-3.5 text-[12px] text-fg-faint hover:bg-bg-hover hover:text-fg"><Plus className="size-3.5" /> New</button>
          </div>
        </div>) : null)}
    </div>
  );
}
