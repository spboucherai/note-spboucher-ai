/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/components/settings/AISection.tsx
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
import Link from "next/link";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BarChart3, Save, RotateCcw, ExternalLink } from "lucide-react";
import { api } from "@/lib/client/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Spinner, Switch, Badge } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";
import type { SettingsProfile } from "./SettingsView";

type Route = { primary: string; fallback: string; effort: "low" | "medium" | "high"; categories: string[]; avoid?: string[] };
interface ModelsResp { models: { id: string; provider: string; available: boolean; enabled: boolean; benchmark?: { pass_rate?: number } | null }[]; routes: Record<string, Route>; defaultRoutes: Record<string, Route>; taskLabels: Record<string, string> }
const TASK_MODES = [["auto", "Auto (classified per message)"], ["chat", "Chat"], ["write", "Write"], ["reason", "Reason"], ["deep", "Deep"], ["code", "Code"]] as const;

export function AISection({ profile, refresh }: { profile: SettingsProfile; refresh: () => void }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["ai-models"], queryFn: () => api<ModelsResp>("/api/ai/models"), staleTime: 60_000 });
  const [routes, setRoutes] = useState<Record<string, Route> | null>(null); const [saving, setSaving] = useState(false);
  useEffect(() => { if (data && !routes) setRoutes(data.routes); }, [data, routes]);
  const [budget, setBudget] = useState(String(profile.aiBudgetUsd)); useEffect(() => setBudget(String(profile.aiBudgetUsd)), [profile.aiBudgetUsd]);
  const prefs = profile.preferences as { aiDefaultTask?: string; aiAlwaysCite?: boolean };
  async function savePref(p: Record<string, unknown>) { try { await api("/api/settings", { method: "PATCH", json: { preferences: p } }); refresh(); } catch (e: any) { toast("Could not save", { description: e.message, tone: "danger" }); } }
  async function saveBudget() { const usd = Number(budget); if (!Number.isFinite(usd) || usd < 0) return; try { await api("/api/ai/models", { method: "POST", json: { action: "budget", usd } }); toast("Daily budget saved", { tone: "success" }); refresh(); qc.invalidateQueries({ queryKey: ["dashboard"] }); } catch (e: any) { toast("Could not save budget", { description: e.message, tone: "danger" }); } }
  async function saveRoutes(next: Record<string, Route> | Record<string, never>) { setSaving(true); try { await api("/api/ai/models", { method: "POST", json: { action: "routes", routes: next } }); toast(Object.keys(next).length ? "Routes saved" : "Routes reset to measured defaults", { tone: "success" }); qc.invalidateQueries({ queryKey: ["ai-models"] }); setRoutes(null); } catch (e: any) { toast("Could not save routes", { description: e.message, tone: "danger" }); } finally { setSaving(false); } }
  const dirty = !!data && !!routes && JSON.stringify(routes) !== JSON.stringify(data.routes);
  // routes can only point at benchmarked models (new-provider models are selectable by hand in the assistant, never routed automatically)
  const models = (data?.models ?? []).filter((m) => m.available && m.enabled && (m as { autoRoutable?: boolean }).autoRoutable !== false);
  const Sel = ({ value, onChange, allowEmpty }: { value: string; onChange: (v: string) => void; allowEmpty?: boolean }) => <select value={value} onChange={(e) => onChange(e.target.value)} className="h-8 max-w-[180px] rounded-md border border-line bg-bg-elev px-1.5 text-[12px] outline-none focus:border-accent/50">{allowEmpty && <option value="">—</option>}{!models.some((m) => m.id === value) && value && <option value={value}>{value} (unavailable)</option>}{models.map((m) => <option key={m.id} value={m.id}>{m.id}</option>)}</select>;
  return (
    <div className="space-y-8">
      <section className="grid max-w-2xl gap-4">
        <h2 className="text-[15px] font-semibold">Assistant defaults</h2>
        <div className="grid gap-1"><Label htmlFor="ai-task">Default task mode</Label><select id="ai-task" value={prefs.aiDefaultTask ?? "auto"} onChange={(e) => savePref({ aiDefaultTask: e.target.value })} className="h-9 max-w-xs rounded-md border border-line bg-bg-elev px-2 text-[13px] outline-none focus:border-accent/50">{TASK_MODES.map(([id, l]) => <option key={id} value={id}>{l}</option>)}</select><p className="text-[12px] text-fg-faint">Task class pre-selected in new AI conversations.</p></div>
        <label className="flex items-center justify-between gap-3 rounded-lg border border-line bg-bg-elev px-3 py-2.5"><span><span className="block text-[13px] font-medium">Always cite sources</span><span className="block text-[12px] text-fg-muted">Keep workspace retrieval on and ask the assistant to cite notes inline.</span></span><Switch checked={prefs.aiAlwaysCite !== false} onCheckedChange={(v) => savePref({ aiAlwaysCite: v })} /></label>
        <div className="grid gap-1"><Label htmlFor="ai-budget">Daily budget (USD)</Label><div className="flex items-center gap-2"><Input id="ai-budget" type="number" min={0} step={1} value={budget} onChange={(e) => setBudget(e.target.value)} className="w-32" onKeyDown={(e) => { if (e.key === "Enter") saveBudget(); }} /><Button size="sm" variant="secondary" onClick={saveBudget} disabled={Number(budget) === profile.aiBudgetUsd}><Save /> Save</Button></div><p className="text-[12px] text-fg-faint">Above this spend, Deep and Reason requests are downgraded to cheaper classes for the rest of the day.</p></div>
      </section>
      <section>
        <div className="mb-3 flex flex-wrap items-start gap-3"><div className="min-w-0 flex-1"><h2 className="text-[15px] font-semibold">Model routes per task class</h2><p className="text-[13px] text-fg-muted">Override the measured defaults. Primary is tried first, then the fallback, then the best measured eligible model.</p></div><Link href="/ai/models" className="flex items-center gap-1 text-[13px] text-accent hover:underline"><BarChart3 className="size-4" /> Models &amp; benchmarks <ExternalLink className="size-3" /></Link></div>
        {isLoading || !routes ? <div className="flex justify-center py-8"><Spinner /></div> : (
          <div className="overflow-x-auto rounded-xl border border-line bg-bg-elev">
            <table className="w-full min-w-[640px] text-[13px]"><thead><tr className="border-b border-line bg-bg-sunk/60 text-left text-[10px] font-semibold uppercase tracking-wider text-fg-faint"><th className="px-3 py-1.5">Task</th><th className="px-3 py-1.5">Primary</th><th className="px-3 py-1.5">Fallback</th><th className="px-3 py-1.5">Effort</th><th className="px-3 py-1.5" /></tr></thead>
              <tbody>{Object.entries(routes).map(([task, r]) => { const d = data!.defaultRoutes[task]; const changed = d && (d.primary !== r.primary || d.fallback !== r.fallback || d.effort !== r.effort); return (
                <tr key={task} className="border-b border-line last:border-b-0"><td className="px-3 py-1.5"><div className="font-medium">{data!.taskLabels[task] ?? task}</div><div className="font-mono text-[10px] text-fg-faint">{task}</div></td>
                  <td className="px-3 py-1.5"><Sel value={r.primary} onChange={(v) => setRoutes({ ...routes, [task]: { ...r, primary: v } })} /></td>
                  <td className="px-3 py-1.5"><Sel value={r.fallback} onChange={(v) => setRoutes({ ...routes, [task]: { ...r, fallback: v } })} /></td>
                  <td className="px-3 py-1.5"><select value={r.effort} onChange={(e) => setRoutes({ ...routes, [task]: { ...r, effort: e.target.value as Route["effort"] } })} className="h-8 rounded-md border border-line bg-bg-elev px-1.5 text-[12px] outline-none">{["low", "medium", "high"].map((x) => <option key={x} value={x}>{x}</option>)}</select></td>
                  <td className="px-3 py-1.5">{changed ? <button className="text-[11px] text-fg-muted hover:text-accent" onClick={() => setRoutes({ ...routes, [task]: d })}>default</button> : <Badge>default</Badge>}</td></tr>); })}</tbody></table>
          </div>
        )}
        <div className="mt-3 flex flex-wrap gap-2"><Button size="sm" onClick={() => routes && saveRoutes(routes)} disabled={!dirty || saving}>{saving ? <Spinner className="size-3.5 border-white/40 border-t-white" /> : <Save />} Save routes</Button><Button size="sm" variant="ghost" onClick={() => saveRoutes({})} disabled={saving}><RotateCcw /> Reset to measured defaults</Button><span className={cn("self-center text-[12px] text-fg-faint", !dirty && "hidden")}>Unsaved changes</span></div>
      </section>
    </div>
  );
}
