"use client";
/**
 * file: src/components/canvas/CanvasPage.tsx
 * description: a page of type `canvas` (SPEC §3.4) — loads the canvas, owns its editor store and its autosave engine, and lays out
 *   the two interfaces: desktop (toolbar, contextual bar, zoom, minimap, context menu, in-place editing) and phone (dock, sheets,
 *   canvas / outline switch). Rendered by PageView instead of the text editor when `page.type === "canvas"`.
 * author: Simon-Pierre Boucher — contact@spboucher.ai
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Check, CloudOff, Download, FileText, List, Map as MapIcon, MoreHorizontal, RefreshCw, RotateCcw, Shapes, Star, Trash2, TriangleAlert } from "lucide-react";
import { api, ApiError } from "@/lib/client/api";
import { useIsPhone } from "@/lib/client/hooks";
import { registerCommands } from "@/lib/client/commands";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, Spinner } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { timeAgo } from "@/lib/utils";
import * as M from "@/lib/canvas/model";
import type { CanvasData, CanvasNode } from "@/lib/canvas/model";
import { CanvasSync, readLocalViewport, writeLocalViewport, type CanvasServerCopy } from "@/lib/canvas/sync-client";
import { CanvasStore, useCanvas } from "./store";
import { CanvasSurface, EDGE_LABEL_EVENT, type InkStyle, type SurfaceHandle } from "./CanvasSurface";
import { ContextItems, Minimap, ReviewPanel, SelectionBar, Toolbar, ZoomBar, type Commands } from "./chrome";
import { CardForm } from "./forms";
import { AddSheet, MoreSheet, Outline, PhoneDock } from "./phone";
import type { PageLite, RefLite } from "./NodeView";
import * as A from "./actions";
import "./canvas.css";

interface PageProps { page: { id: string; title: string; version: number; deletedAt?: string | null; pinned?: boolean; type: string }; breadcrumb?: unknown; backlinks?: unknown }

export function CanvasPage({ page }: PageProps) {
  const [loaded, setLoaded] = React.useState<CanvasServerCopy | null>(null); const [error, setError] = React.useState<string | null>(null); const [attempt, setAttempt] = React.useState(0);
  React.useEffect(() => { let on = true; setError(null); api<CanvasServerCopy>(`/api/canvases/${page.id}`).then((c) => { if (on) setLoaded(c); }).catch((e: ApiError) => { if (on) setError(e.message); }); return () => { on = false; }; }, [page.id, attempt]);
  if (!loaded) return (
    <div className="cv-page" data-testid="canvas-page" data-state={error ? "error" : "loading"}>
      <div className="cv-head"><span className="cv-head-icon"><Shapes aria-hidden /></span><span className="cv-title-input">{page.title}</span></div>
      <div className="cv-stage"><div className="cv-empty" role={error ? "alert" : "status"}>{error ? <><b>The canvas could not be loaded</b><span>{error}</span><Button size="sm" variant="outline" className="pointer-events-auto mt-2" onClick={() => setAttempt((n) => n + 1)}><RefreshCw /> Retry</Button></> : <><Spinner /><span>Loading the canvas…</span></>}</div></div>
    </div>
  );
  return <CanvasEditor key={page.id} page={page} initial={loaded} />;
}

function CanvasEditor({ page, initial }: { page: PageProps["page"]; initial: CanvasServerCopy }) {
  const router = useRouter(); const qc = useQueryClient(); const phone = useIsPhone(); const trashed = Boolean(page.deletedAt);
  const store = React.useMemo(() => new CanvasStore(initial.data, trashed), [initial, trashed]);
  const surface = React.useRef<SurfaceHandle | null>(null); const fileInput = React.useRef<HTMLInputElement | null>(null);
  const [mode, setMode] = React.useState<"canvas" | "outline">("canvas"); const [form, setForm] = React.useState<string | null>(null); const [connectFrom, setConnectFrom] = React.useState<string | null>(null);
  const [addOpen, setAddOpen] = React.useState(false); const [moreOpen, setMoreOpen] = React.useState(false); const [ink, setInk] = React.useState<InkStyle>({ tool: "pen", color: "#64748b", width: 5 }); const [inkStrokes, setInkStrokes] = React.useState(0);
  const [title, setTitle] = React.useState(page.title === "Untitled" ? "" : page.title); const titleRef = React.useRef(title); titleRef.current = title; const [pinned, setPinned] = React.useState(Boolean(page.pinned));
  const readOnly = useCanvas(store, (s) => s.readOnly); const cardCount = useCanvas(store, (s) => s.doc.nodes.length);

  /* ---- autosave ---- */
  const current = React.useCallback((): CanvasData => { const d = store.doc, v = store.viewport; const r = (n: number) => Math.round(n * 100) / 100; return { ...d, viewport: { ...d.viewport, x: r(v.x), y: r(v.y), zoom: Math.round(v.zoom * 1000) / 1000 } }; }, [store]);
  const sync = React.useMemo(() => new CanvasSync(page.id, initial, {
    current,
    applyRemote: (doc) => store.replace(doc),
    onDraftRestored: () => toast("Unsaved changes restored", { description: "What you did before the last interruption was recovered from this device." }),
    onRemoteUpdate: () => toast("Updated", { description: "This canvas was changed in another session; you now see the latest version." }),
    onConflicts: (added) => toast(`${added.length} change${added.length > 1 ? "s" : ""} to review`, { description: "The canvas was also edited elsewhere. Everything else was merged; nothing was lost." }),
  }, trashed), [page.id, initial, store, current, trashed]);
  const syncState = React.useSyncExternalStore(sync.subscribe, sync.get, sync.get);
  React.useEffect(() => { sync.start(); const off = store.onChange((_d, kind) => { if (kind === "commit" || kind === "typing") sync.notify(); }); return () => { off(); sync.dispose(); }; }, [sync, store]);

  /* ---- viewport: per device (localStorage); the stored one is only the starting point of a device that has none ---- */
  React.useEffect(() => {
    const local = readLocalViewport(page.id); const stored = initial.data?.viewport;
    if (local) store.setViewport({ ...store.viewport, ...local });
    else if (store.doc.nodes.length && (!stored || (stored.x === 0 && stored.y === 0 && stored.zoom === 1))) requestAnimationFrame(() => store.fit());
    let t = 0; const off = store.onViewport((v) => { window.clearTimeout(t); t = window.setTimeout(() => writeLocalViewport(page.id, v), 300); });
    return () => { off(); window.clearTimeout(t); };
  }, [store, page.id, initial]);

  /* ---- title (saved through the page, like any page title) ---- */
  const pageVersion = React.useRef(page.version); const titleTimer = React.useRef(0);
  const saveTitle = React.useCallback(async (retry = true): Promise<void> => {
    try { const r = await api<{ version: number }>(`/api/pages/${page.id}`, { method: "PATCH", json: { title: titleRef.current, baseVersion: pageVersion.current } }); pageVersion.current = r.version; qc.invalidateQueries({ queryKey: ["tree"] }); }
    catch (e) { const err = e as ApiError; if (err.status === 409 && err.body?.server?.version && retry) { pageVersion.current = err.body.server.version; return saveTitle(false); } toast("Title not saved", { description: err.message, tone: "danger" }); }
  }, [page.id, qc]);
  const onTitle = (v: string) => { setTitle(v); window.clearTimeout(titleTimer.current); titleTimer.current = window.setTimeout(() => void saveTitle(), 700); };
  React.useEffect(() => () => { if (titleTimer.current) { window.clearTimeout(titleTimer.current); if (titleRef.current !== (page.title === "Untitled" ? "" : page.title)) void saveTitle(); } }, [saveTitle, page.title]);

  /* ---- commands shared by every entry point ---- */
  const titles = React.useCallback(async (): Promise<Map<string, string>> => {
    const out = new Map<string, string>(); const doc = store.doc;
    await Promise.all(doc.nodes.slice(0, 400).map(async (n) => {
      try {
        if (n.kind === "page" && typeof n.pageId === "string") { const p = qc.getQueryData<PageLite | null>(["canvas-page", n.pageId]) ?? (await api<PageLite>(`/api/pages/${n.pageId}?head=0`)); if (p?.title) out.set(n.pageId, p.title); }
        else if (n.kind === "reference" && typeof n.refId === "string") { const r = qc.getQueryData<RefLite | null>(["canvas-ref", n.refId]) ?? (await api<RefLite[]>(`/api/research/references?ids=${n.refId}`))[0]; if (r?.title) out.set(n.refId, r.title); }
      } catch { /* the card keeps its generic label */ }
    }));
    return out;
  }, [store, qc]);
  const cmd = React.useMemo<Commands>(() => ({
    addFilesDialog: () => fileInput.current?.click(),
    form: (id) => setForm(id),
    tidy: () => A.tidy(store, (on) => sync.hold(on)),
    exportAs: (format) => { void (async () => { try { const t = await titles(); const name = titleRef.current || "Untitled canvas"; if (format === "png") await A.exportPng(store.doc, name, t); else if (format === "svg") await A.exportSvg(store.doc, name, t); else A.exportMarkdown(store.doc, name, t); toast(`Exported as ${format === "md" ? "Markdown" : format.toUpperCase()}`, { tone: "success" }); } catch (e) { toast("Export failed", { description: e instanceof Error ? e.message : undefined, tone: "danger" }); } })(); },
    editEdgeLabel: (id) => window.dispatchEvent(new CustomEvent(EDGE_LABEL_EVENT, { detail: id })),
    openNode: (n) => surface.current?.edit(n),
    pasteAt: (at) => { void (async () => { let text = ""; try { text = (await navigator.clipboard?.readText()) ?? ""; } catch { /* no permission: use what was copied in this tab */ } const clip = A.readClip(text); if (clip) A.pasteClip(store, clip, at); else if (text.trim()) A.addFromText(store, text, at, page.id); else A.pasteClip(store, undefined, at); })(); },
    inkDone: () => store.setTool("select"), inkUndo: () => surface.current?.undoInk(),
  }), [store, sync, titles, page.id]);
  const openPage = React.useCallback((id: string) => { void sync.flush(); router.push(`/p/${id}`); }, [router, sync]);
  const pickKind = (kind: M.NodeKind | "file") => {
    setAddOpen(false);
    if (kind === "file") { fileInput.current?.click(); return; }
    if (kind === "drawing") { setMode("canvas"); store.setTool("draw"); return; }
    const id = A.addCard(store, kind, {}, undefined, { centre: true }); if (id && kind !== "shape") setForm(id);
  };
  React.useEffect(() => registerCommands([
    { id: "canvas.tidy", group: "Canvas", title: "Tidy up the canvas", keywords: "auto layout arrange organise", icon: "shapes", when: () => !store.get().readOnly, run: cmd.tidy },
    { id: "canvas.fit", group: "Canvas", title: "Zoom to fit the canvas", keywords: "zoom fit all overview", icon: "maximize", run: () => A.zoomToFit(store) },
    { id: "canvas.export.png", group: "Canvas", title: "Export the canvas as PNG", keywords: "export image download", icon: "download", run: () => cmd.exportAs("png") },
    { id: "canvas.export.svg", group: "Canvas", title: "Export the canvas as SVG", keywords: "export vector download", icon: "download", run: () => cmd.exportAs("svg") },
    { id: "canvas.export.md", group: "Canvas", title: "Export the canvas as a Markdown outline", keywords: "export markdown outline list", icon: "file-down", run: () => cmd.exportAs("md") },
  ]), [store, cmd]);
  // Handle for the end-to-end suites and for debugging from the console (state only — no credentials).
  React.useEffect(() => { const w = window as unknown as Record<string, unknown>; w.__canvas = { store, sync, model: M, surface: () => surface.current }; return () => { if ((w.__canvas as { store?: CanvasStore } | undefined)?.store === store) delete w.__canvas; }; }, [store, sync]);

  const onGesture = React.useCallback((on: boolean) => sync.hold(on), [sync]);
  const keep = (c: M.CanvasConflict, side: "mine" | "theirs") => { store.apply((d) => M.resolveConflict(d, c, side === "theirs")); sync.dismiss(c); sync.notify(); };
  const status = syncState.status;
  const statusPill = (
    <span className="cv-status" role="status" aria-live="polite" data-status={status} data-testid="canvas-status">
      {status === "saved" ? <Check aria-hidden /> : status === "saving" ? <span className="lumen-dot animate-pulse" aria-hidden /> : status === "offline" ? <CloudOff aria-hidden /> : <TriangleAlert aria-hidden />}
      <span>{trashed ? "Read-only" : status === "saved" ? <>Saved<span className="max-md:hidden"> · {timeAgo(syncState.savedAt)}</span></> : status === "saving" ? "Saving…" : status === "offline" ? <>Offline<span className="max-[400px]:hidden"> · kept on this device</span></> : "Not saved"}</span>
      {(status === "offline" || status === "error") && <button type="button" onClick={sync.retry}>Retry</button>}
    </span>
  );
  return (
    <div className="cv-page" data-testid="canvas-page" data-state="ready" data-version={syncState.version}>
      <header className="cv-head">
        <span className="cv-head-icon max-md:hidden"><Shapes aria-hidden /></span>
        <input className="cv-title-input" value={title} onChange={(e) => onTitle(e.target.value)} placeholder="Untitled canvas" aria-label="Canvas title" disabled={trashed} maxLength={500} data-page-title={page.id} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); surface.current?.focus(); } }} />
        {phone && <div className="cv-seg" role="tablist" aria-label="View"><button type="button" role="tab" aria-selected={mode === "canvas"} onClick={() => setMode("canvas")}><MapIcon aria-hidden />Canvas</button><button type="button" role="tab" aria-selected={mode === "outline"} onClick={() => { store.setTool("select"); setMode("outline"); }}><List aria-hidden />List</button></div>}
        {!phone && statusPill}
        <Menu><MenuTrigger asChild><button type="button" aria-label="Canvas menu" className="icon-btn shrink-0"><MoreHorizontal /></button></MenuTrigger>
          <MenuContent>
            <MenuItem onSelect={async () => { const next = !pinned; setPinned(next); try { await api(`/api/pages/${page.id}`, { method: "PATCH", json: { pinned: next } }); qc.invalidateQueries({ queryKey: ["tree"] }); } catch { setPinned(!next); } }}><Star /> {pinned ? "Remove from favourites" : "Add to favourites"}</MenuItem>
            <MenuItem onSelect={() => cmd.exportAs("png")}><Download /> Export as PNG</MenuItem><MenuItem onSelect={() => cmd.exportAs("svg")}><Download /> Export as SVG</MenuItem><MenuItem onSelect={() => cmd.exportAs("md")}><FileText /> Export as Markdown outline</MenuItem>
            <MenuSeparator />
            {trashed ? <MenuItem onSelect={async () => { await api(`/api/pages/${page.id}?action=restore`, { method: "POST" }); qc.invalidateQueries({ queryKey: ["tree"] }); router.refresh(); }}><RotateCcw /> Restore</MenuItem>
              : <MenuItem danger onSelect={async () => { await sync.flush(); await api(`/api/pages/${page.id}`, { method: "DELETE" }); qc.invalidateQueries({ queryKey: ["tree"] }); toast("Moved to trash"); router.push("/"); }}><Trash2 /> Move to trash</MenuItem>}
          </MenuContent></Menu>
      </header>
      {phone && <div className="cv-banner" style={{ justifyContent: "space-between", padding: ".125rem .5rem" }}>{statusPill}<span className="cv-faint" data-testid="canvas-count">{cardCount} card{cardCount === 1 ? "" : "s"}</span></div>}
      {trashed && <div className="cv-banner" data-tone="danger" role="alert"><Trash2 className="size-4 shrink-0 text-danger" aria-hidden /><span className="min-w-0 flex-1">This canvas is in the trash (read-only).</span><Button size="xs" variant="outline" onClick={async () => { await api(`/api/pages/${page.id}?action=restore`, { method: "POST" }); qc.invalidateQueries({ queryKey: ["tree"] }); router.refresh(); }}>Restore</Button></div>}
      {status === "error" && syncState.error && <div className="cv-banner" data-tone="danger" role="alert"><TriangleAlert className="size-4 shrink-0 text-danger" aria-hidden /><span className="min-w-0 flex-1">Not saved: {syncState.error}. Your changes are kept on this device.</span></div>}
      <div className="cv-stage">
        {(!phone || mode === "canvas") && <CanvasSurface ref={surface} store={store} pageId={page.id} phone={phone} inkStyle={ink} onGesture={onGesture} onForm={setForm} onOpenPage={openPage} connectFrom={connectFrom} onConnected={() => setConnectFrom(null)} onInkChange={setInkStrokes}
          menu={(target) => <ContextItems store={store} cmd={cmd} target={target} />} />}
        {!phone && <><Toolbar store={store} cmd={cmd} /><SelectionBar store={store} cmd={cmd} ink={ink} setInk={setInk} inkStrokes={inkStrokes} /><ZoomBar store={store} /><Minimap store={store} /></>}
        {phone && mode === "outline" && <Outline store={store} onOpen={(n: CanvasNode) => { store.select([n.id]); setForm(n.id); }} onLocate={(n) => { store.select([n.id]); setMode("canvas"); requestAnimationFrame(() => requestAnimationFrame(() => A.revealNode(store, n.id))); }} />}
        {phone && <PhoneDock store={store} cmd={cmd} ink={ink} setInk={setInk} inkStrokes={inkStrokes} onAdd={() => setAddOpen(true)} onConnect={(id) => { setMode("canvas"); setConnectFrom(id); }} onMore={() => setMoreOpen(true)} />}
        {connectFrom && <div className="cv-toast" role="status" data-cv-ui data-testid="canvas-connect-hint"><span>{phone ? "Tap" : "Click"} the card to connect to</span><button type="button" onClick={() => setConnectFrom(null)}>Cancel</button></div>}
        <ReviewPanel store={store} conflicts={syncState.conflicts} onKeep={keep} onDismissAll={() => sync.dismissAll()} />
      </div>
      <input ref={fileInput} type="file" hidden multiple accept="image/*,application/pdf,.pdf" data-testid="canvas-file-input" onChange={(e) => { const files = [...(e.target.files ?? [])]; e.target.value = ""; if (files.length) void A.addFiles(store, page.id, files); }} />
      <CardForm store={store} nodeId={form} pageId={page.id} onClose={() => setForm(null)} onOpenPage={openPage} onConnect={(id) => { setMode("canvas"); store.select([id]); setConnectFrom(id); }} onDraw={(n) => { setMode("canvas"); requestAnimationFrame(() => surface.current?.edit(n)); }} />
      {phone && <><AddSheet open={addOpen} onClose={() => setAddOpen(false)} onPick={pickKind} /><MoreSheet open={moreOpen} onClose={() => setMoreOpen(false)} cmd={cmd} readOnly={readOnly} /></>}
    </div>
  );
}
