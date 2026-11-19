"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCheck, FileText, RotateCcw, ShieldCheck, Square, Trash2, X } from "lucide-react";
import { api, ApiError } from "@/lib/client/api";
import { Dialog, DialogContent, SheetContent, Badge, Spinner, Skeleton } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { Markdown } from "@/components/markdown";
import { toast } from "@/components/ui/toast";
import { fmtDate } from "@/lib/utils";
import { ms, usd } from "@/components/ai/models/format";
import type { AgentInfo, ToolStep } from "@/lib/agents/types";
import { ProposalCard, type ProposalView } from "./ProposalCard";
import { STATUS_TONE, STATUS_LABEL, isLive } from "./ExecutionList";

interface Detail { id: string; agent: string; agentName: string; agentIcon: string; info: AgentInfo | null; model: string | null; status: string; scopes: string[]; toolsInvoked: ToolStep[]; documents: { id: string; title: string; icon: string | null; deletedAt: string | null }[]; proposedChanges: ProposalView[]; approvals: { change: number; approved: boolean; at: string }[]; outcome: string | null; result: string | null; error: string | null; costUsd: number | null; tokensIn: number | null; tokensOut: number | null; createdAt: string; startedAt: string | null; finishedAt: string | null }
const brief = (o: Record<string, unknown> | undefined) => Object.entries(o ?? {}).map(([k, v]) => `${k}: ${typeof v === "object" && v ? JSON.stringify(v) : String(v)}`).join(" · ");

/**
 * Review screen of one run. Phone-first: proposals are cards stacked in one column (before above after), the approve/reject bar stays
 * docked at the bottom of the sheet, and the execution log is a plain list — nothing needs sideways scrolling.
 */
