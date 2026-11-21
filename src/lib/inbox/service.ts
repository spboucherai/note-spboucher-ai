/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/lib/inbox/service.ts
 * Module           : lib
 * Repository       : https://git.spboucher.ai/note-spboucher-ai
 * Project Website  : https://note.spboucher.ai
 * Created          : 2026-11-17
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
 * Capture inbox. A capture is an ordinary page with `inbox_at` set: it is searchable and editable at once, and stays out of the workspace
 * tree until triaged. Every triage action records the page state before it and the ids of what it created (inbox_actions), so it can be undone.
 */
import { and, desc, eq, inArray, isNotNull, isNull, sql as dsql } from "drizzle-orm";
import { db, schema } from "@/db";
import { HttpError } from "@/lib/errors";
import { createPage, getPage, softDeletePage, restorePage } from "@/lib/pages/service";
import { createRow, deleteRows, ensureDatabase } from "@/lib/databases/service";
import { addByDoi, createReference, deleteReference } from "@/lib/research/references";
import { docText, type PMNode } from "@/lib/editor/text";
import { recordEvent, recordEvents } from "@/lib/events/service";

/** Kinds stored in `pages.capture_kind` (SPEC §4.12: `screenshot`, `selection` and `document` join the 2.x kinds in 3.0). */
export type CaptureKind = "note" | "tasks" | "link" | "photo" | "file" | "audio" | "screenshot" | "selection" | "document";
/** `idea` is a request-only alias: stored as a `note` capture with the 💡 icon, so the stored kinds stay the ones of the contract. */
export interface CaptureInput { kind: CaptureKind | "idea"; text?: string; url?: string; attachmentIds?: string[] }
const para = (text: string): PMNode => (text ? { type: "paragraph", content: [{ type: "text", text }] } : { type: "paragraph" });
const safeUrl = (u: string) => { try { const x = new URL(u.trim()); return x.protocol === "https:" || x.protocol === "http:" ? x.toString() : null; } catch { return null; } };
/** Where a captured selection comes from: a page of this workspace (`/p/<uuid>` with an optional `#block-<id>`, kept relative so it counts as a backlink) or an http(s) address. Anything else is ignored. */
export const selectionSource = (u: string | undefined): string | null => { const v = (u ?? "").trim(); if (!v) return null; const m = v.match(/^\/p\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(#block-[A-Za-z0-9_-]{1,64})?$/i); return m ? v : safeUrl(v); };
const baseName = (f: string) => f.replace(/\.[^.]{1,8}$/, "") || f;
const isAudioMime = (m: string) => m.startsWith("audio/") || m === "video/webm";

export async function capture(wsId: string, input: CaptureInput) {
  const text = (input.text ?? "").replace(/\r\n/g, "\n").trim(); const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const atts = input.attachmentIds?.length ? await db.select().from(schema.attachments).where(and(eq(schema.attachments.workspaceId, wsId), inArray(schema.attachments.id, input.attachmentIds), isNull(schema.attachments.deletedAt))) : [];
  if (input.attachmentIds?.length && atts.length !== input.attachmentIds.length) throw new HttpError(400, "Unknown attachment");
  const stamp = new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeStyle: "short", timeZone: process.env.TZ || "America/Toronto" }).format(new Date());
  let title = lines[0]?.slice(0, 120) ?? ""; const content: PMNode[] = [];
  if (input.kind === "link") {
    const url = safeUrl(input.url ?? lines[0] ?? ""); if (!url) throw new HttpError(400, "A link capture needs an http(s) URL");
    const host = new URL(url).hostname.replace(/^www\./, ""); const note = input.url ? text : lines.slice(1).join("\n");
    title = (input.url && lines[0] ? lines[0].slice(0, 120) : host);
    content.push({ type: "paragraph", content: [{ type: "text", text: url, marks: [{ type: "link", attrs: { href: url } }] }] });
    if (note) for (const l of note.split("\n")) content.push(para(l));
  } else if (input.kind === "tasks") {
    if (!lines.length) throw new HttpError(400, "Nothing to capture");
    title = lines.length === 1 ? lines[0].slice(0, 120) : `To-do · ${stamp}`;
    content.push({ type: "taskList", content: lines.map((l) => ({ type: "taskItem", attrs: { checked: false }, content: [para(l.replace(/^[-*\[\]x ]+/i, "").trim() || l)] })) });
  } else if (input.kind === "selection") {
    // text selected in a page or elsewhere: kept as a quotation, followed by where it comes from when the client says so
    if (!lines.length) throw new HttpError(400, "Nothing to capture");
    title = lines[0].length > 100 ? `${lines[0].slice(0, 96).trim()}…` : lines[0];
    content.push({ type: "blockquote", content: text.split("\n").filter((l) => l.trim()).map((l) => para(l.trim())) });
    const src = selectionSource(input.url);
    if (src) content.push({ type: "paragraph", content: [{ type: "text", text: "Source: " }, { type: "text", text: src.startsWith("/p/") ? "the page it was selected in" : src, marks: [{ type: "link", attrs: { href: src } }] }] });
  } else {
    if (!lines.length && !atts.length) throw new HttpError(400, "Nothing to capture");
    for (const l of (lines.length > 1 || text.length > 120 ? text : "").split("\n")) if (l || content.length) content.push(para(l));
    if (text.length > 120 && lines.length === 1) title = `${text.slice(0, 80).trim()}…`;
  }
  // 3.0 kinds use the 3.0 blocks: a voice capture becomes a voice note (player, transcription), a captured PDF a PDF block. The 2.x kinds (photo, file) are unchanged.
  for (const a of atts) content.push(a.mime.startsWith("image/") ? { type: "image", attrs: { src: `/api/files/${a.id}`, alt: a.filename, title: a.filename } }
    : input.kind === "audio" && isAudioMime(a.mime) ? { type: "audio", attrs: { attachmentId: a.id, duration: 0, title: /^voice-(memo|note)-/.test(a.filename) ? `Voice memo · ${stamp}` : baseName(a.filename).slice(0, 200), recordedAt: null, transcript: [], transcriptStatus: "none", transcriptEngine: null, summary: null } }
    : input.kind === "document" && (a.mime === "application/pdf" || /\.pdf$/i.test(a.filename)) ? { type: "pdf", attrs: { attachmentId: a.id, name: a.filename, page: 1, annotations: [] } }
    : { type: "fileBlock", attrs: { src: `/api/files/${a.id}`, name: a.filename, size: a.size, mime: a.mime, attachmentId: a.id } });
  if (!title) title = atts.length ? `${input.kind === "photo" ? "Photo" : input.kind === "screenshot" ? "Screenshot" : input.kind === "audio" ? "Voice memo" : atts[0].filename} · ${stamp}` : `Note · ${stamp}`;
  const kind: CaptureKind = input.kind === "idea" ? "note" : input.kind;
  const page = await createPage(wsId, { title, section: "notes", content: { type: "doc", content: content.length ? content : [{ type: "paragraph" }] }, inboxAt: new Date(), captureKind: kind, ...(input.kind === "idea" ? { icon: "💡" } : {}) });
  if (atts.length) await db.update(schema.attachments).set({ pageId: page.id }).where(inArray(schema.attachments.id, atts.map((a) => a.id)));
  await recordEvent(db, { workspaceId: wsId, kind: "capture.created", pageId: page.id, summary: page.title, data: { kind, attachments: atts.length } });
  return page;
}

export async function listInbox(wsId: string) {
  const rows = await db.select({ id: schema.pages.id, title: schema.pages.title, icon: schema.pages.icon, kind: schema.pages.captureKind, inboxAt: schema.pages.inboxAt, updatedAt: schema.pages.updatedAt, wordCount: schema.pages.wordCount, excerpt: dsql<string>`left(${schema.pages.plainText}, 280)`, content: schema.pages.content }).from(schema.pages).where(and(eq(schema.pages.workspaceId, wsId), isNotNull(schema.pages.inboxAt), isNull(schema.pages.deletedAt), eq(schema.pages.archived, false))).orderBy(desc(schema.pages.inboxAt)).limit(300);
  const tags = rows.length ? await db.select({ pageId: schema.pageTags.pageId, name: schema.tags.name }).from(schema.pageTags).innerJoin(schema.tags, eq(schema.tags.id, schema.pageTags.tagId)).where(inArray(schema.pageTags.pageId, rows.map((r) => r.id))) : [];
  return rows.map(({ content, ...r }) => ({ ...r, tags: tags.filter((t) => t.pageId === r.id).map((t) => t.name), url: firstUrl(content as PMNode), image: firstImage(content as PMNode), openTasks: countTasks(content as PMNode) }));
}
export async function inboxCount(wsId: string) { const [r] = await db.select({ n: dsql<number>`count(*)::int` }).from(schema.pages).where(and(eq(schema.pages.workspaceId, wsId), isNotNull(schema.pages.inboxAt), isNull(schema.pages.deletedAt), eq(schema.pages.archived, false))); return r.n; }
function walk(n: PMNode | undefined, f: (n: PMNode) => void) { if (!n) return; f(n); for (const c of n.content ?? []) walk(c, f); }
function firstUrl(doc: PMNode) { let u: string | null = null; walk(doc, (n) => { if (!u) for (const m of n.marks ?? []) if (m.type === "link" && typeof m.attrs?.href === "string") u = m.attrs.href; }); return u; }
function firstImage(doc: PMNode) { let u: string | null = null; walk(doc, (n) => { if (!u && n.type === "image" && typeof n.attrs?.src === "string" && n.attrs.src.startsWith("/api/files/")) u = n.attrs.src; }); return u; }
function countTasks(doc: PMNode) { let c = 0; walk(doc, (n) => { if (n.type === "taskItem" && !n.attrs?.checked) c++; }); return c; }
function taskTitles(doc: PMNode) { const out: string[] = []; walk(doc, (n) => { if (n.type === "taskItem" && !n.attrs?.checked) { const t = docText({ type: "doc", content: n.content ?? [] }).trim(); if (t) out.push(t.slice(0, 500)); } }); return out; }

export type TriageAction = { action: "keep"; section?: string; parentId?: string | null } | { action: "task"; dueAt?: string | null; priority?: "low" | "medium" | "high" } | { action: "database"; databaseId: string } | { action: "reference" } | { action: "archive" } | { action: "trash" };
/** Apply one triage action and journal it. Returns the journal id (for undo) and a short human summary. */
export async function triage(wsId: string, pageId: string, a: TriageAction) {
  const page = await getPage(wsId, pageId);
  if (!page.inboxAt) throw new HttpError(409, "This item is no longer in the inbox", "not_in_inbox");
  const before = { inboxAt: page.inboxAt.toISOString(), archived: page.archived, section: page.section, parentId: page.parentId };
  const created: Record<string, unknown> = {}; let summary = ""; const set: Record<string, unknown> = { inboxAt: null, updatedAt: new Date() };
  if (a.action === "keep") {
    const section = a.section ?? "notes"; if (!["notes", "documents", "projects", "research"].includes(section)) throw new HttpError(400, "Unknown section");
    if (a.parentId) await getPage(wsId, a.parentId);
    set.section = section; set.parentId = a.parentId ?? null; summary = `Filed in ${section}`;
  } else if (a.action === "task") {
    const titles = taskTitles(page.content as PMNode); const list = titles.length ? titles : [page.title];
    const rows = await db.insert(schema.tasks).values(list.map((title) => ({ workspaceId: wsId, title, pageId: page.id, priority: a.priority ?? "medium", dueAt: a.dueAt ? new Date(a.dueAt) : null }))).returning({ id: schema.tasks.id, title: schema.tasks.title });
    await recordEvents(db, rows.map((r) => ({ workspaceId: wsId, kind: "task.created" as const, pageId: page.id, entityKind: "task", entityId: r.id, summary: r.title, data: { via: "inbox" } })));
    created.taskIds = rows.map((r) => r.id); summary = `${rows.length} task${rows.length > 1 ? "s" : ""} created`; // the note stays, linked from the tasks
  } else if (a.action === "database") {
    const d = await ensureDatabase(wsId, a.databaseId);
    const row = await createRow(wsId, d.id, { title: page.title, content: page.content });
    created.rowId = row.id; created.databaseId = d.id; set.archived = true; summary = `Added to ${d.name}`;
  } else if (a.action === "reference") {
    const text = `${page.title}\n${page.plainText}`; const doi = text.match(/\b10\.\d{4,9}\/[^\s"<>]+/)?.[0]?.replace(/[.,;)]+$/, ""); const url = firstUrl(page.content as PMNode);
    let ref: { id: string } | null = null; let existed = false;
    if (doi) { try { const r = await addByDoi(wsId, doi, null); ref = r.reference; existed = r.duplicate; } catch { ref = null; /* Crossref unreachable or unknown DOI: fall back to a plain reference */ } }
    const viaDoi = Boolean(ref); if (!ref) ref = await createReference(wsId, { title: page.title, url: url ?? null, entryType: url ? "misc" : "article", pageId: null, doi: doi ?? null });
    // an already stored DOI returns the existing row: undo must not delete a reference this action did not create
    if (existed) created.existingReferenceId = ref.id; else created.referenceId = ref.id;
    set.archived = true; summary = existed ? "Already in your references" : viaDoi ? "Reference added from DOI" : "Reference added";
  } else if (a.action === "archive") { set.archived = true; summary = "Archived"; }
  else if (a.action === "trash") { await softDeletePage(wsId, pageId); summary = "Moved to trash"; }
  await db.update(schema.pages).set(set as any).where(and(eq(schema.pages.id, pageId), eq(schema.pages.workspaceId, wsId)));
  const [j] = await db.insert(schema.inboxActions).values({ workspaceId: wsId, pageId, action: a.action, before, created }).returning({ id: schema.inboxActions.id });
  await recordEvent(db, { workspaceId: wsId, kind: "capture.filed", pageId, summary: page.title, data: { action: a.action, actionId: j.id, ...(a.action === "keep" ? { section: set.section as string } : {}) } });
  return { actionId: j.id, summary, created };
}
/** Reverse a journaled action: the page returns to the inbox exactly as it was, and what the action created is removed (soft delete where the model has one). */
export async function undoTriage(wsId: string, actionId: string) {
  const [j] = await db.select().from(schema.inboxActions).where(and(eq(schema.inboxActions.id, actionId), eq(schema.inboxActions.workspaceId, wsId)));
  if (!j) throw new HttpError(404, "Action not found"); if (j.undoneAt) return { ok: true, already: true };
  const b = j.before as { inboxAt: string; archived: boolean; section: string; parentId: string | null }; const c = j.created as { taskIds?: string[]; rowId?: string; databaseId?: string; referenceId?: string };
  if (j.action === "trash") await restorePage(wsId, j.pageId);
  if (c.taskIds?.length) await db.update(schema.tasks).set({ deletedAt: new Date() }).where(and(eq(schema.tasks.workspaceId, wsId), inArray(schema.tasks.id, c.taskIds)));
  if (c.rowId && c.databaseId) await deleteRows(wsId, c.databaseId, [c.rowId]).catch(() => {});
  if (c.referenceId) await deleteReference(wsId, c.referenceId);
  await db.update(schema.pages).set({ inboxAt: new Date(b.inboxAt), archived: b.archived, section: b.section, parentId: b.parentId }).where(and(eq(schema.pages.id, j.pageId), eq(schema.pages.workspaceId, wsId)));
  await db.update(schema.inboxActions).set({ undoneAt: new Date() }).where(eq(schema.inboxActions.id, actionId));
  return { ok: true, already: false };
}

// ---------- tags
export async function listTags(wsId: string) {
  return db.select({ id: schema.tags.id, name: schema.tags.name, color: schema.tags.color, // the outer column is written literally: in a single-table select drizzle renders ${schema.tags.id} unqualified, and inside the sub-select a bare "id" binds to pages.id (3.0, defect D-1: every tag counted 0 pages)
    pages: dsql<number>`(select count(*)::int from page_tags pt join pages p on p.id = pt.page_id where pt.tag_id = "tags"."id" and p.deleted_at is null)` }).from(schema.tags).where(eq(schema.tags.workspaceId, wsId)).orderBy(schema.tags.name);
}
export async function setPageTags(wsId: string, pageId: string, names: string[]) {
  await getPage(wsId, pageId);
  const clean = [...new Set(names.map((n) => n.trim().replace(/^#/, "").toLowerCase().slice(0, 40)).filter(Boolean))].slice(0, 20);
  if (clean.length) await db.insert(schema.tags).values(clean.map((name) => ({ workspaceId: wsId, name }))).onConflictDoNothing();
  const rows = clean.length ? await db.select({ id: schema.tags.id, name: schema.tags.name }).from(schema.tags).where(and(eq(schema.tags.workspaceId, wsId), inArray(schema.tags.name, clean))) : [];
  await db.transaction(async (tx) => {
    const before = (await tx.select({ name: schema.tags.name }).from(schema.pageTags).innerJoin(schema.tags, eq(schema.tags.id, schema.pageTags.tagId)).where(eq(schema.pageTags.pageId, pageId))).map((r) => r.name);
    const now = rows.map((r) => r.name); const added = now.filter((n) => !before.includes(n)); const removed = before.filter((n) => !now.includes(n));
    if (!added.length && !removed.length) return; // same set: nothing is rewritten, so the page revision does not move either
    await tx.delete(schema.pageTags).where(eq(schema.pageTags.pageId, pageId)); if (rows.length) await tx.insert(schema.pageTags).values(rows.map((r) => ({ pageId, tagId: r.id })));
    await recordEvents(tx, [...added.map((name) => ({ workspaceId: wsId, kind: "tag.added" as const, pageId, entityKind: "tag", entityId: name, summary: name, data: { tag: name } })), ...removed.map((name) => ({ workspaceId: wsId, kind: "tag.removed" as const, pageId, entityKind: "tag", entityId: name, summary: name, data: { tag: name } }))]);
  });
  return rows.map((r) => r.name).sort();
}
export async function pageTags(pageId: string) { return (await db.select({ name: schema.tags.name }).from(schema.pageTags).innerJoin(schema.tags, eq(schema.tags.id, schema.pageTags.tagId)).where(eq(schema.pageTags.pageId, pageId))).map((r) => r.name).sort(); }
