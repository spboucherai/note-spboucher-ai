/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/lib/pages/zoom.ts
 * Description      : semantic zoom (SPEC §4.9). Level 3 = the full document;
 *                    level 2 = the outline (headings + the first sentence of
 *                    each section), computed here without any model; level 1 =
 *                    an AI synopsis, owned by the AI workstream. SEAM for level
 *                    1: assign `zoomSynopsis.provider` (or replace the body of
 *                    `zoomLevel1`) — the route already calls it and answers 501
 *                    `not_implemented` while it is null.
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

import { HttpError } from "@/lib/errors";
import { nodeText, type PMNode } from "@/lib/editor/text";
import type { Page } from "./service";

export interface OutlineSection { blockId: string | null; level: number; heading: string | null; firstSentence: string; words: number; blocks: number }
export interface ZoomOutline { level: 2; pageId: string; title: string; version: number; updatedAt: Date; ai: false; sections: OutlineSection[] }
export interface ZoomFull { level: 3; pageId: string; title: string; version: number; updatedAt: Date; ai: false; content: unknown }
/** Level 1 answer, to be produced by the AI workstream: always `ai: true`, with the model and the page version it was made from (cache key). */
export interface ZoomSynopsis { level: 1; pageId: string; title: string; version: number; ai: true; model: string; generatedAt: string; cached: boolean; synopsis: string }

const words = (s: string) => (s.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) ?? []).length;
/** First sentence of a text: up to the first `.`, `!`, `?` or `…` followed by a space or the end; at most 240 characters (cut on a word, with `…`). */
export function firstSentence(text: string): string {
  const t = text.replace(/\s+/g, " ").trim(); if (!t) return "";
  const m = /^(.*?[.!?…])(?=\s|$)/.exec(t); const s = m ? m[1] : t;
  if (s.length <= 240) return s; const cut = s.slice(0, 240); return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 200)).trimEnd()}…`;
}
/**
 * Outline of a document: one section per top-level heading (any level), plus a leading section with `heading: null` for the text
 * before the first heading. `firstSentence` comes from the first non-empty block of the section; `words` and `blocks` count the body.
 */
export function outlineOf(doc: PMNode | null | undefined): OutlineSection[] {
  const out: OutlineSection[] = []; let cur: OutlineSection | null = null;
  for (const n of doc?.content ?? []) {
    if (n.type === "heading") { cur = { blockId: typeof n.attrs?.id === "string" ? n.attrs.id : null, level: Math.min(6, Math.max(1, Number(n.attrs?.level ?? 1))), heading: nodeText(n).replace(/\s+/g, " ").trim(), firstSentence: "", words: 0, blocks: 0 }; out.push(cur); continue; }
    const text = nodeText(n).trim(); if (!text) continue;
    if (!cur) { cur = { blockId: typeof n.attrs?.id === "string" ? n.attrs.id : null, level: 0, heading: null, firstSentence: "", words: 0, blocks: 0 }; out.push(cur); }
    if (!cur.firstSentence) cur.firstSentence = firstSentence(text.split("\n").find((l) => l.trim()) ?? text);
    cur.words += words(text); cur.blocks++;
  }
  return out;
}
export const zoomLevel2 = (p: Page): ZoomOutline => ({ level: 2, pageId: p.id, title: p.title, version: p.version, updatedAt: p.updatedAt, ai: false, sections: outlineOf(p.content as PMNode) });
export const zoomLevel3 = (p: Page): ZoomFull => ({ level: 3, pageId: p.id, title: p.title, version: p.version, updatedAt: p.updatedAt, ai: false, content: p.content });
// <!-- AI-WORKSTREAM --> level 1 (AI synopsis, cached per page version, marked AI)
export const zoomSynopsis: { provider: ((workspaceId: string, page: Page, opts: { refresh?: boolean }) => Promise<ZoomSynopsis>) | null } = { provider: null };
export async function zoomLevel1(workspaceId: string, page: Page, opts: { refresh?: boolean } = {}): Promise<ZoomSynopsis> {
  if (!zoomSynopsis.provider) throw new HttpError(501, "Semantic zoom level 1 (AI synopsis) is not available on this server", "not_implemented");
  return zoomSynopsis.provider(workspaceId, page, opts);
}
