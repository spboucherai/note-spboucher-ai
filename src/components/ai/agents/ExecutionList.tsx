"use client";
import { Badge, Spinner } from "@/components/ui/primitives";
import { cn, timeAgo } from "@/lib/utils";
import { ms, usd } from "@/components/ai/models/format";
import { STATUS_TONE, isLive } from "./ExecutionDrawer";
export interface ExecSummary { id: string; agent: string; task: string; model: string | null; status: string; scopes: string[]; outcome: string | null; error: string | null; costUsd: number | null; createdAt: string; startedAt: string | null; finishedAt: string | null; proposals: number; pendingProposals: number; toolCalls: number }
export function ExecutionList({ items, agents, onOpen }: { items: ExecSummary[]; agents: Record<string, { name: string; icon: string }>; onOpen: (id: string) => void }) {
  if (!items.length) return <div className="rounded-xl border border-dashed border-line-strong p-8 text-center text-[13px] text-fg-muted">No executions yet. Pick an agent, describe a task and run it.</div>;
  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-bg-elev shadow-card"><table className="w-full min-w-[720px] text-[12.5px]">
      <thead><tr className="text-left text-[10.5px] uppercase tracking-wide text-fg-muted">{["Status", "Agent", "Task", "Model", "Tools", "Proposals", "Cost", "Duration", "When"].map((h) => <th key={h} className="px-2 py-1.5 font-medium">{h}</th>)}</tr></thead>
      <tbody>{items.map((e) => { const a = agents[e.agent]; const dur = e.startedAt ? ((e.finishedAt ? new Date(e.finishedAt) : new Date()).getTime() - new Date(e.startedAt).getTime()) : null; return (
        <tr key={e.id} onClick={() => onOpen(e.id)} className="cursor-pointer border-t border-line hover:bg-bg-sunk/60">
          <td className="px-2 py-1.5"><Badge tone={STATUS_TONE[e.status] ?? "neutral"}>{isLive(e.status) && <Spinner className="mr-1 size-3" />}{e.status.replace("_", " ")}</Badge></td>
          <td className="whitespace-nowrap px-2 py-1.5">{a?.icon} {a?.name ?? e.agent}</td>
          <td className="max-w-[320px] truncate px-2 py-1.5" title={e.task}>{e.task}</td>
          <td className="px-2 py-1.5 font-mono text-[11.5px] text-fg-muted">{e.model ?? "—"}</td>
          <td className="px-2 py-1.5 tabular-nums">{e.toolCalls}</td>
          <td className="px-2 py-1.5 tabular-nums">{e.proposals}{e.pendingProposals > 0 && <span className={cn("ml-1 rounded bg-warning/20 px-1 text-[10.5px] text-warning")}>{e.pendingProposals} pending</span>}</td>
          <td className="px-2 py-1.5 tabular-nums">{usd(e.costUsd)}</td><td className="px-2 py-1.5 tabular-nums">{dur != null ? ms(dur) : "—"}</td><td className="whitespace-nowrap px-2 py-1.5 text-fg-muted">{timeAgo(e.createdAt)}</td>
        </tr>); })}</tbody>
    </table></div>
  );
}
