# AI provider discovery — Note SPBoucher AI

Generated 2026-11-01T07:03:46.768Z by `benchmarks/scripts/discover.ts` (real API calls; estimated probe cost $0.7736).

Legend: ✅ probe succeeded · ❌ request accepted but feature unsupported/failed check · ⛔ model unavailable to this account (404) · ⚠️ transport/other error · · not probed.

**Method.** Model identifiers come from `GET /v1/models` on each provider. Every general-purpose text model (and every Anthropic model) was then exercised with six real requests: plain text (non-streaming), streaming, one function/tool call, JSON-schema structured output, a 64×64 red PNG vision question, and a reasoning-effort parameter. Specialized models (audio, image, video, realtime, embeddings, moderation, search/deep-research, legacy completion) were deliberately **not** sent chat requests. Dated snapshots were not probed separately from their alias.

## OpenAI — 140 identifiers listed

Tested: 29 · unavailable (404 for this account): 21 · unsupported: 0 · not probed (specialized or snapshot): 90

| Model | Category | Context | Max out | $/M in | $/M out | text | streaming | tool_use | structured_output | vision | reasoning_control | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `chat-latest` | text | – | – | 5 | 30 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | tested |
| `gpt-3.5-turbo` | text | – | – | – | – | ⛔ | · | · | · | · | · | unavailable |
| `gpt-3.5-turbo-0125` | text | – | – | – | – | ⛔ | · | · | · | · | · | unavailable |
| `gpt-3.5-turbo-1106` | text | – | – | – | – | ⛔ | · | · | · | · | · | unavailable |
| `gpt-3.5-turbo-16k` | text | – | – | – | – | ⛔ | · | · | · | · | · | unavailable |
| `gpt-4` | text | – | – | – | – | ⛔ | · | · | · | · | · | unavailable |
| `gpt-4-0613` | text | – | – | – | – | ⛔ | · | · | · | · | · | unavailable |
| `gpt-4-turbo` | text | – | – | – | – | ⛔ | · | · | · | · | · | unavailable |
| `gpt-4.1` | text | – | – | 2 | 8 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | tested |
| `gpt-4.1-mini` | text | – | – | 0.4 | 1.6 | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | tested |
| `gpt-4.1-nano` | text | – | – | 0.1 | 0.4 | ⛔ | · | · | · | · | · | unavailable |
| `gpt-4o` | text | – | – | 2.5 | 10 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | tested |
| `gpt-4o-mini` | text | – | – | 0.15 | 0.6 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | tested |
| `gpt-5` | text | – | – | 1.25 | 10 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | tested |
| `gpt-5-chat-latest` | text | – | – | 1.25 | 10 | ⛔ | · | · | · | · | · | unavailable |
| `gpt-5-codex` | text-specialized | – | – | 1.25 | 10 | ⛔ | · | · | · | · | · | unavailable |
| `gpt-5-mini` | text | – | – | 0.25 | 2 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | tested |
| `gpt-5-nano` | text | – | – | 0.05 | 0.4 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | tested |
| `gpt-5-pro` | text | – | – | 15 | 120 | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | tested |
| `gpt-5.1` | text | – | – | 1.25 | 10 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | tested |
| `gpt-5.1-chat-latest` | text | – | – | 1.25 | 10 | ⛔ | · | · | · | · | · | unavailable |
| `gpt-5.1-codex` | text-specialized | – | – | 1.25 | 10 | ⛔ | · | · | · | · | · | unavailable |
| `gpt-5.1-codex-max` | text-specialized | – | – | 1.25 | 10 | ⛔ | · | · | · | · | · | unavailable |
| `gpt-5.1-codex-mini` | text-specialized | – | – | 0.25 | 2 | ⛔ | · | · | · | · | · | unavailable |
| `gpt-5.2` | text | – | – | 1.75 | 14 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | tested |
| `gpt-5.2-chat-latest` | text | – | – | 1.75 | 14 | ⛔ | · | · | · | · | · | unavailable |
| `gpt-5.2-codex` | text-specialized | – | – | 1.75 | 14 | ⛔ | · | · | · | · | · | unavailable |
| `gpt-5.2-pro` | text | – | – | 21 | 168 | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | tested |
| `gpt-5.3-chat-latest` | text | – | – | 1.75 | 14 | ⛔ | · | · | · | · | · | unavailable |
| `gpt-5.3-codex` | text-specialized | – | – | 1.75 | 14 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | tested |
| `gpt-5.4` | text | – | – | 2.5 | 15 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | tested |
| `gpt-5.4-mini` | text | – | – | 0.75 | 4.5 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | tested |
| `gpt-5.4-nano` | text | – | – | 0.2 | 1.25 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | tested |
| `gpt-5.4-pro` | text | – | – | 30 | 180 | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | tested |
| `gpt-5.5` | text | – | – | 5 | 30 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | tested |
| `gpt-5.5-pro` | text | – | – | 30 | 180 | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | tested |
| `gpt-5.6-luna` | text | – | – | 0.2 | 1.2 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | tested |
| `gpt-5.6-sol` | text | – | – | 4 | 20 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | tested |
| `gpt-5.6-terra` | text | – | – | 2 | 12 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | tested |
| `gpt-6-astra` | text | – | – | 10 | 50 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | tested |
| `gpt-6-luna` | text | – | – | 0.1 | 0.5 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | tested |
| `gpt-6-sol` | text | – | – | 2 | 10 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | tested |
| `gpt-6.1-sol` | text | – | – | 2 | 10 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | tested |
| `gpt-6.1-terra` | text | – | – | 1 | 5 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | tested |
| `o1` | text | – | – | 15 | 60 | ⛔ | · | · | · | · | · | unavailable |
| `o1-pro` | text | – | – | 150 | 600 | ⛔ | · | · | · | · | · | unavailable |
| `o3` | text | – | – | 2 | 8 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | tested |
| `o3-mini` | text | – | – | 1.1 | 4.4 | ⛔ | · | · | · | · | · | unavailable |
| `o3-pro` | text | – | – | 20 | 80 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | tested |
| `o4-mini` | text | – | – | 1.1 | 4.4 | ⛔ | · | · | · | · | · | unavailable |

