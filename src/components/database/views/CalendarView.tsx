"use client";
import { useState } from "react";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { Empty } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import type { RowOut } from "@/lib/databases/types";
import { dateOf } from "@/lib/databases/values";
import { useDb } from "../hooks";
import { CellDisplay } from "../cells/Cell";

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export function CalendarView() {
  const ctx = useDb(); const dp = ctx.props.find((p) => p.id === ctx.view.config.dateProperty); const [cur, setCur] = useState(() => { const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); return d; });
  if (!dp) return <Empty title="Choose a date property" hint="Open the view settings (click the active tab) and pick the date property to place rows on the calendar." />;
  const byDay = new Map<string, RowOut[]>(); for (const r of ctx.rows) { const d = dateOf(r.values[dp.id]); if (!d) continue; const k = iso(d); byDay.set(k, [...(byDay.get(k) ?? []), r]); }
  const start = new Date(cur); start.setDate(1 - ((cur.getDay() + 6) % 7)); const days: Date[] = []; for (let i = 0; i < 42; i++) { const d = new Date(start); d.setDate(start.getDate() + i); days.push(d); }
  const today = iso(new Date()); const month = cur.getMonth(); const label = cur.toLocaleDateString("en-CA", { month: "long", year: "numeric" });
  const nav = (n: number) => setCur((c) => { const d = new Date(c); d.setMonth(d.getMonth() + n); return d; });
  const add = (d: Date) => ctx.addRow({ [dp.id]: dp.type === "date" ? iso(d) : undefined });
  const canAdd = dp.type === "date"; const undated = ctx.rows.filter((r) => !dateOf(r.values[dp.id]));
  const header = <div className="mb-2 flex items-center gap-1"><div className="text-sm font-medium capitalize">{label}</div><div className="ml-auto flex items-center gap-0.5"><button type="button" onClick={() => nav(-1)} className="grid size-8 place-items-center rounded-md hover:bg-bg-sunk"><ChevronLeft className="size-4" /></button><button type="button" onClick={() => { const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); setCur(d); }} className="h-8 rounded-md px-2 text-[12px] hover:bg-bg-sunk">Today</button><button type="button" onClick={() => nav(1)} className="grid size-8 place-items-center rounded-md hover:bg-bg-sunk"><ChevronRight className="size-4" /></button></div></div>;
  if (ctx.isMobile) {
    const inMonth = days.filter((d) => d.getMonth() === month && byDay.has(iso(d)));
    return <div>{header}{inMonth.length === 0 && <div className="py-8 text-center text-[13px] text-fg-muted">Nothing this month.</div>}<div className="space-y-3">{inMonth.map((d) => <div key={iso(d)}><div className={cn("mb-1 text-[12px] font-medium", iso(d) === today ? "text-accent" : "text-fg-muted")}>{d.toLocaleDateString("en-CA", { weekday: "short", day: "numeric", month: "short" })}</div><div className="space-y-1">{byDay.get(iso(d))!.map((r) => <Chip key={r.id} row={r} big />)}</div></div>)}</div>{canAdd && <button type="button" onClick={() => add(new Date())} className="mt-3 flex h-9 items-center gap-1 rounded-md px-2 text-[13px] text-fg-muted hover:bg-bg-sunk"><Plus className="size-4" /> New today</button>}</div>;
  }
  return (
    <div>{header}
      <div className="grid grid-cols-7 border-l border-t border-line text-[11px]">{DOW.map((d) => <div key={d} className="border-b border-r border-line px-1.5 py-1 font-medium text-fg-muted">{d}</div>)}
        {days.map((d) => { const k = iso(d); const evs = byDay.get(k) ?? []; return (
          <div key={k} onDoubleClick={() => canAdd && add(d)} className={cn("group/day relative min-h-[6rem] border-b border-r border-line p-1", d.getMonth() !== month && "bg-bg-sunk/40 text-fg-faint")}>
            <div className="flex items-center"><span className={cn("grid size-5 place-items-center rounded-full text-[11px]", k === today && "bg-accent font-medium text-accent-fg")}>{d.getDate()}</span>{canAdd && <button type="button" onClick={() => add(d)} className="ml-auto hidden size-5 place-items-center rounded text-fg-faint hover:bg-bg-sunk hover:text-fg group-hover/day:grid"><Plus className="size-3" /></button>}</div>
            <div className="mt-0.5 space-y-0.5">{evs.slice(0, 4).map((r) => <Chip key={r.id} row={r} />)}{evs.length > 4 && <div className="px-1 text-[10px] text-fg-faint">+{evs.length - 4} more</div>}</div>
          </div>); })}
      </div>
      {undated.length > 0 && <div className="mt-3 text-[12px] text-fg-faint">{undated.length} row{undated.length > 1 ? "s" : ""} without a date (visible in the table view).</div>}
    </div>
  );
}
function Chip({ row, big }: { row: RowOut; big?: boolean }) {
  const ctx = useDb(); const st = ctx.props.find((p) => p.type === "status" || p.type === "select");
  return <button type="button" onClick={() => ctx.open(row.id)} className={cn("flex w-full items-center gap-1 truncate rounded border border-line bg-bg-elev text-left hover:bg-bg-sunk", big ? "h-10 px-2 text-[13px]" : "h-5 px-1 text-[11px]")}><span className="truncate">{row.icon ? `${row.icon} ` : ""}{row.title || "Untitled"}</span>{big && st && <span className="ml-auto shrink-0"><CellDisplay p={st} value={row.values[st.id]} compact /></span>}</button>;
}
