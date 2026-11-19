"use client";
import { useMemo, useState } from "react";
import { Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Empty } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import type { RowOut } from "@/lib/databases/types";
import { dateOf } from "@/lib/databases/values";
import { useDb, useRowsQuery } from "../hooks";
import { shiftDate } from "../dates";
import { toast } from "@/components/ui/toast";
import { useRef } from "react";
import { OPTION_CLASS } from "../colors";

const DAY = 864e5;
const day0 = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const fmtDay = (d: Date) => d.toLocaleDateString("en-CA", { day: "numeric", month: "short", year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
interface Item { r: RowOut; a: Date; b: Date }
const fmtIso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

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
  // 3.0: the timeline asks the server for the rows that have a start date (up to 500, in the view's order) and, apart, for those without
  const LIMIT = 500;
  const datedQ = useRowsQuery(ctx.db.id, ctx.view.id, ctx.search, { tag: "timeline", enabled: !!sp, limit: LIMIT, extraFilter: sp ? { and: [{ property: sp.id, op: "not_empty" }] } : null });
  const undatedQ = useRowsQuery(ctx.db.id, ctx.view.id, ctx.search, { tag: "undated", enabled: !!sp && sp.type === "date", limit: 50, extraFilter: sp ? { and: [{ property: sp.id, op: "empty" }] } : null });
  const rows = datedQ.data?.rows; const undatedRows = undatedQ.data?.rows; const undatedTotal = undatedQ.data?.total ?? 0;
  // drag: move the whole bar, or stretch one end; saved on release, undoable
  const [drag, setDrag] = useState<{ id: string; mode: "move" | "start" | "end"; dx: number } | null>(null); const moved = useRef(false);
  const [allUndated, setAllUndated] = useState(false);

  const data = useMemo(() => {
    if (!sp || !ep) return null;
    const items = (rows ?? []).map((r) => {
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
    return { items, min, max, days, cols, today, todayX: ((today.getTime() - min.getTime()) / DAY) * px, undated: undatedRows ?? [] };
  }, [rows, undatedRows, sp, ep, scale, px]);

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

  const undated = undatedTotal > 0 && (
    <div className="mt-3 text-[12px] leading-5 text-fg-muted max-md:text-[13px]" data-testid="undated">
      {undatedTotal.toLocaleString("en-CA")} row{undatedTotal > 1 ? "s" : ""} without a start date:{" "}
      {data.undated.slice(0, allUndated ? 50 : 5).map((r) => <button key={r.id} type="button" onClick={() => ctx.open(r.id)} className="mr-2 underline decoration-line underline-offset-2 hover:text-fg max-md:inline-flex max-md:min-h-11 max-md:items-center">{r.title || "Untitled"}</button>)}
      {!allUndated && undatedTotal > 5 && <button type="button" onClick={() => setAllUndated(true)} className="font-medium text-accent hover:underline max-md:inline-flex max-md:min-h-11 max-md:items-center">Show {undatedTotal > data.undated.length ? `the first ${data.undated.length}` : `all ${undatedTotal}`}</button>}
    </div>
  );
  const truncated = (datedQ.data?.total ?? 0) > data.items.length && (
    <p role="status" className="mb-2 rounded-md border border-line bg-bg-sunk px-2.5 py-1.5 text-[12px] text-fg-muted max-md:text-[13px]">Showing the first {data.items.length.toLocaleString("en-CA")} of {(datedQ.data?.total ?? 0).toLocaleString("en-CA")} dated rows (in the view's order). Add a filter to this view to narrow the timeline.</p>
  );
  const editable = sp.type === "date" && (ep?.type ?? "date") === "date" && !ctx.isMobile;
  const days = (dx: number) => Math.round(dx / px);
  /** Apply a drag: `mode` move = both dates, start / end = one of them (an end before the start is refused). */
  const applyDrag = (i: Item, mode: "move" | "start" | "end", n: number) => {
    if (!n || !ep) return; const same = ep.id === sp.id; const values: Record<string, unknown> = {};
    const s0 = i.r.values[sp.id]; const e0 = i.r.values[ep.id] ?? s0;
    if (mode === "move") { values[sp.id] = shiftDate(s0, n); if (!same) values[ep.id] = shiftDate(e0, n); }
    else if (same) values[sp.id] = shiftDate(s0, n);
    else if (mode === "start") { if (i.a.getTime() + n * DAY > i.b.getTime()) { toast("The start cannot be after the end"); return; } values[sp.id] = shiftDate(s0, n); }
    else { if (i.b.getTime() + n * DAY < i.a.getTime()) { toast("The end cannot be before the start"); return; } values[ep.id] = shiftDate(e0, n); }
    ctx.setCell(i.r.id, values);
    toast(mode === "move" ? `Moved ${Math.abs(n)} day${Math.abs(n) === 1 ? "" : "s"} ${n > 0 ? "later" : "earlier"}` : "Dates changed", { action: { label: "Undo", run: () => { void ctx.undo.undo(); } } });
  };
  const startDrag = (i: Item, mode: "move" | "start" | "end", e: React.PointerEvent) => {
    if (!editable || e.button !== 0) return; e.preventDefault(); e.stopPropagation(); const x0 = e.clientX; moved.current = false; let dx = 0;
    const mv = (ev: PointerEvent) => { dx = ev.clientX - x0; if (Math.abs(dx) > 3) moved.current = true; setDrag({ id: i.r.id, mode, dx }); };
    const up = () => { window.removeEventListener("pointermove", mv); window.removeEventListener("pointerup", up); setDrag(null); if (moved.current) applyDrag(i, mode, days(dx)); setTimeout(() => { moved.current = false; }, 0); };
    window.addEventListener("pointermove", mv); window.addEventListener("pointerup", up);
  };

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

      {truncated}
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
                const dg = drag?.id === i.r.id ? drag : null; const snap = dg ? days(dg.dx) * px : 0;
                const x = ((i.a.getTime() - data.min.getTime()) / DAY) * px + (dg && dg.mode !== "end" ? snap : 0);
                const w = Math.max(px, (((i.b.getTime() - i.a.getTime()) / DAY) + 1) * px + (dg?.mode === "end" ? snap : dg?.mode === "start" ? -snap : 0));
                return (
                  <div key={i.r.id} className="relative h-9 border-b border-line max-md:h-11">
                    <button type="button" data-bar={i.r.id} data-start={fmtIso(i.a)} data-end={fmtIso(i.b)} aria-label={`${i.r.title || "Untitled"}, ${fmtDay(i.a)} to ${fmtDay(i.b)}${editable ? ". Drag to move; Alt+Arrow keys move it by one day." : ""}`} onPointerDown={(e) => startDrag(i, "move", e)} onClick={() => { if (!moved.current) ctx.open(i.r.id); }} onKeyDown={(e) => { if (editable && e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) { e.preventDefault(); applyDrag(i, e.shiftKey ? "end" : "move", e.key === "ArrowRight" ? 1 : -1); } }}
                      className={cn("absolute top-1.5 h-6 touch-none truncate rounded-md border border-line px-1.5 text-left text-[11px] leading-6 shadow-card hover:shadow-pop max-md:top-1 max-md:h-9 max-md:leading-9", editable && "cursor-grab", dg && "z-[2] cursor-grabbing shadow-pop", colorOf(i.r))} style={{ left: x, width: w }}>{w > 60 ? i.r.title : ""}</button>
                    {editable && <>
                      <span aria-hidden data-handle="start" onPointerDown={(e) => startDrag(i, "start", e)} className="absolute top-1.5 z-[3] h-6 w-1.5 cursor-ew-resize touch-none rounded-l-md hover:bg-accent/50" style={{ left: x }} />
                      <span aria-hidden data-handle="end" onPointerDown={(e) => startDrag(i, "end", e)} className="absolute top-1.5 z-[3] h-6 w-1.5 cursor-ew-resize touch-none rounded-r-md hover:bg-accent/50" style={{ left: x + w - 6 }} />
                    </>}
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
