# Anthropic model benchmarks — Note SPBoucher AI

Generated 2026-11-01T07:18:30.320Z from `benchmarks/results/raw/bench-runs.jsonl` (308 real runs, 2 trials per model × task). Reproduce: `npx tsx benchmarks/scripts/bench.ts` then `npx tsx benchmarks/scripts/report.ts`.

**Protocol.** Streaming requests, provider default reasoning settings, `max_tokens` per task (1.5K–6K). TTFT = first text/tool delta; tok/s = output tokens ÷ (total − TTFT). Tokens are provider-reported; cost = tokens × published list prices (estimate). Deterministic graders for 8 tasks (regex, executed code tests, JSON-schema + field checks, tool-call checks); the three writing/synthesis tasks add a two-judge LLM rubric (claude-sonnet-5-5 + gpt-5.4, 1–5) reported separately and **never mixed into the pass rate**.

## Overall

| Model | Pass rate | Mean score | LLM-judged (1–5) | TTFT med. | Latency med. | tok/s med. | Cost / run | Total cost | Errors |
|---|---|---|---|---|---|---|---|---|---|
| `claude-fable-5-1` | 100% | 1.00 | 5.00 | 389 ms | 2.1 s | 118 | $0.090 | $1.979 | 0/22 |
| `claude-sonnet-5` | 100% | 1.00 | 4.33 | 950 ms | 2.2 s | 145 | $0.019 | $0.416 | 0/22 |
| `claude-sonnet-4-5-20250929` | 100% | 1.00 | 4.33 | 775 ms | 2.3 s | 90 | $0.022 | $0.474 | 0/22 |
| `claude-haiku-5-5` | 100% | 1.00 | 4.83 | 1301 ms | 2.4 s | 487 | $0.0011 | $0.023 | 0/22 |
| `claude-opus-4-5-20251101` | 100% | 1.00 | 4.67 | 862 ms | 2.5 s | 98 | $0.036 | $0.783 | 0/22 |
| `claude-opus-5-5` | 100% | 1.00 | 4.83 | 1703 ms | 2.8 s | 161 | $0.043 | $0.943 | 0/22 |
| `claude-sonnet-5-5` | 100% | 1.00 | 4.67 | 1020 ms | 2.9 s | 202 | $0.020 | $0.432 | 0/22 |
| `claude-opus-4-8` | 100% | 1.00 | 4.67 | 488 ms | 2.9 s | 104 | $0.045 | $0.982 | 0/22 |
| `claude-opus-4-7` | 100% | 1.00 | 4.33 | 687 ms | 3.3 s | 91 | $0.045 | $0.982 | 0/22 |
| `claude-opus-5` | 100% | 1.00 | 4.67 | 2530 ms | 4.0 s | 161 | $0.051 | $1.116 | 0/22 |
| `claude-opus-4-6` | 100% | 1.00 | 4.83 | 1622 ms | 4.2 s | 75 | $0.035 | $0.776 | 0/22 |
| `claude-sonnet-4-6` | 100% | 1.00 | 5.00 | 735 ms | 4.7 s | 90 | $0.021 | $0.466 | 0/22 |
| `claude-haiku-4-5-20251001` | 91% | 0.97 | 3.33 | 502 ms | 2.0 s | 135 | $0.0072 | $0.159 | 0/22 |
| `claude-fable-5` | 91% | 0.91 | 5.00 | 1764 ms | 2.8 s | 112 | $0.092 | $2.022 | 0/22 |

## Pass rate by task

