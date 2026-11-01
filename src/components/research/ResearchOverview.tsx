"use client";
/** Research dashboard: working-paper tracker + BibTeX library across all pages. */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { FlaskConical, Plus, Download, Search, BookMarked, Copy, ExternalLink, AlertTriangle } from "lucide-react";
import { api } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge, Dialog, DialogContent, Spinner, Empty, Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";
import { Select, PAPER_STATUSES, STATUS_TONE, VerifiedBadge, copy, shortAuthors } from "./ui";
import { timeAgo, cn, fmtDate } from "@/lib/utils";

export function ResearchOverview() {
  const r = useRouter(); const qc = useQueryClient();
  const { data: papers = [], isLoading } = useQuery<any[]>({ queryKey: ["research-overview"], queryFn: () => api("/api/research/overview") });
  const { data: refs = [] } = useQuery<any[]>({ queryKey: ["research-refs", "all"], queryFn: () => api("/api/research/references") });
  const [status, setStatus] = useState(""); const [q, setQ] = useState(""); const [newOpen, setNewOpen] = useState(false); const [title, setTitle] = useState(""); const [venue, setVenue] = useState(""); const [busy, setBusy] = useState(false);
  const list = papers.filter((p) => (!status || p.status === status) && (!q || p.title.toLowerCase().includes(q.toLowerCase())));
  const refList = refs.filter((x) => !q || `${x.citeKey} ${x.title} ${(x.authors ?? []).join(" ")} ${x.journal ?? ""} ${x.year ?? ""}`.toLowerCase().includes(q.toLowerCase()));
  const pageTitle = (id: string | null) => papers.find((p) => p.id === id)?.title ?? (id ? "Other page" : "Library");
  async function create() {
    if (busy) return; setBusy(true);
    try { const p = await api("/api/research/papers", { method: "POST", json: { title: title.trim() || undefined, venue: venue.trim() || undefined } }); qc.invalidateQueries({ queryKey: ["tree"] }); qc.invalidateQueries({ queryKey: ["research-overview"] }); toast("Working paper created", { tone: "success" }); setNewOpen(false); r.push(`/p/${p.id}`); }
    catch (e: any) { toast("Could not create", { description: e.message, tone: "danger" }); } finally { setBusy(false); }
  }
  const counts = PAPER_STATUSES.map((s) => [s, papers.filter((p) => p.status === s).length] as const);
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 md:px-8">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight"><FlaskConical className="size-5 text-accent" /> Research</h1>
        <span className="text-[13px] text-fg-muted">{papers.length} working paper{papers.length === 1 ? "" : "s"} · {refs.length} references</span>
        <span className="ml-auto flex items-center gap-1.5"><Button size="sm" variant="outline" onClick={() => window.open("/api/research/references/export.bib", "_blank")} disabled={!refs.length}><Download /> Export library .bib</Button><Button size="sm" onClick={() => setNewOpen(true)}><Plus /> New working paper</Button></span>
      </div>
      <div className="mt-4 flex flex-wrap gap-1.5">{counts.map(([s, n]) => <button key={s} onClick={() => setStatus(status === s ? "" : s)} className={cn("flex h-8 items-center gap-1.5 rounded-md border px-2 text-[12px] capitalize", status === s ? "border-accent/40 bg-accent-soft" : "border-line bg-bg-elev hover:bg-bg-sunk")}><Badge tone={STATUS_TONE[s]}>{n}</Badge>{s}</button>)}<div className="relative ml-auto w-full sm:w-64"><Search className="absolute left-2 top-2 size-3.5 text-fg-faint" /><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter papers and references" className="h-8 pl-7 text-[13px]" /></div></div>
      <Tabs defaultValue="papers" className="mt-4">
        <TabsList><TabsTrigger value="papers">Working papers</TabsTrigger><TabsTrigger value="library">BibTeX library</TabsTrigger></TabsList>
        <TabsContent value="papers" className="mt-3 outline-none">
          {isLoading ? <div className="flex justify-center py-10"><Spinner /></div> : !list.length ? <Empty icon={<FlaskConical />} title={papers.length ? "No paper matches" : "No working paper yet"} hint="Create one with the LaTeX-ready template, or set the type of an existing page to research." action={!papers.length ? <Button size="sm" onClick={() => setNewOpen(true)}><Plus /> New working paper</Button> : undefined} /> : (
            <>
              <table className="hidden w-full border-collapse text-[13px] md:table">
                <thead><tr className="text-left text-[11px] uppercase tracking-wide text-fg-faint"><th className="py-1.5 pr-2 font-medium">Paper</th><th className="py-1.5 pr-2 font-medium">Status</th><th className="py-1.5 pr-2 font-medium">Venue</th><th className="py-1.5 pr-2 font-medium">Deadline</th><th className="py-1.5 pr-2 text-right font-medium">Refs</th><th className="py-1.5 pr-2 text-right font-medium">Exp.</th><th className="py-1.5 pr-2 text-right font-medium">Open tasks</th><th className="py-1.5 pr-2 text-right font-medium">Words</th><th className="py-1.5 pr-2 font-medium">Last activity</th></tr></thead>
                <tbody>{list.map((p) => <Row key={p.id} p={p} />)}</tbody>
              </table>
              <div className="space-y-2 md:hidden">{list.map((p) => <Link key={p.id} href={`/p/${p.id}`} className="block rounded-lg border border-line bg-bg-elev p-3 hover:bg-bg-sunk"><div className="flex items-start gap-2"><span className="text-lg leading-none">{p.icon ?? "🔬"}</span><div className="min-w-0 flex-1"><div className="text-[13px] font-medium leading-snug">{p.title}</div><div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-fg-muted">{p.status ? <Badge tone={STATUS_TONE[p.status]} className="capitalize">{p.status}</Badge> : <Badge tone="neutral">no status</Badge>}{p.venue && <span>{p.venue}</span>}{p.deadline && <span>· due {p.deadline}</span>}</div><div className="mt-1 text-[11px] text-fg-faint">{p.references} refs · {p.experiments} exp. · <span className={p.overdueTasks ? "text-danger" : ""}>{p.openTasks} tasks</span> · {p.wordCount} words · {timeAgo(p.lastActivity)}</div></div></div></Link>)}</div>
            </>
          )}
        </TabsContent>
        <TabsContent value="library" className="mt-3 outline-none">
          {!refs.length ? <Empty icon={<BookMarked />} title="The library is empty" hint="References added to any working paper appear here; export them all as one .bib file." /> : (
            <>
              <table className="hidden w-full border-collapse text-[13px] sm:table">
                <thead><tr className="text-left text-[11px] uppercase tracking-wide text-fg-faint"><th className="py-1.5 pr-2 font-medium">Key</th><th className="py-1.5 pr-2 font-medium">Authors</th><th className="py-1.5 pr-2 font-medium">Year</th><th className="py-1.5 pr-2 font-medium">Title</th><th className="py-1.5 pr-2 font-medium">Journal</th><th className="py-1.5 pr-2 font-medium">Paper</th><th className="py-1.5 pr-2 font-medium">Status</th><th /></tr></thead>
                <tbody>{refList.map((x) => <tr key={x.id} className="border-t border-line align-top hover:bg-bg-sunk/60"><td className="py-1.5 pr-2"><button className="font-mono text-[12px] text-accent hover:underline" onClick={() => copy(`\\cite{${x.citeKey}}`, `\\cite{${x.citeKey}} copied`)}>{x.citeKey}</button></td><td className="py-1.5 pr-2 whitespace-nowrap">{shortAuthors(x.authors)}</td><td className="py-1.5 pr-2">{x.year ?? "—"}</td><td className="max-w-[24rem] py-1.5 pr-2"><span className="line-clamp-2">{x.title}</span></td><td className="max-w-[12rem] py-1.5 pr-2 text-fg-muted"><span className="line-clamp-2">{x.journal ?? "—"}</span></td><td className="max-w-[12rem] py-1.5 pr-2">{x.pageId ? <Link href={`/p/${x.pageId}`} className="line-clamp-2 text-fg-muted hover:text-accent">{pageTitle(x.pageId)}</Link> : <span className="text-fg-faint">—</span>}</td><td className="py-1.5 pr-2"><VerifiedBadge v={x.verified} /></td><td className="py-1 whitespace-nowrap"><button className="rounded p-1.5 text-fg-faint hover:bg-bg-sunk hover:text-fg" title="Copy BibTeX" onClick={() => copy(x.bibtex ?? "", "BibTeX copied")}><Copy className="size-3.5" /></button>{x.doi && <a href={`https://doi.org/${x.doi}`} target="_blank" rel="noopener noreferrer" className="inline-block rounded p-1.5 text-fg-faint hover:bg-bg-sunk hover:text-fg" title="Open DOI"><ExternalLink className="size-3.5" /></a>}</td></tr>)}</tbody>
              </table>
              <div className="space-y-2 sm:hidden">{refList.map((x) => <div key={x.id} className="rounded-lg border border-line bg-bg-elev p-3"><div className="flex flex-wrap items-center gap-1.5"><button className="font-mono text-[12px] text-accent" onClick={() => copy(`\\cite{${x.citeKey}}`, `\\cite{${x.citeKey}} copied`)}>{x.citeKey}</button><VerifiedBadge v={x.verified} /></div><div className="mt-1 text-[13px] font-medium leading-snug">{x.title}</div><div className="mt-0.5 text-[12px] text-fg-muted">{shortAuthors(x.authors)} · {x.year ?? "n.d."}{x.journal ? ` · ${x.journal}` : ""}</div>{x.pageId && <Link href={`/p/${x.pageId}`} className="mt-0.5 block truncate text-[11px] text-fg-faint hover:text-accent">{pageTitle(x.pageId)}</Link>}</div>)}</div>
              {!refList.length && <div className="py-6 text-center text-[13px] text-fg-muted">No reference matches “{q}”.</div>}
            </>
          )}
        </TabsContent>
      </Tabs>
      <Dialog open={newOpen} onOpenChange={setNewOpen}><DialogContent title="New working paper" description="Creates a research page in the Research section with a LaTeX-ready template (abstract, introduction, model with a displayed equation, data, results, conclusion).">
        <div className="space-y-3" onKeyDown={(e) => { if (e.key === "Enter") create(); }}>
          <label className="flex flex-col gap-1"><span className="text-[11px] font-medium uppercase tracking-wide text-fg-faint">Title</span><Input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Working Paper 35 — …" /></label>
          <label className="flex flex-col gap-1"><span className="text-[11px] font-medium uppercase tracking-wide text-fg-faint">Target venue (optional)</span><Input value={venue} onChange={(e) => setVenue(e.target.value)} placeholder="Journal of Financial Economics" /></label>
          <div className="flex justify-end gap-2"><Button variant="ghost" size="sm" onClick={() => setNewOpen(false)}>Cancel</Button><Button size="sm" onClick={create} disabled={busy}>{busy ? <Spinner className="size-3.5" /> : <Plus />} Create</Button></div>
        </div>
      </DialogContent></Dialog>
    </div>
  );
}
function Row({ p }: { p: any }) {
  const r = useRouter(); const soon = p.deadline && (new Date(p.deadline).getTime() - Date.now()) / 864e5 < 14;
  return (
    <tr className="cursor-pointer border-t border-line hover:bg-bg-sunk/60" onClick={() => r.push(`/p/${p.id}`)}>
      <td className="py-2 pr-2"><span className="mr-1.5">{p.icon ?? "🔬"}</span><Link href={`/p/${p.id}`} className="font-medium hover:text-accent" onClick={(e) => e.stopPropagation()}>{p.title}</Link></td>
      <td className="py-2 pr-2">{p.status ? <Badge tone={STATUS_TONE[p.status]} className="capitalize">{p.status}</Badge> : <span className="text-fg-faint">—</span>}</td>
      <td className="max-w-[12rem] truncate py-2 pr-2 text-fg-muted">{p.venue ?? "—"}</td>
      <td className={cn("py-2 pr-2 whitespace-nowrap", soon && "text-warning")}>{p.deadline ? fmtDate(p.deadline) : "—"}</td>
      <td className="py-2 pr-2 text-right tabular-nums">{p.references}</td>
      <td className="py-2 pr-2 text-right tabular-nums">{p.experiments}{p.experimentsRunning ? <span className="ml-1 text-[11px] text-accent">({p.experimentsRunning} running)</span> : null}</td>
      <td className={cn("py-2 pr-2 text-right tabular-nums", p.overdueTasks && "text-danger")}>{p.openTasks}{p.overdueTasks ? <AlertTriangle className="ml-1 inline size-3" /> : null}</td>
      <td className="py-2 pr-2 text-right tabular-nums text-fg-muted">{p.wordCount}</td>
      <td className="py-2 pr-2 whitespace-nowrap text-fg-muted">{timeAgo(p.lastActivity)}</td>
    </tr>
  );
}
