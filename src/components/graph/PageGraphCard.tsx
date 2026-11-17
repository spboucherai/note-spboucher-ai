"use client";
/**
 * Connections of a page (page footer / dashboard).
 * Phones: lists first (links, backlinks, relations, accepted AI links, suggestions to review); the canvas is a
 * secondary view opened with "Open full graph", inside a fixed-height frame that does not capture page scrolling
 * until it is explicitly activated. Desktop: the compact canvas, with the same lists one click away.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Hand, List, Maximize2, RefreshCw, Share2, X } from "lucide-react";
import { api } from "@/lib/client/api";
import { useIsPhone, useIsTouch } from "@/lib/client/hooks";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/primitives";
import type { GraphData, GraphNode } from "@/lib/graph/types";
import { GraphCanvas, type GraphCanvasHandle } from "./GraphCanvas";
import { ConnectionsPanel, groupConnections, usePageConnections } from "./ConnectionsList";

export function PageGraphCard({ pageId, depth = 1, height = 220, className, title = "Connections" }: { pageId: string; depth?: 1 | 2 | 3; height?: number; className?: string; title?: string | null }) {
  const phone = useIsPhone();
  return phone
    ? <PhoneCard pageId={pageId} className={className} title={title} />
    : <DesktopCard pageId={pageId} depth={depth} height={height} className={className} title={title} />;
}

// ---------- phone: list first
function PhoneCard({ pageId, className, title }: { pageId: string; className?: string; title: string | null }) {
  const q = usePageConnections(pageId);
  const [canvas, setCanvas] = useState(false);
  const groups = groupConnections(q.data, pageId);
  const pending = q.data?.suggestions?.length ?? 0;
  return (
    <div className={cn("min-w-0", className)}>
      {title !== null && (
        <div className="mb-2 flex items-center gap-2 text-[13px] font-medium text-fg-muted">
          <Share2 className="size-4" />
          <span className="min-w-0 flex-1">{title}{q.data ? ` · ${groups.total}` : ""}{pending ? ` · ${pending} to review` : ""}</span>
        </div>
      )}
      {/* title === null: embedded in a dashboard widget — shorter lists, no generate button */}
      <ConnectionsPanel pageId={pageId} limit={title === null ? 3 : 5} showGenerate={title !== null} />
      {q.data && groups.total > 0 && (
        <div className="mt-3">
          {canvas ? (
            <GraphFrame data={q.data} pageId={pageId} onClose={() => setCanvas(false)} />
          ) : (
            <Button variant="outline" className="h-11 w-full text-[15px]" aria-expanded={false} onClick={() => setCanvas(true)}><Share2 /> Open full graph</Button>
          )}
          <Link href={`/graph?focus=${pageId}`} className="mt-1 flex h-11 items-center justify-center rounded-lg text-[14px] font-medium text-accent active:bg-accent-soft">Explore all connections</Link>
        </div>
      )}
    </div>
  );
}

/**
 * Canvas in a fixed-height frame (dvh, so browser bars do not change it). On touch screens the canvas starts locked:
 * a finger on it scrolls the page as usual (`touch-action: pan-y`); "Explore" hands touches to the graph (pan / zoom /
 * drag) and "Done" gives them back. The page can always be scrolled from outside the frame.
 */
export function GraphFrame({ data, pageId, onClose }: { data: GraphData; pageId: string; onClose?: () => void }) {
  const router = useRouter();
  const touch = useIsTouch();
  const canvas = useRef<GraphCanvasHandle>(null);
  const [active, setActive] = useState(false);
  const locked = touch && !active;
  const open = (n: GraphNode | null) => {
    if (!n || n.id === pageId) return;
    if (n.kind === "attachment") window.open(`/api/files/${n.id.slice(4)}`, "_blank");
    else if (n.kind !== "tag") router.push(`/p/${n.id}`);
  };
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-bg-elev">
      <div className="flex items-center gap-1 border-b border-line px-2 py-1">
        <span className="min-w-0 flex-1 truncate px-1 text-[13px] font-medium text-fg-muted">Graph · {data.nodes.length} nodes</span>
        {touch && <Button size="sm" variant={active ? "default" : "outline"} className="h-11 px-3 text-[14px] md:h-8" aria-pressed={active} onClick={() => setActive((v) => !v)}><Hand /> {active ? "Done" : "Explore"}</Button>}
        <button type="button" aria-label="Fit graph to frame" onClick={() => canvas.current?.zoomToFit()} className="grid size-11 place-items-center rounded-lg text-fg-muted hover:bg-bg-sunk md:size-8"><Maximize2 className="size-4" /></button>
        {onClose && <button type="button" aria-label="Close graph" onClick={onClose} className="grid size-11 place-items-center rounded-lg text-fg-muted hover:bg-bg-sunk md:size-8"><X className="size-5 md:size-4" /></button>}
      </div>
      <div className="relative h-[min(60dvh,26rem)]">
        <GraphCanvas ref={canvas} data={data} selectedId={pageId} compact labelsAt={1.1} onSelect={open} />
        {locked && (
          <button
            type="button"
            onClick={() => setActive(true)}
            style={{ touchAction: "pan-y" }}
            className="absolute inset-0 flex items-end justify-center bg-transparent pb-3"
            aria-label="Explore the graph: pan and zoom with your fingers"
          >
            <span className="rounded-full border border-line bg-bg-elev/95 px-3 py-1.5 text-[13px] text-fg-muted shadow-card">Tap to pan and zoom</span>
          </button>
        )}
      </div>
    </div>
  );
}

