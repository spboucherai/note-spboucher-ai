/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/components/ai/models/Scatter.tsx
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
import { useId, useMemo, useState } from "react";
import { hasBench, ms, score, usd, type ModelRow } from "./format";

interface Pt { m: ModelRow; x: number; y: number }
/** Inline-SVG scatter: x on a log scale (latency or cost), y = mean deterministic score. Colour = provider (accent / ai), legend + hover tooltip, labelled highlights. */
export function Scatter({ models, metric, highlight = [] }: { models: ModelRow[]; metric: "latency" | "cost"; highlight?: string[] }) {
  const id = useId(); const [hover, setHover] = useState<Pt | null>(null);
  const W = 560, H = 310, P = { l: 44, r: 16, t: 44, b: 36 };
  const pts = useMemo<Pt[]>(() => models.filter(hasBench).map((m) => ({ m, x: metric === "latency" ? m.benchmark!.total_median_ms ?? 0 : m.benchmark!.cost_mean ?? 0, y: m.benchmark!.mean_score ?? 0 })).filter((p) => p.x > 0), [models, metric]);
  if (!pts.length) return <div className="rounded-xl border border-line p-6 text-center text-[13px] text-fg-muted">No benchmark data.</div>;
  const xs = pts.map((p) => Math.log10(p.x)); const xmin = Math.floor(Math.min(...xs) * 2) / 2, xmax = Math.ceil(Math.max(...xs) * 2) / 2;
  const ymin = Math.min(0.9, Math.floor(Math.min(...pts.map((p) => p.y)) * 50) / 50), ymax = 1.0;
  const X = (v: number) => P.l + ((Math.log10(v) - xmin) / (xmax - xmin)) * (W - P.l - P.r); const Y = (v: number) => P.t + (1 - (v - ymin) / (ymax - ymin)) * (H - P.t - P.b);
  const xticks: number[] = []; for (let e = Math.floor(xmin); e <= Math.ceil(xmax); e++) for (const k of [1, 2, 5]) { const v = k * 10 ** e; if (Math.log10(v) >= xmin - 1e-9 && Math.log10(v) <= xmax + 1e-9) xticks.push(v); }
  const yticks = Array.from({ length: 6 }, (_, i) => ymin + ((ymax - ymin) * i) / 5);
  const fmtX = (v: number) => (metric === "latency" ? ms(v) : usd(v));
  const col = (p: string) => (p === "openai" ? "var(--accent)" : "var(--ai)");
  const labelled = new Set(highlight);
  // staggered label tiers for highlighted points (sorted by x) so labels on the same score line do not collide
  // greedy placement: a label takes the lowest tier whose previous label ends before it starts; no free tier → no label (tooltip still carries it)
  const tiers = new Map<string, number>(); const right = [-Infinity, -Infinity, -Infinity];
  pts.filter((p) => labelled.has(p.m.id)).sort((a, b) => a.x - b.x).forEach((p) => { const w = p.m.id.length * 5.6 + 8; const left = X(p.x) - w / 2; const t = right.findIndex((r) => r < left); if (t >= 0) { tiers.set(p.m.id, t); right[t] = left + w; } });
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-labelledby={`${id}-t`}>
        <title id={`${id}-t`}>{metric === "latency" ? "Median latency vs mean score" : "Cost per run vs mean score"}</title>
        {yticks.map((t) => <g key={t}><line x1={P.l} x2={W - P.r} y1={Y(t)} y2={Y(t)} stroke="var(--line)" strokeWidth={1} /><text x={P.l - 6} y={Y(t) + 3.5} textAnchor="end" fontSize={10} fill="var(--fg-muted)">{t.toFixed(2)}</text></g>)}
        {xticks.map((t) => <g key={t}><line x1={X(t)} x2={X(t)} y1={P.t} y2={H - P.b} stroke="var(--line)" strokeWidth={1} /><text x={X(t)} y={H - P.b + 14} textAnchor="middle" fontSize={10} fill="var(--fg-muted)">{fmtX(t)}</text></g>)}
        <line x1={P.l} x2={W - P.r} y1={H - P.b} y2={H - P.b} stroke="var(--line-strong)" strokeWidth={1} />
        <text x={(W + P.l - P.r) / 2} y={H - 4} textAnchor="middle" fontSize={10.5} fill="var(--fg-muted)">{metric === "latency" ? "Median latency (log)" : "Estimated $ per run (log)"}</text>
        <text transform={`translate(11 ${(H - P.b + P.t) / 2}) rotate(-90)`} textAnchor="middle" fontSize={10.5} fill="var(--fg-muted)">Mean score</text>
        {pts.map((p) => <g key={p.m.id}>
          {tiers.has(p.m.id) && <g><line x1={X(p.x)} x2={X(p.x)} y1={Y(p.y) - 5} y2={Y(p.y) - 9 - (tiers.get(p.m.id) ?? 0) * 11} stroke="var(--line-strong)" /><text x={Math.min(Math.max(X(p.x), P.l + p.m.id.length * 2.8), W - P.r - p.m.id.length * 2.8)} y={Y(p.y) - 12 - (tiers.get(p.m.id) ?? 0) * 11} textAnchor="middle" fontSize={9} fill="var(--fg)" fontFamily="var(--font-mono)">{p.m.id}</text></g>}
          <circle cx={X(p.x)} cy={Y(p.y)} r={hover?.m.id === p.m.id ? 6 : 4.5} fill={col(p.m.provider)} stroke="var(--bg-elev)" strokeWidth={2} />
          <circle cx={X(p.x)} cy={Y(p.y)} r={12} fill="transparent" tabIndex={0} aria-label={`${p.m.id}: ${fmtX(p.x)}, score ${score(p.y)}`} onMouseEnter={() => setHover(p)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(p)} onBlur={() => setHover(null)} style={{ cursor: "default", outline: "none" }} />
        </g>)}
      </svg>
      <div className="mt-1 flex items-center gap-4 text-[11px] text-fg-muted"><span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-accent" />OpenAI</span><span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-ai" />Anthropic</span><span className="ml-auto hidden sm:inline">Labels = routed primaries</span></div>
      {hover && <div className="pointer-events-none absolute left-1/2 top-2 z-10 w-60 -translate-x-1/2 rounded-lg border border-line bg-bg-elev p-2.5 text-[12px] shadow-pop sm:left-auto sm:right-3 sm:translate-x-0">
        <div className="font-mono text-[11.5px] font-medium">{hover.m.id}</div>
        <dl className="mt-1 grid grid-cols-2 gap-x-2 gap-y-0.5 tabular-nums"><dt className="text-fg-muted">Score</dt><dd className="text-right">{score(hover.y)}</dd><dt className="text-fg-muted">{metric === "latency" ? "Latency" : "$/run"}</dt><dd className="text-right">{fmtX(hover.x)}</dd><dt className="text-fg-muted">Judged</dt><dd className="text-right">{score(hover.m.benchmark?.judged_mean)}</dd><dt className="text-fg-muted">TTFT</dt><dd className="text-right">{ms(hover.m.benchmark?.ttft_median_ms)}</dd><dt className="text-fg-muted">{metric === "latency" ? "$/run" : "Latency"}</dt><dd className="text-right">{metric === "latency" ? usd(hover.m.benchmark?.cost_mean) : ms(hover.m.benchmark?.total_median_ms)}</dd></dl>
      </div>}
    </div>
  );
}
