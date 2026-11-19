"use client";
/**
 * file: src/components/editor/nodes/RefViews.tsx
 * description: `blockRef` (cross-reference / transclusion: the source block of another page rendered live and read-only, or as a link)
 *   and `canvasLink` (card that opens a canvas page). Both only hold ids: the content is always read from the source at display time.
 * author: Simon-Pierre Boucher — contact@spboucher.ai
 */
import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { CornerDownRight, ExternalLink, Search, Unlink, Link2, Rows3, Shapes, Plus, Replace } from "lucide-react";
import type { BlockRefAttrs, CanvasLinkAttrs } from "@/lib/editor/next-nodes";
import { docBlocks, type PMNode } from "@/lib/editor/text";
import { api, ApiError } from "@/lib/client/api";
import { toast } from "@/components/ui/toast";
import { NodeFrame, NodeButton, NodeState, type LeafViewProps } from "./frame";

// The embed is rendered by the editor itself (read-only), loaded lazily: Editor imports this file, so a static import would be circular.
const EmbeddedEditor = React.lazy(() => import("../Editor").then((m) => ({ default: m.Editor })));
/** Nesting depth of transclusions (a referenced block may itself contain references): past 2 levels only a link is shown. */
const RefDepth = React.createContext(0);
interface PageLite { id: string; title: string; icon: string | null; type?: string; content: PMNode; deletedAt?: string | null }
interface Hit { id: string; title: string; icon: string | null; type?: string }
export function findBlock(doc: PMNode | null | undefined, blockId: string): PMNode | null {
  if (!doc) return null; if (doc.attrs?.id === blockId && doc.type !== "doc") return doc;
  for (const c of doc.content ?? []) { const f = findBlock(c, blockId); if (f) return f; } return null;
}
const usePage = (pageId: string | null) => useQuery({ queryKey: ["page-source", pageId], enabled: Boolean(pageId), staleTime: 15_000, refetchOnWindowFocus: true, retry: false,
  queryFn: async () => { try { return await api<PageLite>(`/api/pages/${pageId}`); } catch (e) { if (e instanceof ApiError && (e.status === 404 || e.status === 400)) return null; throw e; } } });

function BlockPicker({ onPick, exclude }: { onPick: (pageId: string, blockId: string) => void; exclude?: string | null }) {
  const [q, setQ] = React.useState(""); const [page, setPage] = React.useState<Hit | null>(null);
  const hits = useQuery({ queryKey: ["blockref-search", q], enabled: !page, staleTime: 10_000, queryFn: () => api<Hit[]>(`/api/search?mode=quick&q=${encodeURIComponent(q)}&limit=8`) });
  const src = usePage(page?.id ?? null); const blocks = React.useMemo(() => docBlocks(src.data?.content).filter((b) => b.id), [src.data]);
  if (page) return (
    <div className="ref-picker" data-testid="blockref-blocks">
      <div className="mb-1 flex items-center gap-2 text-ui"><button type="button" className="nb-btn nb-btn-text" onClick={() => setPage(null)}>← Pages</button><span className="min-w-0 truncate font-medium">{page.icon ?? "📄"} {page.title || "Untitled"}</span></div>
      {src.isLoading ? <div className="skeleton h-5 w-2/3" /> : blocks.length === 0 ? <div className="p-2 text-ui text-fg-muted">This page has no block to reference yet.</div>
        : <div className="max-h-64 overflow-y-auto" role="listbox" aria-label="Blocks">{blocks.map((b) => <button key={b.id} type="button" role="option" aria-selected={false} className="ref-option" onClick={() => onPick(page.id, b.id!)}><span className="ref-kind">{b.type === "heading" ? "H" : "¶"}</span><span className="line-clamp-2 min-w-0">{b.text}</span></button>)}</div>}
    </div>
  );
  return (
    <div className="ref-picker">
      <label className="flex items-center gap-2 rounded-control border border-line bg-bg px-2"><Search className="size-4 text-fg-faint" aria-hidden /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a page…" aria-label="Search a page" className="h-9 min-w-0 flex-1 bg-transparent text-ui outline-none" style={{ outline: "none" }} /></label>
      <div className="mt-1 max-h-64 overflow-y-auto" role="listbox" aria-label="Pages">{(hits.data ?? []).filter((h) => h.type !== "database" && h.id !== exclude).map((h) => <button key={h.id} type="button" role="option" aria-selected={false} className="ref-option" onClick={() => setPage(h)}><span className="ref-kind">{h.icon ?? "📄"}</span><span className="min-w-0 truncate">{h.title || "Untitled"}</span></button>)}{hits.data && hits.data.length === 0 && <div className="p-2 text-ui text-fg-muted">No page matches.</div>}</div>
    </div>
  );
}

