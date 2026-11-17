"use client";
/**
 * Connections of one page as lists — the phone-first replacement for the canvas: outgoing links, backlinks, database
 * relations, AI links that were accepted (with the model's explanation and provenance) and AI suggestions waiting for
 * review. Every row says why the two pages are connected.
 */
import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, ArrowRightLeft, ChevronRight, ExternalLink, Link2, Paperclip, RefreshCw, Share2, Sparkles, Tag } from "lucide-react";
import { api } from "@/lib/client/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge, Dialog, Empty, SheetContent, Skeleton } from "@/components/ui/primitives";
import type { BacklinkRow, GraphData, GraphEdge, GraphNode, Suggestion } from "@/lib/graph/types";
import { Provenance, SuggestButton, SuggestionList } from "./SuggestionList";

export type PageConnections = GraphData & { suggestions?: Suggestion[] };
/** Depth-1 neighbourhood + pending suggestions of a page. Read-only: fetching it never calls an AI provider. */
export function usePageConnections(pageId: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: ["graph-neighbors", pageId, 1, "linked"],
    enabled: !!pageId && enabled,
    queryFn: () => api<PageConnections>(`/api/graph/neighbors?pageId=${pageId}&depth=1&linked=1`),
    staleTime: 30_000,
  });
}

interface Conn { key: string; node: GraphNode; edge: GraphEdge; why: string }
export interface ConnectionGroups { outgoing: Conn[]; backlinks: Conn[]; relations: Conn[]; ai: Conn[]; other: Conn[]; total: number }

/** Sort the edges touching `pageId` into the five lists, each with a plain-language reason. */
export function groupConnections(data: GraphData | undefined, pageId: string): ConnectionGroups {
  const g: ConnectionGroups = { outgoing: [], backlinks: [], relations: [], ai: [], other: [], total: 0 };
  if (!data) return g;
  const byId = new Map(data.nodes.map((n) => [n.id, n]));
  for (const edge of data.edges) {
    const out = edge.source === pageId;
    if (!out && edge.target !== pageId) continue;
    if (edge.status === "suggested") continue; // pending suggestions are reviewed separately, never listed as connections
    const node = byId.get(out ? edge.target : edge.source);
    if (!node) continue;
    const base = { key: edge.id, node, edge };
    if (edge.kind === "attachment") g.other.push({ ...base, why: "File attached to this page" });
    else if (edge.kind === "tag") g.other.push({ ...base, why: "Tag on this page" });
    else if (edge.kind === "relation") g.relations.push({ ...base, why: `Database relation “${edge.sub ?? "relation"}” ${out ? "from this row" : "pointing to this row"}` });
    else if (edge.kind === "ai_suggested" || edge.sub === "ai") g.ai.push({ ...base, why: edge.rationale?.trim() || "AI suggestion you accepted (no explanation was recorded)." });
    else if (out) g.outgoing.push({ ...base, why: "This page mentions or links to it" });
    else g.backlinks.push({ ...base, why: "It mentions or links to this page" });
  }
  const byTitle = (a: Conn, b: Conn) => a.node.title.localeCompare(b.node.title);
  for (const list of [g.outgoing, g.backlinks, g.relations, g.ai, g.other]) list.sort(byTitle);
  g.total = g.outgoing.length + g.backlinks.length + g.relations.length + g.ai.length;
  return g;
}

const KIND_ICON: Record<string, string> = { database: "🗂", research: "🔬", row: "▤" };
const hrefOf = (n: GraphNode): string | null => (n.kind === "attachment" ? `/api/files/${n.id.slice(4)}` : n.kind === "tag" ? null : `/p/${n.id}`);