// ---------- desktop: compact canvas (unchanged behaviour) + list toggle
function DesktopCard({ pageId, depth, height, className, title }: { pageId: string; depth: 1 | 2 | 3; height: number; className?: string; title: string | null }) {
  const r = useRouter();
  const canvas = useRef<GraphCanvasHandle>(null);
  const [hover, setHover] = useState<GraphNode | null>(null);
  const [list, setList] = useState(false);
  const q = useQuery({ queryKey: ["graph-neighbors", pageId, depth], queryFn: () => api<GraphData>(`/api/graph/neighbors?pageId=${pageId}&depth=${depth}`), staleTime: 30_000 });
  const data = q.data;
  const others = data ? data.nodes.length - 1 : 0;
  return (
    <div className={cn("overflow-hidden rounded-lg border border-line bg-bg-elev", className)}>
      {title !== null && (
        <div className="flex items-center gap-2 border-b border-line px-3 py-1.5 text-[12px] font-medium text-fg-muted">
          <Share2 className="size-3.5" />
          <span className="flex-1">{title}{data ? ` · ${others} linked` : ""}{data?.stats.suggested ? ` · ${data.stats.suggested} suggested` : ""}</span>
          <button type="button" aria-pressed={list} aria-label="Show connections as a list" title="List" className={cn("grid size-7 place-items-center rounded text-fg-faint hover:bg-bg-sunk hover:text-fg", list && "bg-bg-sunk text-fg")} onClick={() => setList((v) => !v)}><List className="size-3.5" /></button>
          {!list && <button type="button" aria-label="Fit graph to frame" className="grid size-7 place-items-center rounded text-fg-faint hover:bg-bg-sunk hover:text-fg" onClick={() => canvas.current?.zoomToFit()} title="Fit"><Maximize2 className="size-3.5" /></button>}
          <Link href={`/graph?focus=${pageId}`} className="rounded px-1.5 py-0.5 text-[11px] text-accent hover:bg-bg-sunk">Open graph</Link>
        </div>
      )}
      {list ? (
        <div className="max-h-[28rem] overflow-y-auto p-3"><ConnectionsPanel pageId={pageId} /></div>
      ) : (
        <div className="relative" style={{ height }}>
          {q.isLoading ? <div role="status" aria-label="Loading connections" className="grid h-full place-items-center px-6"><Skeleton className="h-3/4 w-full" /></div>
            : q.isError ? (
              <div role="alert" className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center text-[12.5px] text-fg-muted">
                <span className="flex items-center gap-1.5"><AlertTriangle className="size-4 text-danger" /> Could not load the connections.</span>
                <Button size="xs" variant="outline" onClick={() => q.refetch()}><RefreshCw /> Retry</Button>
              </div>
            )
            : !data || others === 0 ? <div className="grid h-full place-items-center px-4 text-center text-[12.5px] text-fg-faint">No connections yet — mention pages with @, or open the list to ask for AI suggestions.</div>
            : <GraphCanvas ref={canvas} data={data} selectedId={pageId} compact labelsAt={1.1} onHover={setHover} onSelect={(n) => { if (n && n.id !== pageId && n.kind !== "tag" && n.kind !== "attachment") r.push(`/p/${n.id}`); else if (n?.kind === "attachment") window.open(`/api/files/${n.id.slice(4)}`, "_blank"); }} />}
          {hover && hover.id !== pageId && <div className="pointer-events-none absolute left-2 top-2 max-w-[80%] truncate rounded bg-bg-elev/95 px-1.5 py-0.5 text-[11px] text-fg-muted shadow-card">{hover.icon ? `${hover.icon} ` : ""}{hover.title}</div>}
        </div>
      )}
    </div>
  );
}
