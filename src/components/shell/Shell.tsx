"use client";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useUI } from "@/lib/client/store";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { MobileNav } from "./MobileNav";
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
  useEffect(() => { ui.setTheme(ui.theme); try { applyPrefs(readLocalPrefs()); } catch {} /* eslint-disable-next-line */ }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === "k") { e.preventDefault(); ui.set({ paletteOpen: !ui.paletteOpen }); }
      else if (mod && e.key === "/") { e.preventDefault(); ui.toggleAI(); }
      else if (mod && e.key === "\\") { e.preventDefault(); ui.toggleSidebar(); }
      else if (mod && e.shiftKey && e.key.toLowerCase() === "n") { e.preventDefault(); api("/api/pages", { method: "POST", json: { title: "" } }).then((p) => r.push(`/p/${p.id}`)); }
      else if (mod && e.key === ".") { e.preventDefault(); ui.set({ focusMode: !ui.focusMode }); }
      else if (mod && (e.key === "?" || (e.shiftKey && e.key === "/"))) { e.preventDefault(); setHelp((h) => !h); }
      else if (e.key === "Escape" && ui.focusMode && !(e.target as HTMLElement)?.closest?.(".ProseMirror")) ui.set({ focusMode: false });
    };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, [ui, r]);
  useEffect(() => { if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") navigator.serviceWorker.register("/sw.js").catch(() => {}); }, []);
  const sidebar = ui.sidebarOpen && !ui.focusMode;
  return (
    <div className="flex h-dvh w-full overflow-hidden bg-bg">
      <aside className={cn("hidden md:flex shrink-0 flex-col border-r border-line bg-bg-sunk/60 transition-[width] duration-200", sidebar ? "w-64" : "w-0 overflow-hidden border-r-0")}><Sidebar tree={tree} user={user} workspace={workspace} /></aside>
      <div className="flex min-w-0 flex-1 flex-col">
        {!ui.focusMode && <TopBar tree={tree} />}
        <main className={cn("relative min-h-0 flex-1 overflow-y-auto overscroll-contain", "pb-16 md:pb-0")} id="main-scroll">{children}</main>
        <MobileNav />
      </div>
      {ui.aiOpen && !ui.focusMode && <AIPanel pathname={pathname} />}
      <CommandPalette tree={tree} />
      <ShortcutsDialog open={help} onOpenChange={setHelp} />
      {ui.focusMode && <button onClick={() => ui.set({ focusMode: false })} title="Exit focus mode (⌘.)" className="fixed right-3 top-3 z-30 grid size-8 place-items-center rounded-md border border-line bg-bg-elev/80 text-fg-muted shadow-card backdrop-blur hover:text-fg safe-top"><Minimize2 className="size-4" /></button>}
    </div>
  );
}