<details><summary>Not probed (90)</summary>

- `babbage-002` — category legacy-completion: not a general text model, not probed (inappropriate request type)
- `chatgpt-image-latest` — category image: not a general text model, not probed (inappropriate request type)
- `davinci-002` — category legacy-completion: not a general text model, not probed (inappropriate request type)
- `gpt-3.5-turbo-instruct` — category legacy-completion: not a general text model, not probed (inappropriate request type)
- `gpt-3.5-turbo-instruct-0914` — category legacy-completion: not a general text model, not probed (inappropriate request type)
- `gpt-4-turbo-2024-04-09` — dated snapshot of gpt-4-turbo; not probed separately
- `gpt-4.1-2025-04-14` — dated snapshot of gpt-4.1; not probed separately
- `gpt-4.1-mini-2025-04-14` — dated snapshot of gpt-4.1-mini; not probed separately
- `gpt-4.1-nano-2025-04-14` — dated snapshot of gpt-4.1-nano; not probed separately
- `gpt-4o-2024-05-13` — dated snapshot of gpt-4o; not probed separately
- `gpt-4o-2024-08-06` — dated snapshot of gpt-4o; not probed separately
- `gpt-4o-2024-11-20` — dated snapshot of gpt-4o; not probed separately
- `gpt-4o-mini-2024-07-18` — dated snapshot of gpt-4o-mini; not probed separately
- `gpt-4o-mini-search-preview` — category search: not a general text model, not probed (inappropriate request type)
- `gpt-4o-mini-search-preview-2025-03-11` — dated snapshot of gpt-4o-mini-search-preview; not probed separately
- `gpt-4o-mini-transcribe` — category audio: not a general text model, not probed (inappropriate request type)
- `gpt-4o-mini-transcribe-2025-03-20` — dated snapshot of gpt-4o-mini-transcribe; not probed separately
- `gpt-4o-mini-transcribe-2025-12-15` — dated snapshot of gpt-4o-mini-transcribe; not probed separately
- `gpt-4o-mini-tts` — category audio: not a general text model, not probed (inappropriate request type)
- `gpt-4o-mini-tts-2025-03-20` — dated snapshot of gpt-4o-mini-tts; not probed separately
- `gpt-4o-mini-tts-2025-12-15` — dated snapshot of gpt-4o-mini-tts; not probed separately
- `gpt-4o-search-preview` — category search: not a general text model, not probed (inappropriate request type)
- `gpt-4o-search-preview-2025-03-11` — dated snapshot of gpt-4o-search-preview; not probed separately
- `gpt-4o-transcribe` — category audio: not a general text model, not probed (inappropriate request type)
- `gpt-4o-transcribe-diarize` — category audio: not a general text model, not probed (inappropriate request type)
- `gpt-5-2025-08-07` — dated snapshot of gpt-5; not probed separately
- `gpt-5-mini-2025-08-07` — dated snapshot of gpt-5-mini; not probed separately
- `gpt-5-nano-2025-08-07` — dated snapshot of gpt-5-nano; not probed separately
- `gpt-5-pro-2025-10-06` — dated snapshot of gpt-5-pro; not probed separately
- `gpt-5-search-api` — category search: not a general text model, not probed (inappropriate request type)
- `gpt-5-search-api-2025-10-14` — dated snapshot of gpt-5-search-api; not probed separately
- `gpt-5.1-2025-11-13` — dated snapshot of gpt-5.1; not probed separately
- `gpt-5.2-2025-12-11` — dated snapshot of gpt-5.2; not probed separately
- `gpt-5.2-pro-2025-12-11` — dated snapshot of gpt-5.2-pro; not probed separately
- `gpt-5.4-2026-03-05` — dated snapshot of gpt-5.4; not probed separately
- `gpt-5.4-mini-2026-03-17` — dated snapshot of gpt-5.4-mini; not probed separately
- `gpt-5.4-nano-2026-03-17` — dated snapshot of gpt-5.4-nano; not probed separately
- `gpt-5.4-pro-2026-03-05` — dated snapshot of gpt-5.4-pro; not probed separately
- `gpt-5.5-2026-04-23` — dated snapshot of gpt-5.5; not probed separately
- `gpt-5.5-pro-2026-04-23` — dated snapshot of gpt-5.5-pro; not probed separately
- `gpt-audio` — category audio: not a general text model, not probed (inappropriate request type)
- `gpt-audio-1.5` — category audio: not a general text model, not probed (inappropriate request type)
- `gpt-audio-2025-08-28` — dated snapshot of gpt-audio; not probed separately
- `gpt-audio-mini` — category audio: not a general text model, not probed (inappropriate request type)
- `gpt-audio-mini-2025-10-06` — dated snapshot of gpt-audio-mini; not probed separately
- `gpt-audio-mini-2025-12-15` — dated snapshot of gpt-audio-mini; not probed separately
- `gpt-image-1` — category image: not a general text model, not probed (inappropriate request type)
- `gpt-image-1-mini` — category image: not a general text model, not probed (inappropriate request type)
- `gpt-image-1.5` — category image: not a general text model, not probed (inappropriate request type)
- `gpt-image-2` — category image: not a general text model, not probed (inappropriate request type)
- `gpt-image-2-2026-04-21` — dated snapshot of gpt-image-2; not probed separately
- `gpt-image-2.5-flare` — category image: not a general text model, not probed (inappropriate request type)
- `gpt-image-2.5-flare-2026-09-08` — dated snapshot of gpt-image-2.5-flare; not probed separately
- `gpt-image-2.5-sunburst` — category image: not a general text model, not probed (inappropriate request type)
- `gpt-image-2.5-sunburst-2026-09-08` — dated snapshot of gpt-image-2.5-sunburst; not probed separately
- `gpt-live-1` — category realtime: not a general text model, not probed (inappropriate request type)
- `gpt-live-transcribe` — category realtime: not a general text model, not probed (inappropriate request type)
- `gpt-realtime` — category realtime: not a general text model, not probed (inappropriate request type)
- `gpt-realtime-1.5` — category realtime: not a general text model, not probed (inappropriate request type)
- `gpt-realtime-2` — category realtime: not a general text model, not probed (inappropriate request type)
- `gpt-realtime-2.1` — category realtime: not a general text model, not probed (inappropriate request type)
- `gpt-realtime-2.1-mini` — category realtime: not a general text model, not probed (inappropriate request type)
- `gpt-realtime-2025-08-28` — dated snapshot of gpt-realtime; not probed separately
- `gpt-realtime-mini` — category realtime: not a general text model, not probed (inappropriate request type)
- `gpt-realtime-mini-2025-12-15` — dated snapshot of gpt-realtime-mini; not probed separately
- `gpt-realtime-translate` — category realtime: not a general text model, not probed (inappropriate request type)
- `gpt-realtime-whisper` — category realtime: not a general text model, not probed (inappropriate request type)
- `gpt-transcribe` — category audio: not a general text model, not probed (inappropriate request type)
- `o1-2024-12-17` — dated snapshot of o1; not probed separately
- `o1-pro-2025-03-19` — dated snapshot of o1-pro; not probed separately
- `o3-2025-04-16` — dated snapshot of o3; not probed separately
- `o3-deep-research` — category deep-research: not a general text model, not probed (inappropriate request type)
- `o3-deep-research-2025-06-26` — dated snapshot of o3-deep-research; not probed separately
- `o3-mini-2025-01-31` — dated snapshot of o3-mini; not probed separately
- `o3-pro-2025-06-10` — dated snapshot of o3-pro; not probed separately
- `o4-mini-2025-04-16` — dated snapshot of o4-mini; not probed separately
- `o4-mini-deep-research` — category deep-research: not a general text model, not probed (inappropriate request type)
- `o4-mini-deep-research-2025-06-26` — dated snapshot of o4-mini-deep-research; not probed separately
- `omni-moderation-2024-09-26` — category moderation: not a general text model, not probed (inappropriate request type)
- `omni-moderation-latest` — category moderation: not a general text model, not probed (inappropriate request type)
- `sora-2` — category video: not a general text model, not probed (inappropriate request type)
- `sora-2-pro` — category video: not a general text model, not probed (inappropriate request type)
- `text-embedding-3-large` — category embedding: not a general text model, not probed (inappropriate request type)
- `text-embedding-3-small` — category embedding: not a general text model, not probed (inappropriate request type)
- `text-embedding-ada-002` — category embedding: not a general text model, not probed (inappropriate request type)
- `tts-1` — category audio: not a general text model, not probed (inappropriate request type)
- `tts-1-1106` — category audio: not a general text model, not probed (inappropriate request type)
- `tts-1-hd` — category audio: not a general text model, not probed (inappropriate request type)
- `tts-1-hd-1106` — category audio: not a general text model, not probed (inappropriate request type)
- `whisper-1` — category audio: not a general text model, not probed (inappropriate request type)

