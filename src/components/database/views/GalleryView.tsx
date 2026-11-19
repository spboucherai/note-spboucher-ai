"use client";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import type { FileRef, RowOut } from "@/lib/databases/types";
import { isEmpty } from "@/lib/databases/values";
import { useDb } from "../hooks";
import { CellDisplay } from "../cells/Cell";
import { isImage } from "../cells/FileCell";

import { useGrowing, LoadMore } from "../growing";
/**
 * Gallery: 1 column on narrow phones, 2 from 400 px, auto-fill from `sm`.
 * 3.0 card options (saved with the view): cover = a file property, the page cover, or none; card size; cover fit; properties shown.
 */
export function GalleryView() {
  const ctx = useDb(); const c = ctx.view.config; const { shown, more } = useGrowing();
  const coverId = c.coverProperty; const mode = c.cover ?? "property"; const size = c.cardSize ?? "medium"; const fit = c.coverFit ?? "cover";
  const fileProps = ctx.props.filter((p) => p.type === "file");
  const cover = (r: RowOut): string | null => {
    if (mode === "none") return null;
    if (mode === "page") return r.cover && /^(https?:\/\/|\/)/.test(r.cover) ? r.cover : null;
    const ps = coverId ? ctx.props.filter((p) => p.id === coverId) : fileProps;
    for (const p of ps) { const f = (Array.isArray(r.values[p.id]) ? (r.values[p.id] as FileRef[]) : []).find(isImage); if (f) return f.url; }
    return null;
  };
  const chosen = Array.isArray(c.cardProps) ? c.cardProps.map((id) => ctx.props.find((p) => p.id === id)).filter((p): p is NonNullable<typeof p> => !!p) : null;
  const source = chosen ?? (ctx.isMobile ? ctx.priorityProps : ctx.visibleProps);
  const rows = ctx.rows.slice(0, shown);
  const cols = size === "small" ? "sm:grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))]" : size === "large" ? "sm:grid-cols-[repeat(auto-fill,minmax(18rem,1fr))]" : "sm:grid-cols-[repeat(auto-fill,minmax(13rem,1fr))]";
  return (
    <div>
    <div data-card-size={size} className={cn("grid grid-cols-1 gap-3 min-[400px]:grid-cols-2", cols)}>
      {rows.map((r) => {
        const img = cover(r);
        const props = source.filter((p) => p.type !== "title" && (chosen || p.type !== "file") && !isEmpty(r.values[p.id])).slice(0, chosen ? 8 : 4);
        return (
          <div key={r.id} data-card={r.id} className="relative flex min-w-0 flex-col overflow-hidden rounded-lg border border-line bg-bg-elev shadow-card transition-shadow hover:shadow-pop motion-reduce:transition-none">
            <button type="button" aria-label={`Open ${r.title || "Untitled"}`} onClick={() => ctx.open(r.id)} className="absolute inset-0 z-[1] rounded-lg focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/50" />
            {mode !== "none" && <div data-cover={img ? "image" : "placeholder"} className={cn("grid aspect-[16/10] w-full place-items-center overflow-hidden bg-bg-sunk", !img && "bg-gradient-to-br from-accent-soft to-bg-sunk")}>
              {img ? <img src={img} alt="" className={cn("h-full w-full", fit === "contain" ? "object-contain" : "object-cover")} loading="lazy" /> : <span aria-hidden className={cn("opacity-80", size === "small" ? "text-2xl" : "text-4xl")}>{r.icon ?? "📄"}</span>}
            </div>}
            <div className="pointer-events-none relative z-[2] p-2.5">
              <div className="truncate text-[13px] font-medium max-md:whitespace-normal max-md:text-[14px] max-md:[overflow-wrap:anywhere]">{mode === "none" && r.icon ? `${r.icon} ` : ""}{r.title || <span className="text-fg-faint">Untitled</span>}</div>
              {props.length > 0 && <div className="mt-1.5 space-y-1">{props.map((p) => <div key={p.id} data-card-prop={p.id} className="truncate text-[12px] text-fg-muted [&_a]:pointer-events-auto"><CellDisplay p={p} value={r.values[p.id]} compact /></div>)}</div>}
            </div>
          </div>
        );
      })}
      <button type="button" onClick={() => ctx.newRow()} className="grid min-h-[8rem] place-items-center rounded-lg border border-dashed border-line text-[13px] text-fg-faint hover:bg-bg-sunk hover:text-fg max-md:min-h-14 max-md:text-[14px] max-md:text-fg-muted"><span className="flex items-center gap-1"><Plus className="size-4" /> New</span></button>
    </div>
    <div className="mt-3"><LoadMore shown={shown} more={more} /></div>
    </div>
  );
}
