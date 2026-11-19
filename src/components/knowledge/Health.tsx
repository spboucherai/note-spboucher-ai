"use client";
/**
 * file: src/components/knowledge/Health.tsx
 * description: Knowledge Health (`/health`) on GET /api/health/knowledge — every category with its count, a drill-down list, and
 *   one-click *navigations* to where the issue can be looked at (the page, the block that holds a broken link, the task list).
 *   Nothing is fixed automatically. `HealthChip` is the compact summary shown on Home.
 * author: Simon-Pierre Boucher — contact@spboucher.ai
 */
import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { HeartPulse, Unlink, Link2Off, BookX, Copy, FileQuestion, FolderClock, ListTodo, ChevronRight, RefreshCw, ArrowUpRight } from "lucide-react";
import { api } from "@/lib/client/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/primitives";
import { HEALTH_CATEGORIES, healthRows, issueCount, type Health, type HealthKey } from "@/lib/client/knowledge";
import { LoadError, ScreenHeader, fmtDateTime, fmtDay } from "./shared";

const ICON: Record<HealthKey, React.ReactNode> = { orphans: <Unlink />, brokenLinks: <Link2Off />, missingReferences: <BookX />, potentialDuplicates: <Copy />, untitled: <FileQuestion />, inactiveProjects: <FolderClock />, openTasks: <ListTodo /> };
export const useHealth = (inactiveDays = 30) => useQuery({ queryKey: ["health", inactiveDays], queryFn: () => api<Health>(`/api/health/knowledge?inactiveDays=${inactiveDays}`), staleTime: 30_000 });

