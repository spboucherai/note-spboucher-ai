"use client";
/**
 * file: src/components/knowledge/TimeMachine.tsx
 * description: Knowledge Time Machine (`/timemachine`) on GET /api/timemachine — a date scrubber shows a page or a project as of
 *   that date. Honesty is the API's, word for word in meaning: `source` (current / version / version_after / none) and `exact`
 *   decide the label ("Exact", "Approximate", "No record", "Did not exist yet") and the explanation; nothing is interpolated.
 *   A diff against today is computed block by block on the two documents, and "Restore this version" goes through the versions
 *   restore route after a confirmation (the current state is saved in the history first; a concurrent change is refused).
 * author: Simon-Pierre Boucher — contact@spboucher.ai
 */
import * as React from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock, RotateCcw, ChevronLeft, ChevronRight, FileText, FolderKanban, History, TriangleAlert, CheckCircle2, CircleDashed, CircleOff } from "lucide-react";
import { api, ApiError } from "@/lib/client/api";
import { useMounted } from "@/lib/client/hooks";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge, Dialog, DialogContent, Empty, Skeleton, Spinner } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";
import { REL_LABEL, blockTexts, dateToSlider, diffBlocks, diffStats, honesty, sliderToDate, type TMPage } from "@/lib/client/knowledge";
import type { PMNode } from "@/lib/editor/text";
import { LoadError, PagePicker, ScreenHeader, Segmented, fmtDateTime, pageGlyph, useTree } from "./shared";

