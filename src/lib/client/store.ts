"use client";
import { create } from "zustand";
import { persist } from "zustand/middleware";
interface UI { sidebarOpen: boolean; aiOpen: boolean; aiWidth: number; focusMode: boolean; theme: "system" | "light" | "dark"; paletteOpen: boolean; aiContext: { pageId?: string | null; selection?: string | null; conversationId?: string | null; prefill?: string | null } ;
  set: (p: Partial<UI>) => void; toggleSidebar: () => void; toggleAI: () => void; openAI: (ctx?: UI["aiContext"]) => void; setTheme: (t: UI["theme"]) => void }
export const useUI = create<UI>()(persist((set, get) => ({
  sidebarOpen: true, aiOpen: false, aiWidth: 400, focusMode: false, theme: "system", paletteOpen: false, aiContext: {},
  set: (p) => set(p), toggleSidebar: () => set({ sidebarOpen: !get().sidebarOpen }), toggleAI: () => set({ aiOpen: !get().aiOpen }),
  openAI: (ctx) => set({ aiOpen: true, aiContext: { ...get().aiContext, ...(ctx ?? {}) } }),
  setTheme: (theme) => { set({ theme }); if (typeof document !== "undefined") { const dark = theme === "dark" || (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches); document.documentElement.classList.toggle("dark", dark); localStorage.setItem("note-theme", theme); } },
}), { name: "note-ui", partialize: (s) => ({ sidebarOpen: s.sidebarOpen, aiWidth: s.aiWidth, theme: s.theme }) }));
