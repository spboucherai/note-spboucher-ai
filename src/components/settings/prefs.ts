/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/components/settings/prefs.ts
 * Module           : components
 * Repository       : https://git.spboucher.ai/note-spboucher-ai
 * Project Website  : https://note.spboucher.ai
 * Created          : 2026-11-01
 * Last Modified    : 2026-11-01
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
