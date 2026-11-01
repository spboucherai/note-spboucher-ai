"use client";
import { useId, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { cn, timeAgo } from "@/lib/utils";
import { ms, providerTone, usd } from "./format";

export interface UsagePayload { days: number; byModel: { model: string; provider: string; calls: number; errors: number; inputTokens: number; outputTokens: number; costUsd: number; latency: number | null; ttft: number | null }[]; byDay: { day: string; costUsd: number; calls: number }[]; byTask: { task: string; calls: number; costUsd: number }[]; recent: { id: string; model: string; provider: string; task: string; ok: boolean; error: string | null; costUsd: number | null; latencyMs: number | null; createdAt: string }[] }
const n = (v: unknown) => Number(v ?? 0);

function SpendBars({ byDay, days }: { byDay: UsagePayload["byDay"]; days: number }) {
  const id = useId(); const [hover, setHover] = useState<number | null>(null);
  const series: { day: string; cost: number; calls: number }[] = []; const map = new Map(byDay.map((d) => [d.day, d]));
  for (let i = days - 1; i >= 0; i--) { const d = new Date(Date.now() - i * 864e5).toISOString().slice(0, 10); const r = map.get(d); series.push({ day: d, cost: n(r?.costUsd), calls: n(r?.calls) }); }
  const W = 600, H = 150, P = { l: 40, r: 8, t: 10, b: 22 }; const max = Math.max(0.01, ...series.map((s) => s.cost)); const bw = (W - P.l - P.r) / series.length;
  const Y = (v: number) => P.t + (1 - v / max) * (H - P.t - P.b); const total = series.reduce((a, s) => a + s.cost, 0);
  const ticks = [0, max / 2, max];
  return (
    <div className="relative">
      <div className="mb-1 flex items-baseline gap-2"><span className="text-xl font-semibold">{usd(total, 2)}</span><span className="text-[12px] text-fg-muted">spent in the last {days} days · {series.reduce((a, s) => a + s.calls, 0)} calls</span></div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-labelledby={`${id}-t`}><title id={`${id}-t`}>Daily AI spend</title>
        {ticks.map((t) => <g key={t}><line x1={P.l} x2={W - P.r} y1={Y(t)} y2={Y(t)} stroke="var(--line)" /><text x={P.l - 5} y={Y(t) + 3.5} textAnchor="end" fontSize={10} fill="var(--fg-muted)">{usd(t, 2)}</text></g>)}
        {series.map((s, i) => { const x = P.l + i * bw; const h = Math.max(s.cost > 0 ? 2 : 0, (H - P.t - P.b) * (s.cost / max)); return <g key={s.day} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
          <rect x={x} y={P.t} width={bw} height={H - P.t - P.b} fill="transparent" />
          {h > 0 && <rect x={x + 1} y={H - P.b - h} width={Math.max(1, bw - 2)} height={h} rx={2} fill={hover === i ? "var(--accent)" : "color-mix(in oklab, var(--accent) 80%, var(--bg-elev))"} />}
          {(i === 0 || i === series.length - 1 || (i % 7 === 0 && i < series.length - 3)) && <text x={x + bw / 2} y={H - 6} textAnchor="middle" fontSize={9.5} fill="var(--fg-muted)">{s.day.slice(5)}</text>}
        </g>; })}
      </svg>
      {hover != null && <div className="pointer-events-none absolute right-2 top-8 rounded-lg border border-line bg-bg-elev px-2.5 py-1.5 text-[12px] shadow-pop tabular-nums"><div className="font-medium">{series[hover].day}</div><div className="text-fg-muted">{usd(series[hover].cost, 3)} · {series[hover].calls} calls</div></div>}
    </div>
  );
}
export function UsagePanel({ usage, budget, onBudget }: { usage: UsagePayload | undefined; budget: number | null; onBudget: (usd: number) => void }) {
  if (!usage) return <div className="rounded-xl border border-line p-6 text-center text-[13px] text-fg-muted">Loading usage…</div>;
  const errors = usage.recent.filter((r) => !r.ok).slice(0, 12);
  return (
    <div className="grid gap-4 lg:grid-cols-5">
      <div className="rounded-xl border border-line bg-bg-elev p-4 shadow-card lg:col-span-3">
        <div className="mb-2 flex items-center justify-between gap-2"><div className="text-[13px] font-semibold">Spend by day</div><label className="flex items-center gap-1.5 text-[12px] text-fg-muted">Daily budget $<input type="number" min={0} step={1} defaultValue={budget ?? 20} key={budget ?? "d"} onBlur={(e) => { const v = Number(e.target.value); if (Number.isFinite(v) && v !== budget) onBudget(v); }} className="h-7 w-16 rounded-md border border-line bg-bg px-1.5 text-right text-[12px] tabular-nums focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40" /></label></div>
        <SpendBars byDay={usage.byDay} days={usage.days} />
        <div className="mt-3 flex flex-wrap gap-1.5">{usage.byTask.map((t) => <span key={t.task} className="rounded-md border border-line px-1.5 py-0.5 text-[11.5px] tabular-nums"><span className="font-medium">{t.task}</span> <span className="text-fg-muted">{n(t.calls)} · {usd(n(t.costUsd), 3)}</span></span>)}{!usage.byTask.length && <span className="text-[12px] text-fg-muted">No usage recorded yet.</span>}</div>
      </div>
      <div className="rounded-xl border border-line bg-bg-elev shadow-card lg:col-span-2">
        <div className="px-4 pt-3 text-[13px] font-semibold">By model</div>
        <div className="max-h-72 overflow-auto px-2 pb-2"><table className="w-full text-[12px] tabular-nums"><thead><tr className="text-left text-[10.5px] uppercase tracking-wide text-fg-muted"><th className="px-2 py-1 font-medium">Model</th><th className="px-2 py-1 text-right font-medium">Calls</th><th className="px-2 py-1 text-right font-medium">Tokens</th><th className="px-2 py-1 text-right font-medium">p50</th><th className="px-2 py-1 text-right font-medium">Cost</th></tr></thead>
          <tbody>{usage.byModel.map((m) => <tr key={m.model} className="border-t border-line"><td className="px-2 py-1"><span className={cn("mr-1.5 inline-block size-1.5 rounded-full align-middle", providerTone(m.provider))} /><span className="font-mono text-[11.5px]">{m.model}</span>{n(m.errors) > 0 && <span className="ml-1 text-danger" title={`${n(m.errors)} errors`}>·{n(m.errors)}✕</span>}</td><td className="px-2 py-1 text-right">{n(m.calls)}</td><td className="px-2 py-1 text-right text-fg-muted">{Math.round((n(m.inputTokens) + n(m.outputTokens)) / 1000)}K</td><td className="px-2 py-1 text-right text-fg-muted">{ms(m.latency)}</td><td className="px-2 py-1 text-right">{usd(n(m.costUsd), 3)}</td></tr>)}{!usage.byModel.length && <tr><td colSpan={5} className="px-2 py-6 text-center text-fg-muted">No calls yet.</td></tr>}</tbody></table></div>
      </div>
      <div className="rounded-xl border border-line bg-bg-elev p-4 shadow-card lg:col-span-5">
        <div className="mb-1.5 flex items-center gap-1.5 text-[13px] font-semibold"><AlertTriangle className="size-4 text-warning" />Recent errors & refusals</div>
        {errors.length ? <ul className="divide-y divide-line text-[12px]">{errors.map((e) => <li key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-1.5"><span className="font-mono text-[11.5px]">{e.model}</span><span className="rounded bg-bg-sunk px-1 text-[10.5px] text-fg-muted">{e.task}</span><span className="min-w-0 flex-1 truncate text-danger" title={e.error ?? ""}>{e.error}</span><span className="text-fg-faint">{timeAgo(e.createdAt)}</span></li>)}</ul> : <div className="text-[12.5px] text-fg-muted">No errors in the last 50 calls.</div>}
      </div>
    </div>
  );
}
