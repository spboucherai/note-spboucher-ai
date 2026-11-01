"use client";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import type { FileRef, RowOut } from "@/lib/databases/types";
import { isEmpty } from "@/lib/databases/values";
import { useDb } from "../hooks";
import { CellDisplay } from "../cells/Cell";
import { isImage } from "../cells/FileCell";

export function GalleryView() {
  const ctx = useDb(); const coverId = ctx.view.config.coverProperty; const fileProps = ctx.props.filter((p) => p.type === "file");
  const cover = (r: RowOut): FileRef | null => { const ps = coverId ? ctx.props.filter((p) => p.id === coverId) : fileProps; for (const p of ps) { const f = (Array.isArray(r.values[p.id]) ? (r.values[p.id] as FileRef[]) : []).find(isImage); if (f) return f; } return null; };
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(13rem,1fr))]">
      {ctx.rows.map((r) => { const c = cover(r); const props = ctx.visibleProps.filter((p) => p.type !== "title" && p.type !== "file" && !isEmpty(r.values[p.id])).slice(0, 4); return (
        <button key={r.id} type="button" onClick={() => ctx.open(r.id)} className="flex flex-col overflow-hidden rounded-lg border border-line bg-bg-elev text-left shadow-card transition-shadow hover:shadow-pop">
          <div className={cn("grid aspect-[16/10] w-full place-items-center overflow-hidden bg-bg-sunk", !c && "bg-gradient-to-br from-accent-soft to-bg-sunk")}>{c ? <img src={c.url} alt="" className="h-full w-full object-cover" loading="lazy" /> : <span className="text-4xl opacity-80">{r.icon ?? "📄"}</span>}</div>
          <div className="p-2.5"><div className="truncate text-[13px] font-medium">{r.title || <span className="text-fg-faint">Untitled</span>}</div>{props.length > 0 && <div className="mt-1.5 space-y-1">{props.map((p) => <div key={p.id} className="truncate text-[12px] text-fg-muted"><CellDisplay p={p} value={r.values[p.id]} compact /></div>)}</div>}</div>
        </button>); })}
      <button type="button" onClick={() => ctx.addRow()} className="grid min-h-[8rem] place-items-center rounded-lg border border-dashed border-line text-[13px] text-fg-faint hover:bg-bg-sunk hover:text-fg"><span className="flex items-center gap-1"><Plus className="size-4" /> New</span></button>
    </div>
  );
}
