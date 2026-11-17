/**
 * Research AI features. Every feature is an async generator of ResearchAIEvent (SSE-ready) built on route() → streamAI/callAI.
 * Workspace content is always wrapped in <workspace> tags and the INJECTION_GUARD is appended to every system prompt.
 * Outputs are AI-generated suggestions: nothing here writes into pages, references or tasks.
 */
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { route } from "@/lib/ai/router";
import { streamAI, callAI } from "@/lib/ai/providers";
import { INJECTION_GUARD } from "@/lib/ai/prompts";
import { recordUsage } from "@/lib/ai/usage";
import { costUsd } from "@/lib/ai/catalog";
import { hybridSearch } from "@/lib/search";
import { approxTokens } from "@/lib/search/chunk";
import { toMarkdown, type PMNode } from "@/lib/editor/text";
import { HttpError } from "@/lib/errors";
import type { TaskClass, AIUsage } from "@/lib/ai/types";
import { listReferences, type ReferenceRow } from "./references";
import { shortCite, lastName } from "./bibtex";

export const RESEARCH_FEATURES = ["synthesis", "compare", "question", "equation", "draft", "refcheck", "plan"] as const;
export type ResearchFeature = (typeof RESEARCH_FEATURES)[number];
export interface ResearchAIRequest { feature: ResearchFeature; pageId: string; referenceIds?: string[]; attachmentIds?: string[]; text?: string; instruction?: string; question?: string; latex?: string; language?: "fr" | "en" | null; model?: string | null }
export type ResearchAIEvent =
  | { type: "meta"; feature: ResearchFeature; model: string; provider: string; reason: string; context: { references: number; attachments: number; sources: number; pageChars: number } }
  | { type: "text"; delta: string }
  | { type: "result"; data: unknown }
  | { type: "done"; usage: AIUsage | null; costUsd: number | null; latencyMs: number }
  | { type: "error"; message: string };

