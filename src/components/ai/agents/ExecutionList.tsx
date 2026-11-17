"use client";
import { ChevronRight } from "lucide-react";
import { Badge, Spinner } from "@/components/ui/primitives";
import { timeAgo } from "@/lib/utils";
import { usd } from "@/components/ai/models/format";

export const STATUS_TONE: Record<string, "neutral" | "accent" | "ai" | "success" | "warning" | "danger"> = { pending: "neutral", running: "ai", awaiting_approval: "warning", approved: "success", completed: "success", rejected: "neutral", failed: "danger" };
export const STATUS_LABEL: Record<string, string> = { pending: "queued", running: "running", awaiting_approval: "to review", approved: "reviewed", completed: "done", rejected: "rejected", failed: "failed" };
export const isLive = (s: string | undefined) => s === "pending" || s === "running";
export interface ExecSummary { id: string; agent: string; model: string | null; status: string; outcome: string | null; error: string | null; costUsd: number | null; createdAt: string; startedAt: string | null; finishedAt: string | null; proposals: number; pendingProposals: number; toolCalls: number }

/** Past and current runs as a list of large rows (no table: nothing to scroll sideways on a phone). */
export function ExecutionList({ items, agents, onOpen }: { items: ExecSummary[]; agents: Record<string, { name: string; icon: string }>; onOpen: (id: string) => void }) {
  if (!items.length) return <div className="rounded-xl border border-dashed border-line-strong px-4 py-8 text-center text-[13px] text-fg-muted">No run yet. Choose a task above: you will see its scope and cost limit before anything starts.</div>;
  return (
    <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-bg-elev shadow-card">
      {items.map((e) => { const a = agents[e.agent]; return (
        <li key={e.id}><button type="button" onClick={() => onOpen(e.id)} className="flex min-h-16 w-full min-w-0 items-center gap-3 px-3 py-2 text-left hover:bg-bg-sunk/60">
          <span className="text-xl leading-none" aria-hidden>{a?.icon ?? "🤖"}</span>
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1"><span className="min-w-0 truncate text-[14px] font-medium">{a?.name ?? e.agent}</span><Badge tone={STATUS_TONE[e.status] ?? "neutral"}>{isLive(e.status) && <Spinner className="mr-1 size-3" />}{STATUS_LABEL[e.status] ?? e.status}</Badge>{e.pendingProposals > 0 && <Badge tone="warning">{e.pendingProposals} to review</Badge>}</span>
            <span className="mt-0.5 block text-[12px] leading-4 text-fg-muted [overflow-wrap:anywhere]">{e.status === "failed" ? e.error ?? "failed" : e.outcome ?? (isLive(e.status) ? "Working…" : "")}</span>
            <span className="mt-0.5 block text-[11.5px] text-fg-faint">{timeAgo(e.createdAt)} · {usd(e.costUsd)}{e.model ? ` · ${e.model}` : ""}</span>
          </span>
          <ChevronRight className="size-4 shrink-0 text-fg-faint" />
        </button></li>); })}
    </ul>
  );
}
