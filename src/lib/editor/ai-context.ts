/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/lib/editor/ai-context.ts
 * Description      : pure side of the contextual AI menu (SPEC §4.10,
 *                    docs/next/API-NEXT-AI.md §3): the catalogue of the
 *                    analysis actions added in 3.0 (`coherence`, `questions`,
 *                    `synthesis`, `structure`, `links`), the attrs of the
 *                    `aiBlock` an accepted result is wrapped in (`action` +
 *                    `sources`, SPEC §2), the reader of the `links` result
 *                    event and the search of a suggested anchor inside the
 *                    selection. Nothing here calls a model or changes a
 *                    document: AI output is only ever applied by an explicit
 *                    user action.
 * Module           : lib
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

export interface AiSource { pageId: string; blockId: string | null; title: string }
/** Analysis actions: they comment on the selection instead of rewriting it, so their result is inserted below — never "Replace". */
export const ANALYSIS_ACTIONS: { id: string; label: string; hint: string }[] = [
  { id: "coherence", label: "Check coherence", hint: "Logic, terminology, internal contradictions" },
  { id: "questions", label: "Open questions", hint: "What the text leaves unanswered" },
  { id: "synthesis", label: "Synthesis", hint: "The essential, in a few lines" },
  { id: "structure", label: "Improve structure", hint: "A better outline; what to move, merge or cut" },
  { id: "links", label: "Suggest links", hint: "Pages of yours this passage could link to" },
];
export const isAnalysisAction = (id: string | null | undefined) => ANALYSIS_ACTIONS.some((a) => a.id === id);
/** attrs of the `aiBlock` wrapping an accepted result. `sources` is omitted (null) when empty so 2.x readers see nothing new. */
export function aiBlockAttrs(i: { model?: string | null; action: string; label: string; instruction?: string | null; sources?: AiSource[]; at?: string }) {
  const sources = (i.sources ?? []).filter((s) => s && typeof s.pageId === "string" && s.pageId).slice(0, 8).map((s) => ({ pageId: s.pageId, blockId: s.blockId ?? null, title: String(s.title ?? "").slice(0, 120) }));
  return { model: i.model ?? null, prompt: i.label + (i.instruction ? `: ${i.instruction}` : ""), at: i.at ?? new Date().toISOString(), action: i.action, sources: sources.length ? sources : null };
}

export interface LinkSuggestion { pageId: string; title: string; icon: string | null; blockId: string | null; excerpt: string; anchorText: string | null; reason: string; score: number | null }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Reads `{type:"result", data:{ai:true, model?, links:[…], candidates}}`. Entries without a valid page id are dropped; a page is suggested once. */
export function parseLinksResult(data: unknown): { links: LinkSuggestion[]; candidates: number; model: string | null } {
  const d = (data && typeof data === "object" ? data : {}) as Record<string, unknown>; const seen = new Set<string>(); const links: LinkSuggestion[] = [];
  for (const raw of Array.isArray(d.links) ? d.links : []) {
    const l = raw as Record<string, unknown> | null; if (!l || typeof l.pageId !== "string" || !UUID.test(l.pageId) || seen.has(l.pageId)) continue; seen.add(l.pageId);
    links.push({ pageId: l.pageId, title: typeof l.title === "string" && l.title.trim() ? l.title : "Untitled", icon: typeof l.icon === "string" && l.icon ? l.icon : null, blockId: typeof l.blockId === "string" && l.blockId ? l.blockId : null,
      excerpt: typeof l.excerpt === "string" ? l.excerpt : "", anchorText: typeof l.anchorText === "string" && l.anchorText.trim() ? l.anchorText : null, reason: typeof l.reason === "string" ? l.reason : "", score: typeof l.score === "number" ? l.score : null });
  }
  return { links, candidates: typeof d.candidates === "number" ? d.candidates : links.length, model: typeof d.model === "string" ? d.model : null };
}
export const linkHref = (l: Pick<LinkSuggestion, "pageId" | "blockId">) => `/p/${l.pageId}${l.blockId ? `#block-${l.blockId}` : ""}`;

/** The slice of ProseMirror's Node this module needs (kept structural so it is testable without a schema). */
export interface DocLike { content: { size: number }; nodesBetween: (from: number, to: number, f: (node: NodeLike, pos: number) => boolean | void) => void }
export interface NodeLike { isTextblock: boolean; isText?: boolean; isLeaf?: boolean; nodeSize: number; text?: string | null; content: { size: number }; attrs: Record<string, unknown>; type: { name: string }; marks?: readonly { type: { name: string } }[]; forEach: (f: (child: NodeLike, offset: number) => void) => void; textContent: string }
/**
 * Where `anchor` is written inside [from, to]: the first occurrence that lies within one text block, inside the range and not already
 * a link. Positions are document positions. `null` when it is not there (the caller then inserts a page mention instead).
 */
export function findAnchor(doc: DocLike, range: { from: number; to: number }, anchor: string | null): { from: number; to: number } | null {
  const needle = (anchor ?? "").trim(); if (!needle) return null; let found: { from: number; to: number } | null = null;
  const from = Math.max(0, range.from), to = Math.min(doc.content.size, range.to);
  doc.nodesBetween(from, to, (node, pos) => {
    if (found) return false; if (!node.isTextblock) return true;
    // one character per position: text as is, every inline atom as one placeholder (its nodeSize is 1)
    let text = ""; const linked: boolean[] = [];
    node.forEach((child) => { if (child.isText) { const t = child.text ?? ""; const isLink = (child.marks ?? []).some((m) => m.type.name === "link"); text += t; for (let i = 0; i < t.length; i++) linked.push(isLink); } else { text += "￼".repeat(child.nodeSize); for (let i = 0; i < child.nodeSize; i++) linked.push(true); } });
    for (let i = text.indexOf(needle); i >= 0; i = text.indexOf(needle, i + 1)) {
      const a = pos + 1 + i, b = a + needle.length; if (a < from || b > to) continue; if (linked.slice(i, i + needle.length).some(Boolean)) continue;
      found = { from: a, to: b }; break;
    }
    return false;
  });
  return found;
}
/** Top-level blocks the range touches, as `aiBlock.sources` (the passage the AI commented on). `title` = the first words of the block. */
export function sourcesOfRange(doc: DocLike, range: { from: number; to: number } | null, pageId: string | null | undefined, max = 4): AiSource[] {
  if (!pageId || !range) return []; const out: AiSource[] = [];
  doc.nodesBetween(Math.max(0, range.from), Math.min(doc.content.size, range.to), (node) => {
    if (out.length >= max) return false; const id = typeof node.attrs?.id === "string" && node.attrs.id ? node.attrs.id : null;
    if (id && !out.some((s) => s.blockId === id)) { const t = node.textContent.replace(/\s+/g, " ").trim(); out.push({ pageId, blockId: id, title: t.length > 60 ? `${t.slice(0, 59)}…` : t || node.type.name }); }
    return false; // top-level blocks only
  });
  return out;
}
