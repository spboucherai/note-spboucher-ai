/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/components/ai/models/Heatmap.tsx
 * Module           : components
 * Repository       : https://git.spboucher.ai/note-spboucher-ai
 * Project Website  : https://note.spboucher.ai
 * Created          : 2026-11-01
 * Last Modified    : 2026-11-01
 *
 * Author           : Simon-Pierre Boucher
 * Position         : Professor of Finance
 * Institution      : Université du Québec en Outaouais (UQO)
 * Organization     : SP Boucher
 * Website          : https://spboucher.ai
 * Git              : https://git.spboucher.ai
 *
 * Preferred Contact: contact@spboucher.ai
 * Development      : dev@spboucher.ai
 * Support          : support@spboucher.ai
 * Security/Admin   : admin@spboucher.ai
 *
 * Copyright (c) 2026
 * Simon-Pierre Boucher
 * All rights reserved where applicable. This file is governed by the
 * applicable project license, copyright notices and relevant law.
 * Existing third-party rights and notices remain unaffected.
 *
 * License          : None specified (no license file in this repository)
 *
 * Do not embed credentials, private keys, access tokens,
 * certificates or confidential personal information.
 *
 * =============================================================================
 * END OF SP BOUCHER SOURCE HEADER
 * =============================================================================
 */

"use client";
import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { hasBench, ms, pct, providerTone, usd, type ModelRow } from "./format";

/** Models × benchmark categories. Sequential single-hue fill (accent) by pass rate; judged score printed when present. */
export function Heatmap({ models, categories }: { models: ModelRow[]; categories: { id: string; label: string }[] }) {
  const rows = useMemo(() => models.filter(hasBench).sort((a, b) => (b.benchmark!.mean_score ?? 0) - (a.benchmark!.mean_score ?? 0) || (a.benchmark!.total_median_ms ?? 0) - (b.benchmark!.total_median_ms ?? 0)), [models]);
  const [hover, setHover] = useState<{ m: ModelRow; c: string; x: number; y: number } | null>(null);
  const fill = (p: number | null | undefined) => (p == null ? "var(--bg-sunk)" : `color-mix(in oklab, var(--accent) ${Math.round(6 + p * p * 52)}%, var(--bg-elev))`);
  const cell = hover ? hover.m.benchmark?.by_category?.[hover.c] : null;
  return (
    <div className="relative">
      <div className="overflow-x-auto rounded-xl border border-line bg-bg-elev shadow-card">
        <table className="border-separate border-spacing-0 text-[11.5px] tabular-nums">
          <thead><tr><th className="sticky left-0 z-[2] bg-bg-elev px-2 py-1.5 text-left text-[11px] font-medium uppercase tracking-wide text-fg-muted">Model</th>{categories.map((c) => <th key={c.id} className="h-24 min-w-[44px] align-bottom px-0.5 pb-1 font-medium text-fg-muted"><div className="flex h-full items-end justify-center"><span className="block whitespace-nowrap text-[11px] leading-none [writing-mode:vertical-rl] rotate-180">{c.label}</span></div></th>)}</tr></thead>
          <tbody>{rows.map((m) => <tr key={m.id}>
            <td className="sticky left-0 z-[1] whitespace-nowrap bg-bg-elev py-[1px] pl-2 pr-3 font-mono text-[11.5px]"><span className={cn("mr-1.5 inline-block size-1.5 rounded-full align-middle", providerTone(m.provider))} />{m.id}</td>
            {categories.map((c) => { const v = m.benchmark?.by_category?.[c.id]; return <td key={c.id} className="p-[1px]"><button type="button" aria-label={`${m.id} ${c.label}: ${pct(v?.pass_rate)}`} onMouseEnter={(e) => setHover({ m, c: c.id, x: e.clientX, y: e.clientY })} onMouseMove={(e) => setHover({ m, c: c.id, x: e.clientX, y: e.clientY })} onMouseLeave={() => setHover(null)} onFocus={(e) => { const r = e.currentTarget.getBoundingClientRect(); setHover({ m, c: c.id, x: r.left + r.width / 2, y: r.top }); }} onBlur={() => setHover(null)} className={cn("grid h-7 w-full min-w-[44px] place-items-center rounded-[3px] text-[10.5px] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50", v && (v.pass_rate ?? 0) >= 0.75 ? "text-fg" : "text-fg-muted")} style={{ background: fill(v?.pass_rate) }}>{v?.judged != null ? v.judged.toFixed(1) : v && v.pass_rate < 1 ? pct(v.pass_rate) : ""}</button></td>; })}
          </tr>)}</tbody>
        </table>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-fg-muted"><span>Fill = pass rate</span><span className="inline-flex items-center gap-1">{[0, 0.5, 0.75, 0.9, 1].map((p) => <span key={p} className="inline-block h-3 w-6 rounded-[2px] border border-line" style={{ background: fill(p) }} title={pct(p)} />)}<span className="ml-1">0 → 100 %</span></span><span>Number = LLM-judge score (1–5) where a judged rubric exists</span><span>Grey = not run</span></div>
      {hover && <div className="pointer-events-none fixed z-50 w-56 rounded-lg border border-line bg-bg-elev p-2.5 text-[12px] shadow-pop" style={{ left: Math.min(hover.x + 12, (typeof window !== "undefined" ? window.innerWidth : 1000) - 240), top: hover.y + 12 }}>
        <div className="font-mono text-[11.5px] font-medium">{hover.m.id}</div><div className="text-fg-muted">{categories.find((c) => c.id === hover.c)?.label}</div>
        {cell ? <dl className="mt-1.5 grid grid-cols-2 gap-x-2 gap-y-0.5 tabular-nums"><dt className="text-fg-muted">Pass</dt><dd className="text-right">{pct(cell.pass_rate)} ({cell.runs} runs)</dd><dt className="text-fg-muted">Score</dt><dd className="text-right">{cell.score.toFixed(2)}</dd>{cell.judged != null && <><dt className="text-fg-muted">Judged</dt><dd className="text-right">{cell.judged.toFixed(2)} / 5</dd></>}<dt className="text-fg-muted">TTFT</dt><dd className="text-right">{ms(cell.ttft_ms)}</dd><dt className="text-fg-muted">Latency</dt><dd className="text-right">{ms(cell.total_ms)}</dd><dt className="text-fg-muted">tok/s</dt><dd className="text-right">{Math.round(cell.tps)}</dd><dt className="text-fg-muted">$/run</dt><dd className="text-right">{usd(cell.cost_mean)}</dd></dl> : <div className="mt-1 text-fg-faint">Not run for this model.</div>}
      </div>}
    </div>
  );
}