| Model | Document analysis | JSON generation | Complex reasoning | Long-context retrieval | English writing | French writing | Programming | Simple reasoning | Knowledge synthesis | Tool calling | Mathematics |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `claude-fable-5-1` | 100% | 100% | 100% | 100% | 100% (j 5.0) | 100% (j 5.0) | 100% | 100% | 100% (j 5.0) | 100% | 100% |
| `claude-sonnet-5` | 100% | 100% | 100% | 100% | 100% (j 5.0) | 100% (j 5.0) | 100% | 100% | 100% (j 3.0) | 100% | 100% |
| `claude-sonnet-4-5-20250929` | 100% | 100% | 100% | 100% | 100% (j 5.0) | 100% (j 5.0) | 100% | 100% | 100% (j 3.0) | 100% | 100% |
| `claude-haiku-5-5` | 100% | 100% | 100% | 100% | 100% (j 5.0) | 100% (j 4.5) | 100% | 100% | 100% (j 5.0) | 100% | 100% |
| `claude-opus-4-5-20251101` | 100% | 100% | 100% | 100% | 100% (j 5.0) | 100% (j 5.0) | 100% | 100% | 100% (j 4.0) | 100% | 100% |
| `claude-opus-5-5` | 100% | 100% | 100% | 100% | 100% (j 5.0) | 100% (j 5.0) | 100% | 100% | 100% (j 4.5) | 100% | 100% |
| `claude-sonnet-5-5` | 100% | 100% | 100% | 100% | 100% (j 5.0) | 100% (j 5.0) | 100% | 100% | 100% (j 4.0) | 100% | 100% |
| `claude-opus-4-8` | 100% | 100% | 100% | 100% | 100% (j 5.0) | 100% (j 5.0) | 100% | 100% | 100% (j 4.0) | 100% | 100% |
| `claude-opus-4-7` | 100% | 100% | 100% | 100% | 100% (j 5.0) | 100% (j 5.0) | 100% | 100% | 100% (j 3.0) | 100% | 100% |
| `claude-opus-5` | 100% | 100% | 100% | 100% | 100% (j 5.0) | 100% (j 5.0) | 100% | 100% | 100% (j 4.0) | 100% | 100% |
| `claude-opus-4-6` | 100% | 100% | 100% | 100% | 100% (j 5.0) | 100% (j 5.0) | 100% | 100% | 100% (j 4.5) | 100% | 100% |
| `claude-sonnet-4-6` | 100% | 100% | 100% | 100% | 100% (j 5.0) | 100% (j 5.0) | 100% | 100% | 100% (j 5.0) | 100% | 100% |
| `claude-haiku-4-5-20251001` | 100% | 100% | 100% | 100% | 100% (j 4.0) | 100% (j 3.5) | 100% | 0% | 100% (j 2.5) | 100% | 100% |
| `claude-fable-5` | 100% | 100% | 100% | 0% | 100% (j 5.0) | 100% (j 5.0) | 100% | 100% | 100% (j 5.0) | 100% | 100% |

## Median latency by task (seconds)

| Model | Document analysis | JSON generation | Complex reasoning | Long-context retrieval | English writing | French writing | Programming | Simple reasoning | Knowledge synthesis | Tool calling | Mathematics |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `claude-fable-5-1` | 1.6 | 1.6 | 5.2 | 1.4 | 7.0 | 7.6 | 2.1 | 0.7 | 8.2 | 1.6 | 2.5 |
| `claude-sonnet-5` | 1.7 | 1.9 | 11.1 | 1.6 | 6.3 | 7.2 | 1.8 | 1.2 | 4.9 | 1.5 | 4.1 |
| `claude-sonnet-4-5-20250929` | 1.9 | 1.8 | 10.6 | 2.1 | 6.4 | 8.1 | 2.3 | 1.1 | 7.2 | 1.7 | 7.7 |
| `claude-haiku-5-5` | 3.3 | 1.3 | 4.9 | 2.4 | 2.7 | 7.8 | 0.9 | 0.7 | 5.3 | 0.9 | 2.1 |
| `claude-opus-4-5-20251101` | 1.7 | 1.4 | 9.2 | 2.1 | 6.9 | 7.3 | 2.5 | 1.2 | 7.5 | 1.7 | 6.3 |
| `claude-opus-5-5` | 1.8 | 2.4 | 6.1 | 2.3 | 15.5 | 18.4 | 2.6 | 1.3 | 5.9 | 1.9 | 3.8 |
| `claude-sonnet-5-5` | 2.0 | 2.2 | 5.1 | 2.3 | 4.6 | 10.0 | 4.4 | 1.2 | 3.7 | 1.6 | 2.9 |
| `claude-opus-4-8` | 3.2 | 2.0 | 5.2 | 2.2 | 7.5 | 9.6 | 1.9 | 0.7 | 5.6 | 1.7 | 3.1 |
| `claude-opus-4-7` | 3.3 | 2.6 | 4.5 | 3.0 | 8.5 | 11.9 | 1.8 | 0.9 | 6.5 | 1.9 | 4.0 |
| `claude-opus-5` | 3.3 | 2.3 | 8.8 | 2.7 | 14.5 | 22.2 | 7.1 | 2.5 | 9.9 | 2.4 | 4.0 |
| `claude-opus-4-6` | 3.7 | 4.0 | 12.8 | 2.8 | 8.6 | 9.2 | 3.7 | 1.7 | 8.8 | 2.9 | 6.3 |
| `claude-sonnet-4-6` | 4.5 | 3.4 | 10.3 | 2.7 | 7.5 | 8.0 | 2.6 | 1.2 | 7.6 | 1.8 | 5.5 |
| `claude-haiku-4-5-20251001` | 1.9 | 1.5 | 7.5 | 1.0 | 3.2 | 3.7 | 1.9 | 0.6 | 3.1 | 1.2 | 4.6 |
| `claude-fable-5` | 2.0 | 2.8 | 8.8 | 1.7 | 8.4 | 9.3 | 2.8 | 2.1 | 8.0 | 2.7 | 4.9 |

