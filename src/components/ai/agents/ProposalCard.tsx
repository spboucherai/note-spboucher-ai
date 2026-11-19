"use client";
import { Check, X, ListTodo, FileEdit, FilePlus2, Tags, Inbox, Trash2, Undo2, ArrowDown, ExternalLink } from "lucide-react";
import { Markdown } from "@/components/markdown";
import { Badge } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Preview, Proposal } from "@/lib/agents/types";

/** Stored proposals are rendered defensively: runs recorded before v2 lack the preview fields. */
export type ProposalView = Partial<Proposal> & Pick<Proposal, "idx" | "status">;
const ICON: Record<string, typeof Check> = { inbox_triage: Inbox, tags: Tags, new_page: FilePlus2, page_edit: FileEdit, task: ListTodo };
const KIND: Record<string, string> = { inbox_triage: "Inbox item", tags: "Tags", new_page: "New page", page_edit: "Addition to a page", task: "New task" };
const TONE: Record<string, "neutral" | "accent" | "success" | "danger" | "warning"> = { proposed: "accent", applied: "success", rejected: "neutral", failed: "danger", undone: "neutral" };

function Side({ p, tone }: { p: Preview | null | undefined; tone: "before" | "after" }) {
  if (!p) return null;
  return (
    <div className={cn("min-w-0 rounded-lg border-l-[3px] px-3 py-2", tone === "before" ? "border-danger/50 bg-danger/5" : "border-success/60 bg-success/5")}>
      <div className={cn("text-[11px] font-semibold uppercase tracking-wide", tone === "before" ? "text-danger-text" : "text-success-text")}>{tone === "before" ? "Before" : "After"} · {p.label}</div>
      {(p.lines ?? []).map((l, i) => <p key={i} className="mt-0.5 text-[13.5px] leading-5 [overflow-wrap:anywhere]">{l}</p>)}
      {p.markdown && <div className="chat-md mt-1 max-h-56 min-w-0 overflow-y-auto rounded-md bg-bg-elev/70 px-2 py-1 text-[13.5px]"><Markdown text={p.markdown} /></div>}
    </div>
  );
}

/** One proposed change: what it is, why, the state before stacked above the state after, and its own approve / reject (or undo). */
export function ProposalCard({ p, busy, onApprove, onReject, onUndo }: { p: ProposalView; busy: boolean; onApprove: () => void; onReject: () => void; onUndo: () => void }) {
  const Icon = ICON[p.kind ?? ""] ?? FileEdit; const supported = Boolean(p.after);
  return (
    <article aria-label={`Proposal ${p.idx + 1}`} className={cn("min-w-0 rounded-xl border bg-bg-elev shadow-card", p.status === "proposed" ? (p.destructive ? "border-danger/50" : "border-accent/40") : "border-line")}>
      <header className="flex min-w-0 items-start gap-2 px-3 pt-3">
        <Icon className="mt-0.5 size-4 shrink-0 text-fg-muted" />
        <div className="min-w-0 flex-1"><div className="text-[11.5px] text-fg-muted">#{p.idx + 1} · {KIND[p.kind ?? ""] ?? "Change"}</div><h4 className="text-[14.5px] font-semibold leading-5 [overflow-wrap:anywhere]">{p.title ?? "Proposal"}</h4></div>
        <Badge tone={TONE[p.status] ?? "neutral"}>{p.status === "proposed" ? "to review" : p.status}</Badge>
      </header>
      <div className="grid min-w-0 gap-2 px-3 pb-3 pt-2">
        {p.destructive && <p className="flex items-center gap-1.5 text-[12.5px] font-medium text-danger-text"><Trash2 className="size-4 shrink-0" />Moves the page to the trash — asks for a second confirmation.</p>}
        {p.rationale && <p className="text-[13px] leading-5 text-fg-muted"><span className="font-medium text-fg">Why: </span>{p.rationale}</p>}
        {supported ? <><Side p={p.before} tone="before" />{p.before && <ArrowDown aria-hidden className="mx-auto size-4 text-fg-faint" />}<Side p={p.after} tone="after" /></> : <p className="text-[13px] text-fg-muted">This proposal comes from an older version and cannot be applied.</p>}
        {p.pageId && <a href={`/p/${p.pageId}`} className="inline-flex min-h-11 items-center gap-1.5 self-start text-[13px] font-medium text-accent sm:min-h-0"><ExternalLink className="size-3.5" />Open the page concerned</a>}
        {p.error && <p role="alert" className="text-[13px] text-danger-text [overflow-wrap:anywhere]">Not applied: {p.error}</p>}
        {p.status === "applied" && <div className="flex flex-wrap items-center gap-2"><span className="text-[12.5px] text-fg-muted">Applied{p.appliedAt ? ` ${new Date(p.appliedAt).toLocaleString()}` : ""}. The previous state is kept.</span><Button variant="outline" className="ml-auto h-11 sm:h-9" disabled={busy} onClick={onUndo}><Undo2 />Undo</Button></div>}
        {p.status === "undone" && <p className="text-[12.5px] text-fg-muted">Undone{p.undoneAt ? ` ${new Date(p.undoneAt).toLocaleString()}` : ""}: the previous state was restored.</p>}
        {p.status === "proposed" && supported && <div className="grid grid-cols-2 gap-2"><Button variant="outline" className="h-11 sm:h-9" disabled={busy} onClick={onReject}><X />Reject</Button><Button variant={p.destructive ? "danger" : "default"} className="h-11 sm:h-9" disabled={busy} onClick={onApprove}><Check />{p.destructive ? "Approve…" : "Approve"}</Button></div>}
      </div>
    </article>
  );
}
