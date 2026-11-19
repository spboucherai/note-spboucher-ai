"use client";
/**
 * file: src/components/knowledge/Timeline.tsx
 * description: Knowledge Timeline (`/timeline`) on GET /api/events — the journal grouped by day, filtered by kind family, page or
 *   project, paged with the server cursor (infinite scroll + an explicit "Load more"). Events the server back-filled (a creation
 *   taken from the creation date, a version taken from the old history) are visibly marked "reconstructed". `EventList` is the same
 *   list in compact form for the per-page timeline of the right panel.
 * author: Simon-Pierre Boucher — contact@spboucher.ai
 */
import * as React from "react";
import Link from "next/link";
import { useInfiniteQuery } from "@tanstack/react-query";
import { History, FileText, GitBranch, CheckSquare, Inbox, BookMarked, Tag, Sparkles, Gavel, Shapes, Link2, X, Clock, FolderKanban } from "lucide-react";
import { api } from "@/lib/client/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Empty, Skeleton, Spinner } from "@/components/ui/primitives";
import { EVENT_FAMILIES, eventDetail, eventVerb, eventsQuery, groupEventsByDay, isReconstructed, type EventFilter, type KEvent } from "@/lib/client/knowledge";
import { AIBadge, LoadError, PagePicker, ScreenHeader, fmtTime, pageGlyph, useTree } from "./shared";

const ICON: Record<string, React.ReactNode> = { page: <FileText />, version: <GitBranch />, links: <Link2 />, task: <CheckSquare />, capture: <Inbox />, reference: <BookMarked />, tag: <Tag />, ai: <Sparkles />, decision: <Gavel />, canvas: <Shapes /> };
const familyOf = (kind: string) => (kind === "page.version" ? "version" : kind.startsWith("page.") ? "page" : kind.startsWith("link.") || kind.startsWith("relation.") ? "links" : kind.startsWith("task.") ? "task" : kind.startsWith("capture.") ? "capture" : kind.startsWith("reference.") || kind.startsWith("attachment.") ? "reference" : kind.startsWith("tag.") ? "tag" : kind === "ai.applied" || kind === "agent.applied" ? "ai" : kind === "decision.recorded" ? "decision" : "canvas");

function EventRow({ e, compact, showPage }: { e: KEvent; compact?: boolean; showPage: boolean }) {
  const fam = familyOf(e.kind); const detail = eventDetail(e); const rec = isReconstructed(e);
  const subject = e.kind === "decision.recorded" ? e.summary : e.pageTitle ?? e.summary;
  return (
    <li className="flex gap-2.5 py-1.5" data-event={e.kind} data-reconstructed={rec ? "1" : "0"}>
      <span className={cn("mt-0.5 grid size-6 shrink-0 place-items-center rounded-control [&_svg]:size-3.5", fam === "ai" ? "bg-ai-soft text-ai" : "bg-bg-sunk text-fg-muted")} aria-hidden>{ICON[fam]}</span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-ui leading-5">
          <span className="font-medium">{eventVerb(e.kind)}</span>
          {showPage && e.pageId && e.pageTitle != null ? <Link href={`/p/${e.pageId}`} className="min-w-0 max-w-full truncate text-fg hover:underline">{e.pageIcon ? `${e.pageIcon} ` : ""}{e.pageTitle || "Untitled"}</Link> : showPage && subject ? <span className="min-w-0 max-w-full truncate text-fg-muted">{subject}</span> : null}
          {rec && <span className="rounded-chip border border-dashed border-line-strong px-1 text-micro font-medium text-fg-muted" title="Not recorded live: rebuilt from the creation date or from the existing version history." data-testid="reconstructed">reconstructed</span>}
          {e.actor === "ai" ? <AIBadge /> : e.actor === "agent" ? <AIBadge label="Agent" /> : null}
        </div>
        {(detail || e.kind === "decision.recorded") && <p className="text-micro leading-4 text-fg-muted [overflow-wrap:anywhere]">{e.kind === "decision.recorded" && !showPage ? e.summary : detail}</p>}
        {!compact && <p className="text-micro leading-4 text-fg-muted"><time dateTime={e.at}>{fmtTime(e.at)}</time>{e.device ? ` · ${e.device}` : e.actor === "system" ? " · system" : ""}{e.pageId && e.pageTitle != null ? <> · <Link className="hover:underline" href={`/timemachine?pageId=${e.pageId}&at=${encodeURIComponent(e.at)}`}>time machine</Link></> : null}</p>}
      </div>
      {compact && <time dateTime={e.at} className="shrink-0 pt-0.5 text-micro tabular-nums text-fg-muted">{fmtTime(e.at)}</time>}
    </li>
  );
}