function ConnRow({ c, icon }: { c: Conn; icon: React.ReactNode }) {
  const href = hrefOf(c.node);
  const isAi = c.edge.kind === "ai_suggested" || c.edge.sub === "ai";
  const body = (
    <>
      <span aria-hidden className="mt-0.5 grid size-6 shrink-0 place-items-center text-[15px] text-fg-faint [&_svg]:size-4">{c.node.kind === "attachment" ? <Paperclip /> : c.node.kind === "tag" ? <Tag /> : (c.node.icon ?? KIND_ICON[c.node.kind] ?? "📄")}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-medium leading-5 [overflow-wrap:anywhere]">{c.node.title || "Untitled"}</span>
        <span className="mt-0.5 flex items-start gap-1 text-[12.5px] leading-5 text-fg-muted"><span aria-hidden className="mt-1 shrink-0 [&_svg]:size-3">{icon}</span><span className="min-w-0 [overflow-wrap:anywhere]">{c.why}</span></span>
        {isAi && <Provenance model={c.edge.model ?? (c.edge.kind === "ai_suggested" ? c.edge.sub : null)} confidence={c.edge.confidence} className="mt-1" />}
      </span>
      {href && <ChevronRight aria-hidden className="mt-1 size-4 shrink-0 text-fg-faint" />}
    </>
  );
  const cls = "flex min-h-12 w-full items-start gap-2.5 px-3 py-2.5 text-left";
  if (!href) return <div className={cls}>{body}</div>;
  return c.node.kind === "attachment"
    ? <a href={href} target="_blank" rel="noreferrer" className={cn(cls, "hover:bg-bg-hover")}>{body}</a>
    : <Link href={href} className={cn(cls, "hover:bg-bg-hover")}>{body}</Link>;
}

function Section({ title, icon, items, rowIcon, limit }: { title: string; icon: React.ReactNode; items: Conn[]; rowIcon: React.ReactNode; limit?: number }) {
  const [all, setAll] = useState(false);
  if (!items.length) return null;
  const shown = limit && !all ? items.slice(0, limit) : items;
  return (
    <section aria-label={`${title}, ${items.length}`}>
      <h4 className="mb-1 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-fg-muted [&_svg]:size-3.5">{icon}{title}<span className="font-normal tabular-nums text-fg-faint">{items.length}</span></h4>
      <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-bg-elev">
        {shown.map((c) => <li key={c.key}><ConnRow c={c} icon={rowIcon} /></li>)}
      </ul>
      {limit && items.length > limit && (
        <button type="button" aria-expanded={all} onClick={() => setAll((v) => !v)} className="mt-1 h-11 rounded-lg px-2 text-[14px] font-medium text-accent hover:bg-accent-soft md:h-8 md:text-[13px]">
          {all ? "Show fewer" : `Show all ${items.length}`}
        </button>
      )}
    </section>
  );
}

/** The lists themselves (no fetching). `limit` caps each section with a "Show all" toggle. */
export function ConnectionsList({ pageId, data, limit, showSuggestions = true, showGenerate = true }: { pageId: string; data: PageConnections; limit?: number; showSuggestions?: boolean; showGenerate?: boolean }) {
  const groups = useMemo(() => groupConnections(data, pageId), [data, pageId]);
  const pending = data.suggestions ?? [];
  return (
    <div className="space-y-4">
      {groups.total === 0 && (
        <p className="rounded-xl border border-dashed border-line px-3 py-4 text-center text-[13px] leading-5 text-fg-muted">
          No connection yet. Mention another page with @ while writing{showGenerate ? ", or ask the AI for suggestions below" : ""}.
        </p>
      )}
      <Section title="Links from this page" icon={<ArrowUpRight />} rowIcon={<ArrowUpRight />} items={groups.outgoing} limit={limit} />
      <Section title="Backlinks" icon={<ArrowDownLeft />} rowIcon={<ArrowDownLeft />} items={groups.backlinks} limit={limit} />
      <Section title="Relations" icon={<ArrowRightLeft />} rowIcon={<ArrowRightLeft />} items={groups.relations} limit={limit} />
      <Section title="Accepted AI links" icon={<Sparkles />} rowIcon={<Sparkles />} items={groups.ai} limit={limit} />
      <Section title="Tags and files" icon={<Paperclip />} rowIcon={<Link2 />} items={groups.other} limit={limit} />
      {showSuggestions && pending.length > 0 && (
        <section aria-label={`AI suggestions to review, ${pending.length}`}>
          <h4 className="mb-1 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-ai"><Sparkles className="size-3.5" />Suggested by AI — to review<Badge tone="ai">{pending.length}</Badge></h4>
          <SuggestionList items={pending} dense />
        </section>
      )}
      {showGenerate && <SuggestButton pageId={pageId} />}
    </div>
  );
}