</details>

<details><summary>Probe failures and messages (26)</summary>

- `gpt-3.5-turbo` / text: unavailable — 404 404 The model `gpt-3.5-turbo` does not exist or you do not have access to it.
- `gpt-3.5-turbo-0125` / text: unavailable — 404 404 The model `gpt-3.5-turbo-0125` does not exist or you do not have access to it.
- `gpt-3.5-turbo-1106` / text: unavailable — 404 404 The model `gpt-3.5-turbo-1106` does not exist or you do not have access to it.
- `gpt-3.5-turbo-16k` / text: unavailable — 404 404 The model `gpt-3.5-turbo-16k` does not exist or you do not have access to it.
- `gpt-4` / text: unavailable — 404 404 The model `gpt-4` does not exist or you do not have access to it.
- `gpt-4-0613` / text: unavailable — 404 404 The model `gpt-4-0613` does not exist or you do not have access to it.
- `gpt-4-turbo` / text: unavailable — 404 404 The model `gpt-4-turbo` does not exist or you do not have access to it.
- `gpt-4.1-mini` / vision: unsupported — answer: Pink
- `gpt-4.1-nano` / text: unavailable — 404 404 The model `gpt-4.1-nano` has been deprecated, learn more here: https://platform.openai.com/docs/deprecations
- `gpt-5-chat-latest` / text: unavailable — 404 404 The model `gpt-5-chat-latest` does not exist or you do not have access to it.
- `gpt-5-codex` / text: unavailable — 404 404 The model `gpt-5-codex` does not exist or you do not have access to it.
- `gpt-5-pro` / reasoning_control: unsupported — 400 400 Unsupported value: 'low' is not supported with the 'gpt-5-pro' model. Supported values are: 'high'.
- `gpt-5.1-chat-latest` / text: unavailable — 404 404 The model `gpt-5.1-chat-latest` does not exist or you do not have access to it.
- `gpt-5.1-codex` / text: unavailable — 404 404 The model `gpt-5.1-codex` does not exist or you do not have access to it.
- `gpt-5.1-codex-max` / text: unavailable — 404 404 The model `gpt-5.1-codex-max` does not exist or you do not have access to it.
- `gpt-5.1-codex-mini` / text: unavailable — 404 404 The model `gpt-5.1-codex-mini` does not exist or you do not have access to it.
- `gpt-5.2-chat-latest` / text: unavailable — 404 404 The model `gpt-5.2-chat-latest` does not exist or you do not have access to it.
- `gpt-5.2-codex` / text: unavailable — 404 404 The model `gpt-5.2-codex` does not exist or you do not have access to it.
- `gpt-5.2-pro` / reasoning_control: unsupported — 400 400 Unsupported value: 'low' is not supported with the 'gpt-5.2-pro' model. Supported values are: 'medium', 'high', and 'xhigh'.
- `gpt-5.3-chat-latest` / text: unavailable — 404 404 The model `gpt-5.3-chat-latest` does not exist or you do not have access to it.
- `gpt-5.4-pro` / reasoning_control: unsupported — 400 400 Unsupported value: 'low' is not supported with the 'gpt-5.4-pro' model. Supported values are: 'medium', 'high', and 'xhigh'.
- `gpt-5.5-pro` / reasoning_control: unsupported — 400 400 Unsupported value: 'low' is not supported with the 'gpt-5.5-pro' model. Supported values are: 'medium', 'high', and 'xhigh'.
- `o1` / text: unavailable — 404 404 The model `o1` does not exist or you do not have access to it.
- `o1-pro` / text: unavailable — 404 404 The model `o1-pro` does not exist or you do not have access to it.
- `o3-mini` / text: unavailable — 404 404 The model `o3-mini` does not exist or you do not have access to it.
- `o4-mini` / text: unavailable — 404 404 The model `o4-mini` does not exist or you do not have access to it.

