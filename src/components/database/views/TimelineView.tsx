"use client";
import { useMemo, useState } from "react";
import { Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Empty } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import type { RowOut } from "@/lib/databases/types";
import { dateOf } from "@/lib/databases/values";
import { useDb } from "../hooks";
import { OPTION_CLASS } from "../colors";

const DAY = 864e5;
const day0 = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const fmtDay = (d: Date) => d.toLocaleDateString("en-CA", { day: "numeric", month: "short", year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
interface Item { r: RowOut; a: Date; b: Date }

/**
 * Timeline. Desktop: the wide chart. Phone: a vertical list sorted by start date, each row with its dates and a
 * duration bar placed on the overall range; the chart stays available ("Chart") and scrolls inside its own container.
 */
export function TimelineView() {
  const ctx = useDb();
  const sp = ctx.props.find((p) => p.id === ctx.view.config.startProperty);
  const ep = ctx.props.find((p) => p.id === ctx.view.config.endProperty) ?? sp;
  const scale = ctx.view.config.scale ?? "week";
  const px = scale === "week" ? 28 : 8;
  const st = ctx.props.find((p) => p.type === "status" || p.type === "select");
  const [phoneMode, setPhoneMode] = useState<"list" | "chart">("list");

  const data = useMemo(() => {
    if (!sp || !ep) return null;
    const items = ctx.rows.map((r) => {
      const s = dateOf(r.values[sp.id]); const e = dateOf(r.values[ep.id]) ?? s;
      if (!s) return null;
      return { r, a: day0(s), b: day0(e && e >= s ? e : s) };
    }).filter(Boolean) as Item[];
    const today = day0(new Date());
    const min = new Date(Math.min(today.getTime(), ...items.map((i) => i.a.getTime())) - 7 * DAY);
    const max = new Date(Math.max(today.getTime(), ...items.map((i) => i.b.getTime())) + 14 * DAY);
    const days = Math.round((max.getTime() - min.getTime()) / DAY) + 1;
    const cols: { label: string; x: number; w: number }[] = [];
    for (let d = new Date(min); d <= max; ) {
      const start = new Date(d);
      if (scale === "week") d.setDate(d.getDate() + 1); else d = new Date(d.getFullYear(), d.getMonth() + 1, 1);
      const end = d > max ? new Date(max.getTime() + DAY) : d;
      const x = ((start.getTime() - min.getTime()) / DAY) * px;
      const label = scale === "week"
        ? start.toLocaleDateString("en-CA", { day: "numeric", month: start.getDate() === 1 ? "short" : undefined })
        : start.toLocaleDateString("en-CA", { month: "short", year: "numeric" });
      cols.push({ label, x, w: Math.round((end.getTime() - start.getTime()) / DAY) * px });
    }
    return { items, min, max, days, cols, today, todayX: ((today.getTime() - min.getTime()) / DAY) * px, undated: ctx.rows.filter((r) => !dateOf(r.values[sp.id])) };
  }, [ctx.rows, sp, ep, scale, px]);

  if (!sp || !data) {
    return (
      <Empty
        title="Choose start and end date properties"
        hint="A timeline draws one bar per row, from its start date to its end date."
        action={<Button size="sm" variant="outline" className="max-md:h-11 max-md:px-4" onClick={ctx.openViewSettings}><Settings2 /> Open view settings</Button>}
      />
    );
  }

  const colorOf = (r: RowOut) => { const o = st ? (st.config.options ?? []).find((op) => op.id === r.values[st.id]) : null; return o ? OPTION_CLASS[o.color] : "bg-accent-soft text-accent"; };
  const segBtn = (active: boolean) => cn("h-7 rounded-md px-2 capitalize max-md:h-11 max-md:rounded-lg max-md:px-3 max-md:text-[14px]", active ? "bg-bg-sunk font-medium" : "text-fg-muted hover:bg-bg-sunk");
  const showChart = !ctx.isMobile || phoneMode === "chart";
  const width = data.days * px;

  const undated = data.undated.length > 0 && (
    <div className="mt-3 text-[12px] leading-5 text-fg-muted max-md:text-[13px]">
      {data.undated.length} row{data.undated.length > 1 ? "s" : ""} without a start date:{" "}
      {data.undated.slice(0, 5).map((r) => <button key={r.id} type="button" onClick={() => ctx.open(r.id)} className="mr-2 underline decoration-line underline-offset-2 hover:text-fg max-md:inline-flex max-md:min-h-11 max-md:items-center">{r.title || "Untitled"}</button>)}
      {data.undated.length > 5 && "…"}
    </div>
  );

  return (
    <div className="min-w-0">
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]">
        {ctx.isMobile && (
          <div role="group" aria-label="Timeline layout" className="flex items-center gap-1">
            {(["list", "chart"] as const).map((m) => <button key={m} type="button" aria-pressed={phoneMode === m} onClick={() => setPhoneMode(m)} className={segBtn(phoneMode === m)}>{m}</button>)}
          </div>
        )}
        {showChart && (
          <div role="group" aria-label="Scale" className="flex items-center gap-1">
            <span className="text-fg-muted max-md:text-[13px]">Scale</span>
            {(["week", "month"] as const).map((s) => <button key={s} type="button" aria-pressed={scale === s} onClick={() => ctx.patchView({ scale: s })} className={segBtn(scale === s)}>{s}</button>)}
          </div>
        )}
      </div>

      {!showChart ? (
        <PhoneList items={data.items} min={data.min} max={data.max} today={data.today} colorOf={colorOf} />
      ) : (
        // The wide canvas scrolls here, inside its own container — the page itself never scrolls sideways.
        <div role="region" aria-label="Timeline chart, scroll sideways" tabIndex={0} className="max-w-full overflow-x-auto overscroll-x-contain rounded-md border border-line">
          <div className="relative flex" style={{ width: width + (ctx.isMobile ? 112 : 192) }}>
            <div className="sticky left-0 z-[2] w-48 shrink-0 border-r border-line bg-bg max-md:w-28">
              <div className="h-8 border-b border-line" />
              {data.items.map((i) => <button key={i.r.id} type="button" onClick={() => ctx.open(i.r.id)} className="block h-9 w-full truncate border-b border-line px-2 text-left text-[13px] hover:bg-bg-sunk max-md:h-11">{i.r.icon ? `${i.r.icon} ` : ""}{i.r.title || "Untitled"}</button>)}
            </div>
            <div className="relative" style={{ width }}>
              <div className="relative h-8 border-b border-line text-[11px] text-fg-muted">{data.cols.map((c, i) => <div key={i} className="absolute top-0 flex h-8 items-center truncate border-l border-line pl-1" style={{ left: c.x, width: c.w }}>{c.label}</div>)}</div>
              <div aria-hidden className="absolute bottom-0 top-8 z-[1] w-px bg-accent" style={{ left: data.todayX }} />
              {data.items.map((i) => {
                const x = ((i.a.getTime() - data.min.getTime()) / DAY) * px;
                const w = Math.max(px, (((i.b.getTime() - i.a.getTime()) / DAY) + 1) * px);
                return (
                  <div key={i.r.id} className="relative h-9 border-b border-line max-md:h-11">
                    <button type="button" aria-label={`${i.r.title || "Untitled"}, ${fmtDay(i.a)} to ${fmtDay(i.b)}`} onClick={() => ctx.open(i.r.id)} className={cn("absolute top-1.5 h-6 truncate rounded-md border border-line px-1.5 text-left text-[11px] leading-6 shadow-card hover:shadow-pop max-md:top-1 max-md:h-9 max-md:leading-9", colorOf(i.r))} style={{ left: x, width: w }}>{w > 60 ? i.r.title : ""}</button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
      {undated}
    </div>
  );
}

/** Vertical list sorted by start date; the bar shows where the row sits in the whole range and how long it lasts. */
function PhoneList({ items, min, max, today, colorOf }: { items: Item[]; min: Date; max: Date; today: Date; colorOf: (r: RowOut) => string }) {
  const ctx = useDb();
  const sorted = useMemo(() => [...items].sort((x, y) => x.a.getTime() - y.a.getTime() || x.b.getTime() - y.b.getTime()), [items]);
  const span = Math.max(DAY, max.getTime() - min.getTime() + DAY);
  const pct = (t: number) => Math.min(100, Math.max(0, ((t - min.getTime()) / span) * 100));
  if (!sorted.length) return <p className="py-8 text-center text-[14px] text-fg-muted">No row has a start date yet.</p>;
  return (
    <ol className="space-y-2">
      {sorted.map((i) => {
        const days = Math.round((i.b.getTime() - i.a.getTime()) / DAY) + 1;
        const left = pct(i.a.getTime());
        const width = Math.max(2.5, pct(i.b.getTime() + DAY) - left);
        const state = i.b < today ? "Past" : i.a > today ? "Upcoming" : "Now";
        return (
          <li key={i.r.id}>
            <button type="button" onClick={() => ctx.open(i.r.id)} className="block w-full rounded-xl border border-line bg-bg-elev px-3.5 py-3 text-left shadow-card active:bg-bg-hover">
              <span className="flex items-start gap-2">
                <span className="min-w-0 flex-1 text-[15px] font-semibold leading-5 [overflow-wrap:anywhere]">{i.r.icon ? `${i.r.icon} ` : ""}{i.r.title || <span className="font-normal text-fg-faint">Untitled</span>}</span>
                <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium", state === "Now" ? "bg-accent-soft text-accent" : "bg-bg-sunk text-fg-muted")}>{state}</span>
              </span>
              <span className="mt-1 block text-[13px] text-fg-muted">
                {days === 1 ? fmtDay(i.a) : `${fmtDay(i.a)} → ${fmtDay(i.b)}`} · {days} day{days === 1 ? "" : "s"}
              </span>
              <span aria-hidden className="relative mt-2 block h-2 overflow-hidden rounded-full bg-bg-sunk">
                <span className={cn("absolute inset-y-0 rounded-full border border-line", colorOf(i.r))} style={{ left: `${left}%`, width: `${Math.min(width, 100 - left)}%` }} />
                <span className="absolute inset-y-0 w-px bg-accent" style={{ left: `${pct(today.getTime())}%` }} />
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
