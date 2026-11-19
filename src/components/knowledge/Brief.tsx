"use client";
/**
 * file: src/components/knowledge/Brief.tsx
 * description: Smart Daily Brief — the new Home (`/`) on GET /api/brief: tasks overdue / due today / due this week, recent notes,
 *   active projects, unfiled captures, link suggestions (model output: marked AI, accepted or rejected by the user), documents to
 *   revisit, and the knowledge-health chip. No model runs to build it. The optional AI summary is requested only by a click
 *   (POST /api/brief/summary: one short call over titles and counts, never note contents) and is shown marked AI with its model
 *   and date. Every dashboard widget of 2.x stays reachable right below (same component, same customisation).
 * author: Simon-Pierre Boucher — contact@spboucher.ai
 */
import * as React from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Sparkles, CalendarClock, FileText, FolderKanban, Inbox, Link2, BookOpenCheck, ArrowRight, Check, X, TriangleAlert } from "lucide-react";
import { api } from "@/lib/client/api";
import { cn, timeAgo } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton, Spinner } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";
import { Markdown } from "@/components/markdown";
import { REL_LABEL, dueLabel } from "@/lib/client/knowledge";
import { Dashboard } from "@/components/dashboard/Dashboard";
import { HealthChip } from "./Health";
import { AIBadge, LoadError, fmtDateTime } from "./shared";

interface BriefTask { id: string; title: string; status: string; priority: string | null; dueAt: string; pageId: string | null; pageTitle: string | null; blockId: string | null }
interface BriefData {
  generatedAt: string; date: string; timeZone: string;
  recentNotes: { id: string; title: string; icon: string | null; section: string; type: string; updatedAt: string; wordCount: number }[];
  activeProjects: { id: string; title: string; icon: string | null; lastActivityAt: string; pages: number; openTasks: number }[];
  tasks: { overdue: BriefTask[]; dueToday: BriefTask[]; dueSoon: BriefTask[] };
  unfiledCaptures: { count: number; items: { id: string; title: string; icon: string | null; kind: string | null; inboxAt: string }[] };
  linkSuggestions: { count: number; items: { id: string; kind: string; relType: string; fromId: string; toId: string; fromTitle: string; toTitle: string; confidence: number | null; rationale: string | null; model: string | null; ai: true }[] };
  toRevisit: { id: string; title: string; icon: string | null; degree: number; lastTouchedAt: string }[];
  aiSummary: { ai: true; text: string; model: string; at: string } | null;
}
const greeting = (d: Date) => { const h = d.getHours(); return h < 5 ? "Good night" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening"; };
const tz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return ""; } };

function Card({ title, icon, count, action, children, testId, tone }: { title: string; icon: React.ReactNode; count?: number; action?: React.ReactNode; children: React.ReactNode; testId: string; tone?: "ai" }) {
  return <section aria-label={title} data-testid={testId} className={cn("flex min-w-0 flex-col", tone === "ai" ? "ai-surface" : "surface-card")}><header className="flex items-center gap-2 px-3.5 pb-1 pt-3"><span className={cn("[&_svg]:size-4", tone === "ai" ? "text-ai" : "text-fg-muted")} aria-hidden>{icon}</span><h2 className="min-w-0 flex-1 truncate text-ui font-semibold">{title}</h2>{count != null && <span className="rounded-pill bg-bg-sunk px-1.5 text-micro tabular-nums text-fg-muted">{count}</span>}{action}</header><div className="min-w-0 flex-1 px-2 pb-2">{children}</div></section>;
}
const rowCls = "flex min-h-11 items-center gap-2 rounded-control px-1.5 text-ui hover:bg-bg-hover sm:min-h-8";
const None = ({ children }: { children: React.ReactNode }) => <p className="px-1.5 py-2 text-ui leading-5 text-fg-muted">{children}</p>;