</details>

## Anthropic — 14 identifiers listed

Tested: 14 · unavailable (404 for this account): 0 · unsupported: 0 · not probed (specialized or snapshot): 0

| Model | Category | Context | Max out | $/M in | $/M out | text | streaming | tool_use | structured_output | vision | reasoning_control | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `claude-haiku-5-5` | text | 1000K | 128K | 0.1 | 0.5 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | tested |
| `claude-sonnet-5-5` | text | 1000K | 128K | 2 | 10 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | tested |
| `claude-opus-5-5` | text | 1000K | 128K | 4 | 20 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | tested |
| `claude-fable-5-1` | text | 1000K | 128K | 10 | 50 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | tested |
| `claude-opus-5` | text | 1000K | 128K | 5 | 25 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | tested |
| `claude-sonnet-5` | text | 1000K | 128K | 2 | 10 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | tested |
| `claude-fable-5` | text | 1000K | 128K | 10 | 50 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | tested |
| `claude-opus-4-8` | text | 1000K | 128K | 5 | 25 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | tested |
| `claude-opus-4-7` | text | 1000K | 128K | 5 | 25 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | tested |
| `claude-sonnet-4-6` | text | 1000K | 128K | 3 | 15 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | tested |
| `claude-opus-4-6` | text | 1000K | 128K | 5 | 25 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | tested |
| `claude-opus-4-5-20251101` | text | 200K | 64K | 5 | 25 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | tested |
| `claude-haiku-4-5-20251001` | text | 200K | 64K | 1 | 5 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | tested |
| `claude-sonnet-4-5-20250929` | text | 200K | 64K | 3 | 15 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | tested |

