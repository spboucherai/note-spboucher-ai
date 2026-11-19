"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { PanelLeft, Search, Sparkles, Plus, Maximize2, ChevronRight, Keyboard, ListTree } from "lucide-react";
import { useUI } from "@/lib/client/store";
import { Kbd, Tip } from "@/components/ui/primitives";
import type { TreeNode } from "./types";
import { api } from "@/lib/client/api";
import { cn } from "@/lib/utils";

const ROUTE_LABEL: Record<string, string> = { "": "Home", search: "Search", inbox: "Inbox", tasks: "Tasks", archive: "Archive", graph: "Knowledge graph", backlinks: "Backlinks", research: "Research", trash: "Trash", settings: "Settings", ai: "AI", models: "Models", compare: "Compare", agents: "Agents", /* NEXT-K */ timeline: "Timeline", timemachine: "Time machine", health: "Knowledge health", constellation: "Thought constellation" };
export function TopBar({ tree }: { tree: TreeNode[] }) {
  const ui = useUI(); const pathname = usePathname(); const r = useRouter();
  const current = pathname.startsWith("/p/") ? tree.find((n) => n.id === pathname.slice(3)) : null;
  const crumbs: TreeNode[] = []; let c = current; while (c) { crumbs.unshift(c); c = tree.find((n) => n.id === c!.parentId) ?? null; }
  const routeCrumbs = current ? [] : pathname.split("/").filter(Boolean).map((s) => ROUTE_LABEL[s] ?? s);
  const btn = "icon-btn";
  return (
    <header className="chrome-glass hidden md:flex h-12 shrink-0 items-center gap-1 border-b border-line/70 px-2.5 safe-top">
      <Tip label={<span>Toggle sidebar <Kbd>⌘\</Kbd></span>}><button aria-label="Toggle sidebar" onClick={ui.toggleSidebar} className={cn(btn, !ui.sidebarOpen && "text-accent")}><PanelLeft className="size-4" /></button></Tip>
      <nav aria-label="Breadcrumb" className="flex min-w-0 flex-1 items-center gap-0.5 px-1 text-ui">
        {current ? crumbs.map((x, i) => (
          <span key={x.id} className="flex min-w-0 items-center gap-0.5">
            {i > 0 && <ChevronRight className="size-3.5 shrink-0 text-fg-faint" />}
            <Link href={`/p/${x.id}`} aria-current={i === crumbs.length - 1 ? "page" : undefined} className={cn("flex min-w-0 items-center gap-1.5 rounded-control px-1.5 py-1 hover:bg-bg-hover", i === crumbs.length - 1 ? "font-medium text-fg" : "text-fg-muted")}><span className="text-ui leading-none">{x.icon ?? (x.type === "database" ? "🗂" : "📄")}</span><span className="max-w-[16rem] truncate">{x.title || "Untitled"}</span></Link>
          </span>)) : <span className="truncate px-1.5 font-medium text-fg">{routeCrumbs.length ? routeCrumbs.join(" / ") : "Home"}</span>}
      </nav>
      <button onClick={() => ui.set({ paletteOpen: true })} className="hidden h-8 w-60 items-center gap-2 rounded-control border border-line bg-bg-elev px-2.5 text-ui text-fg-faint shadow-card transition-colors hover:border-line-strong lg:flex"><Search className="size-4" /><span className="flex-1 text-left">Search or run a command…</span><Kbd>⌘K</Kbd></button>
      <Tip label={<span>Search <Kbd>⌘K</Kbd></span>}><button aria-label="Search" onClick={() => ui.set({ paletteOpen: true })} className={cn(btn, "lg:hidden")}><Search className="size-4" /></button></Tip>
      <Tip label={<span>New page <Kbd>⌘⇧N</Kbd></span>}><button aria-label="New page" onClick={async () => { const p = await api("/api/pages", { method: "POST", json: { title: "" } }); r.push(`/p/${p.id}`); }} className={btn}><Plus className="size-4" /></button></Tip>
      {current && current.type !== "database" && <Tip label="Outline panel"><button aria-label="Outline panel" aria-pressed={ui.panel?.id === "outline"} onClick={() => (ui.panel?.id === "outline" ? ui.closePanel() : ui.openPanel("outline"))} className={cn(btn, "max-lg:hidden", ui.panel?.id === "outline" && "text-accent")}><ListTree className="size-4" /></button></Tip>}
      <Tip label={<span>Focus mode <Kbd>⌘.</Kbd></span>}><button aria-label="Focus mode" onClick={() => ui.set({ focusMode: true })} className={btn}><Maximize2 className="size-4" /></button></Tip>
      <Tip label={<span>Shortcuts <Kbd>⌘?</Kbd></span>}><button aria-label="Keyboard shortcuts" onClick={() => window.dispatchEvent(new CustomEvent("note:shortcuts"))} className={btn}><Keyboard className="size-4" /></button></Tip>
      <Tip label={<span>AI assistant <Kbd>⌘/</Kbd></span>}><button aria-pressed={ui.aiOpen} onClick={ui.toggleAI} className={cn("ml-1 flex h-8 items-center gap-1.5 rounded-control px-3 text-ui font-medium transition-colors", ui.aiOpen ? "bg-ai text-white shadow-card" : "bg-ai-soft text-ai hover:bg-ai/15")}><Sparkles className="size-4" /> Ask AI</button></Tip>
    </header>
  );
}
