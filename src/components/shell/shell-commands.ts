"use client";
/**
 * file: src/components/shell/shell-commands.ts
 * description: the commands the shell itself contributes to the Universal Command Center (navigation, creation, view, theme,
 *   panels, device). Features add their own with `registerCommands` (src/lib/client/commands.ts) — the editor and the page do.
 * author: Simon-Pierre Boucher — contact@spboucher.ai
 */
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { registerCommands, type Command } from "@/lib/client/commands";
import { useUI } from "@/lib/client/store";
import { api } from "@/lib/client/api";
import type { TreeNode } from "./types";

export function useShellCommands(_tree: TreeNode[], openShortcuts: () => void) {
  const r = useRouter(); const qc = useQueryClient();
  useEffect(() => {
    const ui = () => useUI.getState(); const go = (href: string) => () => r.push(href);
    const create = (json: Record<string, unknown>) => async () => { const p = await api<{ id: string }>("/api/pages", { method: "POST", json }); qc.invalidateQueries({ queryKey: ["tree"] }); r.push(`/p/${p.id}`); };
    const onPage = () => typeof location !== "undefined" && location.pathname.startsWith("/p/");
    const wide = () => typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches;
    const nav = (id: string, title: string, href: string, icon: string, keywords = ""): Command => ({ id: `nav.${id}`, group: "Go to", title, icon, keywords, run: go(href) });
    const cmds: Command[] = [
      nav("home", "Home", "/", "home", "dashboard accueil"), nav("inbox", "Inbox", "/inbox", "inbox", "captures review"), nav("tasks", "Tasks", "/tasks", "check-square", "todo tâches"), nav("search", "Search", "/search", "search", "find recherche"),
      nav("graph", "Knowledge graph", "/graph", "share", "connections graphe"), nav("research", "Research", "/research", "flask", "references bibliography recherche"), nav("backlinks", "Backlinks", "/backlinks", "link", "connections"),
      nav("agents", "Agents", "/ai/agents", "bot"), nav("models", "AI models dashboard", "/ai/models", "bar-chart", "benchmark costs"), nav("compare", "Compare models", "/ai/compare", "columns"),
      nav("archive", "Archive", "/archive", "archive"), nav("trash", "Trash", "/trash", "trash", "deleted corbeille"), nav("settings", "Settings", "/settings", "settings", "preferences réglages"),
      { id: "create.page", group: "Create", title: "New page", shortcut: "⌘⇧N", icon: "plus", keywords: "note nouvelle page", priority: 5, run: create({ title: "" }) },
      { id: "create.database", group: "Create", title: "New database", icon: "database", keywords: "table board kanban", run: create({ title: "New database", type: "database", section: "databases" }) },
      { id: "create.research", group: "Create", title: "New research page", icon: "flask", run: create({ title: "", type: "research", section: "research" }) },
      { id: "create.capture", group: "Create", title: "Quick capture", shortcut: "⌘⇧C", icon: "inbox", keywords: "capture note inbox", priority: 4, run: () => ui().set({ captureOpen: true }) },
      { id: "ai.open", group: "AI", title: "Open the AI assistant", shortcut: "⌘/", icon: "sparkles", keywords: "ask chat", run: () => ui().openAI() },
      { id: "view.sidebar", group: "View", title: "Toggle the sidebar", shortcut: "⌘\\", icon: "panel-left", run: () => ui().toggleSidebar() },
      { id: "view.focus", group: "View", title: "Focus mode", shortcut: "⌘.", icon: "maximize", keywords: "zen distraction free", run: () => ui().set({ focusMode: !ui().focusMode }) },
      { id: "view.outline", group: "View", title: "Show the outline panel", icon: "list-tree", keywords: "table of contents headings plan", when: () => onPage() && wide(), run: () => ui().openPanel("outline") },
      { id: "view.panel.close", group: "View", title: "Close the right panel", icon: "panel-right", when: () => Boolean(ui().panel), run: () => ui().closePanel() },
      { id: "theme.light", group: "Settings", title: "Light theme", icon: "sun", keywords: "appearance clair mode", run: () => ui().setTheme("light") },
      { id: "theme.dark", group: "Settings", title: "Dark theme", icon: "moon", keywords: "appearance sombre mode", run: () => ui().setTheme("dark") },
      { id: "theme.system", group: "Settings", title: "Follow the system theme", icon: "laptop", keywords: "appearance auto", run: () => ui().setTheme("system") },
      { id: "help.shortcuts", group: "Settings", title: "Keyboard shortcuts", shortcut: "⌘?", icon: "keyboard", run: openShortcuts },
    ];
    return registerCommands(cmds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r, qc]);
}