export function ConnectionsSkeleton() {
  return <div role="status" aria-label="Loading connections" className="space-y-2"><Skeleton className="h-4 w-32" /><Skeleton className="h-14 rounded-xl" /><Skeleton className="h-14 rounded-xl" /><Skeleton className="h-14 rounded-xl" /></div>;
}

/** Self-fetching panel: loading skeleton, error with retry, then the lists. */
export function ConnectionsPanel({ pageId, limit, showGenerate = true }: { pageId: string; limit?: number; showGenerate?: boolean }) {
  const q = usePageConnections(pageId);
  if (q.isLoading) return <ConnectionsSkeleton />;
  if (q.isError || !q.data) {
    return (
      <div role="alert">
        <Empty icon={<AlertTriangle />} title="Could not load the connections" hint={(q.error as any)?.message ?? "Check your connection and try again."} action={<Button size="sm" className="max-md:h-11 max-md:px-4" onClick={() => q.refetch()}><RefreshCw /> Retry</Button>} />
      </div>
    );
  }
  return <ConnectionsList pageId={pageId} data={q.data} limit={limit} showGenerate={showGenerate} />;
}

/** Details of one page's connections in a bottom sheet (phones) / dialog. */
export function ConnectionsSheet({ page, onClose, onOpenGraph }: { page: { id: string; title: string; icon?: string | null } | null; onClose: () => void; onOpenGraph?: (pageId: string) => void }) {
  return (
    <Dialog open={!!page} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent title={page ? `${page.icon ? `${page.icon} ` : ""}${page.title || "Untitled"}` : "Connections"} description="What this page is connected to, and why." onOpenAutoFocus={(e) => e.preventDefault()}>
        {page && (
          <div className="space-y-4 pb-1">
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="secondary" className="h-11 flex-1 text-[15px] md:h-8 md:flex-none md:text-[13px]"><Link href={`/p/${page.id}`}><ExternalLink /> Open page</Link></Button>
              {onOpenGraph && <Button variant="outline" className="h-11 flex-1 text-[15px] md:h-8 md:flex-none md:text-[13px]" onClick={() => onOpenGraph(page.id)}><Share2 /> Open full graph</Button>}
            </div>
            <ConnectionsPanel pageId={page.id} />
          </div>
        )}
      </SheetContent>
    </Dialog>
  );
}

const TYPE_ICON: Record<string, string> = { database: "🗂", research: "🔬" };
/** Pages as a list (rows ≥ 48 px) with their link counts; tapping one opens its connections. */
export function PagesList({ pages, onOpen }: { pages: BacklinkRow[]; onOpen: (p: BacklinkRow) => void }) {
  return (
    <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-bg-elev">
      {pages.map((p) => {
        const none = p.incoming === 0 && p.outgoing === 0;
        return (
          <li key={p.id}>
            <button type="button" onClick={() => onOpen(p)} aria-haspopup="dialog" className="flex min-h-14 w-full items-center gap-2.5 px-3 py-2 text-left active:bg-bg-hover">
              <span aria-hidden className="w-6 shrink-0 text-center text-[16px]">{p.icon ?? TYPE_ICON[p.type] ?? "📄"}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-medium leading-5 [overflow-wrap:anywhere]">{p.title}</span>
                <span className="mt-0.5 block text-[12.5px] text-fg-muted">
                  {none ? "No link yet" : `${p.incoming} backlink${p.incoming === 1 ? "" : "s"} · ${p.outgoing} outgoing`}
                  {p.suggested > 0 && <span className="text-ai"> · {p.suggested} AI suggestion{p.suggested === 1 ? "" : "s"} to review</span>}
                </span>
              </span>
              <ChevronRight aria-hidden className="size-4 shrink-0 text-fg-faint" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
