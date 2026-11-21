/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/lib/ai/inbox.ts
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
 * Smart Inbox (SPEC §4.12). For one capture waiting in the inbox the model proposes a title, tags, where to file it, related pages and
 * a short summary. Rules:
 *  - SUGGESTIONS ONLY: `suggest()` writes nothing but its own cache row. Nothing is renamed, tagged, moved, linked or deleted until the
 *    owner calls `applySuggestions()` with the subset (and the values) they chose;
 *  - strict JSON schema, then validation against the workspace: a destination or a related page must be one of the candidate pages the
 *    server listed (the model answers with an index, never an id), tags are normalised like every other tag and flagged existing / new,
 *    anything that does not validate is dropped — and re-checked on every read of the cache (a page may have been deleted meanwhile);
 *  - cached by content hash (title + text + tags of the capture): the same capture is analysed once;
 *  - applying goes through the inbox action journal (`inbox_actions`, action `suggestions`): `POST /api/inbox/undo` reverses it —
 *    title, added tags, inserted summary block, created relations and the filing itself.
 */
import { createHash } from "node:crypto";
import { and, desc, eq, inArray, isNull, ne } from "drizzle-orm";
import { db, schema } from "@/db";
import { HttpError } from "@/lib/errors";
import { getPage, updatePage } from "@/lib/pages/service";
import { setPageTags, pageTags, undoTriage } from "@/lib/inbox/service";
import { similarPages } from "./candidates";
import type { PMNode } from "@/lib/editor/text";
import { callAI } from "./providers";
import { route } from "./router";
import { recordUsage } from "./usage";
import { INJECTION_GUARD } from "./prompts";

