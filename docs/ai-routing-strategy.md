# AI routing strategy — Note SPBoucher AI

Decided 2026-11-01 from the Phase Zero measurements (`docs/ai-model-comparison.md`, 836 real runs, 38 models, 2 trials per cell; `benchmarks/results/summary.json`). Every rule below cites measured numbers; nothing is inferred from marketing material. The table is **seeded into `ai_models`** and the router reads it from the database, so the app never hard-codes a model id: when a model disappears from `GET /v1/models` the router falls through to the next candidate.

## 1. Measured facts that drive the policy

| Fact | Evidence |
|---|---|
| 27 of 38 models pass every deterministic task; the suite separates models mainly on **latency, cost and writing quality**, not raw correctness. | `ai-model-comparison.md` ranking |
| `claude-haiku-5-5` is the value outlier: 100 % pass, judged 4.83/5, $0.0011 per run, 487 tok/s. | overall table |
| `gpt-6-sol` is the best *cheap* writer: 100 % pass, judged 5.00 (FR+EN+synthesis), 1.7 s median, $0.0075 per run. | writing table |
| `claude-fable-5-1` is the quality/latency leader (100 %, judged 5.00, **TTFT 389 ms**, 2.1 s) but costs 12× `gpt-6-sol` ($0.090 per run). | overall table |
| `gpt-5.3-codex` is the fastest perfect coder (1.4 s, $0.0115). | programming column |
| Three models **refused the long-context retrieval task** because the needle was phrased as an "access code" (`gpt-5.6-terra`, `gpt-6-luna`, `claude-fable-5`): safety-classifier refusals are a real routing risk for RAG over private notes. | long-context failures |
| GPT-5 (base), `gpt-5-mini`, `gpt-5-nano`: correct but 4–6 s TTFT because of hidden reasoning; unsuitable for interactive editing. | TTFT column |
| `gpt-4o`, `gpt-4o-mini`, `gpt-4.1-mini`, `gpt-5.4-nano`, `claude-haiku-4-5`: cheapest tier but fail simple reasoning or ignore writing constraints — excluded from automatic routing. | pass-by-task tables |
| Pro-tier models (`gpt-5.5-pro`, `gpt-5.4-pro`, `gpt-5.2-pro`, `gpt-5-pro`, `o3-pro`) passed discovery but were not benchmarked ($20–30 per M input, 20–50 s per answer): manual selection only. | discovery doc |
| Structured output and tool calling: 100 % across all routed models (JSON validity 100 %, tool args 100 %). | JSON / tool columns |

## 2. Task classes and default routes

| Task class (router key) | Primary (measured reason) | Fallback | Effort / notes |
|---|---|---|---|
| `chat` — conversational Q&A over the workspace (RAG) | `gpt-6-sol` (100 %, judged 5.00, 1.7 s, $0.0075) | `claude-sonnet-5-5` (100 %, 1M context, 202 tok/s) | medium; citations required |
| `quick` — titles, tags, AI properties, short summaries, classification | `claude-haiku-5-5` (100 %, $0.0011, 487 tok/s) | `gpt-5.4-mini` (1.2 s, $0.0029) | low |
| `write` — drafting, rewriting, translation (FR/EN) | `gpt-6-sol` (judged 5.00 FR+EN) | `claude-sonnet-4-6` (judged 5.00, slower 4.7 s) | medium |
| `reason` — complex reasoning, maths, contradiction finding | `claude-opus-5-5` (100 %, 4.83, $0.043, 2.8 s) | `gpt-6-astra` (100 %, 5.00, $0.037, 3.1 s) | high |
| `deep` — research synthesis, literature review, "think hard" mode | `claude-fable-5-1` (100 %, 5.00, TTFT 389 ms) | `gpt-6-astra` | high; user-visible cost warning |
| `code` — code generation, formulas, scripts | `gpt-5.3-codex` (100 %, 1.4 s, $0.0115) | `claude-sonnet-5-5` | medium |
| `extract` — JSON extraction from documents, structured generation | `gpt-5.4-mini` (100 % JSON/doc, 1.2 s) | `claude-haiku-5-5` | low; strict JSON schema |
| `longctx` — answers over > 60K tokens of context | `gpt-6.1-terra` (100 %, 1.05M ctx, $0.0037) | `claude-sonnet-5-5` (1M ctx) | never `gpt-5.6-terra`, `gpt-6-luna`, `claude-fable-5` (refusals) |
| `agent` — multi-step tool loops | `claude-sonnet-5-5` (tool use 100 %, 1M ctx) | `gpt-5.4` | medium; approval gates |
| `judge` — grading/validation of AI output | `claude-haiku-5-5` | `gpt-5.4-mini` | low |
| `embed` — embeddings | `text-embedding-3-small` (1536-d, $0.02/M) | — | index versioned by model id |

The user can override any route (per request or as a preference), or pin a model per conversation. "Auto" picks the primary if it is **available** (present in the live catalogue and `probes.text = ok`), otherwise the fallback, otherwise the best remaining model for the class by measured score → latency → cost.

## 3. Candidate filter and tie-break (implemented in `src/lib/ai/router.ts`)

1. Candidates = enabled models of enabled providers with `probes.text = ok`, plus `tool_use = ok` if tools are sent, `structured_output = ok` if a schema is sent, `vision = ok` if images are attached, `context_window ≥ estimated tokens × 1.2`.
2. Score = measured pass rate on the benchmark categories mapped to the class (e.g. `write` → French + English writing + judged score; `reason` → complex reasoning + mathematics; `extract` → JSON + document analysis + tool calling).
3. Ties → lower median latency → lower $/run.
4. Refusal handling: a `refusal` stop reason (Anthropic) or a credential-style refusal text (OpenAI) triggers one retry on the fallback model and is logged in `ai_usage.error`.
5. Budget guard: a per-day spend ceiling (setting `ai.daily_budget_usd`, default $20) downgrades `deep` → `reason` → `chat` when exceeded.

## 4. Re-benchmarking

`pnpm bench:discover && pnpm bench:run && pnpm bench:report && pnpm seed:ai` refreshes the catalogue, probes, benchmark table and the in-app dashboard. Re-run when a provider announces a model, at least quarterly, or when the daily usage report shows a route failing.
