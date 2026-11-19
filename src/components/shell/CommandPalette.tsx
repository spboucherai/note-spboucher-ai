"use client";
/**
 * file: src/components/shell/CommandPalette.tsx
 * description: Universal Command Center (⌘K). One field over three sources — commands registered by any feature
 *   (src/lib/client/commands.ts), pages (the tree, ranked locally at once; server title search fills in), and what was used recently on
 *   this device — ranked together by one fuzzy scorer. Tab switches to full-text / semantic search inside content. Keyboard: ↑↓ ⏎ ⇥ esc,
 *   ⌥⏎ opens a page to the side. On phones it is a top sheet opened from the header button (touch entry point).
 * author: Simon-Pierre Boucher — contact@spboucher.ai
 */
import { Command } from "cmdk";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { FileText, Plus, Sparkles, Home, Share2, Settings, Search, BarChart3, Trash2, Database, FlaskConical, Moon, Sun, Columns3, Bot, Inbox, Archive, CheckSquare, Link2, PanelLeft, PanelRight, Maximize2, ListTree, Laptop, Keyboard, History, Tag, FileDown, Download, Undo2, Redo2, Copy, Clock, CornerDownLeft, TerminalSquare, HeartPulse, Sparkle, Lightbulb } from "lucide-react";
import { useUI } from "@/lib/client/store";
import { api } from "@/lib/client/api";
import { availableCommands, subscribeCommands, getCommands, fuzzyRank, readRecents, rememberRecent, recencyBoost, type Command as Cmd, type RecentEntry } from "@/lib/client/commands";
import type { TreeNode } from "./types";
import { cn } from "@/lib/utils";

const ICONS: Record<string, React.ReactNode> = { home: <Home />, inbox: <Inbox />, "check-square": <CheckSquare />, search: <Search />, share: <Share2 />, flask: <FlaskConical />, link: <Link2 />, bot: <Bot />, "bar-chart": <BarChart3 />, columns: <Columns3 />, archive: <Archive />, trash: <Trash2 />, settings: <Settings />, plus: <Plus />, database: <Database />, sparkles: <Sparkles />, "panel-left": <PanelLeft />, "panel-right": <PanelRight />, maximize: <Maximize2 />, "list-tree": <ListTree />, sun: <Sun />, moon: <Moon />, laptop: <Laptop />, keyboard: <Keyboard />, history: <History />, tag: <Tag />, "file-down": <FileDown />, download: <Download />, undo: <Undo2 />, redo: <Redo2 />, copy: <Copy />, /* NEXT-K */ clock: <Clock />, "heart-pulse": <HeartPulse />, sparkle: <Sparkle />, lightbulb: <Lightbulb /> };
const GROUP_ORDER = ["Recent", "Pages", "Create", "Insert", "Page", "Editor", "AI", "View", "Go to", "Settings"];
const pageIcon = (p: { icon?: string | null; type?: string }) => p.icon ?? (p.type === "database" ? <Database /> : p.type === "research" ? <FlaskConical /> : <FileText />);
/** Title with the matched characters emphasised (never colour alone: weight too). */
function Hl({ text, positions }: { text: string; positions: number[] }) {
  if (!positions.length) return <>{text}</>; const set = new Set(positions); const out: React.ReactNode[] = []; let buf = "", on = false;
  for (let i = 0; i < text.length; i++) { const hit = set.has(i); if (hit !== on && buf) { out.push(on ? <b key={i} className="font-semibold text-accent">{buf}</b> : buf); buf = ""; } on = hit; buf += text[i]; }
  if (buf) out.push(on ? <b key="end" className="font-semibold text-accent">{buf}</b> : buf); return <>{out}</>;
}
type Row = { key: string; group: string; title: string; positions: number[]; icon: React.ReactNode; hint?: string; shortcut?: string; score: number; run: (alt: boolean) => void };

