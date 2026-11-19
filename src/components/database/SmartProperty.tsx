"use client";
/**
 * File: src/components/database/SmartProperty.tsx
 * Description: Databases Next Generation — smart (AI) properties: the configuration form (task, prompt, choices, model, auto-run,
 *   AI-managed) on `/api/databases/<id>/ai/config`, the column actions (fill the empty cells, recompute every cell of the view) on
 *   `POST /api/databases/<id>/ai`, and the runs log drawer (status, model, tokens, cost, error, retry) on `/ai/runs`.
 *   Nothing here computes a cell without an explicit action of the owner, except the auto-run the owner switches on per property.
 * Author: Simon-Pierre Boucher · contact@spboucher.ai
 */
import { useState } from "react";
import * as DialogP from "@radix-ui/react-dialog";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { X, Sparkles, RefreshCw, ListChecks, AlertCircle, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch, Spinner, Badge } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";
import { ModelPicker } from "@/components/ai/ModelPicker";
import { api } from "@/lib/client/api";
import { cn } from "@/lib/utils";
import type { Property, QueryResult } from "@/lib/databases/types";
import { useDb } from "./hooks";
import { Field, Sel, inputCls } from "./meta";

export const AI_TASKS = ["custom", "summarize", "classify", "extract", "detect-date", "categorize"] as const;
export type AiTask = (typeof AI_TASKS)[number];
export interface AiConfig { task: AiTask; prompt: string; choices: string[]; model: string | null; autoRun: boolean; managed: boolean }
const TASK_META: Record<AiTask, { label: string; hint: string; prompt: string }> = {
  custom: { label: "Custom prompt", hint: "Free instruction. Use {{Property}} to insert a value of the row.", prompt: "Summarize this paper in 3 sentences…" },
  summarize: { label: "Summarize", hint: "A short summary of the row and its page. The prompt is optional guidance.", prompt: "Optional: focus on the method…" },
  classify: { label: "Classify (one choice)", hint: "Exactly one of the choices below; anything else is stored as empty.", prompt: "Optional: how to decide…" },
  extract: { label: "Extract", hint: "Copies faithfully what the prompt describes (a name, an amount, an identifier…).", prompt: "The DOI of the paper" },
  "detect-date": { label: "Detect a date", hint: "An ISO date (YYYY-MM-DD) found in the row; an impossible date is stored as empty.", prompt: "Optional: which date (deadline, publication…)" },
  categorize: { label: "Categorize (several)", hint: "Zero or more of the choices below — or up to 3 free categories when no choice is given.", prompt: "Optional: what the categories describe…" },
};
/** Effective AI configuration of a property config (defaults + the 2.x `config.prompt`). Mirrors the server's `aiConfigOf`. */
export function aiConfigOf(config: Record<string, unknown> | undefined): AiConfig {
  const a = (config?.ai && typeof config.ai === "object" ? config.ai : {}) as Partial<AiConfig>;
  return { task: (AI_TASKS as readonly string[]).includes(a.task as string) ? (a.task as AiTask) : "custom", prompt: String(a.prompt ?? config?.prompt ?? ""), choices: Array.isArray(a.choices) ? a.choices.filter((c): c is string => typeof c === "string") : [], model: typeof a.model === "string" && a.model ? a.model : null, autoRun: a.autoRun === true, managed: a.managed === true };
}
export function aiProblem(c: AiConfig): string | null {
  if ((c.task === "custom" || c.task === "extract") && !c.prompt.trim()) return c.task === "custom" ? "No prompt configured" : "Say what to extract (prompt)";
  if (c.task === "classify" && c.choices.length < 2) return "Classification needs at least two choices";
  return null;
}

