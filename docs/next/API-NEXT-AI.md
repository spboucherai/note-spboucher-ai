# API — SP Note Next, AI workstream (v3.0, branch `next-ai`)

Contract for the native teams (SPNotesCore, macOS, iOS/iPadOS) and the web UI. It covers SPEC §3.5, §4.9 (level 1), §4.10–§4.14 and the
smart database properties. Everything else is in `docs/next/API-NEXT.md` (foundation workstream).

Every example below is a **real response of the scratch instance** (`note_next_ai_dev`, 2026-11-19), shortened only where marked `…`.
Prices are USD per 1M tokens as stored in the catalogue; costs are the catalogue price × the tokens the provider reported.

## 0. Conventions (unchanged from 2.x)

- **Auth**: session cookie. Mutations (`POST`/`PUT`/`PATCH`/`DELETE`) need `Origin` = the app origin (or `Sec-Fetch-Site: same-origin`),
  else `403 {"error":…,"code":"csrf"}`. No session → `401 {"code":"unauthenticated"}`.
- **Errors**: `{"error": "<human message>", "code": "<machine code>", …extra}` + `x-request-id`. Ids that are not UUIDs → `400` (`bad_id`
  on the routes of this document).
- **Idempotency**: optional `Idempotency-Key` on JSON mutations (stored answer replayed with `idempotent-replay: true`). SSE answers
  are never stored; the chat has its own `clientId` replay.
- **SSE format**: `content-type: text/event-stream`. Each event is one line `data: <JSON>` followed by a blank line; there are no
  `event:` names — the discriminator is the JSON field `type`. The stream always ends with `data: [DONE]`. If the server fails
  mid-stream: `{"type":"error","code":"server_error","retryable":true,"message":…}` then `[DONE]`.
- **AI marking (SPEC §0.10)**: every AI result carries `ai:true` and/or `model`; clients must show it as AI-generated and never apply it
  without an explicit user action. Nothing in this document writes to a page, a tag, a link or a row on its own, except the two
  explicit "apply" calls (§5.2, §7.3) and the configured auto-run of a database property (§7.4).
- **Model ids**: opaque strings ≤ 200 chars. Native-provider models keep their id (`claude-haiku-5-5`, `gpt-6-sol`); models of
  OpenAI-compatible providers are namespaced `<provider>:<remote id>` (`openrouter:anthropic/claude-fable-5`). Send back exactly the `id`
  you received.

## 1. Models and providers — `GET /api/ai/models` (SPEC §3.5, §4.11)

Query: `all=1` (also disabled, unlisted and embedding models) · `provider=<id>` · `creator=<id>` · `available=1` · `q=<text>` ·
`unavailable=1` (include the models of OpenAI-compatible providers that have no key — several hundred for OpenRouter; they are
otherwise only counted in `hiddenUnavailable`).

```jsonc
{
  "models": [ /* see below */ ],
  "providers": [
    {"id":"openai","name":"OpenAI","enabled":true,"lastDiscoveryAt":null,"status":"unknown","statusDetail":null,"kind":"openai","baseUrl":null,"keyEnv":"OPENAI_API_KEY","label":"OpenAI API","configured":true,"available":true,"logo":"/model-logos/generic.svg"},
    {"id":"anthropic","name":"Anthropic","enabled":true,"lastDiscoveryAt":null,"status":"unknown","statusDetail":null,"kind":"anthropic","baseUrl":null,"keyEnv":"ANTHROPIC_API_KEY","label":"Anthropic API","configured":true,"available":true,"logo":"/model-logos/anthropic.svg"},
    {"id":"openrouter","name":"OpenRouter","enabled":true,"lastDiscoveryAt":"2026-11-19T18:02:34.001Z","status":"no_key","statusDetail":"479 models listed from the public catalogue; OPENROUTER_API_KEY is not set","kind":"openai_compatible","baseUrl":"https://openrouter.ai/api/v1","keyEnv":"OPENROUTER_API_KEY","label":"OpenRouter","configured":false,"available":false,"logo":"/model-logos/openrouter.svg"},
    {"id":"maclustr","name":"MacLustr LLM","enabled":true,"lastDiscoveryAt":"2026-11-19T18:02:34.001Z","status":"no_key","statusDetail":"MACLUSTR_LLM_API_KEY is not set","kind":"openai_compatible","baseUrl":"https://llm.spboucher.ai/v1","keyEnv":"MACLUSTR_LLM_API_KEY","label":"MacLustr","configured":false,"available":false,"logo":"/model-logos/generic.svg"}
  ],
  "creators": [ {"id":"anthropic","name":"Anthropic","logo":"/model-logos/anthropic.svg","monogram":"AN","generic":false}, {"id":"openai","name":"OpenAI","logo":"/model-logos/generic.svg","monogram":"OA","generic":true}, … ],
  "hiddenUnavailable": 479,
  "routes": { … }, "defaultRoutes": { … }, "taskLabels": { … }, "benchmark": { … }      // unchanged from 2.x
}
```

`keyEnv` is the **name** of the environment variable; the key itself is never returned. `configured` = the variable is set;
`available` = configured and enabled. A provider without key is listed and never routed to.

A model (historical row fields kept, new fields after `updatedAt`):

```json
{"id":"claude-haiku-5-5","provider":"anthropic","displayName":"Claude Haiku 5.5","category":"text","available":true,"enabled":true,
 "contextWindow":1000000,"maxOutput":128000,"inputPrice":0.1,"cachedPrice":0.01,"outputPrice":0.5,
 "pricingSource":"https://platform.claude.com/docs/en/about-claude/pricing","probes":{"text":{"ms":592,"status":"ok"},"…":{}},"benchmark":{"…":"summary.json aggregate, unchanged"},
 "capabilities":{"…provider-declared keys, unchanged…":{},"text":true,"streaming":true,"tools":true,"structuredOutput":true,"jsonMode":true,"vision":true,"reasoning":true,"source":"measured"},
 "notes":[],"discoveredAt":"2026-11-01T07:03:46.768Z","probedAt":"2026-11-01T07:03:46.768Z","benchmarkedAt":"2026-11-01T07:18:30.317Z","createdAt":"…","updatedAt":"…",
 "creator":"anthropic","creatorName":"Anthropic","logo":"/model-logos/anthropic.svg","monogram":"AN",
 "route":"anthropic","routeLabel":"Anthropic API","routeKind":"anthropic","routeLogo":"/model-logos/anthropic.svg","remoteId":"claude-haiku-5-5",
 "context":1000000,"priceIn":0.1,"priceOut":0.5,"priceCached":0.01,"priceUnit":"USD per 1M tokens",
 "listed":true,"unavailableReason":null,"benchmarked":true,"autoRoutable":true}
```

