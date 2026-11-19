"use client";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useUI, followSystemTheme } from "@/lib/client/store";
import { RightPanel, registerBuiltInPanels } from "./RightPanel";
import { useShellCommands } from "./shell-commands";
import { useKnowledgeCommands } from "@/components/knowledge/register"; // NEXT-K
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { MobileNav, MobileHeader } from "./MobileNav";
import { CaptureSheet } from "./CaptureSheet";
import { flushOutbox } from "@/lib/client/outbox";
import { purgeExpired } from "@/lib/client/offline";
import { CommandPalette } from "./CommandPalette";
import { AIPanel } from "./AIPanel";
import { ShortcutsDialog } from "./ShortcutsDialog";
import { Minimize2 } from "lucide-react";
import type { TreeNode, ShellUser } from "./types";
import { cn } from "@/lib/utils";
import { api } from "@/lib/client/api";
import { applyPrefs, readLocalPrefs } from "@/components/settings/prefs";

export function Shell({ user, workspace, initialTree, children }: { user: ShellUser; workspace: { id: string; name: string }; initialTree: TreeNode[]; children: React.ReactNode }) {
  const ui = useUI(); const r = useRouter(); const pathname = usePathname(); const [help, setHelp] = useState(false);
  const { data: tree = initialTree } = useQuery({ queryKey: ["tree"], queryFn: () => api<TreeNode[]>("/api/tree"), initialData: initialTree, staleTime: 10_000 });
  useEffect(() => { ui.setTheme(ui.theme); try { applyPrefs(readLocalPrefs()); } catch {} registerBuiltInPanels(); return followSystemTheme(); /* eslint-disable-next-line */ }, []);
  useShellCommands(tree, () => setHelp(true));
  useKnowledgeCommands(); // NEXT-K: knowledge screens (graph views, timeline, time machine, health, constellation, ask) + the per-page Timeline panel
  // Handles for the end-to-end suites and for debugging from the console (UI state and motion helpers only — no data, no credentials).
  useEffect(() => { const w = window as unknown as Record<string, unknown>; w.__noteUI = () => useUI.getState(); w.__noteMotion = () => import("@/lib/client/motion"); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === "k") { e.preventDefault(); ui.set({ paletteOpen: !ui.paletteOpen }); }
      else if (mod && e.key === "/") { e.preventDefault(); ui.toggleAI(); }
      else if (mod && e.key === "\\") { e.preventDefault(); ui.toggleSidebar(); }
      else if (mod && e.shiftKey && e.key.toLowerCase() === "n") { e.preventDefault(); api("/api/pages", { method: "POST", json: { title: "" } }).then((p) => r.push(`/p/${p.id}`)); }
      else if (mod && e.shiftKey && e.key.toLowerCase() === "c") { e.preventDefault(); ui.set({ captureOpen: true }); }
      else if (mod && e.key === ".") { e.preventDefault(); ui.set({ focusMode: !ui.focusMode }); }
      else if (mod && (e.key === "?" || (e.shiftKey && e.key === "/"))) { e.preventDefault(); setHelp((h) => !h); }
      else if (e.key === "Escape" && ui.focusMode && !(e.target as HTMLElement)?.closest?.(".ProseMirror")) ui.set({ focusMode: false });
    };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, [ui, r]);
  useEffect(() => { const h = () => setHelp(true); window.addEventListener("note:shortcuts", h); return () => window.removeEventListener("note:shortcuts", h); }, []);
  const [update, setUpdate] = useState<ServiceWorker | null>(null);
  useEffect(() => {
    if (!("serviceWorker" in navigator) || process.env.NODE_ENV !== "production") return;
    // A new version never takes over a tab in the middle of an edit: it waits, and the user chooses when to reload.
    navigator.serviceWorker.register("/sw.js").then((reg) => {
      const watch = (w: ServiceWorker | null) => { if (!w) return; w.addEventListener("statechange", () => { if (w.state === "installed" && navigator.serviceWorker.controller) setUpdate(w); }); };
      if (reg.waiting && navigator.serviceWorker.controller) setUpdate(reg.waiting);
      reg.addEventListener("updatefound", () => watch(reg.installing));
      const check = () => { if (document.visibilityState === "visible") reg.update().catch(() => {}); }; document.addEventListener("visibilitychange", check);
    }).catch(() => {});
    // Reload only when the user asked for the update. (The first install also fires controllerchange — reloading then would throw away an open sheet or a half-typed capture.)
    let reloaded = false; navigator.serviceWorker.addEventListener("controllerchange", () => { if (!reloaded && (window as any).__noteUpdateAccepted) { reloaded = true; window.location.reload(); } });
  }, []);
  // Installed-app shortcuts (manifest): /?capture=1 opens the capture sheet, /?ai=1 the assistant.
  useEffect(() => { const q = new URLSearchParams(window.location.search); if (q.get("capture") === "1") { ui.set({ captureOpen: true }); history.replaceState(null, "", "/"); } else if (q.get("ai") === "1") { ui.openAI(); history.replaceState(null, "", "/"); } /* eslint-disable-next-line */ }, []);
  // Device-local hygiene + replay of what was captured offline (after a wake from sleep, a relaunch of the installed app, or the network coming back).
  useEffect(() => { purgeExpired().catch(() => {}); flushOutbox().catch(() => {}); const kick = () => { if (document.visibilityState === "visible" && navigator.onLine) flushOutbox().catch(() => {}); }; window.addEventListener("online", kick); document.addEventListener("visibilitychange", kick); window.addEventListener("pageshow", kick); return () => { window.removeEventListener("online", kick); document.removeEventListener("visibilitychange", kick); window.removeEventListener("pageshow", kick); }; }, []);
  const sidebar = ui.sidebarOpen && !ui.focusMode;
  return (
    <div className="flex h-dvh w-full overflow-hidden bg-bg">
      <a href="#main-scroll" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[60] focus:rounded-control focus:bg-bg-elev focus:px-3 focus:py-2 focus:text-ui focus:shadow-pop">Skip to content</a>
      <aside className={cn("sidebar-glass hidden md:flex shrink-0 flex-col overflow-hidden border-r border-line transition-[width] duration-base ease-standard", sidebar ? "w-[17rem]" : "w-0 border-r-0")}><div className="h-full w-[17rem] shrink-0"><Sidebar tree={tree} user={user} workspace={workspace} /></div></aside>
      <div className="flex min-w-0 flex-1 flex-col">
        {!ui.focusMode && <TopBar tree={tree} />}
        {!ui.focusMode && <MobileHeader tree={tree} />}
        <main className={cn("relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain", "pb-[calc(4.5rem+env(safe-area-inset-bottom))] md:pb-0")} id="main-scroll" tabIndex={-1}>{children}</main>
        <MobileNav tree={tree} />
      </div>
      {ui.aiOpen && !ui.focusMode && <AIPanel pathname={pathname} />}
      {!ui.aiOpen && !ui.focusMode && <RightPanel pathname={pathname} />}
      <CommandPalette tree={tree} />
      <CaptureSheet />
      {update && <div role="status" className="fixed inset-x-3 top-[calc(env(safe-area-inset-top)+0.5rem)] z-[70] mx-auto flex max-w-md items-center gap-3 rounded-xl border border-line bg-bg-elev p-3 text-[13.5px] shadow-pop"><span className="min-w-0 flex-1">A new version is ready.</span><button className="h-9 rounded-lg bg-accent px-3 font-medium text-accent-fg" onClick={() => { (window as any).__noteUpdateAccepted = true; update.postMessage({ type: "SKIP_WAITING" }); }}>Reload</button><button aria-label="Later" className="h-9 px-2 text-fg-muted" onClick={() => setUpdate(null)}>Later</button></div>}
      <ShortcutsDialog open={help} onOpenChange={setHelp} />
      {ui.focusMode && <button onClick={() => ui.set({ focusMode: false })} title="Exit focus mode (⌘.)" className="fixed right-3 top-3 z-30 grid size-8 place-items-center rounded-md border border-line bg-bg-elev/80 text-fg-muted shadow-card backdrop-blur hover:text-fg safe-top"><Minimize2 className="size-4" /></button>}
    </div>
  );
}