/** The AI section of the property editor. Controlled: `value` lives in the editor's draft config and is saved with the property. */
export function AiConfigEditor({ value, onChange }: { value: AiConfig; onChange: (c: AiConfig) => void }) {
  const [draft, setDraft] = useState(""); const meta = TASK_META[value.task]; const set = (p: Partial<AiConfig>) => onChange({ ...value, ...p }); const problem = aiProblem(value);
  const usesChoices = value.task === "classify" || value.task === "categorize";
  const add = () => { const n = draft.trim(); if (!n || value.choices.some((c) => c.toLowerCase() === n.toLowerCase()) || value.choices.length >= 40) return; set({ choices: [...value.choices, n.slice(0, 80)] }); setDraft(""); };
  return (
    <div className="space-y-2.5" data-testid="ai-config">
      <div className="flex items-center gap-1.5 rounded-md bg-ai-soft px-2 py-1.5 text-[12px] text-ai"><Sparkles className="size-3.5 shrink-0" /> Values of this column are written by AI and marked as such.</div>
      <Field label="Task" hint={meta.hint}><Sel aria-label="AI task" value={value.task} onChange={(e) => set({ task: e.target.value as AiTask })} className="w-full">{AI_TASKS.map((t) => <option key={t} value={t}>{TASK_META[t].label}</option>)}</Sel></Field>
      <Field label={value.task === "custom" || value.task === "extract" ? "Prompt" : "Prompt (optional)"} hint="Use {{Property}} to insert a value; the other properties and the page text are given as context.">
        <textarea aria-label="AI prompt" value={value.prompt} onChange={(e) => set({ prompt: e.target.value.slice(0, 4000) })} rows={3} placeholder={meta.prompt} className={cn(inputCls, "h-auto py-1.5 max-md:h-auto")} />
      </Field>
      {usesChoices && (
        <div className="space-y-1">
          <div className="text-[12px] font-medium text-fg-muted">Choices</div>
          {value.choices.length > 0 && <ul className="flex flex-wrap gap-1" aria-label="Choices">{value.choices.map((c) => <li key={c} className="flex items-center gap-1 rounded-md bg-bg-sunk py-0.5 pl-2 pr-1 text-[12px] max-md:text-[14px]">{c}<button type="button" aria-label={`Remove choice ${c}`} onClick={() => set({ choices: value.choices.filter((x) => x !== c) })} className="grid size-5 place-items-center rounded text-fg-muted hover:text-danger-text max-md:size-9"><X className="size-3" /></button></li>)}</ul>}
          <div className="flex items-center gap-1"><input aria-label="New choice" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="New choice" className={cn(inputCls, "h-7")} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); add(); } }} /><Button size="iconXs" variant="outline" aria-label="Add choice" onClick={add}><Plus /></Button></div>
        </div>
      )}
      <div className="space-y-1"><div className="text-[12px] font-medium text-fg-muted">Model</div><ModelPicker aria-label="Model of this AI property" value={value.model} onChange={(id) => set({ model: id })} className="w-full" compact /></div>
      <label className="flex items-start justify-between gap-3 text-[13px]"><span>Run automatically<span className="block text-[11px] leading-4 text-fg-muted">Recomputes the cell when another value of the row changes. Each run calls the model (see the runs log for the cost).</span></span><Switch aria-label="Run automatically" checked={value.autoRun} onCheckedChange={(v) => set({ autoRun: v })} /></label>
      <label className="flex items-start justify-between gap-3 text-[13px]"><span>AI-managed<span className="block text-[11px] leading-4 text-fg-muted">Off (default): a value typed by hand is never overwritten by the AI. On: the AI may replace it.</span></span><Switch aria-label="AI-managed" checked={value.managed} onCheckedChange={(v) => set({ managed: v })} /></label>
      {problem && <p role="status" data-testid="ai-problem" className="flex items-center gap-1 rounded-md bg-danger/10 px-2 py-1.5 text-[12px] text-danger-text"><AlertCircle className="size-3.5 shrink-0" /> {problem}</p>}
    </div>
  );
}

/** Column actions of an AI property (shown in its header panel): fill, recompute, runs log. */
export function AiColumnActions({ prop, onRuns }: { prop: Property; onRuns: () => void }) {
  const ctx = useDb(); const qc = useQueryClient(); const [busy, setBusy] = useState(false); const CAP = 1000;
  const fill = async (mode: "empty" | "all") => {
    setBusy(true);
    try {
      // the rows of this view (filter + search), 1 000 at most per click
      const head = await api<QueryResult>(`/api/databases/${ctx.db.id}/query`, { method: "POST", idempotencyKey: false, json: { viewId: ctx.view.id, search: ctx.search || undefined, limit: 1000, ...(mode === "empty" ? { extraFilter: { and: [{ property: prop.id, op: "empty" }] } } : {}) } });
      const ids = head.rows.map((r) => r.id); if (!ids.length) { toast(mode === "empty" ? "No empty cell in this view" : "No row in this view"); return; }
      const more = head.total > ids.length ? ` (the first ${CAP.toLocaleString("en-CA")} of ${head.total.toLocaleString("en-CA")})` : "";
      if (!confirm(`Run the AI on ${ids.length.toLocaleString("en-CA")} cell${ids.length === 1 ? "" : "s"} of “${prop.name}”${more}?\n\nEach cell is one call to the model; the cost of every run is in the runs log. Values typed by hand are not overwritten.`)) return;
      let queued = 0, skipped = 0;
      for (let i = 0; i < ids.length; i += 200) { const r = await api<{ queued: number; skipped: unknown[] }>(`/api/databases/${ctx.db.id}/ai`, { method: "POST", json: { rowIds: ids.slice(i, i + 200), propertyId: prop.id } }); queued += r.queued; skipped += r.skipped.length; }
      toast(`AI queued for ${queued.toLocaleString("en-CA")} cell${queued === 1 ? "" : "s"}`, { description: skipped ? `${skipped} skipped (typed by hand, already running or not configured) — details in the runs log.` : undefined, action: { label: "Runs log", run: onRuns } });
      qc.invalidateQueries({ queryKey: ["db-rows", ctx.db.id] }); qc.invalidateQueries({ queryKey: ["db-ai-runs", ctx.db.id] });
    } catch (e: any) { toast("Could not queue the AI runs", { description: e?.message, tone: "danger" }); } finally { setBusy(false); }
  };
  const btn = "flex h-8 items-center gap-1.5 rounded-md px-2 text-[12px] text-ai hover:bg-ai-soft disabled:opacity-50 max-md:h-11 max-md:text-[14px] [&_svg]:size-3.5";
  return (
    <div role="group" aria-label="AI column" className="mb-2 flex flex-wrap items-center gap-1 border-b border-line pb-2">
      <button type="button" disabled={busy} onClick={() => fill("empty")} className={btn}><Sparkles /> Fill empty cells</button>
      <button type="button" disabled={busy} onClick={() => fill("all")} className={btn}><RefreshCw /> Recompute all</button>
      <button type="button" onClick={onRuns} className={cn(btn, "ml-auto text-fg-muted hover:bg-bg-sunk")}><ListChecks /> Runs log</button>
      {busy && <Spinner className="size-3.5" />}
    </div>
  );
}