<details><summary>Not probed (0)</summary>



</details>

## Pricing sources

- OpenAI: https://developers.openai.com/api/docs/pricing (fetched 2026-11-01; Standard tier, short context (≤272K input)). `chat-latest` has no own row on the pricing page; it is priced in this report as gpt-5.5 (assumption).
- Anthropic: https://platform.claude.com/docs/en/about-claude/pricing (fetched 2026-11-01). Haiku 5.5 prices shown are for prompts ≤100K tokens. Context/max-output for Anthropic come from `GET /v1/models/{id}` (anthropic-version 2026-10-21); OpenAI does not expose these fields via API — see the docs catalogue (GPT-6 family: 1.05M context / 128K output).

## Anthropic capability trees (from the Models API)

<details><summary>`claude-haiku-5-5` — context 1000000, max output 128000</summary>

```json
{"batch":{"supported":true},"citations":{"supported":true},"code_execution":{"supported":true},"context_management":{"supported":true,"clear_tool_uses_20250919":{"supported":true},"clear_thinking_20251015":{"supported":true},"compact_20260112":{"supported":true}},"effort":{"supported":true,"low":{"supported":true},"medium":{"supported":true},"high":{"supported":true},"xhigh":{"supported":true},"max":{"supported":true}},"image_input":{"supported":true},"pdf_input":{"supported":true},"server_tools":{"supported":true,"code_execution":{"supported":true},"web_search":{"supported":true}},"structured_outputs":{"supported":true},"thinking":{"supported":true,"types":{"enabled":{"supported":false},"adaptive":{"supported":true},"disabled":{"supported":true},"between_tools":{"supported":false}}}}
```

