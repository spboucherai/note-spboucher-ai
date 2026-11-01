"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, FileText, ShieldCheck, Square, Wrench, Bot, CheckCheck } from "lucide-react";
import { api } from "@/lib/client/api";
import { Dialog, DialogContent, Badge, Spinner } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { Markdown } from "@/components/markdown";
import { toast } from "@/components/ui/toast";
import { cn, fmtDate } from "@/lib/utils";
import { ms, usd } from "@/components/ai/models/format";
import { ProposalCard, type ProposalView } from "./ProposalCard";

export const STATUS_TONE: Record<string, "neutral" | "accent" | "ai" | "success" | "warning" | "danger"> = { pending: "neutral", running: "ai", awaiting_approval: "warning", approved: "success", completed: "success", rejected: "neutral", failed: "danger" };
export const isLive = (s: string | undefined) => s === "pending" || s === "running";
interface Step { tool: string; input: unknown; output?: unknown; at: string; ms?: number; error?: string; proposalIdx?: number }
interface Detail { id: string; agent: string; agentName: string; agentIcon: string; task: string; model: string | null; status: string; scopes: string[]; toolsInvoked: Step[]; documents: { id: string; title: string; icon: string | null; section: string | null; deletedAt: string | null }[]; proposedChanges: ProposalView[]; approvals: { change: number; approved: boolean; at: string }[]; outcome: string | null; result: string | null; error: string | null; costUsd: number | null; tokensIn: number | null; tokensOut: number | null; createdAt: string; startedAt: string | null; finishedAt: string | null; contextPageId: string | null }

