"use client";
/**
 * file: src/components/knowledge/InsightsPanel.tsx
 * description: Insights side panel of the Knowledge Graph 2.0. Two parts, kept visibly apart:
 *   (1) what the deterministic service computes from the data at each call — central pages and concepts, orphans, clusters, recurring
 *       topics, duplicates (no model, same data ⇒ same answer);
 *   (2) findings awaiting a decision — the AI ones (contradictions, open questions) appear only after the user pressed
 *       "Run AI analysis" (POST /api/graph/insights/run, one queued job), are marked AI with their model, link to the cited blocks,
 *       and do nothing until accepted or dismissed.
 * author: Simon-Pierre Boucher — contact@spboucher.ai
 */
import * as React from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, X, Sparkles, ChevronDown, RefreshCw, Quote } from "lucide-react";
import { api } from "@/lib/client/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge, Skeleton, Spinner } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";
import type { Intelligence } from "@/lib/graph/intelligence";
import { AIBadge, LoadError, fmtDateTime, useTree } from "./shared";

export interface Insight { id: string; kind: "contradiction" | "open_question" | "cluster" | "recurring_topic" | "duplicate"; status: string; title: string; detail: string; data: { pageIds?: string[]; blockIds?: string[]; a?: { pageId: string; blockId: string | null }; b?: { pageId: string; blockId: string | null }; source?: { pageId: string; blockId: string | null }; confidence?: number; [k: string]: unknown }; origin: "system" | "ai"; model: string | null; createdAt: string; decidedAt: string | null }
interface Answer { intelligence: Intelligence | null; insights: Insight[]; counts: { suggested: number; accepted: number; dismissed: number } }
const KIND: Record<Insight["kind"], string> = { contradiction: "Contradiction", open_question: "Open question", cluster: "Cluster", recurring_topic: "Recurring topic", duplicate: "Duplicate" };

function Group({ title, count, children, open: initial = false, testId }: { title: string; count: number; children: React.ReactNode; open?: boolean; testId?: string }) {
  const [open, setOpen] = React.useState(initial);
  return <section className="border-b border-line" data-testid={testId}><button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex min-h-11 w-full items-center gap-2 px-3 text-left text-ui font-semibold hover:bg-bg-hover sm:min-h-9"><ChevronDown className={cn("size-4 shrink-0 text-fg-muted transition-transform duration-fast", !open && "-rotate-90")} /><span className="min-w-0 flex-1 truncate">{title}</span><span className="shrink-0 rounded-pill bg-bg-sunk px-1.5 text-micro tabular-nums text-fg-muted">{count}</span></button>{open && <div className="px-2 pb-2">{children}</div>}</section>;
}
const row = "flex min-h-11 w-full items-center gap-2 rounded-control px-2 text-left text-ui hover:bg-bg-hover sm:min-h-8";

