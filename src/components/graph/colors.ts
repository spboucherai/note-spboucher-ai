/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/components/graph/colors.ts
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
import { useEffect, useState } from "react";
import type { EdgeKind, NodeKind } from "@/lib/graph/types";

/** Design tokens resolved from CSS variables so the canvas follows light/dark mode (oklch strings are valid canvas colours). */
export interface ThemeColors { bg: string; bgElev: string; fg: string; fgMuted: string; fgFaint: string; line: string; lineStrong: string; accent: string; ai: string; success: string; warning: string; danger: string; font: string }
const DEFAULTS: ThemeColors = { bg: "#fcfcfb", bgElev: "#ffffff", fg: "#1f2330", fgMuted: "#6b7080", fgFaint: "#a0a4b0", line: "#e6e7ea", lineStrong: "#cfd1d6", accent: "#4a63d6", ai: "#8a5bd6", success: "#3f9a65", warning: "#d9a63f", danger: "#d14b3a", font: "Inter, system-ui, sans-serif" };
export function readThemeColors(): ThemeColors {
  if (typeof window === "undefined") return DEFAULTS;
  const s = getComputedStyle(document.documentElement); const v = (n: string, fb: string) => s.getPropertyValue(n).trim() || fb;
  return { bg: v("--bg", DEFAULTS.bg), bgElev: v("--bg-elev", DEFAULTS.bgElev), fg: v("--fg", DEFAULTS.fg), fgMuted: v("--fg-muted", DEFAULTS.fgMuted), fgFaint: v("--fg-faint", DEFAULTS.fgFaint), line: v("--line", DEFAULTS.line), lineStrong: v("--line-strong", DEFAULTS.lineStrong), accent: v("--accent", DEFAULTS.accent), ai: v("--ai", DEFAULTS.ai), success: v("--success", DEFAULTS.success), warning: v("--warning", DEFAULTS.warning), danger: v("--danger", DEFAULTS.danger), font: v("--font-sans", DEFAULTS.font) };
}
export function useThemeColors(): ThemeColors {
  const [c, setC] = useState<ThemeColors>(DEFAULTS);
  useEffect(() => { setC(readThemeColors()); const mo = new MutationObserver(() => setC(readThemeColors())); mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] }); return () => mo.disconnect(); }, []);
  return c;
}
export const kindColor = (c: ThemeColors, kind: NodeKind) => ({ page: c.accent, database: c.success, research: c.ai, row: c.warning, attachment: c.fgMuted, tag: c.fgFaint })[kind] ?? c.accent;
export const edgeColor = (c: ThemeColors, kind: EdgeKind, suggested: boolean) => (suggested ? c.ai : kind === "relation" ? c.success : kind === "link" ? c.lineStrong : c.line);
/** Tailwind classes matching kindColor, for legends/badges. */
export const KIND_CLASS: Record<NodeKind, string> = { page: "bg-accent", database: "bg-success", research: "bg-ai", row: "bg-warning", attachment: "bg-fg-muted", tag: "bg-fg-faint" };
