/**
 * file: src/components/search/SearchPage.tsx
 * description: Universal search screen (results / index status / near-duplicates). Results load 40 at a time ("Show more", up to 120,
 *   then an explicit "Showing the first N" note); the Index and Duplicates tabs have their own loading and error states with Retry.
 * author: Simon-Pierre Boucher — contact@spboucher.ai
 */
"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, RefreshCw, Copy as CopyIcon, SlidersHorizontal, X, FileText, Database, Paperclip, BookMarked, TriangleAlert, CircleCheck, Sparkles, Archive, CloudOff, AudioLines } from "lucide-react";
import { api } from "@/lib/client/api";
import { useOnline } from "@/lib/client/hooks";
import { Button } from "@/components/ui/button";
import { Badge, Dialog, SheetContent, Empty, Skeleton, Spinner, Switch } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";
import { ErrorState, ListFooter } from "@/components/ui/error-state";
import { SEARCH_PAGE_SIZE, searchPaging } from "@/lib/paging";
import { timeAgo, cn, fmtDate } from "@/lib/utils";

type Kind = "page" | "entry" | "file" | "reference";
interface Filters { kinds: Kind[]; section: string; range: "" | "7" | "30" | "365" | "custom"; since: string; until: string; semantic: boolean; archived: boolean }
interface Hit { chunkId: string; pageId: string | null; sourceType: string; sourceId: string; title: string; icon: string | null; heading: string | null; blockId: string | null; content: string; semantic: number; keyword: number; kind?: Kind; section?: string | null; archived?: boolean; updatedAt?: string | null; snippet?: string; more?: number; attachmentId?: string | null }
const DEFAULTS: Filters = { kinds: [], section: "", range: "", since: "", until: "", semantic: true, archived: false };
const STORE = "note-search-filters", SCROLL = "note-search-scroll";
const KINDS: { id: Kind; label: string; icon: React.ReactNode }[] = [{ id: "page", label: "Pages", icon: <FileText /> }, { id: "entry", label: "Database entries", icon: <Database /> }, { id: "file", label: "Files", icon: <Paperclip /> }, { id: "reference", label: "References", icon: <BookMarked /> }];
const SPACES = [["", "All spaces"], ["notes", "Notes"], ["documents", "Documents"], ["projects", "Projects"], ["research", "Research"], ["databases", "Databases"]];
const RANGES: [Filters["range"], string][] = [["", "Any time"], ["7", "Last 7 days"], ["30", "Last 30 days"], ["365", "Last year"], ["custom", "Custom…"]];
const HL = /\u0001([\s\S]*?)\u0002/g;

