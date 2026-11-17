"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Link2, Search, Sparkles, ArrowRight, EyeOff, RefreshCw, Share2, WifiOff } from "lucide-react";
import { api } from "@/lib/client/api";
import { useIsPhone, useOnline } from "@/lib/client/hooks";
import { cn, timeAgo } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge, Empty, Skeleton, Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";
import type { BacklinkRow, Suggestion, UnlinkedMention } from "@/lib/graph/types";
import { SuggestButton, SuggestionList } from "./SuggestionList";
import { ConnectionsSheet, PagesList } from "./ConnectionsList";

const ICON: Record<string, string> = { database: "🗂", research: "🔬" };
function Highlight({ text, term }: { text: string; term: string }) {
  const i = text.toLowerCase().indexOf(term.toLowerCase());
  if (i < 0) return <>{text}</>;
  return <>{text.slice(0, i)}<mark className="rounded bg-accent-soft px-0.5 text-accent">{text.slice(i, i + term.length)}</mark>{text.slice(i + term.length)}</>;
}
type MentionAction = { action: "link" | "dismiss" | "undismiss"; fromId: string; toId: string };

/**
 * Connections as lists: pages with their link counts (tap one for the detail of its links, backlinks, relations and
 * AI links), unlinked mentions, and the AI suggestion review. This is also the phone version of /graph: with
 * `onOpenCanvas` an "Open full graph" button leads to the canvas as a secondary view.
 */
