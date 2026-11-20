# SP Note Next Generation — test plan and results (2026-11-19)

Rule applied throughout: a feature is "verified" only by a test that ran. Tests never run against
production data: web suites use scratch databases (`*_dev`), native suites use the integration server
(`next-int` build on a scratch database) or an in-memory fake backend.

## 1. Suites and last results on the delivered code

| Layer | Suite | How to run | Result |
|---|---|---|---|
| Web | Typecheck | `pnpm typecheck` | clean |
| Web | Unit / integration (node:test, scratch DB) | `pnpm test` (stop the worker first: it steals jobs from `jobs.test.ts`) | 396 tests · 394 pass · 2 opt-in paid tests skipped · 0 fail |
| Web | HTTP contract | `pnpm test:http` (needs the scratch server) | 25 / 25 |
| Web | Browser end-to-end (Playwright, virtual authenticator; desktop + phones 360 / 375 / 430) | `E2E_BASE_URL=… pnpm test:e2e` | 177 tests · 173 pass · 4 opt-in skipped · 0 fail |
| Web | Contrast (WCAG AA pairs, both themes) | `pnpm contrast` | all pairs pass |
| Web | Build | `pnpm build` | OK |
| Swift core | `swift test` (Document, Store, API, Sync, Design, Features) | in `SPNotesCore` | 826 tests · 0 fail (33 live tests skipped offline) |
| Swift core | Live against the integration server | `SPN_LIVE_URL=http://localhost:8486 …` | API 243 executed, 0 fail, 1 skipped · Sync 128, 0 fail · Features smoke 2 / 2 |
| macOS | Editor engine | `swift test --scratch-path build/spm` | 46 tests · 0 fail |
| macOS | Hosted app tests with server | `Scripts/integration-test.sh --server` | 34 tests · 0 fail · 1 skipped (assistant: dev server timeout) |
| macOS | Signed release checks | `Scripts/verify-release.sh` | all pass (signature, hardened runtime, sandbox, no web engine, no secrets) |
| macOS | XCUITests | — | not executed (they send keystrokes to the owner's session) |
| iOS | Unit (iPhone 17 Pro and iPad Pro 13" simulators) | `Scripts/build.sh test` | 393 tests in 87 suites on each · 0 fail |
| iOS | UI | `Scripts/build.sh uitest` | iPhone 33 executed, 0 fail · iPad 33 executed, 0 fail, 2 recorded expected failures (Escape key, window restoration: simulator limits) |
| iOS | Live (offline scenario, offline tasks, offline capture → server inbox) | `Scripts/test-live.sh` | 3 / 3 |
| iOS | Live UI: every hosted screen opened on iPhone and iPad | `Scripts/test-live.sh ui` | 3 / 3 per device |

Baseline before the upgrade: web 61 unit tests; Swift core 283; macOS editor 31 + 13 hosted; iOS 128 unit + 12 UI.

## 2. Cross-platform and compatibility checks

| Check | Evidence |
|---|---|
| Markdown / plain text / HTML export of every new node identical on server and Swift | shared fixtures, byte-for-byte (12 fixture comparisons + 521 recorded documents) |
| Canvas merge and auto-layout identical on web and Swift | 60 shared cases identical; 2 000 randomised merge seeds (web), 5 400 per test (Swift) |
| Ink width law identical | shared fixture `tests/fixtures/ink/width-law.json` asserted on both sides |
| Shipped 1.x native apps against the 3.0 server | the 1.0 Swift core (commit `b06b1ed`) run live against the 3.0 build: API 88 executed, 0 fail · Sync 65, 0 fail |
| 2.x answer of `/api/sync` unchanged without `kinds` | unit + HTTP tests |
| 2.0 natives against a 2.x server | sync suite re-run with the fake at API level 2: 121 green |
| Native local store migration | on a copy of a database written by the shipped 1.0.2 (macOS) and 1.0.0 (iOS) code: rows and FTS identical, idempotent, rollback on failure |
| Server migrations | up → down → up on a copy; rehearsal on a restored copy of the production backup: page content fingerprint identical before/after |
| Web → native round trip | live tests: note, task, canvas, reference, database row created by a client, read back by another, deleted |

The full device chain "Web → macOS → iPhone → iPad → Web" on physical devices was not run (see §6); its
automated equivalent is the set of live tests above, each pair sharing the same server.

## 3. Offline, sync and conflicts

- Web: offline → open a synced note → edit → new note with a task → close and reopen the tab offline →
  online → exactly one page and one task on the server; second context sees them. Concurrent edit →
  conflict banner, both versions kept.
- Natives: offline scenario against the real server (edit, tag, pin, create, attach a picture, relaunch
  without network, reconnect, second device receives everything, picture byte-identical); tasks and canvases
  through the outbox with fault injection and 1 512 randomised seeds; unknown or refused operations are kept
  and surfaced, never dropped.

## 4. Security checks that ran

Every mutating method of every route refuses a missing or foreign Origin (walked by a test); every private
route answers 401 without a session; passkey ceremonies attacked with a software authenticator (existing
suite, unchanged and green); runnable code cannot fetch, reach the parent DOM, cookies or storage, and an
endless loop is killed; no key, key prefix or database URL in the client bundles; uploads served only
through the authenticated route; request logs carry ids and timings, no document text; CSP unchanged
versus 2.0. Agents: approval model unchanged; AI-created relations are never auto-accepted (tested).

## 5. Performance measurements

| Measure | Result |
|---|---|
| Typing latency, 2 000-block document (keystroke → painted frame) | median 25.1–25.7 ms before → 24.9–25.5 ms after |
| First-load JS shared by every screen | 2 892 kB → 962 kB raw (887 → 303 kB gzip) |
| Database query, 20 000 rows (first page / filtered / sorted) | 105 / 106 / 111 ms → 6 / 14 / 15 ms |
| Database scroll, 20 000 rows | median frame 16.7 ms, 0 frames over 33 ms |
| Graph, 5 000 nodes / 20 000 edges (GPU) | 60 fps layout, zoom and pan |
| Canvas, 1 000 cards | 60 fps pan/zoom/drag at 100 %; tidy-up 48 ms |
| `/api/sync` window / brief / health / global graph (20 001 pages) | 15 / 8 / 233 / 108 ms median |
| Search index lag after a burst of saves | one job per 2 s → two pollers at 0.5 s |
| iOS: query re-runs while typing 200 characters | 120 → 1 (widget reloads 20 → 1) |

Not measured: Instruments profiles (time, allocations, energy) on physical devices.

## 6. To be done by the owner (cannot be automated here)

1. Web: sign in on note.spboucher.ai and walk the new screens; iPhone Safari pass (keyboard, safe areas, install to Home Screen).
2. macOS 2.0.0 (installed): first launch migrates the local database; Touch ID passkey sign-in; microphone
   prompt and one recording; global Quick Note shortcut; Spotlight; a task notification; draw a stroke, annotate a PDF.
3. iOS/iPadOS 2.0.0 (TestFlight): Face ID passkey sign-in; airplane mode + device restart; Apple Pencil
   (pressure, shapes, handwriting, PDF ink); camera and scanner; widgets on the Home and Lock Screens; Siri;
   share sheet; Stage Manager; notifications; a universal link from Safari; VoiceOver.
4. AI with real models: one "Run AI analysis" on the graph, one brief summary, one inbox suggestion, one
   semantic-zoom synopsis (all are on explicit request and cost cents).
5. Optional: add `OPENROUTER_API_KEY` / `MACLUSTR_LLM_API_KEY` to the node `.env`, then run the benchmark
   before letting those models into automatic routing.

## 7. Restore

`scripts/restore.sh --latest --verify-only` (with `RESTORE_ADMIN_URL=postgresql:///postgres` on the node)
after each release that carries a migration; last drill 2026-11-19: verified, 39 tables, 8 pages.
