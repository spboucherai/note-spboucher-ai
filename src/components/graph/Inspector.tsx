"use client";
import Link from "next/link";
import { useMemo } from "react";
import { ArrowDownLeft, ArrowUpRight, ExternalLink, Sparkles, Crosshair, X, Paperclip, Tag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, Spinner } from "@/components/ui/primitives";
import { cn, timeAgo } from "@/lib/utils";
import type { GraphData, GraphEdge, GraphNode, NodeKind } from "@/lib/graph/types";
import { KIND_CLASS } from "./colors";

const KIND_LABEL: Record<NodeKind, string> = { page: "Page", database: "Database", research: "Research", row: "Row", attachment: "Attachment", tag: "Tag" };
export function Inspector({ node, data, onClose, onFocus, onSuggest, suggesting, onNeighbourhood, className }: { node: GraphNode; data: GraphData; onClose: () => void; onFocus: (id: string) => void; onSuggest: (id: string) => void; suggesting?: boolean; onNeighbourhood: (id: string) => void; className?: string }) {
  const byId = useMemo(() => new Map(data.nodes.map((n) => [n.id, n])), [data]);
  const links = useMemo(() => {
    const out: { other: GraphNode; edge: GraphEdge; dir: "out" | "in" }[] = [];
    for (const e of data.edges) { if (e.source === node.id && byId.has(e.target)) out.push({ other: byId.get(e.target)!, edge: e, dir: "out" }); else if (e.target === node.id && byId.has(e.source)) out.push({ other: byId.get(e.source)!, edge: e, dir: "in" }); }
    return out.sort((a, b) => (a.edge.status === b.edge.status ? a.other.title.localeCompare(b.other.title) : a.edge.status === "accepted" ? -1 : 1));
  }, [data, node.id, byId]);
  const isPage = node.kind !== "attachment" && node.kind !== "tag";
  const href = isPage ? `/p/${node.id}` : node.kind === "attachment" ? `/api/files/${node.id.slice(4)}` : null;
  return (
    <div className={cn("flex h-full min-h-0 flex-col", className)}>
      <div className="flex items-start gap-2 border-b border-line px-3 py-2.5">
        <span className={cn("mt-1.5 size-2.5 shrink-0 rounded-full", KIND_CLASS[node.kind])} />
        <div className="min-w-0 flex-1"><div className="truncate text-[14px] font-semibold leading-5">{node.icon ? `${node.icon} ` : ""}{node.title}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px] text-fg-muted"><Badge>{KIND_LABEL[node.kind]}</Badge>{node.section && <Badge>{node.section}</Badge>}<span>degree {node.degree}</span>{isPage && <span>· {node.in} in / {node.out} out</span>}{node.updatedAt && <span>· {timeAgo(node.updatedAt)}</span>}</div></div>
        <button className="grid size-8 shrink-0 place-items-center rounded-md text-fg-faint hover:bg-bg-sunk hover:text-fg" onClick={onClose} aria-label="Close"><X className="size-4" /></button>
      </div>
      <div className="flex flex-wrap gap-1.5 border-b border-line px-3 py-2">
        {href && <Button asChild size="sm" variant="secondary"><Link href={href} target={isPage ? undefined : "_blank"}><ExternalLink /> Open</Link></Button>}
        <Button size="sm" variant="outline" onClick={() => onNeighbourhood(node.id)}><Crosshair /> Neighbourhood</Button>
        {isPage && <Button size="sm" variant="ai" disabled={suggesting} onClick={() => onSuggest(node.id)}>{suggesting ? <Spinner className="size-3.5 border-t-white" /> : <Sparkles />} Suggest connections</Button>}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-fg-faint">{links.length} connection{links.length === 1 ? "" : "s"}</div>
        {!links.length && <p className="py-4 text-center text-[12.5px] text-fg-faint">No links yet. Mention another page with @ or ask for AI suggestions.</p>}
        <ul className="space-y-0.5">
          {links.map(({ other, edge, dir }) => (
            <li key={edge.id}>
              <button onClick={() => onFocus(other.id)} className="flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left text-[13px] hover:bg-bg-sunk">
                {edge.kind === "attachment" ? <Paperclip className="size-3.5 shrink-0 text-fg-faint" /> : edge.kind === "tag" ? <Tag className="size-3.5 shrink-0 text-fg-faint" /> : dir === "out" ? <ArrowUpRight className="size-3.5 shrink-0 text-fg-faint" /> : <ArrowDownLeft className="size-3.5 shrink-0 text-fg-faint" />}
                <span className={cn("size-2 shrink-0 rounded-full", KIND_CLASS[other.kind])} />
                <span className="min-w-0 flex-1 truncate">{other.icon ? `${other.icon} ` : ""}{other.title}</span>
                {edge.status === "suggested" ? <Badge tone="ai">AI {edge.confidence != null ? `${Math.round(edge.confidence * 100)}%` : ""}</Badge> : edge.kind === "relation" ? <Badge tone="success">{edge.sub ?? "relation"}</Badge> : edge.sub === "ai" ? <Badge tone="ai">AI ✓</Badge> : null}
              </button>
              {edge.status === "suggested" && edge.rationale && <p className="-mt-0.5 mb-1 pl-9 pr-2 text-[11.5px] leading-4 text-fg-muted">{edge.rationale}</p>}
            </li>))}
        </ul>
      </div>
    </div>
  );
}
