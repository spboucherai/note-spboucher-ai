/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/components/ai/models/RoutingTable.tsx
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
import { RotateCcw, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, Spinner } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { hasBench, ms, pct, usd, type ModelRow, type RouteDef } from "./format";

const EFFORTS = ["low", "medium", "high"] as const;
export function RoutingTable({ routes, defaults, labels, models, onSave, saving }: { routes: Record<string, RouteDef>; defaults: Record<string, RouteDef>; labels: Record<string, string>; models: ModelRow[]; onSave: (r: Record<string, RouteDef>) => Promise<void>; saving: boolean }) {
  const [draft, setDraft] = useState<Record<string, RouteDef>>(routes); const dirty = JSON.stringify(draft) !== JSON.stringify(routes);
  const options = useMemo(() => models.filter((m) => m.available && m.category !== "embedding" && m.probes?.text?.status === "ok").sort((a, b) => a.provider.localeCompare(b.provider) || ((b.benchmark?.mean_score ?? -1) - (a.benchmark?.mean_score ?? -1)) || a.id.localeCompare(b.id)), [models]);
  const byId = useMemo(() => new Map(models.map((m) => [m.id, m])), [models]);
  const set = (task: string, patch: Partial<RouteDef>) => setDraft((d) => ({ ...d, [task]: { ...d[task], ...patch } }));
  const Picker = ({ value, onChange, task }: { value: string; onChange: (v: string) => void; task: string }) => (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="h-8 w-full min-w-[180px] rounded-md border border-line bg-bg-elev px-2 font-mono text-[12px] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
      {!options.some((o) => o.id === value) && <option value={value}>{value} (unavailable)</option>}
      {["openai", "anthropic"].map((p) => <optgroup key={p} label={p}>{options.filter((o) => o.provider === p).map((o) => <option key={o.id} value={o.id} disabled={draft[task]?.avoid?.includes(o.id)}>{o.id}{hasBench(o) ? ` · ${pct(o.benchmark!.pass_rate)} · ${usd(o.benchmark!.cost_mean)}` : " · untested"}{draft[task]?.avoid?.includes(o.id) ? " · avoided" : ""}</option>)}</optgroup>)}
    </select>
  );
  const why = (id: string, cats: string[]) => { const m = byId.get(id); if (!m || !hasBench(m)) return <span className="text-fg-faint">untested</span>; const by = m.benchmark!.by_category ?? {}; const s = cats.map((c) => by[c]?.score).filter((x): x is number => typeof x === "number"); const mean = s.length ? s.reduce((a, b) => a + b, 0) / s.length : null; return <span className="tabular-nums">{mean != null ? `${pct(mean)} on ${cats.length} cat.` : pct(m.benchmark!.pass_rate)} · {ms(m.benchmark!.total_median_ms)} · {usd(m.benchmark!.cost_mean)}</span>; };
  return (
    <div>
      <div className="overflow-x-auto rounded-xl border border-line bg-bg-elev shadow-card">
        <table className="w-full min-w-[900px] text-[12.5px]">
          <thead><tr className="text-left text-[11px] uppercase tracking-wide text-fg-muted">{["Task class", "Primary", "Fallback", "Effort", "Measured basis (primary)", "Categories"].map((h) => <th key={h} className="px-2 py-1.5 font-medium">{h}</th>)}</tr></thead>
          <tbody>{Object.keys(defaults).map((task) => { const r = draft[task] ?? defaults[task]; const changed = JSON.stringify(r) !== JSON.stringify(defaults[task]); return (
            <tr key={task} className="border-t border-line align-top">
              <td className="px-2 py-1.5"><div className="font-medium">{labels[task] ?? task}</div><div className="font-mono text-[11px] text-fg-muted">{task}{changed && <Badge tone="accent" className="ml-1.5">custom</Badge>}</div></td>
              <td className="px-2 py-1.5"><Picker task={task} value={r.primary} onChange={(v) => set(task, { primary: v })} /></td>
              <td className="px-2 py-1.5"><Picker task={task} value={r.fallback} onChange={(v) => set(task, { fallback: v })} /></td>
              <td className="px-2 py-1.5"><div className="flex h-8 items-center rounded-md bg-bg-sunk p-0.5">{EFFORTS.map((e) => <button key={e} onClick={() => set(task, { effort: e })} className={cn("h-7 rounded px-2 text-[11.5px]", r.effort === e ? "bg-bg-elev font-medium shadow-card" : "text-fg-muted")}>{e}</button>)}</div></td>
              <td className="px-2 py-1.5 text-fg-muted">{why(r.primary, r.categories ?? [])}</td>
              <td className="px-2 py-1.5"><div className="flex flex-wrap gap-1">{(r.categories ?? []).map((c) => <span key={c} className="rounded bg-bg-sunk px-1 py-0.5 font-mono text-[10.5px] text-fg-muted">{c}</span>)}{r.avoid?.length ? <span className="rounded bg-danger/10 px-1 py-0.5 text-[10.5px] text-danger-text" title={r.avoid.join(", ")}>avoid {r.avoid.length}</span> : null}</div></td>
            </tr>); })}</tbody>
        </table>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px] text-fg-muted">
        <span>Auto routing picks the primary when it is available and <code className="font-mono text-[11px]">probes.text = ok</code>, else the fallback, else the best measured model for the class. Saved to setting <code className="font-mono text-[11px]">ai.routes</code>.</span>
        <div className="ml-auto flex gap-2"><Button variant="ghost" size="sm" onClick={() => setDraft(defaults)} disabled={JSON.stringify(draft) === JSON.stringify(defaults)}><RotateCcw />Reset to measured defaults</Button><Button size="sm" onClick={() => onSave(draft)} disabled={!dirty || saving}>{saving ? <Spinner className="size-3.5 border-t-accent-fg" /> : <Save />}Save routes</Button></div>
      </div>
    </div>
  );
}