The same creator through another route (returned with `unavailable=1`, `provider=openrouter` or `all=1` while OpenRouter has no key):

```json
{"id":"openrouter:anthropic/claude-fable-5","provider":"openrouter","displayName":"Anthropic: Claude Fable 5","category":"text","available":false,"enabled":true,
 "contextWindow":1000000,"maxOutput":128000,"inputPrice":10,"cachedPrice":1,"outputPrice":50,"pricingSource":"https://openrouter.ai/api/v1/models","probes":{},"benchmark":{},
 "capabilities":{"tools":true,"vision":true,"reasoning":true,"text":true,"streaming":true,"structuredOutput":true,"jsonMode":true,"source":"declared"},
 "notes":["listed by the provider's /models; not probed or benchmarked — selectable manually, never routed automatically"],
 "creator":"anthropic","creatorName":"Anthropic","logo":"/model-logos/anthropic.svg","monogram":"AN",
 "route":"openrouter","routeLabel":"OpenRouter","routeKind":"openai_compatible","routeLogo":"/model-logos/openrouter.svg","remoteId":"anthropic/claude-fable-5",
 "context":1000000,"priceIn":10,"priceOut":50,"priceCached":1,"priceUnit":"USD per 1M tokens",
 "listed":true,"unavailableReason":"no_key","benchmarked":false,"autoRoutable":false}
```

| field | meaning |
|---|---|
| `creator`, `creatorName`, `logo`, `monogram` | who made the model. `logo` = `/model-logos/<creator>.svg`, or `/model-logos/generic.svg` (then show `monogram`). Single-colour SVG: tint it (template image / CSS mask). Registry and licences: `docs/next/MODEL-LOGOS.md`, `/model-logos/registry.json`. |
| `route`, `routeLabel`, `routeKind`, `routeLogo`, `remoteId` | the API the call goes through (= provider id) — show it as a badge **distinct** from the creator. `routeKind`: `openai` \| `anthropic` \| `openai_compatible`. |
| `context` | context window in tokens (null = not published). Same value as the historical `contextWindow`. |
| `priceIn`, `priceOut`, `priceCached` | USD per 1M tokens (null = not published; `0` = free). Same values as `inputPrice` / `outputPrice` / `cachedPrice`. |
| `capabilities` | the stored provider object plus normalised booleans `text, streaming, tools, structuredOutput, jsonMode, vision, reasoning` (null = unknown) and `source`: `measured` (probed against the real API) \| `declared` (provider catalogue) \| `unknown`. |
| `available` | usable now. `unavailableReason`: `no_key` \| `provider_disabled` \| `not_listed` \| `disabled` \| null. `listed` = the provider still lists it. |
| `autoRoutable` / `benchmarked` | passed the measured probes → takes part in automatic routing. `false` = **manual selection only** (pass its `id` as `model`); automatic routing never picks it. |

Rules a picker must follow: group by `creator`; show the route badge; a model with `available:false` cannot be selected; "Auto" =
send `model: null`.

`POST /api/ai/models` (unchanged actions `toggle`, `routes`, `budget`; `discover` gains an optional provider):
`{"action":"discover","provider":"openrouter"}` → `{"openrouter":{"listed":479,"status":"no key"}}`. Discovery reads each provider's
`GET {base_url}/models`: context, prices and declared capabilities are stored as published. OpenRouter's catalogue is public and is read
even without a key (its models stay unavailable); another provider without key answers `{"listed":0,"status":"no key"}`.
Verified on 2026-11-19: `GET https://llm.spboucher.ai/health` → `200 {"status":"ok"}`; `GET https://llm.spboucher.ai/v1/models` without
key → `401` (so the MacLustr catalogue appears once `MACLUSTR_LLM_API_KEY` exists).

## 2. Ask My Knowledge — `POST /api/ai/chat` (SSE, SPEC §4.10)

Body (2.x fields unchanged; new fields marked ★):

| field | type | notes |
|---|---|---|
| `message` | string 1–60 000 | required |
| `mode` | `notes` (default) \| `summarise` \| `actions` \| `contradictions` \| `draft` \| `general` | unchanged |
| `conversationId`, `clientId`, `pageId`, `model`, `task`, `useWorkspace`, `confirmExpensive`, `images`, `scopePageIds` | | unchanged (`model` ≤ 200 chars now) |
| ★ `scope` | `all` (default) \| `page` \| `project` \| `selection` | where the evidence may come from. Applies to modes `notes`, `draft`, `contradictions`; `selection` only to `notes`. |
| ★ `projectId` | uuid | with `scope:"project"`: that page and all its descendants. Without it the project is the **root ancestor of `pageId`** and all its descendants. |
| ★ `selection` | string ≤ 20 000 | with `scope:"selection"`: the only text the model may use (no search is run). |
| ★ `selectionBlockId` | string | block the selection was made in; echoed as the citation's `blockId` only if that block exists in `pageId`. |

Events:

- `meta` `{conversationId, clientId, mode, model, provider, reason, task, sources: SourceRef[], weak: SourceRef[], evidence, sent, budgetNote, replayed, ★scope, ★scopePages, ★staleDropped}` — `scopePages` = number of pages in the scope (null = unrestricted); `staleDropped` = retrieved passages discarded because their text is no longer in the page.
- `text` `{delta}` (repeated)
- `done` `{messageId, content, usage, costUsd, latencyMs, ttftMs, sources: SourceRef[] (only the cited ones), evidence, invalidCitations: number[], uncited, replayed}`
- `needs_confirmation` `{reason, plan}` — unchanged
- `error` `{message, code, retryable, conversationId?, alternative?}` — codes: `not_configured`, `page_required`, `not_found`, `no_model`, `refused`, `provider_error`, `server_error`, ★`bad_scope`, ★`selection_required`

