/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/lib/agents/tools.ts
 * Module           : lib
 * Repository       : https://git.spboucher.ai/note-spboucher-ai
 * Project Website  : https://note.spboucher.ai
 * Created          : 2026-11-01
 * Last Modified    : 2026-11-17
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
 * Agent tools — the complete surface an agent can touch. Server-side, zod-validated, allow-listed per agent.
 *  - Read tools only return what the agent's scope allows: `read_page` refuses any page that a listing tool (or the context page) did not
 *    put in `ctx.readable` for this run. There is no search tool, no network tool and no shell.
 *  - `propose_*` tools write NOTHING: they append a proposal (with a server-built before → after preview) to the run.
 *  - `logInput` / `logOutput` reduce what goes into the execution log to ids, counts and enum values — never note text.
 */
import { z } from "zod";
import { and, desc, eq, inArray, isNotNull, isNull, notExists, sql as dsql } from "drizzle-orm";
import { db, schema } from "@/db";
import { toMarkdown, type PMNode } from "@/lib/editor/text";
import type { ToolDef } from "@/lib/ai/types";
import type { Preview, Proposal, RunLimits } from "./types";

export interface ToolContext { workspaceId: string; executionId: string; contextPageId: string | null; readable: Set<string>; accessed: Set<string>; proposals: Proposal[]; limits: RunLimits }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface ToolSpec { name: string; description: string; proposal: boolean; input: z.ZodTypeAny; run: (input: any, ctx: ToolContext) => Promise<Record<string, unknown>> }