export function Brief({ displayName }: { displayName: string }) {
  const qc = useQueryClient(); const zone = React.useMemo(tz, []);
  const q = useQuery({ queryKey: ["brief", zone], queryFn: () => api<BriefData>(`/api/brief${zone ? `?tz=${encodeURIComponent(zone)}` : ""}`), staleTime: 20_000 });
  const [label, setLabel] = React.useState({ date: "", hello: "Hello" }); React.useEffect(() => { const d = new Date(); setLabel({ date: new Intl.DateTimeFormat("en-CA", { weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(d), hello: greeting(d) }); }, []);
  const summary = useMutation({ mutationFn: () => api<{ ai: true; text: string; model: string; at: string; costUsd: number | null }>("/api/brief/summary", { method: "POST", json: zone ? { tz: zone } : {} }), onSuccess: () => qc.invalidateQueries({ queryKey: ["brief"] }), onError: (e: any) => toast("The summary could not be written", { description: e?.message, tone: "danger" }) });
  const decide = useMutation({ mutationFn: ({ id, status }: { id: string; status: "accepted" | "rejected" }) => api(`/api/graph/relations/${id}`, { method: "PATCH", json: { status } }), onSuccess: (_d, v) => { for (const k of ["brief", "kgraph", "graph-suggestions"]) qc.invalidateQueries({ queryKey: [k] }); toast(v.status === "accepted" ? "Link accepted" : "Suggestion rejected", { tone: v.status === "accepted" ? "success" : "neutral" }); }, onError: (e: any) => toast("Could not save the decision", { description: e?.message, tone: "danger" }) });
  const b = q.data; const s = summary.data ?? b?.aiSummary ?? null; const dueCount = b ? b.tasks.overdue.length + b.tasks.dueToday.length : 0;
  const Task = ({ t, overdue }: { t: BriefTask; overdue?: boolean }) => <li><Link href={t.pageId ? `/p/${t.pageId}${t.blockId ? `#block-${t.blockId}` : ""}` : "/tasks"} className={rowCls}><span className={cn("size-1.5 shrink-0 rounded-full", overdue ? "bg-danger" : "bg-accent")} aria-hidden /><span className="min-w-0 flex-1 truncate">{t.title}</span><span className={cn("shrink-0 text-micro", overdue ? "font-medium text-danger-text" : "text-fg-muted")}>{dueLabel(t.dueAt, new Date(), zone || undefined)}</span></Link></li>;
  return (
    <div className="mx-auto w-full max-w-6xl px-4 pt-6 sm:px-8 sm:pt-10" data-testid="brief">
      <div className="mb-5 flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1"><p className="mb-1 text-micro font-medium uppercase tracking-[0.08em] text-fg-muted">{label.date || " "}</p><h1 className="font-serif text-[1.75rem] font-semibold leading-tight tracking-[-0.018em] sm:text-h1">{label.hello}, {displayName.split(" ")[0]}</h1>
          {b && <p className="mt-1 text-ui text-fg-muted" data-testid="brief-lede">{dueCount ? `${b.tasks.overdue.length} overdue · ${b.tasks.dueToday.length} due today` : "Nothing is due today"} · {b.unfiledCaptures.count} capture{b.unfiledCaptures.count === 1 ? "" : "s"} to file · {b.linkSuggestions.count} link suggestion{b.linkSuggestions.count === 1 ? "" : "s"}</p>}</div>
        <HealthChip />
      </div>
      {q.isLoading ? <div role="status" aria-label="Preparing your brief" className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-40 rounded-card" />)}</div> : q.isError || !b ? <LoadError what="your brief" error={q.error} onRetry={() => q.refetch()} /> : (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-2 lg:grid-cols-3">
          <div className="md:col-span-2 lg:col-span-3">
            <Card title="Summary of the day" icon={<Sparkles />} testId="brief-summary" tone="ai" action={s ? <AIBadge model={s.model} at={s.at} /> : <AIBadge />}>
              {s ? <div className="px-1.5" data-testid="brief-summary-text"><div className="chat-md text-ui leading-6"><Markdown text={s.text} /></div><p className="mt-1.5 flex flex-wrap items-center gap-2 text-micro text-fg-muted">Written by {s.model} · {fmtDateTime(s.at)} · from titles and counts only<Button size="xs" variant="ghost" className="max-md:h-11" disabled={summary.isPending} onClick={() => summary.mutate()}>{summary.isPending && <Spinner className="size-3" />}Write it again</Button></p></div>
                : <div className="flex flex-wrap items-center gap-3 px-1.5 py-1"><p className="min-w-0 flex-1 text-ui leading-5 text-fg-muted">The brief below is computed without any model. If you want it in a few sentences, a model can write a summary from the titles and counts you see here (never the contents of your notes). Nothing is sent until you ask.</p><Button variant="ai" size="sm" className="max-md:h-11" disabled={summary.isPending} onClick={() => summary.mutate()} data-testid="brief-summarise">{summary.isPending ? <Spinner className="size-3.5 border-white/40 border-t-white" /> : <Sparkles />}Summarise my day</Button></div>}
            </Card>
          </div>
          <Card title="Tasks" icon={<CalendarClock />} count={b.tasks.overdue.length + b.tasks.dueToday.length + b.tasks.dueSoon.length} testId="brief-tasks" action={<Link href="/tasks" className="text-micro font-medium text-accent hover:underline">All tasks</Link>}>
            {b.tasks.overdue.length + b.tasks.dueToday.length + b.tasks.dueSoon.length === 0 ? <None>No task is due in the next 7 days.</None> : <>
              {b.tasks.overdue.length > 0 && <><div className="flex items-center gap-1 px-1.5 pt-1 text-micro font-semibold uppercase tracking-[0.06em] text-danger-text"><TriangleAlert className="size-3" />Overdue</div><ul data-testid="brief-overdue">{b.tasks.overdue.slice(0, 6).map((t) => <Task key={t.id} t={t} overdue />)}</ul></>}
              {b.tasks.dueToday.length > 0 && <><div className="px-1.5 pt-1 text-micro font-semibold uppercase tracking-[0.06em] text-fg-muted">Today</div><ul data-testid="brief-today">{b.tasks.dueToday.slice(0, 6).map((t) => <Task key={t.id} t={t} />)}</ul></>}
              {b.tasks.dueSoon.length > 0 && <><div className="px-1.5 pt-1 text-micro font-semibold uppercase tracking-[0.06em] text-fg-muted">This week</div><ul>{b.tasks.dueSoon.slice(0, 5).map((t) => <Task key={t.id} t={t} />)}</ul></>}
            </>}
          </Card>
          <Card title="Recent notes" icon={<FileText />} count={b.recentNotes.length} testId="brief-recent">
            {b.recentNotes.length ? <ul>{b.recentNotes.map((p) => <li key={p.id}><Link href={`/p/${p.id}`} className={rowCls}><span className="w-5 shrink-0 text-center">{p.icon ?? "📄"}</span><span className="min-w-0 flex-1 truncate">{p.title || "Untitled"}</span><span className="shrink-0 text-micro text-fg-muted">{timeAgo(p.updatedAt)}</span></Link></li>)}</ul> : <None>No note yet. Press ⌘⇧N to write the first one.</None>}
          </Card>
          <Card title="Active projects" icon={<FolderKanban />} count={b.activeProjects.length} testId="brief-projects">
            {b.activeProjects.length ? <ul>{b.activeProjects.map((p) => <li key={p.id}><Link href={`/p/${p.id}`} className={rowCls}><span className="w-5 shrink-0 text-center">{p.icon ?? "📁"}</span><span className="min-w-0 flex-1 truncate">{p.title || "Untitled"}</span><span className="shrink-0 text-micro text-fg-muted">{p.pages} page{p.pages === 1 ? "" : "s"} · {p.openTasks} open</span></Link></li>)}</ul> : <None>No project changed in the last 14 days.</None>}
          </Card>
          <Card title="Captures to file" icon={<Inbox />} count={b.unfiledCaptures.count} testId="brief-captures" action={b.unfiledCaptures.count > 0 ? <Link href="/inbox" aria-label="Sort the captures" className="flex items-center gap-0.5 text-micro font-medium text-accent hover:underline">Sort them <ArrowRight className="size-3" /></Link> : undefined}>
            {b.unfiledCaptures.items.length ? <ul>{b.unfiledCaptures.items.slice(0, 6).map((c) => <li key={c.id}><Link href={`/p/${c.id}`} className={rowCls}><span className="w-5 shrink-0 text-center">{c.icon ?? "📥"}</span><span className="min-w-0 flex-1 truncate">{c.title || "Untitled"}</span><span className="shrink-0 text-micro text-fg-muted">{timeAgo(c.inboxAt)}</span></Link></li>)}</ul> : <None>The inbox is empty.</None>}
          </Card>
          <Card title="Link suggestions" icon={<Link2 />} count={b.linkSuggestions.count} testId="brief-suggestions" action={<AIBadge />}>
            {b.linkSuggestions.items.length ? <ul className="space-y-1.5">{b.linkSuggestions.items.map((k) => <li key={k.id} className="ai-surface p-2" data-suggestion={k.id}>
              <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-ui"><Link href={`/p/${k.fromId}`} className="min-w-0 max-w-full truncate font-medium hover:underline">{k.fromTitle || "Untitled"}</Link><span className="text-micro text-ai">{k.kind === "relation" ? REL_LABEL[k.relType] ?? k.relType : "↔"}</span><Link href={`/p/${k.toId}`} className="min-w-0 max-w-full truncate font-medium hover:underline">{k.toTitle || "Untitled"}</Link></div>
              {k.rationale && <p className="mt-0.5 line-clamp-2 text-micro leading-4 text-fg-muted">{k.rationale}</p>}
              <div className="mt-1.5 flex flex-wrap items-center gap-1"><Button size="xs" variant="outline" className="max-md:h-11 max-md:px-3" disabled={decide.isPending} onClick={() => decide.mutate({ id: k.id, status: "accepted" })}><Check /> Accept</Button><Button size="xs" variant="ghost" className="max-md:h-11 max-md:px-3" disabled={decide.isPending} onClick={() => decide.mutate({ id: k.id, status: "rejected" })}><X /> Reject</Button><span className="ml-auto text-micro text-fg-muted">{k.model ?? "AI"}{k.confidence != null ? ` · ${Math.round(k.confidence * 100)} %` : ""}</span></div>
            </li>)}</ul> : <None>No suggestion is waiting. They appear after an AI analysis you start yourself (Graph → Insights).</None>}
          </Card>
          <Card title="To revisit" icon={<BookOpenCheck />} count={b.toRevisit.length} testId="brief-revisit">
            {b.toRevisit.length ? <ul>{b.toRevisit.map((p) => <li key={p.id}><Link href={`/p/${p.id}`} className={rowCls}><span className="w-5 shrink-0 text-center">{p.icon ?? "📄"}</span><span className="min-w-0 flex-1 truncate">{p.title || "Untitled"}</span><span className="shrink-0 text-micro text-fg-muted">{p.degree} links · {timeAgo(p.lastTouchedAt)}</span></Link></li>)}</ul> : <None>No well-connected page has been left untouched for 30 days.</None>}
          </Card>
        </div>)}
    </div>
  );
}
/** Home = the brief, then the customisable dashboard of 2.x with all its widgets. */
export function Home({ displayName }: { displayName: string }) {
  return <><Brief displayName={displayName} /><Dashboard displayName={displayName} embedded /></>;
}
