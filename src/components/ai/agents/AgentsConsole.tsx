/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/components/ai/agents/AgentsConsole.tsx
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
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Ban, Eye, PencilLine, Play, RotateCcw, Search, WifiOff, X } from "lucide-react";
import { api, ApiError } from "@/lib/client/api";
import { useOnline } from "@/lib/client/hooks";
import { Button } from "@/components/ui/button";
import { Dialog, SheetContent, Skeleton, Spinner } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import type { AgentInfo } from "@/lib/agents/types";
import { ExecutionList, isLive, type ExecSummary } from "./ExecutionList";
import { ExecutionDrawer } from "./ExecutionDrawer";

interface Payload { agents: AgentInfo[]; configured: boolean; target: { provider: string; model: string } | null; budgetNote: string | null; executions: ExecSummary[] }
type PageRef = { id: string; title: string };

/**
 * Agents = a small fixed catalogue of bounded tasks. Before a run starts the owner sees its scope (what it may read, what it may
 * propose, what it can never do), where the content is sent and the hard cost cap. A run only produces proposals to review.
 */
export function AgentsConsole({ initialPageId }: { initialPageId?: string | null }) {
  const qc = useQueryClient(); const online = useOnline();
  const { data, isLoading, isError, error, refetch } = useQuery<Payload>({ queryKey: ["agents"], queryFn: () => api("/api/agents"), refetchInterval: (q) => (q.state.data?.executions.some((e) => isLive(e.status)) ? 2500 : false) });
  const [launch, setLaunch] = useState<AgentInfo | null>(null); const [page, setPage] = useState<PageRef | null>(null); const [pageQ, setPageQ] = useState(""); const [starting, setStarting] = useState(false); const [open, setOpen] = useState<string | null>(null);
  useEffect(() => { if (initialPageId) api(`/api/pages/${initialPageId}`).then((p) => setPage({ id: p.id, title: p.title })).catch(() => {}); }, [initialPageId]);
  const { data: pageHits = [], isFetching: searching } = useQuery<{ id: string; title: string; icon: string | null }[]>({ queryKey: ["search", "quick", pageQ], queryFn: () => api(`/api/search?mode=quick&q=${encodeURIComponent(pageQ)}&limit=8`), enabled: pageQ.trim().length > 0 && Boolean(launch), staleTime: 10_000 });
  const running = data?.executions.find((e) => isLive(e.status));

  async function run() {
    if (!launch || starting) return; setStarting(true);
    try {
      const r = await api("/api/agents", { method: "POST", json: { agent: launch.id, pageId: launch.page === "none" ? null : page?.id ?? null, confirmCost: true } });
      toast("Run started", { description: `${launch.name} — it will only make proposals.`, tone: "ai" }); setLaunch(null); qc.invalidateQueries({ queryKey: ["agents"] }); setOpen(r.id);
    } catch (e: any) {
      if (e instanceof ApiError && e.code === "already_running" && e.body?.id) { toast("A run is already in progress", { description: "Opening it." }); setLaunch(null); setOpen(e.body.id); }
      else toast(e instanceof ApiError && e.code === "not_configured" ? "AI is not configured" : "The run did not start", { description: e?.message, tone: "danger" });
    } finally { setStarting(false); }
  }

  if (isLoading) return <div className="mx-auto grid max-w-3xl gap-3 px-4 py-6"><Skeleton className="h-8 w-40" /><Skeleton className="h-24" /><Skeleton className="h-24" /><Skeleton className="h-24" /></div>;
  if (isError || !data) return <div className="mx-auto max-w-3xl px-4 py-10 text-center" role="alert"><p className="text-[14px] text-danger-text">{(error as Error)?.message ?? "Could not load the agents."}</p><Button variant="outline" className="mt-3 h-11" onClick={() => refetch()}><RotateCcw />Retry</Button></div>;
  const agentsById = Object.fromEntries(data.agents.map((a) => [a.id, { name: a.name, icon: a.icon }]));
  const target = data.target ? `${data.target.provider} · ${data.target.model}` : null; const needsPage = launch?.page === "required" && !page;
  const blocked = !online || !data.configured || !data.target;
  return (
    <div className="mx-auto min-w-0 max-w-3xl px-4 py-6 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight">Agents</h1>
      <p className="mt-1 text-[13.5px] leading-5 text-fg-muted">Four bounded tasks. Each one reads only what its scope lists and only makes <b className="font-medium text-fg">proposals</b>: nothing is changed until you approve a change, and every applied change can be undone. No shell, no network.</p>
      {!online && <div role="status" className="mt-3 flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-[13px] leading-5"><WifiOff className="mt-0.5 size-4 shrink-0 text-warning" />You are offline: runs cannot start. Past runs below are the last ones loaded.</div>}
      {!data.configured ? <div role="alert" className="mt-3 flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/5 p-3 text-[13px] leading-5"><AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" /><span><b>AI is not configured.</b> No provider API key is set on the server, so agents cannot run.</span></div>
        : !data.target ? <div role="alert" className="mt-3 flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/5 p-3 text-[13px] leading-5"><AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" /><span><b>Agents are not configured.</b> No enabled model supports tool use (see AI → Models).</span></div> : null}
      {data.budgetNote && <div role="status" className="mt-3 rounded-lg border border-warning/40 bg-warning/10 p-3 text-[13px] leading-5">{data.budgetNote}</div>}

      <ul className="mt-4 grid gap-2 sm:grid-cols-2">{data.agents.map((a) => (
        <li key={a.id}><button type="button" onClick={() => { setLaunch(a); setPageQ(""); }} className="flex h-full min-h-[72px] w-full items-start gap-3 rounded-xl border border-line bg-bg-elev p-3 text-left shadow-card transition-colors hover:border-ai/50 hover:bg-bg-sunk/60">
          <span className="text-2xl leading-none" aria-hidden>{a.icon}</span>
          <span className="min-w-0 flex-1"><span className="block text-[15px] font-semibold">{a.name}</span><span className="mt-0.5 block text-[13px] leading-5 text-fg-muted">{a.description}</span><span className="mt-1 block text-[11.5px] text-fg-faint">Up to {a.limits.maxToolCalls} tool calls · hard cap ${a.limits.maxCostUsd.toFixed(2)}{a.page === "required" ? " · needs a page" : ""}</span></span>
        </button></li>))}</ul>

      <section className="mt-6 min-w-0">
        <div className="mb-2 flex items-baseline gap-2"><h2 className="text-[15px] font-semibold tracking-tight">Runs</h2><span className="text-[12px] text-fg-muted">{running ? "one in progress" : `${data.executions.length} most recent`}</span></div>
        <ExecutionList items={data.executions} agents={agentsById} onOpen={setOpen} />
      </section>

      <Dialog open={Boolean(launch)} onOpenChange={(o) => { if (!o) setLaunch(null); }}>
        <SheetContent title={launch ? `${launch.icon} ${launch.name}` : "Agent"} description="Read the scope before starting. Nothing starts until you press Run.">
          {launch && (
            <div className="grid min-w-0 gap-3 pb-1 text-[13.5px] leading-5">
              <div className="rounded-xl border border-line p-3"><div className="mb-1 flex items-center gap-1.5 font-semibold"><Eye className="size-4 text-accent" />May read</div><ul className="list-disc pl-5 text-fg-muted">{launch.reads.map((r) => <li key={r}>{r}</li>)}</ul></div>
              <div className="rounded-xl border border-line p-3"><div className="mb-1 flex items-center gap-1.5 font-semibold"><PencilLine className="size-4 text-ai" />May propose (you approve each one)</div><ul className="list-disc pl-5 text-fg-muted">{launch.proposes.map((r) => <li key={r}>{r}</li>)}</ul></div>
              <div className="rounded-xl border border-line p-3"><div className="mb-1 flex items-center gap-1.5 font-semibold"><Ban className="size-4 text-danger" />Can never</div><ul className="list-disc pl-5 text-fg-muted">{launch.never.map((r) => <li key={r}>{r}</li>)}</ul></div>
              {launch.page !== "none" && (
                <div className="rounded-xl border border-line p-3">
                  <div className="mb-1.5 font-semibold">Page {launch.page === "required" ? "(required)" : "(optional — without one, recent untagged pages are used)"}</div>
                  {page ? <div className="flex min-h-11 items-center gap-2 rounded-lg bg-bg-sunk pl-3"><span className="min-w-0 flex-1 truncate">{page.title}</span><button type="button" aria-label="Remove the page" className="grid size-11 shrink-0 place-items-center text-fg-muted" onClick={() => setPage(null)}><X className="size-4" /></button></div>
                    : <><div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-faint" /><input value={pageQ} onChange={(e) => setPageQ(e.target.value)} aria-label="Search a page by title" placeholder="Search a page by title" className="h-11 w-full rounded-lg border border-line bg-bg pl-9 pr-3 text-[16px] outline-none focus:border-accent/60" /></div>
                      {pageQ.trim() && <ul className="mt-1 grid">{searching && !pageHits.length ? <li className="px-1 py-2"><Skeleton className="h-5 w-40" /></li> : pageHits.length ? pageHits.map((h) => <li key={h.id}><button type="button" className="flex min-h-12 w-full items-center gap-2 rounded-lg px-2 text-left hover:bg-bg-sunk" onClick={() => { setPage({ id: h.id, title: h.title }); setPageQ(""); }}><span aria-hidden>{h.icon ?? "📄"}</span><span className="min-w-0 flex-1 truncate">{h.title}</span></button></li>) : <li className="px-1 py-2 text-fg-muted">No page with that title.</li>}</ul>}</>}
                </div>
              )}
              <div role="note" className="rounded-xl border border-warning/40 bg-warning/10 p-3"><div className="mb-1 flex items-center gap-1.5 font-semibold"><AlertTriangle className="size-4 text-warning" />Cost and where it goes</div>
                <p>This run sends what is listed under “May read” to <b className="font-medium">{target ?? "the AI provider"}</b>, in several calls. It stops by itself at <b className="font-medium">{launch.limits.maxToolCalls} tool calls</b>, {Math.round(launch.limits.maxTokens / 1000)}K tokens, <b className="font-medium">${launch.limits.maxCostUsd.toFixed(2)}</b> or {Math.round(launch.limits.timeoutMs / 60_000)} minutes, whichever comes first. The real cost is shown on the run.</p>
              </div>
              <div className="sticky bottom-0 -mx-4 -mb-1 grid gap-1.5 border-t border-line bg-bg-elev px-4 pb-1 pt-2 sm:-mx-5 sm:px-5">
                <Button variant="ai" className={cn("h-11 w-full")} disabled={blocked || starting || needsPage || Boolean(running)} onClick={run}>{starting ? <Spinner className="size-4 border-t-white" /> : <Play />}Run — up to ${launch.limits.maxCostUsd.toFixed(2)}</Button>
                {(blocked || needsPage || running) && <p className="text-center text-[12.5px] text-fg-muted">{!online ? "You are offline." : !data.configured || !data.target ? "AI is not configured." : running ? "Another run is in progress — wait for it or cancel it." : "Choose a page first."}</p>}
              </div>
            </div>
          )}
        </SheetContent>
      </Dialog>
      <ExecutionDrawer id={open} onClose={() => { setOpen(null); qc.invalidateQueries({ queryKey: ["agents"] }); }} />
    </div>
  );
}