const Editor = dynamic(() => import("@/components/editor/Editor").then((m) => m.Editor), { ssr: false, loading: () => <Skeleton className="h-24" /> });
const STEPS = 1000;
interface State { at: string; scope: { pageId?: string; projectId?: string }; pages: TMPage[]; relations: { id: string; fromId: string; toId: string; kind: string; relType: string; origin: string; fromTitle: string | null; toTitle: string | null }[]; references: { id: string; title?: string; citeKey?: string }[]; removedSince: { id: string; at: string; kind: string; summary: string; data: Record<string, any> }[]; journalSince: string | null }
const toLocalInput = (d: Date) => { const p = (n: number) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
const TONE = { exact: { cls: "border-success/30 bg-success/10", icon: <CheckCircle2 className="text-success" /> }, approximate: { cls: "border-warning/40 bg-warning/10", icon: <CircleDashed className="text-warning" /> }, none: { cls: "border-line bg-bg-sunk", icon: <CircleOff className="text-fg-muted" /> } } as const;

function HonestyNote({ p, className }: { p: TMPage; className?: string }) {
  const h = honesty(p, fmtDateTime); const t = TONE[h.tone];
  return <div role="note" data-testid="tm-honesty" data-source={p.source} data-exact={String(p.exact)} className={cn("flex items-start gap-2 rounded-control border p-2.5 text-ui leading-5 [&_svg]:mt-0.5 [&_svg]:size-4 [&_svg]:shrink-0", t.cls, className)}>{t.icon}<div className="min-w-0"><span className="font-semibold" data-testid="tm-label">{h.label}</span> <span className="text-fg-muted">· source: <code className="font-mono text-micro">{p.source}</code>, exact: <code className="font-mono text-micro">{String(p.exact)}</code></span><p className="text-fg-muted">{h.detail}</p></div></div>;
}

export function TimeMachine({ initial }: { initial: { pageId?: string | null; projectId?: string | null; at?: string | null } }) {
  const qc = useQueryClient(); const { data: tree = [] } = useTree(); const mounted = useMounted(); // dates are formatted in the viewer's zone: nothing date-bound is rendered on the server
  const [scope, setScope] = React.useState<{ kind: "page" | "project"; id: string | null }>(initial.projectId ? { kind: "project", id: initial.projectId } : { kind: "page", id: initial.pageId ?? null });
  const [now] = React.useState(() => Date.now()); const initAt = initial.at && !isNaN(Date.parse(initial.at)) ? Date.parse(initial.at) : now;
  const [at, setAt] = React.useState(initAt); const [debounced, setDebounced] = React.useState(initAt); const [pick, setPick] = React.useState(false); const [mode, setMode] = React.useState<"then" | "diff">("then"); const [confirm, setConfirm] = React.useState(false);
  React.useEffect(() => { const t = setTimeout(() => setDebounced(at), 220); return () => clearTimeout(t); }, [at]);
  const root = scope.id ? tree.find((t) => t.id === scope.id) : null;
  // bounds of the scrubber: creation of the page (or of the project root) → now; ticks = the history entries of the page
  const current = useQuery({ queryKey: ["tm-current", scope.id], enabled: Boolean(scope.id), queryFn: () => api<{ id: string; title: string; createdAt: string; version: number; content: PMNode }>(`/api/pages/${scope.id}`), staleTime: 5_000 });
  const versions = useQuery({ queryKey: ["tm-versions", scope.id], enabled: scope.kind === "page" && Boolean(scope.id), queryFn: () => api<{ id: string; version: number; createdAt: string; reason: string }[]>(`/api/pages/${scope.id}/versions`), staleTime: 5_000 });
  const min = current.data ? Math.min(Date.parse(current.data.createdAt) - 60_000, now - 3_600_000) : now - 30 * 86_400_000; const max = now;
  const state = useQuery({ queryKey: ["timemachine", scope.kind, scope.id, debounced], enabled: Boolean(scope.id), placeholderData: keepPreviousData, queryFn: () => api<State>(`/api/timemachine?at=${encodeURIComponent(new Date(debounced).toISOString())}&${scope.kind === "page" ? "pageId" : "projectId"}=${scope.id}`) });
  const page = scope.kind === "page" ? state.data?.pages[0] ?? null : null;
  const ticks = React.useMemo(() => (versions.data ?? []).map((v) => ({ ...v, t: Date.parse(v.createdAt) })).filter((v) => v.t >= min && v.t <= max).sort((a, b) => a.t - b.t), [versions.data, min, max]);
  const jump = (dir: 1 | -1) => { const list = ticks.map((t) => t.t); /* one second after the entry: the state at that instant is that entry */ const next = dir === 1 ? list.find((t) => t + 1000 > at + 500) : [...list].reverse().find((t) => t + 1000 < at - 500); setAt(next != null ? Math.min(max, next + 1000) : dir === 1 ? max : min); };
  const diff = React.useMemo(() => (page?.content && current.data ? diffBlocks(blockTexts(page.content), blockTexts(current.data.content)) : null), [page, current.data]); const stats = diff ? diffStats(diff) : null;
  const h = page ? honesty(page, fmtDateTime) : null;
  const restore = useMutation({
    mutationFn: () => api<{ ok: boolean; version: number; restored: number }>(`/api/pages/${page!.id}/versions/${page!.versionId}/restore`, { method: "POST", json: { baseVersion: page!.currentVersion } }),
    onSuccess: (r) => { setConfirm(false); toast("Version restored", { description: `The page is back to v${r.restored}. The state it had before was saved in the history first.`, tone: "success" }); for (const k of ["tm-current", "tm-versions", "timemachine", "events", "tree", "page-source"]) qc.invalidateQueries({ queryKey: [k] }); },
    onError: (e: any) => { setConfirm(false); toast(e instanceof ApiError && e.status === 409 ? "The page changed meanwhile — nothing was restored" : "Could not restore", { description: e instanceof ApiError && e.status === 409 ? "Look at the date again, then retry." : e?.message, tone: "danger" }); qc.invalidateQueries({ queryKey: ["timemachine"] }); qc.invalidateQueries({ queryKey: ["tm-current"] }); },
  });
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-8 sm:py-8" data-testid="timemachine">
      <ScreenHeader icon={<Clock />} title="Knowledge Time Machine" subtitle="See a page or a project as it was at a date. The app tells you how sure it is: an exact state, the nearest saved version, or no record." actions={<Button asChild size="sm" variant="outline" className="max-md:h-11"><Link href={`/timeline${scope.id ? `?${scope.kind === "page" ? "pageId" : "projectId"}=${scope.id}` : ""}`}><History /> Timeline</Link></Button>} />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Segmented label="Scope" value={scope.kind} onChange={(k) => setScope({ kind: k, id: null })} options={[{ id: "page", label: "Page" }, { id: "project", label: "Project" }]} />
        <Button variant="outline" size="sm" className="max-w-full max-md:h-11" onClick={() => setPick(true)} data-testid="tm-pick">{scope.kind === "page" ? <FileText /> : <FolderKanban />}<span className="truncate">{root ? `${pageGlyph(root)} ${root.title || "Untitled"}` : scope.kind === "page" ? "Choose a page…" : "Choose a project…"}</span></Button>
      </div>
      {!mounted ? <Skeleton className="h-40" /> : !scope.id ? <Empty icon={<Clock />} title={scope.kind === "page" ? "Choose a page" : "Choose a project"} hint="Then move the date to travel through its history." action={<Button size="sm" className="max-md:h-11" onClick={() => setPick(true)}>Choose…</Button>} /> : <>
        <div className="surface-card mb-4 p-3" data-testid="tm-scrubber">
          <div className="flex flex-wrap items-center gap-2">
            <Button size="iconSm" variant="ghost" className="max-md:size-11" aria-label="Previous saved version" disabled={scope.kind !== "page" || !ticks.length} onClick={() => jump(-1)}><ChevronLeft /></Button>
            <input type="datetime-local" aria-label="Date" value={toLocalInput(new Date(at))} max={toLocalInput(new Date(max))} onChange={(e) => { const t = Date.parse(e.target.value); if (!isNaN(t)) setAt(Math.min(max, t)); }} className="h-8 min-w-0 rounded-control border border-line bg-bg px-2 text-ui tabular-nums max-md:h-11 max-md:flex-1 max-md:text-[16px]" data-testid="tm-date" />
            <Button size="iconSm" variant="ghost" className="max-md:size-11" aria-label="Next saved version" disabled={scope.kind !== "page" || !ticks.length} onClick={() => jump(1)}><ChevronRight /></Button>
            <Button size="sm" variant="ghost" className="max-md:h-11" onClick={() => setAt(max)} disabled={at >= max - 1000}>Now</Button>
            {state.isFetching && <Spinner className="size-3.5" />}
          </div>
          <div className="relative mt-2">
            <input type="range" aria-label="Date scrubber" min={0} max={STEPS} step={1} value={dateToSlider(at, STEPS, min, max)} onChange={(e) => setAt(sliderToDate(Number(e.target.value), STEPS, min, max).getTime())} aria-valuetext={fmtDateTime(new Date(at).toISOString())} className="h-6 w-full cursor-pointer accent-[var(--accent)] max-md:h-11" data-testid="tm-range" />
            <div aria-hidden className="pointer-events-none relative mx-2 h-2">{ticks.map((v) => <span key={v.id} title={`v${v.version} · ${fmtDateTime(v.createdAt)}`} className="absolute top-0 h-2 w-px bg-fg-muted" style={{ left: `${((v.t - min) / (max - min)) * 100}%` }} />)}</div>
            <div className="flex justify-between text-micro text-fg-muted"><span>{fmtDateTime(new Date(min).toISOString())}</span><span>{scope.kind === "page" ? `${ticks.length} saved version${ticks.length === 1 ? "" : "s"}` : ""}</span><span>now</span></div>
          </div>
        </div>
        {state.isLoading ? <div role="status" aria-label="Loading that date" className="space-y-2"><Skeleton className="h-14" /><Skeleton className="h-40" /></div> : state.isError ? <LoadError what="the state at that date" error={state.error} onRetry={() => state.refetch()} /> : state.data && <>
          {scope.kind === "page" && page && <section aria-label="Page at that date" data-testid="tm-page">
            <HonestyNote p={page} />
            {page.existed && page.source !== "none" && <>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Segmented label="What to show" size="sm" value={mode} onChange={setMode} options={[{ id: "then", label: "As it was" }, { id: "diff", label: "Diff with today", testId: "tm-diff-tab" }]} />
                <span className="text-micro text-fg-muted">{page.changedSince ? `Changed since (today: v${page.currentVersion})` : "Identical to today"}{page.trashedAt ? " · was in the trash at that date" : ""}</span>
                {h?.restorable && page.changedSince && <Button size="sm" className="ml-auto max-md:h-11" onClick={() => setConfirm(true)} data-testid="tm-restore"><RotateCcw /> Restore this version</Button>}
              </div>
              <div className="surface-card mt-2 p-4">
                <h2 className="font-serif text-h3 font-semibold leading-tight [overflow-wrap:anywhere]" data-testid="tm-title">{page.icon ? `${page.icon} ` : ""}{page.title || "Untitled"}</h2>
                {page.title !== page.currentTitle && <p className="text-micro text-fg-muted">Today: “{page.currentTitle}”</p>}
                <p className="mb-2 text-micro text-fg-muted">{page.version != null ? `v${page.version}` : ""}{page.wordCount != null ? ` · ${page.wordCount} words` : ""}</p>
                {mode === "then" ? (page.content ? <div className="max-h-[60dvh] overflow-y-auto overscroll-contain" data-testid="tm-content"><Editor key={`${page.id}:${page.source}:${page.versionId ?? "cur"}`} content={page.content} editable={false} /></div> : <p className="text-ui text-fg-muted">No content recorded.</p>)
                  : !diff ? <Skeleton className="h-24" /> : <div data-testid="tm-diff" data-added={stats!.added} data-removed={stats!.removed}>
                    <p className="mb-2 text-ui text-fg-muted">{stats!.added + stats!.removed === 0 ? "The text at that date is the same as today's." : <>Compared block by block: <b className="font-medium text-fg">{stats!.removed}</b> block{stats!.removed === 1 ? "" : "s"} only at that date, <b className="font-medium text-fg">{stats!.added}</b> only today, {stats!.same} unchanged.</>}</p>
                    <ul className="max-h-[60dvh] space-y-1 overflow-y-auto overscroll-contain">{diff.map((o, i) => <li key={i} data-op={o.op} className={cn("rounded-control border-l-2 px-2.5 py-1 text-ui leading-5 [overflow-wrap:anywhere]", o.op === "del" ? "border-danger bg-danger/10" : o.op === "add" ? "border-success bg-success/10" : "border-transparent text-fg-muted")}>{o.op !== "same" && <span className="mr-1.5 text-micro font-semibold uppercase tracking-[0.06em]">{o.op === "del" ? "Then only" : "Today only"}</span>}{o.text}</li>)}</ul>
                  </div>}
              </div>
            </>}
          </section>}
          {scope.kind === "project" && <section aria-label="Project at that date" data-testid="tm-project">
            <p className="mb-2 text-ui text-fg-muted">{state.data.pages.filter((p) => p.existed).length} of {state.data.pages.length} pages existed at that date.</p>
            <ul className="surface-card divide-y divide-line">{state.data.pages.map((p) => { const hh = honesty(p, fmtDateTime); return <li key={p.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2" data-source={p.source} data-existed={String(p.existed)}>
              <button type="button" onClick={() => setScope({ kind: "page", id: p.id })} className={cn("min-w-0 flex-1 truncate text-left text-ui font-medium hover:underline", !p.existed && "text-fg-muted")}>{p.icon ? `${p.icon} ` : ""}{p.title || p.currentTitle || "Untitled"}</button>
              <Badge tone={hh.tone === "exact" ? "success" : hh.tone === "approximate" ? "warning" : "neutral"}><span className={hh.tone === "approximate" ? "text-fg" : undefined}>{hh.label}</span></Badge>
              <span className="text-micro text-fg-muted">{p.source}{p.version != null ? ` · v${p.version}` : ""}{p.changedSince ? " · changed since" : p.existed ? " · same as today" : ""}</span>
            </li>; })}</ul>
          </section>}
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <Card title="Relations at that date" count={state.data.relations.length}>{state.data.relations.slice(0, 30).map((r) => <li key={r.id} className="truncate">{r.fromTitle ?? "?"} <span className="text-fg-muted">{r.kind === "relation" ? REL_LABEL[r.relType] ?? r.relType : r.kind === "cites" ? "cites" : "→"}</span> {r.toTitle ?? "?"}</li>)}</Card>
            <Card title="References at that date" count={state.data.references.length}>{state.data.references.slice(0, 30).map((r) => <li key={r.id} className="truncate">{r.title ?? r.citeKey ?? r.id}</li>)}</Card>
            <Card title="Removed since" count={state.data.removedSince.length}>{state.data.removedSince.slice(0, 30).map((r) => <li key={r.id} className="truncate">{r.kind === "link.removed" ? `Link → ${r.data?.toTitle ?? "?"}` : `${r.data?.fromTitle ?? "?"} ${REL_LABEL[r.data?.relType] ?? "→"} ${r.data?.toTitle ?? "?"}`} <span className="text-fg-muted">· {fmtDateTime(r.at)}</span></li>)}</Card>
          </div>
          <p className="mt-3 flex items-start gap-1.5 text-micro leading-4 text-fg-muted"><TriangleAlert className="mt-px size-3.5 shrink-0" />{state.data.journalSince ? `The journal records events since ${fmtDateTime(state.data.journalSince)}. Before that, only page creations and saved versions are known, so links and relations removed earlier cannot be listed.` : "The journal has no live event yet: only page creations and saved versions are known."}</p>
        </>}
      </>}
      <PagePicker open={pick} onOpenChange={setPick} title={scope.kind === "page" ? "Page to travel in" : "Project to travel in"} current={scope.id} filter={scope.kind === "project" ? (n) => n.section === "projects" : (n) => n.type !== "database"} onPick={(n) => setScope({ kind: scope.kind, id: n.id })} />
      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent title="Restore this version?" description={page ? `“${page.currentTitle || "Untitled"}” will go back to v${page.version}${page.versionAt ? ` (saved ${fmtDateTime(page.versionAt)})` : ""}.` : undefined}>
          {page && h && <><p className="text-ui leading-5 text-fg-muted">{h.tone === "approximate" ? "This is the nearest saved version, not necessarily the exact text at the chosen date. " : ""}The current state (v{page.currentVersion}) is saved in the version history first, so this can be undone from there. If the page changed in the meantime, nothing is restored.</p>
            <div className="mt-4 flex justify-end gap-2"><Button variant="ghost" className="max-md:h-11" onClick={() => setConfirm(false)}>Cancel</Button><Button className="max-md:h-11" disabled={restore.isPending} onClick={() => restore.mutate()} data-testid="tm-restore-confirm">{restore.isPending ? <Spinner className="size-3.5 border-white/40 border-t-white" /> : <RotateCcw />} Restore v{page.version}</Button></div></>}
        </DialogContent>
      </Dialog>
    </div>
  );
}
function Card({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return <section className="surface-card min-w-0 p-3"><h3 className="mb-1 flex items-center gap-2 text-micro font-semibold uppercase tracking-[0.06em] text-fg-muted">{title}<span className="rounded-pill bg-bg-sunk px-1.5 tabular-nums">{count}</span></h3>{count ? <ul className="space-y-0.5 text-ui leading-5">{children}</ul> : <p className="text-ui text-fg-muted">None.</p>}</section>;
}
