"use client";
/** Research dashboard: working-paper tracker + BibTeX library across all pages. Cards on phones, tables from `md`. */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, BookMarked, ChevronRight, Download, FlaskConical, Plus, Search } from "lucide-react";
import { api } from "@/lib/client/api";
import { useOnline } from "@/lib/client/hooks";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge, Dialog, Empty, SheetContent, Spinner, Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";
import { ErrorBox, FIELD, Field, ListSkeleton, PAPER_STATUSES, STATUS_TONE, TButton, VerifiedBadge, copy, errText, shortAuthors, useDraft } from "./ui";
import { ReferenceCard, matchRef } from "./ReferencesTab";
import { ReferenceSheet, refKey } from "./ReferenceSheet";
import { AddReferenceSheet, EditReferenceSheet } from "./AddReference";
import { timeAgo, cn, fmtDate } from "@/lib/utils";

export function ResearchOverview() {
  const r = useRouter(); const qc = useQueryClient(); const online = useOnline();
  const papersQ = useQuery<any[]>({ queryKey: ["research-overview"], queryFn: () => api("/api/research/overview") });
  const refsQ = useQuery<any[]>({ queryKey: ["research-refs", "all"], queryFn: () => api("/api/research/references") });
  const papers = papersQ.data ?? []; const refs = refsQ.data ?? [];
  const [status, setStatus] = useState(""); const [q, setQ] = useState(""); const [newOpen, setNewOpen] = useState(false); const [busy, setBusy] = useState(false); const [createError, setCreateError] = useState<string | null>(null);
  const [draft, setDraft, clearDraft] = useDraft("new-paper", { title: "", venue: "" });
  const [openRef, setOpenRef] = useState<string | null>(null); const [editing, setEditing] = useState<any | null>(null); const [addOpen, setAddOpen] = useState(false);
  const list = papers.filter((p) => (!status || p.status === status) && (!q || p.title.toLowerCase().includes(q.toLowerCase())));
  const refList = refs.filter((x) => matchRef(x, q));
  const pageTitle = (id: string | null) => papers.find((p) => p.id === id)?.title ?? (id ? "Another page" : "Library");
  const refreshRefs = () => { qc.invalidateQueries({ queryKey: ["research-refs"] }); qc.invalidateQueries({ queryKey: ["research-overview"] }); };
  async function create() {
    if (busy) return; setBusy(true); setCreateError(null);
    try { const p = await api("/api/research/papers", { method: "POST", json: { title: draft.title.trim() || undefined, venue: draft.venue.trim() || undefined } }); qc.invalidateQueries({ queryKey: ["tree"] }); qc.invalidateQueries({ queryKey: ["research-overview"] }); clearDraft(); toast("Working paper created", { tone: "success" }); setNewOpen(false); r.push(`/p/${p.id}`); }
    catch (e) { setCreateError(errText(e)); } finally { setBusy(false); }
  }
  const counts = PAPER_STATUSES.map((s) => [s, papers.filter((p) => p.status === s).length] as const);
  const linkBtn = cn(buttonVariants({ variant: "outline", size: "sm" }), "h-11 px-3.5 md:h-8 md:px-2.5");
  return (
    <div className="mx-auto w-full min-w-0 max-w-6xl px-4 py-6 md:px-8">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight"><FlaskConical className="size-5 text-accent" /> Research</h1>
        <span className="text-[13px] text-fg-muted">{papers.length} working paper{papers.length === 1 ? "" : "s"} · {refs.length} reference{refs.length === 1 ? "" : "s"}</span>
        <span className="flex w-full flex-wrap items-center gap-2 md:ml-auto md:w-auto">{refs.length > 0 && <a href="/api/research/references/export.bib" download className={linkBtn}><Download /> Library .bib</a>}<TButton onClick={() => setNewOpen(true)}><Plus /> New working paper</TButton></span>
      </div>
      <div className="relative mt-4"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-faint" aria-hidden /><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter papers and references" aria-label="Filter papers and references" type="search" enterKeyHint="search" className={cn(FIELD, "pl-9 md:max-w-sm")} /></div>
      <Tabs defaultValue="papers" className="mt-4">
        <TabsList className="h-12 md:h-8 [&>button]:h-11 [&>button]:px-4 [&>button]:text-[14px] md:[&>button]:h-7 md:[&>button]:px-3 md:[&>button]:text-[13px]"><TabsTrigger value="papers">Working papers</TabsTrigger><TabsTrigger value="library">Library <span className="ml-1 text-fg-faint">{refs.length}</span></TabsTrigger></TabsList>
        <TabsContent value="papers" className="mt-3 outline-none">
          {papers.length > 0 && <div className="-mx-4 mb-3 flex gap-1.5 overflow-x-auto overscroll-x-contain px-4 [scrollbar-width:none] md:mx-0 md:flex-wrap md:px-0" role="group" aria-label="Filter by status">{counts.map(([s, n]) => <button key={s} type="button" aria-pressed={status === s} onClick={() => setStatus(status === s ? "" : s)} className={cn("flex h-11 shrink-0 items-center gap-1.5 rounded-md border px-3 text-[13px] capitalize md:h-8 md:px-2 md:text-[12px]", status === s ? "border-accent/40 bg-accent-soft" : "border-line bg-bg-elev hover:bg-bg-sunk")}><Badge tone={STATUS_TONE[s]}>{n}</Badge>{s}</button>)}</div>}
          {papersQ.isLoading ? <ListSkeleton rows={4} /> : papersQ.isError ? <ErrorBox title="Could not load the working papers" message={errText(papersQ.error)} onRetry={() => papersQ.refetch()} /> : !list.length ? <Empty icon={<FlaskConical />} title={papers.length ? "No paper matches" : "No working paper yet"} hint={papers.length ? "Change the status filter or the search." : "Create one with the LaTeX-ready template, or set the type of an existing page to research."} action={papers.length ? <TButton variant="outline" onClick={() => { setStatus(""); setQ(""); }}>Clear filters</TButton> : <TButton onClick={() => setNewOpen(true)}><Plus /> New working paper</TButton>} /> : (
            <>
              <div className="hidden overflow-x-auto overscroll-x-contain md:block"><table className="w-full border-collapse text-[13px]">
                <thead><tr className="text-left text-[11px] uppercase tracking-wide text-fg-faint"><th className="py-1.5 pr-2 font-medium">Paper</th><th className="py-1.5 pr-2 font-medium">Status</th><th className="py-1.5 pr-2 font-medium">Venue</th><th className="py-1.5 pr-2 font-medium">Deadline</th><th className="py-1.5 pr-2 text-right font-medium">Refs</th><th className="py-1.5 pr-2 text-right font-medium">Exp.</th><th className="py-1.5 pr-2 text-right font-medium">Open tasks</th><th className="py-1.5 pr-2 text-right font-medium">Words</th><th className="py-1.5 pr-2 font-medium">Last activity</th></tr></thead>
                <tbody>{list.map((p) => <Row key={p.id} p={p} />)}</tbody>
              </table></div>
              <ul className="space-y-2 md:hidden">{list.map((p) => <li key={p.id}><Link href={`/p/${p.id}`} className="flex min-h-16 items-center gap-2.5 rounded-lg border border-line bg-bg-elev p-3 hover:bg-bg-sunk"><span className="text-xl leading-none" aria-hidden>{p.icon ?? "🔬"}</span><span className="min-w-0 flex-1"><span className="block break-words text-[14px] font-medium leading-snug">{p.title}</span><span className="mt-1 flex flex-wrap items-center gap-1.5 text-[12px] text-fg-muted">{p.status ? <Badge tone={STATUS_TONE[p.status]} className="capitalize">{p.status}</Badge> : <Badge tone="neutral">no status</Badge>}{p.venue && <span className="max-w-full truncate">{p.venue}</span>}{p.deadline && <span>· due {fmtDate(p.deadline)}</span>}</span><span className="mt-1 block text-[12px] text-fg-faint">{p.references} refs · {p.experiments} exp. · <span className={p.overdueTasks ? "font-medium text-danger" : ""}>{p.openTasks} tasks{p.overdueTasks ? ` (${p.overdueTasks} overdue)` : ""}</span> · {timeAgo(p.lastActivity)}</span></span><ChevronRight className="size-4 shrink-0 text-fg-faint" aria-hidden /></Link></li>)}</ul>
            </>
          )}
        </TabsContent>
        <TabsContent value="library" className="mt-3 outline-none">
          <div className="mb-3 flex flex-wrap gap-2"><TButton variant="outline" onClick={() => setAddOpen(true)}><Plus /> Add to the library</TButton></div>
          {refsQ.isLoading ? <ListSkeleton rows={4} /> : refsQ.isError ? <ErrorBox title="Could not load the library" message={errText(refsQ.error)} onRetry={() => refsQ.refetch()} /> : !refs.length ? <Empty icon={<BookMarked />} title="The library is empty" hint="References added to any working paper appear here; export them all as one .bib file." action={<TButton onClick={() => setAddOpen(true)}><Plus /> Add a reference</TButton>} /> : (
            <>
              <div className="hidden overflow-x-auto overscroll-x-contain md:block"><table className="w-full border-collapse text-[13px]">
                <thead><tr className="text-left text-[11px] uppercase tracking-wide text-fg-faint"><th className="py-1.5 pr-2 font-medium">Key</th><th className="py-1.5 pr-2 font-medium">Authors</th><th className="py-1.5 pr-2 font-medium">Year</th><th className="py-1.5 pr-2 font-medium">Title</th><th className="py-1.5 pr-2 font-medium">Journal</th><th className="py-1.5 pr-2 font-medium">Paper</th><th className="py-1.5 pr-2 font-medium">Status</th></tr></thead>
                <tbody>{refList.map((x) => <tr key={x.id} className="cursor-pointer border-t border-line align-top hover:bg-bg-sunk/60" onClick={() => setOpenRef(x.id)}><td className="py-1.5 pr-2"><button type="button" className="font-mono text-[12px] text-accent hover:underline" title="Copy \cite{key}" onClick={(e) => { e.stopPropagation(); copy(`\\cite{${x.citeKey}}`, `\\cite{${x.citeKey}} copied`); }}>{x.citeKey}</button></td><td className="whitespace-nowrap py-1.5 pr-2">{shortAuthors(x.authors)}</td><td className="py-1.5 pr-2">{x.year ?? "—"}</td><td className="max-w-[24rem] py-1.5 pr-2"><button type="button" className="line-clamp-2 text-left hover:text-accent" onClick={(e) => { e.stopPropagation(); setOpenRef(x.id); }}>{x.title}</button></td><td className="max-w-[12rem] py-1.5 pr-2 text-fg-muted"><span className="line-clamp-2">{x.journal ?? "—"}</span></td><td className="max-w-[12rem] py-1.5 pr-2">{x.pageId ? <Link href={`/p/${x.pageId}`} onClick={(e) => e.stopPropagation()} className="line-clamp-2 text-fg-muted hover:text-accent">{pageTitle(x.pageId)}</Link> : <span className="text-fg-faint">—</span>}</td><td className="py-1.5 pr-2"><VerifiedBadge v={x.verified} /></td></tr>)}</tbody>
              </table></div>
              <ul className="space-y-2 md:hidden">{refList.map((x) => <ReferenceCard key={x.id} r={x} onOpen={() => setOpenRef(x.id)} footer={x.pageId ? <span className="mt-1 block truncate text-[12px] text-fg-faint">In: {pageTitle(x.pageId)}</span> : undefined} />)}</ul>
              {!refList.length && <div className="py-6 text-center text-[13px] text-fg-muted">No reference matches “{q}”. <button type="button" className="text-accent underline-offset-2 hover:underline" onClick={() => setQ("")}>Clear the search</button></div>}
            </>
          )}
        </TabsContent>
      </Tabs>
      <Dialog open={newOpen} onOpenChange={setNewOpen}><SheetContent title="New working paper" description="Creates a research page with a LaTeX-ready template (abstract, introduction, model with a displayed equation, data, results, conclusion).">
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void create(); }}>
          <Field label="Title"><Input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="Working Paper 35 — …" className={FIELD} /></Field>
          <Field label="Target venue (optional)"><Input value={draft.venue} onChange={(e) => setDraft({ ...draft, venue: e.target.value })} placeholder="Journal of Financial Economics" className={FIELD} /></Field>
          {createError && <ErrorBox className="mt-0" title="Not created — your entries are still here" message={createError} onRetry={create} />}
          {!online && <p className="text-[12px] text-fg-muted">You are offline. The form keeps your entries; create the paper when the connection is back.</p>}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><TButton type="button" variant="ghost" onClick={() => setNewOpen(false)}>Close</TButton><TButton type="submit" disabled={busy || !online}>{busy ? <Spinner className="size-3.5 border-t-white" /> : <Plus />} Create</TButton></div>
        </form>
      </SheetContent></Dialog>
      <AddReferenceSheet open={addOpen} onOpenChange={setAddOpen} pageId={null} onDone={refreshRefs} onOpenRef={(id) => setOpenRef(id)} />
      <ReferenceSheet refId={openRef} pageId={null} onClose={() => setOpenRef(null)} onChanged={refreshRefs} onEdit={(x) => { setOpenRef(null); setEditing(x); }} />
      <EditReferenceSheet reference={editing} onClose={() => setEditing(null)} onDone={(x) => { setEditing(null); qc.setQueryData(refKey(x.id), x); refreshRefs(); setOpenRef(x.id); }} />
    </div>
  );
}
function Row({ p }: { p: any }) {
  const r = useRouter(); const soon = p.deadline && (new Date(p.deadline).getTime() - Date.now()) / 864e5 < 14;
  return (
    <tr className="cursor-pointer border-t border-line hover:bg-bg-sunk/60" onClick={() => r.push(`/p/${p.id}`)}>
      <td className="py-2 pr-2"><span className="mr-1.5" aria-hidden>{p.icon ?? "🔬"}</span><Link href={`/p/${p.id}`} className="font-medium hover:text-accent" onClick={(e) => e.stopPropagation()}>{p.title}</Link></td>
      <td className="py-2 pr-2">{p.status ? <Badge tone={STATUS_TONE[p.status]} className="capitalize">{p.status}</Badge> : <span className="text-fg-faint">—</span>}</td>
      <td className="max-w-[12rem] truncate py-2 pr-2 text-fg-muted">{p.venue ?? "—"}</td>
      <td className={cn("whitespace-nowrap py-2 pr-2", soon && "text-warning")}>{p.deadline ? fmtDate(p.deadline) : "—"}</td>
      <td className="py-2 pr-2 text-right tabular-nums">{p.references}</td>
      <td className="py-2 pr-2 text-right tabular-nums">{p.experiments}{p.experimentsRunning ? <span className="ml-1 text-[11px] text-accent">({p.experimentsRunning} running)</span> : null}</td>
      <td className={cn("py-2 pr-2 text-right tabular-nums", p.overdueTasks && "text-danger")}>{p.openTasks}{p.overdueTasks ? <><AlertTriangle className="ml-1 inline size-3" aria-hidden /><span className="sr-only"> {p.overdueTasks} overdue</span></> : null}</td>
      <td className="py-2 pr-2 text-right tabular-nums text-fg-muted">{p.wordCount}</td>
      <td className="whitespace-nowrap py-2 pr-2 text-fg-muted">{timeAgo(p.lastActivity)}</td>
    </tr>
  );
}
