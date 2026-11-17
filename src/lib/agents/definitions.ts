/** The fixed catalogue of agent tasks. Adding a task = adding an entry here (scope, tools, caps) — there is no free-form agent. */
import type { AgentDef, AgentInfo, RunLimits } from "./types";

const BASE = `You operate INSIDE the owner's private notes workspace (Note SPBoucher AI) on ONE fixed task. You can only act through the tools listed; you have no shell, no network, no search and no memory beyond this run.
Rules:
- You never modify anything: the propose_* tools only record suggestions that the owner will review one by one. Never say a change was made.
- Use only ids returned by the tools. Never invent pages, tags, references, quotes or numbers.
- Be economical: few precise tool calls, then stop.
- Write rationales in one short sentence, in the language of the content concerned (French or English).
- Finish with a short plain-text summary of what you proposed (or "No proposals").`;
const limits = (o: Partial<RunLimits> = {}): RunLimits => ({ maxToolCalls: 30, maxTurns: 8, maxTokens: 120_000, maxCostUsd: 0.75, timeoutMs: 300_000, maxProposals: 30, ...o });
const NEVER = ["Change, move or delete anything without your approval", "Use the network or a shell", "Read anything outside the scope above"];

export const AGENTS: AgentDef[] = [
  {
    id: "sort_inbox", name: "Sort my inbox", icon: "📥", page: "none", description: "For each item waiting in the inbox, proposes where to file it, which tags to add, or to archive it.",
    task: "Sort the inbox: call list_inbox and list_tags, read an item only when its excerpt is not enough, then call propose_inbox_triage once per item you can decide (skip the ones you cannot).",
    system: `${BASE}\nTask: inbox triage. For each inbox item propose ONE of: keep (filed in a section: notes, documents, projects or research), archive, or trash. Add at most 3 tags per item, reusing existing tags whenever one fits. Propose trash only for empty, test or exact-duplicate captures — when in doubt, archive or skip.`,
    tools: ["list_inbox", "list_tags", "read_page", "propose_inbox_triage"], scopes: ["read:inbox", "read:tags", "propose:triage"],
    reads: ["The items currently in your inbox (title and text, up to 25 items)", "The names of your existing tags"], proposes: ["A section, tags, archive or trash for each inbox item"], never: NEVER, limits: limits({ maxToolCalls: 40 }),
  },
  {
    id: "suggest_tags", name: "Suggest tags", icon: "🏷️", page: "optional", description: "Proposes tags for the open page, or for your recent untagged pages when no page is chosen.",
    task: "Suggest tags: call list_tags and list_candidate_pages, read the candidates you need, then call propose_tags once per page that deserves tags.",
    system: `${BASE}\nTask: tagging. Propose 1 to 4 tags per page. Reuse existing tags whenever one fits; create a new tag only for a clear recurring topic. Tags are short, lower-case, without "#".`,
    tools: ["list_tags", "list_candidate_pages", "read_page", "propose_tags"], scopes: ["read:page", "read:untagged", "read:tags", "propose:tags"],
    reads: ["The chosen page — or, without one, your 12 most recently edited pages that have no tag", "The names of your existing tags"], proposes: ["Tags to add to each of those pages (existing tags are kept)"], never: NEVER, limits: limits({ maxToolCalls: 20 }),
  },
  {
    id: "plan_from_page", name: "Make a plan from this page", icon: "🗺️", page: "required", description: "Turns the chosen page into a concrete plan: a new sub-page with a checklist, or a checklist added at the end of the page.",
    task: "Make a plan from the context page: read it with read_page, then propose EITHER one new plan page (propose_new_page: goal, steps as a `- [ ]` checklist in order, open questions) OR a short checklist appended to the page (propose_page_append) when the page is small and already a plan.",
    system: `${BASE}\nTask: planning. Build the plan only from what the page says (commitments, deadlines, open actions). Steps are concrete and ordered; keep dates and names exactly as written; do not invent steps the page does not support.`,
    tools: ["read_page", "propose_new_page", "propose_page_append"], scopes: ["read:page", "propose:page"],
    reads: ["The text of the chosen page only"], proposes: ["One new sub-page containing the plan, or a checklist added at the end of the page"], never: NEVER, limits: limits({ maxToolCalls: 6, maxTurns: 5, maxProposals: 2 }),
  },
  {
    id: "check_references", name: "Check references", icon: "📚", page: "none", description: "Flags references with missing fields or a DOI that is malformed or was never verified, and proposes a fix-up task for each.",
    task: "Check the references: call list_references (it returns only entries with detected problems), then call propose_task once per flagged reference with a title that names the reference and what to fix. Do not propose anything for entries without problems.",
    system: `${BASE}\nTask: reference hygiene. The problems are computed by the tool — report them as given, do not guess missing values and do not claim a DOI is valid or invalid beyond what the tool states (you cannot reach Crossref).`,
    tools: ["list_references", "propose_task"], scopes: ["read:references", "propose:tasks"],
    reads: ["The bibliographic fields of your references (title, authors, year, journal, DOI, verification status) — not your notes"], proposes: ["One task per reference that needs fixing"], never: [...NEVER, "Check a DOI online: only its format and its stored verification status are examined"], limits: limits({ maxToolCalls: 32, maxTurns: 6 }),
  },
];
export const AGENT_BY_ID = Object.fromEntries(AGENTS.map((a) => [a.id, a])) as Record<string, AgentDef | undefined>;
export const agentInfo = (a: AgentDef): AgentInfo => ({ id: a.id, name: a.name, icon: a.icon, description: a.description, tools: a.tools, scopes: a.scopes, reads: a.reads, proposes: a.proposes, never: a.never, page: a.page, limits: a.limits });
