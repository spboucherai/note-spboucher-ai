"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Home, Search, Sparkles, FileText, Files, Database, FolderKanban, FlaskConical, Share2, Link2, ChevronRight, Plus, Settings, Trash2, Star, MoreHorizontal, Moon, Sun, Laptop, Lock, BarChart3, Bot, Inbox, Columns3, CornerDownLeft, Keyboard, CheckSquare, Archive } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import type { TreeNode, ShellUser } from "./types";
import { cn } from "@/lib/utils";
import { useUI } from "@/lib/client/store";
import { api } from "@/lib/client/api";
import { enqueueCapture } from "@/lib/client/outbox";
import { Menu, MenuTrigger, MenuContent, MenuItem, MenuSeparator, Kbd } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";
import { wipeLocalData } from "@/lib/client/offline";
import { createPage, trashPage, updatePageMeta } from "@/lib/client/journal";
import { navigateWithTitle } from "@/lib/client/motion";

const SECTIONS: { id: string; label: string; icon: React.ReactNode; type?: string }[] = [
  { id: "notes", label: "Notes", icon: <FileText /> }, { id: "documents", label: "Documents", icon: <Files /> }, { id: "projects", label: "Projects", icon: <FolderKanban /> }, { id: "research", label: "Research", icon: <FlaskConical />, type: "research" },
];
const defaultIcon = (t: string) => (t === "database" ? "🗂" : t === "research" ? "🔬" : "📄");