export const SECTIONS = ["notes", "documents", "projects", "research"] as const;
export type Section = (typeof SECTIONS)[number];
export interface Candidate { id: string; title: string; section: string; icon: string | null }
export interface RawSuggestion { title: string; tags: string[]; section: string; parentIndex: number; relations: { index: number; reason: string }[]; summary: string }
export interface Suggestions {
  title: { value: string; current: string } | null;
  tags: { name: string; existing: boolean }[];
  destination: { section: Section; parentId: string | null; parentTitle: string | null } | null;
  relations: { pageId: string; title: string; icon: string | null; reason: string }[];
  summary: string | null;
}
export interface SuggestionResult { pageId: string; status: "ready" | "empty"; ai: boolean; model: string | null; provider: string | null; generatedAt: string | null; cached: boolean; contentHash: string; costUsd: number | null; suggestions: Suggestions }
export const SUGGESTION_SCHEMA = { type: "object", properties: {
  title: { type: "string" }, tags: { type: "array", items: { type: "string" } }, section: { type: "string", enum: [...SECTIONS] }, parentIndex: { type: "integer" },
  relations: { type: "array", items: { type: "object", properties: { index: { type: "integer" }, reason: { type: "string" } }, required: ["index", "reason"], additionalProperties: false } }, summary: { type: "string" },
}, required: ["title", "tags", "section", "parentIndex", "relations", "summary"], additionalProperties: false } as const;
const SYSTEM = `You help file one captured note in a private knowledge workspace. You receive the capture, the tags that already exist and a numbered list of candidate pages of the workspace. Return JSON:
- "title": a precise title of at most 80 characters, in the language of the capture (keep the current title if it is already good);
- "tags": 0 to 4 tags, lowercase; prefer existing tags, propose a new one only when none fits;
- "section": where it belongs — notes, documents, projects or research;
- "parentIndex": the number of the candidate page it should be filed under, or 0 when none clearly fits;
- "relations": up to 4 candidate pages genuinely related to the capture, each with "index" and a one-sentence "reason"; empty when none;
- "summary": one or two sentences summarising the capture, in its language, using only what it says.
Never invent a page or a fact. Candidate pages may be irrelevant: choosing none is a correct answer.
${INJECTION_GUARD}`;
const EMPTY: Suggestions = { title: null, tags: [], destination: null, relations: [], summary: null };
export const normTag = (n: string) => n.trim().replace(/^#/, "").toLowerCase().replace(/\s+/g, " ").slice(0, 40);
const hashOf = (title: string, text: string, tags: string[]) => createHash("sha256").update(`${title}\n${text}\n${[...tags].sort().join(",")}`).digest("hex").slice(0, 32);

/** Turn the model's JSON into validated suggestions. Pure: everything it needs is passed in (tested without any provider). */
export function validateSuggestion(raw: unknown, ctx: { pageId: string; currentTitle: string; currentTags: string[]; existingTags: string[]; candidates: Candidate[] }): Suggestions {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<RawSuggestion>;
  const title = typeof r.title === "string" ? r.title.replace(/\s+/g, " ").trim().slice(0, 120) : "";
  const have = new Set(ctx.currentTags.map(normTag)); const known = new Set(ctx.existingTags.map(normTag)); const seenTags = new Set<string>(); const tags: Suggestions["tags"] = [];
  for (const t of Array.isArray(r.tags) ? r.tags : []) { if (typeof t !== "string") continue; const n = normTag(t); if (!n || have.has(n) || seenTags.has(n) || !/[\p{L}\p{N}]/u.test(n)) continue; seenTags.add(n); tags.push({ name: n, existing: known.has(n) }); if (tags.length >= 5) break; }
  const cand = (i: unknown): Candidate | null => (typeof i === "number" && Number.isInteger(i) && i >= 1 && i <= ctx.candidates.length && ctx.candidates[i - 1].id !== ctx.pageId ? ctx.candidates[i - 1] : null);
  const parent = cand(r.parentIndex); const section = (SECTIONS as readonly string[]).includes(r.section as string) ? (r.section as Section) : null;
  const destination = parent ? { section: ((SECTIONS as readonly string[]).includes(parent.section) ? parent.section : section ?? "notes") as Section, parentId: parent.id, parentTitle: parent.title } : section ? { section, parentId: null, parentTitle: null } : null;
  const seenRel = new Set<string>(); const relations: Suggestions["relations"] = [];
  for (const x of Array.isArray(r.relations) ? r.relations : []) { const c = cand((x as { index?: unknown })?.index); if (!c || seenRel.has(c.id)) continue; seenRel.add(c.id); relations.push({ pageId: c.id, title: c.title, icon: c.icon, reason: typeof (x as { reason?: unknown }).reason === "string" ? (x as { reason: string }).reason.trim().slice(0, 300) : "" }); if (relations.length >= 5) break; }
  const summary = typeof r.summary === "string" ? r.summary.replace(/\s+/g, " ").trim().slice(0, 600) : "";
  return { title: title && title !== ctx.currentTitle.trim() ? { value: title, current: ctx.currentTitle } : null, tags, destination, relations, summary: summary || null };
}
/** Drop from stored suggestions what no longer exists (deleted page, tag now on the capture). */
async function revalidate(workspaceId: string, pageId: string, s: Suggestions, currentTitle: string, currentTags: string[]): Promise<Suggestions> {
  const ids = [...new Set([s.destination?.parentId, ...s.relations.map((r) => r.pageId)].filter((x): x is string => Boolean(x)))];
  const live = new Set(ids.length ? (await db.select({ id: schema.pages.id }).from(schema.pages).where(and(eq(schema.pages.workspaceId, workspaceId), inArray(schema.pages.id, ids), isNull(schema.pages.deletedAt)))).map((r) => r.id) : []);
  const existing = new Set((await db.select({ name: schema.tags.name }).from(schema.tags).where(eq(schema.tags.workspaceId, workspaceId))).map((t) => t.name)); const have = new Set(currentTags);
  return {
    title: s.title && s.title.value !== currentTitle.trim() ? { value: s.title.value, current: currentTitle } : null,
    tags: s.tags.filter((t) => !have.has(t.name)).map((t) => ({ name: t.name, existing: existing.has(t.name) })),
    destination: s.destination ? (s.destination.parentId && !live.has(s.destination.parentId) ? { section: s.destination.section, parentId: null, parentTitle: null } : s.destination) : null,
    relations: s.relations.filter((r) => live.has(r.pageId) && r.pageId !== pageId), summary: s.summary,
  };
}
/** Candidate pages the capture could be filed under or related to: pages similar to it, then recent top-level pages. */
export async function candidatePages(workspaceId: string, pageId: string, query: string): Promise<Candidate[]> {
  const out = new Map<string, Candidate>();
  for (const h of await similarPages(workspaceId, query, { exclude: [pageId], limit: 10 })) out.set(h.pageId!, { id: h.pageId!, title: h.title, section: h.section ?? "notes", icon: h.icon });
  const P = schema.pages;
  const tops = await db.select({ id: P.id, title: P.title, section: P.section, icon: P.icon }).from(P).where(and(eq(P.workspaceId, workspaceId), isNull(P.deletedAt), isNull(P.inboxAt), isNull(P.parentId), isNull(P.databaseId), eq(P.archived, false), ne(P.id, pageId), inArray(P.section, [...SECTIONS]))).orderBy(desc(P.updatedAt)).limit(14);
  for (const t of tops) { if (out.size >= 20) break; if (!out.has(t.id)) out.set(t.id, t); }
  // similar pages may be inbox items or archived: only live, filed pages can be a destination or a relation
  const ids = [...out.keys()]; if (!ids.length) return [];
  const ok = new Set((await db.select({ id: P.id }).from(P).where(and(eq(P.workspaceId, workspaceId), inArray(P.id, ids), isNull(P.deletedAt), isNull(P.inboxAt), eq(P.archived, false)))).map((r) => r.id));
  return [...out.values()].filter((c) => ok.has(c.id));
}

export async function suggest(workspaceId: string, pageId: string, opts: { refresh?: boolean; generate?: boolean; model?: string | null; signal?: AbortSignal } = {}): Promise<SuggestionResult> {
  const page = await getPage(workspaceId, pageId);
  if (!page.inboxAt || page.archived) throw new HttpError(409, "This item is no longer in the inbox", "not_in_inbox");
  const tags = await pageTags(pageId); const text = (page.plainText ?? "").trim(); const contentHash = hashOf(page.title, text, tags);
  const base = { pageId, contentHash };
  if (!text && !page.title.trim()) return { ...base, status: "empty", ai: false, model: null, provider: null, generatedAt: null, cached: false, costUsd: null, suggestions: EMPTY };
  const S = schema.inboxSuggestions;
  const [hit] = await db.select().from(S).where(eq(S.pageId, pageId));
  if (hit && hit.contentHash === contentHash && !opts.refresh) return { ...base, status: "ready", ai: true, model: hit.model, provider: hit.provider, generatedAt: hit.generatedAt.toISOString(), cached: true, costUsd: hit.costUsd, suggestions: await revalidate(workspaceId, pageId, hit.suggestions as unknown as Suggestions, page.title, tags) };
  if (opts.generate === false) throw new HttpError(404, "No suggestion has been generated for this capture yet", "not_generated");
  const candidates = await candidatePages(workspaceId, pageId, `${page.title}\n${text}`);
  const existingTags = (await db.select({ name: schema.tags.name }).from(schema.tags).where(eq(schema.tags.workspaceId, workspaceId)).limit(300)).map((t) => t.name);
  const user = `<workspace kind="capture" kind-of-capture="${page.captureKind ?? "note"}">\nCurrent title: ${page.title}\nCurrent tags: ${tags.join(", ") || "(none)"}\n\n${text.slice(0, 8000) || "(no text)"}\n</workspace>\n\n<workspace kind="existing-tags">\n${existingTags.join(", ") || "(none yet)"}\n</workspace>\n\n<workspace kind="candidate-pages">\n${candidates.map((c, i) => `[${i + 1}] (${c.section}) ${c.title}`).join("\n") || "(none)"}\n</workspace>`;
  let dec; try { dec = await route({ task: "extract", schema: true, preferred: opts.model ?? null, estTokens: Math.ceil(user.length / 3.6) + 900 }); } catch (e) { throw new HttpError(503, String((e as Error).message).slice(0, 200), "no_model"); }
  let res;
  try { res = await callAI({ model: dec.model.id, provider: dec.provider, system: SYSTEM, messages: [{ role: "user", content: user }], effort: "low", maxTokens: 900, timeoutMs: 90_000, signal: opts.signal, jsonSchema: { name: "inbox_suggestion", schema: SUGGESTION_SCHEMA as unknown as Record<string, unknown> } }); }
  catch (e) {
    const err = e as { message?: string }; await recordUsage({ workspaceId, provider: dec.provider, model: dec.model.id, task: "inbox_suggest", ok: false, error: String(err?.message ?? e), refId: pageId });
    throw new HttpError(502, `The AI provider failed: ${String(err?.message ?? e).replace(/\s+/g, " ").slice(0, 200)}`, "provider_error");
  }
  let raw: unknown = null; try { raw = JSON.parse(res.text.replace(/^```(?:json)?\s*|\s*```$/g, "")); } catch { /* reported below */ }
  const bad = res.refusal ?? (raw === null || typeof raw !== "object" ? "invalid JSON" : null);
  await recordUsage({ workspaceId, provider: dec.provider, model: dec.model.id, task: "inbox_suggest", usage: res.usage, costUsd: res.costUsd, latencyMs: res.totalMs, ttftMs: res.ttftMs, ok: !bad, error: bad, refId: pageId });
  if (bad) throw new HttpError(502, res.refusal ? "The model declined this request." : "The model did not return valid JSON; nothing is suggested.", res.refusal ? "refused" : "bad_output");
  const suggestions = validateSuggestion(raw, { pageId, currentTitle: page.title, currentTags: tags, existingTags, candidates });
  const now = new Date();
  await db.insert(S).values({ pageId, workspaceId, contentHash, suggestions: suggestions as unknown as Record<string, unknown>, model: dec.model.id, provider: dec.provider, costUsd: res.costUsd, generatedAt: now })
    .onConflictDoUpdate({ target: S.pageId, set: { contentHash, suggestions: suggestions as unknown as Record<string, unknown>, model: dec.model.id, provider: dec.provider, costUsd: res.costUsd, generatedAt: now } });
  return { ...base, status: "ready", ai: true, model: dec.model.id, provider: dec.provider, generatedAt: now.toISOString(), cached: false, costUsd: res.costUsd, suggestions };
}

// ---------- apply (journaled) and undo
export interface ApplyChoice { title?: string; tags?: string[]; destination?: { section?: Section; parentId?: string | null }; relations?: { pageId: string; reason?: string }[]; summary?: string }
const rid = () => { const a = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_-"; let o = ""; const b = new Uint8Array(10); globalThis.crypto.getRandomValues(b); for (const x of b) o += a[x & 63]; return o; };
const withoutBlock = (doc: PMNode, id: string): PMNode => ({ ...doc, content: (doc.content ?? []).filter((n) => !(n.type === "aiBlock" && n.attrs?.id === id)) });

/**
 * Apply the subset of suggestions the owner chose (values are the owner's: they may have edited them). One journal row; returns its id.
 * The capture leaves the inbox only when a destination is part of the choice — otherwise it stays there, improved.
 */
export async function applySuggestions(workspaceId: string, pageId: string, c: ApplyChoice) {
  const page = await getPage(workspaceId, pageId);
  if (!page.inboxAt || page.archived) throw new HttpError(409, "This item is no longer in the inbox", "not_in_inbox");
  const title = c.title?.replace(/\s+/g, " ").trim().slice(0, 300); const summary = c.summary?.replace(/\s+/g, " ").trim().slice(0, 1000);
  const tags = [...new Set((c.tags ?? []).map(normTag).filter(Boolean))].slice(0, 10);
  const relIds = [...new Set((c.relations ?? []).map((r) => r.pageId))].filter((id) => id !== pageId);
  if (!title && !summary && !tags.length && !relIds.length && !c.destination) throw new HttpError(400, "Nothing chosen to apply", "nothing_to_apply");
  // validate everything BEFORE the first write
  if (c.destination?.section && !(SECTIONS as readonly string[]).includes(c.destination.section)) throw new HttpError(400, "Unknown section", "bad_section");
  const parent = c.destination?.parentId ? await getPage(workspaceId, c.destination.parentId).catch(() => null) : null;
  if (c.destination?.parentId && (!parent || parent.id === pageId || parent.inboxAt)) throw new HttpError(400, "Unknown destination page", "bad_destination");
  const targets = relIds.length ? await db.select({ id: schema.pages.id }).from(schema.pages).where(and(eq(schema.pages.workspaceId, workspaceId), inArray(schema.pages.id, relIds), isNull(schema.pages.deletedAt))) : [];
  if (targets.length !== relIds.length) throw new HttpError(400, "Unknown related page", "bad_relation");
  const [cache] = await db.select({ model: schema.inboxSuggestions.model }).from(schema.inboxSuggestions).where(eq(schema.inboxSuggestions.pageId, pageId));
  const tagsBefore = await pageTags(pageId);
  const before = { inboxAt: page.inboxAt.toISOString(), archived: page.archived, section: page.section, parentId: page.parentId, title: page.title, tags: tagsBefore };
  const created: Record<string, unknown> = {}; const applied: string[] = [];
  if ((title && title !== page.title) || summary) {
    const patch: { title?: string; content?: PMNode } = {};
    if (title && title !== page.title) { patch.title = title; applied.push("title"); }
    if (summary) {
      const blockId = rid(); const doc = page.content as unknown as PMNode;
      // AI content stays visibly AI (SPEC §0.10): the summary is an aiBlock, removable by undo through its block id
      patch.content = { ...doc, type: "doc", content: [{ type: "aiBlock", attrs: { id: blockId, model: cache?.model ?? "ai", prompt: "Résumé de la capture", at: new Date().toISOString(), action: "summary" }, content: [{ type: "paragraph", content: [{ type: "text", text: summary }] }] }, ...(doc.content ?? [])] };
      created.summaryBlockId = blockId; applied.push("summary");
    }
    await updatePage(workspaceId, pageId, patch, { versionReason: "before AI suggestion", baseVersion: page.version });
  }
  if (tags.length) { const have = new Set(tagsBefore); const add = tags.filter((t) => !have.has(t)); if (add.length) { await setPageTags(workspaceId, pageId, [...tagsBefore, ...add]); created.tagsAdded = add; applied.push("tags"); } }
  if (relIds.length) {
    const reasons = new Map((c.relations ?? []).map((r) => [r.pageId, (r.reason ?? "").slice(0, 300)]));
    const rows = await db.insert(schema.knowledgeEdges).values(relIds.map((toId) => ({ workspaceId, fromId: pageId, toId, kind: "ai_suggested", status: "accepted", rationale: reasons.get(toId) || null, model: cache?.model ?? null, decidedAt: new Date() }))).onConflictDoNothing().returning({ id: schema.knowledgeEdges.id });
    created.edgeIds = rows.map((r) => r.id); if (rows.length) applied.push("relations");
  }
  let filed = false;
  if (c.destination) {
    const section = (parent && (SECTIONS as readonly string[]).includes(parent.section) ? parent.section : c.destination.section) ?? "notes";
    await db.update(schema.pages).set({ section, parentId: parent?.id ?? null, inboxAt: null, updatedAt: new Date() }).where(and(eq(schema.pages.id, pageId), eq(schema.pages.workspaceId, workspaceId)));
    filed = true; applied.push("destination"); created.filed = { section, parentId: parent?.id ?? null };
  }
  const [j] = await db.insert(schema.inboxActions).values({ workspaceId, pageId, action: "suggestions", before, created }).returning({ id: schema.inboxActions.id });
  const summaryText = `${applied.length} suggestion${applied.length > 1 ? "s" : ""} applied${filed ? ` · filed in ${(created.filed as { section: string }).section}` : ""}`;
  return { actionId: j.id, summary: summaryText, applied, filed, created };
}
/** Reverse an applied set of suggestions. Only what the action itself changed is reverted: later edits by the owner are left alone. */
async function undoSuggestions(workspaceId: string, j: typeof schema.inboxActions.$inferSelect) {
  if (j.undoneAt) return { ok: true, already: true };
  const b = j.before as { inboxAt: string; archived: boolean; section: string; parentId: string | null; title: string; tags: string[] };
  const c = j.created as { summaryBlockId?: string; tagsAdded?: string[]; edgeIds?: string[]; filed?: unknown };
  const page = await getPage(workspaceId, j.pageId, { includeDeleted: true });
  const patch: { title?: string; content?: PMNode } = {};
  if (page.title !== b.title) patch.title = b.title;
  if (c.summaryBlockId) { const next = withoutBlock(page.content as unknown as PMNode, c.summaryBlockId); if ((next.content ?? []).length !== ((page.content as unknown as PMNode).content ?? []).length) patch.content = next; }
  if (patch.title !== undefined || patch.content !== undefined) await updatePage(workspaceId, j.pageId, patch, { versionReason: "undo AI suggestion" });
  if (c.tagsAdded?.length) { const drop = new Set(c.tagsAdded); await setPageTags(workspaceId, j.pageId, (await pageTags(j.pageId)).filter((t) => !drop.has(t))); }
  if (c.edgeIds?.length) await db.delete(schema.knowledgeEdges).where(and(eq(schema.knowledgeEdges.workspaceId, workspaceId), inArray(schema.knowledgeEdges.id, c.edgeIds)));
  await db.update(schema.pages).set({ inboxAt: new Date(b.inboxAt), archived: b.archived, section: b.section, parentId: b.parentId }).where(and(eq(schema.pages.id, j.pageId), eq(schema.pages.workspaceId, workspaceId)));
  await db.update(schema.inboxActions).set({ undoneAt: new Date() }).where(eq(schema.inboxActions.id, j.id));
  return { ok: true, already: false };
}
/** Undo any journaled inbox action: applied suggestions here, every historical triage action through the existing `undoTriage`. */
export async function undoInboxAction(workspaceId: string, actionId: string) {
  const [j] = await db.select().from(schema.inboxActions).where(and(eq(schema.inboxActions.id, actionId), eq(schema.inboxActions.workspaceId, workspaceId)));
  if (!j) throw new HttpError(404, "Action not found");
  return j.action === "suggestions" ? undoSuggestions(workspaceId, j) : undoTriage(workspaceId, actionId);
}