/** The journal for a filter, grouped by day, with the cursor paging. `scrollRoot` = the element that scrolls (for the infinite scroll). */
export function EventList({ filter, compact, scrollRoot, pageSize = 50 }: { filter: EventFilter; compact?: boolean; scrollRoot?: () => HTMLElement | null; pageSize?: number }) {
  const qs = eventsQuery(filter, null, pageSize);
  const q = useInfiniteQuery({ queryKey: ["events", qs], initialPageParam: null as string | null, queryFn: ({ pageParam }) => api<{ events: KEvent[]; nextCursor: string | null }>(`/api/events?${eventsQuery(filter, pageParam, pageSize)}`), getNextPageParam: (last) => last.nextCursor, staleTime: 10_000 });
  const events = React.useMemo(() => q.data?.pages.flatMap((p) => p.events) ?? [], [q.data]); const days = React.useMemo(() => groupEventsByDay(events), [events]);
  const sentinel = React.useRef<HTMLDivElement>(null); const { hasNextPage, isFetchingNextPage, fetchNextPage } = q;
  React.useEffect(() => { const el = sentinel.current; if (!el || !hasNextPage) return; const io = new IntersectionObserver((es) => { if (es.some((x) => x.isIntersecting) && !isFetchingNextPage) void fetchNextPage(); }, { root: scrollRoot?.() ?? null, rootMargin: "300px" }); io.observe(el); return () => io.disconnect(); }, [hasNextPage, isFetchingNextPage, fetchNextPage, scrollRoot, events.length]);
  if (q.isLoading) return <div role="status" aria-label="Loading the timeline" className="space-y-2 py-2"><Skeleton className="h-5 w-40" /><Skeleton className="h-10" /><Skeleton className="h-10" /><Skeleton className="h-10" /></div>;
  if (q.isError) return <LoadError what="the timeline" error={q.error} onRetry={() => q.refetch()} />;
  if (!events.length) return <Empty icon={<History />} title="No event" hint={filter.families.length || filter.pageId || filter.projectId || filter.from || filter.to ? "Nothing in the journal matches these filters." : "The journal records what happens from now on: edits, links, tasks, captures, decisions."} />;
  return (
    <div data-testid="event-list" data-count={events.length}>
      {days.map((d) => <section key={d.key} aria-label={d.label} data-day={d.key} className={compact ? "mb-2" : "mb-4"}>
        <h2 className={cn("sticky top-0 z-[1] -mx-1 bg-bg-elev/0 px-1 py-1 font-semibold backdrop-blur-sm", compact ? "text-micro uppercase tracking-[0.06em] text-fg-muted" : "bg-bg/85 text-ui")}>{d.label} <span className="font-normal text-fg-muted">· {d.events.length}</span></h2>
        <ul className={cn(!compact && "surface-card divide-y divide-line px-3")}>{d.events.map((e) => <EventRow key={e.id} e={e} compact={compact} showPage={!filter.pageId} />)}</ul>
      </section>)}
      <div ref={sentinel} aria-hidden className="h-px" />
      {hasNextPage ? <div className="py-2 text-center"><Button variant="outline" size="sm" className="max-md:h-11" onClick={() => fetchNextPage()} disabled={isFetchingNextPage} data-testid="events-more">{isFetchingNextPage && <Spinner className="size-3.5" />}Load older events</Button></div> : <p className="py-2 text-center text-micro text-fg-muted" data-testid="events-end">Beginning of the journal · {events.length} event{events.length === 1 ? "" : "s"}</p>}
    </div>
  );
}

