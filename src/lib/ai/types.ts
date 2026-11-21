/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/lib/ai/types.ts
 * Module           : lib
 * Repository       : https://git.spboucher.ai/note-spboucher-ai
 * Project Website  : https://note.spboucher.ai
 * Created          : 2026-11-01
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

/** Provider id = a row of `ai_providers`. The two native ones are literal; OpenAI-compatible routes (openrouter, maclustr, …) are open-ended. */
export type Provider = "openai" | "anthropic" | "openrouter" | "maclustr" | (string & {});
export type TaskClass = "chat" | "quick" | "write" | "reason" | "deep" | "code" | "extract" | "longctx" | "agent" | "judge";
export type Effort = "low" | "medium" | "high";
export interface ChatMessage { role: "user" | "assistant"; content: string; images?: { mime: string; dataBase64: string }[] }
export interface ToolDef { name: string; description: string; parameters: Record<string, unknown> }
export interface AICallOptions {
  model: string; provider: Provider;
  system?: string; messages: ChatMessage[];
  maxTokens?: number; effort?: Effort;
  jsonSchema?: { name: string; schema: Record<string, unknown> };
  tools?: ToolDef[];
  signal?: AbortSignal; timeoutMs?: number;
}
export type AIEvent =
  | { type: "text"; delta: string }
  | { type: "tool_call"; id: string; name: string; args: unknown }
  | { type: "done"; usage: AIUsage; stop: string | null; ttftMs: number | null; totalMs: number; refusal?: string }
  | { type: "error"; message: string; status?: number };
export interface AIUsage { inputTokens: number; outputTokens: number; cachedTokens: number; reasoningTokens: number }
export interface AIResult { text: string; toolCalls: { id: string; name: string; args: unknown }[]; usage: AIUsage; stop: string | null; ttftMs: number | null; totalMs: number; costUsd: number | null; model: string; provider: Provider; refusal?: string }
