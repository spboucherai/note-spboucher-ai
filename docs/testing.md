# Testing — what is checked, how, and what is not

All automated tests run against a **scratch database** (`DATABASE_URL` ending in `_dev`, `_test` or `_scratch`; the suites refuse anything else) and a build served on another port than production. Production data is never used for validation.

## Commands
| Command | What it runs |
|---|---|
| `pnpm typecheck` | `tsc --noEmit` (strict) |
| `pnpm test` | `node:test` suites in `tests/unit` through tsx (need the scratch database) |
| `pnpm test:e2e` | Playwright (Chromium) against `E2E_BASE_URL` (default `http://localhost:8481`) |
| `bash scripts/smoke.sh [url]` | public-surface checks after a deployment |
| `bash scripts/restore.sh --latest --verify-only` | restore drill into a throw-away database |

Set-up of a scratch environment on the node: a git worktree outside `~/apps`, its own `.env` (database `note_dev`, `PORT=8481`, `APP_URL=http://localhost:8481`, its own `DATA_DIR`/`BACKUP_DIR`, `BACKUP_OFFSITE` empty), `pnpm db:migrate`, `pnpm build`, `next start -p 8481`, `tsx src/worker/index.ts`.

## Suite map (3.0, integration branch) — what exists, how to run it, what costs money