export function Sidebar({ tree, user, workspace, onNavigate }: { tree: TreeNode[]; user: ShellUser; workspace: { name: string }; onNavigate?: () => void }) {
  const pathname = usePathname(); const r = useRouter(); const qc = useQueryClient(); const ui = useUI();
  const byParent = useMemo(() => { const m = new Map<string | null, TreeNode[]>(); for (const n of tree) { const k = n.parentId; if (!m.has(k)) m.set(k, []); m.get(k)!.push(n); } return m; }, [tree]);
  const [open, setOpen] = useState<Record<string, boolean>>(() => { try { return JSON.parse(localStorage.getItem("note-tree-open") ?? "{}"); } catch { return {}; } });
  const [capture, setCapture] = useState(""); const [capturing, setCapturing] = useState(false);
  const toggle = (id: string) => setOpen((o) => { const n = { ...o, [id]: !(o[id] ?? (id.startsWith("sec:") || id.startsWith("grp:"))) }; localStorage.setItem("note-tree-open", JSON.stringify(n)); return n; });
  async function create(section: string, parentId: string | null = null, type?: string, title = "") {
    const p = await createPage({ title, section, parentId, type: type ?? "page" });
    qc.invalidateQueries({ queryKey: ["tree"] }); r.push(`/p/${p.id}`); onNavigate?.(); return p;
  }
  async function quickCapture() {
    const t = capture.trim(); if (!t || capturing) return; setCapturing(true);
    // through the outbox, like the capture sheet (3.0): offline or on a timeout the capture is kept on the device and sent later, exactly once
    try { const res = await enqueueCapture({ kind: /^(https?:\/\/|www\.)\S+$/i.test(t) ? "link" : "note", text: t });
      if (res.sent) { qc.invalidateQueries({ queryKey: ["inbox"] }); qc.invalidateQueries({ queryKey: ["inbox-count"] }); setCapture(""); toast("Captured to inbox", { tone: "success" }); }
      else if (res.error && navigator.onLine && !/network|timed out/i.test(res.error)) toast("Capture failed", { description: res.error, tone: "danger" }); // refused by the server: the text stays in the field
      else { setCapture(""); toast("Saved on this device", { description: "It will be sent to your inbox as soon as the network is back." }); } }
    catch (e: any) { toast("Capture failed", { description: e.message, tone: "danger" }); } finally { setCapturing(false); }
  }
  async function trash(n: TreeNode) { await trashPage(n.id); qc.invalidateQueries({ queryKey: ["tree"] }); toast("Moved to trash", { description: n.title }); if (pathname === `/p/${n.id}`) r.push("/"); }
  async function pin(n: TreeNode) { await updatePageMeta(n.id, { pinned: !n.pinned }); qc.invalidateQueries({ queryKey: ["tree"] }); }
  async function lock() { if (!window.confirm("Lock this device? You come back with your passkey. Drafts not yet synced on this device are erased.")) return; await api("/api/auth/logout", { method: "POST", idempotencyKey: false }).catch(() => {}); await wipeLocalData(); window.location.href = "/login"; }

  // 4 Fluid Navigation: the row title becomes the page title (View Transitions; plain navigation elsewhere or with a modifier key)
  const fluid = (id: string) => (e: React.MouseEvent<HTMLAnchorElement>) => { onNavigate?.(); if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0 || pathname === `/p/${id}`) return; if (e.altKey) { e.preventDefault(); ui.openPanel("page", id); return; } e.preventDefault(); void navigateWithTitle(e.currentTarget.querySelector<HTMLElement>("[data-row-title]"), () => r.push(`/p/${id}`), () => document.querySelector(`[data-page-title="${id}"]`) !== null); };
  /** Collapsible section of the sidebar (state kept on this device with the tree's). */
  const Sec = ({ id, label, action, children }: { id: string; label: string; action?: React.ReactNode; children: React.ReactNode }) => { const isOpen = open[`grp:${id}`] ?? true; return <section aria-label={label}><div className="flex items-center gap-1 pr-1"><button type="button" className="side-section min-w-0 flex-1" aria-expanded={isOpen} onClick={() => toggle(`grp:${id}`)}><ChevronRight className="chev" aria-hidden /><span className="truncate">{label}</span></button>{action}</div>{isOpen && children}</section>; };
  const Item = ({ n, depth }: { n: TreeNode; depth: number }) => {
    const kids = byParent.get(n.id) ?? []; const active = pathname === `/p/${n.id}`; const isOpen = open[n.id];
    return (
      <div role="treeitem" aria-expanded={kids.length ? Boolean(isOpen) : undefined} aria-selected={active}>
        <div data-active={active} className="side-item group gap-1 pr-1" style={{ paddingLeft: 4 + depth * 14 }}>
          <button aria-label={isOpen ? "Collapse" : "Expand"} className={cn("grid size-5 shrink-0 place-items-center rounded text-fg-faint hover:bg-line", !kids.length && "invisible")} onClick={() => toggle(n.id)}><ChevronRight className={cn("!size-3.5 transition-transform", isOpen && "rotate-90")} /></button>
          <Link href={`/p/${n.id}`} onClick={fluid(n.id)} className="flex h-full min-w-0 flex-1 items-center gap-1.5">
            <span className="w-4 shrink-0 text-center text-ui leading-none">{n.icon ?? defaultIcon(n.type)}</span><span data-row-title className="truncate">{n.title || "Untitled"}</span>
          </Link>
          <Menu><MenuTrigger asChild><button aria-label="Page actions" className="hidden size-5 place-items-center rounded text-fg-faint hover:bg-line group-hover:grid group-focus-within:grid data-[state=open]:grid max-md:grid"><MoreHorizontal className="!size-3.5" /></button></MenuTrigger>
            <MenuContent><MenuItem onSelect={() => create(n.section, n.id)}><Plus /> Add sub-page</MenuItem><MenuItem className="max-lg:hidden" onSelect={() => ui.openPanel("page", n.id)}><Columns3 /> Open to the side</MenuItem><MenuItem onSelect={() => pin(n)}><Star /> {n.pinned ? "Unpin" : "Pin"}</MenuItem><MenuItem onSelect={async () => { const p = await api(`/api/pages/${n.id}?action=duplicate`, { method: "POST" }); qc.invalidateQueries({ queryKey: ["tree"] }); r.push(`/p/${p.id}`); }}><Files /> Duplicate</MenuItem><MenuSeparator /><MenuItem danger onSelect={() => trash(n)}><Trash2 /> Move to trash</MenuItem></MenuContent></Menu>
          <button aria-label="Add sub-page" className="hidden size-5 place-items-center rounded text-fg-faint hover:bg-line group-hover:grid group-focus-within:grid" onClick={() => create(n.section, n.id)}><Plus className="!size-3.5" /></button>
        </div>
        {isOpen && <div role="group">{kids.map((k) => <Item key={k.id} n={k} depth={depth + 1} />)}</div>}
      </div>
    );
  };
  const Nav = ({ href, icon, label, onClick, kbd }: { href?: string; icon: React.ReactNode; label: string; onClick?: () => void; kbd?: string }) => {
    const active = Boolean(href && (href === "/" ? pathname === "/" : pathname.startsWith(href)));
    const body = <>{icon}<span className="flex-1 truncate text-left">{label}</span>{kbd && <span className="text-micro text-fg-faint">{kbd}</span>}</>;
    return href ? <Link href={href} data-active={active} className="side-item" onClick={onNavigate}>{body}</Link> : <button data-active={false} className="side-item w-full" onClick={onClick}>{body}</button>;
  };
  const pinned = tree.filter((n) => n.pinned);
  const databases = tree.filter((n) => n.type === "database");
  const ThemeIcon = ui.theme === "dark" ? Moon : ui.theme === "light" ? Sun : Laptop;
  return (
    <nav aria-label="Workspace" className="flex h-full w-full flex-col safe-top">
      <div className="flex items-center gap-2 px-3 pb-2 pt-3">
        <Link href="/" onClick={onNavigate} className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-1 py-1 hover:bg-bg-hover">
          <img src="/icons/icon.svg" alt="" className="size-7 rounded-[8px] shadow-card" />
          <span className="min-w-0"><span className="block truncate text-ui font-semibold leading-4 tracking-[-0.01em]">{workspace.name}</span>{user.displayName && <span className="block truncate text-micro leading-4 text-fg-faint">{user.displayName}</span>}</span>
        </Link>
        <Menu><MenuTrigger asChild><button aria-label="Theme" className="grid size-7 place-items-center rounded-md text-fg-faint hover:bg-bg-hover hover:text-fg"><ThemeIcon className="size-4" /></button></MenuTrigger>
          <MenuContent align="end" className="w-44"><MenuItem onSelect={() => ui.setTheme("light")}><Sun /> Light {ui.theme === "light" && "✓"}</MenuItem><MenuItem onSelect={() => ui.setTheme("dark")}><Moon /> Dark {ui.theme === "dark" && "✓"}</MenuItem><MenuItem onSelect={() => ui.setTheme("system")}><Laptop /> System {ui.theme === "system" && "✓"}</MenuItem></MenuContent></Menu>
      </div>
      <div className="space-y-2 px-3">
        <button onClick={() => { ui.set({ paletteOpen: true }); onNavigate?.(); }} className="flex h-8 w-full items-center gap-2 rounded-control border border-line bg-bg-elev px-2.5 text-ui text-fg-faint shadow-card transition-colors hover:border-line-strong hover:text-fg-muted"><Search className="size-4" /><span className="flex-1 text-left">Search or run a command</span><Kbd>⌘K</Kbd></button>
        <form onSubmit={(e) => { e.preventDefault(); quickCapture(); }} className="group/cap flex items-center gap-1.5 rounded-lg border border-dashed border-line-strong/80 bg-transparent px-2.5 transition-colors focus-within:border-solid focus-within:border-accent/50 focus-within:bg-bg-elev">
          <Plus className="size-4 shrink-0 text-fg-faint" />
          <label htmlFor="quick-capture" className="sr-only">Quick capture</label>
          <input id="quick-capture" value={capture} onChange={(e) => setCapture(e.target.value)} placeholder="Quick capture…" className="h-8 min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-fg-faint" style={{ outline: "none" }} />
          {capture.trim() && <button type="submit" aria-label="Save capture" className="grid size-5 place-items-center rounded text-accent"><CornerDownLeft className="size-3.5" /></button>}
        </form>
      </div>
      <div className="mt-2 space-y-px px-2">
        <Nav href="/" icon={<Home />} label="Home" />
        <Nav icon={<Sparkles />} label="Ask AI" kbd="⌘/" onClick={() => { ui.openAI(); onNavigate?.(); }} />
        <Nav href="/inbox" icon={<Inbox />} label="Inbox" />
        <Nav href="/tasks" icon={<CheckSquare />} label="Tasks" />
        <Nav href="/graph" icon={<Share2 />} label="Graph" />
      </div>
      <div className="mt-1 min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-4" role="tree" aria-label="Pages">
        {pinned.length > 0 && <Sec id="pinned" label="Pinned">{pinned.map((n) => <Link key={n.id} href={`/p/${n.id}`} onClick={fluid(n.id)} data-active={pathname === `/p/${n.id}`} className="side-item"><span className="w-4 text-center text-ui leading-none">{n.icon ?? defaultIcon(n.type)}</span><span data-row-title className="truncate">{n.title || "Untitled"}</span><Star className="ml-auto !size-3 fill-warning text-warning" /></Link>)}</Sec>}
        <Sec id="databases" label="Databases" action={<button aria-label="New database" onClick={() => create("databases", null, "database", "New database")} className="grid size-5 place-items-center rounded-chip text-fg-faint hover:bg-bg-hover hover:text-fg"><Plus className="size-3.5" /></button>}>
        {databases.length ? databases.slice(0, 12).map((n) => <Link key={n.id} href={`/p/${n.id}`} onClick={onNavigate} data-active={pathname === `/p/${n.id}`} className="side-item"><span className="w-4 text-center text-ui leading-none">{n.icon ?? "🗂"}</span><span className="truncate">{n.title || "Untitled"}</span></Link>) : <button onClick={() => create("databases", null, "database", "New database")} className="side-item w-full text-fg-faint"><Database /> Create a database</button>}
        </Sec>
        <Sec id="workspace" label="Workspace">
        {SECTIONS.map((s) => { const roots = (byParent.get(null) ?? []).filter((n) => n.section === s.id); const isOpen = open[`sec:${s.id}`] ?? true; return (
          <div key={s.id}>
            <div className="side-item group pr-1">
              <button className="flex h-full min-w-0 flex-1 items-center gap-2" aria-expanded={isOpen} onClick={() => toggle(`sec:${s.id}`)}>{s.icon}<span className="flex-1 truncate text-left">{s.label}</span><span className="text-micro tabular-nums text-fg-faint">{roots.length || ""}</span><ChevronRight className={cn("!size-3.5 text-fg-faint transition-transform", isOpen && "rotate-90")} /></button>
              <button aria-label={`New in ${s.label}`} className="grid size-5 place-items-center rounded text-fg-faint opacity-0 hover:bg-line focus-visible:opacity-100 group-hover:opacity-100 max-md:opacity-100" onClick={() => create(s.id, null, s.type)}><Plus className="!size-3.5" /></button>
            </div>
            {isOpen && (roots.length ? roots.map((n) => <Item key={n.id} n={n} depth={1} />) : <button onClick={() => create(s.id, null, s.type)} className="ml-8 h-7 text-[12px] text-fg-faint hover:text-fg-muted">+ New {s.type ?? "page"}</button>)}
          </div>); })}
        </Sec>
        <Sec id="intelligence" label="Intelligence">
        <Nav href="/research" icon={<FlaskConical />} label="Research" />
        <Nav href="/backlinks" icon={<Link2 />} label="Backlinks" />
        <Nav href="/ai/agents" icon={<Bot />} label="Agents" />
        <Nav href="/ai/models" icon={<BarChart3 />} label="AI models" />
        <Nav href="/ai/compare" icon={<Columns3 />} label="Compare models" />
        </Sec>
      </div>
      <div className="flex items-center gap-0.5 border-t border-line px-2 py-2 safe-bottom">
        <Link href="/archive" onClick={onNavigate} aria-label="Archive" title="Archive" data-active={pathname === "/archive"} className="side-item size-8 justify-center px-0"><Archive /></Link>
        <Link href="/trash" onClick={onNavigate} aria-label="Trash" title="Trash" data-active={pathname === "/trash"} className="side-item size-8 justify-center px-0"><Trash2 /></Link>
        <Link href="/settings" onClick={onNavigate} aria-label="Settings" title="Settings" data-active={pathname.startsWith("/settings")} className="side-item size-8 justify-center px-0"><Settings /></Link>
        <button onClick={() => window.dispatchEvent(new CustomEvent("note:shortcuts"))} aria-label="Keyboard shortcuts" title="Keyboard shortcuts (⌘?)" className="side-item size-8 justify-center px-0"><Keyboard /></button>
        <button onClick={lock} aria-label="Lock this device" title="Lock this device" className="side-item ml-auto h-8 gap-1.5 px-2 text-[12px]"><Lock /> Lock</button>
      </div>
    </nav>
  );
}
