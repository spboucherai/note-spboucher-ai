/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/lib/client/store.ts
 * Module           : lib
 * Repository       : https://git.spboucher.ai/note-spboucher-ai
 * Project Website  : https://note.spboucher.ai
 * Created          : 2026-11-01
 * Last Modified    : 2026-11-19
 *
 * Author           : Simon-Pierre Boucher
 * Position         : Professor of Finance
 * Institution      : Université du Québec en Outaouais (UQO)
 * Organization     : SP Boucher
 * Website          : https://spboucher.ai
 * Git              : https://git.spboucher.ai
 *
 * Preferred Contact: contact@spboucher.ai
 * Development      : dev@spboucher.ai
 * Support          : support@spboucher.ai
 * Security/Admin   : admin@spboucher.ai
 *
 * Copyright (c) 2026
 * Simon-Pierre Boucher
 * All rights reserved where applicable. This file is governed by the
 * applicable project license, copyright notices and relevant law.
 * Existing third-party rights and notices remain unaffected.
 *
 * License          : None specified (no license file in this repository)
 *
 * Do not embed credentials, private keys, access tokens,
 * certificates or confidential personal information.
 *
 * =============================================================================
 * END OF SP BOUCHER SOURCE HEADER
 * =============================================================================
 */

"use client";
/**
 * file: src/lib/client/store.ts
 * description: UI state of the shell (zustand, device-local). 3.0 adds the right panel host (`panel`: which registered panel is open
 *   and its argument, e.g. the page shown in the side pane) and a `system` theme that follows the OS while the app is open.
 * author: Simon-Pierre Boucher — contact@spboucher.ai
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";
export interface PanelState { id: string; arg?: string | null }
interface UI { sidebarOpen: boolean; aiOpen: boolean; aiWidth: number; focusMode: boolean; theme: "system" | "light" | "dark"; paletteOpen: boolean; captureOpen: boolean; drawerOpen: boolean; aiContext: { pageId?: string | null; selection?: string | null; conversationId?: string | null; prefill?: string | null };
  /** right panel host: a panel registered in src/lib/client/panels.ts (the assistant keeps its own `aiOpen` flag and wins when both are set) */ panel: PanelState | null;
  set: (p: Partial<UI>) => void; toggleSidebar: () => void; toggleAI: () => void; openAI: (ctx?: UI["aiContext"]) => void; setTheme: (t: UI["theme"]) => void; openPanel: (id: string, arg?: string | null) => void; closePanel: () => void }
const applyTheme = (theme: UI["theme"]) => { if (typeof document === "undefined") return; const dark = theme === "dark" || (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches); document.documentElement.classList.toggle("dark", dark); };
export const useUI = create<UI>()(persist((set, get) => ({
  sidebarOpen: true, aiOpen: false, aiWidth: 400, focusMode: false, theme: "system", paletteOpen: false, captureOpen: false, drawerOpen: false, aiContext: {}, panel: null,
  set: (p) => set(p), toggleSidebar: () => set({ sidebarOpen: !get().sidebarOpen }), toggleAI: () => set({ aiOpen: !get().aiOpen }),
  openAI: (ctx) => set({ aiOpen: true, aiContext: { ...get().aiContext, ...(ctx ?? {}) } }),
  setTheme: (theme) => { set({ theme }); if (typeof document !== "undefined") { applyTheme(theme); localStorage.setItem("note-theme", theme); } },
  openPanel: (id, arg = null) => set({ panel: { id, arg }, aiOpen: false }), closePanel: () => set({ panel: null }),
}), { name: "note-ui", partialize: (s) => ({ sidebarOpen: s.sidebarOpen, aiWidth: s.aiWidth, theme: s.theme }) }));
/** In `system` mode the theme follows an OS change while the app is open (before 3.0 it was only read at load). Returns the unsubscribe. */
export function followSystemTheme(): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const m = window.matchMedia("(prefers-color-scheme: dark)"); const on = () => { if (useUI.getState().theme === "system") applyTheme("system"); };
  m.addEventListener("change", on); return () => m.removeEventListener("change", on);
}