PostgreSQL on the node is shared with production and the scratch database accepts 20 connections: **one server + one worker + one
test run at a time**, always with `DB_POOL_MAX=2` (it is in the worktree's `.env`). Never two suites in parallel. On the integration
worktree (`~/dev/note-next-int`, port 8486) the server and the worker are managed only by `bash ~/dev/note-next-int-data/srv.sh
start|stop|restart|build`. Every command below starts with `set -a && . ./.env && set +a`.

| Suite | Command | Needs | Notes |
|---|---|---|---|
| types | `pnpm typecheck` | — | |
| contrast | `pnpm contrast` | — | WCAG pairs of the colour tokens, both themes (incl. the small-text variants) |
| unit / service (`tests/unit`, 44 files) | `pnpm test` | scratch DB; **worker stopped** | a running worker takes the jobs of `jobs.test.ts`: `kill "$(cat ~/dev/note-next-int-data/worker.pid)"` first (PID file only, never `pkill`), `srv.sh restart` afterwards. Hermetic: provider keys removed, fake model |
| HTTP contract (`tests/http`, 4 files) | `pnpm test:http` | running server | routes over real HTTP: auth, Origin on every mutating method of every `route.ts`, status codes and `code`s, idempotency, Range, feed. **No model call** (zoom level 1 is read with `cachedOnly=1`, search with `semantic=0`) |
| end-to-end (`tests/e2e`, Playwright) | `E2E_BASE_URL=$APP_URL pnpm test:e2e` | running server + worker | ~180 tests, ~25 min, one worker. Its global set-up **resets passkeys and revokes every session** of the scratch database (dev tokens of other clients included) |
| one e2e project | `E2E_BASE_URL=$APP_URL pnpm exec playwright test --project=next-integration` (add `-g "title"`) | same | the `auth` project always runs first (dependency). Projects: `auth`, `phone-360`, `iphone-se`, `iphone-max`, `desktop`, `next-desktop`, `next-phone-*`, `next-canvas`, `next-canvas-phone-*`, `next-p-offline`, `next-p-offline-phone-*`, `next-p-ra`, `next-p-cv`, `next-p-cv-phone-*`, `next-p-db`, `next-p-db-phone-*`, `next-k-desktop`, `next-k-phone-*`, `next-integration` |
| performance probe | `node_modules/.bin/tsx scripts/next-perf.ts` | running server | first-load JS per screen (raw / gzip) with the heavy libraries found in it, and API timings. No model call |
| API examples | `node_modules/.bin/tsx scripts/next-api-examples.ts && python3 scripts/next-api-doc.py` | running server | regenerates `docs/next/examples.json` and `API-NEXT.md` from the template. No model call |

**Opt-in suites that call paid providers** (never run by the commands above; a fraction of a cent each):

| What | How |
|---|---|
| `tests/unit/ai-live.test.ts` | `AI_LIVE=1 node_modules/.bin/tsx --test --test-force-exit tests/unit/ai-live.test.ts` (stop the worker first) |
| e2e tests titled « REAL provider / REAL engine » (`next-p-cv`, `next-p-db`) | `E2E_REAL_AI=1 … playwright test --project=next-p-cv` |
| brief summary, AI synopsis, insights and Ask against a real model (`next-k`) | `E2E_LIVE_AI=1 … playwright test --project=next-k-desktop` |
| `node tests/e2e/live-ai.mjs` | by hand |
| every 3.0 AI path once, with the real providers and the live worker (Ask in the four scopes, the five new actions, graph insights job, Smart Inbox + apply + undo, smart properties, voice note, synopsis, brief, prompt injection, one complete agent run) | `node_modules/.bin/tsx scripts/next-ai-seed.ts && node_modules/.bin/tsx scripts/next-ai-live.ts zoom brief ask actions insights inbox db voice research injection agent spend && node_modules/.bin/tsx scripts/next-ai-seed.ts --clean` — about 0.08 USD; asserts nothing, records the evidence in `$DATA_DIR/ai-live-evidence.json`. Last run and findings: `docs/next/AI-LIVE-VERIFICATION.md` |

**The queue after a stopped worker.** While the worker is stopped (`pnpm test`, `ai-live.test.ts`) the unit suites queue several hundred
`index-source` jobs; at the next `srv.sh start` the worker drains them at about 4 jobs/s (700 jobs ≈ 3 min, measured 2026-11-19). An
e2e run started meanwhile sees its own pages indexed minutes late. Wait for
`select count(*) from pgboss.job where name = 'index-source' and state in ('created','retry','active')` to reach 0 before `pnpm test:e2e`.
A test that replaces the chunks of its pages by fixtures must first withdraw its own pending jobs (see the constellation test).

**Leftovers.** Every suite removes what it creates (prefixed titles: `nx-…`, `E2E-…`, `Exemple ·`, `perf ·`) and only that: shared
tables (`sync_tombstones`, `settings`, `sessions`, `knowledge_insights`) are cleaned by id or by the start time of the run, never
wholesale, because native clients run live tests against the same instance. Assertions never assume an empty workspace: the feed is
read from a cursor taken before the test created its rows (the workspace may hold far more than one window — e.g. the 20 000-row
`BENCH 20k rows` database made by `scripts/db-seed-bench.ts`), task ids are random per run, and the stored brief summary is put back
as it was found. `tests/e2e/next-integration.spec.ts` is the cross-feature scenario (one note with every new block through timeline,
graph, health, brief, Ask, offline, canvas, Markdown export → import); it also asserts that **viewing a page writes nothing**.

## Unit / integration (`tests/unit`)
- `webauthn.test.ts` — server-side WebAuthn verification attacked with a **software authenticator** written for the tests (`tests/helpers/softauthn.ts`, P-256, builds real attestation/assertion structures): valid registration and sign-in; wrong origin, sub-domain origin, wrong RP ID, wrong ceremony type, wrong challenge, missing user verification, missing user presence, forged signature, rewound signature counter, unknown credential; **replay** and **expired** challenges; challenge bound to its session / kind; sessions (random token, hash-only storage, revocation, rotation + grace, freshness expiry, idle expiry); enrollment windows (bootstrap refused once a passkey exists, single use, expiry, cap at 60 min, token stored hashed).
- `pages.test.ts` — optimistic concurrency (stale save refused with the server copy, two simultaneous saves → exactly one wins), the three conflict resolutions keep both copies, history, trash/restore, document validation (structure, depth, unsafe URLs), capture kinds, every inbox action and its undo, tags.
- `client-logic.test.ts` — key-order-independent JSON equality used by the sync engine, safe post-login redirects, device labels, token size.
- `jobs.test.ts` — queue policy applied, de-duplication by singleton key, a failing job is retried with backoff then lands in the dead-letter queue, a job orphaned by a killed worker is released and picked up again, in-process timeout.
- `import-*.test.ts` — importer logic that needs no database (when present).
- **NEXT-AI (3.0)** — hermetic unless stated: the real provider keys are removed from the test process, the model is a local fake OpenAI-compatible server (`tests/helpers/fake-llm.ts`: streaming, tool calls, error statuses, stalls, hangs) and the transcription engine is injected.
  - `ai-providers.test.ts` — provider registry (availability = key present), Chat Completions wire contract, streaming / tools / JSON schema, 401 / 429 / 5xx / mid-stream error, retries, idle and total timeouts, abort, `/models` discovery (context, prices, capabilities), manual-only routing of unbenchmarked models, the unchanged measured routing table, creator derivation, logo files checked byte for byte against `simple-icons`, the model view of `GET /api/ai/models`.
  - `ai-ask.test.ts` — scope all / page / project / selection, citations anchored to the supporting block and verified against the current page, stale passages dropped, no support → no provider call, uncited answer withheld, provider failure, the five new actions, link suggestions validated and never written.
  - `ai-features.test.ts` — synopsis cache (semantic zoom level 1), Smart Inbox validation / cache / journaled apply / undo, transcription request rules, job path, summary, failures, smart database properties (config, run log, hand-edit protection, auto-run).
  - `ai-picker.test.ts` — search, grouping, ordering, labels and keyboard navigation of the model selector.
  - `research-latex.test.ts` — LaTeX conversion of every block type, article skeleton, project-scoped references, `.bib` companion parsed back by the importer.
  - `ai-live.test.ts` — **opt-in**, skipped by `pnpm test`: `AI_LIVE=1 node_modules/.bin/tsx --test --test-force-exit tests/unit/ai-live.test.ts` runs one real transcription (speech synthesized with `say` + `afconvert`) and two strict-JSON calls on `claude-haiku-5-5`, and prints the measured result and the spend read from `ai_usage` (well under one cent). Stop the scratch worker first, or the queued job is also executed by it (a second, equally small, charge).

## End-to-end (`tests/e2e`, Playwright + Chrome DevTools **virtual authenticator**)
- `auth.spec.ts` — the real journeys in a browser: nothing private without a session (every `route.ts` is walked), old entry points gone, CLI-opened enrollment → passkey → signed in, bootstrap closed afterwards, sign-in, cookie attributes, lock, revoked token replay, prompt without user verification refused, step-up + token rotation, add / rename / remove passkey, last passkey protected, sign out other devices, CLI recovery replaces passkeys and revokes sessions, audit trail.
- `mobile.spec.ts` — the phone journeys at **360×740, 375×667 and 430×932** (touch, iPhone user agent): quick capture, formatted editing with the editing bar, photo/PDF upload, network loss and return (draft kept, replay without duplicate), conflict between two sessions and its resolution, search and jump to a block, database on a phone, property change, inbox triage + undo, export, lock; after each screen: no horizontal overflow of the document or of the scroll container, primary action visible, bottom bar not over the content.
- `desktop.spec.ts` — idempotency of API mutations (same key → one page), request ids, cache headers, service-worker cache contents.

## Helper scripts (manual, same scratch instance)
`node tests/e2e/model-picker.mjs` drives the model selector in Chromium at desktop and phone sizes (open, search, keyboard, select, show unavailable, Escape) with a `scripts/dev-session.ts` token saved in `~/dev/note-next-ai-data/.session`, and prints what it observed; `node tests/e2e/shots.mjs [width]` and `shots2.mjs` take screenshots of every screen and print any horizontal overflow; `overflow.mjs <path>` names the elements that stick out; `debug.mjs <path>` prints console errors; `live-ai.mjs` asks one grounded and one ungrounded question through the assistant with the real providers (a fraction of a cent) — last run 2026-11-17: grounded answer with a citation to the right paragraph ($0.001), ungrounded question refused with no provider call.

A complete agent run with a real model (`suggest_tags`, on a note containing a prompt injection) was made on 2026-11-19 through the live worker: `docs/next/AI-LIVE-VERIFICATION.md` §3. The caps and the time-out of a run, the three other agent tasks, and approve → apply → undo of a real proposal are still tested with injected models / a seeded proposal only.

## What automation does NOT prove (do these by hand on a real iPhone and Android phone after deploying)
Chromium emulation reproduces viewport, touch and user agent — not iOS Safari. Check on the device:
1. Face ID / Touch ID sheet for sign-in and for a step-up; the "passcode" fallback; a synced passkey on a second Apple device; Chrome on Android with fingerprint.
2. The on-screen keyboard: the editing bar sits on top of the keys, the line being typed stays visible, the bottom navigation hides while typing; rotate the phone while editing.
3. Selection handles and the system copy/paste callout stay usable with the editing bar; paste rich text, a link, an image.
4. Camera photo, document scan (iOS "Scan Documents" in the file picker), a large PDF: progress, cancel, retry.
5. Voice memo recording and dictation (permission prompt; keyboard dictation where the browser has no speech API).
6. Install to the home screen (iOS Share → Add to Home Screen; Android install prompt): standalone window, icon, safe areas with the notch and home indicator, relaunch after sleep, "A new version is ready" after a deployment.
7. Airplane mode: capture offline, type in a note, come back online — one note, no duplicate, no lost text. Low Power Mode on.
8. VoiceOver / TalkBack through sign-in, capture, the inbox and the editor toolbar; text size at 200 %; dark, light and system themes; Reduce Motion.
Record the result of this pass in the release notes; the automated suite alone is not a sign-off for the phone experience.