function StepRow({ s, i }: { s: Step; i: number }) {
  const [open, setOpen] = useState(false); const isModel = s.tool === "model"; const out: any = s.output ?? {};
  const summary = isModel ? `turn ${(s.input as any)?.turn ?? i} · ${out.toolCalls?.length ? `called ${out.toolCalls.join(", ")}` : "final answer"} · ${out.tokens ? `${out.tokens.inputTokens}→${out.tokens.outputTokens} tok` : ""} · ${usd(out.costUsd)}` : s.error ? `error: ${s.error}` : out.count != null ? `${out.count} result${out.count === 1 ? "" : "s"}` : out.title ? out.title : out.recorded ? `proposal #${(s.proposalIdx ?? 0) + 1} recorded` : out.created ? `created ${out.title ?? out.pageId}` : "ok";
  return (
    <li className="relative pl-6"><span className={cn("absolute left-1.5 top-2 size-2.5 rounded-full border-2 border-bg-elev", isModel ? "bg-ai" : s.error ? "bg-danger" : "bg-accent")} />
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-start gap-2 rounded-md px-1.5 py-1 text-left hover:bg-bg-sunk">
        <span className="mt-0.5 font-mono text-[12px] font-medium">{isModel ? <span className="inline-flex items-center gap-1"><Bot className="size-3.5" />model</span> : <span className="inline-flex items-center gap-1"><Wrench className="size-3.5" />{s.tool}</span>}</span>
        <span className="min-w-0 flex-1 truncate text-[12px] text-fg-muted">{summary}</span><span className="text-[11px] text-fg-faint tabular-nums">{s.ms != null ? ms(s.ms) : ""}</span><ChevronDown className={cn("size-3.5 shrink-0 text-fg-faint transition-transform", open && "rotate-180")} />
      </button>
      {open && <div className="mb-2 ml-1.5 grid gap-2 text-[11.5px] md:grid-cols-2"><div><div className="mb-0.5 text-[10.5px] uppercase tracking-wide text-fg-muted">Input</div><pre className="max-h-56 overflow-auto rounded-md border border-line bg-bg-sunk p-2 font-mono whitespace-pre-wrap break-words">{JSON.stringify(s.input, null, 1)}</pre></div><div><div className="mb-0.5 text-[10.5px] uppercase tracking-wide text-fg-muted">Output</div><pre className="max-h-56 overflow-auto rounded-md border border-line bg-bg-sunk p-2 font-mono whitespace-pre-wrap break-words">{isModel && out.text ? out.text + (out.toolCalls?.length ? `\n\n→ tool calls: ${out.toolCalls.join(", ")}` : "") : JSON.stringify(s.output, null, 1)}</pre></div></div>}
    </li>
  );
}
export function ExecutionDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const qc = useQueryClient(); const [busy, setBusy] = useState(false);
  const { data: d } = useQuery<Detail>({ queryKey: ["agent-exec", id], queryFn: () => api(`/api/agents/${id}`), enabled: Boolean(id), refetchInterval: (q) => (isLive(q.state.data?.status) ? 2000 : false) });
  const refresh = () => { qc.invalidateQueries({ queryKey: ["agent-exec", id] }); qc.invalidateQueries({ queryKey: ["agents"] }); };
  async function decide(action: "approve" | "reject", changes: number[]) { if (!id) return; setBusy(true); try { const r = await api(`/api/agents/${id}`, { method: "POST", json: { action, changes } }); toast(action === "approve" ? `${r.applied.length} change${r.applied.length === 1 ? "" : "s"} applied${r.failed.length ? `, ${r.failed.length} failed` : ""}` : `${changes.length} rejected`, { tone: r.failed?.length ? "danger" : "success" }); if (action === "approve" && r.applied.length) qc.invalidateQueries({ queryKey: ["tree"] }); } catch (e: any) { toast("Decision failed", { description: e.message, tone: "danger" }); } finally { setBusy(false); refresh(); } }
  async function cancel() { if (!id) return; setBusy(true); try { await api(`/api/agents/${id}`, { method: "POST", json: { action: "cancel" } }); toast("Execution cancelled"); } catch (e: any) { toast("Cancel failed", { description: e.message, tone: "danger" }); } finally { setBusy(false); refresh(); } }
  const pending = d?.proposedChanges?.filter((p) => p.status === "proposed") ?? [];
  const dur = d?.startedAt ? ((d.finishedAt ? new Date(d.finishedAt) : new Date()).getTime() - new Date(d.startedAt).getTime()) : null;
  return (
    <Dialog open={Boolean(id)} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent wide className="max-w-5xl px-2 pb-2 pt-4 [&>h2]:px-2 [&>h2]:text-[12px] [&>h2]:text-fg-muted" title="Agent execution">
        {!d ? <div className="grid h-48 place-items-center"><Spinner /></div> : (
          <div className="-mt-1 flex max-h-[86vh] flex-col">
            <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3 pr-12">
              <span className="text-xl leading-none">{d.agentIcon}</span><div className="min-w-0 flex-1"><div className="text-[14px] font-semibold">{d.agentName}</div><div className="truncate text-[12px] text-fg-muted">{d.task}</div></div>
              <Badge tone={STATUS_TONE[d.status] ?? "neutral"}>{isLive(d.status) && <Spinner className="mr-1 size-3" />}{d.status.replace("_", " ")}</Badge>
              {isLive(d.status) && <Button size="sm" variant="ghost" disabled={busy} onClick={cancel}><Square />Cancel</Button>}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
              <div className="grid grid-cols-2 gap-2 text-[12px] sm:grid-cols-4 lg:grid-cols-6">{[["Model", d.model ?? "auto (agent route)"], ["Cost", usd(d.costUsd)], ["Tokens", `${d.tokensIn ?? 0} → ${d.tokensOut ?? 0}`], ["Duration", dur != null ? ms(dur) : "—"], ["Tool calls", String(d.toolsInvoked.filter((s) => s.tool !== "model").length)], ["Started", d.startedAt ? fmtDate(d.startedAt, { timeStyle: "short", dateStyle: "short" }) : "queued"]].map(([l, v]) => <div key={l} className="rounded-lg bg-bg-sunk px-2 py-1.5"><div className="text-[10.5px] uppercase tracking-wide text-fg-muted">{l}</div><div className="truncate font-medium tabular-nums" title={v}>{v}</div></div>)}</div>
              {d.error && <div className="mt-3 rounded-md border border-danger/30 bg-danger/5 p-2 text-[12.5px] text-danger">{d.error}</div>}
              {d.outcome && <div className="mt-3 text-[12.5px] text-fg-muted"><span className="font-medium text-fg">Outcome:</span> {d.outcome}</div>}
              {d.proposedChanges.length > 0 && <section className="mt-4"><div className="mb-2 flex items-center gap-2"><h3 className="text-[13px] font-semibold">Proposals</h3><span className="text-[12px] text-fg-muted">{d.proposedChanges.length} · {pending.length} pending</span>{pending.length > 1 && <Button size="xs" className="ml-auto" disabled={busy} onClick={() => decide("approve", pending.map((p) => p.idx))}><CheckCheck />Approve all ({pending.length})</Button>}{pending.length > 1 && <Button size="xs" variant="ghost" disabled={busy} onClick={() => decide("reject", pending.map((p) => p.idx))}>Reject all</Button>}</div><div className="space-y-2">{d.proposedChanges.map((p) => <ProposalCard key={p.idx} p={p} busy={busy} onApprove={() => decide("approve", [p.idx])} onReject={() => decide("reject", [p.idx])} />)}</div></section>}
              {d.result && <section className="mt-4"><h3 className="mb-1 text-[13px] font-semibold">Answer</h3><div className="rounded-xl border border-line bg-bg-elev p-3"><Markdown text={d.result} /></div></section>}
              <section className="mt-4"><h3 className="mb-1 text-[13px] font-semibold">Timeline</h3>{d.toolsInvoked.length ? <ul className="relative space-y-0.5 border-l border-line ml-2.5 pl-0">{d.toolsInvoked.map((s, i) => <StepRow key={i} s={s} i={i} />)}</ul> : <div className="text-[12.5px] text-fg-muted">{isLive(d.status) ? "Waiting for the worker…" : "No steps recorded."}</div>}</section>
              <section className="mt-4"><h3 className="mb-1 text-[13px] font-semibold">Documents accessed</h3>{d.documents.length ? <ul className="flex flex-wrap gap-1.5">{d.documents.map((p) => <li key={p.id}><a href={`/p/${p.id}`} className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-[12px] hover:bg-bg-sunk"><FileText className="size-3.5 text-fg-muted" />{p.icon ?? ""} {p.title}{p.id === d.contextPageId && <Badge>context</Badge>}</a></li>)}</ul> : <div className="text-[12.5px] text-fg-muted">None.</div>}</section>
              <section className="mt-4 mb-2 rounded-xl border border-line bg-bg-sunk/50 p-3 text-[12px]"><div className="mb-1 flex items-center gap-1.5 font-semibold"><ShieldCheck className="size-4 text-success" />Audit record</div><dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5"><dt className="text-fg-muted">Execution</dt><dd className="font-mono text-[11.5px]">{d.id}</dd><dt className="text-fg-muted">Scopes granted</dt><dd>{d.scopes.length ? d.scopes.map((s) => <code key={s} className="mr-1 rounded bg-bg-elev px-1 font-mono text-[11px]">{s}</code>) : "none"}</dd><dt className="text-fg-muted">Created</dt><dd>{fmtDate(d.createdAt, { dateStyle: "medium", timeStyle: "short" })}</dd><dt className="text-fg-muted">Finished</dt><dd>{d.finishedAt ? fmtDate(d.finishedAt, { dateStyle: "medium", timeStyle: "short" }) : "—"}</dd><dt className="text-fg-muted">Decisions</dt><dd>{d.approvals.length ? <ul className="space-y-0.5">{d.approvals.map((a, i) => <li key={i}>#{a.change + 1} {a.approved ? "approved" : "rejected"} · {fmtDate(a.at, { dateStyle: "short", timeStyle: "short" })}</li>)}</ul> : "none yet"}</dd><dt className="text-fg-muted">Guarantees</dt><dd className="text-fg-muted">No shell, no network; workspace content passed as data; only approved proposals are written (plus at most one draft page under “AI drafts” when write:pages was granted); bulk edits and deletions are never automatic.</dd></dl></section>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