const BASE = `You are the research assistant inside Note SPBoucher AI, the private workspace of Simon-Pierre Boucher (professor of real-estate finance and AI, UQO). You help write academic working papers in finance, economics and AI. Be precise, concise, technical; prefer Markdown with LaTeX ($…$ inline, $$…$$ display) for mathematics and tables for comparisons. Never invent references, data, results or quotations: when something is not in the provided material, say so explicitly. Everything you produce is a suggestion that the author will review.`;
const lang = (l?: string | null) => (l === "fr" ? "Answer in French (Québec academic usage)." : l === "en" ? "Answer in English." : "Answer in the language of the page/material (French or English).");
const sys = (extra: string, l?: string | null) => `${BASE}\n${extra}\n${lang(l)}\n${INJECTION_GUARD}`;
const ws = (kind: string, body: string, attrs = "") => `<workspace kind="${kind}"${attrs ? " " + attrs : ""}>\n${body}\n</workspace>`;
const esc = (s: string) => s.replace(/"/g, "'");

// ---------- context builders
async function pageOf(wsId: string, pageId: string) {
  const [p] = await db.select().from(schema.pages).where(and(eq(schema.pages.id, pageId), eq(schema.pages.workspaceId, wsId), isNull(schema.pages.deletedAt)));
  if (!p) throw new HttpError(404, "Page not found"); return p;
}
export function refLine(r: ReferenceRow, withAbstract = true) {
  const f = (r.fields ?? {}) as Record<string, string>;
  const head = `[${r.citeKey}] ${(r.authors ?? []).join(", ") || "Unknown authors"} (${r.year ?? "n.d."}). ${r.title}.${r.journal ? ` ${r.journal}.` : ""}${f.volume ? ` ${f.volume}${f.number ? `(${f.number})` : ""}${f.pages ? `, ${f.pages}` : ""}.` : ""}${r.doi ? ` doi:${r.doi}` : ""} — verification: ${r.verified}`;
  return withAbstract && f.abstract ? `${head}\n  Abstract: ${f.abstract.slice(0, 1500)}` : head;
}
async function attachmentTexts(wsId: string, ids: string[], capEach: number) {
  if (!ids.length) return [] as { id: string; filename: string; text: string; pages: number | null }[];
  const rows = await db.select({ id: schema.attachments.id, filename: schema.attachments.filename, text: schema.attachments.extractedText, pages: schema.attachments.pageCount }).from(schema.attachments).where(and(eq(schema.attachments.workspaceId, wsId), isNull(schema.attachments.deletedAt), inArray(schema.attachments.id, ids)));
  return rows.map((a) => ({ id: a.id, filename: a.filename, pages: a.pages, text: (a.text ?? "").replace(/\s+\n/g, "\n").slice(0, capEach) }));
}
async function pageAttachmentIds(pageId: string) {
  return (await db.select({ id: schema.attachments.id }).from(schema.attachments).where(and(eq(schema.attachments.pageId, pageId), isNull(schema.attachments.deletedAt)))).map((a) => a.id);
}
async function retrieved(wsId: string, query: string, pageIds: string[], limit = 12) {
  try { const hits = await hybridSearch(wsId, query.slice(0, 1000), { limit, pageIds }); return hits.map((h, i) => `[S${i + 1}] ${h.title}${h.heading ? ` › ${h.heading}` : ""} (${h.sourceType})\n${h.content.slice(0, 900)}`); } catch (e) { console.error("research retrieval failed", e); return []; }
}

// ---------- generic runners
interface Prepared { system: string; user: string; task: TaskClass; context: { references: number; attachments: number; sources: number; pageChars: number }; maxTokens?: number }
async function* streamText(wsId: string, feature: ResearchFeature, p: Prepared, preferred: string | null | undefined, signal?: AbortSignal): AsyncGenerator<ResearchAIEvent, string> {
  const dec = await route({ task: p.task, preferred: preferred ?? null, estTokens: approxTokens(p.system + p.user) + (p.maxTokens ?? 6000) });
  yield { type: "meta", feature, model: dec.model.id, provider: dec.provider, reason: dec.reason, context: p.context };
  let text = ""; let usage: AIUsage | null = null; let ms = 0; let ttft: number | null = null; let err: string | null = null;
  for await (const ev of streamAI({ model: dec.model.id, provider: dec.provider, system: p.system, messages: [{ role: "user", content: p.user }], effort: dec.effort, maxTokens: p.maxTokens ?? 6000, signal })) {
    if (ev.type === "text") { text += ev.delta; yield { type: "text", delta: ev.delta }; } else if (ev.type === "done") { usage = ev.usage; ms = ev.totalMs; ttft = ev.ttftMs; } else if (ev.type === "error") err = ev.message;
  }
  const cost = usage ? costUsd(dec.model, usage) : null;
  await recordUsage({ workspaceId: wsId, provider: dec.provider, model: dec.model.id, task: `research:${feature}`, usage, costUsd: cost, latencyMs: ms, ttftMs: ttft, ok: !err, error: err });
  if (err && !text) { yield { type: "error", message: err }; return ""; }
  yield { type: "done", usage, costUsd: cost, latencyMs: Math.round(ms) };
  return text;
}
async function jsonCall<T>(wsId: string, feature: ResearchFeature, p: Prepared, schemaName: string, jsonSchema: Record<string, unknown>, preferred: string | null | undefined, signal?: AbortSignal): Promise<{ data: T; meta: ResearchAIEvent & { type: "meta" }; done: ResearchAIEvent & { type: "done" } }> {
  const dec = await route({ task: p.task, schema: true, preferred: preferred ?? null, estTokens: approxTokens(p.system + p.user) + 4000 });
  const meta: ResearchAIEvent & { type: "meta" } = { type: "meta", feature, model: dec.model.id, provider: dec.provider, reason: dec.reason, context: p.context };
  let res; try { res = await callAI({ model: dec.model.id, provider: dec.provider, system: p.system, messages: [{ role: "user", content: p.user }], effort: dec.effort, maxTokens: p.maxTokens ?? 6000, jsonSchema: { name: schemaName, schema: jsonSchema }, signal }); }
  catch (e: any) { await recordUsage({ workspaceId: wsId, provider: dec.provider, model: dec.model.id, task: `research:${feature}`, ok: false, error: String(e?.message ?? e) }); throw e; }
  await recordUsage({ workspaceId: wsId, provider: dec.provider, model: dec.model.id, task: `research:${feature}`, usage: res.usage, costUsd: res.costUsd, latencyMs: res.totalMs, ttftMs: res.ttftMs, ok: true });
  let data: T; try { data = JSON.parse(res.text.trim().replace(/^```(?:json)?\s*|\s*```$/g, "")) as T; } catch { throw new Error("The model did not return valid JSON"); }
  return { data, meta, done: { type: "done", usage: res.usage, costUsd: res.costUsd, latencyMs: Math.round(res.totalMs) } };
}

// ---------- features
async function prepSynthesis(wsId: string, r: ResearchAIRequest): Promise<Prepared> {
  const page = await pageOf(wsId, r.pageId); const refs = await listReferences(wsId, { pageId: r.pageId });
  const chosen = r.referenceIds?.length ? refs.filter((x) => r.referenceIds!.includes(x.id)) : refs;
  const attIds = [...new Set([...chosen.map((x) => x.attachmentId).filter(Boolean) as string[], ...(r.attachmentIds ?? [])])];
  const atts = await attachmentTexts(wsId, attIds, 12_000);
  const query = r.question?.trim() || `${page.title} ${(page.properties as any)?.tags?.join?.(" ") ?? ""} literature review methods results`;
  const hits = await retrieved(wsId, query, [r.pageId], 12);
  const md = toMarkdown(page.content as PMNode).slice(0, 12_000);
  const user = [ws("current-page", md, `title="${esc(page.title)}"`), ws("references", chosen.map((x) => refLine(x)).join("\n") || "(no references stored for this page)"), atts.length ? ws("attached-papers", atts.map((a) => `### ${a.filename}${a.pages ? ` (${a.pages} p.)` : ""}\n${a.text}`).join("\n\n")) : "", hits.length ? ws("retrieved-passages", hits.join("\n\n")) : "", `Write a literature synthesis for this working paper${r.question ? ` focused on: ${r.question}` : ""}. Structure: (1) the central questions the literature addresses, (2) main strands and findings with inline citations using the stored cite keys in the form \\cite{key}, (3) methodological patterns and disagreements, (4) gaps this paper can fill, (5) a table of the references (key, question, data, method, key finding). Cite only the references listed above; if a claim has no supporting reference in the material, mark it "[no stored reference]".`].filter(Boolean).join("\n\n");
  return { system: sys("Task: literature synthesis grounded strictly in the stored references, attached papers and retrieved passages.", r.language), user, task: "deep", maxTokens: 7000, context: { references: chosen.length, attachments: atts.length, sources: hits.length, pageChars: md.length } };
}
async function prepCompare(wsId: string, r: ResearchAIRequest): Promise<Prepared> {
  const refs = r.referenceIds?.length ? await listReferences(wsId, { ids: r.referenceIds }) : [];
  const attIds = [...new Set([...refs.map((x) => x.attachmentId).filter(Boolean) as string[], ...(r.attachmentIds ?? [])])];
  if (refs.length + attIds.length < 2) throw new HttpError(400, "Select at least two references or files to compare");
  const atts = await attachmentTexts(wsId, attIds, 18_000);
  const user = [ws("references", refs.map((x) => refLine(x)).join("\n") || "(none)"), atts.length ? ws("papers-full-text", atts.map((a) => `### ${a.filename}\n${a.text}`).join("\n\n")) : "", `Compare the methodology of these works: research question, theoretical framework, data (sample, period, frequency), identification/estimation strategy, inference, main results, limitations. Produce a side-by-side Markdown table followed by a critical discussion (strengths, weaknesses, what each approach can and cannot identify) and recommendations for the author's own design. Refer to works by \\cite{key} or filename. Where the full text is not available, say that the comparison relies on the abstract/metadata only.${r.instruction ? `\n\nAdditional focus: ${r.instruction}` : ""}`].filter(Boolean).join("\n\n");
  return { system: sys("Task: methodology comparison between academic works.", r.language), user, task: "reason", maxTokens: 6000, context: { references: refs.length, attachments: atts.length, sources: 0, pageChars: 0 } };
}
async function prepQuestion(wsId: string, r: ResearchAIRequest): Promise<Prepared> {
  const page = await pageOf(wsId, r.pageId); const refs = await listReferences(wsId, { pageId: r.pageId });
  const md = toMarkdown(page.content as PMNode).slice(0, 15_000); const q = (r.question ?? r.text ?? "").trim();
  const hits = q ? await retrieved(wsId, q, [r.pageId], 6) : [];
  const user = [ws("current-page", md, `title="${esc(page.title)}"`), refs.length ? ws("references", refs.map((x) => refLine(x, false)).join("\n")) : "", hits.length ? ws("retrieved-passages", hits.join("\n\n")) : "", q ? `Research question to refine:\n"${q}"` : "Derive the research question from the page content and refine it.", `Refine the research question: (1) restate it precisely (population, variables, mechanism, period); (2) list 3–5 sharper alternative formulations ranked by feasibility and contribution; (3) for the best one, state testable hypotheses with the expected sign and the identifying assumption; (4) what data and method would answer it; (5) what would falsify it; (6) which stored references it builds on (\\cite{key}) and where the novelty lies.`].filter(Boolean).join("\n\n");
  return { system: sys("Task: research-question refinement for an academic working paper.", r.language), user, task: "reason", context: { references: refs.length, attachments: 0, sources: hits.length, pageChars: md.length } };
}
async function prepEquation(wsId: string, r: ResearchAIRequest): Promise<Prepared> {
  const latex = (r.latex ?? r.text ?? "").trim(); if (!latex) throw new HttpError(400, "No equation provided");
  const page = await pageOf(wsId, r.pageId); const md = toMarkdown(page.content as PMNode).slice(0, 8000);
  const user = [ws("current-page-excerpt", md, `title="${esc(page.title)}"`), `Equation to explain:\n$$\n${latex}\n$$`, `Explain this equation for a graduate reader: define every symbol (use the page's notation when it appears there), give the intuition, derive or justify each term step by step, state the assumptions it relies on, note special cases and common pitfalls, and suggest how it could be estimated or computed. Use LaTeX.${r.instruction ? `\n\nFocus: ${r.instruction}` : ""}`].join("\n\n");
  return { system: sys("Task: mathematical explanation.", r.language), user, task: "reason", context: { references: 0, attachments: 0, sources: 0, pageChars: md.length } };
}
async function prepDraft(wsId: string, r: ResearchAIRequest): Promise<Prepared> {
  const text = (r.text ?? "").trim(); if (!text) throw new HttpError(400, "Select or paste the section to edit");
  const page = await pageOf(wsId, r.pageId); const refs = await listReferences(wsId, { pageId: r.pageId });
  const user = [ws("section-to-edit", text, `page="${esc(page.title)}"`), refs.length ? ws("available-references", refs.map((x) => `\\cite{${x.citeKey}} = ${shortCite(x)}, ${x.title}`).join("\n")) : "", `Instruction: ${r.instruction?.trim() || "Edit this section to journal standard: tighten the argument, improve flow and precision, keep the author's voice, meaning and language."}\n\nReturn the revised section first (ready to paste, same Markdown/LaTeX conventions, cite only with the listed \\cite{keys}), then a short "Changes" list explaining what you changed and any claims that still need a reference or evidence.`].filter(Boolean).join("\n\n");
  return { system: sys("Task: academic draft editing.", r.language), user, task: "write", maxTokens: 7000, context: { references: refs.length, attachments: 0, sources: 0, pageChars: text.length } };
}

// ---------- reference checking
export interface CitationHit { citation: string; kind: "cite" | "author-year"; context: string; status: "matched" | "unverified" | "ambiguous"; citeKey: string | null; referenceId: string | null; note: string; candidates?: string[] }
const deaccent = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
export function extractCitations(text: string): { citation: string; kind: "cite" | "author-year"; context: string }[] {
  const out: { citation: string; kind: "cite" | "author-year"; context: string }[] = []; const seen = new Set<string>();
  const ctx = (i: number) => text.slice(Math.max(0, i - 120), i + 160).replace(/\s+/g, " ").trim();
  for (const m of text.matchAll(/\\(?:cite|citep|citet|citeauthor|citeyear|parencite|textcite|autocite|nocite)\*?(?:\[[^\]]*\]){0,2}\{([^}]+)\}/g)) for (const k of m[1].split(",").map((x) => x.trim()).filter(Boolean)) { const id = "k:" + k.toLowerCase(); if (!seen.has(id)) { seen.add(id); out.push({ citation: `\\cite{${k}}`, kind: "cite", context: ctx(m.index ?? 0) }); } }
  const name = "[A-ZÀ-Ý][\\p{L}'’\\-]+(?:\\s+(?:de|van|von|der|du|le|la|di)\\s+[A-ZÀ-Ý][\\p{L}'’\\-]+)?";
  const re = new RegExp(`\\b(${name}(?:\\s*(?:,|and|&|et)\\s*${name})?(?:\\s+et\\s+al\\.?)?)\\s*[,(]?\\s*((?:19|20)\\d{2}[a-z]?)\\)?`, "gu");
  for (const m of text.matchAll(re)) { const c = `${m[1].replace(/\s+/g, " ")} (${m[2]})`; const id = "a:" + deaccent(c); if (seen.has(id)) continue; if (/^(Table|Figure|Section|Equation|Panel|Appendix|Working|Paper|Journal|Review|In|On|The|See|Since|During|From|Of|And|For)\b/.test(m[1])) continue; seen.add(id); out.push({ citation: c, kind: "author-year", context: ctx(m.index ?? 0) }); }
  return out.slice(0, 80);
}
function matchDeterministic(c: { citation: string; kind: "cite" | "author-year" }, refs: ReferenceRow[]): { status: CitationHit["status"]; ref: ReferenceRow | null; candidates: ReferenceRow[] } {
  if (c.kind === "cite") { const key = c.citation.slice(6, -1).toLowerCase(); const ref = refs.find((r) => r.citeKey.toLowerCase() === key) ?? null; return { status: ref ? "matched" : "unverified", ref, candidates: [] }; }
  const m = c.citation.match(/^(.*)\s\((\d{4})[a-z]?\)$/); if (!m) return { status: "unverified", ref: null, candidates: [] };
  const year = Number(m[2]); const names = m[1].replace(/\bet al\.?/i, "").split(/\s*(?:,|and|&|et)\s*/).map(deaccent).filter(Boolean);
  const cands = refs.filter((r) => r.year === year && names.every((n) => (r.authors ?? []).some((a) => deaccent(lastName(a)) === n || deaccent(a).includes(n))));
  if (cands.length === 1) return { status: "matched", ref: cands[0], candidates: cands }; if (cands.length > 1) return { status: "ambiguous", ref: null, candidates: cands };
  const loose = refs.filter((r) => Math.abs((r.year ?? 0) - year) <= 1 && names.some((n) => (r.authors ?? []).some((a) => deaccent(lastName(a)) === n)));
  return { status: "unverified", ref: null, candidates: loose };
}
async function* runRefcheck(wsId: string, r: ResearchAIRequest, signal?: AbortSignal): AsyncGenerator<ResearchAIEvent> {
  const page = await pageOf(wsId, r.pageId); const refs = await listReferences(wsId, { pageId: r.pageId });
  const allRefs = refs.length ? refs : await listReferences(wsId); // fall back to the whole library when the page has none
  const text = r.text?.trim() || page.plainText || toMarkdown(page.content as PMNode);
  const found = extractCitations(text);
  const items: CitationHit[] = found.map((c) => { const d = matchDeterministic(c, allRefs); return { ...c, status: d.status, citeKey: d.ref?.citeKey ?? null, referenceId: d.ref?.id ?? null, note: d.status === "matched" ? "exact match" : d.status === "ambiguous" ? "several stored references match" : "no stored reference matches", candidates: d.candidates.map((x) => x.citeKey) }; });
  const toJudge = items.filter((i) => i.status !== "matched" || i.kind === "author-year");
  let meta: ResearchAIEvent & { type: "meta" } = { type: "meta", feature: "refcheck", model: "deterministic", provider: "local", reason: "no model call needed", context: { references: allRefs.length, attachments: 0, sources: 0, pageChars: text.length } };
  let done: ResearchAIEvent & { type: "done" } = { type: "done", usage: null, costUsd: null, latencyMs: 0 };
  if (toJudge.length && allRefs.length) {
    const keys = new Set(allRefs.map((x) => x.citeKey));
    const p: Prepared = { task: "reason", context: meta.context, system: sys("Task: reference checking. You decide, for each citation found in the author's text, whether it refers to one of the STORED references. Rules: a citation is matched only when author surnames and year agree with a stored reference (a one-year difference is acceptable only if the surnames match exactly and you say so in the note). Never propose a cite key that is not in the stored list. When unsure, answer unverified.", r.language), user: [ws("stored-references", allRefs.map((x) => refLine(x, false)).join("\n")), ws("citations-found", toJudge.map((c, i) => `#${i} ${c.citation} [${c.kind}; pre-check: ${c.status}${c.candidates?.length ? `; candidates: ${c.candidates.join(", ")}` : ""}]\n  context: …${c.context}…`).join("\n")), `Return JSON {"items":[{"index":number,"status":"matched"|"unverified","citeKey":string|null,"note":string}]} with one item per citation (#index).`].join("\n\n") };
    try {
      const res = await jsonCall<{ items: { index: number; status: "matched" | "unverified"; citeKey: string | null; note: string }[] }>(wsId, "refcheck", p, "refcheck", { type: "object", additionalProperties: false, required: ["items"], properties: { items: { type: "array", items: { type: "object", additionalProperties: false, required: ["index", "status", "citeKey", "note"], properties: { index: { type: "integer" }, status: { type: "string", enum: ["matched", "unverified"] }, citeKey: { type: ["string", "null"] }, note: { type: "string" } } } } } }, r.model, signal);
      meta = res.meta; done = res.done;
      for (const it of res.data.items ?? []) {
        const target = toJudge[it.index]; if (!target) continue;
        const ok = it.status === "matched" && it.citeKey && keys.has(it.citeKey); const ref = ok ? allRefs.find((x) => x.citeKey === it.citeKey)! : null;
        if (target.kind === "cite" && target.status === "matched") { target.note = it.note || target.note; continue; } // exact key match always wins
        target.status = ok ? "matched" : "unverified"; target.citeKey = ref?.citeKey ?? null; target.referenceId = ref?.id ?? null;
        target.note = (ok ? "" : "unverified — ") + (it.note || (ok ? "matched by the model" : "no stored reference matches")) + (it.status === "matched" && !ok ? " (model proposed an unknown key; rejected)" : "");
      }
    } catch (e: any) { meta = { ...meta, reason: `model unavailable, deterministic check only (${String(e?.message ?? e).slice(0, 120)})` }; }
  }
  for (const i of items) if (i.status === "ambiguous") { i.status = "unverified"; i.note = `unverified — ambiguous between ${i.candidates?.join(", ")}`; }
  yield meta;
  const matched = items.filter((i) => i.status === "matched"); const unverified = items.filter((i) => i.status !== "matched");
  const md = [`**Reference check** — ${found.length} citation${found.length === 1 ? "" : "s"} found in the page, ${matched.length} matched to stored references, ${unverified.length} unverified. Checked against ${allRefs.length} stored reference${allRefs.length === 1 ? "" : "s"}${refs.length ? " of this page" : " of the whole library (this page has none)"}.`,
    unverified.length ? `### Unverified (${unverified.length})\n| Citation | Note | Context |\n|---|---|---|\n${unverified.map((i) => `| ${i.citation.replace(/\|/g, "\\|")} | ${i.note.replace(/\|/g, "\\|")} | …${i.context.replace(/\|/g, "\\|").slice(0, 140)}… |`).join("\n")}` : "No unverified citations.",
    matched.length ? `### Matched (${matched.length})\n| Citation | Stored reference | Note |\n|---|---|---|\n${matched.map((i) => `| ${i.citation.replace(/\|/g, "\\|")} | \\cite{${i.citeKey}} | ${i.note.replace(/\|/g, "\\|")} |`).join("\n")}` : "",
    found.length ? "" : "_No citation-like strings (\\cite{…} or Author (Year)) were found in the page text._"].filter(Boolean).join("\n\n");
  yield { type: "text", delta: md }; yield { type: "result", data: { items, matched: matched.length, unverified: unverified.length, found: found.length } }; yield done;
}

