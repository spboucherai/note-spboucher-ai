"use client";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import type { FileRef, RowOut } from "@/lib/databases/types";
import { isEmpty } from "@/lib/databases/values";
import { useDb } from "../hooks";
import { CellDisplay } from "../cells/Cell";
import { isImage } from "../cells/FileCell";

/** Gallery: 1 column on narrow phones, 2 from 400 px, auto-fill from `sm`. */
export function GalleryView() {
  const ctx = useDb();
  const coverId = ctx.view.config.coverProperty;
  const fileProps = ctx.props.filter((p) => p.type === "file");
  const cover = (r: RowOut): FileRef | null => {
    const ps = coverId ? ctx.props.filter((p) => p.id === coverId) : fileProps;
    for (const p of ps) { const f = (Array.isArray(r.values[p.id]) ? (r.values[p.id] as FileRef[]) : []).find(isImage); if (f) return f; }
    return null;
  };
  const source = ctx.isMobile ? ctx.priorityProps : ctx.visibleProps;
  return (
    <div className="grid grid-cols-1 gap-3 min-[400px]:grid-cols-2 sm:grid-cols-[repeat(auto-fill,minmax(13rem,1fr))]">
      {ctx.rows.map((r) => {
        const c = cover(r);
        const props = source.filter((p) => p.type !== "title" && p.type !== "file" && !isEmpty(r.values[p.id])).slice(0, 4);
        return (
          <div key={r.id} className="relative flex min-w-0 flex-col overflow-hidden rounded-lg border border-line bg-bg-elev shadow-card transition-shadow hover:shadow-pop">
            <button type="button" aria-label={`Open ${r.title || "Untitled"}`} onClick={() => ctx.open(r.id)} className="absolute inset-0 z-[1] rounded-lg focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/50" />
            <div className={cn("grid aspect-[16/10] w-full place-items-center overflow-hidden bg-bg-sunk", !c && "bg-gradient-to-br from-accent-soft to-bg-sunk")}>
              {c ? <img src={c.url} alt="" className="h-full w-full object-cover" loading="lazy" /> : <span aria-hidden className="text-4xl opacity-80">{r.icon ?? "📄"}</span>}
            </div>
            <div className="pointer-events-none relative z-[2] p-2.5">
              <div className="truncate text-[13px] font-medium max-md:whitespace-normal max-md:text-[14px] max-md:[overflow-wrap:anywhere]">{r.title || <span className="text-fg-faint">Untitled</span>}</div>
              {props.length > 0 && <div className="mt-1.5 space-y-1">{props.map((p) => <div key={p.id} className="truncate text-[12px] text-fg-muted [&_a]:pointer-events-auto"><CellDisplay p={p} value={r.values[p.id]} compact /></div>)}</div>}
            </div>
          </div>
        );
      })}
      <button type="button" onClick={() => ctx.newRow()} className="grid min-h-[8rem] place-items-center rounded-lg border border-dashed border-line text-[13px] text-fg-faint hover:bg-bg-sunk hover:text-fg max-md:min-h-14 max-md:text-[14px] max-md:text-fg-muted"><span className="flex items-center gap-1"><Plus className="size-4" /> New</span></button>
    </div>
  );
}
