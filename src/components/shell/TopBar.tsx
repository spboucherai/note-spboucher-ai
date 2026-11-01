"use client";
import { usePathname, useRouter } from "next/navigation";
import { PanelLeft, Search, Sparkles, Plus, Maximize2 } from "lucide-react";
import { useUI } from "@/lib/client/store";
import { Kbd, Tip } from "@/components/ui/primitives";
import type { TreeNode } from "./types";
import { api } from "@/lib/client/api";
import { cn } from "@/lib/utils";
export function TopBar({ tree }: { tree: TreeNode[] }) {
  const ui = useUI(); const pathname = usePathname(); const r = useRouter();
  const current = pathname.startsWith("/p/") ? tree.find((n) => n.id === pathname.slice(3)) : null;
  const crumbs: TreeNode[] = []; let c = current; while (c) { crumbs.unshift(c); c = tree.find((n) => n.id === c!.parentId) ?? null; }
  const title = current ? crumbs.map((x) => x.title || "Untitled").join(" / ") : pathname === "/" ? "Home" : pathname.slice(1).replace(/\//g, " / ");
  return (
    <header className="hidden md:flex h-11 shrink-0 items-center gap-1 border-b border-line bg-bg/80 px-2 backdrop-blur safe-top">
      <Tip label={<span>Toggle sidebar <Kbd>⌘\</Kbd></span>}><button onClick={ui.toggleSidebar} className={cn("grid size-8 place-items-center rounded-md text-fg-muted hover:bg-bg-sunk", !ui.sidebarOpen && "text-accent")}><PanelLeft className="size-4" /></button></Tip>
      <div className="min-w-0 flex-1 truncate px-1 text-[13px] text-fg-muted">{title}</div>
      <Tip label={<span>New page <Kbd>⌘⇧N</Kbd></span>}><button onClick={async () => { const p = await api("/api/pages", { method: "POST", json: { title: "" } }); r.push(`/p/${p.id}`); }} className="grid size-8 place-items-center rounded-md text-fg-muted hover:bg-bg-sunk"><Plus className="size-4" /></button></Tip>
      <button onClick={() => ui.set({ paletteOpen: true })} className="flex h-8 w-56 items-center gap-2 rounded-md border border-line bg-bg-elev px-2 text-[13px] text-fg-faint hover:bg-bg-sunk"><Search className="size-4" /><span className="flex-1 text-left">Search…</span><Kbd>⌘K</Kbd></button>
      <Tip label={<span>Focus mode <Kbd>⌘.</Kbd></span>}><button onClick={() => ui.set({ focusMode: true })} className="grid size-8 place-items-center rounded-md text-fg-muted hover:bg-bg-sunk"><Maximize2 className="size-4" /></button></Tip>
      <Tip label={<span>AI assistant <Kbd>⌘/</Kbd></span>}><button onClick={ui.toggleAI} className={cn("ml-1 flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium", ui.aiOpen ? "bg-ai text-white" : "bg-ai-soft text-ai hover:bg-ai/20")}><Sparkles className="size-4" /> AI</button></Tip>
    </header>
  );
}