/** Matched words come back between two control characters; they are rendered as <mark> React nodes — never as HTML. */
function Snippet({ hit, terms }: { hit: Hit; terms: string[] }) {
  const src = hit.snippet && hit.snippet.includes("\u0001") ? hit.snippet : null;
  if (src) { const out: React.ReactNode[] = []; let last = 0; let m: RegExpExecArray | null; HL.lastIndex = 0; while ((m = HL.exec(src))) { if (m.index > last) out.push(src.slice(last, m.index)); out.push(<mark key={m.index} className="rounded-sm bg-warning/35 px-0.5 text-fg">{m[1]}</mark>); last = m.index + m[0].length; } if (last < src.length) out.push(src.slice(last)); return <>{out}</>; }
  // semantic-only match: no literal term to mark in most cases; still mark the words that do appear
  const text = hit.content.slice(0, 320); if (!terms.length) return <>{text}</>;
  const re = new RegExp(`(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
  return <>{text.split(re).map((part, i) => (i % 2 ? <mark key={i} className="rounded-sm bg-warning/35 px-0.5 text-fg">{part}</mark> : part))}</>;
}
/** The indexed text of a voice note starts with "Audio" or "Audio: <title>" on its own line, followed by its transcript (src/lib/editor/next-nodes.ts). */
const inVoiceNote = (h: Hit) => h.sourceType === "page" && /(^|\n)Audio(: [^\n]*)?(\n|$)/.test(h.content);
const hrefOf = (h: Hit, hl = "") => h.kind === "reference" ? (h.pageId ? `/p/${h.pageId}` : "/research") : h.pageId ? `/p/${h.pageId}${h.blockId ? `${hl ? `?hl=${encodeURIComponent(hl)}` : ""}#block-${h.blockId}` : ""}` : h.attachmentId ? `/api/files/${h.attachmentId}` : "#";

/**
 * Universal search: full text + meaning, across pages, database entries, files and references. Filters persist on the device,
 * the query lives in the URL, results stay cached and the scroll position is restored — so "Back" from a result returns to the same list.
 */
export function SearchPage({ initialQuery }: { initialQuery: string }) {
  const r = useRouter(); const qc = useQueryClient(); const online = useOnline(); const input = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState(initialQuery); const [dq, setDq] = useState(initialQuery); const [f, setF] = useState<Filters>(DEFAULTS); const [ready, setReady] = useState(false);
  const [sheet, setSheet] = useState(false); const [tab, setTab] = useState<"results" | "index" | "dups">("results");
  useEffect(() => { try { const s = JSON.parse(localStorage.getItem(STORE) ?? "null"); if (s) setF({ ...DEFAULTS, ...s }); } catch {} setReady(true); if (!initialQuery) input.current?.focus(); }, [initialQuery]);
  useEffect(() => { if (ready) try { localStorage.setItem(STORE, JSON.stringify(f)); } catch {} }, [f, ready]);
  useEffect(() => { const t = setTimeout(() => { const v = q.trim(); setDq(v); const url = v ? `/search?q=${encodeURIComponent(v)}` : "/search"; if (window.location.pathname + window.location.search !== url) window.history.replaceState(window.history.state, "", url); }, 280); return () => clearTimeout(t); }, [q]);
  // "Show more" raises the limit for the current query + filters only: any change of either starts again at the first 40
  const [more, setMore] = useState<{ base: string; limit: number }>({ base: "", limit: SEARCH_PAGE_SIZE });
  const base = useMemo(() => {
    const p = new URLSearchParams({ mode: "hybrid", q: dq, group: "1", semantic: f.semantic ? "1" : "0" });
    if (f.kinds.length) p.set("kinds", f.kinds.join(",")); if (f.section) p.set("section", f.section); if (f.archived) p.set("archived", "1");
    if (f.range === "custom") { if (f.since) p.set("since", f.since); if (f.until) p.set("until", f.until); } else if (f.range) p.set("since", new Date(Date.now() - Number(f.range) * 864e5).toISOString().slice(0, 10));
    return p.toString();
  }, [dq, f]);
  const limit = more.base === base ? more.limit : SEARCH_PAGE_SIZE; const qs = `${base}&limit=${limit}`;
  useEffect(() => { if (!ready) return; try { const s = JSON.parse(sessionStorage.getItem(SCROLL) ?? "null"); if (s && typeof s.base === "string" && Number(s.limit) > SEARCH_PAGE_SIZE) setMore({ base: s.base, limit: Number(s.limit) }); } catch {} }, [ready]);
  const { data: hits, isFetching, error, refetch, isPlaceholderData } = useQuery({ queryKey: ["search", qs], queryFn: () => api<Hit[]>(`/api/search?${qs}`, { timeoutMs: 25_000 }), enabled: ready && dq.length > 1, staleTime: 60_000, placeholderData: keepPreviousData, retry: false });
  const { data: stats, error: statsError, isFetching: statsFetching, refetch: refetchStats } = useQuery({ queryKey: ["index-stats"], queryFn: () => api<any>("/api/search/index-state"), refetchInterval: tab === "index" ? 8000 : false });
  const { data: dups, error: dupsError, isFetching: dupsFetching, refetch: refetchDups } = useQuery({ queryKey: ["duplicates"], queryFn: () => api<any[]>("/api/search/duplicates"), enabled: tab === "dups" });
  // restore the scroll position when coming back to the same result list
  useEffect(() => { if (!hits) return; try { const s = JSON.parse(sessionStorage.getItem(SCROLL) ?? "null"); if (s && s.qs === qs) { sessionStorage.removeItem(SCROLL); requestAnimationFrame(() => { const el = document.getElementById("main-scroll"); if (el) el.scrollTop = s.top; }); } } catch {} }, [hits, qs]);
  const remember = () => { try { sessionStorage.setItem(SCROLL, JSON.stringify({ qs, base, limit, top: document.getElementById("main-scroll")?.scrollTop ?? 0 })); } catch {} };
  const paging = searchPaging(hits?.length ?? 0, limit);
  const terms = useMemo(() => dq.toLowerCase().split(/\s+/).filter((t) => t.length > 2).slice(0, 8), [dq]);
  const active = f.kinds.length + (f.section ? 1 : 0) + (f.range ? 1 : 0) + (f.archived ? 1 : 0) + (f.semantic ? 0 : 1);
  const pending = (stats?.health?.pending?.length ?? 0) + (stats?.health?.pendingFiles ?? 0); const failed = stats?.health?.failed?.length ?? 0;
  const toggleKind = (k: Kind) => setF((s) => ({ ...s, kinds: s.kinds.includes(k) ? s.kinds.filter((x) => x !== k) : [...s.kinds, k] }));
  async function reindex(scope: "all" | "pending") { try { const r2 = await api<{ queued: number }>("/api/search/index-state", { method: "POST", json: { scope } }); toast(scope === "all" ? "Full re-index queued" : `${r2.queued} item${r2.queued === 1 ? "" : "s"} queued`, { description: "Unchanged content is skipped. This page refreshes by itself." }); setTimeout(() => { refetchStats(); qc.invalidateQueries({ queryKey: ["search"] }); }, 3000); } catch (e: any) { toast("Could not queue the re-index", { description: e.message, tone: "danger" }); } }
  const chip = (on: boolean) => cn("flex h-10 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-[13.5px] font-medium [&_svg]:size-4", on ? "border-accent/40 bg-accent-soft text-accent" : "border-line bg-bg-elev text-fg-muted");
  const FiltersBody = () => (<div className="space-y-5">
    <fieldset><legend className="mb-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-fg-faint">Type</legend><div className="flex flex-wrap gap-2">{KINDS.map((k) => <button key={k.id} type="button" aria-pressed={f.kinds.includes(k.id)} onClick={() => toggleKind(k.id)} className={chip(f.kinds.includes(k.id))}>{k.icon}{k.label}</button>)}</div></fieldset>
    <fieldset><legend className="mb-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-fg-faint">Space</legend><div className="flex flex-wrap gap-2">{SPACES.map(([id, label]) => <button key={id} type="button" aria-pressed={f.section === id} onClick={() => setF((s) => ({ ...s, section: id }))} className={chip(f.section === id)}>{label}</button>)}</div></fieldset>
    <fieldset><legend className="mb-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-fg-faint">Last changed</legend><div className="flex flex-wrap gap-2">{RANGES.map(([id, label]) => <button key={id} type="button" aria-pressed={f.range === id} onClick={() => setF((s) => ({ ...s, range: id }))} className={chip(f.range === id)}>{label}</button>)}</div>
      {f.range === "custom" && <div className="mt-3 grid grid-cols-2 gap-2"><label className="grid gap-1 text-[12px] text-fg-muted">From<input type="date" value={f.since} max={f.until || undefined} onChange={(e) => setF((s) => ({ ...s, since: e.target.value }))} className="h-11 rounded-lg border border-line bg-bg px-2 text-[16px] text-fg" /></label><label className="grid gap-1 text-[12px] text-fg-muted">To<input type="date" value={f.until} min={f.since || undefined} onChange={(e) => setF((s) => ({ ...s, until: e.target.value }))} className="h-11 rounded-lg border border-line bg-bg px-2 text-[16px] text-fg" /></label></div>}</fieldset>
    <div className="space-y-1">
      <label className="flex min-h-12 items-center gap-3"><span className="min-w-0 flex-1"><span className="block text-[15px]">Search by meaning</span><span className="block text-[12.5px] leading-4 text-fg-faint">Sends the words you type (not your notes) to the embedding provider. Off = exact words only, nothing leaves the server.</span></span><Switch checked={f.semantic} onCheckedChange={(v) => setF((s) => ({ ...s, semantic: v }))} aria-label="Search by meaning" /></label>
      <label className="flex min-h-12 items-center gap-3"><span className="min-w-0 flex-1 text-[15px]">Include archived pages</span><Switch checked={f.archived} onCheckedChange={(v) => setF((s) => ({ ...s, archived: v }))} aria-label="Include archived pages" /></label>
    </div>
    {active > 0 && <Button variant="outline" className="h-11 w-full" onClick={() => setF(DEFAULTS)}>Reset filters</Button>}
  </div>);
  return (
    <div className="mx-auto w-full min-w-0 max-w-3xl px-4 pb-10 pt-3 md:px-8 md:pt-6">
      <h1 className="sr-only">Search</h1>
      <div className="sticky top-0 z-10 -mx-4 bg-bg/95 px-4 pb-2 pt-1 backdrop-blur md:static md:mx-0 md:bg-transparent md:px-0">
        <form role="search" onSubmit={(e) => { e.preventDefault(); setDq(q.trim()); input.current?.blur(); }} className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1"><Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-fg-faint" /><input ref={input} type="search" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search everything" placeholder="Search pages, entries, files, references…" enterKeyHint="search" autoCapitalize="none" autoCorrect="off" className="h-12 w-full rounded-xl border border-line bg-bg-elev pl-10 pr-10 text-[16px] shadow-card outline-none focus:border-accent/60 [&::-webkit-search-cancel-button]:hidden" />{q && <button type="button" aria-label="Clear search" onClick={() => { setQ(""); input.current?.focus(); }} className="absolute right-0.5 top-0.5 grid size-11 place-items-center text-fg-faint"><X className="size-5" /></button>}</div>
          <button type="button" onClick={() => setSheet(true)} aria-label={active ? `Filters, ${active} active` : "Filters"} className={cn("relative grid size-12 shrink-0 place-items-center rounded-xl border", active ? "border-accent/40 bg-accent-soft text-accent" : "border-line bg-bg-elev text-fg-muted")}><SlidersHorizontal className="size-5" />{active > 0 && <span aria-hidden className="absolute -right-1 -top-1 grid size-5 place-items-center rounded-full bg-accent text-[11px] font-semibold text-accent-fg">{active}</span>}</button>
        </form>
        <div role="tablist" aria-label="Search sections" className="mt-2 flex gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {([["results", dq.length > 1 && hits ? `Results · ${hits.length}${paging.more || paging.capped ? "+" : ""}` : "Results"], ["index", `Index${failed ? ` · ${failed} failed` : pending ? ` · ${pending} pending` : ""}`], ["dups", "Duplicates"]] as const).map(([id, label]) => <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={cn("flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-medium", tab === id ? "bg-fg text-bg" : "text-fg-muted", id === "index" && failed && tab !== id && "text-danger-text")}>{id === "index" && failed ? <TriangleAlert className="size-3.5" /> : null}{label}</button>)}
          {isFetching && <span className="ml-auto grid size-9 shrink-0 place-items-center"><Spinner /></span>}
        </div>
      </div>
      {tab === "results" && <div role="tabpanel" className="mt-2 space-y-2">
        {!online && <div className="flex items-center gap-2 rounded-xl bg-warning/15 px-3 py-2.5 text-[13px]"><CloudOff className="size-4 shrink-0" />Search needs a connection.</div>}
        {dq.length < 2 ? <Empty icon={<Search />} title="Search everything you keep here" hint="Words and meaning, in pages, database entries, files and references. A result opens at the exact paragraph." />
          : error ? <Empty icon={<TriangleAlert />} title="Search failed" hint={(error as Error).message} action={<Button className="h-11" onClick={() => refetch()}>Try again</Button>} />
          : !hits ? <div className="space-y-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}</div>
          : !hits.length ? <Empty icon={<Search />} title={`Nothing for “${dq}”`} hint={active ? "Filters are active — widen them, or search by meaning." : pending ? `${pending} recent item(s) are not indexed yet (see Index).` : "Try other words, or turn on search by meaning."} action={active ? <Button variant="outline" className="h-11" onClick={() => setF(DEFAULTS)}>Reset filters</Button> : undefined} />
          : <><ul data-testid="search-results" className="space-y-2">{hits.map((h) => { const file = h.kind === "file" && !h.pageId; return (
            <li key={h.chunkId}><Link href={hrefOf(h, terms.join(" "))} onClick={remember} target={file ? "_blank" : undefined} className="block rounded-2xl border border-line bg-bg-elev p-3.5 shadow-card active:bg-bg-sunk">
              <div className="flex items-start gap-2.5"><span className="mt-px w-5 shrink-0 text-center text-[17px] leading-none">{h.icon ?? (h.kind === "file" ? "📎" : h.kind === "entry" ? "🗂" : "📄")}</span>
                <div className="min-w-0 flex-1"><div className="break-words text-[15px] font-medium leading-snug [overflow-wrap:anywhere]">{h.title || "Untitled"}</div>{h.heading && <div className="truncate text-[12.5px] text-fg-faint">› {h.heading}</div>}</div></div>
              <p className="mt-1.5 line-clamp-3 break-words text-[13.5px] leading-5 text-fg-muted [overflow-wrap:anywhere]"><Snippet hit={h} terms={terms} /></p>
              <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11.5px] text-fg-faint"><Badge>{h.kind === "entry" ? "Entry" : h.kind === "file" ? "File" : h.kind === "reference" ? "Reference" : "Page"}</Badge>{h.section && h.kind !== "file" && <span className="capitalize">{h.section}</span>}{h.updatedAt && <span>· {timeAgo(h.updatedAt)}</span>}{h.archived && <Badge><Archive className="mr-1 size-3" />archived</Badge>}{inVoiceNote(h) && <Badge><AudioLines className="mr-1 size-3" />voice note transcript</Badge>}{h.semantic > 0 && h.keyword === 0 && <Badge tone="ai"><Sparkles className="mr-1 size-3" />by meaning</Badge>}{h.more ? <span>· +{h.more} more passage{h.more > 1 ? "s" : ""}</span> : null}</div>
            </Link></li>); })}</ul>
            <ListFooter testId="search-more" shown={hits.length} hasMore={paging.more || (isPlaceholderData && limit > SEARCH_PAGE_SIZE)} onMore={() => setMore({ base, limit: paging.nextLimit })} loading={isFetching} note={paging.capped ? `Showing the first ${hits.length} results. Refine the words or the filters to narrow the list.` : null} /></>}
      </div>}
      {tab === "index" && <div role="tabpanel" className="mt-3 space-y-4">
        {!stats ? (statsError ? <ErrorState testId="index-error" title="Could not load the index status" error={statsError} onRetry={() => refetchStats()} retrying={statsFetching} /> : <Skeleton className="h-32 rounded-2xl" />) : <>
          <div className={cn("flex items-start gap-2.5 rounded-2xl border p-3.5 text-[13.5px] leading-5", failed ? "border-danger/35 bg-danger/10" : pending || stats.health.queued ? "border-warning/40 bg-warning/15" : "border-success/30 bg-success/10")}>{failed ? <TriangleAlert className="mt-0.5 size-5 shrink-0 text-danger" /> : pending || stats.health.queued ? <Spinner className="mt-0.5" /> : <CircleCheck className="mt-0.5 size-5 shrink-0 text-success" />}<div className="min-w-0 flex-1">{failed ? `${failed} item${failed > 1 ? "s" : ""} could not be indexed.` : pending ? `${pending} item${pending > 1 ? "s" : ""} waiting to be indexed${stats.health.queued ? ` (${stats.health.queued} job${stats.health.queued > 1 ? "s" : ""} in the queue)` : " — nothing is queued: press Index pending"}.` : "Everything is indexed."}{!stats.health.embeddingsConfigured && <div className="mt-1 text-fg-muted">Search by meaning is not configured (no embedding provider key on the server): only exact words are searched.</div>}</div></div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{[["Pages", stats.pages], ["Files with text", stats.attachments], ["Passages", stats.chunks], ["With meaning vector", stats.embedded], ["Indexed sources", stats.indexed_sources], ["Old model", stats.stale]].map(([l, v]) => <div key={l as string} className="rounded-xl border border-line bg-bg-elev px-3 py-2.5"><div className="text-[11px] uppercase tracking-wider text-fg-faint">{l}</div><div className="text-lg font-semibold tabular-nums">{String(v)}</div></div>)}</div>
          <div className="grid gap-2 sm:grid-cols-2"><Button className="h-11" disabled={!pending && !failed} onClick={() => reindex("pending")}><RefreshCw /> Index pending{pending + failed ? ` (${pending + failed})` : ""}</Button><Button variant="outline" className="h-11" onClick={() => reindex("all")}><RefreshCw /> Rebuild everything</Button></div>
          <p className="text-[12.5px] leading-5 text-fg-faint">Model <code className="rounded bg-bg-sunk px-1">{stats.model}</code> v{stats.version}{stats.last_indexed ? ` · last indexed ${timeAgo(stats.last_indexed)}` : ""}. Indexing a page sends its text to the embedding provider; it happens after you edit, never when you merely open a page.</p>
          {failed > 0 && <section><h2 className="mb-1.5 text-[12px] font-semibold uppercase tracking-[0.08em] text-fg-faint">Failed</h2><ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-bg-elev">{stats.health.failed.map((x: any) => <li key={x.id} className="px-3.5 py-2.5 text-[13px]"><div className="break-words text-danger-text [overflow-wrap:anywhere]">{x.error}</div><div className="text-[12px] text-fg-faint">{x.sourceType} · {fmtDate(x.at, { dateStyle: "medium", timeStyle: "short" })}{x.sourceType === "page" && x.sourceId ? <> · <Link className="text-accent" href={`/p/${x.sourceId}`}>open page</Link></> : null}</div></li>)}</ul></section>}
          {stats.health.pending.length > 0 && <section><h2 className="mb-1.5 text-[12px] font-semibold uppercase tracking-[0.08em] text-fg-faint">Waiting</h2><ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-bg-elev">{stats.health.pending.slice(0, 20).map((p: any) => <li key={p.id}><Link href={`/p/${p.id}`} className="flex min-h-12 items-center gap-2.5 px-3.5 text-[14px]"><span className="w-5 text-center">{p.icon ?? "📄"}</span><span className="min-w-0 flex-1 truncate">{p.title || "Untitled"}</span><span className="shrink-0 text-[12px] text-fg-faint">{timeAgo(p.updatedAt)}</span></Link></li>)}</ul></section>}
        </>}
      </div>}
      {tab === "dups" && <div role="tabpanel" className="mt-3 space-y-2">
        {!dups ? (dupsError ? <ErrorState testId="duplicates-error" title="Could not load the duplicates" error={dupsError} onRetry={() => refetchDups()} retrying={dupsFetching} /> : <div className="space-y-2" aria-busy="true">{[0, 1].map((i) => <Skeleton key={i} className="h-28 rounded-2xl" />)}</div>) : !dups.length ? <Empty icon={<CopyIcon />} title="No near-duplicate pages" hint="Pairs of pages whose content is at least 93 % similar appear here." /> : dups.map((d: any, i: number) => <div key={i} className="rounded-2xl border border-line bg-bg-elev p-3.5 text-[14px]"><div className="mb-1.5 flex items-center gap-2"><Badge tone="warning">{(d.similarity * 100).toFixed(0)} % similar</Badge><span className="text-[12px] text-fg-faint">{d.a.wordCount} / {d.b.wordCount} words</span></div><Link className="flex min-h-11 items-center gap-2 break-words [overflow-wrap:anywhere]" href={`/p/${d.a.id}`}>{d.a.icon ?? "📄"} {d.a.title}</Link><Link className="flex min-h-11 items-center gap-2 break-words border-t border-line [overflow-wrap:anywhere]" href={`/p/${d.b.id}`}>{d.b.icon ?? "📄"} {d.b.title}</Link></div>)}
      </div>}
      <Dialog open={sheet} onOpenChange={setSheet}><SheetContent title="Filters" description="Kept on this device for your next searches.">{FiltersBody()}<Button className="mt-4 h-11 w-full" onClick={() => setSheet(false)}>Show results</Button></SheetContent></Dialog>
    </div>
  );
}
