"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import * as DialogP from "@radix-ui/react-dialog";
import { useQuery } from "@tanstack/react-query";
import { Home, Search, Plus, Menu as MenuIcon, X, Inbox, Star, Clock, Database, CheckSquare, FlaskConical, Share2, Link2, Bot, BarChart3, Trash2, Settings, Lock, ChevronRight, ChevronLeft, Sparkles, Archive, CloudOff, CloudUpload, FileText, Files, FolderKanban, Command, MessagesSquare, History, HeartPulse, Sparkle } from "lucide-react";
import { useUI } from "@/lib/client/store";
import { useOnline } from "@/lib/client/hooks";
import { cn, timeAgo } from "@/lib/utils";
import { api } from "@/lib/client/api";
import { outboxState, flushOutbox } from "@/lib/client/outbox";
import { wipeLocalData } from "@/lib/client/offline";
import { SyncStatus } from "@/components/offline/SyncStatus";
import type { TreeNode } from "./types";

const ROUTE_LABEL: Record<string, string> = { "": "Home", search: "Search", inbox: "Inbox", tasks: "Tasks", graph: "Connections", backlinks: "Backlinks", research: "Research", trash: "Trash", settings: "Settings", ai: "AI", models: "Models", compare: "Compare", agents: "Agents", browse: "Browse", archive: "Archive", databases: "Databases", timeline: "Timeline", timemachine: "Time machine", health: "Health", constellation: "Constellation" };
const icon = (n: { icon: string | null; type: string }) => n.icon ?? (n.type === "canvas" ? "◇" : n.type === "database" ? "🗂" : n.type === "research" ? "🔬" : "📄");

/** Things waiting on this device (captures not sent yet) + connectivity, as a small pill. */
export function SyncPill({ className }: { className?: string }) {
  const online = useOnline(); const [waiting, setWaiting] = useState(0);
  useEffect(() => { const read = () => outboxState().then((s) => setWaiting(s.waiting)); read(); const kick = () => { read(); if (navigator.onLine) flushOutbox().then(read); }; window.addEventListener("note:outbox-changed", read); window.addEventListener("online", kick); document.addEventListener("visibilitychange", kick); return () => { window.removeEventListener("note:outbox-changed", read); window.removeEventListener("online", kick); document.removeEventListener("visibilitychange", kick); }; }, []);
  if (online && !waiting) return null;
  return <button type="button" role="status" onClick={() => flushOutbox()} aria-label={online ? `${waiting} capture${waiting > 1 ? "s" : ""} waiting to sync. Tap to retry.` : "Offline"} className={cn("flex h-8 items-center gap-1.5 rounded-full px-2.5 text-[12px] font-medium", online ? "bg-accent-soft text-accent" : "bg-warning/20 text-fg", className)}>{online ? <CloudUpload className="size-4" /> : <CloudOff className="size-4" />}{online ? `${waiting} to sync` : waiting ? `Offline · ${waiting} kept` : "Offline"}</button>;
}

/** Compact header for phones: where am I, a real Back, AI and sync state. */
export function MobileHeader({ tree }: { tree: TreeNode[] }) {
  const pathname = usePathname(); const r = useRouter(); const ui = useUI();
  const page = pathname.startsWith("/p/") ? tree.find((n) => n.id === pathname.slice(3)) : null;
  const parent = page?.parentId ? tree.find((n) => n.id === page.parentId) : null;
  const label = page ? (parent ? parent.title || "Untitled" : ({ notes: "Notes", documents: "Documents", projects: "Projects", research: "Research", databases: "Databases" } as Record<string, string>)[page.section] ?? "Back") : "Back";
  const here = page || pathname.startsWith("/p/") ? "" : ROUTE_LABEL[pathname.split("/").filter(Boolean).pop() ?? ""] ?? "";
  const root = pathname === "/";
  // Back keeps the previous screen's state (search results, scroll): it is the browser's own history when there is one.
  const back = () => { if (window.history.length > 1 && document.referrer !== "" || (window as any).__noteNav > 0) r.back(); else r.push(parent ? `/p/${parent.id}` : "/"); };
  return (
    <header className="relative flex h-12 shrink-0 items-center gap-1 border-b border-line/70 bg-bg/90 px-1.5 backdrop-blur-md md:hidden safe-top" style={{ height: "calc(3rem + env(safe-area-inset-top))" }}>
      {root ? <span className="flex items-center gap-2 px-2 text-[15px] font-semibold"><img src="/icons/icon.svg" alt="" className="size-6 rounded-md" />Note</span> : <button onClick={back} aria-label="Back" className="flex h-11 min-w-11 items-center gap-0.5 rounded-lg pr-2 text-[15px] text-accent active:bg-bg-sunk"><ChevronLeft className="size-6" /><span className="max-w-[9rem] truncate">{label}</span></button>}
      {!root && here && <span className="pointer-events-none absolute inset-x-0 text-center text-[15px] font-semibold" aria-hidden>{here}</span>}
      <span className="flex-1" />
      <SyncPill />
      <SyncStatus quiet />
      <button onClick={() => ui.set({ paletteOpen: true })} aria-label="Command center" className="grid size-11 place-items-center rounded-lg text-fg-muted"><Command className="size-5" /></button>
      <button onClick={() => ui.toggleAI()} aria-label="AI assistant" aria-pressed={ui.aiOpen} className={cn("grid size-11 place-items-center rounded-lg", ui.aiOpen ? "text-ai" : "text-fg-muted")}><Sparkles className="size-5" /></button>
    </header>
  );
}