`SourceRef` = `{n, chunkId, pageId, title, icon, heading, blockId, excerpt, score, semantic, sourceType, ★blockIds, ★anchor, ★quote}`:

- `blockId` — the block that **best supports** the citation: in `meta`, the block of the retrieved passage closest to the question; in
  `done`, the block closest to the sentence(s) of the answer carrying `[n]`. (2.x returned the first block of a ~350-token passage.)
- `blockIds` — every block of the passage; `quote` — the first 300 characters of the anchored block as it is in the page now.
- `anchor` — `block` (verified in the current page content) · `page` (verified text, block without id) · `file` (attachment text, no
  block) · `selection`.
- Open a citation with `/p/<pageId>#block-<blockId>` (web) or by scrolling to the block with that `id` attr (natives).

Guarantees:

1. A citation marker `[n]` that does not correspond to a retrieved source is removed from `content` and reported in `invalidCitations`.
2. A retrieved passage whose text is no longer in the page (page edited or block deleted since indexing) is dropped **before** the
   model is called — a cited `blockId` always exists in the page as it is now.
3. With no supporting source, **no answering provider is called**: `content` starts with `**No supporting note found.**`,
   `evidence:"none"`, `costUsd:0`.
4. An answer that cites none of its sources is **withheld**: `content` = `**No supporting note found.** The model wrote an answer
   without citing any of the retrieved passages, …`, `evidence:"insufficient"`, `uncited:true`, `sources:[]`.

Request `{"message":"Quelle est la pénalité de remboursement anticipé ?","scope":"page","pageId":"2eea0ded-…","model":"claude-haiku-5-5","clientId":"live-ask-page-02"}`:

```text
data: {"type":"meta","conversationId":"fe873d65-75c5-4827-89d2-37e1e48918f6","clientId":"live-ask-page-02","mode":"notes","model":"claude-haiku-5-5","provider":"anthropic","reason":"user selection","task":"chat","sources":[{"n":1,"chunkId":"a8a64c4b-bafb-4afe-b4a6-2594f911b667","pageId":"2eea0ded-b5b8-4abe-b560-75345504be80","title":"Offre de la banque","icon":null,"heading":"Conditions","blockId":"XycxLnbyuq","excerpt":"Le taux fixe cinq ans proposé est de 4,29 %, garanti 90 jours.\nLa pénalité de remboursement anticipé équivaut à trois mois d intérêts.\nL amortissement restant est de vingt-deux ans.","score":0.016666666666666666,"semantic":0.644,"sourceType":"page","blockIds":["RttMYFvegP","XycxLnbyuq","8As7edcAjg"],"anchor":"block","quote":"La pénalité de remboursement anticipé équivaut à trois mois d intérêts."}],"weak":[],"evidence":"ok","sent":{"pageChars":0,"excerpts":1,"references":0,"images":0,"history":0,"embeddedBy":"openai","rankedBy":null},"budgetNote":null,"replayed":false,"scope":"page","scopePages":1,"staleDropped":0}

data: {"type":"text","delta":"La"}

data: {"type":"text","delta":" pénalité de rembours"}
…
data: {"type":"done","messageId":"e52caff5-2aa9-4bea-aafe-46431bc80021","content":"La pénalité de remboursement anticipé équivaut à trois mois d'intérêts [1].","usage":{"inputTokens":553,"outputTokens":34,"cachedTokens":0,"reasoningTokens":0},"costUsd":0.00007230000000000001,"latencyMs":1213,"ttftMs":953,"sources":[{"n":1,"chunkId":"a8a64c4b-…","pageId":"2eea0ded-…","title":"Offre de la banque","icon":null,"heading":"Conditions","blockId":"XycxLnbyuq","excerpt":"…","score":0.016666666666666666,"semantic":0.644,"sourceType":"page","blockIds":["RttMYFvegP","XycxLnbyuq","8As7edcAjg"],"anchor":"block","quote":"La pénalité de remboursement anticipé équivaut à trois mois d intérêts."}],"evidence":"ok","invalidCitations":[],"uncited":false,"replayed":false}

data: [DONE]
```

(The passage covers three paragraphs; the citation is anchored to the second one, `XycxLnbyuq`, which states the penalty.)

`scope:"selection"` — `{"message":"Combien d années reste-t-il ?","scope":"selection","selection":"L amortissement restant est de vingt-deux ans.","pageId":"2eea0ded-…","model":"claude-haiku-5-5"}`:

```text
data: {"type":"meta",…,"sources":[{"n":1,"chunkId":"selection","pageId":"2eea0ded-b5b8-4abe-b560-75345504be80","title":"Offre de la banque","icon":null,"heading":null,"blockId":null,"excerpt":"L amortissement restant est de vingt-deux ans.","score":1,"semantic":1,"sourceType":"selection","blockIds":[],"anchor":"selection","quote":"L amortissement restant est de vingt-deux ans."}],"weak":[],"evidence":"ok","sent":{"pageChars":0,"excerpts":1,"references":0,"images":0,"history":0,"embeddedBy":null,"rankedBy":null},…,"scope":"selection","scopePages":null,"staleDropped":0}

data: {"type":"done","messageId":"e2b5e9ee-…","content":"Il reste vingt-deux ans d'amortissement [1].","usage":{"inputTokens":476,"outputTokens":23,"cachedTokens":0,"reasoningTokens":0},"costUsd":0.0000591,"latencyMs":726,"ttftMs":485,"sources":[{…same source…}],"evidence":"ok","invalidCitations":[],"uncited":false,"replayed":false}
```

(`blockId` is null here because the request carried no `selectionBlockId`.)

No support (`{"message":"Quel est le prix du baril de pétrole ?","scope":"project","pageId":"2eea0ded-…"}`):

