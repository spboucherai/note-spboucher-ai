"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link2, Search, Sparkles, ArrowRight, EyeOff, Share2 } from "lucide-react";
import { api } from "@/lib/client/api";
import { cn, timeAgo } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge, Empty, Spinner, Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";
import type { BacklinkRow, Suggestion, UnlinkedMention } from "@/lib/graph/types";
import { SuggestionList } from "./SuggestionList";

const ICON: Record<string, string> = { database: "🗂", research: "🔬" };
function Highlight({ text, term }: { text: string; term: string }) {
  const i = text.toLowerCase().indexOf(term.toLowerCase()); if (i < 0) return <>{text}</>;
  return <>{text.slice(0, i)}<mark className="rounded bg-accent-soft px-0.5 text-accent">{text.slice(i, i + term.length)}</mark>{text.slice(i + term.length)}</>;
}
export function BacklinksExplorer() {
  const qc = useQueryClient(); const [q, setQ] = useState(""); const [tab, setTab] = useState("pages");
  const data = useQuery({ queryKey: ["backlinks"], queryFn: () => api<{ pages: BacklinkRow[]; mentions: UnlinkedMention[] }>("/api/graph/backlinks"), staleTime: 10_000 });
  const sugg = useQuery({ queryKey: ["graph-suggestions"], queryFn: () => api<{ items: Suggestion[]; counts: Record<string, number> }>("/api/graph/suggestions"), staleTime: 10_000 });
  const pages = useMemo(() => { const s = q.trim().toLowerCase(); const all = data.data?.pages ?? []; return s ? all.filter((p) => p.title.toLowerCase().includes(s)) : all; }, [data.data, q]);
  const mentions = useMemo(() => { const s = q.trim().toLowerCase(); const all = data.data?.mentions ?? []; return s ? all.filter((m) => m.toTitle.toLowerCase().includes(s) || m.fromTitle.toLowerCase().includes(s)) : all; }, [data.data, q]);
  const act = useMutation({
    mutationFn: (v: { action: "link" | "dismiss"; fromId: string; toId: string }) => api("/api/graph/backlinks", { method: "POST", json: v }),
    onSuccess: (_d, v) => { toast(v.action === "link" ? "Link inserted" : "Mention dismissed", { description: v.action === "link" ? "A “See also” mention was appended to the page." : undefined, tone: v.action === "link" ? "success" : "neutral" }); qc.invalidateQueries({ queryKey: ["backlinks"] }); qc.invalidateQueries({ queryKey: ["graph"] }); },
    onError: (e: any) => toast("Action failed", { description: e.message, tone: "danger" }),
  });
  const totals = useMemo(() => { const all = data.data?.pages ?? []; return { links: all.reduce((a, p) => a + p.incoming, 0), orphans: all.filter((p) => p.incoming === 0 && p.outgoing === 0).length }; }, [data.data]);
  const pendingSugg = sugg.data?.items ?? [];
  return (
    <div className="mx-auto max-w-5xl px-4 py-6 md:px-6 md:py-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight"><Link2 className="size-5 text-fg-muted" /> Backlinks</h1><p className="mt-1 text-[13px] text-fg-muted">{data.data ? `${data.data.pages.length} pages · ${totals.links} links · ${totals.orphans} without any link · ${data.data.mentions.length} unlinked mention${data.data.mentions.length === 1 ? "" : "s"}` : "Loading…"}</p></div>
        <div className="flex items-center gap-2"><div className="relative w-56 max-w-full"><Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-fg-faint" /><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by title…" className="h-8 pl-8 text-[13px]" /></div><Button asChild size="sm" variant="outline"><Link href="/graph"><Share2 /> Graph</Link></Button></div>
      </div>
      <Tabs value={tab} onValueChange={setTab} className="mt-5">
        <TabsList><TabsTrigger value="pages">Pages</TabsTrigger><TabsTrigger value="mentions">Unlinked mentions {mentions.length ? <Badge tone="accent" className="ml-1.5 px-1">{mentions.length}</Badge> : null}</TabsTrigger><TabsTrigger value="ai">AI suggestions {pendingSugg.length ? <Badge tone="ai" className="ml-1.5 px-1">{pendingSugg.length}</Badge> : null}</TabsTrigger></TabsList>
        <TabsContent value="pages" className="mt-4">
          {data.isLoading ? <div className="flex justify-center py-10"><Spinner /></div> : !pages.length ? <Empty icon={<Link2 />} title="No page" hint={q ? "No title matches the filter." : "Create pages to see them here."} /> : (
            <div className="overflow-x-auto rounded-lg border border-line">
              <table className="w-full min-w-[560px] text-[13px]">
                <thead className="bg-bg-sunk text-[11px] uppercase tracking-wider text-fg-faint"><tr><th className="px-3 py-2 text-left font-medium">Page</th><th className="px-3 py-2 text-left font-medium">Section</th><th className="px-3 py-2 text-right font-medium">Incoming</th><th className="px-3 py-2 text-right font-medium">Outgoing</th><th className="px-3 py-2 text-right font-medium">AI</th><th className="px-3 py-2 text-right font-medium">Updated</th></tr></thead>
                <tbody>{pages.map((p) => (
                  <tr key={p.id} className="border-t border-line hover:bg-bg-sunk/60">
                    <td className="max-w-[360px] px-3 py-2"><Link href={`/p/${p.id}`} className="flex items-center gap-1.5 hover:underline"><span className="w-4 shrink-0 text-center">{p.icon ?? ICON[p.type] ?? "📄"}</span><span className="truncate">{p.title}</span></Link></td>
                    <td className="px-3 py-2 text-fg-muted">{p.section}</td>
                    <td className={cn("px-3 py-2 text-right tabular-nums", p.incoming ? "font-medium" : "text-fg-faint")}>{p.incoming}</td>
                    <td className={cn("px-3 py-2 text-right tabular-nums", p.outgoing ? "" : "text-fg-faint")}>{p.outgoing}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{p.suggested ? <Badge tone="ai">{p.suggested}</Badge> : <span className="text-fg-faint">–</span>}</td>
                    <td className="px-3 py-2 text-right text-fg-muted">{timeAgo(p.updatedAt)}</td>
                  </tr>))}</tbody>
              </table>
            </div>)}
        </TabsContent>
        <TabsContent value="mentions" className="mt-4">
          {data.isLoading ? <div className="flex justify-center py-10"><Spinner /></div> : !mentions.length ? <Empty icon={<Link2 />} title="No unlinked mention" hint="Every page whose text contains another page's exact title already links to it (or was dismissed)." /> : (
            <div className="space-y-2">{mentions.map((m) => (
              <div key={m.key} className="rounded-lg border border-line bg-bg-elev p-3">
                <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-[13px]"><Link href={`/p/${m.fromId}`} className="truncate font-medium hover:underline">{m.fromIcon ?? "📄"} {m.fromTitle}</Link><span className="text-fg-faint">mentions</span><Link href={`/p/${m.toId}`} className="truncate font-medium hover:underline">{m.toIcon ?? "📄"} {m.toTitle}</Link><ArrowRight className="hidden size-3.5 text-fg-faint sm:block" /></div>
                <p className="mt-1 text-[12.5px] leading-5 text-fg-muted">…<Highlight text={m.excerpt} term={m.toTitle} />…</p>
                <div className="mt-2 flex gap-1.5"><Button size="xs" className="h-8 md:h-7" disabled={act.isPending} onClick={() => act.mutate({ action: "link", fromId: m.fromId, toId: m.toId })}><Link2 /> Link it</Button><Button size="xs" variant="outline" className="h-8 md:h-7" disabled={act.isPending} onClick={() => act.mutate({ action: "dismiss", fromId: m.fromId, toId: m.toId })}><EyeOff /> Dismiss</Button></div>
              </div>))}</div>)}
        </TabsContent>
        <TabsContent value="ai" className="mt-4">
          <SuggestionList items={pendingSugg} loading={sugg.isLoading} emptyHint="Open the graph and press “Suggest connections” on a page, or run a whole-workspace pass from the Review panel." />
          {!!pendingSugg.length && <p className="mt-3 text-[12px] text-fg-faint"><Sparkles className="mr-1 inline size-3.5" />Accepted suggestions become real links and show up as backlinks on both pages.</p>}
        </TabsContent>
      </Tabs>
    </div>
  );
}
