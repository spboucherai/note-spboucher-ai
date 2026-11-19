"use client";
/**
 * file: src/components/knowledge/Constellation.tsx
 * description: Thought Constellation (Labs, `/constellation`) — notes as stars placed by meaning. Positions come from the server
 *   (GET /api/graph/constellation: deterministic PCA of the real page embeddings); a workspace without embeddings gets an honest
 *   empty state, never a made-up sky. Links are drawn as constellations (signature motion 3: they draw themselves once), stars are
 *   coloured by project, tag or section, and the zoom is semantic: clusters → notes → titles, with a preview of the selected note
 *   (its outline, computed without AI). Keyboard: arrows move between stars, Enter opens, + / − zoom, 0 fits, Esc clears.
 * author: Simon-Pierre Boucher — contact@spboucher.ai
 */
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Sparkle, RefreshCw, Maximize2, Plus, Minus, X, ExternalLink, Share2 } from "lucide-react";
import { api } from "@/lib/client/api";
import { useIsPhone } from "@/lib/client/hooks";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge, Empty, Skeleton } from "@/components/ui/primitives";
import { useThemeColors } from "@/components/graph/colors";
import { useReducedMotion, DUR } from "@/lib/client/motion";
import { colourSlots, drawInDuration, drawProgress, fitTransform, hitTest, nearestInDirection, toScreen, zoomTier, type Dir, type ZoomTier } from "@/lib/client/knowledge";
import type { Constellation as Data, ConstellationPoint } from "@/lib/graph/constellation";
import type { ZoomOutline } from "@/lib/pages/zoom";
import { LoadError, Segmented, fmtDateTime } from "./shared";

type T = { k: number; tx: number; ty: number }; type Mode = "project" | "tag" | "section";
/** Categorical hues for projects / tags / sections (violet is left out: it is reserved for AI). Light and dark variants. */
const PALETTE = { light: ["#2F5DDB", "#008B4E", "#B26A00", "#CC272E", "#0B7F92", "#A8377F", "#5E6C0B", "#8A5A2B"], dark: ["#7CA5FF", "#5BC083", "#F2AF48", "#F26A64", "#4CC9DB", "#E58BC7", "#B9C651", "#D3A374"] };
const starRadius = (p: ConstellationPoint) => 2.2 + Math.min(4.5, Math.sqrt(p.degree) * 0.9 + Math.min(1.6, p.words / 1500));

