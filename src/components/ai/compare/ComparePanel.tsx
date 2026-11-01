"use client";
import { useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { ChevronDown, Play, Square, Columns3, Diff } from "lucide-react";
import { api, sse } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { Spinner } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import type { ModelsPayload } from "@/components/ai/models/format";
import { ModelPicker, MIN_MODELS, MAX_MODELS } from "./ModelPicker";
import { ResultColumn, type CompareResult } from "./ResultColumn";
import { History, type HistoryItem } from "./History";

export function ComparePanel() {
  const qc = useQueryClient(); const router = useRouter();
  const [prompt, setPrompt] = useState(""); const [system, setSystem] = useState(""); const [showSystem, setShowSystem] = useState(false);
  const [selected, setSelected] = useState<string[]>(["claude-haiku-5-5", "gpt-5.4-mini"]); const [results, setResults] = useState<CompareResult[]>([]); const [running, setRunning] = useState(false); const [savedId, setSavedId] = useState<string | null>(null); const [diff, setDiff] = useState(false); const [historyOpen, setHistoryOpen] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const { data: catalogue } = useQuery<ModelsPayload>({ queryKey: ["ai-models", "all"], queryFn: () => api("/api/ai/models?all=1"), staleTime: 60_000 });
  const { data: history = [] } = useQuery<HistoryItem[]>({ queryKey: ["compare-history"], queryFn: () => api("/api/ai/compare"), staleTime: 10_000 });
  const { data: voteData } = useQuery<{ votes: Record<string, { model: string; at: string }>; tally: Record<string, number> }>({ queryKey: ["compare-votes"], queryFn: () => api("/api/ai/compare/vote"), staleTime: 10_000 });
  const byId = useMemo(() => new Map((catalogue?.models ?? []).map((m) => [m.id, m])), [catalogue]);
  const best = savedId ? voteData?.votes?.[savedId]?.model ?? null : null;
  const canRun = prompt.trim().length > 0 && selected.length >= MIN_MODELS && selected.length <= MAX_MODELS && !running;

  async function run() {
    if (!canRun) return; setRunning(true); setSavedId(null); setDiff(false);
    setResults(selected.map((model) => ({ model, provider: byId.get(model)?.provider, pending: true })));
    const ac = new AbortController(); abort.current = ac;
    await sse("/api/ai/compare", { prompt: prompt.trim(), models: selected, ...(system.trim() ? { system: system.trim() } : {}) }, (ev) => {
      if (ev.type === "result") setResults((rs) => rs.map((r) => (r.model === ev.model ? { ...ev, pending: false } : r)));
      else if (ev.type === "saved") { setSavedId(ev.id); qc.invalidateQueries({ queryKey: ["compare-history"] }); }
      else if (ev.type === "error") toast("Comparison error", { description: ev.message, tone: "danger" });
    }, ac.signal).catch(() => {});
    setResults((rs) => rs.map((r) => (r.pending ? { ...r, pending: false, error: ac.signal.aborted ? "Stopped" : "No result received" } : r)));
    setRunning(false); qc.invalidateQueries({ queryKey: ["ai-usage"] });
  }
  async function open(id: string) {
    try { const c = await api(`/api/ai/compare?id=${id}`); if (!c) return; setPrompt(c.prompt); setSelected(c.models); setResults((c.results as any[]).map((r) => ({ ...r, pending: false }))); setSavedId(c.id); setHistoryOpen(false); setDiff(false); window.scrollTo({ top: 0 }); } catch (e: any) { toast("Could not open comparison", { description: e.message, tone: "danger" }); }
  }
  async function vote(model: string) {
    if (!savedId) return; const next = best === model ? null : model;
    try { await api("/api/ai/compare/vote", { method: "POST", json: { comparisonId: savedId, model: next } }); qc.invalidateQueries({ queryKey: ["compare-votes"] }); toast(next ? `${model} marked as best` : "Vote removed", { tone: "success" }); } catch (e: any) { toast("Vote failed", { description: e.message, tone: "danger" }); }
  }
  async function saveNote(r: CompareResult) {
    try { const { markdownToDoc } = await import("@/lib/editor/markdown-client"); const title = `${prompt.trim().split("\n")[0].slice(0, 60) || "Comparison"} — ${r.model}`; const body = `> [!AI] ${r.model}\n> Prompt: ${prompt.trim().slice(0, 300).replace(/\n/g, " ")}\n\n${r.text ?? ""}`; const p = await api("/api/pages", { method: "POST", json: { title, content: { type: "doc", content: markdownToDoc(body) }, properties: { ai_model: r.model, ai_cost_usd: r.costUsd ?? null, ai_comparison: savedId } } }); qc.invalidateQueries({ queryKey: ["tree"] }); toast("Saved as a note", { tone: "success" }); router.push(`/p/${p.id}`); } catch (e: any) { toast("Could not save", { description: e.message, tone: "danger" }); }
  }
  const tally = voteData?.tally ?? {};
  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      <div className="mb-4 flex flex-wrap items-end gap-2"><div><h1 className="text-2xl font-semibold tracking-tight">Compare models</h1><p className="mt-0.5 text-[13px] text-fg-muted">Same prompt, {MIN_MODELS}–{MAX_MODELS} models side by side. Every run is recorded in usage and saved to history.</p></div><Button variant="outline" size="sm" className="ml-auto lg:hidden" onClick={() => setHistoryOpen((v) => !v)}>History ({history.length})</Button></div>
      <div className="grid gap-4 lg:grid-cols-[1fr_260px]">
        <div className="min-w-0 space-y-4">
          {historyOpen && <div className="lg:hidden"><History items={history} current={savedId} votes={voteData?.votes ?? {}} onOpen={open} /></div>}
          <div className="rounded-xl border border-line bg-bg-elev p-3 shadow-card">
            <Textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Prompt sent to every selected model… (⌘⏎ to run)" rows={4} className="min-h-[96px] resize-y border-0 bg-transparent px-1 shadow-none focus-visible:ring-0" onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); run(); } }} />
            <button type="button" onClick={() => setShowSystem((v) => !v)} className="mt-1 inline-flex items-center gap-1 text-[12px] text-fg-muted hover:text-fg"><ChevronDown className={cn("size-3.5 transition-transform", showSystem && "rotate-180")} />System prompt {system.trim() ? "(custom)" : "(default assistant prompt)"}</button>
            {showSystem && <Textarea value={system} onChange={(e) => setSystem(e.target.value)} placeholder="Optional system prompt. Leave empty to use the workspace assistant prompt." rows={3} className="mt-1 text-[13px]" />}
          </div>
          <ModelPicker models={catalogue?.models ?? []} selected={selected} onChange={setSelected} disabled={running} />
          <div className="flex flex-wrap items-center gap-2">
            {running ? <Button variant="secondary" onClick={() => abort.current?.abort()}><Square />Stop</Button> : <Button variant="ai" onClick={run} disabled={!canRun}><Play />Run comparison</Button>}
            {results.length > 1 && <Button variant={diff ? "secondary" : "ghost"} size="sm" onClick={() => setDiff((v) => !v)} disabled={running}><Diff />{diff ? "Diff on" : "Diff"}</Button>}
            {running && <span className="inline-flex items-center gap-1.5 text-[12px] text-fg-muted"><Spinner className="size-3.5" />{results.filter((r) => !r.pending).length} / {results.length} done</span>}
            {savedId && !running && <span className="text-[12px] text-fg-muted">Saved · {best ? `best: ${best}` : "mark the best answer"}</span>}
          </div>
          {results.length > 0 && <div className={cn("-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 md:mx-0 md:grid md:overflow-visible md:px-0", results.length <= 2 ? "md:grid-cols-2" : results.length === 3 ? "md:grid-cols-3" : "md:grid-cols-2 xl:grid-cols-3")}>{results.map((r) => <ResultColumn key={r.model} r={r} meta={byId.get(r.model)} others={results.filter((o) => o.model !== r.model && o.text).map((o) => o.text!)} diff={diff} best={best === r.model} canVote={Boolean(savedId)} onCopy={() => { navigator.clipboard.writeText(r.text ?? ""); toast("Copied"); }} onSave={() => saveNote(r)} onBest={() => vote(r.model)} />)}</div>}
          {!results.length && <div className="rounded-xl border border-dashed border-line-strong p-8 text-center text-[13px] text-fg-muted"><Columns3 className="mx-auto mb-2 size-6 text-fg-faint" />Results appear here as each model finishes. Diff highlights sentences that exist in only one answer.</div>}
          {diff && <p className="text-[11.5px] text-fg-muted">Diff: highlighted sentences share fewer than 40 % of their content words with any sentence of the other answers (word-set comparison, Markdown shown as plain text).</p>}
        </div>
        <div className="hidden lg:block"><History items={history} current={savedId} votes={voteData?.votes ?? {}} onOpen={open} />
          {Object.keys(tally).length > 0 && <div className="mt-3 rounded-xl border border-line bg-bg-elev p-3 shadow-card"><div className="text-[12.5px] font-semibold">Best-answer tally</div><ul className="mt-1 space-y-0.5 text-[12px] tabular-nums">{Object.entries(tally).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([m, n]) => <li key={m} className="flex justify-between"><span className="font-mono">{m}</span><span className="text-fg-muted">{n}</span></li>)}</ul></div>}
        </div>
      </div>
    </div>
  );
}