export function BacklinksExplorer({ title = "Backlinks", focus, onOpenCanvas }: { title?: string; focus?: string | null; onOpenCanvas?: (pageId?: string | null) => void } = {}) {
  const qc = useQueryClient();
  const phone = useIsPhone();
  const online = useOnline();
  const [q, setQ] = useState("");
  const [tab, setTab] = useState("pages");
  const [open, setOpen] = useState<{ id: string; title: string; icon?: string | null } | null>(null);
  const data = useQuery({ queryKey: ["backlinks"], queryFn: () => api<{ pages: BacklinkRow[]; mentions: UnlinkedMention[] }>("/api/graph/backlinks"), staleTime: 10_000 });
  const sugg = useQuery({ queryKey: ["graph-suggestions"], queryFn: () => api<{ items: Suggestion[]; counts: Record<string, number> }>("/api/graph/suggestions"), staleTime: 10_000 });

  const needle = q.trim().toLowerCase();
  const pages = useMemo(() => { const all = data.data?.pages ?? []; return needle ? all.filter((p) => p.title.toLowerCase().includes(needle)) : all; }, [data.data, needle]);
  const mentions = useMemo(() => { const all = data.data?.mentions ?? []; return needle ? all.filter((m) => m.toTitle.toLowerCase().includes(needle) || m.fromTitle.toLowerCase().includes(needle)) : all; }, [data.data, needle]);
  const totals = useMemo(() => { const all = data.data?.pages ?? []; return { links: all.reduce((a, p) => a + p.incoming, 0), orphans: all.filter((p) => p.incoming === 0 && p.outgoing === 0).length }; }, [data.data]);
  const pendingSugg = sugg.data?.items ?? [];

  // Arriving with a focused page (/graph?focus=…): open its connections once the list knows its title.
  const [focusDone, setFocusDone] = useState(false);
  useEffect(() => {
    if (!focus || focusDone || !data.data) return;
    const p = data.data.pages.find((x) => x.id === focus);
    setOpen(p ? { id: p.id, title: p.title, icon: p.icon } : { id: focus, title: "Page" });
    setFocusDone(true);
  }, [focus, focusDone, data.data]);

  const act = useMutation({
    mutationFn: (v: MentionAction) => api("/api/graph/backlinks", { method: "POST", json: v }),
    onSuccess: (_d, v) => {
      if (v.action === "link") toast("Link inserted", { description: "A “See also” mention was appended to the page. Remove it from the page (or its version history) to undo.", tone: "success" });
      else if (v.action === "dismiss") toast("Mention dismissed", { action: { label: "Undo", run: () => act.mutate({ ...v, action: "undismiss" }) } });
      else toast("Mention restored");
      qc.invalidateQueries({ queryKey: ["backlinks"] });
      qc.invalidateQueries({ queryKey: ["graph"] });
      qc.invalidateQueries({ queryKey: ["graph-neighbors"] });
    },
    onError: (e: any, v) => toast(v.action === "link" ? "Link not inserted" : "Action failed", { description: e?.message ?? "Nothing was changed. Try again.", tone: "danger" }),
  });

  const loadError = data.isError && !data.data ? (
    <div role="alert">
      <Empty icon={<AlertTriangle />} title="Could not load the connections" hint={(data.error as any)?.message ?? "Check your connection and try again."} action={<Button size="sm" className="max-md:h-11 max-md:px-4" onClick={() => data.refetch()}><RefreshCw /> Retry</Button>} />
    </div>
  ) : null;
  const listSkeleton = <div role="status" aria-label="Loading" className="space-y-2">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-14 rounded-xl" />)}</div>;
  const actionBtn = "h-8 md:h-7 max-md:h-11 max-md:flex-1 max-md:text-[14px]";

  return (
    <div className="mx-auto w-full min-w-0 max-w-5xl px-4 py-6 md:px-6 md:py-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight"><Link2 className="size-5 text-fg-muted" /> {title}</h1>
          <p className="mt-1 text-[13px] leading-5 text-fg-muted" role="status">
            {data.data ? `${data.data.pages.length} pages · ${totals.links} links · ${totals.orphans} without any link · ${data.data.mentions.length} unlinked mention${data.data.mentions.length === 1 ? "" : "s"}` : data.isError ? "Not loaded" : "Loading…"}
          </p>
        </div>
        <div className="flex w-full min-w-0 items-center gap-2 md:w-auto">
          <div className="relative min-w-0 flex-1 md:w-56 md:flex-none">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-faint md:left-2.5" />
            <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by title…" aria-label="Filter pages by title" className="h-11 pl-9 text-[16px] md:h-8 md:pl-8 md:text-[13px]" />
          </div>
          {onOpenCanvas
            ? <Button variant="outline" className="h-11 shrink-0 px-3 text-[14px] md:h-8 md:text-[13px]" onClick={() => onOpenCanvas(null)}><Share2 /> Open full graph</Button>
            : <Button asChild variant="outline" className="h-11 shrink-0 px-3 text-[14px] md:h-8 md:text-[13px]"><Link href="/graph"><Share2 /> Graph</Link></Button>}
        </div>
      </div>
      {!online && <p role="status" className="mt-3 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/15 px-3 py-2 text-[13px] leading-5"><WifiOff className="mt-0.5 size-4 shrink-0" />You are offline. The lists show what was loaded last; linking, dismissing and AI suggestions need a connection.</p>}

      <Tabs value={tab} onValueChange={setTab} className="mt-5 min-w-0">
        <div className="-mx-1 overflow-x-auto overscroll-x-contain px-1 [scrollbar-width:none]">
          <TabsList className="max-md:h-12">
            <TabsTrigger value="pages" className="max-md:h-11 max-md:px-3.5 max-md:text-[14px]">Pages</TabsTrigger>
            <TabsTrigger value="mentions" className="shrink-0 max-md:h-11 max-md:px-3.5 max-md:text-[14px]">Unlinked mentions {mentions.length ? <Badge tone="accent" className="ml-1.5 px-1">{mentions.length}</Badge> : null}</TabsTrigger>
            <TabsTrigger value="ai" className="shrink-0 max-md:h-11 max-md:px-3.5 max-md:text-[14px]">AI suggestions {pendingSugg.length ? <Badge tone="ai" className="ml-1.5 px-1">{pendingSugg.length}</Badge> : null}</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="pages" className="mt-4">
          {data.isLoading ? listSkeleton : loadError ?? (!pages.length ? (
            <Empty icon={<Link2 />} title={q ? "No page matches" : "No page yet"} hint={q ? "No title contains this text." : "Create pages and mention them with @ to see their connections here."} action={q ? <Button size="sm" variant="outline" className="max-md:h-11 max-md:px-4" onClick={() => setQ("")}>Clear the filter</Button> : <Button asChild size="sm" className="max-md:h-11 max-md:px-4"><Link href="/">Go to Home</Link></Button>} />
          ) : phone ? (
            <PagesList pages={pages} onOpen={(p) => setOpen({ id: p.id, title: p.title, icon: p.icon })} />
          ) : (
            <div className="overflow-x-auto overscroll-x-contain rounded-lg border border-line">
              <table className="w-full min-w-[560px] text-[13px]">
                <thead className="bg-bg-sunk text-[11px] uppercase tracking-wider text-fg-faint"><tr><th className="px-3 py-2 text-left font-medium">Page</th><th className="px-3 py-2 text-left font-medium">Section</th><th className="px-3 py-2 text-right font-medium">Incoming</th><th className="px-3 py-2 text-right font-medium">Outgoing</th><th className="px-3 py-2 text-right font-medium">AI</th><th className="px-3 py-2 text-right font-medium">Updated</th><th className="px-3 py-2"><span className="sr-only">Connections</span></th></tr></thead>
                <tbody>{pages.map((p) => (
                  <tr key={p.id} className="border-t border-line hover:bg-bg-sunk/60">
                    <td className="max-w-[360px] px-3 py-2"><Link href={`/p/${p.id}`} className="flex items-center gap-1.5 hover:underline"><span aria-hidden className="w-4 shrink-0 text-center">{p.icon ?? ICON[p.type] ?? "📄"}</span><span className="truncate">{p.title}</span></Link></td>
                    <td className="px-3 py-2 text-fg-muted">{p.section}</td>
                    <td className={cn("px-3 py-2 text-right tabular-nums", p.incoming ? "font-medium" : "text-fg-faint")}>{p.incoming}</td>
                    <td className={cn("px-3 py-2 text-right tabular-nums", p.outgoing ? "" : "text-fg-faint")}>{p.outgoing}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{p.suggested ? <Badge tone="ai">{p.suggested}</Badge> : <span className="text-fg-faint">–</span>}</td>
                    <td className="px-3 py-2 text-right text-fg-muted">{timeAgo(p.updatedAt)}</td>
                    <td className="px-2 py-1 text-right"><Button size="xs" variant="ghost" onClick={() => setOpen({ id: p.id, title: p.title, icon: p.icon })}>Details</Button></td>
                  </tr>))}</tbody>
              </table>
            </div>
          ))}
        </TabsContent>

        <TabsContent value="mentions" className="mt-4">
          {data.isLoading ? listSkeleton : loadError ?? (!mentions.length ? (
            <Empty icon={<Link2 />} title="No unlinked mention" hint={q ? "No mention matches the filter." : "Every page whose text contains another page's exact title already links to it (or was dismissed)."} action={q ? <Button size="sm" variant="outline" className="max-md:h-11 max-md:px-4" onClick={() => setQ("")}>Clear the filter</Button> : undefined} />
          ) : (
            <div className="space-y-2">{mentions.map((m) => {
              const busy = act.isPending && act.variables?.fromId === m.fromId && act.variables?.toId === m.toId;
              return (
                <div key={m.key} className="rounded-xl border border-line bg-bg-elev p-3">
                  <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[13px] max-md:text-[14px]">
                    <Link href={`/p/${m.fromId}`} className="min-w-0 font-medium [overflow-wrap:anywhere] hover:underline max-md:inline-flex max-md:min-h-11 max-md:items-center">{m.fromIcon ?? "📄"} {m.fromTitle}</Link>
                    <span className="text-fg-muted">mentions</span>
                    <Link href={`/p/${m.toId}`} className="min-w-0 font-medium [overflow-wrap:anywhere] hover:underline max-md:inline-flex max-md:min-h-11 max-md:items-center">{m.toIcon ?? "📄"} {m.toTitle}</Link>
                    <ArrowRight aria-hidden className="hidden size-3.5 text-fg-faint sm:block" />
                  </div>
                  <p className="mt-1 text-[12.5px] leading-5 text-fg-muted [overflow-wrap:anywhere] max-md:text-[13.5px]">…<Highlight text={m.excerpt} term={m.toTitle} />…</p>
                  <div className="mt-2 flex gap-1.5 max-md:gap-2">
                    <Button size="xs" className={actionBtn} disabled={busy || !online} onClick={() => act.mutate({ action: "link", fromId: m.fromId, toId: m.toId })}><Link2 /> Link it</Button>
                    <Button size="xs" variant="outline" className={actionBtn} disabled={busy || !online} onClick={() => act.mutate({ action: "dismiss", fromId: m.fromId, toId: m.toId })}><EyeOff /> Dismiss</Button>
                  </div>
                </div>
              );
            })}</div>
          ))}
        </TabsContent>

        <TabsContent value="ai" className="mt-4 space-y-4">
          <SuggestionList
            items={pendingSugg}
            loading={sugg.isLoading}
            error={sugg.isError ? sugg.error : null}
            onRetry={() => sugg.refetch()}
            emptyHint="Suggestions are only generated when you ask: per page (open a page's connections), or for the whole workspace with the button below. Nothing becomes a link until you accept it."
          />
          {!!pendingSugg.length && <p className="text-[12px] leading-5 text-fg-muted"><Sparkles className="mr-1 inline size-3.5" />Accepted suggestions become real links and show up as backlinks on both pages. Every decision can be undone.</p>}
          <SuggestButton pageId={null} className="rounded-xl border border-line p-3" />
        </TabsContent>
      </Tabs>

      <ConnectionsSheet page={open} onClose={() => setOpen(null)} onOpenGraph={onOpenCanvas ? (id) => { setOpen(null); onOpenCanvas(id); } : undefined} />
    </div>
  );
}
