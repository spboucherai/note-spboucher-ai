"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Home, Search, Sparkles, FileText, Files, Database, FolderKanban, FlaskConical, Share2, Link2, ChevronRight, Plus, Settings, Trash2, Star, MoreHorizontal, Moon, Sun, Laptop, LogOut, BarChart3, Bot, Inbox, LayoutDashboard } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import type { TreeNode, ShellUser } from "./types";
import { cn } from "@/lib/utils";
import { useUI } from "@/lib/client/store";
import { api } from "@/lib/client/api";
import { Menu, MenuTrigger, MenuContent, MenuItem, MenuSeparator } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";

const SECTIONS: { id: string; label: string; icon: React.ReactNode; type?: string }[] = [
  { id: "notes", label: "My Notes", icon: <FileText /> }, { id: "documents", label: "Documents", icon: <Files /> }, { id: "databases", label: "Databases", icon: <Database />, type: "database" }, { id: "projects", label: "Projects", icon: <FolderKanban /> }, { id: "research", label: "Research", icon: <FlaskConical />, type: "research" },
];
export function Sidebar({ tree, user, workspace, onNavigate }: { tree: TreeNode[]; user: ShellUser; workspace: { name: string }; onNavigate?: () => void }) {
  const pathname = usePathname(); const r = useRouter(); const qc = useQueryClient(); const ui = useUI();
  const byParent = useMemo(() => { const m = new Map<string | null, TreeNode[]>(); for (const n of tree) { const k = n.parentId; if (!m.has(k)) m.set(k, []); m.get(k)!.push(n); } return m; }, [tree]);
  const [open, setOpen] = useState<Record<string, boolean>>(() => { try { return JSON.parse(localStorage.getItem("note-tree-open") ?? "{}"); } catch { return {}; } });
  const toggle = (id: string) => setOpen((o) => { const n = { ...o, [id]: !o[id] }; localStorage.setItem("note-tree-open", JSON.stringify(n)); return n; });
  async function create(section: string, parentId: string | null = null, type?: string) {
    const p = await api("/api/pages", { method: "POST", json: { title: "", section, parentId, type: type ?? "page" } });
    qc.invalidateQueries({ queryKey: ["tree"] }); r.push(`/p/${p.id}`); onNavigate?.();
  }
  async function trash(n: TreeNode) { await api(`/api/pages/${n.id}`, { method: "DELETE" }); qc.invalidateQueries({ queryKey: ["tree"] }); toast("Moved to trash", { description: n.title }); if (pathname === `/p/${n.id}`) r.push("/"); }
  async function pin(n: TreeNode) { await api(`/api/pages/${n.id}`, { method: "PATCH", json: { pinned: !n.pinned } }); qc.invalidateQueries({ queryKey: ["tree"] }); }
  const Item = ({ n, depth }: { n: TreeNode; depth: number }) => {
    const kids = byParent.get(n.id) ?? []; const active = pathname === `/p/${n.id}`; const isOpen = open[n.id];
    return (
      <div>
        <div className={cn("group flex items-center gap-1 rounded-md pr-1 text-[13px] hover:bg-bg-sunk", active && "bg-bg-sunk font-medium text-fg")} style={{ paddingLeft: 6 + depth * 12 }}>
          <button className={cn("grid size-5 shrink-0 place-items-center rounded text-fg-faint hover:bg-line", !kids.length && "invisible")} onClick={() => toggle(n.id)}><ChevronRight className={cn("size-3.5 transition-transform", isOpen && "rotate-90")} /></button>
          <Link href={`/p/${n.id}`} onClick={onNavigate} className="flex min-w-0 flex-1 items-center gap-1.5 py-1 text-fg-muted hover:text-fg">
            <span className="w-4 shrink-0 text-center text-[13px]">{n.icon ?? (n.type === "database" ? "🗂" : n.type === "research" ? "🔬" : "📄")}</span><span className="truncate">{n.title || "Untitled"}</span>
          </Link>
          <Menu><MenuTrigger asChild><button className="invisible grid size-5 place-items-center rounded text-fg-faint hover:bg-line group-hover:visible data-[state=open]:visible"><MoreHorizontal className="size-3.5" /></button></MenuTrigger>
            <MenuContent><MenuItem onSelect={() => create(n.section, n.id)}><Plus /> Add sub-page</MenuItem><MenuItem onSelect={() => pin(n)}><Star /> {n.pinned ? "Unpin" : "Pin"}</MenuItem><MenuItem onSelect={async () => { const p = await api(`/api/pages/${n.id}?action=duplicate`, { method: "POST" }); qc.invalidateQueries({ queryKey: ["tree"] }); r.push(`/p/${p.id}`); }}><Files /> Duplicate</MenuItem><MenuSeparator /><MenuItem danger onSelect={() => trash(n)}><Trash2 /> Move to trash</MenuItem></MenuContent></Menu>
          <button className="invisible grid size-5 place-items-center rounded text-fg-faint hover:bg-line group-hover:visible" onClick={() => create(n.section, n.id)} title="Add sub-page"><Plus className="size-3.5" /></button>
        </div>
        {isOpen && kids.map((k) => <Item key={k.id} n={k} depth={depth + 1} />)}
      </div>
    );
  };
  const NavLink = ({ href, icon, label, onClick }: { href?: string; icon: React.ReactNode; label: string; onClick?: () => void }) => { const active = href && (pathname === href); const cls = cn("flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] text-fg-muted hover:bg-bg-sunk hover:text-fg [&_svg]:size-4", active && "bg-bg-sunk text-fg font-medium"); return href ? <Link href={href} className={cls} onClick={onNavigate}>{icon}{label}</Link> : <button className={cn(cls, "w-full")} onClick={onClick}>{icon}{label}</button>; };
  const pinned = tree.filter((n) => n.pinned);
  return (
    <div className="flex h-full flex-col safe-top">
      <div className="flex items-center gap-2 px-3 pt-3 pb-2">
        <Menu><MenuTrigger asChild><button className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1 text-left hover:bg-bg-sunk"><span className="grid size-6 place-items-center rounded-md bg-fg text-[12px] font-semibold text-bg">N</span><span className="truncate text-[13px] font-semibold">{workspace.name}</span></button></MenuTrigger>
          <MenuContent align="start" className="w-56">
            <div className="px-2 py-1.5 text-xs text-fg-muted">{user.displayName} · @{user.username}</div><MenuSeparator />
            <MenuItem onSelect={() => ui.setTheme("light")}><Sun /> Light {ui.theme === "light" && "✓"}</MenuItem><MenuItem onSelect={() => ui.setTheme("dark")}><Moon /> Dark {ui.theme === "dark" && "✓"}</MenuItem><MenuItem onSelect={() => ui.setTheme("system")}><Laptop /> System {ui.theme === "system" && "✓"}</MenuItem><MenuSeparator />
            <MenuItem onSelect={() => r.push("/settings")}><Settings /> Settings</MenuItem>
            <MenuItem danger onSelect={async () => { await api("/api/auth/logout", { method: "POST" }); window.location.href = "/login"; }}><LogOut /> Sign out</MenuItem>
          </MenuContent></Menu>
      </div>
      <div className="px-2 space-y-0.5">
        <NavLink href="/" icon={<Home />} label="Home" />
        <NavLink href="/search" icon={<Search />} label="Search" />
        <NavLink icon={<Sparkles />} label="AI Assistant" onClick={() => ui.openAI()} />
        <NavLink href="/inbox" icon={<Inbox />} label="Tasks" />
      </div>
      <div className="mt-3 min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {pinned.length > 0 && (<div className="mb-3"><div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-fg-faint">Pinned</div>{pinned.map((n) => <Link key={n.id} href={`/p/${n.id}`} onClick={onNavigate} className={cn("flex items-center gap-1.5 rounded-md px-2 py-1 text-[13px] text-fg-muted hover:bg-bg-sunk hover:text-fg", pathname === `/p/${n.id}` && "bg-bg-sunk text-fg")}><Star className="size-3.5 text-warning" /><span className="truncate">{n.title || "Untitled"}</span></Link>)}</div>)}
        <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-fg-faint">Private</div>
        {SECTIONS.map((s) => { const roots = (byParent.get(null) ?? []).filter((n) => n.section === s.id); const isOpen = open[`sec:${s.id}`] ?? true; return (
          <div key={s.id} className="mb-1">
            <div className="group flex items-center gap-1 rounded-md pr-1 hover:bg-bg-sunk">
              <button className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-[13px] text-fg-muted hover:text-fg [&_svg]:size-4" onClick={() => toggle(`sec:${s.id}`)}>{s.icon}<span className="flex-1 truncate text-left">{s.label}</span><ChevronRight className={cn("size-3.5 text-fg-faint transition-transform", isOpen && "rotate-90")} /></button>
              <button className="invisible grid size-5 place-items-center rounded text-fg-faint hover:bg-line group-hover:visible" title={`New in ${s.label}`} onClick={() => create(s.id, null, s.type)}><Plus className="size-3.5" /></button>
            </div>
            {isOpen && (roots.length ? roots.map((n) => <Item key={n.id} n={n} depth={1} />) : <button onClick={() => create(s.id, null, s.type)} className="ml-7 py-1 text-[12px] text-fg-faint hover:text-fg-muted">+ New {s.type ?? "page"}</button>)}
          </div>); })}
        <div className="mt-3 px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-fg-faint">Knowledge</div>
        <NavLink href="/graph" icon={<Share2 />} label="Graph" /><NavLink href="/backlinks" icon={<Link2 />} label="Backlinks" /><NavLink href="/ai/models" icon={<BarChart3 />} label="AI models" /><NavLink href="/ai/compare" icon={<LayoutDashboard />} label="Compare models" /><NavLink href="/ai/agents" icon={<Bot />} label="Agents" />
      </div>
      <div className="border-t border-line px-2 py-2 space-y-0.5"><NavLink href="/trash" icon={<Trash2 />} label="Trash" /><NavLink href="/settings" icon={<Settings />} label="Settings" /></div>
    </div>
  );
}