## Mean cost by task (USD)

| Model | Document analysis | JSON generation | Complex reasoning | Long-context retrieval | English writing | French writing | Programming | Simple reasoning | Knowledge synthesis | Tool calling | Mathematics |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `claude-fable-5-1` | $0.016 | $0.010 | $0.026 | $0.810 | $0.022 | $0.028 | $0.011 | $0.0028 | $0.037 | $0.014 | $0.012 |
| `claude-sonnet-5` | $0.0034 | $0.0020 | $0.013 | $0.162 | $0.0049 | $0.0067 | $0.0022 | $0.0011 | $0.0052 | $0.0029 | $0.0046 |
| `claude-sonnet-4-5-20250929` | $0.0040 | $0.0024 | $0.013 | $0.185 | $0.0039 | $0.0060 | $0.0029 | $0.0007 | $0.0049 | $0.0042 | $0.0096 |
| `claude-haiku-5-5` | $0.0002 | $0.0001 | $0.0006 | $0.0082 | $0.0002 | $0.0011 | $0.0001 | $0.0001 | $0.0006 | $0.0001 | $0.0002 |
| `claude-opus-4-5-20251101` | $0.0067 | $0.0037 | $0.018 | $0.309 | $0.0069 | $0.010 | $0.0047 | $0.0012 | $0.0091 | $0.0071 | $0.014 |
| `claude-opus-5-5` | $0.0064 | $0.0041 | $0.015 | $0.324 | $0.039 | $0.049 | $0.0059 | $0.0019 | $0.012 | $0.0053 | $0.0092 |
| `claude-sonnet-5-5` | $0.0032 | $0.0020 | $0.0080 | $0.162 | $0.0050 | $0.017 | $0.0076 | $0.0006 | $0.0049 | $0.0027 | $0.0034 |
| `claude-opus-4-8` | $0.0080 | $0.0051 | $0.013 | $0.405 | $0.012 | $0.014 | $0.0049 | $0.0014 | $0.013 | $0.0070 | $0.0081 |
| `claude-opus-4-7` | $0.0081 | $0.0052 | $0.010 | $0.405 | $0.012 | $0.015 | $0.0047 | $0.0015 | $0.012 | $0.0090 | $0.0076 |
| `claude-opus-5` | $0.0080 | $0.0051 | $0.018 | $0.405 | $0.026 | $0.047 | $0.012 | $0.0027 | $0.018 | $0.0074 | $0.0087 |
| `claude-opus-4-6` | $0.0067 | $0.0037 | $0.018 | $0.309 | $0.0069 | $0.010 | $0.0045 | $0.0012 | $0.0088 | $0.0074 | $0.011 |
| `claude-sonnet-4-6` | $0.0040 | $0.0022 | $0.011 | $0.185 | $0.0043 | $0.0059 | $0.0029 | $0.0007 | $0.0054 | $0.0044 | $0.0070 |
| `claude-haiku-4-5-20251001` | $0.0014 | $0.0007 | $0.0048 | $0.062 | $0.0014 | $0.0018 | $0.0011 | $0.0002 | $0.0015 | $0.0014 | $0.0029 |
| `claude-fable-5` | $0.017 | $0.011 | $0.041 | $0.809 | $0.026 | $0.030 | $0.0092 | $0.0027 | $0.032 | $0.014 | $0.020 |

## Token usage

| Model | Input tokens | Output tokens | of which reasoning |
|---|---|---|---|
| `claude-fable-5-1` | 168774 | 5817 | 709 |
| `claude-sonnet-5` | 168866 | 7802 | 2116 |
| `claude-sonnet-4-5-20250929` | 129532 | 5724 | 0 |
| `claude-haiku-5-5` | 168774 | 12487 | 6979 |
| `claude-opus-4-5-20251101` | 129532 | 5424 | 0 |
| `claude-opus-5-5` | 168774 | 13381 | 7584 |
| `claude-sonnet-5-5` | 168774 | 9494 | 2881 |
| `claude-opus-4-8` | 168738 | 5530 | 0 |
| `claude-opus-4-7` | 169618 | 5347 | 0 |
| `claude-opus-5` | 168730 | 10889 | 5458 |
| `claude-opus-4-6` | 129538 | 5116 | 0 |
| `claude-sonnet-4-6` | 129538 | 5170 | 0 |
| `claude-haiku-4-5-20251001` | 129532 | 5798 | 0 |
| `claude-fable-5` | 168738 | 6695 | 1105 |
