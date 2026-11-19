/**
 * file: src/lib/client/panels.ts
 * description: registry of the right-panel host (multi-panel workspace). A feature registers a panel (knowledge, properties, AI,
 *   timeline…) with `registerPanel`; the shell shows it in the resizable right column with `useUI().openPanel(id, arg)`. The registry
 *   holds a render function, so it stays free of feature imports.
 * author: Simon-Pierre Boucher — contact@spboucher.ai
 */
import type { ReactNode } from "react";
export interface PanelDef {
  id: string; title: string; /** lucide icon element */ icon?: ReactNode;
  /** shown as a tab in the panel header only when it returns true for the current route (default: always) */ available?: (ctx: PanelContext) => boolean;
  /** tone of the header mark: "ai" for anything produced by a model */ tone?: "neutral" | "ai";
  render: (ctx: PanelContext) => ReactNode;
}
export interface PanelContext { /** page on screen, or null */ pageId: string | null; pathname: string; /** argument given to openPanel (e.g. a page id) */ arg: string | null; close: () => void }
const panels = new Map<string, PanelDef>(); const listeners = new Set<() => void>(); let snapshot: PanelDef[] = [];
const emit = () => { snapshot = [...panels.values()]; for (const l of listeners) l(); };
export function registerPanel(def: PanelDef): () => void { panels.set(def.id, def); emit(); return () => { if (panels.get(def.id) === def) { panels.delete(def.id); emit(); } }; }
export const subscribePanels = (cb: () => void) => { listeners.add(cb); return () => { listeners.delete(cb); }; };
export const getPanels = () => snapshot;
export const getPanel = (id: string) => panels.get(id);