interface Run { id: string; propertyId: string; rowId: string; status: "queued" | "running" | "done" | "failed" | "skipped"; trigger: "manual" | "auto"; task: string; model: string | null; provider: string | null; inputTokens: number; outputTokens: number; costUsd: number | null; error: string | null; createdAt: string; startedAt: string | null; finishedAt: string | null }
const TONE: Record<Run["status"], "neutral" | "accent" | "ai" | "success" | "danger" | "warning"> = { queued: "neutral", running: "ai", done: "success", failed: "danger", skipped: "warning" };
const usd = (n: number | null | undefined) => (n == null ? "—" : n === 0 ? "$0" : n < 0.01 ? `$${n.toFixed(5)}` : `$${n.toFixed(3)}`);
/** Runs log of the AI columns of the database (one property when `propertyId` is given). Side drawer on desktop, full-height sheet on phones. */
export function AiRunsDrawer({ open, onClose, propertyId }: { open: boolean; onClose: () => void; propertyId: string | null }) {
  const ctx = useDb(); const [status, setStatus] = useState(""); const [prop, setProp] = useState<string | null>(propertyId); const pid = prop ?? propertyId;
  const aiProps = ctx.props.filter((p) => p.type === "ai");
  const runsQ = useQuery<Run[]>({ queryKey: ["db-ai-runs", ctx.db.id, pid, status], enabled: open, queryFn: () => api(`/api/databases/${ctx.db.id}/ai/runs?limit=200${pid ? `&propertyId=${pid}` : ""}${status ? `&status=${status}` : ""}`), refetchInterval: (q) => (q.state.data?.some((r) => r.status === "queued" || r.status === "running") ? 2500 : false) });
  const cfgQ = useQuery<{ properties: { propertyId: string; name: string; problem: string | null; runs: { queued: number; done: number; failed: number; skipped: number; costUsd: number; lastAt: string | null } }[] }>({ queryKey: ["db-ai-runs", ctx.db.id, "config", runsQ.dataUpdatedAt], enabled: open, queryFn: () => api(`/api/databases/${ctx.db.id}/ai/config`) });
  const runs = runsQ.data ?? []; const ids = [...new Set(runs.map((r) => r.rowId))].slice(0, 500);
  const titlesQ = useQuery<QueryResult>({ queryKey: ["db-rows", ctx.db.id, "run-titles", ids.join(",")], enabled: open && ids.length > 0, staleTime: 30_000, queryFn: () => api(`/api/databases/${ctx.db.id}/query`, { method: "POST", idempotencyKey: false, json: { rowIds: ids, filter: null, sorts: [], limit: 500 } }) });
  const title = (rowId: string) => titlesQ.data?.rows.find((r) => r.id === rowId)?.title || ctx.findRow(rowId)?.title || "Row";
  const sums = (cfgQ.data?.properties ?? []).filter((p) => !pid || p.propertyId === pid).reduce((a, p) => ({ done: a.done + p.runs.done, failed: a.failed + p.runs.failed, skipped: a.skipped + p.runs.skipped, queued: a.queued + p.runs.queued, cost: a.cost + (p.runs.costUsd ?? 0) }), { done: 0, failed: 0, skipped: 0, queued: 0, cost: 0 });
  return (
    <DialogP.Root open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogP.Portal>
        <DialogP.Overlay className="fixed inset-0 z-40 bg-black/30" />
        <DialogP.Content data-testid="ai-runs" className="fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-line bg-bg shadow-pop outline-none sm:w-[min(100vw,34rem)]" onOpenAutoFocus={(e) => e.preventDefault()}>
          <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-3">
            <DialogP.Close aria-label="Close" className="grid size-9 shrink-0 place-items-center rounded-md text-fg-muted hover:bg-bg-sunk max-md:size-11"><X className="size-4" /></DialogP.Close>
            <DialogP.Title className="flex min-w-0 items-center gap-1.5 text-[14px] font-semibold"><Sparkles className="size-4 shrink-0 text-ai" /><span className="truncate">AI runs</span></DialogP.Title>
            <DialogP.Description className="sr-only">Every computation of the AI columns of this database: status, model, cost and error.</DialogP.Description>
            <button type="button" aria-label="Refresh" onClick={() => { void runsQ.refetch(); }} className="ml-auto grid size-9 shrink-0 place-items-center rounded-md text-fg-muted hover:bg-bg-sunk max-md:size-11"><RefreshCw className={cn("size-4", runsQ.isFetching && "animate-spin motion-reduce:animate-none")} /></button>
          </div>
          <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
            {aiProps.length > 1 && <Sel aria-label="AI property" value={pid ?? ""} onChange={(e) => setProp(e.target.value || null)} className="h-8 min-w-0 max-w-[12rem] text-[12px]"><option value="">All AI properties</option>{aiProps.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Sel>}
            <Sel aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className="h-8 text-[12px]"><option value="">Every status</option>{(["queued", "running", "done", "failed", "skipped"] as const).map((s) => <option key={s} value={s}>{s}</option>)}</Sel>
            <p className="ml-auto text-[12px] tabular-nums text-fg-muted" data-testid="ai-runs-summary">{sums.done} done · {sums.failed} failed · {sums.skipped} skipped · <span className="font-medium text-fg">{usd(sums.cost)}</span></p>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {runsQ.isLoading ? <div className="grid h-32 place-items-center" role="status" aria-label="Loading runs"><Spinner /></div>
              : runsQ.isError ? <div role="alert" className="m-3 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-[13px]">The runs log could not be loaded. <button type="button" onClick={() => { void runsQ.refetch(); }} className="font-medium underline">Retry</button></div>
              : !runs.length ? <p className="px-4 py-10 text-center text-[13px] text-fg-muted">No run yet{status ? ` with the status “${status}”` : ""}. A run is logged each time a cell is generated.</p>
              : <ul className="divide-y divide-line">{runs.map((r) => (
                <li key={r.id} data-run={r.status} className="px-3 py-2 text-[12px] max-md:text-[13px]">
                  <div className="flex min-w-0 items-center gap-2">
                    <Badge tone={TONE[r.status]}>{r.status}</Badge>
                    <button type="button" onClick={() => { onClose(); ctx.open(r.rowId); }} className="min-w-0 truncate text-left font-medium hover:underline">{title(r.rowId)}</button>
                    <span className="ml-auto shrink-0 tabular-nums text-fg-muted">{new Date(r.createdAt).toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" })}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-fg-muted">
                    {aiProps.length > 1 && !pid && <span>{ctx.props.find((p) => p.id === r.propertyId)?.name ?? "property"}</span>}
                    <span>{r.task}</span><span>{r.trigger}</span>
                    <span className="font-mono text-[11px]">{r.model ?? "auto"}{r.provider ? ` · ${r.provider}` : ""}</span>
                    {(r.inputTokens > 0 || r.outputTokens > 0) && <span className="tabular-nums">{r.inputTokens} in / {r.outputTokens} out</span>}
                    <span className="tabular-nums" data-run-cost>{usd(r.costUsd)}</span>
                    {r.status === "failed" && <button type="button" onClick={() => { void ctx.regenerate(r.rowId, r.propertyId); }} className="flex h-6 items-center gap-1 rounded px-1.5 text-ai hover:bg-ai-soft max-md:h-9"><RefreshCw className="size-3" /> Retry</button>}
                  </div>
                  {r.error && <p className={cn("mt-1 [overflow-wrap:anywhere]", r.status === "failed" ? "text-danger-text" : "text-fg-muted")} data-run-error>{r.error}</p>}
                </li>))}</ul>}
          </div>
        </DialogP.Content>
      </DialogP.Portal>
    </DialogP.Root>
  );
}
