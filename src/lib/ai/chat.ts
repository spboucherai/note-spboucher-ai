import { db, schema } from "@/db";
import { eq } from "drizzle-orm";
import { hybridSearch, type Hit } from "@/lib/search";
import { streamAI, callAI } from "./providers";
import { route, classifyTask } from "./router";
import { ASSISTANT_SYSTEM } from "./prompts";
import { recordUsage } from "./usage";
import { costUsd, getModel } from "./catalog";
import type { ChatMessage, TaskClass, AIEvent } from "./types";
import { approxTokens } from "@/lib/search/chunk";
import { toMarkdown } from "@/lib/editor/text";

export interface ChatRequest { conversationId?: string | null; message: string; pageId?: string | null; model?: string | null; task?: TaskClass | null; useWorkspace?: boolean; images?: { mime: string; dataBase64: string }[]; scopePageIds?: string[] }
export type ChatEvent = { type: "meta"; conversationId: string; model: string; provider: string; reason: string; sources: SourceRef[] } | { type: "text"; delta: string } | { type: "done"; messageId: string; usage: unknown; costUsd: number | null; latencyMs: number; ttftMs: number | null } | { type: "error"; message: string };
export interface SourceRef { n: number; chunkId: string; pageId: string | null; title: string; icon: string | null; heading: string | null; blockId: string | null; excerpt: string; score: number; sourceType: string }

/** LLM re-ranking of fused hits (cheap "judge" route, 2.5 s budget; falls back to fusion order). */
async function rerank(workspaceId: string, query: string, hits: Hit[], keep: number): Promise<Hit[]> {
  if (hits.length <= 4) return hits.slice(0, keep);
  try {
    const dec = await route({ task: "judge", schema: true });
    const list = hits.map((h, i) => `[${i}] ${h.title}${h.heading ? " › " + h.heading : ""}: ${h.content.slice(0, 300).replace(/\s+/g, " ")}`).join("\n");
    const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 2500);
    const res = await callAI({ model: dec.model.id, provider: dec.provider, effort: "low", maxTokens: 300, signal: ac.signal, system: "You rank retrieved passages for relevance to a question. Return JSON only.", messages: [{ role: "user", content: `Question: ${query}\n\nPassages:\n${list}\n\nReturn the indices of the passages that help answer the question, most relevant first (max ${keep}).` }], jsonSchema: { name: "rank", schema: { type: "object", properties: { indices: { type: "array", items: { type: "integer" } } }, required: ["indices"], additionalProperties: false } } });
    clearTimeout(t);
    await recordUsage({ workspaceId, provider: dec.provider, model: dec.model.id, task: "rerank", usage: res.usage, costUsd: res.costUsd, latencyMs: res.totalMs, ok: true });
    const idx: number[] = JSON.parse(res.text).indices.filter((i: number) => Number.isInteger(i) && i >= 0 && i < hits.length);
    const seen = new Set<number>(); const out: Hit[] = [];
    for (const i of idx) if (!seen.has(i)) { seen.add(i); out.push(hits[i]); }
    return (out.length ? out : hits).slice(0, keep);
  } catch { return hits.slice(0, keep); }
}
const toSources = (hits: Hit[]): SourceRef[] => hits.map((h, i) => ({ n: i + 1, chunkId: h.chunkId, pageId: h.pageId, title: h.title, icon: h.icon, heading: h.heading, blockId: h.blockId, excerpt: h.content.slice(0, 600), score: h.score, sourceType: h.sourceType }));

