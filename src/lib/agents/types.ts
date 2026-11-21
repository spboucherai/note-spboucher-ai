/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/lib/agents/types.ts
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
 * Bounded agents — shared types (no imports: safe for client components).
 * An agent is one task from a FIXED catalogue. It can only read what its scope lists, through a fixed tool allow-list (no shell, no
 * network, no search), and it can only PROPOSE: nothing is written to the workspace until the owner approves a proposal, and every
 * applied proposal can be undone.
 */
export type AgentId = "sort_inbox" | "suggest_tags" | "plan_from_page" | "check_references";
export type Scope = "read:inbox" | "read:page" | "read:untagged" | "read:tags" | "read:references" | "propose:triage" | "propose:tags" | "propose:page" | "propose:tasks";
/** Hard caps of one run. Reaching any of them ends the run; the timeout marks it failed. */
export interface RunLimits { maxToolCalls: number; maxTurns: number; maxTokens: number; maxCostUsd: number; timeoutMs: number; maxProposals: number }
export interface AgentDef {
  id: AgentId; name: string; icon: string; description: string;
  /** Fixed instruction given to the model — the owner does not type a prompt. */
  task: string; system: string; tools: string[]; scopes: Scope[];
  /** Shown to the owner before launch. */
  reads: string[]; proposes: string[]; never: string[];
  page: "required" | "optional" | "none"; limits: RunLimits;
}
/** What the catalogue exposes to the browser (no prompts). */
export type AgentInfo = Pick<AgentDef, "id" | "name" | "icon" | "description" | "tools" | "scopes" | "reads" | "proposes" | "never" | "page" | "limits">;

export type ProposalKind = "inbox_triage" | "tags" | "new_page" | "page_edit" | "task";
export type ProposalStatus = "proposed" | "applied" | "rejected" | "failed" | "undone";
/** One side of the before → after preview. Built by the server from the real data, never from the model's description of it. */
export interface Preview { label: string; lines: string[]; markdown?: string }
export interface ProposalBase {
  idx: number; tool: string; kind: ProposalKind; rationale: string; title: string; destructive: boolean; status: ProposalStatus;
  pageId: string | null; before: Preview | null; after: Preview;
  at: string; decidedAt?: string; appliedAt?: string; undoneAt?: string; error?: string; result?: Record<string, unknown>; undo?: Record<string, unknown>;
}
export interface TriageProposal extends ProposalBase { kind: "inbox_triage"; payload: { pageId: string; action: "keep" | "archive" | "trash"; section: string | null; tags: string[] } }
export interface TagsProposal extends ProposalBase { kind: "tags"; payload: { pageId: string; add: string[] } }
export interface NewPageProposal extends ProposalBase { kind: "new_page"; payload: { parentId: string | null; title: string; markdown: string } }
export interface PageEditProposal extends ProposalBase { kind: "page_edit"; payload: { pageId: string; mode: "append"; markdown: string; baseVersion: number } }
export interface TaskProposal extends ProposalBase { kind: "task"; payload: { title: string; priority: "low" | "medium" | "high"; dueAt: string | null; pageId: string | null } }
export type Proposal = TriageProposal | TagsProposal | NewPageProposal | PageEditProposal | TaskProposal;

/** One line of the execution log. `input`/`output` hold ids, counts and enum values only — never note text. */
export interface ToolStep { tool: string; input: Record<string, unknown>; output: Record<string, unknown>; at: string; ms?: number; error?: string; proposalIdx?: number }
export const LIVE_STATUSES = ["pending", "running"];
