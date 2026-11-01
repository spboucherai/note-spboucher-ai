/**
 * Agent tools — server-side, zod-validated, scope-gated. Read tools execute immediately; `propose_*` tools only record a proposal
 * (nothing is written until the owner approves it); `create_page_draft` is the single direct write and only targets a new page
 * under the "AI drafts" parent. Agents have no shell and no network: this file is the complete surface they can touch.
 */
import { z } from "zod";
import { and, asc, desc, eq, ilike, isNull, sql as dsql } from "drizzle-orm";
import { db, schema } from "@/db";
import { hybridSearch } from "@/lib/search/index";
import { toMarkdown, docText, wordCount, type PMNode } from "@/lib/editor/text";
import { markdownToDoc } from "@/lib/editor/markdown-client";
import { enqueue, QUEUES } from "@/lib/jobs";
import type { ToolDef } from "@/lib/ai/types";
import type { Proposal, Scope } from "./types";

export interface ToolContext { workspaceId: string; executionId: string; scopes: Set<Scope>; model: string; accessed: Set<string>; proposals: Proposal[]; drafts: number; contextPageId: string | null }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface ToolSpec { name: string; description: string; scope: Scope; proposal: boolean; input: z.ZodTypeAny; run: (input: any, ctx: ToolContext) => Promise<unknown> }

const DRAFT_PARENT_TITLE = "AI drafts";
const nowIso = () => new Date().toISOString();
const uuid = z.string().uuid();
const pageCols = { id: schema.pages.id, title: schema.pages.title, icon: schema.pages.icon, section: schema.pages.section, type: schema.pages.type, parentId: schema.pages.parentId, updatedAt: schema.pages.updatedAt, wordCount: schema.pages.wordCount, properties: schema.pages.properties };

async function loadPage(ctx: ToolContext, id: string) {
  const [p] = await db.select().from(schema.pages).where(and(eq(schema.pages.id, id), eq(schema.pages.workspaceId, ctx.workspaceId), isNull(schema.pages.deletedAt)));
  return p ?? null;
}
function addProposal(ctx: ToolContext, p: Omit<Proposal, "idx" | "at" | "status" | "scopeGranted">): Proposal {
  const full = { ...p, idx: ctx.proposals.length, at: nowIso(), status: "proposed", scopeGranted: ctx.scopes.has(p.scope) } as Proposal;
  ctx.proposals.push(full); return full;
}