// ---------- experimental planning
export interface PlanData { title: string; objective: string; hypotheses: string[]; design: string; data: string[]; steps: { title: string; description: string; deliverable: string }[]; tasks: { title: string; priority: "low" | "medium" | "high"; dueInDays: number | null }[]; risks: string[] }
async function* runPlan(wsId: string, r: ResearchAIRequest, signal?: AbortSignal): AsyncGenerator<ResearchAIEvent> {
  const page = await pageOf(wsId, r.pageId); const refs = await listReferences(wsId, { pageId: r.pageId });
  const exps = await db.select().from(schema.experiments).where(eq(schema.experiments.pageId, r.pageId));
  const md = toMarkdown(page.content as PMNode).slice(0, 15_000);
  const p: Prepared = { task: "deep", maxTokens: 6000, context: { references: refs.length, attachments: 0, sources: 0, pageChars: md.length }, system: sys("Task: experimental / empirical planning for a working paper. Produce a concrete, sequenced plan whose tasks can be executed by the author; tasks must be specific (what, with which data/tool, expected output).", r.language), user: [ws("current-page", md, `title="${esc(page.title)}"`), refs.length ? ws("references", refs.map((x) => refLine(x, false)).join("\n")) : "", exps.length ? ws("existing-experiments", exps.map((e) => `- ${e.name} [${e.status}] params=${JSON.stringify(e.params)} metrics=${JSON.stringify(e.metrics)}`).join("\n")) : "", `Plan the experiments/empirical work for this paper${r.instruction ? `: ${r.instruction}` : ""}. Return JSON {"title","objective","hypotheses":[…],"design":"…","data":[…],"steps":[{"title","description","deliverable"}],"tasks":[{"title","priority":"low|medium|high","dueInDays":number|null}],"risks":[…]}; 5–12 steps, 6–15 tasks ordered by execution, Markdown/LaTeX allowed inside strings.`].filter(Boolean).join("\n\n") };
  const schemaDef = { type: "object", additionalProperties: false, required: ["title", "objective", "hypotheses", "design", "data", "steps", "tasks", "risks"], properties: { title: { type: "string" }, objective: { type: "string" }, hypotheses: { type: "array", items: { type: "string" } }, design: { type: "string" }, data: { type: "array", items: { type: "string" } }, steps: { type: "array", items: { type: "object", additionalProperties: false, required: ["title", "description", "deliverable"], properties: { title: { type: "string" }, description: { type: "string" }, deliverable: { type: "string" } } } }, tasks: { type: "array", items: { type: "object", additionalProperties: false, required: ["title", "priority", "dueInDays"], properties: { title: { type: "string" }, priority: { type: "string", enum: ["low", "medium", "high"] }, dueInDays: { type: ["integer", "null"] } } } }, risks: { type: "array", items: { type: "string" } } } };
  const res = await jsonCall<PlanData>(wsId, "plan", p, "experimental_plan", schemaDef, r.model, signal);
  yield res.meta;
  const d = res.data;
  const md2 = [`## ${d.title}`, `**Objective.** ${d.objective}`, d.hypotheses?.length ? `### Hypotheses\n${d.hypotheses.map((h, i) => `- **H${i + 1}.** ${h}`).join("\n")}` : "", `### Design\n${d.design}`, d.data?.length ? `### Data\n${d.data.map((x) => `- ${x}`).join("\n")}` : "", `### Steps\n${(d.steps ?? []).map((s, i) => `${i + 1}. **${s.title}** — ${s.description} _Deliverable: ${s.deliverable}_`).join("\n")}`, `### Proposed tasks\n${(d.tasks ?? []).map((t) => `- [ ] ${t.title} (${t.priority}${t.dueInDays != null ? `, ~${t.dueInDays} d` : ""})`).join("\n")}`, d.risks?.length ? `### Risks\n${d.risks.map((x) => `- ${x}`).join("\n")}` : ""].filter(Boolean).join("\n\n");
  yield { type: "text", delta: md2 }; yield { type: "result", data: d }; yield res.done;
}

/** Entry point used by POST /api/research/ai. */
export async function* researchAI(wsId: string, r: ResearchAIRequest, signal?: AbortSignal): AsyncGenerator<ResearchAIEvent> {
  try {
    switch (r.feature) {
      case "synthesis": yield* streamText(wsId, r.feature, await prepSynthesis(wsId, r), r.model, signal); return;
      case "compare": yield* streamText(wsId, r.feature, await prepCompare(wsId, r), r.model, signal); return;
      case "question": yield* streamText(wsId, r.feature, await prepQuestion(wsId, r), r.model, signal); return;
      case "equation": yield* streamText(wsId, r.feature, await prepEquation(wsId, r), r.model, signal); return;
      case "draft": yield* streamText(wsId, r.feature, await prepDraft(wsId, r), r.model, signal); return;
      case "refcheck": yield* runRefcheck(wsId, r, signal); return;
      case "plan": yield* runPlan(wsId, r, signal); return;
      default: throw new HttpError(400, "Unknown feature");
    }
  } catch (e: any) { if (signal?.aborted) return; yield { type: "error", message: String(e?.message ?? e).slice(0, 500) }; }
}