export function BlockRefView({ attrs, update, editable, selected, pageId }: LeafViewProps<BlockRefAttrs>) {
  const depth = React.useContext(RefDepth); const [picking, setPicking] = React.useState(false);
  const src = usePage(attrs.pageId); const block = React.useMemo(() => (attrs.blockId ? findBlock(src.data?.content, attrs.blockId) : null), [src.data, attrs.blockId]);
  const href = attrs.pageId ? `/p/${attrs.pageId}${attrs.blockId ? `#block-${attrs.blockId}` : ""}` : null;
  const pageTitle = src.data ? `${src.data.icon ?? "📄"} ${src.data.title || "Untitled"}` : "";
  const missing = Boolean(attrs.pageId) && !src.isLoading && (!src.data || src.data.deletedAt || !block);
  const actions = <>{href && !missing && <Link href={href} className="nb-btn" title="Jump to the source" aria-label="Jump to the source"><ExternalLink /></Link>}
    {editable && attrs.pageId && <NodeButton label={attrs.mode === "embed" ? "Show as a link" : "Show the content"} onClick={() => update({ mode: attrs.mode === "embed" ? "link" : "embed" })}>{attrs.mode === "embed" ? <Link2 /> : <Rows3 />}</NodeButton>}
    {editable && attrs.pageId && <NodeButton label="Choose another block" active={picking} onClick={() => setPicking((p) => !p)}><Replace /></NodeButton>}</>;
  return (
    <NodeFrame kind="blockRef" icon={<CornerDownRight />} label="Reference" title={pageTitle} selected={selected} actions={actions}>
      {(!attrs.pageId || picking) && (editable ? <div className="p-2"><BlockPicker exclude={null} onPick={(p, b) => { update({ pageId: p, blockId: b }); setPicking(false); }} /></div> : <NodeState icon={<Unlink />} title="Empty reference" />)}
      {attrs.pageId && !picking && (src.isLoading ? <div className="p-3"><div className="skeleton h-5 w-3/4" /></div>
        : src.isError ? <NodeState tone="danger" icon={<Unlink />} title="The source could not be loaded" hint={(src.error as Error)?.message}><NodeButton label="Retry" text onClick={() => src.refetch()} /></NodeState>
        : missing ? <NodeState icon={<Unlink />} title="Reference not found" hint={<span lang="fr">Référence introuvable — the source block or its page was removed.</span>} />
        : attrs.mode === "link" || depth >= 2 || attrs.pageId === pageId && depth > 0 ? <Link href={href!} className="ref-link"><CornerDownRight className="size-4 shrink-0 text-fg-faint" aria-hidden /><span className="line-clamp-2 min-w-0">{docBlocks({ type: "doc", content: [block!] })[0]?.text ?? pageTitle}</span></Link>
        : <div className="ref-embed" data-testid="blockref-embed"><RefDepth.Provider value={depth + 1}><React.Suspense fallback={<div className="skeleton h-5 w-3/4" />}><EmbeddedEditor key={`${attrs.pageId}-${attrs.blockId}-${src.dataUpdatedAt}`} content={{ type: "doc", content: [block!] }} editable={false} embedded className="ref-embed-editor" /></React.Suspense></RefDepth.Provider></div>)}
    </NodeFrame>
  );
}

interface TreeLite { id: string; title: string; icon: string | null; type: string }
export function CanvasLinkView({ attrs, update, editable, selected, pageId }: LeafViewProps<CanvasLinkAttrs>) {
  const tree = useQuery({ queryKey: ["tree"], staleTime: 10_000, queryFn: () => api<TreeLite[]>("/api/tree") });
  const [unavailable, setUnavailable] = React.useState(false); const [busy, setBusy] = React.useState(false);
  const canvases = (tree.data ?? []).filter((n) => n.type === "canvas"); const target = (tree.data ?? []).find((n) => n.id === attrs.pageId);
  const head = useQuery({ queryKey: ["page-head", attrs.pageId], enabled: Boolean(attrs.pageId) && tree.isSuccess && !target, retry: false, staleTime: 30_000, queryFn: async () => { try { return await api<{ id: string; deletedAt: string | null }>(`/api/pages/${attrs.pageId}?head=1`); } catch { return null; } } });
  async function create() {
    setBusy(true);
    try { const p = await api<{ id: string }>("/api/pages", { method: "POST", json: { title: "New canvas", type: "canvas", parentId: pageId ?? null } }); update({ pageId: p.id }); tree.refetch(); }
    catch (e) { if (e instanceof ApiError && [400, 404, 422].includes(e.status)) setUnavailable(true); else toast("Canvas not created", { description: (e as Error).message, tone: "danger" }); }
    finally { setBusy(false); }
  }
  if (attrs.pageId) {
    const gone = tree.isSuccess && !target && head.isFetched && (!head.data || head.data.deletedAt);
    return (
      <NodeFrame kind="canvasLink" icon={<Shapes />} label="Canvas" selected={selected} bare>
        {gone ? <div className="canvas-card is-missing"><Unlink className="size-4" aria-hidden /><span>Canvas not found — it may have been deleted.</span></div>
          : <Link href={`/p/${attrs.pageId}`} className="canvas-card"><span className="canvas-thumb" aria-hidden><Shapes /></span><span className="min-w-0 flex-1"><span className="block truncate font-medium text-fg">{target ? `${target.icon ?? ""} ${target.title || "Untitled canvas"}`.trim() : "Canvas"}</span><span className="block text-micro text-fg-faint">Open the canvas</span></span><ExternalLink className="size-4 shrink-0 text-fg-faint" aria-hidden /></Link>}
      </NodeFrame>
    );
  }
  return (
    <NodeFrame kind="canvasLink" icon={<Shapes />} label="Canvas" selected={selected}>
      {!editable ? <NodeState icon={<Shapes />} title="No canvas linked" />
        : unavailable ? <NodeState icon={<Shapes />} title="Canvases are not available on this server yet" hint="The block is kept; link a canvas once the server is updated." />
        : <NodeState icon={<Shapes />} title="Link a canvas" hint={canvases.length ? "Choose an existing canvas or create one." : "No canvas exists yet."}>
            {canvases.slice(0, 6).map((c) => <NodeButton key={c.id} label={c.title || "Untitled canvas"} text onClick={() => update({ pageId: c.id })}><Shapes /></NodeButton>)}
            <NodeButton label="New canvas" text tone="accent" disabled={busy} onClick={create}><Plus /></NodeButton>
          </NodeState>}
    </NodeFrame>
  );
}