export function InsightsPanel({ onFocus, onPages }: { /** centre the graph on a page */ onFocus?: (pageId: string) => void; /** highlight a set of pages in the graph */ onPages?: (pageIds: string[], label: string) => void }) {
  const qc = useQueryClient(); const { data: tree = [] } = useTree(); const titleOf = React.useCallback((id: string) => { const n = tree.find((t) => t.id === id); return n ? `${n.icon ? `${n.icon} ` : ""}${n.title || "Untitled"}` : "Page"; }, [tree]);
  const [queuedAt, setQueuedAt] = React.useState<number | null>(null); const [status, setStatus] = React.useState<"suggested" | "accepted" | "dismissed">("suggested");
  const q = useQuery({ queryKey: ["kg-insights", status], queryFn: () => api<Answer>(`/api/graph/insights?status=${status}&limit=50`), staleTime: 5_000, refetchInterval: queuedAt ? 4_000 : false });
  // a queued analysis is watched for two minutes at most; the panel never pretends a result arrived
  React.useEffect(() => { if (!queuedAt) return; const t = setTimeout(() => setQueuedAt(null), 120_000); return () => clearTimeout(t); }, [queuedAt]);
  const aiCount = q.data?.insights.filter((i) => i.origin === "ai").length ?? 0; const seen = React.useRef<number | null>(null);
  React.useEffect(() => { if (queuedAt && seen.current != null && aiCount > seen.current) { setQueuedAt(null); toast("AI analysis finished", { description: `${aiCount - seen.current} new finding${aiCount - seen.current === 1 ? "" : "s"} to review.`, tone: "ai" }); } if (!queuedAt) seen.current = aiCount; }, [aiCount, queuedAt]);
  const run = useMutation({
    mutationFn: () => api<{ queued: boolean; reason?: string; deterministic: { created: number; considered: number } | null }>("/api/graph/insights/run", { method: "POST", json: { mode: "all" } }),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ["kg-insights"] }); if (r.queued) { setQueuedAt(Date.now()); toast("AI analysis queued", { description: "One model call over your most recently edited pages. Findings will appear here as suggestions.", tone: "ai" }); } else toast("Analysis not queued", { description: r.reason === "already_queued_or_queue_unavailable" ? "An analysis ran in the last 5 minutes (or the job queue is unreachable). Try again later." : r.reason }); },
    onError: (e: any) => toast("Could not start the analysis", { description: e?.message, tone: "danger" }),
  });
  const decide = useMutation({
    mutationFn: ({ id, status: s }: { id: string; status: "accepted" | "dismissed" | "suggested" }) => api<Insight & { relationId?: string | null }>(`/api/graph/insights/${id}`, { method: "PATCH", json: { status: s } }),
    onSuccess: (r, v) => { for (const k of ["kg-insights", "kgraph"]) qc.invalidateQueries({ queryKey: [k] }); if (v.status === "suggested") return; toast(v.status === "accepted" ? (r.relationId ? "Accepted — the relation “contradicts” was recorded" : "Accepted") : "Dismissed", { tone: v.status === "accepted" ? "success" : "neutral", action: { label: "Undo", run: () => decide.mutate({ id: v.id, status: "suggested" }) } }); },
    onError: (e: any) => toast("Could not save the decision", { description: e?.message, tone: "danger" }),
  });
  const x = q.data?.intelligence; const insights = q.data?.insights ?? [];
  const Cite = ({ c, label }: { c: { pageId: string; blockId: string | null }; label?: string }) => <Link href={`/p/${c.pageId}${c.blockId ? `#block-${c.blockId}` : ""}`} className="cite-chip min-h-11 md:min-h-0" data-testid="insight-cite"><b><Quote className="size-2.5" /></b><span className="min-w-0 truncate">{label ? `${label} · ` : ""}{titleOf(c.pageId)}{c.blockId ? "" : " (page)"}</span></Link>;
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="insights-panel">
      <div className="border-b border-line px-3 py-2.5">
        <div className="flex items-center gap-2"><div className="min-w-0 flex-1 text-[15px] font-semibold">Insights</div><button type="button" aria-label="Refresh insights" onClick={() => q.refetch()} className="icon-btn max-md:size-11"><RefreshCw className={cn(q.isFetching && "animate-spin")} /></button></div>
        <div className="ai-surface mt-2 p-2.5">
          <p className="text-micro leading-4 text-fg-muted">Contradictions and open questions need a model. Nothing is sent until you press the button: one call over your 24 most recently edited pages; results are suggestions.</p>
          <Button variant="ai" size="sm" className="mt-2 w-full max-md:h-11" onClick={() => run.mutate()} disabled={run.isPending || Boolean(queuedAt)} data-testid="run-ai-analysis">{run.isPending || queuedAt ? <Spinner className="size-3.5 border-white/40 border-t-white" /> : <Sparkles />}{queuedAt ? "Analysis running…" : "Run AI analysis"}</Button>
          {queuedAt && <p role="status" className="mt-1.5 text-micro leading-4 text-fg-muted">Queued {fmtDateTime(new Date(queuedAt).toISOString())}. This panel refreshes on its own.</p>}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {q.isLoading ? <div className="space-y-2 p-3"><Skeleton className="h-8" /><Skeleton className="h-8" /><Skeleton className="h-8" /></div> : q.isError ? <div className="p-3"><LoadError what="the insights" error={q.error} onRetry={() => q.refetch()} /></div> : <>
          <section className="border-b border-line px-2 py-2" data-testid="insight-findings">
            <div className="mb-1.5 flex items-center gap-2 px-1"><span className="text-micro font-semibold uppercase tracking-[0.08em] text-fg-muted">Findings</span><div className="ml-auto flex gap-0.5">{(["suggested", "accepted", "dismissed"] as const).map((s) => <button key={s} type="button" aria-pressed={status === s} onClick={() => setStatus(s)} className={cn("h-7 rounded-chip px-2 text-micro font-medium text-fg-muted hover:bg-bg-hover max-md:h-11", status === s && "bg-bg-sunk text-fg")}>{s === "suggested" ? "To review" : s === "accepted" ? "Accepted" : "Dismissed"} {q.data?.counts[s] ?? 0}</button>)}</div></div>
            {insights.length ? <ul className="space-y-1.5">{insights.map((i) => <li key={i.id} className={cn("rounded-control p-2.5", i.origin === "ai" ? "ai-surface" : "border border-line bg-bg")} data-insight={i.kind} data-origin={i.origin} data-status={i.status}>
              <div className="flex flex-wrap items-center gap-1.5"><Badge tone={i.kind === "contradiction" ? "danger" : "neutral"}>{KIND[i.kind]}</Badge>{i.origin === "ai" ? <AIBadge model={i.model} at={i.createdAt} /> : <span className="text-micro text-fg-muted">computed, no model</span>}{i.data.confidence != null && <span className="text-micro text-fg-muted">{Math.round(Number(i.data.confidence) * 100)} %</span>}</div>
              <div className="mt-1 text-ui font-medium leading-5 [overflow-wrap:anywhere]">{i.title}</div>
              {i.detail && <p className="mt-0.5 text-ui leading-5 text-fg-muted [overflow-wrap:anywhere]">{i.detail}</p>}
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {i.kind === "contradiction" && i.data.a && i.data.b ? <><Cite c={i.data.a} label="A" /><Cite c={i.data.b} label="B" /></> : i.kind === "open_question" && i.data.source ? <Cite c={i.data.source} /> : (i.data.pageIds ?? []).slice(0, 4).map((id) => <Link key={id} href={`/p/${id}`} className="cite-chip min-h-11 md:min-h-0"><span className="min-w-0 truncate pl-2">{titleOf(id)}</span></Link>)}
                {(i.data.pageIds?.length ?? 0) > 1 && onPages && <button type="button" onClick={() => onPages(i.data.pageIds!, i.title)} className="h-6 rounded-pill px-2 text-micro font-medium text-accent hover:bg-accent-soft max-md:h-11">Show in graph</button>}
              </div>
              <div className="mt-2 flex gap-1">{i.status === "suggested" ? <><Button size="xs" variant="outline" className="max-md:h-11 max-md:px-3" disabled={decide.isPending} onClick={() => decide.mutate({ id: i.id, status: "accepted" })}><Check /> Accept</Button><Button size="xs" variant="ghost" className="max-md:h-11 max-md:px-3" disabled={decide.isPending} onClick={() => decide.mutate({ id: i.id, status: "dismissed" })}><X /> Dismiss</Button></> : <Button size="xs" variant="ghost" className="max-md:h-11 max-md:px-3" disabled={decide.isPending} onClick={() => decide.mutate({ id: i.id, status: "suggested" })}>Put back to review</Button>}</div>
            </li>)}</ul> : <p className="px-1 py-2 text-ui leading-5 text-fg-muted">{status === "suggested" ? "Nothing to review. Run the analysis to look for contradictions and open questions." : `No ${status} finding.`}</p>}
          </section>
          {x && <>
            <div className="px-3 pb-1 pt-3 text-micro font-semibold uppercase tracking-[0.08em] text-fg-muted">Computed from your graph · no model</div>
            <Group title="Central pages" count={x.centralPages.length} open testId="insight-central">{x.centralPages.length ? x.centralPages.map((p) => <button key={p.id} type="button" className={row} onClick={() => onFocus?.(p.id)}><span className="min-w-0 flex-1 truncate">{p.icon ? `${p.icon} ` : ""}{p.title || "Untitled"}</span><span className="shrink-0 text-micro tabular-nums text-fg-muted">{p.degree} links</span></button>) : <p className="px-2 py-1 text-ui text-fg-muted">No linked page yet.</p>}</Group>
            <Group title="Central concepts" count={x.centralConcepts.length}>{x.centralConcepts.length ? x.centralConcepts.map((c) => <div key={c.id} className={row}><span className="min-w-0 flex-1 truncate">{c.name}</span>{c.origin === "ai" && <AIBadge />}<span className="shrink-0 text-micro tabular-nums text-fg-muted">{c.pages} pages</span></div>) : <p className="px-2 py-1 text-ui text-fg-muted">No concept yet.</p>}</Group>
            <Group title="Orphans" count={x.stats.orphans} testId="insight-orphans">{x.orphans.length ? x.orphans.map((p) => <Link key={p.id} href={`/p/${p.id}`} className={row}><span className="min-w-0 flex-1 truncate">{p.icon ? `${p.icon} ` : ""}{p.title || "Untitled"}</span><span className="shrink-0 text-micro text-fg-muted">{p.section}</span></Link>) : <p className="px-2 py-1 text-ui text-fg-muted">Every page is connected.</p>}</Group>
            <Group title="Clusters" count={x.clusters.length} testId="insight-clusters">{x.clusters.length ? x.clusters.map((c) => <button key={c.id} type="button" className={row} onClick={() => onPages?.(c.pageIds, c.label)}><span className="min-w-0 flex-1 truncate">{c.label}</span><span className="shrink-0 text-micro tabular-nums text-fg-muted">{c.size} pages</span></button>) : <p className="px-2 py-1 text-ui text-fg-muted">No cluster of linked pages yet.</p>}</Group>
            <Group title="Recurring topics" count={x.recurringTopics.length}>{x.recurringTopics.length ? x.recurringTopics.map((t) => <button key={`${t.kind}:${t.id}`} type="button" className={row} onClick={() => onPages?.(t.pageIds, t.name)}><span className="min-w-0 flex-1 truncate">{t.kind === "tag" ? "#" : ""}{t.name}</span><span className="shrink-0 text-micro tabular-nums text-fg-muted">{t.pages} pages</span></button>) : <p className="px-2 py-1 text-ui text-fg-muted">No tag or concept is shared by two pages.</p>}</Group>
            <Group title="Duplicates" count={x.duplicates.length} testId="insight-duplicates">{x.duplicates.length ? x.duplicates.map((d, i) => <button key={i} type="button" className={row} onClick={() => onPages?.(d.pageIds, d.title)}><span className="min-w-0 flex-1 truncate">{d.title || "Untitled"}</span><span className="shrink-0 text-micro text-fg-muted">{d.pageIds.length} × same {d.reason === "title" ? "title" : "text"}</span></button>) : <p className="px-2 py-1 text-ui text-fg-muted">No duplicate found.</p>}</Group>
            <p className="px-3 py-2 text-micro text-fg-muted">Computed {fmtDateTime(x.computedAt)} · {x.stats.pages} pages · {x.stats.edges} edges</p>
          </>}
        </>}
      </div>
    </div>
  );
}
