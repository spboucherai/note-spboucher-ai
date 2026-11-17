"use client";
import { Command } from "cmdk";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { FileText, Plus, Sparkles, Home, Share2, Settings, Search, BarChart3, Trash2, Database, FlaskConical, Moon, Sun, Columns3, Bot, Inbox } from "lucide-react";
import { useUI } from "@/lib/client/store";
import { api } from "@/lib/client/api";
import type { TreeNode } from "./types";
import { cn } from "@/lib/utils";
import { Kbd } from "@/components/ui/primitives";
const GH = "mb-1 [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:text-[10.5px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.08em] [&_[cmdk-group-heading]]:text-fg-faint";
export function CommandPalette({ tree }: { tree: TreeNode[] }) {
  const ui = useUI(); const r = useRouter(); const [q, setQ] = useState(""); const [mode, setMode] = useState<"quick" | "full">("quick");
  useEffect(() => { if (!ui.paletteOpen) { setQ(""); setMode("quick"); } }, [ui.paletteOpen]);
  const { data: hits = [] } = useQuery({ queryKey: ["search", mode, q], queryFn: () => api(`/api/search?mode=${mode === "full" ? "hybrid" : "quick"}&q=${encodeURIComponent(q)}&limit=12`), enabled: ui.paletteOpen && (mode === "full" ? q.length > 2 : true), staleTime: 5000 });
  const go = (href: string) => { ui.set({ paletteOpen: false }); r.push(href); };
  const run = (fn: () => void) => { ui.set({ paletteOpen: false }); fn(); };
  if (!ui.paletteOpen) return null;
  const Item = ({ onSelect, icon, children, hint, value }: { onSelect: () => void; icon: React.ReactNode; children: React.ReactNode; hint?: string; value: string }) => <Command.Item value={value} onSelect={onSelect} className="flex h-9 cursor-pointer items-center gap-2.5 rounded-lg px-2.5 text-[13px] data-[selected=true]:bg-accent-soft data-[selected=true]:text-fg [&_svg]:size-4 [&_svg]:text-fg-muted"><span className="w-4 text-center">{icon}</span><span className="min-w-0 flex-1 truncate">{children}</span>{hint && <span className="text-[11px] text-fg-faint">{hint}</span>}</Command.Item>;
  return (
    <div role="dialog" aria-modal="true" aria-label="Command palette" className="fixed inset-0 z-50 flex items-start justify-center bg-black/35 p-3 pt-[10vh] backdrop-blur-[3px] sm:p-4 sm:pt-[14vh]" onClick={() => ui.set({ paletteOpen: false })}>
      <Command shouldFilter={mode === "quick"} className="w-full max-w-[38rem] overflow-hidden rounded-2xl border border-line bg-bg-elev shadow-pop fade-up" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => { if (e.key === "Escape") ui.set({ paletteOpen: false }); if (e.key === "Tab") { e.preventDefault(); setMode((m) => (m === "quick" ? "full" : "quick")); } }}>
        <div className="flex items-center gap-2 border-b border-line px-3"><Search className="size-4 text-fg-faint" /><Command.Input autoFocus value={q} onValueChange={setQ} placeholder={mode === "quick" ? "Search pages, run commands…" : "Semantic search inside content…"} className="h-12 flex-1 bg-transparent text-[15px] outline-none placeholder:text-fg-faint" style={{ outline: "none" }} /><button onClick={() => setMode((m) => (m === "quick" ? "full" : "quick"))} className={cn("rounded-md border px-1.5 py-0.5 text-[10px] font-medium", mode === "full" ? "border-accent/30 bg-accent-soft text-accent" : "border-line text-fg-faint")}>{mode === "full" ? "Content ⇥" : "Titles ⇥"}</button></div>
        <Command.List className="max-h-[min(60vh,28rem)] overflow-y-auto p-1.5">
          <Command.Empty className="px-3 py-6 text-center text-sm text-fg-muted">{mode === "full" && q.length <= 2 ? "Type at least 3 characters" : "Nothing found"}</Command.Empty>
          {mode === "quick" ? (<>
            {q.trim() && <Command.Group heading="Search" className={GH}><Item value={`search all ${q}`} icon={<Search />} onSelect={() => go(`/search?q=${encodeURIComponent(q)}`)}>Search content for “{q}”</Item></Command.Group>}
            {q.trim() && <Command.Group heading="Create" className={GH}><Item value={`create ${q}`} icon={<Plus />} onSelect={() => run(async () => { const p = await api("/api/pages", { method: "POST", json: { title: q } }); r.push(`/p/${p.id}`); })}>New page “{q}”</Item><Item value={`ask ${q}`} icon={<Sparkles />} onSelect={() => run(() => ui.openAI({ prefill: q }))}>Ask AI “{q}”</Item></Command.Group>}
            <Command.Group heading="Pages" className={GH}>
              {(q ? (hits as any[]) : tree.slice(0, 8)).map((p: any) => <Item key={p.id} value={`${p.title} ${p.id}`} icon={p.icon ?? (p.type === "database" ? <Database /> : p.type === "research" ? <FlaskConical /> : <FileText />)} hint={p.section} onSelect={() => go(`/p/${p.id}`)}>{p.title || "Untitled"}</Item>)}
            </Command.Group>
            <Command.Group heading="Go to" className={GH}>
              <Item value="home" icon={<Home />} onSelect={() => go("/")}>Home</Item><Item value="quick capture new note inbox" icon={<Inbox />} onSelect={() => { ui.set({ paletteOpen: false, captureOpen: true }); }}>Quick capture</Item><Item value="inbox review captures" icon={<Inbox />} onSelect={() => go("/inbox")}>Inbox</Item><Item value="tasks todo" icon={<Inbox />} onSelect={() => go("/tasks")}>Tasks</Item><Item value="archive" icon={<Trash2 />} onSelect={() => go("/archive")}>Archive</Item><Item value="graph" icon={<Share2 />} onSelect={() => go("/graph")}>Knowledge graph</Item><Item value="ai models benchmark" icon={<BarChart3 />} onSelect={() => go("/ai/models")}>AI models dashboard</Item><Item value="compare models" icon={<Columns3 />} onSelect={() => go("/ai/compare")}>Compare models</Item><Item value="agents" icon={<Bot />} onSelect={() => go("/ai/agents")}>Agents</Item><Item value="trash" icon={<Trash2 />} onSelect={() => go("/trash")}>Trash</Item><Item value="settings" icon={<Settings />} onSelect={() => go("/settings")}>Settings</Item>
            </Command.Group>
            <Command.Group heading="Actions" className={GH}>
              <Item value="new page" icon={<Plus />} hint="⌘⇧N" onSelect={() => run(async () => { const p = await api("/api/pages", { method: "POST", json: { title: "" } }); r.push(`/p/${p.id}`); })}>New page</Item><Item value="new database" icon={<Database />} onSelect={() => run(async () => { const p = await api("/api/pages", { method: "POST", json: { title: "New database", type: "database", section: "databases" } }); r.push(`/p/${p.id}`); })}>New database</Item><Item value="open ai assistant" icon={<Sparkles />} hint="⌘/" onSelect={() => run(() => ui.openAI())}>Open AI assistant</Item><Item value="dark mode" icon={<Moon />} onSelect={() => run(() => ui.setTheme("dark"))}>Dark mode</Item><Item value="light mode" icon={<Sun />} onSelect={() => run(() => ui.setTheme("light"))}>Light mode</Item>
            </Command.Group>
          </>) : (
            (hits as any[]).map((h: any) => <Command.Item key={h.chunkId} value={h.chunkId} onSelect={() => go(`/p/${h.pageId}${h.blockId ? `#block-${h.blockId}` : ""}`)} className="cursor-pointer rounded-md px-2 py-2 data-[selected=true]:bg-bg-sunk"><div className="flex items-center gap-2 text-[13px] font-medium"><span>{h.icon ?? "📄"}</span><span className="truncate">{h.title}</span>{h.heading && <span className="truncate text-fg-faint">› {h.heading}</span>}<span className="ml-auto text-[10px] text-fg-faint">{h.semantic ? `sem ${(h.semantic * 100).toFixed(0)}%` : "kw"}</span></div><div className="mt-0.5 line-clamp-2 text-[12px] text-fg-muted">{h.content}</div></Command.Item>)
          )}
        </Command.List>
        <div className="hidden items-center gap-3 border-t border-line bg-bg-sunk/60 px-3 py-2 text-[11px] text-fg-faint sm:flex"><span className="flex items-center gap-1"><Kbd>↑↓</Kbd> navigate</span><span className="flex items-center gap-1"><Kbd>⏎</Kbd> open</span><span className="flex items-center gap-1"><Kbd>⇥</Kbd> titles / content</span><span className="ml-auto flex items-center gap-1"><Kbd>esc</Kbd> close</span></div>
      </Command>
    </div>
  );
}