</details>
<details><summary>`claude-sonnet-5-5` — context 1000000, max output 128000</summary>

```json
{"batch":{"supported":true},"citations":{"supported":true},"code_execution":{"supported":true},"context_management":{"supported":true,"clear_tool_uses_20250919":{"supported":true},"clear_thinking_20251015":{"supported":true},"compact_20260112":{"supported":true}},"effort":{"supported":true,"low":{"supported":true},"medium":{"supported":true},"high":{"supported":true},"xhigh":{"supported":true},"max":{"supported":true}},"image_input":{"supported":true},"pdf_input":{"supported":true},"server_tools":{"supported":true,"code_execution":{"supported":true},"web_search":{"supported":true}},"structured_outputs":{"supported":true},"thinking":{"supported":true,"types":{"enabled":{"supported":false},"adaptive":{"supported":true},"disabled":{"supported":false},"between_tools":{"supported":true}}}}
```

</details>
<details><summary>`claude-opus-5-5` — context 1000000, max output 128000</summary>

```json
{"batch":{"supported":true},"citations":{"supported":true},"code_execution":{"supported":true},"context_management":{"supported":true,"clear_tool_uses_20250919":{"supported":true},"clear_thinking_20251015":{"supported":true},"compact_20260112":{"supported":true}},"effort":{"supported":true,"low":{"supported":true},"medium":{"supported":true},"high":{"supported":true},"xhigh":{"supported":true},"max":{"supported":true}},"image_input":{"supported":true},"pdf_input":{"supported":true},"server_tools":{"supported":true,"code_execution":{"supported":true},"web_search":{"supported":true}},"structured_outputs":{"supported":true},"thinking":{"supported":true,"types":{"enabled":{"supported":false},"adaptive":{"supported":true},"disabled":{"supported":false},"between_tools":{"supported":false}}}}
```

</details>
<details><summary>`claude-fable-5-1` — context 1000000, max output 128000</summary>

```json
{"batch":{"supported":true},"citations":{"supported":true},"code_execution":{"supported":true},"context_management":{"supported":true,"clear_tool_uses_20250919":{"supported":true},"clear_thinking_20251015":{"supported":true},"compact_20260112":{"supported":true}},"effort":{"supported":true,"low":{"supported":true},"medium":{"supported":true},"high":{"supported":true},"xhigh":{"supported":true},"max":{"supported":true}},"image_input":{"supported":true},"pdf_input":{"supported":true},"server_tools":{"supported":true,"code_execution":{"supported":true},"web_search":{"supported":true}},"structured_outputs":{"supported":true},"thinking":{"supported":true,"types":{"enabled":{"supported":false},"adaptive":{"supported":true},"disabled":{"supported":false},"between_tools":{"supported":false}}}}
```

</details>
<details><summary>`claude-opus-5` — context 1000000, max output 128000</summary>

```json
{"batch":{"supported":true},"citations":{"supported":true},"code_execution":{"supported":true},"context_management":{"supported":true,"clear_tool_uses_20250919":{"supported":true},"clear_thinking_20251015":{"supported":true},"compact_20260112":{"supported":true}},"effort":{"supported":true,"low":{"supported":true},"medium":{"supported":true},"high":{"supported":true},"xhigh":{"supported":true},"max":{"supported":true}},"image_input":{"supported":true},"pdf_input":{"supported":true},"server_tools":{"supported":true,"code_execution":{"supported":true},"web_search":{"supported":true}},"structured_outputs":{"supported":true},"thinking":{"supported":true,"types":{"enabled":{"supported":false},"adaptive":{"supported":true},"disabled":{"supported":true},"between_tools":{"supported":false}}}}
```

