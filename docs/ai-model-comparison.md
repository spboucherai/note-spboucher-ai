# AI model comparison — Note SPBoucher AI

Generated 2026-11-01T07:18:30.320Z. 836 real runs across 38 models; total estimated spend for Phase Zero ≈ $17.24.

## Ranking (deterministic mean score, then latency)

| # | Model | Provider | Pass | Score | Judged | TTFT | Latency | tok/s | $/run |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `chat-latest` | openai | 100% | 1.00 | 5.00 | 741 ms | 1.4 s | 157 | $0.019 |
| 2 | `gpt-5.3-codex` | openai | 100% | 1.00 | 4.67 | 602 ms | 1.4 s | 94 | $0.012 |
| 3 | `gpt-4.1` | openai | 100% | 1.00 | 4.17 | 450 ms | 1.7 s | 163 | $0.012 |
| 4 | `gpt-6-sol` | openai | 100% | 1.00 | 5.00 | 1106 ms | 1.7 s | 149 | $0.0075 |
| 5 | `gpt-5.4` | openai | 100% | 1.00 | 5.00 | 716 ms | 1.8 s | 86 | $0.016 |
| 6 | `claude-fable-5-1` | anthropic | 100% | 1.00 | 5.00 | 389 ms | 2.1 s | 118 | $0.090 |
| 7 | `gpt-5.2` | openai | 100% | 1.00 | 4.33 | 676 ms | 2.1 s | 85 | $0.0074 |
| 8 | `claude-sonnet-5` | anthropic | 100% | 1.00 | 4.33 | 950 ms | 2.2 s | 145 | $0.019 |
| 9 | `gpt-5.1` | openai | 100% | 1.00 | 4.50 | 650 ms | 2.2 s | 139 | $0.0057 |
| 10 | `gpt-6.1-sol` | openai | 100% | 1.00 | 4.67 | 1444 ms | 2.2 s | 89 | $0.0070 |
| 11 | `claude-sonnet-4-5-20250929` | anthropic | 100% | 1.00 | 4.33 | 775 ms | 2.3 s | 90 | $0.022 |
| 12 | `claude-haiku-5-5` | anthropic | 100% | 1.00 | 4.83 | 1301 ms | 2.4 s | 487 | $0.0011 |
| 13 | `gpt-5.6-sol` | openai | 100% | 1.00 | 5.00 | 1108 ms | 2.5 s | 133 | $0.015 |
| 14 | `gpt-5.5` | openai | 100% | 1.00 | 4.83 | 1755 ms | 2.5 s | 147 | $0.021 |
| 15 | `claude-opus-4-5-20251101` | anthropic | 100% | 1.00 | 4.67 | 862 ms | 2.5 s | 98 | $0.036 |
| 16 | `claude-opus-5-5` | anthropic | 100% | 1.00 | 4.83 | 1703 ms | 2.8 s | 161 | $0.043 |
| 17 | `claude-sonnet-5-5` | anthropic | 100% | 1.00 | 4.67 | 1020 ms | 2.9 s | 202 | $0.020 |
| 18 | `claude-opus-4-8` | anthropic | 100% | 1.00 | 4.67 | 488 ms | 2.9 s | 104 | $0.045 |
| 19 | `o3` | openai | 100% | 1.00 | 4.33 | 1763 ms | 2.9 s | 533 | $0.015 |
| 20 | `gpt-6-astra` | openai | 100% | 1.00 | 5.00 | 2376 ms | 3.1 s | 78 | $0.037 |
| 21 | `gpt-6.1-terra` | openai | 100% | 1.00 | 4.67 | 1515 ms | 3.2 s | 93 | $0.0037 |
| 22 | `claude-opus-4-7` | anthropic | 100% | 1.00 | 4.33 | 687 ms | 3.3 s | 91 | $0.045 |
| 23 | `claude-opus-5` | anthropic | 100% | 1.00 | 4.67 | 2530 ms | 4.0 s | 161 | $0.051 |
| 24 | `claude-opus-4-6` | anthropic | 100% | 1.00 | 4.83 | 1622 ms | 4.2 s | 75 | $0.035 |
| 25 | `claude-sonnet-4-6` | anthropic | 100% | 1.00 | 5.00 | 735 ms | 4.7 s | 90 | $0.021 |
| 26 | `gpt-5` | openai | 100% | 1.00 | 4.33 | 4121 ms | 5.0 s | 962 | $0.012 |
| 27 | `gpt-5-mini` | openai | 100% | 1.00 | 4.83 | 4395 ms | 5.7 s | 375 | $0.0026 |
| 28 | `gpt-4o` | openai | 95% | 1.00 | 3.83 | 656 ms | 2.4 s | 106 | $0.015 |
| 29 | `gpt-5.6-luna` | openai | 95% | 0.98 | 4.67 | 1398 ms | 3.0 s | 136 | $0.0008 |
| 30 | `gpt-4.1-mini` | openai | 91% | 0.97 | 3.83 | 449 ms | 1.7 s | 153 | $0.0024 |
| 31 | `claude-haiku-4-5-20251001` | anthropic | 91% | 0.97 | 3.33 | 502 ms | 2.0 s | 135 | $0.0072 |
| 32 | `gpt-5-nano` | openai | 95% | 0.97 | 3.67 | 6133 ms | 6.8 s | 1362 | $0.0006 |
| 33 | `gpt-5.4-mini` | openai | 95% | 0.95 | 4.67 | 624 ms | 1.2 s | 167 | $0.0029 |
| 34 | `gpt-5.6-terra` | openai | 95% | 0.95 | 5.00 | 869 ms | 1.8 s | 126 | $0.0077 |
| 35 | `gpt-6-luna` | openai | 95% | 0.95 | 4.67 | 2045 ms | 3.0 s | 194 | $0.0007 |
| 36 | `gpt-4o-mini` | openai | 82% | 0.94 | 4.00 | 561 ms | 2.0 s | 116 | $0.0009 |
| 37 | `gpt-5.4-nano` | openai | 86% | 0.92 | 4.00 | 549 ms | 1.7 s | 135 | $0.0003 |
| 38 | `claude-fable-5` | anthropic | 91% | 0.91 | 5.00 | 1764 ms | 2.8 s | 112 | $0.092 |

