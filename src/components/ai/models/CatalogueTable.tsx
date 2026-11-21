/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/components/ai/models/CatalogueTable.tsx
 * Module           : components
 * Repository       : https://git.spboucher.ai/note-spboucher-ai
 * Project Website  : https://note.spboucher.ai
 * Created          : 2026-11-01
 * Last Modified    : 2026-11-19
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
import { ArrowDown, ArrowUp, ArrowUpDown, Search } from "lucide-react";
import { Switch, Tip, Badge } from "@/components/ui/primitives";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { hasBench, kTok, ms, pct, perM, PROBES, providerTone, score, usd, type ModelRow } from "./format";

type Key = "provider" | "id" | "enabled" | "contextWindow" | "maxOutput" | "inputPrice" | "outputPrice" | "pass" | "score" | "judged" | "ttft" | "latency" | "tps" | "cost";
const COLS: { key: Key; label: string; num?: boolean; title?: string }[] = [
  { key: "provider", label: "Provider" }, { key: "id", label: "Model" }, { key: "enabled", label: "On", title: "Enabled for automatic routing" }, { key: "contextWindow", label: "Context", num: true }, { key: "maxOutput", label: "Max out", num: true },
  { key: "inputPrice", label: "$/M in", num: true }, { key: "outputPrice", label: "$/M out", num: true }, { key: "pass", label: "Pass", num: true, title: "Deterministic pass rate (measured)" }, { key: "score", label: "Score", num: true, title: "Mean deterministic score 0–1" }, { key: "judged", label: "Judged", num: true, title: "LLM-judge mean 1–5 (writing & synthesis only)" },
  { key: "ttft", label: "TTFT", num: true, title: "Median time to first token" }, { key: "latency", label: "Latency", num: true, title: "Median total latency" }, { key: "tps", label: "tok/s", num: true }, { key: "cost", label: "$/run", num: true, title: "Mean estimated cost per benchmark run" },
];
const val = (m: ModelRow, k: Key): number | string | null => {
  const b = m.benchmark ?? {};
  switch (k) { case "provider": return m.provider; case "id": return m.id; case "enabled": return m.enabled ? 1 : 0; case "contextWindow": return m.contextWindow; case "maxOutput": return m.maxOutput; case "inputPrice": return m.inputPrice; case "outputPrice": return m.outputPrice; case "pass": return b.pass_rate ?? null; case "score": return b.mean_score ?? null; case "judged": return b.judged_mean ?? null; case "ttft": return b.ttft_median_ms ?? null; case "latency": return b.total_median_ms ?? null; case "tps": return b.tps_median ?? null; case "cost": return b.cost_mean ?? null; }
};
export function CatalogueTable({ models, onToggle }: { models: ModelRow[]; onToggle: (id: string, enabled: boolean) => void }) {
  const [sort, setSort] = useState<{ key: Key; dir: 1 | -1 }>({ key: "score", dir: -1 }); const [provider, setProvider] = useState("all"); const [tested, setTested] = useState(true); const [textOnly, setTextOnly] = useState(true); const [q, setQ] = useState("");
  const rows = useMemo(() => models.filter((m) => (provider === "all" || m.provider === provider) && (!tested || hasBench(m)) && (!textOnly || m.category === "text" || m.category === "text-specialized") && (!q || m.id.toLowerCase().includes(q.toLowerCase()) || (m.displayName ?? "").toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => { const x = val(a, sort.key), y = val(b, sort.key); if (x == null && y == null) return a.id.localeCompare(b.id); if (x == null) return 1; if (y == null) return -1; return (typeof x === "string" ? x.localeCompare(String(y)) : x - Number(y)) * sort.dir || a.id.localeCompare(b.id); }), [models, provider, tested, textOnly, q, sort]);
  const head = (c: (typeof COLS)[number]) => <th key={c.key} title={c.title} className={cn("sticky top-0 z-[1] cursor-pointer select-none whitespace-nowrap bg-bg-elev px-2 py-1.5 text-[11px] font-medium uppercase tracking-wide text-fg-muted hover:text-fg", c.num ? "text-right" : "text-left", c.key === "id" && "sticky left-0 z-[2]")} onClick={() => setSort((s) => ({ key: c.key, dir: s.key === c.key ? (s.dir === 1 ? -1 : 1) : c.num ? -1 : 1 }))}><span className="inline-flex items-center gap-1">{c.label}{sort.key === c.key ? (sort.dir === 1 ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />) : <ArrowUpDown className="size-3 opacity-30" />}</span></th>;
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <div className="relative"><Search className="pointer-events-none absolute left-2 top-2.5 size-3.5 text-fg-faint" /><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter models" className="h-8 w-48 pl-7 text-[13px]" /></div>
        <div className="flex h-8 items-center rounded-md bg-bg-sunk p-0.5">{[["all", "All"], ["openai", "OpenAI"], ["anthropic", "Anthropic"]].map(([id, l]) => <button key={id} onClick={() => setProvider(id)} className={cn("h-7 rounded px-2.5 text-[12px]", provider === id ? "bg-bg-elev font-medium shadow-card" : "text-fg-muted")}>{l}</button>)}</div>
        <label className="flex h-8 items-center gap-1.5 text-[12.5px]"><input type="checkbox" className="accent-accent" checked={tested} onChange={(e) => setTested(e.target.checked)} />Benchmarked only</label>
        <label className="flex h-8 items-center gap-1.5 text-[12.5px]"><input type="checkbox" className="accent-accent" checked={textOnly} onChange={(e) => setTextOnly(e.target.checked)} />Text models only</label>
        <span className="ml-auto text-[12px] text-fg-muted tabular-nums">{rows.length} / {models.length}</span>
      </div>
      <div className="overflow-x-auto rounded-xl border border-line bg-bg-elev shadow-card"><div className="max-h-[70vh] overflow-y-auto">
        <table className="w-full min-w-[1180px] border-separate border-spacing-0 text-[12.5px] tabular-nums">
          <thead><tr>{COLS.map(head)}<th className="sticky top-0 bg-bg-elev px-2 py-1.5 text-left text-[11px] font-medium uppercase tracking-wide text-fg-muted">Probes</th></tr></thead>
          <tbody>{rows.map((m) => { const b = m.benchmark ?? {}; return (
            <tr key={m.id} className={cn("border-t border-line hover:bg-bg-sunk/60", !m.available && "opacity-50")}>
              <td className="border-t border-line px-2 py-1"><span className="inline-flex items-center gap-1.5"><span className={cn("size-2 rounded-full", providerTone(m.provider))} />{m.provider}</span></td>
              <td className="sticky left-0 z-[1] whitespace-nowrap border-t border-line bg-bg-elev px-2 py-1 font-medium"><div className="flex items-center gap-1.5"><span className="font-mono text-[12px]">{m.id}</span>{!m.available && <Badge tone="warning">gone</Badge>}{m.category === "embedding" && <Badge>embed</Badge>}</div>{m.displayName && m.displayName !== m.id && <div className="text-[11px] font-normal text-fg-muted">{m.displayName}</div>}</td>
              <td className="border-t border-line px-2 py-1"><Switch checked={m.enabled} onCheckedChange={(v) => onToggle(m.id, v)} aria-label={`Enable ${m.id}`} /></td>
              <td className="border-t border-line px-2 py-1 text-right">{kTok(m.contextWindow)}</td><td className="border-t border-line px-2 py-1 text-right">{kTok(m.maxOutput)}</td>
              <td className="border-t border-line px-2 py-1 text-right">{perM(m.inputPrice)}</td><td className="border-t border-line px-2 py-1 text-right">{perM(m.outputPrice)}</td>
              <td className={cn("border-t border-line px-2 py-1 text-right", b.pass_rate != null && b.pass_rate < 1 && "text-warning-text")}>{pct(b.pass_rate)}</td>
              <td className="border-t border-line px-2 py-1 text-right">{score(b.mean_score)}</td><td className="border-t border-line px-2 py-1 text-right">{score(b.judged_mean, 2)}</td>
              <td className="border-t border-line px-2 py-1 text-right">{ms(b.ttft_median_ms)}</td><td className="border-t border-line px-2 py-1 text-right">{ms(b.total_median_ms)}</td><td className="border-t border-line px-2 py-1 text-right">{b.tps_median == null ? "–" : Math.round(b.tps_median)}</td><td className="border-t border-line px-2 py-1 text-right">{usd(b.cost_mean)}</td>
              <td className="border-t border-line px-2 py-1"><div className="flex gap-0.5">{PROBES.map((p) => { const s = m.probes?.[p.key]?.status; return <Tip key={p.key} label={`${p.label}: ${s ?? "not probed"}${m.probes?.[p.key]?.ms ? ` (${m.probes[p.key].ms} ms)` : ""}${m.probes?.[p.key]?.detail ? ` — ${m.probes[p.key].detail}` : ""}`}><span className={cn("grid size-5 place-items-center rounded text-[10px] font-semibold", s === "ok" ? "bg-success/15 text-success-text" : s === "unsupported" ? "bg-bg-sunk text-fg-faint line-through" : s ? "bg-danger/10 text-danger-text" : "bg-bg-sunk text-fg-faint/60")}>{p.short}</span></Tip>; })}</div></td>
            </tr>); })}
            {!rows.length && <tr><td colSpan={COLS.length + 1} className="px-3 py-8 text-center text-fg-muted">No model matches these filters.</td></tr>}
          </tbody>
        </table>
      </div></div>
    </div>
  );
}
