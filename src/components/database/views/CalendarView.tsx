"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Plus, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Empty } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import type { RowOut } from "@/lib/databases/types";
import { dateOf } from "@/lib/databases/values";
import { useDb } from "../hooks";
import { CellDisplay } from "../cells/Cell";

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const firstOfMonth = (d = new Date()) => { const x = new Date(d); x.setDate(1); x.setHours(0, 0, 0, 0); return x; };

export function CalendarView() {
  const ctx = useDb();
  const dp = ctx.props.find((p) => p.id === ctx.view.config.dateProperty);
  const [cur, setCur] = useState(() => firstOfMonth());

  const byDay = useMemo(() => {
    const map = new Map<string, RowOut[]>();
    if (!dp) return map;
    for (const r of ctx.rows) { const d = dateOf(r.values[dp.id]); if (!d) continue; const k = iso(d); map.set(k, [...(map.get(k) ?? []), r]); }
    return map;
  }, [ctx.rows, dp]);

  if (!dp) {
    return (
      <Empty
        title="Choose a date property"
        hint="A calendar places rows on the day held by one of their date properties."
        action={<Button size="sm" variant="outline" className="max-md:h-11 max-md:px-4" onClick={ctx.openViewSettings}><Settings2 /> Open view settings</Button>}
      />
    );
  }

  const month = cur.getMonth();
  const label = cur.toLocaleDateString("en-CA", { month: "long", year: "numeric" });
  const today = iso(new Date());
  const nav = (n: number) => setCur((c) => { const d = new Date(c); d.setMonth(d.getMonth() + n); return d; });
  const canAdd = dp.type === "date";
  const add = (d: Date) => ctx.newRow(canAdd ? { [dp.id]: iso(d) } : {});
  const undated = ctx.rows.filter((r) => !dateOf(r.values[dp.id]));

  const navBtn = "grid size-8 place-items-center rounded-md hover:bg-bg-sunk max-md:size-11 max-md:rounded-lg";
  const header = (
    <div className="mb-2 flex items-center gap-1">
      <h3 className="text-sm font-medium capitalize max-md:text-[16px] max-md:font-semibold" aria-live="polite">{label}</h3>
      <div className="ml-auto flex items-center gap-0.5">
        <button type="button" aria-label="Previous month" onClick={() => nav(-1)} className={navBtn}><ChevronLeft className="size-4 max-md:size-5" /></button>
        <button type="button" onClick={() => setCur(firstOfMonth())} className="h-8 rounded-md px-2 text-[12px] hover:bg-bg-sunk max-md:h-11 max-md:rounded-lg max-md:px-3 max-md:text-[14px]">Today</button>
        <button type="button" aria-label="Next month" onClick={() => nav(1)} className={navBtn}><ChevronRight className="size-4 max-md:size-5" /></button>
      </div>
    </div>
  );
  const undatedNote = undated.length > 0 && (
    <div className="mt-3 text-[12px] leading-5 text-fg-muted max-md:text-[13px]">
      {undated.length} row{undated.length > 1 ? "s" : ""} without a date:{" "}
      {undated.slice(0, 5).map((r) => <button key={r.id} type="button" onClick={() => ctx.open(r.id)} className="mr-2 underline decoration-line underline-offset-2 hover:text-fg max-md:inline-flex max-md:min-h-11 max-md:items-center">{r.title || "Untitled"}</button>)}
      {undated.length > 5 && "…"}
    </div>
  );

  if (ctx.isMobile) return <div>{header}<Agenda cur={cur} byDay={byDay} today={today} canAdd={canAdd} onAdd={add} />{undatedNote}</div>;

  // ---------- desktop: month grid
  const start = new Date(cur);
  start.setDate(1 - ((cur.getDay() + 6) % 7));
  const days: Date[] = [];
  for (let i = 0; i < 42; i++) { const d = new Date(start); d.setDate(start.getDate() + i); days.push(d); }
  return (
    <div>
      {header}
      <div className="grid grid-cols-7 border-l border-t border-line text-[11px]">
        {DOW.map((d) => <div key={d} className="border-b border-r border-line px-1.5 py-1 font-medium text-fg-muted">{d}</div>)}
        {days.map((d) => {
          const k = iso(d); const evs = byDay.get(k) ?? [];
          return (
            <div key={k} onDoubleClick={() => canAdd && add(d)} className={cn("group/day relative min-h-[6rem] border-b border-r border-line p-1", d.getMonth() !== month && "bg-bg-sunk/40 text-fg-faint")}>
              <div className="flex items-center">
                <span className={cn("grid size-5 place-items-center rounded-full text-[11px]", k === today && "bg-accent font-medium text-accent-fg")}>{d.getDate()}</span>
                {canAdd && <button type="button" aria-label={`New row on ${d.toLocaleDateString("en-CA", { day: "numeric", month: "long" })}`} onClick={() => add(d)} className="ml-auto grid size-5 place-items-center rounded text-fg-faint opacity-0 hover:bg-bg-sunk hover:text-fg focus-visible:opacity-100 group-hover/day:opacity-100 [@media(hover:none)]:opacity-100"><Plus className="size-3" /></button>}
              </div>
              <div className="mt-0.5 space-y-0.5">{evs.slice(0, 4).map((r) => <Chip key={r.id} row={r} />)}{evs.length > 4 && <div className="px-1 text-[10px] text-fg-faint">+{evs.length - 4} more</div>}</div>
            </div>
          );
        })}
      </div>
      {undatedNote}
    </div>
  );
}

