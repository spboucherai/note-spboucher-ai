/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/components/database/view-logic.ts
 * Description      : pure logic of the database views (no React): the column
 *                    order of a view, and the virtual layout of the grid (which
 *                    line holds which group header, row or "New" line)
 *                    described by a few segments instead of one object per row.
 * Module           : components
 * Repository       : https://git.spboucher.ai/note-spboucher-ai
 * Project Website  : https://note.spboucher.ai
 * Created          : 2026-11-19
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

import type { Property, View } from "@/lib/databases/types";
import type { ViewGroup } from "./group";

/** Columns of a view: the title first, then the view's own order (`config.order`, 3.0) and the database order for the rest. */
export function orderedProps(props: Property[], view: View): Property[] {
  const order = Array.isArray(view.config.order) ? view.config.order : []; if (!order.length) return props;
  const at = new Map(order.map((id, i) => [id, i])); const base = new Map(props.map((p, i) => [p.id, i]));
  return [...props].sort((a, b) => (a.type === "title" ? -1 : b.type === "title" ? 1 : (at.get(a.id) ?? 1e6 + base.get(a.id)!) - (at.get(b.id) ?? 1e6 + base.get(b.id)!)));
}

export type Entry = { t: "group"; g: ViewGroup } | { t: "row"; i: number } | { t: "add"; g?: ViewGroup };
export interface Seg { start: number; len: number; kind: Entry["t"]; g?: ViewGroup; base: number }
/** Virtual layout of the grid: one 36 px line per group header, row and "New" line, described by a few segments (never one object per row). */
export function layout(groups: ViewGroup[], grouped: boolean, collapsed: Set<string>, total: number): { segs: Seg[]; lines: number } {
  const segs: Seg[] = []; let at = 0; const push = (kind: Entry["t"], len: number, g: ViewGroup | undefined, base: number) => { if (len > 0) { segs.push({ start: at, len, kind, g, base }); at += len; } };
  if (!grouped) { push("row", total, undefined, 0); push("add", 1, undefined, 0); return { segs, lines: at }; }
  for (const g of groups) { if (!g.count) continue; push("group", 1, g, 0); if (!collapsed.has(g.key)) { push("row", g.count, g, g.offset); push("add", 1, g, 0); } }
  return { segs, lines: at };
}
export function entryAt(segs: Seg[], v: number): Entry | null { for (const s of segs) if (v >= s.start && v < s.start + s.len) return s.kind === "row" ? { t: "row", i: s.base + (v - s.start) } : s.kind === "group" ? { t: "group", g: s.g! } : { t: "add", g: s.g }; return null; }