export function MobileNav({ tree }: { tree: TreeNode[] }) {
  const pathname = usePathname(); const ui = useUI();
  const { data: inbox } = useQuery({ queryKey: ["inbox-count"], queryFn: () => api<{ count: number }>("/api/inbox?count=1"), staleTime: 30_000, refetchOnWindowFocus: true });
  useEffect(() => { (window as any).__noteNav = ((window as any).__noteNav ?? -1) + 1; }, [pathname]);
  // Edge swipe from the left opens the drawer (only from the first 20 px, so it never fights horizontal scrolling inside tables or code).
  useEffect(() => {
    let sx = 0, sy = 0, edge = false;
    const ts = (e: TouchEvent) => { const t = e.touches[0]; sx = t.clientX; sy = t.clientY; edge = sx < 20; };
    const te = (e: TouchEvent) => { if (!edge) return; const t = e.changedTouches[0]; if (t.clientX - sx > 64 && Math.abs(t.clientY - sy) < 48) ui.set({ drawerOpen: true }); };
    window.addEventListener("touchstart", ts, { passive: true }); window.addEventListener("touchend", te, { passive: true });
    return () => { window.removeEventListener("touchstart", ts); window.removeEventListener("touchend", te); };
  }, [ui]);
  if (ui.focusMode) return null;
  const item = "relative flex min-h-[3.25rem] flex-1 flex-col items-center justify-center gap-0.5 text-[10.5px] font-medium text-fg-faint transition-colors [&_svg]:size-[22px]";
  const on = (p: string) => (p === "/" ? pathname === "/" : pathname.startsWith(p));
  return (
    <>
      <nav aria-label="Primary" className="mobile-nav fixed inset-x-0 bottom-0 z-30 flex items-stretch border-t border-line bg-bg-elev/92 px-1 backdrop-blur-md md:hidden safe-bottom">
        <Link href="/" aria-current={on("/") ? "page" : undefined} className={cn(item, on("/") && "text-accent")}><Home />Home{on("/") && <span aria-hidden className="absolute top-0 h-0.5 w-8 rounded-full bg-accent" />}</Link>
        <Link href="/search" aria-current={on("/search") ? "page" : undefined} className={cn(item, on("/search") && "text-accent")}><Search />Search{on("/search") && <span aria-hidden className="absolute top-0 h-0.5 w-8 rounded-full bg-accent" />}</Link>
        <div className="flex flex-1 items-center justify-center"><button onClick={() => ui.set({ captureOpen: true })} aria-label="Quick capture" className="grid size-12 place-items-center rounded-2xl bg-accent text-accent-fg shadow-pop transition-transform active:scale-95"><Plus className="size-6" /></button></div>
        <Link href="/inbox" aria-current={on("/inbox") ? "page" : undefined} aria-label={inbox?.count ? `Inbox, ${inbox.count} to sort` : "Inbox"} className={cn(item, on("/inbox") && "text-accent")}><span className="relative"><Inbox />{inbox?.count ? <span aria-hidden className="absolute -right-2.5 -top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-accent px-1 text-[10px] font-semibold leading-none text-accent-fg">{inbox.count > 99 ? "99+" : inbox.count}</span> : null}</span>Inbox{on("/inbox") && <span aria-hidden className="absolute top-0 h-0.5 w-8 rounded-full bg-accent" />}</Link>
        <button id="mobile-more" onClick={() => ui.set({ drawerOpen: true })} aria-haspopup="dialog" aria-expanded={ui.drawerOpen} className={cn(item, ui.drawerOpen && "text-accent")}><MenuIcon />More</button>
      </nav>
      <MobileDrawer tree={tree} />
    </>
  );
}