/**
 * Phone calendar: a compact strip of the month's days (scrolls inside itself, a dot marks days with rows) above an
 * agenda grouped by day. Tapping a day selects it: the agenda jumps to it and "New" creates on that date.
 */
function Agenda({ cur, byDay, today, canAdd, onAdd }: { cur: Date; byDay: Map<string, RowOut[]>; today: string; canAdd: boolean; onAdd: (d: Date) => void }) {
  const days = useMemo(() => {
    const out: Date[] = [];
    for (const d = new Date(cur); d.getMonth() === cur.getMonth(); d.setDate(d.getDate() + 1)) out.push(new Date(d));
    return out;
  }, [cur]);
  const inThisMonth = today.slice(0, 7) === iso(cur).slice(0, 7);
  const [selected, setSelected] = useState<string>(inThisMonth ? today : iso(cur));
  const strip = useRef<HTMLDivElement>(null);

  // New month: select today when it is in view, else the 1st; keep the selected chip visible inside the strip.
  useEffect(() => { setSelected(inThisMonth ? today : iso(cur)); }, [cur]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const box = strip.current; const el = box?.querySelector<HTMLElement>(`[data-day="${selected}"]`);
    if (box && el) box.scrollTo({ left: el.offsetLeft - box.clientWidth / 2 + el.clientWidth / 2 });
  }, [selected, days]);

  const withRows = days.filter((d) => byDay.has(iso(d)));
  const pick = (k: string) => {
    setSelected(k);
    document.getElementById(`agenda-${k}`)?.scrollIntoView({ block: "nearest" });
  };
  const selectedDate = days.find((d) => iso(d) === selected) ?? days[0];
  const selectedLabel = selectedDate.toLocaleDateString("en-CA", { weekday: "long", day: "numeric", month: "long" });

  return (
    <div>
      <div ref={strip} role="group" aria-label="Days of the month" className="relative flex gap-1 overflow-x-auto overscroll-x-contain pb-2 [scrollbar-width:none]">
        {days.map((d) => {
          const k = iso(d); const n = byDay.get(k)?.length ?? 0; const isSel = k === selected;
          return (
            <button
              key={k}
              type="button"
              data-day={k}
              aria-pressed={isSel}
              aria-label={`${d.toLocaleDateString("en-CA", { weekday: "long", day: "numeric", month: "long" })}, ${n} row${n === 1 ? "" : "s"}${k === today ? ", today" : ""}`}
              onClick={() => pick(k)}
              className={cn("flex h-14 w-11 shrink-0 flex-col items-center justify-center rounded-xl border text-[11px]", isSel ? "border-accent bg-accent text-accent-fg" : k === today ? "border-accent/50 text-accent" : "border-line text-fg-muted")}
            >
              <span aria-hidden>{d.toLocaleDateString("en-CA", { weekday: "narrow" })}</span>
              <span aria-hidden className="text-[15px] font-semibold leading-5">{d.getDate()}</span>
              <span aria-hidden className={cn("mt-0.5 size-1 rounded-full", n ? (isSel ? "bg-accent-fg" : "bg-accent") : "bg-transparent")} />
            </button>
          );
        })}
      </div>

      {canAdd && (
        <button type="button" onClick={() => onAdd(selectedDate)} className="mb-3 flex h-11 w-full items-center gap-1.5 rounded-xl border border-dashed border-line px-3 text-[14px] text-fg-muted active:bg-bg-sunk">
          <Plus className="size-4" /> New on {selectedLabel}
        </button>
      )}

      {withRows.length === 0 ? (
        <p className="py-8 text-center text-[14px] text-fg-muted">Nothing dated this month.</p>
      ) : (
        <ol className="space-y-4">
          {withRows.map((d) => {
            const k = iso(d);
            return (
              <li key={k} id={`agenda-${k}`} className="scroll-mt-4">
                <h4 className={cn("mb-1.5 flex items-center gap-2 text-[13px] font-semibold", k === today ? "text-accent" : k === selected ? "text-fg" : "text-fg-muted")}>
                  {d.toLocaleDateString("en-CA", { weekday: "short", day: "numeric", month: "short" })}
                  {k === today && <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium">Today</span>}
                </h4>
                <div className="space-y-1.5">{byDay.get(k)!.map((r) => <Chip key={r.id} row={r} big />)}</div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

function Chip({ row, big }: { row: RowOut; big?: boolean }) {
  const ctx = useDb();
  const st = ctx.props.find((p) => p.type === "status" || p.type === "select");
  return (
    <button type="button" onClick={() => ctx.open(row.id)} className={cn("flex w-full items-center gap-2 rounded border border-line bg-bg-elev text-left hover:bg-bg-sunk", big ? "min-h-12 rounded-xl px-3 py-2 text-[15px] shadow-card" : "h-5 gap-1 truncate px-1 text-[11px]")}>
      <span className={cn("min-w-0 flex-1", big ? "[overflow-wrap:anywhere]" : "truncate")}>{row.icon ? `${row.icon} ` : ""}{row.title || "Untitled"}</span>
      {big && st && <span className="shrink-0"><CellDisplay p={st} value={row.values[st.id]} compact /></span>}
    </button>
  );
}
