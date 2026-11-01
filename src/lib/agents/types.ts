/** Controlled agent framework — shared types. Agents never write directly (except a single draft page); everything else is a proposal awaiting human approval. */
export type Scope = "read:pages" | "read:search" | "write:pages" | "write:tasks" | "write:links" | "write:properties";
export const ALL_SCOPES: Scope[] = ["read:pages", "read:search", "write:pages", "write:tasks", "write:links", "write:properties"];
export const READ_SCOPES: Scope[] = ["read:pages", "read:search"];
export const SCOPE_LABELS: Record<Scope, string> = {
  "read:pages": "Read pages", "read:search": "Search the workspace",
  "write:pages": "Create draft pages (under “AI drafts”)", "write:tasks": "Tasks (proposals)", "write:links": "Links (proposals)", "write:properties": "Page properties (proposals)",
};

export type AgentId = "research_assistant" | "document_organizer" | "graph_curator" | "writing_assistant" | "database_analyst" | "planning_assistant";
export interface AgentDef { id: AgentId; name: string; description: string; icon: string; system: string; tools: string[]; defaultScopes: Scope[]; allowedScopes: Scope[] }

export type ProposalKind = "page_edit" | "task" | "link" | "property";
export interface ProposalBase { idx: number; tool: string; kind: ProposalKind; scope: Scope; scopeGranted: boolean; rationale: string; status: "proposed" | "approved" | "rejected" | "applied" | "failed"; at: string; decidedAt?: string; appliedAt?: string; error?: string; result?: unknown }
export interface PageEditProposal extends ProposalBase { kind: "page_edit"; payload: { pageId: string; pageTitle: string; mode: "append" | "replace"; markdown: string; currentMarkdown: string } }
export interface TaskProposal extends ProposalBase { kind: "task"; payload: { title: string; priority: "low" | "medium" | "high"; dueAt: string | null; pageId: string | null; pageTitle: string | null; project: string | null } }
export interface LinkProposal extends ProposalBase { kind: "link"; payload: { fromPageId: string; fromTitle: string; toPageId: string; toTitle: string; relation: string; confidence: number | null } }
export interface PropertyProposal extends ProposalBase { kind: "property"; payload: { pageId: string; pageTitle: string; key: string; value: unknown; previous: unknown } }
export type Proposal = PageEditProposal | TaskProposal | LinkProposal | PropertyProposal;

export interface ToolStep { tool: string; input: unknown; output?: unknown; at: string; ms?: number; error?: string; proposalIdx?: number }
export interface RunLimits { maxToolCalls: number; maxTokens: number; maxCostUsd: number; maxTurns: number }
export const DEFAULT_LIMITS: RunLimits = { maxToolCalls: 12, maxTokens: 200_000, maxCostUsd: 1.5, maxTurns: 14 };