```text
data: {"type":"meta","conversationId":"27a49df1-…","clientId":"live-ask-none-02","mode":"notes","model":null,"provider":null,"reason":"no supporting source — no answering provider called","task":"chat","sources":[],"weak":[],"evidence":"none","sent":{"pageChars":0,"excerpts":0,"references":0,"images":0,"history":0,"embeddedBy":"openai","rankedBy":null},"budgetNote":null,"replayed":false,"scope":"project","scopePages":2,"staleDropped":0}

data: {"type":"text","delta":"**No supporting note found.** I searched your workspace and found nothing relevant enough to support an answer. I am not answering from general knowledge as if it came from your notes."}

data: {"type":"done","messageId":"228b8624-…","content":"**No supporting note found.** …","usage":null,"costUsd":0,"latencyMs":0,"ttftMs":null,"sources":[],"evidence":"none","invalidCitations":[],"uncited":false,"replayed":false}
```

Scope error (`{"message":"x","scope":"page"}` without `pageId`) — nothing stored, nothing sent:

```text
data: {"type":"error","code":"page_required","retryable":false,"message":"This scope works on an open page: open a page first."}

data: [DONE]
```

## 3. Inline actions — `POST /api/ai/action` (SSE, SPEC §4.10)

Body: `{action, text ≤ 120 000, instruction? ≤ 4000, model? ≤ 200, language?, confirmExpensive?, ★pageId?}`.
`action` = one of the 21 historical ids (`rewrite, fix, translate, summarize, expand, explain, to_list, to_tasks, table, shorten, formal,
simplify, translate_fr, translate_en, explain_math, continue, outline, study_notes, action_items, contradictions, custom`) or ★
`coherence`, `questions`, `synthesis`, `structure`, `links`.

Pre-stream errors (JSON, unchanged): `400 bad_language`, `400 no_instruction`, `503 no_model` / `not_configured`,
`409 confirm_expensive {plan}`; ★ `400 no_text` (`links` with empty text).

`coherence` (logic, terminology, internal contradictions), `questions` (open questions the text raises), `synthesis`, `structure`
(a better outline + what to move/merge/cut) stream Markdown exactly like the historical actions; none is an expensive class:

```text
data: {"type":"meta","model":"claude-haiku-5-5","provider":"anthropic","reason":"user selection","budgetNote":null}

data: {"type":"text","delta":"-"}

data: {"type":"text","delta":" Le taux de"}
…
data: {"type":"done","usage":{"inputTokens":262,"outputTokens":1230,"cachedTokens":0,"reasoningTokens":…},"costUsd":0.000641,"latencyMs":…}

data: [DONE]
```

Failure inside the stream: `{"type":"error","code":"refused"|"provider_error","retryable":true,"message":…}`.

★ `links` — suggested internal links, **as data; nothing is written**. The server retrieves candidate pages (never the page `pageId`
itself nor a page it already links to), the model picks among them through a strict JSON schema, each pick is validated (an unknown
index is dropped; an `anchorText` that is not literally in `text` becomes `null`). No `text` events:

Request `{"action":"links","text":"Avant de signer, vérifier la pénalité de remboursement anticipé et le taux fixe proposé.","pageId":"1280ae37-…","model":"claude-haiku-5-5"}`:

```text
data: {"type":"meta","model":"claude-haiku-5-5","provider":"anthropic","reason":"user selection","budgetNote":null}

data: {"type":"result","data":{"ai":true,"model":"claude-haiku-5-5","links":[{"pageId":"2eea0ded-b5b8-4abe-b560-75345504be80","title":"Offre de la banque","icon":null,"blockId":"RttMYFvegP","excerpt":"Le taux fixe cinq ans proposé est de 4,29 %, garanti 90 jours. La pénalité de remboursement anticipé équivaut à trois mois d intérêts. L amortissement restant est de vingt-deux ans.","score":0.016666666666666666,"anchorText":"pénalité de remboursement anticipé","reason":"Donne les conditions chiffrées de la pénalité et du taux fixe évoqués dans la note."},{"pageId":"020cc747-b513-42f2-86b5-261f5ed48453","title":"Refinancement du triplex","icon":null,"blockId":"SLHKAchLmY","excerpt":"Dossier de refinancement du triplex de la rue Laurier, ouvert en novembre 2026.","score":0.015625,"anchorText":"taux fixe proposé","reason":"Dossier de refinancement qui contextualise l'offre de taux à vérifier avant signature."}],"candidates":4}}

data: {"type":"done","usage":{"inputTokens":886,"outputTokens":134,"cachedTokens":0,"reasoningTokens":0},"costUsd":0.00015560000000000001,"latencyMs":2269}

data: [DONE]
```

When no candidate page exists no provider is called: `meta {model:null, reason:"no candidate page — no provider called"}`,
`result {data:{ai:true, links:[], candidates:0}}`, `done {usage:null, costUsd:0, latencyMs:0}`. Invalid model JSON →
`{"type":"error","code":"bad_output","retryable":true,…}`. The client turns an accepted suggestion into a link on `anchorText`
(or inserts a mention) through a normal page save.

`GET /api/ai/chat/plan` is unchanged (it accepts the new action ids in `action=`).

## 4. Semantic zoom, level 1 — `/api/pages/<id>/zoom/ai` (SPEC §4.9)

The AI synopsis of a page, cached by content hash (title + Markdown). The foundation route `GET /api/pages/<id>/zoom?level=1` returns
the same object (it calls the same function); this route also lets a client read the cache without spending, and regenerate.

- `GET /api/pages/<id>/zoom/ai` → synopsis; generated (one cheap model call, route `quick`) when missing or stale.
  `?cachedOnly=1` → never calls a provider. `?model=<id>` → manual model.
- `POST /api/pages/<id>/zoom/ai` `{model?}` → regenerate.

```json
{"pageId":"2eea0ded-b5b8-4abe-b560-75345504be80","level":1,"contentHash":"20156a7accd058b5857a3744a185c6de","ai":true,"status":"ready","synopsis":"La note décrit une offre de prêt bancaire : un taux fixe sur cinq ans de 4,29 %, garanti pendant 90 jours, avec une durée d'amortissement restante de vingt-deux ans. Elle précise qu'un remboursement anticipé coûte une pénalité équivalant à trois mois d'intérêts. Aucune question ouverte ni comparaison n'y figure.","model":"claude-haiku-5-5","provider":"anthropic","generatedAt":"2026-11-19T18:22:22.977Z","cached":false,"costUsd":0.0001022}
```

