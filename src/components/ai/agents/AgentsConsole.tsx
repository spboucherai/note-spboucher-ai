"use client";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Play, Search, X } from "lucide-react";
import { api } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
import { Textarea, Input } from "@/components/ui/input";
import { Badge, Spinner } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { ExecutionList, type ExecSummary } from "./ExecutionList";
import { ExecutionDrawer, isLive } from "./ExecutionDrawer";

interface AgentInfo { id: string; name: string; icon: string; description: string; tools: { name: string; scope: string; proposal: boolean }[]; defaultScopes: string[]; allowedScopes: string[] }
interface Payload { agents: AgentInfo[]; scopes: { id: string; label: string; write: boolean }[]; limits: { maxToolCalls: number; maxTokens: number; maxCostUsd: number; maxTurns: number }; executions: ExecSummary[] }

export function AgentsConsole({ initialPageId }: { initialPageId?: string | null }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<Payload>({ queryKey: ["agents"], queryFn: () => api("/api/agents"), refetchInterval: (q) => (q.state.data?.executions.some((e) => isLive(e.status)) ? 2000 : false) });
  const [agentId, setAgentId] = useState<string>("research_assistant"); const [scopes, setScopes] = useState<string[]>([]); const [task, setTask] = useState(""); const [page, setPage] = useState<{ id: string; title: string } | null>(null); const [pageQ, setPageQ] = useState(""); const [running, setRunning] = useState(false); const [open, setOpen] = useState<string | null>(null);
  const agent = useMemo(() => data?.agents.find((a) => a.id === agentId) ?? data?.agents[0], [data, agentId]);
  useEffect(() => { if (agent) setScopes(agent.defaultScopes); }, [agent?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (initialPageId) api(`/api/pages/${initialPageId}`).then((p) => setPage({ id: p.id, title: p.title })).catch(() => {}); }, [initialPageId]);
  const { data: pageHits = [] } = useQuery<{ id: string; title: string; icon: string | null }[]>({ queryKey: ["search", "quick", pageQ], queryFn: () => api(`/api/search?mode=quick&q=${encodeURIComponent(pageQ)}&limit=8`), enabled: pageQ.trim().length > 0, staleTime: 10_000 });
  const writeOn = scopes.some((s) => s.startsWith("write:"));
  async function run() {
    if (!agent || task.trim().length < 3) return; setRunning(true);
    try { const r = await api("/api/agents", { method: "POST", json: { agent: agent.id, task: task.trim(), scopes, pageId: page?.id ?? null } }); toast("Agent queued", { description: `${agent.name} · execution ${r.id.slice(0, 8)}`, tone: "ai" }); setTask(""); qc.invalidateQueries({ queryKey: ["agents"] }); setOpen(r.id); }
    catch (e: any) { toast("Could not start the agent", { description: e.message, tone: "danger" }); } finally { setRunning(false); }
  }
  if (isLoading || !data || !agent) return <div className="grid h-64 place-items-center"><Spinner /></div>;
  const agentsById = Object.fromEntries(data.agents.map((a) => [a.id, { name: a.name, icon: a.icon }]));
  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      <div className="mb-4"><h1 className="text-2xl font-semibold tracking-tight">Agents</h1><p className="mt-0.5 text-[13px] text-fg-muted">Controlled agents: they read with the scopes you grant, and every change they want to make is a proposal you approve. No shell, no network, at most {data.limits.maxToolCalls} tool calls and ${data.limits.maxCostUsd} per run.</p></div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{data.agents.map((a) => <button key={a.id} type="button" onClick={() => setAgentId(a.id)} className={cn("rounded-xl border p-3 text-left shadow-card transition-colors hover:bg-bg-sunk/60", agent.id === a.id ? "border-ai bg-ai-soft/40" : "border-line bg-bg-elev")}><div className="flex items-center gap-2"><span className="text-lg leading-none">{a.icon}</span><span className="text-[13.5px] font-semibold">{a.name}</span></div><p className="mt-1 text-[12px] leading-5 text-fg-muted">{a.description}</p><div className="mt-2 flex flex-wrap gap-1">{a.tools.map((t) => <span key={t.name} className={cn("rounded px-1 py-0.5 font-mono text-[10px]", t.proposal ? "bg-warning/15 text-warning" : t.scope === "write:pages" ? "bg-ai-soft text-ai" : "bg-bg-sunk text-fg-muted")}>{t.name}</span>)}</div></button>)}</div>
      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="rounded-xl border border-line bg-bg-elev p-3 shadow-card">
          <div className="mb-1 flex items-center gap-2 text-[13px] font-semibold"><span>{agent.icon}</span>{agent.name} — task</div>
          <Textarea value={task} onChange={(e) => setTask(e.target.value)} rows={4} placeholder="Describe what the agent should do, e.g. “Summarize what my notes say about TITAN-MoE and propose one follow-up task”. (⌘⏎ to run)" className="min-h-[96px]" onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); run(); } }} />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <div className="relative min-w-0 flex-1">
              {page ? <div className="flex h-9 items-center gap-1.5 rounded-md border border-line bg-bg px-2 text-[12.5px]"><span className="text-fg-muted">Context:</span><span className="truncate">{page.title}</span><button type="button" className="ml-auto rounded p-0.5 text-fg-muted hover:bg-bg-sunk" onClick={() => setPage(null)} aria-label="Remove context page"><X className="size-3.5" /></button></div>
                : <><Search className="pointer-events-none absolute left-2 top-2.5 size-3.5 text-fg-faint" /><Input value={pageQ} onChange={(e) => setPageQ(e.target.value)} placeholder="Optional page context (search by title)" className="pl-7 text-[12.5px]" />
                  {pageQ.trim() && pageHits.length > 0 && <ul className="absolute z-20 mt-1 w-full rounded-lg border border-line bg-bg-elev p-1 shadow-pop">{pageHits.map((h) => <li key={h.id}><button type="button" className="w-full truncate rounded-md px-2 py-1.5 text-left text-[12.5px] hover:bg-bg-sunk" onClick={() => { setPage({ id: h.id, title: h.title }); setPageQ(""); }}>{h.icon ?? ""} {h.title}</button></li>)}</ul>}</>}
            </div>
            <Button variant="ai" onClick={run} disabled={running || task.trim().length < 3}>{running ? <Spinner className="size-4 border-t-white" /> : <Play />}Run agent</Button>
          </div>
        </div>
        <div className="rounded-xl border border-line bg-bg-elev p-3 shadow-card">
          <div className="text-[13px] font-semibold">Scopes for this run</div>
          <ul className="mt-2 space-y-1">{data.scopes.filter((s) => agent.allowedScopes.includes(s.id)).map((s) => { const on = scopes.includes(s.id); return <li key={s.id}><label className="flex min-h-[40px] cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-[12.5px] hover:bg-bg-sunk"><input type="checkbox" className={s.write ? "accent-warning" : "accent-accent"} checked={on} onChange={(e) => setScopes((sc) => (e.target.checked ? [...sc, s.id] : sc.filter((x) => x !== s.id)))} /><span className="flex-1">{s.label}</span><code className={cn("rounded px-1 font-mono text-[10.5px]", s.write ? "bg-warning/15 text-warning" : "bg-bg-sunk text-fg-muted")}>{s.id}</code></label></li>; })}</ul>
          {writeOn ? <div className="mt-2 flex items-start gap-1.5 rounded-md border border-warning/40 bg-warning/10 p-2 text-[11.5px] leading-4"><AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" /><span><b>Write scope on.</b> {scopes.includes("write:pages") ? "The agent may create one draft page under “AI drafts” without asking. " : ""}Other changes still arrive as proposals; nothing existing is modified or deleted without your approval.</span></div> : <p className="mt-2 text-[11.5px] leading-4 text-fg-muted">Read-only run: the agent can search and read; its suggestions are recorded as proposals for you to approve.</p>}
          <div className="mt-2 flex flex-wrap gap-1"><Badge>max {data.limits.maxToolCalls} tool calls</Badge><Badge>≤ {Math.round(data.limits.maxTokens / 1000)}K tokens</Badge><Badge>≤ ${data.limits.maxCostUsd}</Badge></div>
        </div>
      </div>
      <section className="mt-6"><div className="mb-2 flex items-baseline gap-2"><h2 className="text-[15px] font-semibold tracking-tight">Executions</h2><span className="text-[12px] text-fg-muted">{data.executions.length} · click a row for the full trace</span></div><ExecutionList items={data.executions} agents={agentsById} onOpen={setOpen} /></section>
      <ExecutionDrawer id={open} onClose={() => { setOpen(null); qc.invalidateQueries({ queryKey: ["agents"] }); }} />
    </div>
  );
}
