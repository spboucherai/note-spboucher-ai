"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, RefreshCw, Copy as CopyIcon, Database, Files } from "lucide-react";
import { api } from "@/lib/client/api";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge, Empty, Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";
import { timeAgo, cn } from "@/lib/utils";
export function SearchPage({ initialQuery }: { initialQuery: string }) {
  const [q, setQ] = useState(initialQuery); const [dq, setDq] = useState(initialQuery); const [types, setTypes] = useState<string[]>([]); const [semantic, setSemantic] = useState(true); const qc = useQueryClient();
  useEffect(() => { const t = setTimeout(() => setDq(q), 300); return () => clearTimeout(t); }, [q]);
  const { data: hits = [], isFetching } = useQuery({ queryKey: ["search-full", dq, types, semantic], queryFn: () => api(`/api/search?mode=hybrid&q=${encodeURIComponent(dq)}&limit=40&semantic=${semantic ? 1 : 0}${types.length ? `&types=${types.join(",")}` : ""}`), enabled: dq.trim().length > 1 });
  const { data: stats } = useQuery({ queryKey: ["index-stats"], queryFn: () => api("/api/search/index-state"), refetchInterval: 10_000 });
  const { data: dups = [] } = useQuery({ queryKey: ["duplicates"], queryFn: () => api("/api/search/duplicates") });
  const toggleType = (t: string) => setTypes((s) => (s.includes(t) ? s.filter((x) => x !== t) : [...s, t]));
  return (
    <div className="mx-auto max-w-4xl px-4 py-6 md:px-8">
      <div className="flex items-center gap-2"><Search className="size-5 text-fg-muted" /><h1 className="text-xl font-semibold tracking-tight">Search</h1></div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search content semantically and by keyword…" className="h-10 flex-1 min-w-[16rem] text-[15px]" />
        <button onClick={() => setSemantic(!semantic)} className={cn("h-8 rounded-md border px-2 text-[12px]", semantic ? "border-accent/30 bg-accent-soft text-accent" : "border-line text-fg-muted")}>Semantic {semantic ? "on" : "off"}</button>
        {[["page", "Pages", <Files key="p" className="size-3.5" />], ["attachment", "Files", <Files key="f" className="size-3.5" />], ["row", "Rows", <Database key="r" className="size-3.5" />]].map(([t, l, ic]) => <button key={t as string} onClick={() => toggleType(t as string)} className={cn("flex h-8 items-center gap-1 rounded-md border px-2 text-[12px]", types.includes(t as string) ? "border-accent/30 bg-accent-soft text-accent" : "border-line text-fg-muted")}>{ic}{l}</button>)}
      </div>
      <Tabs defaultValue="results" className="mt-4">
        <TabsList><TabsTrigger value="results">Results {dq && `(${hits.length})`}</TabsTrigger><TabsTrigger value="index">Index</TabsTrigger><TabsTrigger value="dups">Duplicates {dups.length ? `(${dups.length})` : ""}</TabsTrigger></TabsList>
        <TabsContent value="results" className="mt-3 space-y-1.5">
          {!dq.trim() ? <Empty icon={<Search />} title="Type to search your workspace" hint="Hybrid retrieval: keyword (full-text) fused with semantic (pgvector) similarity." /> : isFetching && !hits.length ? <div className="py-10 text-center text-sm text-fg-muted pulse-soft">Searching…</div> : !hits.length ? <Empty title="No results" /> : (hits as any[]).map((h) => (
            <Link key={h.chunkId} href={h.pageId ? `/p/${h.pageId}${h.blockId ? `#block-${h.blockId}` : ""}` : "#"} className="block rounded-lg border border-line bg-bg-elev px-3 py-2.5 hover:bg-bg-sunk">
              <div className="flex items-center gap-2 text-[13px] font-medium"><span>{h.icon ?? (h.sourceType === "attachment" ? "📎" : "📄")}</span><span className="truncate">{h.title}</span>{h.heading && <span className="truncate text-fg-faint">› {h.heading}</span>}<span className="ml-auto flex gap-1">{h.semantic > 0 && <Badge tone="ai">sem {(h.semantic * 100).toFixed(0)}%</Badge>}{h.keyword > 0 && <Badge>kw</Badge>}</span></div>
              <div className="mt-1 line-clamp-3 text-[13px] text-fg-muted">{h.content}</div>
            </Link>))}
        </TabsContent>
        <TabsContent value="index" className="mt-3">
          {stats && <div className="grid gap-2 sm:grid-cols-3">{[["Pages", stats.pages], ["Files with text", stats.attachments], ["Chunks", stats.chunks], ["Embedded chunks", stats.embedded], ["Indexed sources", stats.indexed_sources], ["Stale (old model)", stats.stale]].map(([l, v]) => <div key={l as string} className="rounded-lg border border-line bg-bg-elev px-3 py-2"><div className="text-[11px] uppercase tracking-wider text-fg-faint">{l}</div><div className="text-lg font-semibold">{String(v)}</div></div>)}</div>}
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[13px] text-fg-muted"><span>Embedding model <code className="rounded bg-bg-sunk px-1">{stats?.model}</code> v{stats?.version}</span>{stats?.last_indexed && <span>· last indexed {timeAgo(stats.last_indexed)}</span>}<Button size="sm" variant="outline" className="ml-auto" onClick={async () => { await api("/api/search/index-state", { method: "POST" }); toast("Reindex queued", { description: "Unchanged content is skipped; changed chunks are re-embedded." }); qc.invalidateQueries({ queryKey: ["index-stats"] }); }}><RefreshCw /> Rebuild index</Button></div>
        </TabsContent>
        <TabsContent value="dups" className="mt-3 space-y-1.5">
          {!dups.length ? <Empty icon={<CopyIcon />} title="No near-duplicate pages" hint="Pairs of pages whose content embeddings are ≥ 93 % similar appear here." /> : (dups as any[]).map((d, i) => <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-bg-elev px-3 py-2 text-[13px]"><Badge tone="warning">{(d.similarity * 100).toFixed(0)}%</Badge><Link className="hover:underline" href={`/p/${d.a.id}`}>{d.a.icon ?? "📄"} {d.a.title}</Link><span className="text-fg-faint">≈</span><Link className="hover:underline" href={`/p/${d.b.id}`}>{d.b.icon ?? "📄"} {d.b.title}</Link><span className="ml-auto text-[11px] text-fg-faint">{d.a.wordCount} / {d.b.wordCount} words</span></div>)}
        </TabsContent>
      </Tabs>
    </div>
  );
}