export async function* chat(workspaceId: string, r: ChatRequest, signal?: AbortSignal): AsyncGenerator<ChatEvent> {
  // conversation
  let convId = r.conversationId ?? null;
  if (!convId) { const [c] = await db.insert(schema.aiConversations).values({ workspaceId, title: r.message.slice(0, 80), pageId: r.pageId ?? null, model: r.model ?? null, routing: r.model ? "manual" : "auto" }).returning(); convId = c.id; }
  const history = await db.select().from(schema.aiMessages).where(eq(schema.aiMessages.conversationId, convId)).orderBy(schema.aiMessages.createdAt);
  await db.insert(schema.aiMessages).values({ conversationId: convId, role: "user", content: r.message, meta: { pageId: r.pageId ?? null } });

  // context: current page (full markdown, capped) + retrieved chunks
  let pageCtx = ""; let sources: SourceRef[] = [];
  if (r.pageId) { const [p] = await db.select().from(schema.pages).where(eq(schema.pages.id, r.pageId)); if (p) { const md = toMarkdown(p.content as any); pageCtx = `<workspace kind="current-page" title="${p.title.replace(/"/g, "'")}" id="${p.id}">\n${md.slice(0, 40_000)}\n</workspace>`; } }
  if (r.useWorkspace !== false) { try { let hits = await hybridSearch(workspaceId, r.message, { limit: 12, pageIds: r.scopePageIds }); hits = hits.filter((h) => h.pageId !== r.pageId || !pageCtx); hits = await rerank(workspaceId, r.message, hits, 8); sources = toSources(hits); } catch (e) { console.error("retrieval failed", e); } }
  const srcBlock = sources.length ? `<workspace kind="retrieved-sources">\n${sources.map((s) => `[${s.n}] "${s.title}"${s.heading ? ` › ${s.heading}` : ""} (page:${s.pageId ?? s.sourceType})\n${s.excerpt}`).join("\n\n")}\n</workspace>` : "";
  const contextTokens = approxTokens(pageCtx + srcBlock) + history.reduce((a, m) => a + approxTokens(m.content), 0);
  const task = r.task ?? classifyTask(r.message, { contextTokens });
  const dec = await route({ task, preferred: r.model ?? null, vision: Boolean(r.images?.length), estTokens: contextTokens + approxTokens(r.message) + 4000 });
  yield { type: "meta", conversationId: convId, model: dec.model.id, provider: dec.provider, reason: dec.reason, sources };

  const messages: ChatMessage[] = history.slice(-20).map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
  const userContent = [pageCtx, srcBlock, r.message].filter(Boolean).join("\n\n");
  messages.push({ role: "user", content: userContent, images: r.images });
  let text = ""; let done: Extract<AIEvent, { type: "done" }> | null = null; let errMsg: string | null = null;
  for await (const ev of streamAI({ model: dec.model.id, provider: dec.provider, system: ASSISTANT_SYSTEM, messages, effort: dec.effort, maxTokens: 8000, signal })) {
    if (ev.type === "text") { text += ev.delta; yield { type: "text", delta: ev.delta }; }
    else if (ev.type === "done") done = ev;
    else if (ev.type === "error") errMsg = ev.message;
  }
  // refusal → one retry on fallback
  if ((done?.refusal || (errMsg && !signal?.aborted)) && dec.alternatives[0]) {
    const alt = await getModel(dec.alternatives[0]);
    if (alt) {
      await recordUsage({ workspaceId, provider: dec.provider, model: dec.model.id, task, usage: done?.usage, ok: false, error: done?.refusal ?? errMsg, refId: convId });
      yield { type: "meta", conversationId: convId, model: alt.id, provider: alt.provider as any, reason: `retry on fallback after ${done?.refusal ?? "error"}`, sources };
      text = ""; done = null; errMsg = null;
      for await (const ev of streamAI({ model: alt.id, provider: alt.provider as any, system: ASSISTANT_SYSTEM, messages, effort: dec.effort, maxTokens: 8000, signal })) { if (ev.type === "text") { text += ev.delta; yield { type: "text", delta: ev.delta }; } else if (ev.type === "done") done = ev; else if (ev.type === "error") errMsg = ev.message; }
      dec.model = alt as any; dec.provider = alt.provider as any;
    }
  }
  if (errMsg && !text) { await recordUsage({ workspaceId, provider: dec.provider, model: dec.model.id, task, ok: false, error: errMsg, refId: convId }); yield { type: "error", message: errMsg }; return; }
  const cost = done ? costUsd(dec.model, done.usage) : null;
  // keep only cited sources
  const cited = new Set([...text.matchAll(/\[(\d{1,2})\]/g)].map((m) => Number(m[1])));
  const kept = sources.filter((s) => cited.has(s.n));
  const [msg] = await db.insert(schema.aiMessages).values({ conversationId: convId, role: "assistant", content: text, model: dec.model.id, provider: dec.provider, sources: kept.map((s) => ({ chunkId: s.chunkId, pageId: s.pageId ?? "", title: s.title, excerpt: s.excerpt.slice(0, 300), score: s.score, n: s.n } as any)), usage: done?.usage ?? {}, costUsd: cost, latencyMs: done ? Math.round(done.totalMs) : null, ttftMs: done?.ttftMs == null ? null : Math.round(done.ttftMs), meta: { task, reason: dec.reason, stop: done?.stop } }).returning();
  await db.update(schema.aiConversations).set({ updatedAt: new Date(), model: dec.model.id }).where(eq(schema.aiConversations.id, convId));
  await recordUsage({ workspaceId, provider: dec.provider, model: dec.model.id, task, usage: done?.usage, costUsd: cost, latencyMs: done?.totalMs, ttftMs: done?.ttftMs, ok: true, refId: convId });
  yield { type: "done", messageId: msg.id, usage: done?.usage, costUsd: cost, latencyMs: Math.round(done?.totalMs ?? 0), ttftMs: done?.ttftMs == null ? null : Math.round(done.ttftMs) };
}

export function sse(gen: AsyncGenerator<unknown>, signal?: AbortSignal) {
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(ctrl) {
      try { for await (const ev of gen) { if (signal?.aborted) break; ctrl.enqueue(enc.encode(`data: ${JSON.stringify(ev)}\n\n`)); } }
      catch (e: any) { ctrl.enqueue(enc.encode(`data: ${JSON.stringify({ type: "error", message: String(e?.message ?? e) })}\n\n`)); }
      finally { ctrl.enqueue(enc.encode("data: [DONE]\n\n")); ctrl.close(); }
    },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no" } });
}
