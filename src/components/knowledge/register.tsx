"use client";
/**
 * file: src/components/knowledge/register.tsx
 * description: registration of the knowledge screens in the shell — the per-page Timeline panel of the right panel host
 *   (`registerPanel`) and the commands of the Universal Command Center (`registerCommands`): Ask My Knowledge, Timeline, Time
 *   Machine, Knowledge Health, Thought Constellation, the seven graph views, relations, concepts, insights. A command that would
 *   start an AI call only opens the screen where the user presses the button: nothing is ever sent from the palette.
 * author: Simon-Pierre Boucher — contact@spboucher.ai
 */
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { History } from "lucide-react";
import { registerCommands, type Command } from "@/lib/client/commands";
import { registerPanel } from "@/lib/client/panels";
import { useUI } from "@/lib/client/store";
import { VIEWS } from "@/lib/client/knowledge";
import { PageTimelinePanel } from "./Timeline";

let panels = false;
export function registerKnowledgePanels() {
  if (panels) return; panels = true;
  registerPanel({ id: "timeline", title: "Timeline", icon: <History />, available: (c) => Boolean(c.pageId), render: (c) => <PageTimelinePanel pageId={c.pageId} /> });
}
const pageOnScreen = () => (typeof location !== "undefined" && location.pathname.startsWith("/p/") ? location.pathname.slice(3).split(/[/?#]/)[0] : null);
const wide = () => typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches;

export function useKnowledgeCommands() {
  const r = useRouter();
  useEffect(() => {
    registerKnowledgePanels();
    const go = (href: string | (() => string)) => () => r.push(typeof href === "function" ? href() : href);
    const cmds: Command[] = [
      { id: "nav.ask", group: "Go to", title: "Ask My Knowledge", icon: "sparkles", keywords: "ai chat assistant question conversations demander", run: go("/ai") },
      { id: "nav.brief", group: "Go to", title: "Daily brief", icon: "home", keywords: "home today tasks due recent brief du jour", run: go("/") },
      { id: "nav.timeline", group: "Go to", title: "Knowledge timeline", icon: "history", keywords: "events journal history chronologie", run: go("/timeline") },
      { id: "nav.timemachine", group: "Go to", title: "Time machine", icon: "clock", keywords: "history version date restore past machine à remonter le temps", run: go(() => { const p = pageOnScreen(); return p ? `/timemachine?pageId=${p}` : "/timemachine"; }) },
      { id: "nav.health", group: "Go to", title: "Knowledge health", icon: "heart-pulse", keywords: "orphans broken links duplicates untitled inactive santé", run: go("/health") },
      { id: "nav.constellation", group: "Go to", title: "Thought constellation (Labs)", icon: "sparkle", keywords: "stars embeddings semantic map spatial labs", run: go("/constellation") },
      ...VIEWS.filter((v) => v.id !== "global").map((v): Command => ({ id: `graph.view.${v.id}`, group: "Graph", title: `Graph: ${v.label.toLowerCase()} view`, icon: "share", keywords: `knowledge graph ${v.hint}`, run: go(() => { const p = pageOnScreen(); return `/graph?view=${v.id}${v.needsPage && p ? `&pageId=${p}` : ""}`; }) })),
      { id: "graph.relation.new", group: "Graph", title: "New typed relation", icon: "link", keywords: "relation supports contradicts extends connect pages", run: go(() => { const p = pageOnScreen(); return `/graph?new=relation${p ? `&view=local&pageId=${p}` : ""}`; }) },
      { id: "graph.concepts", group: "Graph", title: "Manage concepts", icon: "lightbulb", keywords: "concepts ideas topics", run: go("/graph?view=concepts&panel=concepts") },
      { id: "graph.insights", group: "Graph", title: "Graph insights", icon: "sparkles", keywords: "central pages orphans clusters duplicates contradictions open questions analysis", run: go("/graph?panel=insights") },
      { id: "graph.review", group: "Graph", title: "Review suggested relations", icon: "share", keywords: "ai suggestions accept reject", run: go("/graph?panel=suggested") },
      { id: "page.timeline", group: "Page", title: "Timeline of this page", icon: "history", keywords: "events history journal", when: () => Boolean(pageOnScreen()), run: () => { const p = pageOnScreen(); if (!p) return; if (wide()) useUI.getState().openPanel("timeline"); else r.push(`/timeline?pageId=${p}`); } },
      { id: "page.timemachine", group: "Page", title: "Time machine for this page", icon: "clock", keywords: "past version date restore", when: () => Boolean(pageOnScreen()), run: go(() => `/timemachine?pageId=${pageOnScreen()}`) },
      { id: "page.graph.local", group: "Page", title: "Local graph of this page", icon: "share", keywords: "connections neighbours", when: () => Boolean(pageOnScreen()), run: go(() => `/graph?view=local&pageId=${pageOnScreen()}`) },
    ];
    return registerCommands(cmds);
  }, [r]);
}