export function CommandPalette({ tree }: { tree: TreeNode[] }) {
  const ui = useUI(); const r = useRouter(); const [q, setQ] = useState(""); const [mode, setMode] = useState<"quick" | "full">("quick"); const [recents, setRecents] = useState<RecentEntry[]>([]); const alt = useRef(false);
  const registered = useSyncExternalStore(subscribeCommands, getCommands, getCommands);
  useEffect(() => { if (ui.paletteOpen) setRecents(readRecents()); else { setQ(""); setMode("quick"); } }, [ui.paletteOpen]);
  const query = q.trim();
  const { data: hits = [] } = useQuery({ queryKey: ["search", mode, query], queryFn: () => api<any[]>(`/api/search?mode=${mode === "full" ? "hybrid" : "quick"}&q=${encodeURIComponent(query)}&limit=12`), enabled: ui.paletteOpen && (mode === "full" ? query.length > 2 : query.length > 0), staleTime: 5000, placeholderData: (prev) => prev });
  const close = () => ui.set({ paletteOpen: false });
  const openPage = (p: { id: string; title?: string; icon?: string | null }, alt: boolean) => { rememberRecent({ kind: "page", id: p.id, title: p.title, icon: p.icon ?? null }); close(); if (alt && window.matchMedia("(min-width: 1024px)").matches) ui.openPanel("page", p.id); else r.push(`/p/${p.id}`); };
  const runCmd = (c: Cmd) => { rememberRecent({ kind: "command", id: c.id }); close(); void Promise.resolve().then(() => c.run()).catch(() => {}); };

  const rows = useMemo<Row[]>(() => {
    if (!ui.paletteOpen || mode !== "quick") return [];
    void registered; const cmds = availableCommands();
    const cmdRows: Row[] = fuzzyRank(query, cmds, (c) => ({ title: c.title, keywords: `${c.keywords ?? ""} ${c.group}` }), (c) => (c.priority ?? 0) + recencyBoost(recents, "command", c.id), 60)
      .map(({ item: c, score, positions }) => ({ key: `c:${c.id}`, group: c.group, title: c.title, positions, icon: ICONS[c.icon ?? ""] ?? (c.icon && c.icon.length <= 4 ? c.icon : <TerminalSquare />), hint: c.hint, shortcut: c.shortcut, score, run: () => runCmd(c) }));
    // pages: the tree answers instantly; server hits (archived pages, better ranking) are merged when they arrive
    const pool = new Map<string, { id: string; title: string; icon?: string | null; type?: string; section?: string }>();
    for (const n of tree) pool.set(n.id, n); if (query) for (const h of hits as any[]) if (h?.id && !pool.has(h.id)) pool.set(h.id, h);
    const pageRows: Row[] = fuzzyRank(query, [...pool.values()], (p) => ({ title: p.title || "Untitled" }), (p) => recencyBoost(recents, "page", p.id) + 6, query ? 10 : 0)
      .map(({ item: p, score, positions }) => ({ key: `p:${p.id}`, group: "Pages", title: p.title || "Untitled", positions, icon: pageIcon(p), hint: p.section, score, run: (alt) => openPage(p, alt) }));
    if (!query) {
      const byId = new Map(cmds.map((c) => [c.id, c])); const rec: Row[] = [];
      for (const e of recents.slice(0, 6)) {
        if (e.kind === "page") { const p = pool.get(e.id) ?? (e.title != null ? { id: e.id, title: e.title, icon: e.icon } : null); if (p) rec.push({ key: `r:p:${e.id}`, group: "Recent", title: p.title || "Untitled", positions: [], icon: pageIcon(p), hint: "page", score: 0, run: (alt) => openPage(p, alt) }); }
        else { const c = byId.get(e.id); if (c) rec.push({ key: `r:c:${c.id}`, group: "Recent", title: c.title, positions: [], icon: ICONS[c.icon ?? ""] ?? <Clock />, shortcut: c.shortcut, score: 0, run: () => runCmd(c) }); }
      }
      const firstPages: Row[] = tree.slice(0, 6).filter((n) => !rec.some((x) => x.key === `r:p:${n.id}`)).map((n) => ({ key: `p:${n.id}`, group: "Pages", title: n.title || "Untitled", positions: [], icon: pageIcon(n), hint: n.section, score: 0, run: (alt) => openPage(n, alt) }));
      return [...rec, ...firstPages, ...cmdRows];
    }
    const extra: Row[] = [
      { key: "x:new", group: "Create", title: `New page “${query}”`, positions: [], icon: <Plus />, score: -1, run: async () => { close(); const p = await api("/api/pages", { method: "POST", json: { title: query } }); r.push(`/p/${p.id}`); } },
      { key: "x:ask", group: "AI", title: `Ask AI “${query}”`, positions: [], icon: <Sparkles />, score: -2, run: () => { close(); ui.openAI({ prefill: query }); } },
      { key: "x:search", group: "Go to", title: `Search content for “${query}”`, positions: [], icon: <Search />, score: -3, shortcut: "⇥", run: () => { close(); r.push(`/search?q=${encodeURIComponent(query)}`); } },
    ];
    return [...pageRows, ...cmdRows, ...extra];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ui.paletteOpen, mode, query, registered, tree, hits, recents]);
  // groups ordered by their best row when searching (the best match is always first), by a fixed order otherwise
  const groups = useMemo(() => {
    const m = new Map<string, Row[]>(); for (const row of rows) { if (!m.has(row.group)) m.set(row.group, []); m.get(row.group)!.push(row); }
    const list = [...m.entries()].map(([name, items]) => ({ name, items: query ? items.slice(0, name === "Insert" ? 6 : 8) : items.slice(0, name === "Insert" ? 5 : 12), best: Math.max(...items.map((i) => i.score)) }));
    return query ? list.sort((a, b) => b.best - a.best) : list.sort((a, b) => (GROUP_ORDER.indexOf(a.name) + 99) % 99 - (GROUP_ORDER.indexOf(b.name) + 99) % 99);
  }, [rows, query]);
  if (!ui.paletteOpen) return null;
  const GH = "mb-1 [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:text-micro [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.08em] [&_[cmdk-group-heading]]:text-fg-faint";
  return (
    <div role="dialog" aria-modal="true" aria-label="Command center" className="animate-in fixed inset-0 z-50 flex items-start justify-center bg-black/35 p-2 pt-[calc(env(safe-area-inset-top)+0.5rem)] backdrop-blur-[3px] sm:p-4 sm:pt-[14vh]" onClick={close}>
      <Command shouldFilter={false} loop className="scale-in surface-pop w-full max-w-[40rem] overflow-hidden !rounded-sheet" style={{ transformOrigin: "50% 0%" }} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => { alt.current = e.altKey; if (e.key === "Escape") close(); if (e.key === "Tab") { e.preventDefault(); setMode((m) => (m === "quick" ? "full" : "quick")); } }}>
        <div className="lumen-hairline flex items-center gap-2 border-b border-line px-3"><Search className="size-4 shrink-0 text-fg-faint" aria-hidden /><Command.Input autoFocus value={q} onValueChange={setQ} placeholder={mode === "quick" ? "Search pages, run commands…" : "Search inside your notes…"} aria-label="Command center" className="h-12 min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-fg-faint sm:text-[15px]" style={{ outline: "none" }} /><button type="button" onClick={() => setMode((m) => (m === "quick" ? "full" : "quick"))} aria-pressed={mode === "full"} className={cn("h-7 shrink-0 rounded-control border px-2 text-micro font-medium", mode === "full" ? "border-accent/30 bg-accent-soft text-accent" : "border-line text-fg-muted")}>{mode === "full" ? "Content" : "Commands"} <span aria-hidden className="max-sm:hidden">⇥</span></button><button type="button" onClick={close} aria-label="Close" className="grid size-9 place-items-center rounded-control text-fg-muted sm:hidden">esc</button></div>
        <Command.List className="max-h-[min(64dvh,30rem)] overflow-y-auto overscroll-contain p-1.5" aria-label="Results">
          <Command.Empty className="px-3 py-6 text-center text-ui text-fg-muted">{mode === "full" && query.length <= 2 ? "Type at least 3 characters to search inside your notes" : "Nothing found"}</Command.Empty>
          {mode === "quick" ? groups.map((g) => (
            <Command.Group key={g.name} heading={g.name} className={GH}>
              {g.items.map((row) => <Command.Item key={row.key} value={row.key} onSelect={() => row.run(alt.current)} data-cmd={row.key} className="flex h-11 cursor-pointer items-center gap-2.5 rounded-control px-2.5 text-[15px] data-[selected=true]:bg-accent-soft sm:h-9 sm:text-ui [&_svg]:size-4 [&_svg]:text-fg-muted"><span className="grid w-5 shrink-0 place-items-center text-center">{row.icon}</span><span className="min-w-0 flex-1 truncate"><Hl text={row.title} positions={row.positions} /></span>{row.hint && <span className="hidden max-w-[40%] truncate text-micro text-fg-faint sm:inline">{row.hint}</span>}{row.shortcut && <kbd className="kbd-hint max-sm:hidden">{row.shortcut}</kbd>}</Command.Item>)}
            </Command.Group>
          )) : (hits as any[]).filter((h) => h?.chunkId).map((h: any) => <Command.Item key={h.chunkId} value={h.chunkId} onSelect={() => { close(); r.push(`/p/${h.pageId}${h.blockId ? `#block-${h.blockId}` : ""}`); }} className="cursor-pointer rounded-control px-2 py-2 data-[selected=true]:bg-bg-sunk"><div className="flex items-center gap-2 text-ui font-medium"><span>{h.icon ?? "📄"}</span><span className="truncate">{h.title}</span>{h.heading && <span className="truncate text-fg-faint">› {h.heading}</span>}<span className="ml-auto text-[10px] text-fg-faint">{h.semantic ? `sem ${(h.semantic * 100).toFixed(0)}%` : "kw"}</span></div><div className="mt-0.5 line-clamp-2 text-[12px] text-fg-muted">{h.content}</div></Command.Item>)}
        </Command.List>
        <div className="hidden items-center gap-3 border-t border-line bg-bg-sunk/60 px-3 py-2 text-micro text-fg-faint sm:flex"><span className="flex items-center gap-1"><kbd className="kbd-hint">↑↓</kbd> navigate</span><span className="flex items-center gap-1"><kbd className="kbd-hint"><CornerDownLeft className="size-3" /></kbd> run</span><span className="flex items-center gap-1"><kbd className="kbd-hint">⌥⏎</kbd> open to the side</span><span className="flex items-center gap-1"><kbd className="kbd-hint">⇥</kbd> commands / content</span><span className="ml-auto flex items-center gap-1"><kbd className="kbd-hint">esc</kbd> close</span></div>
      </Command>
    </div>
  );
}