const search_workspace: ToolSpec = {
  name: "search_workspace", scope: "read:search", proposal: false,
  description: "Hybrid (semantic + keyword) search over the user's notes, documents and database rows. Returns the best matching passages with their page ids. Use it first to find relevant pages, then read_page for the full text.",
  input: z.object({ query: z.string().min(1).max(500).describe("Natural-language query or keywords"), limit: z.number().int().min(1).max(20).optional().describe("Max passages (default 8)") }),
  async run(i: { query: string; limit?: number }, ctx) {
    const hits = await hybridSearch(ctx.workspaceId, i.query, { limit: i.limit ?? 8 });
    for (const h of hits) if (h.pageId) ctx.accessed.add(h.pageId);
    return { count: hits.length, hits: hits.map((h) => ({ pageId: h.pageId, title: h.title, heading: h.heading, sourceType: h.sourceType, excerpt: h.content.slice(0, 700), score: Number(h.score.toFixed(4)) })) };
  },
};
const read_page: ToolSpec = {
  name: "read_page", scope: "read:pages", proposal: false,
  description: "Read one page (full content as Markdown, plus its properties). Content is capped; pass `offset` to continue reading a long page.",
  input: z.object({ pageId: uuid, offset: z.number().int().min(0).optional().describe("Character offset to start from (default 0)"), maxChars: z.number().int().min(500).max(40_000).optional().describe("Characters to return (default 16000)") }),
  async run(i: { pageId: string; offset?: number; maxChars?: number }, ctx) {
    const p = await loadPage(ctx, i.pageId); if (!p) return { error: "Page not found" };
    ctx.accessed.add(p.id);
    const md = toMarkdown(p.content as PMNode); const off = i.offset ?? 0; const max = i.maxChars ?? 16_000;
    return { id: p.id, title: p.title, section: p.section, type: p.type, parentId: p.parentId, updatedAt: p.updatedAt, wordCount: p.wordCount, properties: p.properties, totalChars: md.length, offset: off, truncated: md.length > off + max, markdown: md.slice(off, off + max) };
  },
};
const list_pages: ToolSpec = {
  name: "list_pages", scope: "read:pages", proposal: false,
  description: "List pages (id, title, section, type, parent, word count, last update). Filter by section, parent page or a title fragment. Database rows are excluded unless `databaseId` is given.",
  input: z.object({ section: z.enum(["notes", "documents", "databases", "projects", "research"]).optional(), parentId: uuid.optional(), databaseId: uuid.optional().describe("List the row pages of this database"), titleContains: z.string().max(200).optional(), limit: z.number().int().min(1).max(100).optional().describe("Default 40") }),
  async run(i: { section?: string; parentId?: string; databaseId?: string; titleContains?: string; limit?: number }, ctx) {
    const where = [eq(schema.pages.workspaceId, ctx.workspaceId), isNull(schema.pages.deletedAt)];
    if (i.databaseId) where.push(eq(schema.pages.databaseId, i.databaseId)); else where.push(isNull(schema.pages.databaseId));
    if (i.section) where.push(eq(schema.pages.section, i.section)); if (i.parentId) where.push(eq(schema.pages.parentId, i.parentId)); if (i.titleContains) where.push(ilike(schema.pages.title, `%${i.titleContains.replace(/[%_]/g, "")}%`));
    const rows = await db.select(pageCols).from(schema.pages).where(and(...where)).orderBy(desc(schema.pages.updatedAt), asc(schema.pages.position)).limit(i.limit ?? 40);
    return { count: rows.length, pages: rows.map((r) => ({ ...r, properties: Object.keys(r.properties ?? {}).length ? r.properties : undefined })) };
  },
};
const propose_page_edit: ToolSpec = {
  name: "propose_page_edit", scope: "write:pages", proposal: true,
  description: "Propose an edit to an existing page. NOTHING is written: the owner reviews the proposal and approves or rejects it. `mode: append` adds the Markdown at the end of the page; `mode: replace` replaces the whole page body (use it only for small pages you have fully read).",
  input: z.object({ pageId: uuid, mode: z.enum(["append", "replace"]), markdown: z.string().min(1).max(60_000).describe("The content to append / the new body, in Markdown"), rationale: z.string().min(1).max(1000).describe("One or two sentences explaining why") }),
  async run(i: { pageId: string; mode: "append" | "replace"; markdown: string; rationale: string }, ctx) {
    const p = await loadPage(ctx, i.pageId); if (!p) return { error: "Page not found" };
    const current = toMarkdown(p.content as PMNode);
    const pr = addProposal(ctx, { tool: "propose_page_edit", kind: "page_edit", scope: "write:pages", rationale: i.rationale, payload: { pageId: p.id, pageTitle: p.title, mode: i.mode, markdown: i.markdown, currentMarkdown: current.slice(0, 12_000) } } as any);
    return { recorded: true, proposal: pr.idx, note: "Pending owner approval. Do not assume the edit was applied." };
  },
};
const propose_task: ToolSpec = {
  name: "propose_task", scope: "write:tasks", proposal: true,
  description: "Propose a new task (to-do) for the owner. Nothing is created until approved.",
  input: z.object({ title: z.string().min(1).max(300), priority: z.enum(["low", "medium", "high"]).optional(), dueAt: z.string().optional().describe("ISO date (YYYY-MM-DD) if a deadline is implied"), pageId: uuid.optional().describe("Page the task relates to"), project: z.string().max(120).optional(), rationale: z.string().min(1).max(1000) }),
  async run(i: { title: string; priority?: "low" | "medium" | "high"; dueAt?: string; pageId?: string; project?: string; rationale: string }, ctx) {
    let pageTitle: string | null = null;
    if (i.pageId) { const p = await loadPage(ctx, i.pageId); if (!p) return { error: "Page not found" }; pageTitle = p.title; }
    const due = i.dueAt && !Number.isNaN(Date.parse(i.dueAt)) ? new Date(i.dueAt).toISOString() : null;
    const pr = addProposal(ctx, { tool: "propose_task", kind: "task", scope: "write:tasks", rationale: i.rationale, payload: { title: i.title, priority: i.priority ?? "medium", dueAt: due, pageId: i.pageId ?? null, pageTitle, project: i.project ?? null } } as any);
    return { recorded: true, proposal: pr.idx, note: "Pending owner approval." };
  },
};
const propose_link: ToolSpec = {
  name: "propose_link", scope: "write:links", proposal: true,
  description: "Propose a link (knowledge-graph edge) between two pages that are related but not yet connected. Nothing is created until approved.",
  input: z.object({ fromPageId: uuid, toPageId: uuid, relation: z.string().max(60).optional().describe("Short relation label, e.g. 'builds on', 'contradicts', 'same topic'"), confidence: z.number().min(0).max(1).optional(), rationale: z.string().min(1).max(1000) }),
  async run(i: { fromPageId: string; toPageId: string; relation?: string; confidence?: number; rationale: string }, ctx) {
    if (i.fromPageId === i.toPageId) return { error: "A page cannot link to itself" };
    const [a, b] = await Promise.all([loadPage(ctx, i.fromPageId), loadPage(ctx, i.toPageId)]); if (!a || !b) return { error: "Page not found" };
    const [existing] = await db.select({ id: schema.links.id }).from(schema.links).where(and(eq(schema.links.fromPageId, a.id), eq(schema.links.toPageId, b.id))).limit(1);
    if (existing) return { error: "These pages are already linked" };
    const pr = addProposal(ctx, { tool: "propose_link", kind: "link", scope: "write:links", rationale: i.rationale, payload: { fromPageId: a.id, fromTitle: a.title, toPageId: b.id, toTitle: b.title, relation: i.relation ?? "related", confidence: i.confidence ?? null } } as any);
    return { recorded: true, proposal: pr.idx, note: "Pending owner approval." };
  },
};
const propose_property_update: ToolSpec = {
  name: "propose_property_update", scope: "write:properties", proposal: true,
  description: "Propose setting one property (metadata key/value) on a page, e.g. status, tags, topic, year. Nothing is written until approved.",
  input: z.object({ pageId: uuid, key: z.string().min(1).max(80), value: z.union([z.string().max(2000), z.number(), z.boolean(), z.null(), z.array(z.string().max(200)).max(50)]), rationale: z.string().min(1).max(1000) }),
  async run(i: { pageId: string; key: string; value: unknown; rationale: string }, ctx) {
    const p = await loadPage(ctx, i.pageId); if (!p) return { error: "Page not found" };
    const pr = addProposal(ctx, { tool: "propose_property_update", kind: "property", scope: "write:properties", rationale: i.rationale, payload: { pageId: p.id, pageTitle: p.title, key: i.key, value: i.value, previous: (p.properties as any)?.[i.key] ?? null } } as any);
    return { recorded: true, proposal: pr.idx, note: "Pending owner approval." };
  },
};
const create_page_draft: ToolSpec = {
  name: "create_page_draft", scope: "write:pages", proposal: false,
  description: "Create ONE new draft page (Markdown body) under the owner's “AI drafts” page. This is the only direct write available; it never touches existing pages. Allowed once per run.",
  input: z.object({ title: z.string().min(1).max(200), markdown: z.string().min(1).max(80_000), icon: z.string().max(8).optional() }),
  async run(i: { title: string; markdown: string; icon?: string }, ctx) {
    if (ctx.drafts >= 1) return { error: "Only one draft page per run. Use propose_page_edit for anything else." };
    let [parent] = await db.select({ id: schema.pages.id }).from(schema.pages).where(and(eq(schema.pages.workspaceId, ctx.workspaceId), eq(schema.pages.title, DRAFT_PARENT_TITLE), isNull(schema.pages.parentId), isNull(schema.pages.deletedAt))).limit(1);
    if (!parent) [parent] = await db.insert(schema.pages).values({ workspaceId: ctx.workspaceId, title: DRAFT_PARENT_TITLE, icon: "🤖", section: "notes", content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Pages created by agents land here for review." }] }] }, plainText: "Pages created by agents land here for review.", position: 1e6 }).returning({ id: schema.pages.id });
    const content: PMNode = { type: "doc", content: markdownToDoc(i.markdown) }; const plain = docText(content);
    const [{ max }] = await db.select({ max: dsql<number>`coalesce(max(position),0)` }).from(schema.pages).where(eq(schema.pages.parentId, parent.id));
    const [p] = await db.insert(schema.pages).values({ workspaceId: ctx.workspaceId, parentId: parent.id, section: "notes", title: i.title.trim(), icon: i.icon ?? "✍️", content, plainText: plain, wordCount: wordCount(plain), position: Number(max) + 1, properties: { ai_draft: true, agent_execution: ctx.executionId, model: ctx.model } }).returning({ id: schema.pages.id, title: schema.pages.title });
    ctx.drafts += 1; ctx.accessed.add(p.id);
    await enqueue(QUEUES.index, { sourceType: "page", sourceId: p.id, workspaceId: ctx.workspaceId }, { singletonKey: `page:${p.id}`, singletonSeconds: 20 });
    return { created: true, pageId: p.id, title: p.title, url: `/p/${p.id}`, parent: DRAFT_PARENT_TITLE };
  },
};

export const TOOLS: Record<string, ToolSpec> = Object.fromEntries([search_workspace, read_page, list_pages, propose_page_edit, propose_task, propose_link, propose_property_update, create_page_draft].map((t) => [t.name, t]));

/** Tools offered to the model for a run: read tools need their read scope; proposal tools are always offered (they never write); create_page_draft needs write:pages. */
export function availableTools(names: string[], scopes: Set<Scope>): ToolSpec[] {
  return names.map((n) => TOOLS[n]).filter((t): t is ToolSpec => Boolean(t) && (t.proposal || scopes.has(t.scope)));
}
export function toolDefs(tools: ToolSpec[]): ToolDef[] {
  return tools.map((t) => { const js = z.toJSONSchema(t.input, { target: "draft-7" }) as Record<string, unknown>; delete js.$schema; return { name: t.name, description: t.description, parameters: js }; });
}
/** Validate + execute one tool call. Never throws: errors are returned as data for the model. */
export async function executeTool(tools: ToolSpec[], name: string, args: unknown, ctx: ToolContext): Promise<{ output: unknown; error?: string; proposalIdx?: number }> {
  const t = tools.find((x) => x.name === name);
  if (!t) return { output: { error: `Tool "${name}" is not available in this run` }, error: "unavailable" };
  const parsed = t.input.safeParse(args ?? {});
  if (!parsed.success) { const msg = parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; "); return { output: { error: `Invalid input — ${msg}` }, error: "invalid input" }; }
  try {
    const before = ctx.proposals.length;
    const output = await t.run(parsed.data, ctx);
    const err = output && typeof output === "object" && "error" in (output as any) ? String((output as any).error) : undefined;
    return { output, error: err, proposalIdx: ctx.proposals.length > before ? ctx.proposals.length - 1 : undefined };
  } catch (e: any) { return { output: { error: String(e?.message ?? e).slice(0, 300) }, error: "exception" }; }
}
