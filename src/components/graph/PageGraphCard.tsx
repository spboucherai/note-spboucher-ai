"use client";
/** Compact depth-1 neighbourhood of a page (for the page sidebar / dashboard). Click a node to open it; link to the full graph. */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Share2, Maximize2 } from "lucide-react";
import { api } from "@/lib/client/api";
import { cn } from "@/lib/utils";
import { Spinner } from "@/components/ui/primitives";
import type { GraphData, GraphNode } from "@/lib/graph/types";
import { GraphCanvas, type GraphCanvasHandle } from "./GraphCanvas";

export function PageGraphCard({ pageId, depth = 1, height = 220, className, title = "Connections" }: { pageId: string; depth?: 1 | 2 | 3; height?: number; className?: string; title?: string | null }) {
  const r = useRouter(); const canvas = useRef<GraphCanvasHandle>(null); const [hover, setHover] = useState<GraphNode | null>(null);
  const q = useQuery({ queryKey: ["graph-neighbors", pageId, depth], queryFn: () => api<GraphData>(`/api/graph/neighbors?pageId=${pageId}&depth=${depth}`), staleTime: 30_000 });
  const data = q.data; const others = data ? data.nodes.length - 1 : 0;
  return (
    <div className={cn("overflow-hidden rounded-lg border border-line bg-bg-elev", className)}>
      {title !== null && <div className="flex items-center gap-2 border-b border-line px-3 py-1.5 text-[12px] font-medium text-fg-muted"><Share2 className="size-3.5" /><span className="flex-1">{title}{data ? ` · ${others} linked` : ""}{data?.stats.suggested ? ` · ${data.stats.suggested} suggested` : ""}</span>
        <button className="grid size-7 place-items-center rounded text-fg-faint hover:bg-bg-sunk hover:text-fg" onClick={() => canvas.current?.zoomToFit()} title="Fit"><Maximize2 className="size-3.5" /></button>
        <Link href={`/graph?focus=${pageId}`} className="rounded px-1.5 py-0.5 text-[11px] text-accent hover:bg-bg-sunk">Open graph</Link></div>}
      <div className="relative" style={{ height }}>
        {q.isLoading ? <div className="grid h-full place-items-center"><Spinner /></div>
          : !data || others === 0 ? <div className="grid h-full place-items-center px-4 text-center text-[12.5px] text-fg-faint">No connections yet — mention pages with @ or run AI suggestions from the graph.</div>
          : <GraphCanvas ref={canvas} data={data} selectedId={pageId} compact labelsAt={1.1} onHover={setHover} onSelect={(n) => { if (n && n.id !== pageId && n.kind !== "tag" && n.kind !== "attachment") r.push(`/p/${n.id}`); else if (n?.kind === "attachment") window.open(`/api/files/${n.id.slice(4)}`, "_blank"); }} />}
        {hover && hover.id !== pageId && <div className="pointer-events-none absolute left-2 top-2 max-w-[80%] truncate rounded bg-bg-elev/95 px-1.5 py-0.5 text-[11px] text-fg-muted shadow-card">{hover.icon ? `${hover.icon} ` : ""}{hover.title}</div>}
      </div>
    </div>
  );
}
