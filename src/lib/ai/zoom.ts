/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/lib/ai/zoom.ts
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
 * Semantic zoom, level 1 (SPEC §4.9): an AI synopsis of a page, cached by content hash.
 *  - the hash covers the title and the Markdown of the page: any edit invalidates the synopsis, a rename too;
 *  - a cached synopsis is returned without calling any provider; `generate:false` never calls one (it answers `status:"missing"`);
 *  - an empty page gets no synopsis and costs nothing (`status:"empty"`);
 *  - the result is always marked `ai:true` with the model and the generation date — clients must show it as AI-generated (SPEC §0.10).
 * Levels 2 (outline, no AI) and 3 (full) belong to the foundation workstream (`src/lib/pages/zoom.ts`), which calls `aiSynopsis` for level 1.
 */
import { createHash } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { HttpError } from "@/lib/errors";
import { toMarkdown, type PMNode } from "@/lib/editor/text";
import { callAI } from "./providers";
import { route } from "./router";
import { recordUsage } from "./usage";
import { INJECTION_GUARD } from "./prompts";

export const SYNOPSIS_CHARS = 40_000;
const SYSTEM = `You write the synopsis shown when a note is "zoomed out" in a private knowledge workspace. In at most 90 words: what the note is about, its main claims or results, and what remains open — as two or three plain sentences, no heading, no list, no preamble, no quotation of the title. Use only what the note says; if it is too short to summarise, restate it faithfully in one sentence. Write in the language of the note (French or English).
${INJECTION_GUARD}`;
export interface Synopsis { pageId: string; level: 1; ai: boolean; status: "ready" | "missing" | "empty"; synopsis: string | null; model: string | null; provider: string | null; generatedAt: string | null; cached: boolean; contentHash: string; costUsd: number | null }
export const synopsisHash = (title: string, markdown: string) => createHash("sha256").update(`${title}\n${markdown}`).digest("hex").slice(0, 32);

export async function aiSynopsis(workspaceId: string, pageId: string, opts: { generate?: boolean; force?: boolean; model?: string | null; signal?: AbortSignal } = {}): Promise<Synopsis> {
  const [p] = await db.select({ id: schema.pages.id, title: schema.pages.title, content: schema.pages.content }).from(schema.pages).where(and(eq(schema.pages.id, pageId), eq(schema.pages.workspaceId, workspaceId), isNull(schema.pages.deletedAt)));
  if (!p) throw new HttpError(404, "Page not found");
  const markdown = toMarkdown(p.content as PMNode).trim(); const contentHash = synopsisHash(p.title, markdown);
  const base = { pageId, level: 1 as const, contentHash };
  if (!markdown) return { ...base, ai: false, status: "empty", synopsis: null, model: null, provider: null, generatedAt: null, cached: false, costUsd: null };
  const S = schema.aiSynopses;
  const [hit] = await db.select().from(S).where(and(eq(S.pageId, pageId), eq(S.level, 1)));
  if (hit && hit.contentHash === contentHash && !opts.force) return { ...base, ai: true, status: "ready", synopsis: hit.synopsis, model: hit.model, provider: hit.provider, generatedAt: hit.generatedAt.toISOString(), cached: true, costUsd: hit.costUsd };
  if (opts.generate === false) return { ...base, ai: false, status: "missing", synopsis: null, model: null, provider: null, generatedAt: null, cached: false, costUsd: null };
  const user = `<workspace kind="current-page" title="${p.title.replace(/"/g, "'")}">\n${markdown.slice(0, SYNOPSIS_CHARS)}\n</workspace>`;
  let dec; try { dec = await route({ task: "quick", preferred: opts.model ?? null, estTokens: Math.ceil(user.length / 3.6) + 600 }); } catch (e) { throw new HttpError(503, String((e as Error).message).slice(0, 200), "no_model"); }
  try {
    const res = await callAI({ model: dec.model.id, provider: dec.provider, system: SYSTEM, messages: [{ role: "user", content: user }], effort: "low", maxTokens: 400, timeoutMs: 90_000, signal: opts.signal });
    const text = res.text.trim();
    await recordUsage({ workspaceId, provider: dec.provider, model: dec.model.id, task: "zoom", usage: res.usage, costUsd: res.costUsd, latencyMs: res.totalMs, ttftMs: res.ttftMs, ok: !res.refusal && Boolean(text), error: res.refusal ?? (text ? null : "empty answer"), refId: pageId });
    if (res.refusal || !text) throw new HttpError(502, res.refusal ? "The model declined to summarise this page." : "The model returned an empty synopsis.", res.refusal ? "refused" : "provider_error");
    const now = new Date();
    await db.insert(S).values({ pageId, level: 1, workspaceId, contentHash, synopsis: text, model: dec.model.id, provider: dec.provider, costUsd: res.costUsd, generatedAt: now })
      .onConflictDoUpdate({ target: [S.pageId, S.level], set: { contentHash, synopsis: text, model: dec.model.id, provider: dec.provider, costUsd: res.costUsd, generatedAt: now } });
    return { ...base, ai: true, status: "ready", synopsis: text, model: dec.model.id, provider: dec.provider, generatedAt: now.toISOString(), cached: false, costUsd: res.costUsd };
  } catch (e) {
    if (e instanceof HttpError) throw e;
    const err = e as { message?: string; status?: number };
    await recordUsage({ workspaceId, provider: dec.provider, model: dec.model.id, task: "zoom", ok: false, error: String(err?.message ?? e), refId: pageId });
    throw new HttpError(502, `The AI provider failed: ${String(err?.message ?? e).replace(/\s+/g, " ").slice(0, 200)}`, "provider_error");
  }
}
