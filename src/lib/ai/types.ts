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