## Best model per task (deterministic score, ties → cheaper)

| Task | Best | Score | Latency | $/run | Cheapest model with a perfect score |
|---|---|---|---|---|---|
| Document analysis | `gpt-6-luna` | 1.00 | 2.4 s | $0.0001 | `gpt-6-luna` ($0.0001) |
| JSON generation | `gpt-4o-mini` | 1.00 | 1.3 s | $0.0001 | `gpt-4o-mini` ($0.0001) |
| Complex reasoning | `gpt-6-luna` | 1.00 | 5.1 s | $0.0002 | `gpt-6-luna` ($0.0002) |
| Long-context retrieval | `gpt-5.4-nano` | 1.00 | 0.8 s | $0.0011 | `gpt-5.4-nano` ($0.0011) |
| English writing | `claude-haiku-5-5` | 1.00 | 2.7 s | $0.0002 | `claude-haiku-5-5` ($0.0002) |
| French writing | `gpt-4o-mini` | 1.00 | 2.5 s | $0.0002 | `gpt-4o-mini` ($0.0002) |
| Programming | `gpt-4o-mini` | 1.00 | 1.6 s | $0.0001 | `gpt-4o-mini` ($0.0001) |
| Simple reasoning | `gpt-6-luna` | 1.00 | 1.4 s | $0.0000 | `gpt-6-luna` ($0.0000) |
| Knowledge synthesis | `gpt-4o-mini` | 1.00 | 2.8 s | $0.0002 | `gpt-4o-mini` ($0.0002) |
| Tool calling | `gpt-6-luna` | 1.00 | 1.1 s | $0.0000 | `gpt-6-luna` ($0.0000) |
| Mathematics | `gpt-6-luna` | 1.00 | 20.4 s | $0.0002 | `gpt-6-luna` ($0.0002) |

## Writing quality (two-judge LLM rubric, 1–5; experimental, not used for pass rates)

| Model | French writing | English writing | Knowledge synthesis |
|---|---|---|---|
| `chat-latest` | 5.00 | 5.00 | 5.00 |
| `gpt-5.3-codex` | 5.00 | 5.00 | 4.00 |
| `gpt-4.1` | 5.00 | 5.00 | 2.50 |
| `gpt-6-sol` | 5.00 | 5.00 | 5.00 |
| `gpt-5.4` | 5.00 | 5.00 | 5.00 |
| `claude-fable-5-1` | 5.00 | 5.00 | 5.00 |
| `gpt-5.2` | 5.00 | 5.00 | 3.00 |
| `claude-sonnet-5` | 5.00 | 5.00 | 3.00 |
| `gpt-5.1` | 5.00 | 5.00 | 3.50 |
| `gpt-6.1-sol` | 5.00 | 5.00 | 4.00 |
| `claude-sonnet-4-5-20250929` | 5.00 | 5.00 | 3.00 |
| `claude-haiku-5-5` | 4.50 | 5.00 | 5.00 |
| `gpt-5.6-sol` | 5.00 | 5.00 | 5.00 |
| `gpt-5.5` | 5.00 | 5.00 | 4.50 |
| `claude-opus-4-5-20251101` | 5.00 | 5.00 | 4.00 |
| `claude-opus-5-5` | 5.00 | 5.00 | 4.50 |
| `claude-sonnet-5-5` | 5.00 | 5.00 | 4.00 |
| `claude-opus-4-8` | 5.00 | 5.00 | 4.00 |
| `o3` | 4.50 | 5.00 | 3.50 |
| `gpt-6-astra` | 5.00 | 5.00 | 5.00 |
| `gpt-6.1-terra` | 5.00 | 5.00 | 4.00 |
| `claude-opus-4-7` | 5.00 | 5.00 | 3.00 |
| `claude-opus-5` | 5.00 | 5.00 | 4.00 |
| `claude-opus-4-6` | 5.00 | 5.00 | 4.50 |
| `claude-sonnet-4-6` | 5.00 | 5.00 | 5.00 |
| `gpt-5` | 5.00 | 5.00 | 3.00 |
| `gpt-5-mini` | 5.00 | 5.00 | 4.50 |
| `gpt-4o` | 4.00 | 5.00 | 2.50 |
| `gpt-5.6-luna` | 5.00 | 5.00 | 4.00 |
| `gpt-4.1-mini` | 4.00 | 5.00 | 2.50 |
| `claude-haiku-4-5-20251001` | 3.50 | 4.00 | 2.50 |
| `gpt-5-nano` | 3.00 | 5.00 | 3.00 |
| `gpt-5.4-mini` | 5.00 | 5.00 | 4.00 |
| `gpt-5.6-terra` | 5.00 | 5.00 | 5.00 |
| `gpt-6-luna` | 5.00 | 5.00 | 4.00 |
| `gpt-4o-mini` | 5.00 | 4.00 | 3.00 |
| `gpt-5.4-nano` | 4.50 | 5.00 | 2.50 |
| `claude-fable-5` | 5.00 | 5.00 | 5.00 |