export function Timeline({ initial }: { initial: { pageId?: string | null; projectId?: string | null } }) {
  const { data: tree = [] } = useTree(); const [filter, setFilter] = React.useState<EventFilter>({ families: [], pageId: initial.pageId ?? null, projectId: initial.projectId ?? null, from: null, to: null });
  const [pick, setPick] = React.useState<"page" | "project" | null>(null); const [from, setFrom] = React.useState(""); const [to, setTo] = React.useState("");
  React.useEffect(() => { setFilter((f) => ({ ...f, from: from ? new Date(`${from}T00:00:00`).toISOString() : null, to: to ? new Date(`${to}T23:59:59.999`).toISOString() : null })); }, [from, to]);
  const page = filter.pageId ? tree.find((t) => t.id === filter.pageId) : null; const project = filter.projectId ? tree.find((t) => t.id === filter.projectId) : null;
  const toggle = (id: string) => setFilter((f) => ({ ...f, families: f.families.includes(id) ? f.families.filter((x) => x !== id) : [...f.families, id] }));
  const scrollRoot = React.useCallback(() => document.getElementById("main-scroll"), []);
  const any = filter.families.length > 0 || filter.pageId || filter.projectId || from || to;
  const dateInput = "h-8 rounded-control border border-line bg-bg-elev px-2 text-ui max-md:h-11 max-md:text-[16px]";
  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-8 sm:py-8" data-testid="timeline">
      <ScreenHeader icon={<History />} title="Knowledge Timeline" subtitle="Everything that happened in the workspace, as the journal recorded it. Entries rebuilt from older data are marked “reconstructed”." actions={<Button asChild size="sm" variant="outline" className="max-md:h-11"><Link href={`/timemachine${filter.pageId ? `?pageId=${filter.pageId}` : filter.projectId ? `?projectId=${filter.projectId}` : ""}`}><Clock /> Time machine</Link></Button>} />
      <div className="mb-4 grid gap-2" role="group" aria-label="Timeline filters">
        <div className="flex flex-wrap gap-1" data-testid="timeline-kinds">{EVENT_FAMILIES.map((f) => <button key={f.id} type="button" aria-pressed={filter.families.includes(f.id)} data-family={f.id} onClick={() => toggle(f.id)} className={cn("inline-flex h-8 items-center gap-1.5 rounded-pill border px-2.5 text-ui font-medium transition-colors duration-fast max-md:h-11 max-md:px-3.5 [&_svg]:size-3.5", filter.families.includes(f.id) ? "border-accent/40 bg-accent-soft text-accent" : "border-line bg-bg-elev text-fg-muted hover:text-fg")}>{ICON[f.id]}{f.label}</button>)}</div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button size="sm" variant={page ? "secondary" : "outline"} className="max-w-full max-md:h-11" onClick={() => setPick("page")} data-testid="timeline-page"><FileText /><span className="truncate">{page ? `${pageGlyph(page)} ${page.title || "Untitled"}` : "Any page"}</span></Button>
          <Button size="sm" variant={project ? "secondary" : "outline"} className="max-w-full max-md:h-11" onClick={() => setPick("project")} data-testid="timeline-project"><FolderKanban /><span className="truncate">{project ? `${pageGlyph(project)} ${project.title || "Untitled"}` : "Any project"}</span></Button>
          <label className="flex items-center gap-1 text-micro text-fg-muted">From<input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className={dateInput} /></label>
          <label className="flex items-center gap-1 text-micro text-fg-muted">To<input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className={dateInput} /></label>
          {any && <Button size="sm" variant="ghost" className="max-md:h-11" onClick={() => { setFilter({ families: [], pageId: null, projectId: null, from: null, to: null }); setFrom(""); setTo(""); }}><X /> Clear</Button>}
        </div>
      </div>
      <EventList filter={filter} scrollRoot={scrollRoot} />
      <PagePicker open={pick !== null} onOpenChange={(o) => { if (!o) setPick(null); }} title={pick === "project" ? "Events of a project" : "Events of a page"} description={pick === "project" ? "A project is a page and all its sub-pages." : undefined} current={pick === "project" ? filter.projectId : filter.pageId} filter={pick === "project" ? (n) => n.section === "projects" : undefined}
        onPick={(n) => setFilter((f) => (pick === "project" ? { ...f, projectId: n.id, pageId: null } : { ...f, pageId: n.id, projectId: null }))} />
    </div>
  );
}

/** Per-page timeline shown in the right panel of a page. */
export function PageTimelinePanel({ pageId }: { pageId: string | null }) {
  const root = React.useRef<HTMLDivElement>(null); const scrollRoot = React.useCallback(() => root.current?.closest<HTMLElement>(".overflow-y-auto") ?? null, []);
  const filter = React.useMemo<EventFilter>(() => ({ families: [], pageId }), [pageId]);
  if (!pageId) return <div className="p-4 text-ui text-fg-muted">Open a page to see its timeline.</div>;
  return (
    <div ref={root} className="p-3" data-testid="page-timeline">
      <div className="mb-2 flex flex-wrap gap-1.5"><Button asChild size="sm" variant="outline"><Link href={`/timemachine?pageId=${pageId}`}><Clock /> Time machine</Link></Button><Button asChild size="sm" variant="ghost"><Link href={`/timeline?pageId=${pageId}`}><History /> Full timeline</Link></Button></div>
      <EventList filter={filter} compact scrollRoot={scrollRoot} pageSize={30} />
    </div>
  );
}