const nowIso = () => new Date().toISOString();
const uuid = z.string().uuid();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SECTIONS = ["notes", "documents", "projects", "research"] as const;
const cleanTags = (names: string[]) => [...new Set(names.map((n) => n.trim().replace(/^#/, "").toLowerCase().slice(0, 40)).filter(Boolean))];
const tagLine = (t: string[]) => `Tags: ${t.length ? t.map((x) => `#${x}`).join(" ") : "none"}`;

/** Log-safe view of a tool input/output: uuids, numbers, booleans and short enum-like strings survive; any other text becomes its length. */
export function logSafe(v: unknown, depth = 0): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!v || typeof v !== "object" || Array.isArray(v)) return out;
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    if (x == null || typeof x === "number" || typeof x === "boolean") out[k] = x;
    else if (typeof x === "string") out[k] = UUID_RE.test(x) || (ENUM_KEYS.has(k) && x.length <= 24) ? x : `${x.length} chars`;
    else if (Array.isArray(x)) out[k] = x.every((i) => typeof i === "string" && UUID_RE.test(i)) && x.length <= 40 ? x : `${x.length} items`;
    else if (depth < 1) out[k] = logSafe(x, depth + 1);
  }
  return out;
}
const ENUM_KEYS = new Set(["action", "section", "priority", "mode", "error", "kind", "status"]);

async function loadPage(ctx: ToolContext, id: string) {
  const [p] = await db.select().from(schema.pages).where(and(eq(schema.pages.id, id), eq(schema.pages.workspaceId, ctx.workspaceId), isNull(schema.pages.deletedAt)));
  return p ?? null;
}
async function tagsOf(pageIds: string[]): Promise<Map<string, string[]>> {
  const m = new Map<string, string[]>(); if (!pageIds.length) return m;
  const rows = await db.select({ pageId: schema.pageTags.pageId, name: schema.tags.name }).from(schema.pageTags).innerJoin(schema.tags, eq(schema.tags.id, schema.pageTags.tagId)).where(inArray(schema.pageTags.pageId, pageIds));
  for (const r of rows) m.set(r.pageId, [...(m.get(r.pageId) ?? []), r.name].sort());
  return m;
}
type NewProposal = { [K in Proposal["kind"]]: Omit<Extract<Proposal, { kind: K }>, "idx" | "at" | "status"> }[Proposal["kind"]];
function addProposal(ctx: ToolContext, p: NewProposal): Record<string, unknown> {
  if (ctx.proposals.length >= ctx.limits.maxProposals) return { error: `Proposal limit reached (${ctx.limits.maxProposals}). Stop proposing and write your summary.` };
  const full = { ...p, idx: ctx.proposals.length, at: nowIso(), status: "proposed" } as Proposal;
  ctx.proposals.push(full);
  return { recorded: true, proposal: full.idx, note: "Recorded for the owner's review. Nothing was changed." };
}

// ---------- read tools
const list_inbox: ToolSpec = {
  name: "list_inbox", proposal: false, description: "List the items waiting in the inbox (id, title, kind, a short excerpt, current tags). At most 25, newest first.",
  input: z.object({}),
  async run(_i, ctx) {
    const P = schema.pages;
    const rows = await db.select({ id: P.id, title: P.title, kind: P.captureKind, section: P.section, words: P.wordCount, excerpt: dsql<string>`left(${P.plainText}, 400)` }).from(P).where(and(eq(P.workspaceId, ctx.workspaceId), isNotNull(P.inboxAt), isNull(P.deletedAt), eq(P.archived, false))).orderBy(desc(P.inboxAt)).limit(25);
    const tags = await tagsOf(rows.map((r) => r.id));
    for (const r of rows) { ctx.readable.add(r.id); ctx.accessed.add(r.id); }
    return { count: rows.length, items: rows.map((r) => ({ pageId: r.id, title: r.title, kind: r.kind ?? "note", words: r.words, excerpt: r.excerpt, tags: tags.get(r.id) ?? [] })) };
  },
};
const list_tags: ToolSpec = {
  name: "list_tags", proposal: false, description: "List the names of the owner's existing tags (reuse them before inventing new ones).",
  input: z.object({}),
  async run(_i, ctx) { const rows = await db.select({ name: schema.tags.name }).from(schema.tags).where(eq(schema.tags.workspaceId, ctx.workspaceId)).orderBy(schema.tags.name).limit(300); return { count: rows.length, tags: rows.map((r) => r.name) }; },
};
const list_candidate_pages: ToolSpec = {
  name: "list_candidate_pages", proposal: false, description: "List the pages this run may tag: the context page when one was chosen, otherwise the 12 most recently edited pages that have no tag.",
  input: z.object({}),
  async run(_i, ctx) {
    const P = schema.pages; const cols = { id: P.id, title: P.title, section: P.section, words: P.wordCount, excerpt: dsql<string>`left(${P.plainText}, 300)` };
    const rows = ctx.contextPageId
      ? await db.select(cols).from(P).where(and(eq(P.id, ctx.contextPageId), eq(P.workspaceId, ctx.workspaceId), isNull(P.deletedAt)))
      : await db.select(cols).from(P).where(and(eq(P.workspaceId, ctx.workspaceId), isNull(P.deletedAt), isNull(P.databaseId), eq(P.archived, false), eq(P.type, "page"), dsql`${P.wordCount} > 20`, notExists(db.select({ x: dsql`1` }).from(schema.pageTags).where(eq(schema.pageTags.pageId, P.id))))).orderBy(desc(P.updatedAt)).limit(12);
    const tags = await tagsOf(rows.map((r) => r.id));
    for (const r of rows) { ctx.readable.add(r.id); ctx.accessed.add(r.id); }
    return { count: rows.length, pages: rows.map((r) => ({ pageId: r.id, title: r.title, section: r.section, words: r.words, excerpt: r.excerpt, tags: tags.get(r.id) ?? [] })) };
  },
};
const read_page: ToolSpec = {
  name: "read_page", proposal: false, description: "Read one page of this run's scope as Markdown (the context page, or a page returned by a list tool). Long pages are capped; pass `offset` to continue.",
  input: z.object({ pageId: uuid, offset: z.number().int().min(0).optional(), maxChars: z.number().int().min(500).max(24_000).optional() }),
  async run(i: { pageId: string; offset?: number; maxChars?: number }, ctx) {
    if (!ctx.readable.has(i.pageId)) return { error: "This page is outside the scope of this run" };
    const p = await loadPage(ctx, i.pageId); if (!p) return { error: "Page not found" };
    ctx.accessed.add(p.id);
    const md = toMarkdown(p.content as PMNode); const off = i.offset ?? 0; const max = i.maxChars ?? 12_000;
    return { pageId: p.id, title: p.title, section: p.section, words: p.wordCount, totalChars: md.length, offset: off, truncated: md.length > off + max, markdown: md.slice(off, off + max) };
  },
};
/** Deterministic checks — the model reports them, it does not decide them. No network: a DOI is only checked for its format and its stored status. */
export function referenceIssues(r: { title: string; authors: string[] | null; year: number | null; journal: string | null; doi: string | null; url: string | null; entryType: string; verified: string }): string[] {
  const out: string[] = [];
  if (!r.title?.trim() || r.title.trim().toLowerCase() === "untitled") out.push("missing title");
  if (!r.authors?.length) out.push("missing authors");
  if (!r.year) out.push("missing year");
  if (r.entryType === "article" && !r.journal?.trim()) out.push("missing journal");
  if (!r.doi?.trim()) { if (!r.url?.trim()) out.push("no DOI and no URL"); }
  else if (!/^10\.\d{4,9}\/\S+$/.test(r.doi.trim())) out.push("DOI is malformed");
  else if (r.verified !== "doi_verified") out.push("DOI never verified against Crossref (use Verify in References)");
  if (r.verified === "ai_suggested") out.push("entry was suggested by AI and never confirmed");
  return out;
}
const list_references: ToolSpec = {
  name: "list_references", proposal: false, description: "List the references that have a detected problem (missing fields, malformed or unverified DOI), with the problems found. At most 30.",
  input: z.object({}),
  async run(_i, ctx) {
    const R = schema.researchReferences;
    const rows = await db.select({ id: R.id, citeKey: R.citeKey, entryType: R.entryType, title: R.title, authors: R.authors, year: R.year, journal: R.journal, doi: R.doi, url: R.url, verified: R.verified }).from(R).where(and(eq(R.workspaceId, ctx.workspaceId), isNull(R.deletedAt))).orderBy(desc(R.updatedAt)).limit(500);
    const flagged = rows.map((r) => ({ r, issues: referenceIssues(r) })).filter((x) => x.issues.length);
    return { total: rows.length, flaggedCount: flagged.length, shown: Math.min(30, flagged.length), flagged: flagged.slice(0, 30).map(({ r, issues }) => ({ referenceId: r.id, citeKey: r.citeKey, title: r.title.slice(0, 160), year: r.year, issues })) };
  },
};

// ---------- proposal tools (never write)
const rationale = z.string().min(1).max(400).describe("One short sentence explaining why");
const propose_inbox_triage: ToolSpec = {
  name: "propose_inbox_triage", proposal: true, description: "Propose what to do with ONE inbox item: keep it (filed in a section), archive it, or move it to the trash; optionally add up to 3 tags. Nothing changes until the owner approves.",
  input: z.object({ pageId: uuid, action: z.enum(["keep", "archive", "trash"]), section: z.enum(SECTIONS).optional().describe("Required for keep"), tags: z.array(z.string().min(1).max(40)).max(3).optional(), rationale }),
  async run(i: { pageId: string; action: "keep" | "archive" | "trash"; section?: (typeof SECTIONS)[number]; tags?: string[]; rationale: string }, ctx) {
    if (!ctx.readable.has(i.pageId)) return { error: "This page is outside the scope of this run" };
    const p = await loadPage(ctx, i.pageId); if (!p || !p.inboxAt) return { error: "This item is not in the inbox" };
    if (ctx.proposals.some((x) => x.kind === "inbox_triage" && x.payload.pageId === p.id)) return { error: "Already proposed for this item" };
    const cur = (await tagsOf([p.id])).get(p.id) ?? []; const add = i.action === "trash" ? [] : cleanTags(i.tags ?? []).filter((t) => !cur.includes(t)); const section = i.action === "keep" ? i.section ?? "notes" : null;
    const before: Preview = { label: "Now", lines: ["In the inbox", tagLine(cur)] };
    const after: Preview = { label: "After", lines: [i.action === "keep" ? `Filed in “${section}”, out of the inbox` : i.action === "archive" ? "Archived: out of the inbox, still searchable" : "Moved to the trash (can be restored from the trash)", ...(i.action === "trash" ? [] : [tagLine([...cur, ...add].sort())])] };
    return addProposal(ctx, { tool: "propose_inbox_triage", kind: "inbox_triage", rationale: i.rationale, title: p.title, destructive: i.action === "trash", pageId: p.id, before, after, payload: { pageId: p.id, action: i.action, section, tags: add } });
  },
};
const propose_tags: ToolSpec = {
  name: "propose_tags", proposal: true, description: "Propose tags to ADD to one page of this run's scope (existing tags are kept). Nothing changes until the owner approves.",
  input: z.object({ pageId: uuid, tags: z.array(z.string().min(1).max(40)).min(1).max(4), rationale }),
  async run(i: { pageId: string; tags: string[]; rationale: string }, ctx) {
    if (!ctx.readable.has(i.pageId)) return { error: "This page is outside the scope of this run" };
    const p = await loadPage(ctx, i.pageId); if (!p) return { error: "Page not found" };
    if (ctx.proposals.some((x) => x.kind === "tags" && x.payload.pageId === p.id)) return { error: "Already proposed for this page" };
    const cur = (await tagsOf([p.id])).get(p.id) ?? []; const add = cleanTags(i.tags).filter((t) => !cur.includes(t));
    if (!add.length) return { error: "The page already has these tags" };
    return addProposal(ctx, { tool: "propose_tags", kind: "tags", rationale: i.rationale, title: p.title, destructive: false, pageId: p.id, before: { label: "Now", lines: [tagLine(cur)] }, after: { label: "After", lines: [tagLine([...cur, ...add].sort()), `Added: ${add.map((t) => `#${t}`).join(" ")}`] }, payload: { pageId: p.id, add } });
  },
};
const propose_new_page: ToolSpec = {
  name: "propose_new_page", proposal: true, description: "Propose ONE new page (Markdown body) created under the context page. Nothing is created until the owner approves.",
  input: z.object({ title: z.string().min(1).max(160), markdown: z.string().min(1).max(20_000), rationale }),
  async run(i: { title: string; markdown: string; rationale: string }, ctx) {
    const parent = ctx.contextPageId ? await loadPage(ctx, ctx.contextPageId) : null; if (!parent) return { error: "No context page for this run" };
    if (ctx.proposals.some((x) => x.kind === "new_page")) return { error: "Only one new page per run" };
    return addProposal(ctx, { tool: "propose_new_page", kind: "new_page", rationale: i.rationale, title: i.title.trim(), destructive: false, pageId: parent.id, before: { label: "Now", lines: ["This page does not exist"] }, after: { label: "After", lines: [`New page “${i.title.trim()}” under “${parent.title}”`], markdown: i.markdown }, payload: { parentId: parent.id, title: i.title.trim(), markdown: i.markdown } });
  },
};
const propose_page_append: ToolSpec = {
  name: "propose_page_append", proposal: true, description: "Propose Markdown to ADD AT THE END of the context page (existing content is never replaced). Nothing changes until the owner approves.",
  input: z.object({ markdown: z.string().min(1).max(12_000), rationale }),
  async run(i: { markdown: string; rationale: string }, ctx) {
    const p = ctx.contextPageId ? await loadPage(ctx, ctx.contextPageId) : null; if (!p) return { error: "No context page for this run" };
    if (ctx.proposals.some((x) => x.kind === "page_edit")) return { error: "Only one addition per run" };
    const md = toMarkdown(p.content as PMNode).trim();
    return addProposal(ctx, { tool: "propose_page_append", kind: "page_edit", rationale: i.rationale, title: p.title, destructive: false, pageId: p.id, before: { label: "End of the page now", lines: md ? [] : ["The page is empty"], markdown: md ? (md.length > 500 ? "…" + md.slice(-500) : md) : undefined }, after: { label: "Added at the end", lines: ["Everything above stays as it is"], markdown: i.markdown }, payload: { pageId: p.id, mode: "append", markdown: i.markdown, baseVersion: p.version } });
  },
};
const propose_task: ToolSpec = {
  name: "propose_task", proposal: true, description: "Propose a new task for the owner. Nothing is created until approved.",
  input: z.object({ title: z.string().min(1).max(300), priority: z.enum(["low", "medium", "high"]).optional(), dueAt: z.string().max(40).optional().describe("ISO date (YYYY-MM-DD) only if a deadline is known"), rationale }),
  async run(i: { title: string; priority?: "low" | "medium" | "high"; dueAt?: string; rationale: string }, ctx) {
    const due = i.dueAt && !Number.isNaN(Date.parse(i.dueAt)) ? new Date(i.dueAt).toISOString() : null; const title = i.title.trim();
    if (ctx.proposals.some((x) => x.kind === "task" && x.payload.title === title)) return { error: "Already proposed" };
    return addProposal(ctx, { tool: "propose_task", kind: "task", rationale: i.rationale, title, destructive: false, pageId: null, before: { label: "Now", lines: ["This task does not exist"] }, after: { label: "After", lines: [`New task: ${title}`, `Priority: ${i.priority ?? "medium"}`, `Due: ${due ? due.slice(0, 10) : "no date"}`] }, payload: { title, priority: i.priority ?? "medium", dueAt: due, pageId: null } });
  },
};

/** Allow-list: an agent definition can only name tools that exist here. */
export const TOOLS: Record<string, ToolSpec> = Object.fromEntries([list_inbox, list_tags, list_candidate_pages, read_page, list_references, propose_inbox_triage, propose_tags, propose_new_page, propose_page_append, propose_task].map((t) => [t.name, t]));
export const toolsFor = (names: string[]): ToolSpec[] => names.map((n) => TOOLS[n]).filter((t): t is ToolSpec => Boolean(t));
export function toolDefs(tools: ToolSpec[]): ToolDef[] {
  return tools.map((t) => { const js = z.toJSONSchema(t.input, { target: "draft-7" }) as Record<string, unknown>; delete js.$schema; return { name: t.name, description: t.description, parameters: js }; });
}
/** Validate + execute one tool call. Never throws: errors are returned as data for the model. `log` is the log-safe record of the call. */
export async function executeTool(tools: ToolSpec[], name: string, args: unknown, ctx: ToolContext): Promise<{ output: Record<string, unknown>; log: { input: Record<string, unknown>; output: Record<string, unknown> }; error?: string; proposalIdx?: number }> {
  const t = tools.find((x) => x.name === name);
  if (!t) return { output: { error: `Tool "${name}" is not available in this run` }, log: { input: {}, output: { error: "unavailable" } }, error: "unavailable" };
  const parsed = t.input.safeParse(args ?? {});
  if (!parsed.success) { const msg = parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; "); return { output: { error: `Invalid input — ${msg}` }, log: { input: logSafe(args), output: { error: "invalid input" } }, error: "invalid input" }; }
  try {
    const before = ctx.proposals.length;
    const output = await t.run(parsed.data, ctx);
    const err = typeof output.error === "string" ? output.error : undefined;
    return { output, log: { input: logSafe(parsed.data), output: err ? { error: err.slice(0, 80) } : logSafe(output) }, error: err ? err.slice(0, 80) : undefined, proposalIdx: ctx.proposals.length > before ? ctx.proposals.length - 1 : undefined };
  } catch { return { output: { error: "The tool failed" }, log: { input: logSafe(parsed.data), output: { error: "exception" } }, error: "exception" }; }
}
