/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/lib/ai/links.ts
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

/**
 * `links` action (SPEC §4.10): suggest internal links for a text. The server retrieves candidate pages (hybrid search over the
 * workspace), the model only picks among them through a strict JSON schema, and every pick is validated: an index outside the candidate
 * list is discarded, an `anchorText` that is not literally in the text is blanked. The result is DATA for the owner to confirm in the
 * editor — this module never writes a link, an edge or a page.
 */
import { and, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { similarPages } from "./candidates";
import { extractPageRefs, type PMNode } from "@/lib/editor/text";
import { callAI } from "./providers";
import { LINKS_SYSTEM } from "./prompts";
import type { RouteDecision } from "./router";

export interface LinkCandidate { pageId: string; title: string; icon: string | null; blockId: string | null; excerpt: string; score: number }
export interface LinkSuggestion extends LinkCandidate { anchorText: string | null; reason: string }
export const LINKS_SCHEMA = { type: "object", properties: { links: { type: "array", items: { type: "object", properties: { index: { type: "integer" }, anchorText: { type: "string" }, reason: { type: "string" } }, required: ["index", "anchorText", "reason"], additionalProperties: false } } }, required: ["links"], additionalProperties: false } as const;
export const LINK_CANDIDATES = 8;

/** Candidate pages for a text: best passage per page, never the page itself nor a page the text already links to. */
export async function linkCandidates(workspaceId: string, text: string, pageId?: string | null): Promise<LinkCandidate[]> {
  const exclude = new Set<string>(); if (pageId) exclude.add(pageId);
  if (pageId) { const [p] = await db.select({ content: schema.pages.content }).from(schema.pages).where(and(eq(schema.pages.id, pageId), eq(schema.pages.workspaceId, workspaceId), isNull(schema.pages.deletedAt))); for (const id of extractPageRefs(p?.content as PMNode | undefined)) exclude.add(id); }
  const out = new Map<string, LinkCandidate>();
  for (const h of await similarPages(workspaceId, text, { exclude, limit: LINK_CANDIDATES })) out.set(h.pageId!, { pageId: h.pageId!, title: h.title, icon: h.icon, blockId: h.blockId, excerpt: h.content.replace(/\s+/g, " ").slice(0, 300), score: h.score });
  return [...out.values()];
}
/** Validate the model's JSON against the candidate list and the text. Pure (tested without any provider). */
export function validateLinkPicks(raw: unknown, candidates: LinkCandidate[], text: string): LinkSuggestion[] {
  const list = (raw as { links?: unknown } | null)?.links; if (!Array.isArray(list)) return [];
  const seen = new Set<number>(); const out: LinkSuggestion[] = [];
  for (const x of list) {
    const i = (x as { index?: unknown })?.index; if (typeof i !== "number" || !Number.isInteger(i) || i < 1 || i > candidates.length || seen.has(i)) continue;
    seen.add(i);
    const a = typeof (x as { anchorText?: unknown }).anchorText === "string" ? (x as { anchorText: string }).anchorText.trim() : "";
    const reason = typeof (x as { reason?: unknown }).reason === "string" ? (x as { reason: string }).reason.trim().slice(0, 300) : "";
    out.push({ ...candidates[i - 1], anchorText: a && text.includes(a) ? a.slice(0, 200) : null, reason });
    if (out.length >= 6) break;
  }
  return out;
}
export async function pickLinks(dec: RouteDecision, text: string, candidates: LinkCandidate[], signal?: AbortSignal) {
  const list = candidates.map((c, i) => `[${i + 1}] "${c.title}": ${c.excerpt}`).join("\n");
  const res = await callAI({ model: dec.model.id, provider: dec.provider, effort: "low", maxTokens: 900, signal, timeoutMs: 120_000, system: LINKS_SYSTEM, jsonSchema: { name: "links", schema: LINKS_SCHEMA as unknown as Record<string, unknown> },
    messages: [{ role: "user", content: `<workspace kind="text">\n${text.slice(0, 12_000)}\n</workspace>\n\n<workspace kind="candidate-pages">\n${list}\n</workspace>` }] });
  let parsed: unknown = null; try { parsed = JSON.parse(res.text.replace(/^```(?:json)?\s*|\s*```$/g, "")); } catch { /* invalid JSON → no suggestion, reported by the caller */ }
  return { res, parsed, links: validateLinkPicks(parsed, candidates, text) };
}
