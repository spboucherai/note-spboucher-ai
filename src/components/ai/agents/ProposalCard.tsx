"use client";
import { useState } from "react";
import { Check, ChevronDown, X, Link2, ListTodo, FileEdit, Tag, AlertTriangle } from "lucide-react";
import { Markdown } from "@/components/markdown";
import { Badge } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface ProposalView { idx: number; tool: string; kind: "page_edit" | "task" | "link" | "property"; scope: string; scopeGranted: boolean; rationale: string; status: "proposed" | "approved" | "rejected" | "applied" | "failed"; payload: any; error?: string; result?: any; decidedAt?: string; appliedAt?: string }
const ICON = { page_edit: FileEdit, task: ListTodo, link: Link2, property: Tag } as const;
const TONE: Record<ProposalView["status"], "neutral" | "accent" | "success" | "danger" | "warning"> = { proposed: "accent", approved: "success", applied: "success", rejected: "neutral", failed: "danger" };
const title = (p: ProposalView) => p.kind === "page_edit" ? `${p.payload.mode === "append" ? "Append to" : "Replace body of"} “${p.payload.pageTitle}”` : p.kind === "task" ? `New task: ${p.payload.title}` : p.kind === "link" ? `Link “${p.payload.fromTitle}” → “${p.payload.toTitle}”` : `Set ${p.payload.key} on “${p.payload.pageTitle}”`;

export function ProposalCard({ p, busy, onApprove, onReject }: { p: ProposalView; busy: boolean; onApprove: () => void; onReject: () => void }) {
  const [showCurrent, setShowCurrent] = useState(false); const Icon = ICON[p.kind];
  return (
    <div className={cn("rounded-xl border bg-bg-elev shadow-card", p.status === "proposed" ? "border-accent/40" : "border-line")}>
      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
        <Icon className="size-4 text-fg-muted" /><div className="min-w-0 flex-1 text-[13px] font-medium">#{p.idx + 1} · {title(p)}</div>
        <Badge tone={TONE[p.status]}>{p.status}</Badge>{!p.scopeGranted && p.status === "proposed" && <span title={`Scope ${p.scope} was not granted for this run — approving applies it under your explicit consent.`} className="inline-flex items-center gap-1 text-[11px] text-warning"><AlertTriangle className="size-3.5" />{p.scope} not granted</span>}
      </div>
      <div className="border-t border-line px-3 py-2 text-[12.5px]">
        <p className="text-fg-muted"><span className="font-medium text-fg">Why:</span> {p.rationale}</p>
        {p.kind === "page_edit" && <div className="mt-2 space-y-1.5">
          {p.payload.mode === "replace" && <div><button type="button" onClick={() => setShowCurrent((v) => !v)} className="inline-flex items-center gap-1 text-[12px] text-fg-muted hover:text-fg"><ChevronDown className={cn("size-3.5 transition-transform", showCurrent && "rotate-180")} />Current content (will be replaced)</button>{showCurrent && <div className="mt-1 max-h-64 overflow-y-auto rounded-md border-l-2 border-danger/50 bg-danger/5 px-3 py-1 text-[13px] line-through decoration-danger/40"><Markdown text={p.payload.currentMarkdown || "(empty)"} /></div>}</div>}
          <div className="max-h-96 overflow-y-auto rounded-md border-l-2 border-success/60 bg-success/5 px-3 py-1 text-[13px]"><div className="mb-0.5 text-[10.5px] font-medium uppercase tracking-wide text-success">+ {p.payload.mode === "append" ? "appended" : "new body"}</div><Markdown text={p.payload.markdown} /></div>
        </div>}
        {p.kind === "task" && <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5"><dt className="text-fg-muted">Priority</dt><dd>{p.payload.priority}</dd><dt className="text-fg-muted">Due</dt><dd>{p.payload.dueAt ? p.payload.dueAt.slice(0, 10) : "—"}</dd><dt className="text-fg-muted">Page</dt><dd>{p.payload.pageTitle ? <a className="text-accent hover:underline" href={`/p/${p.payload.pageId}`}>{p.payload.pageTitle}</a> : "—"}</dd>{p.payload.project && <><dt className="text-fg-muted">Project</dt><dd>{p.payload.project}</dd></>}</dl>}
        {p.kind === "link" && <div className="mt-2 flex flex-wrap items-center gap-1.5"><a className="rounded-md border border-line px-1.5 py-0.5 text-accent hover:underline" href={`/p/${p.payload.fromPageId}`}>{p.payload.fromTitle}</a><span className="text-fg-muted">—{p.payload.relation}→</span><a className="rounded-md border border-line px-1.5 py-0.5 text-accent hover:underline" href={`/p/${p.payload.toPageId}`}>{p.payload.toTitle}</a>{p.payload.confidence != null && <span className="text-[11px] text-fg-muted">confidence {(p.payload.confidence * 100).toFixed(0)}%</span>}</div>}
        {p.kind === "property" && <div className="mt-2 font-mono text-[12px]"><span className="text-fg-muted">{p.payload.key}:</span> <span className="rounded bg-danger/10 px-1 line-through">{JSON.stringify(p.payload.previous)}</span> → <span className="rounded bg-success/10 px-1">{JSON.stringify(p.payload.value)}</span> <a className="ml-2 text-accent hover:underline" href={`/p/${p.payload.pageId}`}>{p.payload.pageTitle}</a></div>}
        {p.error && <div className="mt-2 text-[12px] text-danger">Failed: {p.error}</div>}
        {p.status === "applied" && p.result && <div className="mt-2 text-[11.5px] text-fg-muted">Applied {p.appliedAt ? new Date(p.appliedAt).toLocaleString() : ""} · {JSON.stringify(p.result)}</div>}
      </div>
      {p.status === "proposed" && <div className="flex justify-end gap-1.5 border-t border-line px-3 py-2"><Button size="sm" variant="ghost" disabled={busy} onClick={onReject}><X />Reject</Button><Button size="sm" disabled={busy} onClick={onApprove}><Check />Approve & apply</Button></div>}
    </div>
  );
}