/** Navigation drawer for phones: favourites, recent, spaces one level at a time (no dense tree), then tools. Radix Dialog handles focus trap, Escape and scroll lock; swipe left closes. */
function MobileDrawer({ tree }: { tree: TreeNode[] }) {
  const ui = useUI(); const pathname = usePathname(); const r = useRouter(); const panel = useRef<HTMLDivElement>(null); const [space, setSpace] = useState<string | null>(null);
  const open = ui.drawerOpen; const close = () => ui.set({ drawerOpen: false });
  const { data: recent = [] } = useQuery({ queryKey: ["recent-pages"], queryFn: () => api<any[]>("/api/pages?view=recent&limit=6"), enabled: open, staleTime: 15_000 });
  useEffect(() => { close(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [pathname]);
  useEffect(() => { if (!open) setSpace(null); }, [open]);
  const drag = useRef<{ x: number; y: number; dx: number; lock: boolean | null } | null>(null);
  const onStart = (e: React.TouchEvent) => { const t = e.touches[0]; drag.current = { x: t.clientX, y: t.clientY, dx: 0, lock: null }; };
  const onMove = (e: React.TouchEvent) => { const d = drag.current; if (!d) return; const t = e.touches[0]; const dx = t.clientX - d.x, dy = t.clientY - d.y; if (d.lock === null && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) d.lock = Math.abs(dx) > Math.abs(dy) * 1.3; if (d.lock && dx < 0) { d.dx = dx; if (panel.current) panel.current.style.transform = `translateX(${dx}px)`; } };
  const onEnd = () => { const d = drag.current; drag.current = null; if (!panel.current) return; panel.current.style.transform = ""; if (d && d.lock && d.dx < -70) close(); };
  const pinned = tree.filter((n) => n.pinned); const dbs = tree.filter((n) => n.type === "database");
  const SPACES = [{ id: "notes", label: "Notes", icon: <FileText /> }, { id: "documents", label: "Documents", icon: <Files /> }, { id: "projects", label: "Projects", icon: <FolderKanban /> }, { id: "research", label: "Research", icon: <FlaskConical /> }];
  const row = "flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-[15px] text-fg active:bg-bg-hover [&_svg]:size-5 [&_svg]:shrink-0 [&_svg]:text-fg-muted";
  const L = ({ href, icon, label, badge }: { href: string; icon: React.ReactNode; label: string; badge?: React.ReactNode }) => <Link href={href} onClick={close} aria-current={pathname === href ? "page" : undefined} className={cn(row, pathname === href && "bg-bg-elev font-medium shadow-card")}>{icon}<span className="min-w-0 flex-1 truncate">{label}</span>{badge}</Link>;
  const Pg = ({ n, sub }: { n: { id: string; title: string; icon: string | null; type: string }; sub?: string }) => <Link href={`/p/${n.id}`} onClick={close} aria-current={pathname === `/p/${n.id}` ? "page" : undefined} className={cn(row, pathname === `/p/${n.id}` && "bg-bg-elev font-medium shadow-card")}><span className="w-5 shrink-0 text-center text-[17px] leading-none">{icon(n)}</span><span className="min-w-0 flex-1"><span className="block truncate">{n.title || "Untitled"}</span>{sub && <span className="block truncate text-[12px] text-fg-faint">{sub}</span>}</span></Link>;
  const H = ({ children }: { children: React.ReactNode }) => <h2 className="px-3 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-[0.08em] text-fg-faint">{children}</h2>;
  async function lock() { if (!window.confirm("Lock this device? You come back with your passkey. Captures and drafts not yet synced on this device are erased.")) return; await api("/api/auth/logout", { method: "POST", idempotencyKey: false }).catch(() => {}); await wipeLocalData(); window.location.href = "/login"; }
  const inSpace = space ? tree.filter((n) => n.section === space && n.parentId === null && n.type !== "database") : [];
  return (
    <DialogP.Root open={open} onOpenChange={(o) => ui.set({ drawerOpen: o })}>
      <DialogP.Portal>
        <DialogP.Overlay className="fixed inset-0 z-40 bg-black/45 backdrop-blur-[1px] md:hidden" />
        <DialogP.Content ref={panel} aria-describedby={undefined} onCloseAutoFocus={(e) => { e.preventDefault(); document.getElementById("mobile-more")?.focus({ preventScroll: true }); }} onTouchStart={onStart} onTouchMove={onMove} onTouchEnd={onEnd} className="drawer fixed inset-y-0 left-0 z-50 flex w-[86vw] max-w-[22rem] flex-col bg-bg-side shadow-pop outline-none md:hidden">
          <div className="flex shrink-0 items-center gap-2 px-3 pb-1 safe-top" style={{ paddingTop: "calc(env(safe-area-inset-top) + 0.5rem)" }}>
            {space ? <button onClick={() => setSpace(null)} className="flex h-11 items-center gap-1 rounded-lg pr-3 text-[15px] text-accent"><ChevronLeft className="size-5" />All</button> : <DialogP.Title className="flex items-center gap-2 px-2 text-[16px] font-semibold"><img src="/icons/icon.svg" alt="" className="size-7 rounded-lg" />Note</DialogP.Title>}
            {space && <DialogP.Title className="min-w-0 flex-1 truncate text-center text-[15px] font-semibold">{SPACES.find((s) => s.id === space)?.label}</DialogP.Title>}
            <DialogP.Close aria-label="Close menu" className="ml-auto grid size-11 place-items-center rounded-full text-fg-muted active:bg-bg-hover"><X className="size-5" /></DialogP.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-4">
            {space ? (inSpace.length ? inSpace.map((n) => { const kids = tree.filter((k) => k.parentId === n.id).length; return <Pg key={n.id} n={n} sub={kids ? `${kids} sub-page${kids > 1 ? "s" : ""}` : undefined} />; }) : <p className="px-3 py-8 text-center text-[14px] text-fg-muted">Nothing here yet. Capture something with +, then file it from the inbox.</p>) : <>
              {pinned.length > 0 && <><H>Favourites</H>{pinned.slice(0, 8).map((n) => <Pg key={n.id} n={n} />)}</>}
              {recent.length > 0 && <><H>Recent</H>{recent.slice(0, 5).map((n: any) => <Pg key={n.id} n={n} sub={timeAgo(n.updatedAt)} />)}</>}
              <H>Spaces</H>
              {SPACES.map((s) => { const n = tree.filter((x) => x.section === s.id && x.parentId === null && x.type !== "database").length; return <button key={s.id} onClick={() => setSpace(s.id)} className={row}>{s.icon}<span className="flex-1">{s.label}</span><span className="text-[13px] tabular-nums text-fg-faint">{n || ""}</span><ChevronRight className="!size-4 !text-fg-faint" /></button>; })}
              <H>Databases</H>
              {dbs.length ? dbs.slice(0, 8).map((n) => <Pg key={n.id} n={n} />) : <p className="px-3 pb-1 text-[13px] text-fg-faint">No database yet.</p>}
              <button className={cn(row, "text-accent")} onClick={async () => { const p = await api("/api/pages", { method: "POST", json: { title: "New database", section: "databases", type: "database" } }); close(); r.push(`/p/${p.id}`); }}><Database className="!text-accent" />New database</button>
              <H>Tools</H>
              <L href="/tasks" icon={<CheckSquare />} label="Tasks" /><L href="/research" icon={<FlaskConical />} label="Research & references" /><L href="/backlinks" icon={<Link2 />} label="Connections" /><L href="/graph" icon={<Share2 />} label="Graph" />{/* NEXT-K ▼ */}<L href="/ai" icon={<MessagesSquare />} label="Ask My Knowledge" /><L href="/timeline" icon={<History />} label="Timeline" /><L href="/timemachine" icon={<Clock />} label="Time machine" /><L href="/health" icon={<HeartPulse />} label="Knowledge health" /><L href="/constellation" icon={<Sparkle />} label="Constellation · Labs" />{/* NEXT-K ▲ */}<L href="/ai/agents" icon={<Bot />} label="Agents" /><L href="/ai/models" icon={<BarChart3 />} label="AI models & costs" />
              <H>Library</H>
              <L href="/archive" icon={<Archive />} label="Archive" /><L href="/trash" icon={<Trash2 />} label="Trash" /><L href="/settings" icon={<Settings />} label="Settings" />
              <button onClick={lock} className={row}><Lock />Lock this device</button>
            </>}
          </div>
        </DialogP.Content>
      </DialogP.Portal>
    </DialogP.Root>
  );
}
