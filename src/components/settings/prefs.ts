"use client";
/** User preferences stored in users.preferences and mirrored in localStorage so they apply before the first fetch. */
export interface Prefs { density?: "compact" | "comfortable"; editorFont?: "sans" | "serif"; defaultSection?: "notes" | "documents" | "projects" | "research"; aiDefaultTask?: string; aiAlwaysCite?: boolean }
const KEY = "note-prefs";
export function readLocalPrefs(): Prefs { try { return JSON.parse(localStorage.getItem(KEY) ?? "{}"); } catch { return {}; } }
/** Apply density + editor font to the document (root font-size and an injected style for the editor). */
export function applyPrefs(p: Prefs) {
  if (typeof document === "undefined") return;
  const merged = { ...readLocalPrefs(), ...p }; localStorage.setItem(KEY, JSON.stringify(merged));
  const root = document.documentElement;
  root.dataset.density = merged.density ?? "comfortable";
  root.style.fontSize = merged.density === "compact" ? "15px" : "";
  root.dataset.editorFont = merged.editorFont ?? "sans";
  let st = document.getElementById("note-prefs-style") as HTMLStyleElement | null;
  if (!st) { st = document.createElement("style"); st.id = "note-prefs-style"; document.head.appendChild(st); }
  st.textContent = merged.editorFont === "serif" ? `.note-editor .ProseMirror { font-family: var(--font-serif); }` : "";
}