## Speed

| Model | TTFT median | Latency median | Output tok/s median |
|---|---|---|---|
| `gpt-5.4-mini` | 624 ms | 1.2 s | 167 |
| `chat-latest` | 741 ms | 1.4 s | 157 |
| `gpt-5.3-codex` | 602 ms | 1.4 s | 94 |
| `gpt-4.1-mini` | 449 ms | 1.7 s | 153 |
| `gpt-4.1` | 450 ms | 1.7 s | 163 |
| `gpt-5.4-nano` | 549 ms | 1.7 s | 135 |
| `gpt-6-sol` | 1106 ms | 1.7 s | 149 |
| `gpt-5.6-terra` | 869 ms | 1.8 s | 126 |
| `gpt-5.4` | 716 ms | 1.8 s | 86 |
| `gpt-4o-mini` | 561 ms | 2.0 s | 116 |
| `claude-haiku-4-5-20251001` | 502 ms | 2.0 s | 135 |
| `claude-fable-5-1` | 389 ms | 2.1 s | 118 |
| `gpt-5.2` | 676 ms | 2.1 s | 85 |
| `claude-sonnet-5` | 950 ms | 2.2 s | 145 |
| `gpt-5.1` | 650 ms | 2.2 s | 139 |
| `gpt-6.1-sol` | 1444 ms | 2.2 s | 89 |
| `claude-sonnet-4-5-20250929` | 775 ms | 2.3 s | 90 |
| `gpt-4o` | 656 ms | 2.4 s | 106 |
| `claude-haiku-5-5` | 1301 ms | 2.4 s | 487 |
| `gpt-5.6-sol` | 1108 ms | 2.5 s | 133 |
| `gpt-5.5` | 1755 ms | 2.5 s | 147 |
| `claude-opus-4-5-20251101` | 862 ms | 2.5 s | 98 |
| `claude-opus-5-5` | 1703 ms | 2.8 s | 161 |
| `claude-fable-5` | 1764 ms | 2.8 s | 112 |
| `claude-sonnet-5-5` | 1020 ms | 2.9 s | 202 |
| `claude-opus-4-8` | 488 ms | 2.9 s | 104 |
| `o3` | 1763 ms | 2.9 s | 533 |
| `gpt-6-luna` | 2045 ms | 3.0 s | 194 |
| `gpt-5.6-luna` | 1398 ms | 3.0 s | 136 |
| `gpt-6-astra` | 2376 ms | 3.1 s | 78 |
| `gpt-6.1-terra` | 1515 ms | 3.2 s | 93 |
| `claude-opus-4-7` | 687 ms | 3.3 s | 91 |
| `claude-opus-5` | 2530 ms | 4.0 s | 161 |
| `claude-opus-4-6` | 1622 ms | 4.2 s | 75 |
| `claude-sonnet-4-6` | 735 ms | 4.7 s | 90 |
| `gpt-5` | 4121 ms | 5.0 s | 962 |
| `gpt-5-mini` | 4395 ms | 5.7 s | 375 |
| `gpt-5-nano` | 6133 ms | 6.8 s | 1362 |

## Caveats

- Two trials per cell: differences of a few points are noise. Latency depends on provider load at run time (2026-11-01).
- Costs are estimates (provider-reported tokens × list price); provider invoices are authoritative.
- Writing scores come from LLM judges and are shown separately from deterministic results.
- Pro-tier models (gpt-5.5-pro, gpt-5.4-pro, gpt-5.2-pro, gpt-5-pro, o3-pro) passed discovery probes but were excluded from the benchmark for cost ($20–$30 per M input tokens); they are selectable manually in the app.
