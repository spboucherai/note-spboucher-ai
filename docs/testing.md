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

## Unit / integration (`tests/unit`)
- `webauthn.test.ts` — server-side WebAuthn verification attacked with a **software authenticator** written for the tests (`tests/helpers/softauthn.ts`, P-256, builds real attestation/assertion structures): valid registration and sign-in; wrong origin, sub-domain origin, wrong RP ID, wrong ceremony type, wrong challenge, missing user verification, missing user presence, forged signature, rewound signature counter, unknown credential; **replay** and **expired** challenges; challenge bound to its session / kind; sessions (random token, hash-only storage, revocation, rotation + grace, freshness expiry, idle expiry); enrollment windows (bootstrap refused once a passkey exists, single use, expiry, cap at 60 min, token stored hashed).
- `pages.test.ts` — optimistic concurrency (stale save refused with the server copy, two simultaneous saves → exactly one wins), the three conflict resolutions keep both copies, history, trash/restore, document validation (structure, depth, unsafe URLs), capture kinds, every inbox action and its undo, tags.
- `client-logic.test.ts` — key-order-independent JSON equality used by the sync engine, safe post-login redirects, device labels, token size.
- `jobs.test.ts` — queue policy applied, de-duplication by singleton key, a failing job is retried with backoff then lands in the dead-letter queue, a job orphaned by a killed worker is released and picked up again, in-process timeout.
- `import-*.test.ts` — importer logic that needs no database (when present).

## End-to-end (`tests/e2e`, Playwright + Chrome DevTools **virtual authenticator**)
- `auth.spec.ts` — the real journeys in a browser: nothing private without a session (every `route.ts` is walked), old entry points gone, CLI-opened enrollment → passkey → signed in, bootstrap closed afterwards, sign-in, cookie attributes, lock, revoked token replay, prompt without user verification refused, step-up + token rotation, add / rename / remove passkey, last passkey protected, sign out other devices, CLI recovery replaces passkeys and revokes sessions, audit trail.
- `mobile.spec.ts` — the phone journeys at **360×740, 375×667 and 430×932** (touch, iPhone user agent): quick capture, formatted editing with the editing bar, photo/PDF upload, network loss and return (draft kept, replay without duplicate), conflict between two sessions and its resolution, search and jump to a block, database on a phone, property change, inbox triage + undo, export, lock; after each screen: no horizontal overflow of the document or of the scroll container, primary action visible, bottom bar not over the content.
- `desktop.spec.ts` — idempotency of API mutations (same key → one page), request ids, cache headers, service-worker cache contents.

## Helper scripts (manual, same scratch instance)
`node tests/e2e/shots.mjs [width]` and `shots2.mjs` take screenshots of every screen and print any horizontal overflow; `overflow.mjs <path>` names the elements that stick out; `debug.mjs <path>` prints console errors; `live-ai.mjs` asks one grounded and one ungrounded question through the assistant with the real providers (a fraction of a cent) — last run 2026-11-17: grounded answer with a citation to the right paragraph ($0.001), ungrounded question refused with no provider call.

Not exercised with a real model: a complete agent run (tool loop, caps, timeout). The review / approve / undo path is tested with a seeded proposal; run one agent by hand after deploying (Agents → Suggest tags on a page) and check its log.

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