export function HealthDashboard({ initial }: { initial?: string | null }) {
  const [days, setDays] = React.useState(30); const q = useHealth(days); const h = q.data;
  const [open, setOpen] = React.useState<HealthKey | null>(HEALTH_CATEGORIES.some((c) => c.id === initial) ? (initial as HealthKey) : null);
  const detail = React.useRef<HTMLDivElement>(null);
  const choose = (k: HealthKey) => { setOpen((o) => (o === k ? null : k)); requestAnimationFrame(() => detail.current?.scrollIntoView({ block: "nearest" })); };
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-8 sm:py-8" data-testid="health">
      <ScreenHeader icon={<HeartPulse />} title="Knowledge Health" subtitle="What needs attention in the workspace, computed from your data — no model. Each row takes you to the place to look at; nothing is changed for you."
        actions={<><label className="flex items-center gap-1.5 text-micro text-fg-muted">Inactive after<select value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Days before a project counts as inactive" className="h-8 rounded-control border border-line bg-bg-elev px-2 text-ui max-md:h-11">{[14, 30, 60, 90, 180].map((d) => <option key={d} value={d}>{d} days</option>)}</select></label><Button size="sm" variant="ghost" className="max-md:size-11" aria-label="Recompute" onClick={() => q.refetch()}><RefreshCw className={cn(q.isFetching && "animate-spin")} /></Button></>} />
      {q.isLoading ? <div role="status" aria-label="Computing health" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{Array.from({ length: 7 }, (_, i) => <Skeleton key={i} className="h-24 rounded-card" />)}</div> : q.isError || !h ? <LoadError what="the health report" error={q.error} onRetry={() => q.refetch()} /> : <>
        <p className="mb-3 text-ui text-fg-muted" data-testid="health-score"><b className="text-[1.25rem] font-semibold tabular-nums text-fg">{h.score.issues}</b> issue{h.score.issues === 1 ? "" : "s"} across <b className="font-medium text-fg">{h.score.pages}</b> pages · computed {fmtDateTime(h.computedAt)}</p>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,13.5rem),1fr))] gap-3" role="list">
          {HEALTH_CATEGORIES.map((c) => { const n = h[c.id].count; const issues = issueCount(h, c.id); return (
            <div role="listitem" key={c.id}><button type="button" aria-expanded={open === c.id} aria-controls="health-detail" onClick={() => choose(c.id)} data-testid={`health-${c.id}`} data-count={n}
              className={cn("surface-card flex h-full w-full flex-col items-start gap-1 p-3 text-left transition-colors duration-fast hover:border-line-strong", open === c.id && "border-accent/50 ring-2 ring-ring")}>
              <span className="flex w-full items-center gap-2"><span className={cn("grid size-8 shrink-0 place-items-center rounded-pop [&_svg]:size-4", issues ? "bg-warning/15 text-fg" : "bg-success/10 text-success-text")}>{ICON[c.id]}</span><span className="ml-auto text-h3 font-semibold tabular-nums leading-none">{n}</span></span>
              <span className="text-ui font-semibold">{c.label}</span>
              <span className="text-micro leading-4 text-fg-muted">{c.id === "openTasks" ? `${h.openTasks.overdue ?? 0} overdue · ${h.openTasks.withoutDate ?? 0} without a date` : c.id === "inactiveProjects" ? `No change for ${h.inactiveDays} days or more` : c.hint}</span>
              <span className="mt-auto flex items-center gap-0.5 pt-1 text-micro font-medium text-accent">{n ? "Show the list" : "Nothing to show"}<ChevronRight className={cn("size-3.5 transition-transform duration-fast", open === c.id && "rotate-90")} /></span>
            </button></div>); })}
        </div>
        <div ref={detail} id="health-detail" className="mt-4 scroll-mt-4">
          {open && <section aria-label={HEALTH_CATEGORIES.find((c) => c.id === open)!.label} className="surface-card" data-testid="health-detail" data-category={open}>
            <header className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2.5"><h2 className="text-[15px] font-semibold">{HEALTH_CATEGORIES.find((c) => c.id === open)!.label}</h2><span className="text-micro text-fg-muted">{h[open].count}{h[open].items.length < h[open].count ? ` · first ${h[open].items.length} shown` : ""}</span>
              {open === "openTasks" && <Button asChild size="xs" variant="outline" className="ml-auto max-md:h-11"><Link href="/tasks">Open Tasks <ArrowUpRight /></Link></Button>}
              {open === "orphans" && <Button asChild size="xs" variant="outline" className="ml-auto max-md:h-11"><Link href="/graph">Open the graph <ArrowUpRight /></Link></Button>}</header>
            {h[open].items.length ? <ul className="divide-y divide-line">{healthRows(h, open, fmtDay).map((r) => <li key={r.key} data-testid="health-row">
              {r.href ? <Link href={r.href} className="flex min-h-11 items-center gap-2 px-3 py-1.5 hover:bg-bg-hover"><span className="min-w-0 flex-1"><span className="block truncate text-ui font-medium">{r.title}</span><span className="block truncate text-micro text-fg-muted">{r.detail}</span></span><ArrowUpRight className="size-4 shrink-0 text-fg-muted" /></Link>
                : <div className="px-3 py-1.5"><div className="truncate text-ui font-medium">{r.title}</div><div className="text-micro text-fg-muted">{r.detail}</div><div className="mt-1 flex flex-wrap gap-1.5">{r.links?.map((l) => <Link key={l.href} href={l.href} className="inline-flex min-h-11 items-center rounded-control border border-line px-2.5 text-micro font-medium hover:bg-bg-hover sm:min-h-7">{l.label}</Link>)}</div></div>}
            </li>)}</ul> : <p className="px-3 py-4 text-ui text-fg-muted">Nothing in this category. </p>}
          </section>}
        </div>
      </>}
    </div>
  );
}

/** Compact health summary for Home: issue count + the two largest categories, linking to /health. */
export function HealthChip({ className }: { className?: string }) {
  const q = useHealth(); const h = q.data;
  if (q.isLoading) return <Skeleton className={cn("h-8 w-40 rounded-pill", className)} />;
  if (!h) return null;
  const top = HEALTH_CATEGORIES.map((c) => ({ ...c, n: issueCount(h, c.id) })).filter((c) => c.n > 0).sort((a, b) => b.n - a.n).slice(0, 2);
  return (
    <Link href="/health" data-testid="health-chip" data-issues={h.score.issues} aria-label={`Knowledge health: ${h.score.issues} issue${h.score.issues === 1 ? "" : "s"}`} className={cn("inline-flex min-h-11 max-w-full items-center gap-2 rounded-pill border border-line bg-bg-elev px-3 text-ui shadow-card transition-colors duration-fast hover:border-line-strong sm:min-h-8", className)}>
      <HeartPulse className={cn("size-4 shrink-0", h.score.issues ? "text-warning" : "text-success")} /><span className="font-medium">{h.score.issues ? `${h.score.issues} issue${h.score.issues === 1 ? "" : "s"}` : "Healthy"}</span>
      {top.length > 0 && <span className="min-w-0 truncate text-micro text-fg-muted">{top.map((c) => `${c.n} ${c.label.toLowerCase()}`).join(" · ")}</span>}
    </Link>
  );
}