</details>
<details><summary>`claude-sonnet-5` — context 1000000, max output 128000</summary>

```json
{"batch":{"supported":true},"citations":{"supported":true},"code_execution":{"supported":true},"context_management":{"supported":true,"clear_tool_uses_20250919":{"supported":true},"clear_thinking_20251015":{"supported":true},"compact_20260112":{"supported":true}},"effort":{"supported":true,"low":{"supported":true},"medium":{"supported":true},"high":{"supported":true},"xhigh":{"supported":true},"max":{"supported":true}},"image_input":{"supported":true},"pdf_input":{"supported":true},"server_tools":{"supported":true,"code_execution":{"supported":true},"web_search":{"supported":true}},"structured_outputs":{"supported":true},"thinking":{"supported":true,"types":{"enabled":{"supported":false},"adaptive":{"supported":true},"disabled":{"supported":true},"between_tools":{"supported":false}}}}
```

</details>
<details><summary>`claude-fable-5` — context 1000000, max output 128000</summary>

```json
{"batch":{"supported":true},"citations":{"supported":true},"code_execution":{"supported":true},"context_management":{"supported":true,"clear_tool_uses_20250919":{"supported":true},"clear_thinking_20251015":{"supported":true},"compact_20260112":{"supported":true}},"effort":{"supported":true,"low":{"supported":true},"medium":{"supported":true},"high":{"supported":true},"xhigh":{"supported":true},"max":{"supported":true}},"image_input":{"supported":true},"pdf_input":{"supported":true},"server_tools":{"supported":true,"code_execution":{"supported":true},"web_search":{"supported":true}},"structured_outputs":{"supported":true},"thinking":{"supported":true,"types":{"enabled":{"supported":false},"adaptive":{"supported":true},"disabled":{"supported":false},"between_tools":{"supported":false}}}}
```

</details>
<details><summary>`claude-opus-4-8` — context 1000000, max output 128000</summary>

```json
{"batch":{"supported":true},"citations":{"supported":true},"code_execution":{"supported":true},"context_management":{"supported":true,"clear_tool_uses_20250919":{"supported":true},"clear_thinking_20251015":{"supported":true},"compact_20260112":{"supported":true}},"effort":{"supported":true,"low":{"supported":true},"medium":{"supported":true},"high":{"supported":true},"xhigh":{"supported":true},"max":{"supported":true}},"image_input":{"supported":true},"pdf_input":{"supported":true},"server_tools":{"supported":true,"code_execution":{"supported":true},"web_search":{"supported":true}},"structured_outputs":{"supported":true},"thinking":{"supported":true,"types":{"enabled":{"supported":false},"adaptive":{"supported":true},"disabled":{"supported":true},"between_tools":{"supported":false}}}}
```

</details>
<details><summary>`claude-opus-4-7` — context 1000000, max output 128000</summary>

```json
{"batch":{"supported":true},"citations":{"supported":true},"code_execution":{"supported":true},"context_management":{"supported":true,"clear_tool_uses_20250919":{"supported":true},"clear_thinking_20251015":{"supported":true},"compact_20260112":{"supported":true}},"effort":{"supported":true,"low":{"supported":true},"medium":{"supported":true},"high":{"supported":true},"xhigh":{"supported":true},"max":{"supported":true}},"image_input":{"supported":true},"pdf_input":{"supported":true},"server_tools":{"supported":true,"code_execution":{"supported":true},"web_search":{"supported":true}},"structured_outputs":{"supported":true},"thinking":{"supported":true,"types":{"enabled":{"supported":false},"adaptive":{"supported":true},"disabled":{"supported":true},"between_tools":{"supported":false}}}}
```

</details>
<details><summary>`claude-sonnet-4-6` — context 1000000, max output 128000</summary>

