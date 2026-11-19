/**
 * file: src/lib/client/inbox-suggest.ts
 * description: pure logic of the Smart Inbox checklist (SPEC §4.12). The server proposes (`GET /api/inbox/<id>/suggestions`); the
 *   owner ticks what to keep, may edit the title and the summary, and only that subset is sent (`POST /api/inbox/<id>/apply`).
 *   Here: the selection model, the request body built from it, the wording of the errors. No React, no network — unit-tested in
 *   tests/unit/next-p-cv-inbox.test.ts.
 * author: Simon-Pierre Boucher — contact@spboucher.ai
 */
export type Section = "notes" | "documents" | "projects" | "research";
export interface Suggestions {
  title: { value: string; current: string } | null;
  tags: { name: string; existing: boolean }[];
  destination: { section: Section; parentId: string | null; parentTitle: string | null } | null;
  relations: { pageId: string; title: string; icon: string | null; reason: string }[];
  summary: string | null;
}
export interface SuggestionResult { pageId: string; status: "ready" | "empty"; ai: boolean; model: string | null; provider: string | null; generatedAt: string | null; cached: boolean; contentHash: string; costUsd: number | null; suggestions: Suggestions }
export interface ApplyBody { title?: string; tags?: string[]; destination?: { section?: Section; parentId?: string | null }; relations?: { pageId: string; reason?: string }[]; summary?: string }
export interface ApplyResult { actionId: string; summary: string; applied: string[]; filed: boolean; created: Record<string, unknown> }

/** What the owner ticked. Nothing is ticked at the start: an AI suggestion is never applied without an explicit choice. */
export interface Choice { title: boolean; titleValue: string; tags: Record<string, boolean>; destination: boolean; relations: Record<string, boolean>; summary: boolean; summaryValue: string }
export const emptyChoice = (s: Suggestions): Choice => ({ title: false, titleValue: s.title?.value ?? "", tags: {}, destination: false, relations: {}, summary: false, summaryValue: s.summary ?? "" });
export const SECTION_LABEL: Record<Section, string> = { notes: "Notes", documents: "Documents", projects: "Projects", research: "Research" };
export const destinationLabel = (d: NonNullable<Suggestions["destination"]>) => (d.parentTitle ? `${SECTION_LABEL[d.section] ?? d.section} › ${d.parentTitle}` : SECTION_LABEL[d.section] ?? d.section);
/** Number of suggestions offered (each tag and each related page counts for one). */
export const countOffered = (s: Suggestions) => (s.title ? 1 : 0) + s.tags.length + (s.destination ? 1 : 0) + s.relations.length + (s.summary ? 1 : 0);
export const hasSuggestions = (s: Suggestions) => countOffered(s) > 0;
/** Number of ticked suggestions that would really be sent (an emptied title or summary does not count). */
export function countChosen(s: Suggestions, c: Choice): number {
  return (s.title && c.title && c.titleValue.trim() ? 1 : 0) + s.tags.filter((t) => c.tags[t.name]).length + (s.destination && c.destination ? 1 : 0) + s.relations.filter((r) => c.relations[r.pageId]).length + (s.summary && c.summary && c.summaryValue.trim() ? 1 : 0);
}
export function selectAll(s: Suggestions, c: Choice, on: boolean): Choice {
  return { ...c, title: on && Boolean(s.title), tags: Object.fromEntries(s.tags.map((t) => [t.name, on])), destination: on && Boolean(s.destination), relations: Object.fromEntries(s.relations.map((r) => [r.pageId, on])), summary: on && Boolean(s.summary) };
}
/** Body of `POST /api/inbox/<id>/apply`: only the ticked keys, with the owner's edits. Null when nothing is ticked. */
export function buildApplyBody(s: Suggestions, c: Choice): ApplyBody | null {
  const body: ApplyBody = {};
  if (s.title && c.title && c.titleValue.trim()) body.title = c.titleValue.replace(/\s+/g, " ").trim().slice(0, 300);
  const tags = s.tags.filter((t) => c.tags[t.name]).map((t) => t.name); if (tags.length) body.tags = tags.slice(0, 10);
  if (s.destination && c.destination) body.destination = { section: s.destination.section, parentId: s.destination.parentId };
  const relations = s.relations.filter((r) => c.relations[r.pageId]).map((r) => ({ pageId: r.pageId, ...(r.reason ? { reason: r.reason.slice(0, 300) } : {}) })); if (relations.length) body.relations = relations.slice(0, 10);
  if (s.summary && c.summary && c.summaryValue.trim()) body.summary = c.summaryValue.replace(/\s+/g, " ").trim().slice(0, 1000);
  return Object.keys(body).length ? body : null;
}
/** Human wording of a failed suggestion or apply call (`code` and `status` of the API error). */
export function suggestionError(e: { status?: number; code?: string; message?: string } | null | undefined): { title: string; hint: string; retry: boolean } {
  const code = e?.code; const status = e?.status ?? 0;
  if (status === 0) return { title: "No connection", hint: "Suggestions need the network. Nothing was changed.", retry: true };
  if (code === "no_model" || status === 503) return { title: "No AI model is available", hint: "No provider key is configured on the server, or no model fits this task. You can still file this capture by hand.", retry: false };
  if (code === "refused") return { title: "The model declined this capture", hint: "Nothing is suggested. You can still file it by hand.", retry: true };
  if (code === "bad_output" || code === "provider_error" || status === 502) return { title: "The AI provider failed", hint: e?.message || "Nothing is suggested. Try again in a moment.", retry: true };
  if (code === "not_in_inbox") return { title: "This item is no longer in the inbox", hint: "It was filed or archived meanwhile.", retry: false };
  if (code === "conflict" || status === 409) return { title: "The capture changed meanwhile", hint: "Ask for suggestions again: they are computed from its current text.", retry: true };
  if (code === "nothing_to_apply") return { title: "Nothing was chosen", hint: "Tick at least one suggestion.", retry: false };
  if (code === "bad_destination" || code === "bad_relation" || code === "bad_section") return { title: "A suggested page no longer exists", hint: "Ask for suggestions again.", retry: true };
  return { title: "Suggestions could not be loaded", hint: e?.message || "Nothing was changed.", retry: true };
}