Second call: identical, with `"cached":true` (no provider call). With `?cachedOnly=1` before any generation:

```json
{"pageId":"2eea0ded-b5b8-4abe-b560-75345504be80","level":1,"contentHash":"20156a7accd058b5857a3744a185c6de","ai":false,"status":"missing","synopsis":null,"model":null,"provider":null,"generatedAt":null,"cached":false,"costUsd":null}
```

`status`: `ready` \| `missing` (cachedOnly, nothing valid cached) \| `empty` (page without text — no call, `ai:false`).
Errors: `400 bad_id`, `404` page, `503 no_model`, `502 provider_error` \| `refused` (nothing is cached on failure).
Any edit or rename changes `contentHash` and invalidates the synopsis.

## 5. Smart Inbox (SPEC §4.12)

### 5.0 `POST /api/capture` — kinds (3.0, branch `next-p-cv`)

Body unchanged: `{kind, text?, url?, attachmentIds?}` → `201 {id, title, kind, inboxAt}` (`kind` = the stored `pages.capture_kind`).

| kind | stored as | content |
|---|---|---|
| `note`, `tasks`, `link`, `photo`, `file` | same | unchanged from 2.x |
| `audio` | `audio` | each audio attachment becomes an **`audio` node** (`attachmentId`, `title`, `transcriptStatus:"none"`) instead of a file card, so the capture is a voice note that can be transcribed (§6); non-audio attachments keep their card |
| `screenshot` | `screenshot` | like `photo` (image nodes); default title `Screenshot · <date>` |
| `document` | `document` | a PDF attachment becomes a **`pdf` node** (`attachmentId`, `name`, `page:1`, `annotations:[]`), other files a file card |
| `selection` | `selection` | `text` (required) as a `blockquote`; `url` = its source, either `/p/<pageId>` / `/p/<pageId>#block-<blockId>` (kept relative: the capture then appears in that page's backlinks) or an http(s) address; any other value is ignored |
| `idea` | **`note`** | request-only alias: a note created with the icon 💡 (the stored kinds stay the ones of SPEC §4.12) |

### 5.1 `GET /api/inbox/<id>/suggestions`

AI suggestions for one capture: title, tags, destination, related pages, summary. **Suggestions only — this route changes nothing.**
Strict JSON schema; the model answers with indices into a candidate list built by the server, so a destination or a relation is always
an existing page; tags are normalised and flagged existing / new. Cached by content hash (title + text + tags of the capture) and
re-validated on every read. `?refresh=1` regenerates · `?cachedOnly=1` never calls a provider · `?model=<id>`.

```json
{"pageId":"d420eb53-5bce-4ee5-a419-5c70cef55c7a","contentHash":"c0218f0950c5aad9b1170269bc6f4f2c","status":"ready","ai":true,"model":"claude-haiku-5-5","provider":"anthropic","generatedAt":"2026-11-19T18:24:12.565Z","cached":false,"costUsd":0.00010823,
 "suggestions":{
  "title":{"value":"Rappeler la banque triplex","current":"rappeler la banque triplex"},
  "tags":[{"name":"refinancement","existing":true},{"name":"triplex","existing":true},{"name":"banque","existing":true}],
  "destination":{"section":"projects","parentId":"020cc747-b513-42f2-86b5-261f5ed48453","parentTitle":"Refinancement du triplex"},
  "relations":[{"pageId":"2eea0ded-b5b8-4abe-b560-75345504be80","title":"Offre de la banque","icon":null,"reason":"L'offre de la banque concerne probablement le même financement et la garantie de taux en question."}],
  "summary":"Rappeler la banque pour demander si la garantie de taux de 90 jours peut être prolongée dans le cadre du refinancement du triplex."}}
```

Each key of `suggestions` may be null / empty: `title` is null when the model keeps the current title; `destination` is
`{section, parentId:null, parentTitle:null}` when only a section is proposed, or null. `status:"empty"` (`ai:false`, empty
suggestions) for a capture with no title and no text. Errors: `400 bad_id`, `404` page, `409 not_in_inbox`,
`404 not_generated` (cachedOnly), `503 no_model`, `502 provider_error` \| `refused` \| `bad_output`.

### 5.2 `POST /api/inbox/<id>/apply`

Applies **the subset the user chose**, with the values sent (the user may have edited them). Only the keys present are applied.

Body (all optional, at least one): `{title?: string ≤300, tags?: string[] ≤10, destination?: {section?: notes|documents|projects|research, parentId?: uuid|null}, relations?: [{pageId, reason?}] ≤10, summary?: string ≤1000}`.

- `title` → the page is renamed (a version "before AI suggestion" is kept).
- `tags` → added to the existing tags. `relations` → accepted relations to those pages (`knowledge_edges`, kind `ai_suggested`,
  status `accepted`).
- `summary` → inserted as the first block, as an `aiBlock` (`attrs.action = "summary"`) — it stays visibly AI.
- `destination` → the capture is filed (leaves the inbox). Without `destination` it **stays in the inbox**.

```json
{"actionId":"68415a83-438b-46cf-b85e-25bfba7246be","summary":"4 suggestions applied","applied":["title","summary","tags","relations"],"filed":false,"created":{"summaryBlockId":"AW23RJ67ft","tagsAdded":["refinancement","triplex","banque"],"edgeIds":["bed79a14-d9c0-45ba-b641-383f4ae40f9d"]}}
```

Errors (validated before any write): `400 nothing_to_apply` (`{"error":"Nothing chosen to apply","code":"nothing_to_apply"}`),
`400 bad_section` \| `bad_destination` \| `bad_relation`, `409 not_in_inbox`, `409 conflict` (page changed meanwhile).

### 5.3 Undo — `POST /api/inbox/undo` `{actionId}` (existing route)

Reverses the action journaled above exactly like a triage action: title, added tags, the inserted summary block, the created
relations and the filing. Later edits by the user (other tags, other text) are left alone. → `{"ok":true,"already":false}`
(`already:true` when repeated). The journal action name is `suggestions`.

## 6. Voice (SPEC §4.13)

### 6.1 `POST /api/audio/<attachmentId>/transcribe`

Body `{summarize?: boolean, force?: boolean}`. Queues the pg-boss job `transcribe` (never retried automatically: it is a paid call).

- `202` — a job was queued:

```json
{"queued":true,"jobId":"1b60aa7a-da87-4306-b323-e37c5f233ca9","attachmentId":"82f70f18-d19f-4d58-ba81-8a4d72099e17","status":"pending","transcript":[],"text":"","engine":null,"model":null,"language":null,"duration":null,"segments":null,"summary":null,"error":null,"costUsd":null,"requestedAt":"2026-11-19T18:22:31.175Z","finishedAt":null}
```

- `200` `{"queued":false, …current state…}` — a transcript already exists or is pending (no second call, no second charge).
  `force:true` transcribes again; `summarize:true` on a finished transcript without summary queues the summary only.
- Errors: `400 bad_id` · `404` unknown attachment (`{"error":"Attachment not found"}`) · `415 not_audio` · `413 too_large`
  (> 25 MB, the engine's limit) · `503 not_configured` (no OpenAI key) \| `queue_unavailable`.

Accepted: `audio/*`, `video/webm`, `video/mp4` in a container the engine reads (webm, m4a/mp4, mp3, wav, ogg, flac).

### 6.2 `GET /api/audio/<attachmentId>`

Poll every 2–3 s while `status` is `pending`.

```json
{"attachmentId":"82f70f18-d19f-4d58-ba81-8a4d72099e17","status":"done",
 "transcript":[{"t":0,"text":"Réunion du 19 novembre. Nous retenons le taux fixe de 5 ans."},{"t":4.4,"text":"Marie envoie les documents à la banque lundi matin."}],
 "text":"Réunion du 19 novembre. Nous retenons le taux fixe de 5 ans. Marie envoie les documents à la banque lundi matin.",
 "engine":"openai","model":"whisper-1","language":"french","duration":6.869999885559082,"segments":true,
 "summary":{"at":"2026-11-19T18:22:36.405Z","text":"Réunion du 19 novembre. Ils retiennent un taux fixe de 5 ans. Marie enverra les documents à la banque lundi matin.","model":"gpt-5.4-mini","tasks":["Marie envoie les documents à la banque lundi matin."],"decisions":["Ils retiennent le taux fixe de 5 ans."]},
 "error":null,"costUsd":null,"requestedAt":"2026-11-19T18:22:31.175Z","finishedAt":"2026-11-19T18:22:36.408Z"}
```

(Real run: 6.8 s of French speech synthesized with macOS `say`, 32 KB m4a, transcribed in about 2 s. Transcripts stored after this
run round `duration` to 0.01 s.)

| field | meaning |
|---|---|
| `status` | `none` (never requested) \| `pending` \| `done` \| `failed` |
| `transcript` | `[{t: seconds from the start, text}]` — exactly the `audio` node's `transcript` attr |
| `engine`, `model` | what actually produced the transcript (`audio.transcriptEngine` = `"<engine>:<model>"` is a reasonable client value) |
| `segments` | `true` when the model returns timestamps; `false` = text-only model, one segment at `t:0` |
| `summary` | `{text, decisions[], tasks[], model, at}` or null — the `audio` node's `summary` attr |
| `error` | reason when `failed`; when `done`, a non-null value means the summary could not be produced (`Summary not produced: …`) |
| `costUsd` | null unless the owner set `settings['ai.transcription_usd_per_minute']` (transcription prices are not in the catalogue) |

Engine choice: the transcription models the OpenAI account exposes are discovered live. On 2026-11-19 the account exposes
`gpt-4o-mini-transcribe`, `gpt-4o-mini-transcribe-2025-03-20`, `gpt-4o-mini-transcribe-2025-12-15`, `gpt-4o-transcribe`,
`gpt-4o-transcribe-diarize`, `gpt-transcribe`, `whisper-1`; `whisper-1` is chosen because it returns segment timestamps
(`verbose_json`), then a diarising model, then text-only models. Override with `settings['ai.transcription_model']`.

**Who writes the `audio` node**: the client. When `status` becomes `done`, the editor copies `transcript`, `transcriptStatus:"done"`,
`transcriptEngine`, `summary` into the node and saves the page normally (versioned). The server does not edit the page.

## 7. Smart database properties

The property type `ai` keeps working as in 2.x (`config.prompt`, manual "Generate" per cell). New: per-property configuration, a run
log, protection of hand-edited values, optional auto-run.

### 7.1 Configuration — `/api/databases/<id>/ai/config`

`GET` → `{"tasks":["custom","summarize","classify","extract","detect-date","categorize"],"properties":[…]}`:

```json
{"tasks":["custom","summarize","classify","extract","detect-date","categorize"],"properties":[{"propertyId":"3981f845-97b9-47f0-b153-96ef517c8e4c","name":"Priorité IA","ai":{"task":"classify","prompt":"","choices":["Urgent","Normal","Plus tard"],"model":"claude-haiku-5-5","autoRun":true,"managed":false},"problem":null,"runs":{"queued":0,"done":1,"failed":0,"skipped":1,"costUsd":0.0000626,"lastAt":"2026-11-19T18:22:41.699Z"}}]}
```

`PUT` `{propertyId, ai: {task?, prompt? ≤4000, choices? string[] ≤40, model? | null, autoRun?, managed?}}` (partial, merged) →

```json
{"propertyId":"3981f845-97b9-47f0-b153-96ef517c8e4c","name":"Priorité IA","ai":{"task":"classify","prompt":"","choices":["Urgent","Normal","Plus tard"],"model":"claude-haiku-5-5","autoRun":true,"managed":false},"problem":null}
```

| `ai` field | meaning |
|---|---|
| `task` | `custom` (free prompt, the 2.x behaviour) · `summarize` · `classify` (exactly one of `choices`) · `extract` (what `prompt` describes, copied faithfully) · `detect-date` (ISO `YYYY-MM-DD`) · `categorize` (zero or more of `choices`, or ≤ 3 free categories) |
| `prompt` | required for `custom` and `extract`; optional guidance otherwise. `{{Property name}}` placeholders. Mirrored in the historical `config.prompt`. |
| `choices` | allowed values for `classify` (≥ 2) / `categorize` |
| `model` | model override (an id of §1); null = measured route (`quick` / `extract`) |
| `autoRun` | recompute the cell when another value of the row changes (API row create / update) |
| `managed` | the property is AI-managed: the AI may overwrite a value typed by hand |

`problem` is a string when the configuration cannot run (`"No prompt configured"`, `"Classification needs at least two choices"`, …).
Errors: `400 not_ai_property`, `404`. The stored shape is `database_properties.config.ai` — the generic property `PATCH` still works.

An answer outside the task's contract (a class that is not a choice, an impossible date, invalid JSON) stores **null**, never a guess.
Cell values stay plain text (`"Urgent"`, `"2027-03-03"`, `"a, b"`), `{"pending":true,"at":…}` while queued, `{"error":…}` on failure.

### 7.2 Run — `POST /api/databases/<id>/ai` (existing route)

Body `{propertyId, rowId | rowIds[] ≤200, force?}`. Historical answer keys kept (`ok`, `queued`), plus `runs` and `skipped`.

A cell whose value was typed by hand is **not** overwritten unless the property is `managed` or `force:true` is sent:

```json
{"ok":true,"queued":0,"runs":[{"rowId":"93e5f9e5-5f6e-4c40-ab8c-9ac28e28c524","runId":"d93a25ed-1f05-4353-ab79-f8f1e60082be","queued":false,"skipped":"user_edited"}],"skipped":[{"rowId":"93e5f9e5-5f6e-4c40-ab8c-9ac28e28c524","reason":"user_edited","runId":"d93a25ed-1f05-4353-ab79-f8f1e60082be"}]}
```

`skipped` reasons: `user_edited` · `bad_config` · `already_queued` (pending < 5 min) · `over_budget` (auto-run only) ·
`queue_unavailable`. A skipped cell is left exactly as it was. "Typed by hand" = a non-empty value that differs from the output of
the last successful run of that cell.

### 7.3 Run log — `GET /api/databases/<id>/ai/runs?propertyId=&rowId=&status=&limit=`

Newest first, ≤ 500:

```json
[{"id":"303848ec-ce88-471b-9923-92e0c4ba7f60","databaseId":"03f4d928-e8ad-4dea-b6cc-f307e04303d4","propertyId":"3981f845-97b9-47f0-b153-96ef517c8e4c","rowId":"93e5f9e5-5f6e-4c40-ab8c-9ac28e28c524","status":"done","trigger":"auto","task":"classify","model":"claude-haiku-5-5","provider":"anthropic","inputTokens":561,"outputTokens":13,"costUsd":0.0000626,"error":null,"createdAt":"2026-11-19T18:22:37.475Z","startedAt":"2026-11-19T18:22:38.173Z","finishedAt":"2026-11-19T18:22:41.153Z"}]
```

`status`: `queued` \| `running` \| `done` \| `failed` \| `skipped` · `trigger`: `manual` \| `auto`. (This run was triggered by creating
the row: the cell became `"Urgent"` 3.7 s later.)

### 7.4 Auto-run

After `POST` / `PATCH /api/databases/<id>/rows`, every AI property with `autoRun:true` is queued for the changed row — never when the
change only touched AI cells, never over a hand-edited value (unless `managed`), never when the daily AI budget is reached. The row
write never fails because of it. Clients poll the row (the existing 2.5 s polling while a value is `pending`) or the run log.

## 8. Research (SPEC §4.14)

### 8.1 `GET /api/research/export.tex?projectId=<page id>[&format=tex|json|zip][&inline=1]`

LaTeX article skeleton of a project = the page `projectId` and all its live descendants in tree order (database rows and archived
pages left out). No AI is involved. Root page body first (its "Abstract" / "Résumé" heading becomes `\begin{abstract}`), then one
`\section` per child page, nested by depth; `hypothesis` callouts are also collected in a "Hypotheses" section; the project's
experiments become "Methods notes"; equations are kept verbatim (`inlineMath` → `$…$`, `blockMath` → `equation`); images become
`\includegraphics{figures/<attachment name>}` **placeholders**; `\cite{…}` typed in the text is preserved; `citation` nodes become
`\cite[locator]{key}` (a missing reference becomes a visible `[?]` + a comment, never an invented key).

- `format=tex` (default) → `application/x-tex`; headers
  `x-export-report: {"pages":2,"sections":1,"citeKeys":0,"missingKeys":0,"missingRefs":0,"figures":0,"hypotheses":0,"experiments":0,"unknownNodes":[]}` and
  `x-bib-url: /api/research/references/export.bib?projectId=020cc747-…`; `inline=1` omits `content-disposition`.

```latex
% Generated by SP Note — LaTeX skeleton of the project "Refinancement du triplex"
% 2 page(s), 0 cite key(s), 0 figure placeholder(s). Figures are expected in ./figures/ (see the ZIP export).
\documentclass[11pt]{article}
\usepackage[T1]{fontenc}
\usepackage[utf8]{inputenc}
\usepackage{amsmath,amssymb}
\usepackage{graphicx}
\usepackage[normalem]{ulem}
\usepackage{hyperref}

\title{Refinancement du triplex}
\author{Simon-Pierre Boucher}
\date{\today}

\begin{document}
\maketitle

Dossier de refinancement du triplex de la rue Laurier, ouvert en novembre 2026.

\section{Offre de la banque}
% page 2eea0ded-b5b8-4abe-b560-75345504be80
\subsection{Conditions}

Le taux fixe cinq ans proposé est de 4,29 \%, garanti 90 jours.
…
\bibliographystyle{plain}
\bibliography{references}
\end{document}
```

- `format=json` → `{"projectId", "title", "tex", "bib", "citeKeys":[], "missingKeys":[], "missingRefs":[], "figures":[{"attachmentId","name","file"}], "sections":1, "hypotheses":0, "experiments":0, "unknownNodes":[], "bibUrl"}`
  — `missingKeys` = cited but absent from the library; `figures[].file` = the name used in `\includegraphics{figures/<file>}`.
- `format=zip` → `application/zip` with `main.tex`, `references.bib`, `figures/<file>` (the real attachments present on disk, ≤ 150 MB)
  and `export-report.json` (`figuresIncluded`, `figuresMissing`, `missingKeyList`).

Errors: `400 bad_id` (`{"error":"projectId is required (a page id)","code":"bad_id"}`), `400 bad_format`, `404 not_found`.

### 8.2 `.bib` companion — `GET /api/research/references/export.bib?projectId=<page id>[&inline=1]`

The existing BibTeX export, scoped to the project: references attached to any page of the project **plus** every library reference
cited by key or by a `citation` node in its text. (`?pageId=` and the whole-library form are unchanged.)

```bibtex
@article{doe2021prepayment,
  author  = {Doe, Jane and Roe, John},
  title   = {Mortgage Prepayment and the Term Structure},
  journal = {Journal of Housing Finance},
  year    = {2021}
}
```

### 8.3 `GET /api/research/references`

- `?pageId=` and no parameter — unchanged.
- ★ `?projectId=<page id>` → the same set as §8.2, as reference rows.
- ★ `?ids=<uuid,uuid,…>` (≤ 200) → exactly those references, for resolving `citation` nodes; each row gains `label` (author–year)
  and `citation` (formatted entry). Ids that do not exist are listed in the response header `x-missing-ids`.

```json
[{"id":"54879947-9c63-455b-8e67-afa8cab80953","workspaceId":"…","pageId":"2eea0ded-b5b8-4abe-b560-75345504be80","citeKey":"doe2021prepayment","entryType":"article","title":"Mortgage Prepayment and the Term Structure","authors":["Jane Doe","John Roe"],"year":2021,"journal":"Journal of Housing Finance","doi":null,"url":null,"bibtex":"@article{doe2021prepayment,\n  author  = {Doe, Jane and Roe, John},\n  …}","fields":{"year":"2021","title":"…","author":"Doe, Jane and Roe, John","journal":"Journal of Housing Finance"},"verified":"user","attachmentId":null,"createdAt":"2026-11-19T18:22:41.721Z","updatedAt":"2026-11-19T18:22:41.721Z","deletedAt":null,"label":"Doe & Roe (2021)","citation":"Doe, J., & Roe, J. (2021). Mortgage Prepayment and the Term Structure. Journal of Housing Finance."}]
```

with `x-missing-ids: 00000000-0000-4000-8000-000000000000`. Errors: `400 bad_id`, `400 too_many_ids`.

- ★ (slice next-p-ra) `?attachmentId=<attachment id>` → the references whose attached PDF is that file, each with `label`; used by the
  `pdf` block to save its annotations as extracts of that reference (extract id derived from attachment id + annotation id, see
  `src/lib/research/pdf-extracts.ts`; `POST …/extracts {id,…}` is idempotent on it). `400 bad_id` on a malformed id.

### 8.4 `POST /api/research/papers` — `kind` (slice next-p-ra, additive)

`{title?, status?, venue?, kind?: "paper" | "project"}`. Default `paper` = unchanged. `project` creates the root research page
(`properties.researchKind = "project"`) and five child pages (Hypotheses, Methods notes, Equations, Results, Figures;
`properties.researchRole`), and answers the root page plus `children: [{id, title, key}]` — the tree `export.tex` turns into sections.

## 9. Error codes introduced by this workstream

| code | status | where |
|---|---|---|
| `bad_scope`, `selection_required` | SSE `error` | chat |
| `no_text`, `bad_output` | 400 / SSE `error` | action `links` |
| `no_model` | 503 | zoom, inbox suggestions (no eligible model / no key) |
| `provider_error`, `refused`, `bad_output` | 502 | zoom, inbox suggestions |
| `not_generated` | 404 | inbox suggestions with `cachedOnly=1` |
| `not_in_inbox` | 409 | inbox suggestions / apply |
| `nothing_to_apply`, `bad_section`, `bad_destination`, `bad_relation` | 400 | inbox apply |
| `not_audio` (415), `too_large` (413), `not_configured`, `queue_unavailable` (503) | | transcription |
| `not_ai_property` | 400 | database AI config / run |
| `bad_format`, `too_many_ids`, `bad_id` | 400 | research, every route (malformed id) |

## 10. Data added (migration `0004_next_ai`, additive; rollback `0004_next_ai.down.sql`)

`ai_providers` + `kind`, `base_url`, `key_env`, `label` (rows `openrouter`, `maclustr` seeded) · `ai_models` + `creator`, `route` ·
tables `ai_synopses`, `inbox_suggestions`, `audio_transcripts`, `ai_property_runs`. New queue: `transcribe`. New settings keys:
`ai.transcription_model`, `ai.transcription_models` (cache of the discovered ids), `ai.transcription_usd_per_minute`.
`ai_usage.task` values added: `zoom`, `inbox_suggest`, `transcribe`, `transcribe_summary`, `action:links` (and `action:<new id>`).

Deviations from SPEC v1, to keep in mind when coding against it:

- §3.5 lists `context_window`, `price_in`, `price_out`, `capabilities` as new `ai_models` columns: they already existed
  (`context_window`, `input_price`, `output_price`, `capabilities`) and are **not duplicated** — the API exposes them as `context`,
  `priceIn`, `priceOut` (and keeps the historical names).
- §4.13 says the result is written into the `audio` node "through a normal versioned save": that save is done **by the client**
  (§6.2); the server only stores the transcript in `audio_transcripts`.
- §4.9: level 1 lives at `/api/pages/<id>/zoom/ai` in this branch; `…/zoom?level=1` is wired to it at merge.
- Events (`ai.applied`, …, SPEC §3.2) are not written by these routes yet: `knowledge_events` belongs to migration 0003 (wired at merge).