export function ExecutionDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const qc = useQueryClient(); const [busy, setBusy] = useState(false); const [confirm, setConfirm] = useState<number[] | null>(null); const [pendingBatch, setPendingBatch] = useState<number[]>([]);
  const { data: d, isError, error, refetch } = useQuery<Detail>({ queryKey: ["agent-exec", id], queryFn: () => api(`/api/agents/${id}`), enabled: Boolean(id), refetchInterval: (q) => (isLive(q.state.data?.status) ? 2000 : false) });
  const refresh = () => { qc.invalidateQueries({ queryKey: ["agent-exec", id] }); qc.invalidateQueries({ queryKey: ["agents"] }); };
  const touched = () => { for (const k of ["tree", "inbox", "inbox-count", "recent-pages"]) qc.invalidateQueries({ queryKey: [k] }); };

  async function undo(changes: number[]) {
    if (!id) return; setBusy(true);
    try { const r = await api(`/api/agents/${id}`, { method: "POST", json: { action: "undo", changes } }); if (r.failed.length) toast(`${r.failed.length} change${r.failed.length === 1 ? "" : "s"} could not be undone`, { description: r.failed[0].error, tone: "danger" }); else toast(`${r.undone.length} change${r.undone.length === 1 ? "" : "s"} undone`, { tone: "success" }); touched(); }
    catch (e: any) { toast("Undo failed", { description: e?.message, tone: "danger" }); } finally { setBusy(false); refresh(); }
  }
  async function decide(action: "approve" | "reject", changes: number[], confirmDestructive = false) {
    if (!id || !d || !changes.length) return;
    if (action === "approve" && !confirmDestructive) { const risky = changes.filter((i) => d.proposedChanges.find((p) => p.idx === i)?.destructive); if (risky.length) { setPendingBatch(changes); setConfirm(risky); return; } }
    setBusy(true); setConfirm(null);
    try {
      const r = await api(`/api/agents/${id}`, { method: "POST", json: { action, changes, confirmDestructive } });
      if (action === "reject") toast(`${changes.length} proposal${changes.length === 1 ? "" : "s"} rejected — nothing was changed`);
      else { touched(); toast(`${r.applied.length} change${r.applied.length === 1 ? "" : "s"} applied${r.failed.length ? `, ${r.failed.length} failed` : ""}`, { description: r.failed.length ? r.failed[0].error : "The previous state of each item is kept.", tone: r.failed.length ? "danger" : "success", action: r.applied.length ? { label: "Undo", run: () => undo(r.applied) } : undefined }); }
    } catch (e: any) {
      if (e instanceof ApiError && e.code === "confirm_destructive") { setPendingBatch(changes); setConfirm((e.body?.changes as number[]) ?? changes); }
      else toast("The decision was not recorded", { description: e?.message, tone: "danger" });
    } finally { setBusy(false); refresh(); }
  }
  async function cancel() { if (!id) return; setBusy(true); try { await api(`/api/agents/${id}`, { method: "POST", json: { action: "cancel" } }); toast("Run cancelled — nothing was changed"); } catch (e: any) { toast("Cancel failed", { description: e?.message, tone: "danger" }); } finally { setBusy(false); refresh(); } }

  const pending = d?.proposedChanges?.filter((p) => p.status === "proposed" && p.after) ?? []; const steps = d?.toolsInvoked ?? []; const toolSteps = steps.filter((s) => s.tool !== "model" && s.tool !== "context_page");
  const dur = d?.startedAt ? (d.finishedAt ? new Date(d.finishedAt) : new Date()).getTime() - new Date(d.startedAt).getTime() : null;
  return (
    <Dialog open={Boolean(id)} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent title={d ? `${d.agentIcon} ${d.agentName}` : "Agent run"} description={d ? d.outcome ?? (isLive(d.status) ? "Working — you can close this and come back." : undefined) : undefined} className="sm:w-[min(46rem,calc(100vw-2rem))]">
        {isError ? <div role="alert" className="py-6 text-[13.5px]"><p className="text-danger-text">{(error as Error)?.message ?? "Could not load this run."}</p><Button variant="outline" className="mt-3 h-11" onClick={() => refetch()}><RotateCcw />Retry</Button></div>
          : !d ? <div className="grid gap-3 py-2"><Skeleton className="h-6 w-40" /><Skeleton className="h-28" /><Skeleton className="h-28" /></div> : (
          <div className="grid min-w-0 gap-4 pb-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={STATUS_TONE[d.status] ?? "neutral"}>{isLive(d.status) && <Spinner className="mr-1 size-3" />}{STATUS_LABEL[d.status] ?? d.status}</Badge>
              <span className="text-[12.5px] text-fg-muted">{usd(d.costUsd)} · {toolSteps.length} tool call{toolSteps.length === 1 ? "" : "s"}{dur != null ? ` · ${ms(dur)}` : ""}</span>
              {isLive(d.status) && <Button variant="outline" className="ml-auto h-11 sm:h-9" disabled={busy} onClick={cancel}><Square />Cancel run</Button>}
            </div>
            {isLive(d.status) && <p role="status" className="rounded-lg bg-bg-sunk px-3 py-2 text-[13px] text-fg-muted">{d.status === "pending" ? "Queued — waiting for the worker." : "Reading within its scope and preparing proposals. Nothing is changed while it runs."}</p>}
            {d.error && <div role="alert" className="rounded-xl border border-danger/30 bg-danger/5 p-3 text-[13.5px] leading-5 text-danger-text [overflow-wrap:anywhere]">{d.error}</div>}
            {d.result && <section className="min-w-0"><h3 className="mb-1 text-[13px] font-semibold">Summary</h3><div className="chat-md min-w-0 rounded-xl border border-line bg-bg px-3 py-1 text-[14px]"><Markdown text={d.result} /></div></section>}
            {d.proposedChanges.length > 0 && (
              <section className="min-w-0">
                <h3 className="mb-2 text-[13px] font-semibold">Proposals <span className="font-normal text-fg-muted">· {d.proposedChanges.length} · {pending.length} to review</span></h3>
                <div className="grid min-w-0 gap-3">{d.proposedChanges.map((p) => <ProposalCard key={p.idx} p={p} busy={busy} onApprove={() => decide("approve", [p.idx])} onReject={() => decide("reject", [p.idx])} onUndo={() => undo([p.idx])} />)}</div>
              </section>
            )}
            {!isLive(d.status) && d.status !== "failed" && d.proposedChanges.length === 0 && <p className="rounded-lg bg-bg-sunk px-3 py-2 text-[13px] text-fg-muted">This run made no proposal. Nothing was changed.</p>}

            <details className="min-w-0 rounded-xl border border-line bg-bg-sunk/50">
              <summary className="flex min-h-11 cursor-pointer items-center gap-2 px-3 text-[13px] font-semibold"><ShieldCheck className="size-4 text-success" />Execution log<span className="ml-auto text-[12px] font-normal text-fg-muted">{steps.length} steps · {d.documents.length} documents · {d.approvals.length} decisions</span></summary>
              <div className="grid min-w-0 gap-3 border-t border-line px-3 py-3 text-[12.5px] leading-5">
                <div><div className="font-semibold">Scope of this run</div>{d.info ? <ul className="mt-0.5 list-disc pl-5 text-fg-muted">{d.info.reads.map((r) => <li key={r}>May read: {r}</li>)}{d.info.proposes.map((r) => <li key={r}>May propose: {r}</li>)}</ul> : <p className="text-fg-muted">{d.scopes.join(", ") || "—"}</p>}</div>
                <div><div className="font-semibold">Steps (tools invoked)</div>{steps.length ? <ol className="mt-0.5 grid gap-1">{steps.map((s, i) => <li key={i} className="min-w-0 rounded-md bg-bg-elev px-2 py-1"><span className="font-mono text-[12px] font-medium">{s.tool}</span>{s.error ? <span className="text-danger-text"> · {s.error}</span> : null}{s.proposalIdx != null ? <span className="text-accent"> · proposal #{s.proposalIdx + 1}</span> : null}<span className="text-fg-faint">{s.ms != null ? ` · ${ms(s.ms)}` : ""}</span><span className="block text-[11.5px] text-fg-muted [overflow-wrap:anywhere]">{[brief(s.input), brief(s.output)].filter(Boolean).join(" → ") || "—"}</span></li>)}</ol> : <p className="text-fg-muted">{isLive(d.status) ? "Waiting for the worker…" : "No step recorded."}</p>}</div>
                <div><div className="font-semibold">Documents accessed</div>{d.documents.length ? <ul className="mt-1 flex flex-wrap gap-1.5">{d.documents.map((p) => <li key={p.id} className="max-w-full">{p.deletedAt ? <span className="inline-flex min-h-9 max-w-full items-center gap-1 rounded-md border border-line px-2 text-fg-muted"><FileText className="size-3.5 shrink-0" /><span className="truncate">{p.title} (in the trash)</span></span> : <a href={`/p/${p.id}`} className="inline-flex min-h-11 max-w-full items-center gap-1 rounded-md border border-line bg-bg-elev px-2 hover:bg-bg-sunk sm:min-h-8"><FileText className="size-3.5 shrink-0 text-fg-muted" /><span className="truncate">{p.icon ?? ""} {p.title}</span></a>}</li>)}</ul> : <p className="text-fg-muted">None.</p>}</div>
                <div><div className="font-semibold">Approvals</div>{d.approvals.length ? <ul className="mt-0.5 text-fg-muted">{d.approvals.map((a, i) => <li key={i}>#{a.change + 1} {a.approved ? "approved" : "rejected"} · {fmtDate(a.at, { dateStyle: "short", timeStyle: "short" })}</li>)}</ul> : <p className="text-fg-muted">No decision yet.</p>}</div>
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-fg-muted"><dt>Cost</dt><dd className="text-fg">{usd(d.costUsd)} ({d.tokensIn ?? 0} → {d.tokensOut ?? 0} tokens)</dd><dt>Model</dt><dd className="text-fg [overflow-wrap:anywhere]">{d.model ?? "—"}</dd><dt>Started</dt><dd className="text-fg">{d.startedAt ? fmtDate(d.startedAt, { dateStyle: "medium", timeStyle: "short" }) : "not started"}</dd><dt>Finished</dt><dd className="text-fg">{d.finishedAt ? fmtDate(d.finishedAt, { dateStyle: "medium", timeStyle: "short" }) : "—"}</dd><dt>Run id</dt><dd className="font-mono text-[11.5px] text-fg [overflow-wrap:anywhere]">{d.id}</dd></dl>
                <p className="text-fg-muted">The log lists tools, document ids, counts and costs — never the text of your notes. No shell, no network; only proposals you approve are written.</p>
              </div>
            </details>

            {pending.length > 0 && (
              <div className="sticky bottom-0 z-10 -mx-4 -mb-1 flex gap-2 border-t border-line bg-bg-elev px-4 pb-1 pt-2 sm:-mx-5 sm:px-5">
                <Button variant="outline" className="h-11 flex-1" disabled={busy} onClick={() => decide("reject", pending.map((p) => p.idx))}><X />Reject all</Button>
                <Button className="h-11 flex-1" disabled={busy} onClick={() => decide("approve", pending.map((p) => p.idx))}>{busy ? <Spinner className="size-4" /> : <CheckCheck />}Approve all ({pending.length})</Button>
              </div>
            )}
          </div>
        )}
      </SheetContent>
      <Dialog open={confirm !== null} onOpenChange={(o) => { if (!o) setConfirm(null); }}>
        <DialogContent title="Move to the trash?" description={confirm ? `${confirm.length} of the changes you are approving move${confirm.length === 1 ? "s a page" : " pages"} to the trash. They can be restored from the trash, or with Undo here.` : undefined}>
          {confirm && d && <ul className="mb-4 grid gap-1 text-[13.5px]">{confirm.map((i) => <li key={i} className="flex items-start gap-2 [overflow-wrap:anywhere]"><Trash2 className="mt-0.5 size-4 shrink-0 text-danger" />{d.proposedChanges.find((p) => p.idx === i)?.title ?? `Proposal #${i + 1}`}</li>)}</ul>}
          <div className="grid gap-2 sm:grid-cols-2"><Button variant="outline" className="h-11" onClick={() => setConfirm(null)}>Keep them</Button><Button variant="danger" className="h-11" disabled={busy} onClick={() => decide("approve", pendingBatch, true)}><Trash2 />Yes, apply</Button></div>
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}