```json
{"batch":{"supported":true},"citations":{"supported":true},"code_execution":{"supported":true},"context_management":{"supported":true,"clear_tool_uses_20250919":{"supported":true},"clear_thinking_20251015":{"supported":true},"compact_20260112":{"supported":true}},"effort":{"supported":true,"low":{"supported":true},"medium":{"supported":true},"high":{"supported":true},"xhigh":{"supported":false},"max":{"supported":true}},"image_input":{"supported":true},"pdf_input":{"supported":true},"server_tools":{"supported":true,"code_execution":{"supported":true},"web_search":{"supported":true}},"structured_outputs":{"supported":true},"thinking":{"supported":true,"types":{"enabled":{"supported":true},"adaptive":{"supported":true},"disabled":{"supported":true},"between_tools":{"supported":false}}}}
```

</details>
<details><summary>`claude-opus-4-6` — context 1000000, max output 128000</summary>

```json
{"batch":{"supported":true},"citations":{"supported":true},"code_execution":{"supported":true},"context_management":{"supported":true,"clear_tool_uses_20250919":{"supported":true},"clear_thinking_20251015":{"supported":true},"compact_20260112":{"supported":true}},"effort":{"supported":true,"low":{"supported":true},"medium":{"supported":true},"high":{"supported":true},"xhigh":{"supported":false},"max":{"supported":true}},"image_input":{"supported":true},"pdf_input":{"supported":true},"server_tools":{"supported":true,"code_execution":{"supported":true},"web_search":{"supported":true}},"structured_outputs":{"supported":true},"thinking":{"supported":true,"types":{"enabled":{"supported":true},"adaptive":{"supported":true},"disabled":{"supported":true},"between_tools":{"supported":false}}}}
```

</details>
<details><summary>`claude-opus-4-5-20251101` — context 200000, max output 64000</summary>

```json
{"batch":{"supported":true},"citations":{"supported":true},"code_execution":{"supported":true},"context_management":{"supported":true,"clear_tool_uses_20250919":{"supported":true},"clear_thinking_20251015":{"supported":true},"compact_20260112":{"supported":false}},"effort":{"supported":true,"low":{"supported":true},"medium":{"supported":true},"high":{"supported":true},"xhigh":{"supported":false},"max":{"supported":false}},"image_input":{"supported":true},"pdf_input":{"supported":true},"server_tools":{"supported":true,"code_execution":{"supported":true},"web_search":{"supported":true}},"structured_outputs":{"supported":true},"thinking":{"supported":true,"types":{"enabled":{"supported":true},"adaptive":{"supported":false},"disabled":{"supported":true},"between_tools":{"supported":false}}}}
```

</details>
<details><summary>`claude-haiku-4-5-20251001` — context 200000, max output 64000</summary>

```json
{"batch":{"supported":true},"citations":{"supported":true},"code_execution":{"supported":false},"context_management":{"supported":true,"clear_tool_uses_20250919":{"supported":true},"clear_thinking_20251015":{"supported":true},"compact_20260112":{"supported":false}},"effort":{"supported":false,"low":{"supported":false},"medium":{"supported":false},"high":{"supported":false},"xhigh":{"supported":false},"max":{"supported":false}},"image_input":{"supported":true},"pdf_input":{"supported":true},"server_tools":{"supported":true,"code_execution":{"supported":true},"web_search":{"supported":true}},"structured_outputs":{"supported":true},"thinking":{"supported":true,"types":{"enabled":{"supported":true},"adaptive":{"supported":false},"disabled":{"supported":true},"between_tools":{"supported":false}}}}
```

</details>
<details><summary>`claude-sonnet-4-5-20250929` — context 200000, max output 64000</summary>

```json
{"batch":{"supported":true},"citations":{"supported":true},"code_execution":{"supported":true},"context_management":{"supported":true,"clear_tool_uses_20250919":{"supported":true},"clear_thinking_20251015":{"supported":true},"compact_20260112":{"supported":false}},"effort":{"supported":false,"low":{"supported":false},"medium":{"supported":false},"high":{"supported":false},"xhigh":{"supported":false},"max":{"supported":false}},"image_input":{"supported":true},"pdf_input":{"supported":true},"server_tools":{"supported":true,"code_execution":{"supported":true},"web_search":{"supported":true}},"structured_outputs":{"supported":true},"thinking":{"supported":true,"types":{"enabled":{"supported":true},"adaptive":{"supported":false},"disabled":{"supported":true},"between_tools":{"supported":false}}}}
```

</details>