export function Constellation() {
  const r = useRouter(); const colors = useThemeColors(); const reduced = useReducedMotion(); const phone = useIsPhone();
  const q = useQuery({ queryKey: ["constellation"], queryFn: () => api<Data>("/api/graph/constellation"), staleTime: 60_000 });
  const [refreshing, setRefreshing] = React.useState(false);
  const data = q.data; const points = data?.points ?? [];
  const box = React.useRef<HTMLDivElement>(null); const cv = React.useRef<HTMLCanvasElement>(null); const t = React.useRef<T>({ k: 1, tx: 0, ty: 0 }); const base = React.useRef(1);
  const [size, setSize] = React.useState({ w: 0, h: 0 }); const [tier, setTier] = React.useState<ZoomTier>("clusters"); const [sel, setSel] = React.useState<string | null>(null); const [cluster, setCluster] = React.useState<number | null>(null); const [hover, setHover] = React.useState<string | null>(null);
  const [mode, setMode] = React.useState<Mode>("project"); const dark = React.useSyncExternalStore((cb) => { const mo = new MutationObserver(cb); mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] }); return () => mo.disconnect(); }, () => document.documentElement.classList.contains("dark"), () => false);
  const drawStart = React.useRef<number | null>(null); const raf = React.useRef<number | null>(null); const tween = React.useRef<number | null>(null);
  const byId = React.useMemo(() => new Map(points.map((p) => [p.id, p])), [points]);
  const slots = React.useMemo(() => colourSlots(points.map((p) => (mode === "project" ? p.projectId : mode === "tag" ? p.tags[0] ?? null : p.section))), [points, mode]);
  const palette = dark ? PALETTE.dark : PALETTE.light;
  const keyOf = React.useCallback((p: ConstellationPoint) => (mode === "project" ? p.projectId : mode === "tag" ? p.tags[0] ?? null : p.section), [mode]);
  const colourOf = React.useCallback((p: ConstellationPoint) => { const k = keyOf(p); const s = k ? slots.get(k) : undefined; return s === undefined ? colors.fgMuted : palette[s]; }, [keyOf, slots, palette, colors.fgMuted]);
  const legend = React.useMemo(() => [...slots.entries()].map(([k, i]) => ({ key: k, colour: palette[i], label: mode === "project" ? data?.projects.find((p) => p.id === k)?.title ?? "Project" : mode === "tag" ? `#${k}` : k })), [slots, palette, mode, data]);
  const selected = sel ? byId.get(sel) ?? null : null;
  const near = React.useMemo(() => { const s = new Set<string>(); if (sel && data) for (const l of data.links) { if (l.source === sel) s.add(l.target); else if (l.target === sel) s.add(l.source); } return s; }, [sel, data]);
  const preview = useQuery({ queryKey: ["zoom-outline", sel], enabled: Boolean(sel), staleTime: 30_000, queryFn: () => api<ZoomOutline>(`/api/pages/${sel}/zoom?level=2`) });

  const paint = React.useCallback(() => {
    raf.current = null; const c = cv.current; if (!c || !data) return; const ctx = c.getContext("2d"); if (!ctx) return; const dpr = window.devicePixelRatio || 1; const { w, h } = size; const tr = t.current;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
    const tr2 = zoomTier(tr.k, base.current); const now = performance.now(); const elapsed = drawStart.current != null ? now - drawStart.current : Infinity; let again = false;
    const on = (x: number, y: number, m = 40) => x > -m && x < w + m && y > -m && y < h + m;
    // clusters: soft discs, always under the stars; labelled at the far level
    for (const cl of data.clusters) { const [x, y] = toScreen(cl, tr); const rad = Math.max(cl.r * tr.k + 14, 20); if (!on(x, y, rad)) continue; ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fillStyle = colors.accent; ctx.globalAlpha = tr2 === "clusters" ? (cluster === cl.id ? 0.16 : 0.08) : 0.035; ctx.fill(); ctx.globalAlpha = 1; if (cluster === cl.id && tr2 === "clusters") { ctx.lineWidth = 1.5; ctx.strokeStyle = colors.accent; ctx.stroke(); } }
    // constellations: the links between stars (they draw themselves once, in order)
    if (tr2 !== "clusters" || data.links.length <= 400) {
      ctx.lineWidth = tr2 === "clusters" ? 0.6 : 1; const n = data.links.length;
      data.links.forEach((l, i) => { const a = byId.get(l.source), b = byId.get(l.target); if (!a || !b) return; const [ax, ay] = toScreen(a, tr), [bx, by] = toScreen(b, tr); if (!on(ax, ay, 200) && !on(bx, by, 200)) return; const p = elapsed === Infinity ? 1 : drawProgress(elapsed, i, n, DUR.slow, 10, 1200); if (p < 1) again = true; if (p <= 0) return; const lit = sel != null && (l.source === sel || l.target === sel);
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(ax + (bx - ax) * p, ay + (by - ay) * p);
        if (lit) { const g = ctx.createLinearGradient(ax, ay, bx, by); g.addColorStop(0, colors.accent); g.addColorStop(1, colors.ai); ctx.strokeStyle = g; ctx.lineWidth = 1.8; } else { ctx.strokeStyle = colors.fgMuted; ctx.globalAlpha = sel ? 0.14 : tr2 === "clusters" ? 0.18 : 0.38; ctx.lineWidth = tr2 === "clusters" ? 0.6 : 1; }
        ctx.stroke(); ctx.globalAlpha = 1; });
    }
    // stars
    const labels: { x: number; y: number; p: ConstellationPoint; r: number }[] = [];
    for (const p of points) { const [x, y] = toScreen(p, tr); if (!on(x, y)) continue; const rr = starRadius(p) * (tr2 === "clusters" ? 0.6 : 1); const isSel = p.id === sel, isHover = p.id === hover; ctx.globalAlpha = tr2 === "clusters" ? 0.55 : sel && !isSel && !near.has(p.id) ? 0.4 : 1;
      ctx.beginPath(); ctx.arc(x, y, rr, 0, Math.PI * 2); ctx.fillStyle = colourOf(p); ctx.fill();
      if (isSel || isHover) { ctx.globalAlpha = 1; ctx.lineWidth = isSel ? 2 : 1.2; ctx.strokeStyle = colors.fg; ctx.beginPath(); ctx.arc(x, y, rr + 3, 0, Math.PI * 2); ctx.stroke(); }
      if (tr2 === "titles" || isSel || isHover) labels.push({ x, y, p, r: rr }); }
    ctx.globalAlpha = 1;
    // titles: nearest level only (plus the selected / hovered star), the most connected first, at most 160 on screen
    labels.sort((a, b) => Number(b.p.id === sel) - Number(a.p.id === sel) || b.p.degree - a.p.degree); ctx.font = `12px ${colors.font}`; ctx.textBaseline = "middle";
    for (const { x, y, p, r: rr } of labels.slice(0, 160)) { const text = `${p.icon ? `${p.icon} ` : ""}${p.title.length > 34 ? `${p.title.slice(0, 33)}…` : p.title}`; const tw = ctx.measureText(text).width; ctx.fillStyle = colors.bg; ctx.globalAlpha = 0.82; ctx.fillRect(x + rr + 4, y - 9, tw + 6, 18); ctx.globalAlpha = 1; ctx.fillStyle = p.id === sel ? colors.fg : colors.fgMuted; ctx.fillText(text, x + rr + 7, y); }
    if (tr2 === "clusters") { ctx.textAlign = "center"; for (const cl of data.clusters) { const [x, y] = toScreen(cl, tr); if (!on(x, y)) continue; const text = cl.label.length > 26 ? `${cl.label.slice(0, 25)}…` : cl.label; ctx.font = `600 12.5px ${colors.font}`; const tw = ctx.measureText(text).width; ctx.fillStyle = colors.bg; ctx.globalAlpha = 0.86; ctx.fillRect(x - tw / 2 - 5, y - 20, tw + 10, 30); ctx.globalAlpha = 1; ctx.fillStyle = colors.fg; ctx.fillText(text, x, y - 10); ctx.font = `11px ${colors.font}`; ctx.fillStyle = colors.fgMuted; ctx.fillText(`${cl.size} note${cl.size === 1 ? "" : "s"}`, x, y + 3); } ctx.textAlign = "left"; }
    if (tr2 !== tier) setTier(tr2);
    if (again) raf.current = requestAnimationFrame(paint); else if (drawStart.current != null && elapsed !== Infinity) { drawStart.current = null; if (c.dataset) c.dataset.drawn = "1"; }
  }, [data, size, colors, points, byId, sel, hover, cluster, colourOf, tier, near]);
  const schedule = React.useCallback(() => { if (raf.current == null) raf.current = requestAnimationFrame(paint); }, [paint]);
  React.useEffect(() => { schedule(); return () => { if (raf.current != null) { cancelAnimationFrame(raf.current); raf.current = null; } }; }, [schedule]);
  React.useEffect(() => { const el = box.current; if (!el) return; const ro = new ResizeObserver(([e]) => setSize({ w: Math.floor(e.contentRect.width), h: Math.floor(e.contentRect.height) })); ro.observe(el); return () => ro.disconnect(); }, [points.length > 0]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => { const c = cv.current; if (!c || !size.w) return; const dpr = window.devicePixelRatio || 1; c.width = Math.round(size.w * dpr); c.height = Math.round(size.h * dpr); schedule(); }, [size, schedule]);
  const fitted = React.useRef("");
  /** Tween the view (240 ms, standard easing); instant under Reduce Motion. */
  const moveTo = React.useCallback((to: T, animate = true) => {
    if (tween.current != null) cancelAnimationFrame(tween.current); const from = { ...t.current };
    if (reduced || !animate) { t.current = to; schedule(); return; } const t0 = performance.now();
    const step = () => { const u = Math.min(1, (performance.now() - t0) / DUR.base); const e = 1 - (1 - u) ** 3; t.current = { k: from.k + (to.k - from.k) * e, tx: from.tx + (to.tx - from.tx) * e, ty: from.ty + (to.ty - from.ty) * e }; schedule(); tween.current = u < 1 ? requestAnimationFrame(step) : null; };
    tween.current = requestAnimationFrame(step);
  }, [reduced, schedule]);
  const fitAll = React.useCallback((animate = true) => { const f = fitTransform(points, size.w, size.h); base.current = f.k; moveTo(f, animate); }, [points, size, moveTo]);
  React.useEffect(() => { if (!size.w || !points.length) return; const key = `${data?.signature}:${points.length}:${size.w > 0}`; if (fitted.current === key) return; fitted.current = key; const f = fitTransform(points, size.w, size.h); base.current = f.k; t.current = f; if (!reduced && data && data.links.length && data.links.length <= 3000) { drawStart.current = performance.now(); setTimeout(schedule, drawInDuration(data.links.length, DUR.slow, 10, 1200) + 40); } schedule(); }, [size, points, data, reduced, schedule]);
  const zoomAt = React.useCallback((factor: number, sx: number, sy: number, animate = false) => { const cur = t.current; const k = Math.min(base.current * 60, Math.max(base.current * 0.6, cur.k * factor)); const f = k / cur.k; moveTo({ k, tx: sx - (sx - cur.tx) * f, ty: sy - (sy - cur.ty) * f }, animate); }, [moveTo]);
  const centreOn = React.useCallback((p: { x: number; y: number }, k?: number) => { const kk = k ?? Math.max(t.current.k, base.current * 5); moveTo({ k: kk, tx: size.w / 2 - p.x * kk, ty: size.h / 2 + p.y * kk }); }, [moveTo, size]);
  // wheel must be a non-passive listener to stop the page from scrolling
  React.useEffect(() => { const c = cv.current; if (!c) return; const onWheel = (e: WheelEvent) => { e.preventDefault(); const b = c.getBoundingClientRect(); zoomAt(Math.exp(-e.deltaY * 0.0016), e.clientX - b.left, e.clientY - b.top); }; c.addEventListener("wheel", onWheel, { passive: false }); return () => c.removeEventListener("wheel", onWheel); }, [zoomAt, points.length > 0]); // eslint-disable-line react-hooks/exhaustive-deps
  const ptrs = React.useRef(new Map<number, { x: number; y: number }>()); const gesture = React.useRef<{ moved: boolean; dist: number | null }>({ moved: false, dist: null });
  const local = (e: React.PointerEvent) => { const b = cv.current!.getBoundingClientRect(); return { x: e.clientX - b.left, y: e.clientY - b.top }; };
  const onDown = (e: React.PointerEvent) => { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); ptrs.current.set(e.pointerId, local(e)); gesture.current = { moved: false, dist: null }; };
  const onMove = (e: React.PointerEvent) => {
    const p = local(e); const prev = ptrs.current.get(e.pointerId);
    if (!prev) { const id = tier === "clusters" ? null : hitTest(points, t.current, p.x, p.y, 12); if (id !== hover) setHover(id); return; }
    ptrs.current.set(e.pointerId, p);
    if (ptrs.current.size === 2) { const [a, b] = [...ptrs.current.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y); if (gesture.current.dist) zoomAt(d / gesture.current.dist, (a.x + b.x) / 2, (a.y + b.y) / 2); gesture.current = { moved: true, dist: d }; return; }
    const dx = p.x - prev.x, dy = p.y - prev.y; if (Math.abs(dx) + Math.abs(dy) > 2) gesture.current.moved = true; t.current = { ...t.current, tx: t.current.tx + dx, ty: t.current.ty + dy }; schedule();
  };
  const onUp = (e: React.PointerEvent) => {
    const p = local(e); const was = ptrs.current.size; ptrs.current.delete(e.pointerId); if (was > 1 || gesture.current.moved) { gesture.current.dist = null; return; }
    if (tier === "clusters" && data) { let hit: number | null = null; for (const cl of data.clusters) { const [x, y] = toScreen(cl, t.current); if (Math.hypot(x - p.x, y - p.y) <= Math.max(cl.r * t.current.k + 14, 20)) { hit = cl.id; break; } } if (hit != null) { const cl = data.clusters[hit]; setCluster(hit); centreOn(cl, Math.max(base.current * 1.8, Math.min(base.current * 6, (Math.min(size.w, size.h) * 0.36) / Math.max(cl.r, 0.02)))); return; } }
    const id = hitTest(points, t.current, p.x, p.y, 14); setSel(id); if (id) setCluster(byId.get(id)?.cluster ?? null);
  };
  const onKey = (e: React.KeyboardEvent) => {
    const dir: Dir | null = e.key === "ArrowLeft" ? "left" : e.key === "ArrowRight" ? "right" : e.key === "ArrowUp" ? "up" : e.key === "ArrowDown" ? "down" : null;
    if (dir && data) { e.preventDefault();
      if (tier === "clusters" && !sel) { const next = nearestInDirection(data.clusters.map((c) => ({ id: String(c.id), x: c.x, y: c.y })), cluster == null ? null : String(cluster), dir); if (next != null) { setCluster(Number(next)); const cl = data.clusters[Number(next)]; const [x, y] = toScreen(cl, t.current); if (x < 40 || y < 40 || x > size.w - 40 || y > size.h - 40) centreOn(cl, t.current.k); } return; }
      const next = nearestInDirection(points, sel, dir); if (next) { setSel(next); const p = byId.get(next)!; setCluster(p.cluster); const [x, y] = toScreen(p, t.current); if (x < 60 || y < 60 || x > size.w - 60 || y > size.h - 60) centreOn(p, t.current.k); } return; }
    if (e.key === "Enter") { e.preventDefault(); if (sel) r.push(`/p/${sel}`); else if (cluster != null && data) { const cl = data.clusters[cluster]; const first = points.filter((p) => p.cluster === cluster).sort((a, b) => (a.x - cl.x) ** 2 + (a.y - cl.y) ** 2 - ((b.x - cl.x) ** 2 + (b.y - cl.y) ** 2))[0]; centreOn(cl, base.current * 5); if (first) setSel(first.id); } }
    else if (e.key === "+" || e.key === "=") { e.preventDefault(); zoomAt(1.5, size.w / 2, size.h / 2, true); } else if (e.key === "-" || e.key === "_") { e.preventDefault(); zoomAt(1 / 1.5, size.w / 2, size.h / 2, true); }
    else if (e.key === "0") { e.preventDefault(); fitAll(); } else if (e.key === "Escape") { setSel(null); setCluster(null); }
  };
  const refresh = async () => { setRefreshing(true); try { await api("/api/graph/constellation?refresh=1"); await q.refetch(); fitted.current = ""; } finally { setRefreshing(false); } };
  const announce = selected ? `${selected.title}. ${mode === "project" ? data?.projects.find((p) => p.id === selected.projectId)?.title ?? "no project" : mode === "tag" ? (selected.tags.length ? selected.tags.map((x) => `#${x}`).join(" ") : "no tag") : selected.section}. ${selected.degree} links. Enter opens the note.` : cluster != null && data ? `Cluster ${data.clusters[cluster]?.label}, ${data.clusters[cluster]?.size} notes. Enter zooms in.` : "";

  if (q.isLoading) return <div role="status" aria-label="Loading the constellation" className="mx-auto max-w-5xl space-y-3 px-4 py-6"><Skeleton className="h-8 w-64" /><Skeleton className="h-80 rounded-xl" /></div>;
  if (q.isError) return <div className="mx-auto max-w-3xl px-4 py-6"><LoadError what="the constellation" error={q.error} onRetry={() => q.refetch()} /></div>;
  if (!data || !points.length) return (
    <div className="mx-auto max-w-3xl px-4 py-6" data-testid="constellation-empty">
      <Empty icon={<Sparkle />} title="No star to place yet" hint={`Stars are positioned from the embeddings of the search index, and ${data?.stats.pages ?? 0} page${data?.stats.pages === 1 ? " has" : "s have"} none yet. Embeddings are computed by the background worker when a page is saved and an OpenAI key is configured on the server. Nothing is invented in the meantime.`} action={<Button asChild size="sm" variant="outline" className="max-md:h-11"><Link href="/settings#index">Search index settings</Link></Button>} />
    </div>
  );
  return (
    <div className="absolute inset-0 flex flex-col pb-[calc(4.5rem+env(safe-area-inset-bottom))] md:pb-0" data-testid="constellation" data-tier={tier}>
      <div className="flex flex-col gap-2 border-b border-line bg-bg/85 px-3 py-2 backdrop-blur-md">
        <div className="flex min-w-0 items-center gap-2"><h1 className="flex min-w-0 items-center gap-2 font-serif text-[1.125rem] font-semibold tracking-[-0.018em]"><Sparkle className="size-4 shrink-0 text-accent" /><span className="truncate">Thought Constellation</span></h1><Badge tone="accent">Labs</Badge>
          <div className="ml-auto flex shrink-0 items-center gap-1"><Button size="sm" variant="ghost" className="max-md:size-11" aria-label="Zoom out" onClick={() => zoomAt(1 / 1.5, size.w / 2, size.h / 2, true)}><Minus /></Button><Button size="sm" variant="ghost" className="max-md:size-11" aria-label="Zoom in" onClick={() => zoomAt(1.5, size.w / 2, size.h / 2, true)}><Plus /></Button><Button size="sm" variant="ghost" className="max-md:size-11" aria-label="Fit to view" onClick={() => fitAll()}><Maximize2 /></Button><Button size="sm" variant="ghost" className="max-md:size-11" aria-label="Recompute the projection" title="Recompute the projection" disabled={refreshing} onClick={refresh}><RefreshCw className={cn(refreshing && "animate-spin")} /></Button></div></div>
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5"><Segmented label="Colour stars by" size="sm" value={mode} onChange={setMode} options={[{ id: "project", label: "Project" }, { id: "tag", label: "Tag" }, { id: "section", label: "Section" }]} />
          <p className="min-w-0 text-micro leading-4 text-fg-muted" data-testid="constellation-stats">{data.stats.shown} of {data.stats.pages} notes placed{data.stats.embedded < data.stats.pages ? ` (${data.stats.pages - data.stats.embedded} without embeddings yet)` : ""}{data.stats.truncated ? " · capped at the 5 000 most recent" : ""} · PCA of {data.model} embeddings, {Math.round((data.explained[0] + data.explained[1]) * 100)} % of the variance on 2 axes · computed {fmtDateTime(data.computedAt)} · no model called</p></div>
      </div>
      <div className="relative flex min-h-0 flex-1">
        <div ref={box} className="relative min-w-0 flex-1 bg-bg">
          <canvas ref={cv} tabIndex={0} role="application" aria-label="Thought constellation. Arrow keys move between stars, Enter opens the selected note, plus and minus zoom, zero fits the view, Escape clears the selection." aria-describedby="constellation-live" data-testid="constellation-canvas" data-points={points.length} data-links={data.links.length}
            className="absolute inset-0 h-full w-full cursor-grab touch-none outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus active:cursor-grabbing"
            onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={(e) => ptrs.current.delete(e.pointerId)} onPointerLeave={() => setHover(null)} onDoubleClick={(e) => { const b = cv.current!.getBoundingClientRect(); zoomAt(2, e.clientX - b.left, e.clientY - b.top, true); }} onKeyDown={onKey} />
          <div id="constellation-live" role="status" aria-live="polite" className="sr-only">{announce}</div>
          <div className="pointer-events-none absolute left-3 top-3 rounded-pill border border-line bg-bg-elev/90 px-2.5 py-1 text-micro font-medium text-fg-muted shadow-card" data-testid="constellation-tier">{tier === "clusters" ? "Clusters" : tier === "stars" ? "Notes" : "Titles"}</div>
          {legend.length > 0 && <ul aria-label={`Colour legend: ${mode}`} className="pointer-events-none absolute bottom-3 left-3 flex max-w-[min(34rem,calc(100%-1.5rem))] flex-wrap gap-x-3 gap-y-1 rounded-card border border-line bg-bg-elev/90 px-3 py-2 text-micro text-fg-muted shadow-card backdrop-blur-md max-md:hidden" data-testid="constellation-legend">{legend.map((l) => <li key={l.key} className="inline-flex min-w-0 items-center gap-1"><span className="size-2 shrink-0 rounded-full" style={{ background: l.colour }} /><span className="max-w-[10rem] truncate">{l.label}</span></li>)}<li className="inline-flex items-center gap-1"><span className="size-2 rounded-full bg-fg-muted" />{mode === "project" ? "no project" : mode === "tag" ? "no tag" : "other"}</li></ul>}
          {/* the sky is a picture: every star is also a link */}
          <ul className="sr-only" aria-label="Notes in the constellation">{points.slice(0, 300).map((p) => <li key={p.id}><Link href={`/p/${p.id}`}>{p.title}</Link></li>)}</ul>
        </div>
        {selected && <aside aria-label="Note preview" data-testid="constellation-preview" className={cn(phone ? "panel-in-bottom" : "panel-in-right", "absolute inset-x-0 bottom-0 z-10 max-h-[58%] overflow-y-auto overscroll-contain rounded-t-sheet border-t border-line bg-bg-elev p-3 shadow-pop md:static md:max-h-none md:w-80 md:shrink-0 md:rounded-none md:border-l md:border-t-0 md:shadow-none xl:w-96")}>
          <div className="flex items-start gap-2"><div className="min-w-0 flex-1"><div className="font-serif text-[1.0625rem] font-semibold leading-snug [overflow-wrap:anywhere]">{selected.icon ? `${selected.icon} ` : ""}{selected.title}</div><div className="mt-0.5 text-micro text-fg-muted">{selected.section} · {selected.words} words · {selected.degree} link{selected.degree === 1 ? "" : "s"} · edited {fmtDateTime(selected.updatedAt)}</div></div><button type="button" aria-label="Close preview" onClick={() => setSel(null)} className="icon-btn max-md:size-11"><X /></button></div>
          {(selected.projectId || selected.tags.length > 0) && <div className="mt-2 flex flex-wrap gap-1">{selected.projectId && <Badge tone="accent">{data.projects.find((p) => p.id === selected.projectId)?.title ?? "Project"}</Badge>}{selected.tags.map((x) => <Badge key={x}>#{x}</Badge>)}</div>}
          <div className="mt-3 flex flex-wrap gap-1.5"><Button asChild size="sm" className="max-md:h-11"><Link href={`/p/${selected.id}`}><ExternalLink /> Open</Link></Button><Button asChild size="sm" variant="outline" className="max-md:h-11"><Link href={`/graph?view=local&pageId=${selected.id}`}><Share2 /> Graph</Link></Button></div>
          <div className="mt-3 border-t border-line pt-2"><div className="mb-1 text-micro font-semibold uppercase tracking-[0.08em] text-fg-muted">Outline · computed, no AI</div>
            {preview.isLoading ? <div className="space-y-2"><Skeleton className="h-4 w-3/4" /><Skeleton className="h-4" /></div> : preview.isError ? <p className="text-ui text-fg-muted">The outline could not be loaded.</p> : preview.data?.sections.length ? <ul className="space-y-1.5">{preview.data.sections.slice(0, 8).map((s, i) => <li key={`${s.blockId}-${i}`} className="text-ui leading-5">{s.heading && <Link href={`/p/${selected.id}${s.blockId ? `#block-${s.blockId}` : ""}`} className="font-medium hover:underline">{s.heading}</Link>}{s.firstSentence && <p className="text-fg-muted [overflow-wrap:anywhere]">{s.firstSentence}</p>}</li>)}</ul> : <p className="text-ui text-fg-muted">This note has no text yet.</p>}</div>
        </aside>}
      </div>
    </div>
  );
}
