"use client";
import { useMemo } from "react";
import { Empty } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { dateOf } from "@/lib/databases/values";
import { useDb } from "../hooks";
import { OPTION_CLASS } from "../colors";

const DAY = 864e5; const day0 = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export function TimelineView() {
  const ctx = useDb(); const sp = ctx.props.find((p) => p.id === ctx.view.config.startProperty); const ep = ctx.props.find((p) => p.id === ctx.view.config.endProperty) ?? sp; const scale = ctx.view.config.scale ?? "week"; const px = scale === "week" ? 28 : 8;
  const st = ctx.props.find((p) => p.type === "status" || p.type === "select");
  const data = useMemo(() => {
    if (!sp || !ep) return null;
    const items = ctx.rows.map((r) => { const s = dateOf(r.values[sp.id]); const e = dateOf(r.values[ep.id]) ?? s; if (!s) return null; const a = day0(s), b = day0(e && e >= s ? e : s); return { r, a, b }; }).filter(Boolean) as { r: (typeof ctx.rows)[number]; a: Date; b: Date }[];
    const today = day0(new Date()); const min = new Date(Math.min(today.getTime(), ...items.map((i) => i.a.getTime())) - 7 * DAY); const max = new Date(Math.max(today.getTime(), ...items.map((i) => i.b.getTime())) + 14 * DAY);
    const days = Math.round((max.getTime() - min.getTime()) / DAY) + 1; const cols: { label: string; x: number; w: number }[] = [];
    for (let d = new Date(min); d <= max; ) { const start = new Date(d); if (scale === "week") { d.setDate(d.getDate() + 1); } else { d = new Date(d.getFullYear(), d.getMonth() + 1, 1); } const end = d > max ? new Date(max.getTime() + DAY) : d; const x = ((start.getTime() - min.getTime()) / DAY) * px; cols.push({ label: scale === "week" ? start.toLocaleDateString("en-CA", { day: "numeric", month: start.getDate() === 1 ? "short" : undefined }) : start.toLocaleDateString("en-CA", { month: "short", year: "numeric" }), x, w: Math.round((end.getTime() - start.getTime()) / DAY) * px }); }
    return { items, min, days, cols, todayX: ((today.getTime() - min.getTime()) / DAY) * px, undated: ctx.rows.filter((r) => !dateOf(r.values[sp.id])) };
  }, [ctx.rows, sp, ep, scale, px]);
  if (!sp || !data) return <Empty title="Choose start and end date properties" hint="Open the view settings (click the active tab) to pick the date properties used for the bars." />;
  const width = data.days * px;
  return (
    <div>
      <div className="mb-2 flex items-center gap-1 text-[12px]"><span className="text-fg-muted">Scale</span>{(["week", "month"] as const).map((s) => <button key={s} type="button" onClick={() => ctx.patchView({ scale: s })} className={cn("h-7 rounded-md px-2 capitalize", scale === s ? "bg-bg-sunk font-medium" : "text-fg-muted hover:bg-bg-sunk")}>{s}</button>)}</div>
      <div className="overflow-x-auto rounded-md border border-line">
        <div className="relative" style={{ width: width + 192 }}>
          <div className="sticky left-0 z-[2] w-48 shrink-0" />
          <div className="flex">
            <div className="sticky left-0 z-[2] w-48 shrink-0 border-r border-line bg-bg"><div className="h-8 border-b border-line" />{data.items.map((i) => <button key={i.r.id} type="button" onClick={() => ctx.open(i.r.id)} className="flex h-9 w-full items-center truncate border-b border-line px-2 text-left text-[13px] hover:bg-bg-sunk">{i.r.icon ? `${i.r.icon} ` : ""}{i.r.title || "Untitled"}</button>)}</div>
            <div className="relative" style={{ width }}>
              <div className="relative h-8 border-b border-line text-[11px] text-fg-muted">{data.cols.map((c, i) => <div key={i} className="absolute top-0 flex h-8 items-center truncate border-l border-line pl-1" style={{ left: c.x, width: c.w }}>{c.label}</div>)}</div>
              <div className="absolute bottom-0 top-8 z-[1] w-px bg-accent" style={{ left: data.todayX }} />
              {data.items.map((i) => { const x = ((i.a.getTime() - data.min.getTime()) / DAY) * px; const w = Math.max(px, (((i.b.getTime() - i.a.getTime()) / DAY) + 1) * px); const o = st ? (st.config.options ?? []).find((op) => op.id === i.r.values[st.id]) : null; return (
                <div key={i.r.id} className="relative h-9 border-b border-line"><button type="button" onClick={() => ctx.open(i.r.id)} className={cn("absolute top-1.5 h-6 truncate rounded-md border border-line px-1.5 text-left text-[11px] leading-6 shadow-card hover:shadow-pop", o ? OPTION_CLASS[o.color] : "bg-accent-soft text-accent")} style={{ left: x, width: w }}>{w > 60 ? i.r.title : ""}</button></div>); })}
            </div>
          </div>
        </div>
      </div>
      {data.undated.length > 0 && <div className="mt-3 text-[12px] text-fg-faint">{data.undated.length} row{data.undated.length > 1 ? "s" : ""} without a start date: {data.undated.slice(0, 5).map((r) => <button key={r.id} type="button" onClick={() => ctx.open(r.id)} className="mr-1 underline decoration-line hover:text-fg">{r.title || "Untitled"}</button>)}{data.undated.length > 5 && "…"}</div>}
    </div>
  );
}
