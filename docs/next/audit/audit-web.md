# SP Note (note.spboucher.ai) — code-level audit of the web app + backend

Audited 2026-11-19, read-only. Source of truth: `M4M64c:~/apps/note-spboucher-ai`, branch `main` @ `77ef5f0` (clean tree), package `note-spboucher-ai` 2.0.0.
All paths below are relative to that repo. Line numbers refer to that commit. Source lines are very long (200–1500 chars), so `file:line` often designates a whole function.

Method: the repo (without `.env`, `.git`, `node_modules`, `data/`) was copied to the laptop and read there. Sections 0, 1, 2 (core routes), 10, 11, 12 were read line by line by the lead auditor; sections 3, 8, 9 / 4, 7 / 5, 6 and the route tables of those areas were produced by three sub-auditors reading the same copy (their sections are marked "sub-audit"; spot-checked claims are flagged). Nothing was built, run, restarted or written on the node. Production database: metadata and row COUNTS only.

## 0. Deployment facts that frame every decision

- Stack (package.json): next ^16.4.3, react ^19.3.1, @tiptap/* ^3.32.2, drizzle-orm ^0.45.4, `postgres` ^4 (postgres-js), pg-boss ^12.38, zod ^4.6, @simplewebauthn/server ^14.1, `openai` ^7.47, `@anthropic-ai/sdk` ^1.3, tailwindcss ^4.3 (+ @tailwindcss/postcss), `motion` ^14.9, radix primitives, cmdk, zustand, @tanstack/react-query, react-force-graph-2d, katex, lowlight, jszip, mammoth, pdf-parse, papaparse, turndown, marked, sanitize-html, bibtex-parse-js, pino. TypeScript ^7.0.2. `lint` = `tsc --noEmit` (no ESLint).
- Processes (PM2, verified live): `note-web` (`next start -p 8480`, pid 32840, 7 restarts) and `note-worker` (`tsx src/worker/index.ts`). No `ecosystem.config.*` in the repo.
- Production `.env` variable NAMES: `NODE_ENV PORT APP_URL APP_VERSION DATABASE_URL OPENAI_API_KEY ANTHROPIC_API_KEY DATA_DIR BACKUP_DIR BACKUP_PASSPHRASE BACKUP_OFFSITE BACKUP_KEEP_DAYS LOG_LEVEL TZ`. Read in code but not set in prod: `AUTH_RP_ID`, `AUTH_EXTRA_ORIGINS` (dev only), `APPLE_APP_IDS`, `E2E_BASE_URL`.
- Postgres 17.11 (Homebrew, local, passwordless for the OS user). Extensions present: `vector 0.8.7`, `pg_trgm 1.6`, `unaccent 1.1` (created by `src/db/migrate.ts:6`, not by the SQL migrations). `drizzle.__drizzle_migrations` holds **5 rows** (3 dated 2026-11-01, 1 on 11-17, 1 on 11-18) while `drizzle/meta/_journal.json` lists **3** entries — the first migration was evidently re-applied/re-generated on day one; harmless but the count does not match the folder. NOT investigated further.
- **Production is almost empty** (counts on 2026-11-19): pages 7 (7 live; types `page/notes`, `page/documents`, `research/research`), page_versions 2, attachments 1, tasks 3, tags 0, page_tags 0, databases 0, database_rows 0, references 3, experiments 0, chunks 6, embeddings 6 (model `text-embedding-3-small`), knowledge_edges 8 (all `link/accepted`) vs links 1 (see defect D-12), ai_models 111, ai_providers `openai,anthropic`, ai_conversations 3, ai_executions 0, passkeys 1, sync_tombstones 0. A schema redesign therefore carries almost no data-migration risk.
- Single owner, single workspace by construction: `getWorkspace(userId)` returns the one workspace of the owner (`src/lib/auth/guard.ts:43`), `ownerRow()` = oldest `users` row (`src/lib/auth/sessions.ts:60`). There is no sharing, no roles, no multi-user anything.
- Security headers / CSP in `next.config.ts`: `connect-src 'self'` (the browser can talk only to the app itself — all AI calls are server-side), `frame-src` YouTube/Vimeo only, `script-src 'self' 'unsafe-inline' 'unsafe-eval'`, `worker-src 'self' blob:`, `Permissions-Policy: camera=(), microphone=(self)`. Any new embed (e.g. a remote Mermaid/Excalidraw CDN, a WASM runtime fetched from elsewhere) must be bundled or the CSP changed. `experimental.serverActions.bodySizeLimit = "50mb"`.

## 1. Schema

`src/db/schema.ts` (260 lines, 39 tables). Conventions: uuid PKs (`gen_random_uuid()`), timestamptz, soft delete by `deleted_at`, jsonb for flexible content, Drizzle `casing: "snake_case"` (`src/db/index.ts:8`). `vector` custom type is hard-coded `vector(1536)` (`schema.ts:9`).

### 1.1 Tables (key columns)

Identity & auth
- `users` — id, username (unique), display_name, email, password_hash (always `'!'` since v2), totp_secret/totp_enabled (dead), preferences jsonb, created_at, updated_at.
- `sessions` — id, user_id→users, token_hash (unique, SHA-256 of the cookie token), user_agent, ip, created_at, last_seen_at, expires_at (idle 30 d sliding), absolute_expires_at (90 d), revoked_at, mfa_passed, credential_id, label (device label), verified_at (step-up freshness), revoked_reason, prev_token_hash + prev_valid_until (60 s rotation grace).
- `login_attempts` — id, ip, username (reused as "kind": `passkey`/`enroll`), success, created_at.
- `webauthn_credentials` — id (text, credential id), user_id, public_key, counter, transports jsonb, device_type, backed_up, label, created_at, last_used_at, aaguid.
- `webauthn_challenges` — id, user_id, challenge, kind (`login|reauth|register|enroll`), created_at, expires_at, session_id, enrollment_id. Single use, bound to an HttpOnly cookie holding `id`.
- `auth_enrollments` — id, purpose (`bootstrap|recovery`), token_hash (unique), revoke_existing, created_at, expires_at, consumed_at, closed_reason.
- `idempotency_keys` — key (PK), session_id, method, path, status, response jsonb, created_at.

Workspace & pages
- `workspaces` — id, owner_id→users, name, slug (unique), settings jsonb.
- `pages` — id, workspace_id, **parent_id (uuid, NO foreign key, no cycle constraint)**, database_id (set when the page is a database row page; no FK), type (`page|database|research|dashboard`, free text), section (`notes|documents|databases|projects|research`, free text), title, icon, cover, **content jsonb (ProseMirror doc)**, plain_text, `tsv` (generated: `'simple'` config, title weight A + plain_text weight B), properties jsonb, position double, pinned, archived, **version int** (optimistic concurrency), word_count, created_at, updated_at, last_opened_at, deleted_at, **rev bigint** (change feed), inbox_at, capture_kind (`note|tasks|link|photo|file|audio`). Indexes: (workspace_id, inbox_at), (workspace_id, parent_id), GIN tsv, updated_at, database_id, GIN trigram on title, (workspace_id, rev).
- `page_versions` — id, page_id→pages (cascade), version (unique per page; negative time-based numbers for "never applied" copies), title, content, properties, reason, created_at, word_count.

Databases
- `databases` — id, workspace_id, page_id→pages (host page, cascade), name, description, icon, is_template, template_of, timestamps, deleted_at.
- `database_properties` — id, database_id, name, type (comment lists: `text number date checkbox status select multi_select url file relation rollup formula created_time last_edited_time ai`), config jsonb, position, width.
- `database_rows` — id, database_id, page_id→pages (each row has a page), values jsonb (GIN), position, timestamps, deleted_at.
- `database_views` — id, database_id, name, type (`table board calendar gallery timeline list`), config jsonb, position, is_default.
- `relations` — id, property_id→database_properties, from_row_id, to_row_id (unique triple).

Attachments, tags, tasks, links
- `attachments` — id, workspace_id, page_id→pages (**ON DELETE SET NULL**), filename, mime, size, sha256, storage_path (content-addressed `aa/bb/<sha256>.<ext>` under `DATA_DIR/uploads`), extracted_text, page_count, meta jsonb, created_at, deleted_at, **rev bigint**.
- `tags` — id, workspace_id, name (unique per workspace), color (default `gray`). `page_tags` — (page_id, tag_id) PK, both cascade.
- `tasks` — id, workspace_id, page_id→pages (set null), title, status (`todo|done` via API), priority (`low|medium|high`), due_at, completed_at, project (free text), timestamps, deleted_at. **No `rev`, no trigger, no tombstone.**
- `inbox_actions` — id, workspace_id, page_id, action, before jsonb, created jsonb, created_at, undone_at (undo journal of inbox triage).
- `links` — id, from_page_id, to_page_id (both cascade), kind (default `link`), unique (from,to,kind).
- `knowledge_edges` — id, workspace_id, from_id, to_id (**no FK to pages**), from_type/to_type (default `page`), kind (comment: `link | backlink | relation | ai_suggested | concept`), status (`suggested|accepted|rejected`), confidence, rationale, model, created_at, decided_at; unique (from_id,to_id,kind). No validity interval, no weight, no source block.
- `sync_tombstones` — (kind, id) PK, workspace_id, rev, deleted_at. kind = `page|attachment`. Written by triggers only.

Search
- `chunks` — id, workspace_id, source_type (`page|attachment|row`), source_id, page_id, ordinal, **block_id**, heading, content, token_count, content_hash, `tsv` (generated, `'simple'`), unique (source_type, source_id, ordinal).
- `embeddings` — chunk_id (PK→chunks cascade), model, version, embedding `vector(1536)`, HNSW `vector_cosine_ops`.
- `index_state` — (source_type, source_id) PK, content_hash, model, version, indexed_at.

AI
- `ai_providers` — id (text PK), name, enabled, last_discovery_at, status, status_detail. Rows today: `openai`, `anthropic` (seeded by `src/cli/bootstrap.ts:40`). **No base_url / api-key-reference / kind column.**
- `ai_models` — id (text PK), provider→ai_providers, display_name, category (default `text`), available, enabled, context_window, max_output, input_price, cached_price, output_price, pricing_source, probes jsonb, benchmark jsonb, capabilities jsonb, notes jsonb, discovered_at, probed_at, benchmarked_at. **No creator/vendor/logo column** (provider is the only origin field).
- `ai_conversations` — id, workspace_id, title, page_id, model, routing (default `auto`), pinned, timestamps, deleted_at.
- `ai_messages` — id, conversation_id, role, content, model, provider, `sources` jsonb typed `{ chunkId, pageId, title, excerpt, score }[]`, usage, cost_usd, latency_ms, ttft_ms, meta, created_at.
- `ai_executions` — id, workspace_id, agent, task, model, status (`pending running awaiting_approval approved rejected completed failed`), scopes jsonb, tools_invoked jsonb, documents_accessed jsonb, proposed_changes jsonb, approvals jsonb, outcome, result, error, cost_usd, tokens_in, tokens_out, created/started/finished.
- `ai_usage` — id, workspace_id, provider, model, task, input/output/cached/reasoning tokens, cost_usd, latency_ms, ttft_ms, ok, error, ref_id, created_at.
- `ai_comparisons` — id, workspace_id, prompt, models jsonb, results jsonb.

Research
- `references` (TS name `researchReferences`) — id, workspace_id, page_id, cite_key (unique per workspace), entry_type, title, authors jsonb, year, journal, doi, url, bibtex, fields jsonb, verified (`user|doi_verified|ai_suggested`), attachment_id→attachments, timestamps, deleted_at.
- `experiments` — id, workspace_id, page_id, name, status (default `planned`), params jsonb, metrics jsonb, dataset_ref, repo_url, notes, started_at, finished_at.
- There is **no table** for papers, research tasks or extracts: see section 7 for where they live.

Ops
- `audit_logs` — id, user_id, action, target_type, target_id, detail jsonb, ip, created_at.
- `backup_jobs` — id, kind, status, path, size_bytes, sha256, offsite, error, started_at, finished_at.
- `dashboard_layouts` — id, user_id, name, widgets jsonb `{id,type,size,config?}[]`, is_default.
- `settings` — key (PK), value jsonb, updated_at (e.g. `worker.heartbeat`, `ai.daily_budget_usd`).
- pg-boss lives in its own schema `pgboss`.

### 1.2 Migrations (`drizzle/`, each with a hand-written `.down.sql`)

- **`0000_init.sql`** (523 lines, 2026-11-01): the 35 original tables — ai_comparisons, ai_conversations, ai_executions, ai_messages, ai_models, ai_providers, ai_usage, attachments, audit_logs, backup_jobs, chunks, dashboard_layouts, database_properties, database_rows, database_views, databases, embeddings, experiments, index_state, knowledge_edges, links, login_attempts, page_tags, page_versions, pages, relations, references, sessions, settings, tags, tasks, users, webauthn_challenges, webauthn_credentials, workspaces — plus all FKs and indexes (GIN tsv, trigram, HNSW).
- **`0001_v2_passkeys_inbox.sql`** (2026-11-17): new tables `auth_enrollments`, `idempotency_keys`, `inbox_actions`; `pages.inbox_at`, `pages.capture_kind`; `sessions.credential_id/label/verified_at/revoked_reason/prev_token_hash/prev_valid_until`; `webauthn_challenges.expires_at/session_id/enrollment_id`; `webauthn_credentials.aaguid`; indexes `idempotency_created_idx`, `inbox_actions_ws_idx`, `pages_inbox_idx`. Data statements: revokes every pre-v2 session (`revoked_reason='legacy-v1'`), deletes all challenges, blanks `users.password_hash`/TOTP.
- **`0002_native_sync.sql`** (2026-11-18): the change feed — see 1.3.

### 1.3 The `rev` change feed (0002) — exact mechanism

- One workspace-agnostic sequence `sync_rev_seq` (bigint).
- `rev bigint NOT NULL DEFAULT 0` added to exactly **two tables: `pages` and `attachments`**; back-filled with `nextval`. Indexes `pages_rev_idx (workspace_id, rev)`, `attachments_rev_idx`, `sync_tombstones_rev_idx`.
- Table `sync_tombstones (id, kind, workspace_id, rev, deleted_at)`, PK (kind, id).
- Trigger function `sync_bump_rev()` — `BEFORE INSERT OR UPDATE` on `pages` (arg `'page'`) and `attachments` (arg `'attachment'`), FOR EACH ROW:
  - on UPDATE, returns unchanged when `to_jsonb(NEW) - 'last_opened_at' - 'rev' - 'tsv'` equals the same for OLD (opening a note or a no-op write is not a change; a caller that sets `rev` itself is respected);
  - on INSERT, deletes any tombstone with the same (kind, id) (an id can come back);
  - then `pg_advisory_xact_lock(778201)` and `NEW.rev := nextval('sync_rev_seq')`. The lock makes revisions visible in commit order.
- Trigger function `sync_tombstone()` — `AFTER DELETE` on `pages` and `attachments`: same advisory lock, upserts a tombstone with a fresh `rev`.
- Trigger function `sync_touch_page_tags()` — `AFTER INSERT OR DELETE` on `page_tags`: `UPDATE pages SET rev = nextval(...) WHERE id = pid` (a tag change bumps the page).
- Verified live in production: triggers `pages_sync_rev`, `attachments_sync_rev`, `pages_sync_tombstone`, `attachments_sync_tombstone`, `page_tags_sync_touch`.
- **Not covered by the feed**: tasks, tags as entities (renames/colors), databases / properties / rows / views / relations, references, experiments, knowledge_edges, links, ai_conversations/messages, settings/preferences, dashboard layouts, page_versions. A database row's *page* is in the feed (it is a `pages` row with `database_id`), but its `database_rows.values` is not.
- Caveat: `page_versions` snapshots, `links`/`knowledge_edges` rebuilds and chunk indexing are side effects that do not bump `rev` (correct), but `handleIndex` back-filling block ids (`src/worker/handlers/index-source.ts:6`) does an UPDATE of `content` → bumps `rev` without bumping `version`.

## 2. API surface

### 2.0 Cross-cutting rules (apply to every route below unless stated)

**Gate 1 — `src/proxy.ts`** (Next 16 proxy, Node runtime, matcher = everything except `_next/static|_next/image`). Public paths: `/.well-known/apple-app-site-association`, `/api/health`, `/api/auth/login/(options|verify)`, `/api/auth/enroll/(options|verify)`, `/api/auth/logout`, `/login`, `/enroll`, `/offline`, `/manifest.webmanifest`, `/sw.js`, `/icons/*`, `/_next/*`, `/favicon*`. Everything else requires a valid session resolved from **the cookie only** (`req.cookies.get(SESSION_COOKIE)`, `proxy.ts:31`); `/api/*` without it → `401 {error:"Sign-in required", code:"unauthenticated"}`; pages → 303 to `/login?next=`. `X-Robots-Tag: noindex` everywhere; `/robots.txt` disallows all. Legacy `/gate`, `/unlock`, `/api/gate`, `/api/lock` → 404.

**Gate 2 — `handler()` in `src/lib/api.ts:21`** wraps nearly every route: `requireUser(req)` → `getWorkspace` → optional `requireFresh` → optional idempotency → error mapping → one pino log line (ids, method, path, status, ms; never bodies). `x-request-id` echoed/generated. Default `cache-control: private, no-store`.

**How a non-browser client authenticates (native apps)** — there is **no bearer token, no API key, no `Authorization` header anywhere** (grep: zero occurrences). The native apps use exactly the browser mechanism:
1. WebAuthn through AuthenticationServices against the same RP: `/.well-known/apple-app-site-association` returns `{ webcredentials: { apps: ["3YM54G49SN.ai.spboucher.spnotes", "3YM54G49SN.ai.spboucher.spnotes.ios"] } }` (override: `APPLE_APP_IDS`), no `applinks`.
2. `POST /api/auth/login/options` → `{options}` + challenge cookie (`__Host-note_wa`, HttpOnly, SameSite=Strict, 5 min) → `POST /api/auth/login/verify {response, next?}` → `Set-Cookie: __Host-note_session=<256-bit base64url token>; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age≈90 d`. The client must keep and resend that cookie (dev name: `note_session`). Only the SHA-256 is stored.
3. **Every mutating request (POST/PATCH/PUT/DELETE) must carry `Origin: <APP_URL origin>`** (or `Sec-Fetch-Site: same-origin`): `assertSameOrigin()` (`src/lib/auth/guard.ts:34`) refuses a request with neither header (`403 csrf "Missing Origin header"`), and refuses any other origin. This also applies to the public ceremony routes (`publicRoute`, `src/lib/auth/http.ts:14`) and to logout. A native client therefore forges the Origin header.
4. `User-Agent` matching `^SPNotes/<ver> \((Macintosh|iPhone|iPad)` yields the session label "SP Notes · Mac/iPhone/iPad" (`src/lib/auth/tokens.ts:14`).
5. The token is **rotated at each step-up** (`/api/auth/reauth/verify`); the old one stays valid 60 s. Sessions slide: idle 30 d (refreshed at most every 5 min), hard cap 90 d (`src/lib/auth/config.ts:11-16`).
6. Dev only: `scripts/dev-session.ts` prints a session token for a `*_dev|_test|_scratch` database with a loopback `APP_URL` (no passkey ceremony).
Consequence for the upgrade: there is no scoped/long-lived API credential for extensions, share sheets, CLI, widgets or background refresh; if wanted it must be built.

**Step-up ("fresh")** — `requireFresh(user)`: passkey verified < 5 min ago (`FRESH_MS`), else `403 {code:"reauth_required"}`. Used by: `PATCH/DELETE /api/auth/passkeys/[id]`, `POST /api/auth/passkeys/options|verify`, `DELETE /api/auth/sessions` (all), `DELETE /api/auth/sessions/[id]` for another device, `DELETE /api/pages/[id]?purge=1`, `DELETE|POST /api/trash`. (Others in the sub-audited areas — export/import/restore — are listed in their tables.)

**Idempotency** — optional, opt-in by header: a mutating request with `Idempotency-Key: [A-Za-z0-9_-]{8,100}` runs at most once per key; the 2xx JSON response (≤ 512 KB) is stored and replayed with `idempotent-replay: true`; same key on another method/path → `422 idempotency_mismatch`; concurrent duplicate < 60 s → `409 in_progress`; errors and streams are not stored; keys purged after 48 h (`src/lib/api.ts:42-65`). Note: the lookup is by `key` alone (PK), the stored `session_id` is not compared. No route *requires* the header. Separate, built-in idempotency by client-chosen id exists on `POST /api/pages` and `POST /api/attachments` (answer `200` + header `x-existing: 1`).

**Errors** — `HttpError(status, message, code?, extra?)` → `{error, code?, ...extra}`. Anything else → `500 {error:"Internal error", requestId}`. **A `ZodError` thrown by `uuid.parse(...)` is not an `HttpError`** → 500 (defect D-3). `parseBody` failures → `400 "Validation: …"`.

### 2.1 Auth & session routes (`src/app/api/auth/**`) — public ones use `publicRoute` (same-origin, rate limit 10 failures/min/IP and 60/min global via `login_attempts`)

| Method | Path | Purpose / shapes | Requirements |
|---|---|---|---|
| POST | /api/auth/login/options | → `{options}` (usernameless, UV required) + challenge cookie; `409 not_enrolled` if no passkey | public, Origin |
| POST | /api/auth/login/verify | `{response, next?}` → `{ok, next}` + session cookie | public, Origin |
| POST | /api/auth/enroll/options | `{token}` → `{options, purpose, revokeExisting, expiresAt}` | public; needs a CLI-opened enrollment window |
| POST | /api/auth/enroll/verify | `{token, response, label?}` → `{ok, purpose, label}` + session cookie; recovery revokes sessions (+ deletes other passkeys) | public |
| POST | /api/auth/logout | revokes current session, clears cookie, always 200 | Origin |
| GET | /api/auth/state | `{sessionId, fresh, verifiedAt, freshWindowMs, idleDays, absoluteDays, rpId, origins, legacyEnv, enrollmentOpen}` | session |
| POST | /api/auth/reauth/options · /verify | step-up; verify rotates the session token → `{ok, freshForMs}` + new cookie | session |
| GET | /api/auth/passkeys | `[{id, label, createdAt, lastUsedAt, synced, multiDevice, transports, current}]` | session |
| POST | /api/auth/passkeys/options · /verify | add a passkey `{response, label?}` → `{ok, id, label}` | session + fresh |
| PATCH / DELETE | /api/auth/passkeys/[id] | rename `{label}` / revoke (+ its sessions; last passkey → `409 last_passkey`) → `{ok, sessionsRevoked, signedOut}` | session + fresh |
| GET | /api/auth/sessions | `[{id, label, ip, createdAt, lastSeenAt, expiresAt, current}]` | session |
| DELETE | /api/auth/sessions | `{includeCurrent=false}` → `{ok, revoked}` | session + fresh |
| DELETE | /api/auth/sessions/[id] | revoke one → `{ok, current}` | session; fresh if not the current one |
| GET | /api/health | `{ok, db, pgvector, worker, passkeys, time, version}` (worker = heartbeat < 120 s) | public |
| GET | /.well-known/apple-app-site-association | see above | public |

Passkey device management therefore **exists in full** on the server and in `src/components/settings/SecuritySection.tsx` (list, add, rename, revoke passkeys; list/revoke sessions; revoke all; step-up).

### 2.2 `/api/sync` — exact contract (`src/app/api/sync/route.ts`, 43 lines)

`GET /api/sync?since=<rev ≥ 0, default 0>&limit=<1..500, default 200>` — session cookie only; read-only (does not touch `last_opened_at`).

Response:
```jsonc
{
  "cursor": 123,            // send as `since` next time; = head when nothing was cut, else the lowest cut point
  "head": 123,              // greatest rev over pages, attachments, tombstones of the workspace at read time
  "more": false,            // true → the answer was cut at `limit`; call again immediately
  "reset": false,           // true when since > head (database restored from an older backup): client restarts from 0
  "serverTime": "ISO",
  "workspace": { "id": "uuid", "name": "…" },
  "user": { "displayName": "…" },          // absent in the reset answer
  "pages": [{ "id","parentId","databaseId","type","section","title","icon","cover",
              "content": { /* full ProseMirror doc */ }, "properties","position","pinned","archived",
              "version","wordCount","createdAt","updatedAt","lastOpenedAt","deletedAt","inboxAt","captureKind","rev",
              "tags": ["sorted","names"] }],   // every state: live, inbox, archived, trashed; NO plainText
  "attachments": [{ "id","pageId","filename","mime","size","sha256","pageCount","createdAt","deletedAt","rev" }],  // metadata only; bytes via /api/files/<id>
  "tombstones": [{ "id","kind":"page|attachment","rev","deletedAt" }],
  "tags": [{ "name","color" }]             // the WHOLE tag list on every call (not incremental); no id, no count
}
```
Windowing: each list is `rev > since AND rev <= head ORDER BY rev LIMIT limit`; if any list hit the limit, `cursor = min(last rev of each cut list)` and the three lists are trimmed to `rev <= cursor` (nothing skipped). Errors: `400 bad_cursor`. The reset answer has `more: true, cursor: 0` and empty lists.
There is **no push/upload endpoint in `/api/sync`**: writes go through the ordinary routes (`POST /api/pages` with client id, `PATCH /api/pages/[id]` with `baseVersion`, `POST /api/attachments` with client id, `PUT /api/pages/[id]/tags`, …). No websocket/SSE/long-poll for change notification: clients poll.

### 2.3 Pages (`src/app/api/pages/**`, `src/lib/pages/service.ts`)

| Method | Path | Request → Response | Notes |
|---|---|---|---|
| GET | /api/pages?view=&limit= | view = `recent` (default; excludes inbox) \| `pinned` \| `trash` \| `archived` \| `section:<name>` (excludes row pages) \| `children:<id>`; limit ≤ 100 (default 20) → array of `{id,title,icon,section,type,parentId,updatedAt,lastOpenedAt,deletedAt,wordCount,pinned,properties,databaseId}` | no content; no pagination cursor; `children:<bad id>` → 500 |
| POST | /api/pages | `{id?: uuid, title?≤500, parentId?, section?: notes\|documents\|databases\|projects\|research, type?: page\|database\|research, content?, icon?≤16, properties?}` → full page row, `201`; if `id` already exists → stored row, `200`, `x-existing: 1` (never overwritten); `409 id_taken` if the id belongs to another workspace; unknown `parentId` → silently set to null | `assertDoc(content)`; block ids added server-side |
| GET | /api/pages/[id] | `?open=1` touches last_opened_at; `?head=1` → `{id,version,updatedAt,deletedAt}`; else full row (incl. `plainText`, `tsv`, `rev`, deleted pages too) + `breadcrumb: [{id,title,icon}]` + `backlinks: [{id,title,icon,section,updatedAt}]` | |
| PATCH | /api/pages/[id] | `{title?, content?, icon?, cover?≤2000, properties?, parentId?, section?: string, position?, pinned?, archived?, type?: string, versionReason?≤100, baseVersion?: int}` → `{id, version, updatedAt, title, wordCount}` | with `baseVersion` and a change to title/content/properties: single-statement compare-and-set on `version`; mismatch → `409 {error, code:"conflict", server:{version,title,content,properties,updatedAt}}`. Without `baseVersion`: last write wins. Trashed page → 404. `section`/`type` unvalidated strings; `parentId` only checked `!== id`. |
| DELETE | /api/pages/[id] | soft delete page + live descendants → `{ok, trashed:n}`; `?purge=1` (fresh) → hard delete | soft delete also deletes chunks |
| POST | /api/pages/[id]?action=restore\|duplicate | restore page + descendants (re-index) / duplicate (title + " (copy)", same parent) → page | |
| POST | /api/pages/[id]/beacon | body = PATCH payload as text (sendBeacon/keepalive) → `{ok, version}`; on conflict the unsaved copy is stored in `page_versions` with a negative version and reason "unsynced copy from a closed tab (not applied)" → `409 {ok:false, code:"conflict", preserved:true}` | |
| POST | /api/pages/[id]/resolve | `{choice: mine\|theirs\|both, serverVersion, mine:{title?, content?}}` → `{id,version,title,content,properties,updatedAt,copyId}`; `both` creates a sibling "… (conflict copy)" | both copies always kept in history |
| GET | /api/pages/[id]/versions | list (≤ 200): `{id,version,title,reason,createdAt,wordCount}`; `?v=<n>` → full snapshot | |
| POST | /api/pages/[id]/versions | `{version}` → restores (current state snapshotted first, reason `restore v<n>`) → `{ok, version}` | no `baseVersion` → overwrites |
| GET / PUT | /api/pages/[id]/tags | → `string[]` / `{tags: string[≤20] (each ≤60)}` → normalized (trim, strip `#`, lower-case, ≤40 chars) set replace → `string[]` | PUT on a trashed page → 404 |
| GET | /api/tree | all live, non-archived, non-row pages (`pageSummary` columns, no content) ordered by position | includes inbox pages (`inboxAt` is returned) |
| DELETE | /api/trash?olderThanDays=N | fresh; purge trashed pages (all when omitted) → `{ok, purged}` | |
| POST | /api/trash | fresh; `{action:"purge-old", days?=30}` → `{ok, purged, remaining, autoPurgeDays}` | not scheduled server-side: purge only happens on request |

Versioning rules (`updatePage`, `service.ts:43-64`): `version` increments on any change to title/content/properties. A `page_versions` snapshot of the PREVIOUS state is taken when there is none yet, or an explicit `versionReason`, or ≥ 20 versions since the last snapshot, or > 10 min since it; pruned to the 200 most recent. After a content/title change: links + `knowledge_edges(kind=link)` rebuilt from page references in the doc, and an `index-source` job enqueued with `singletonKey page:<id>`, 20 s window, `singletonNextSlot`.

### 2.4 Attachments & files

| Method | Path | Request → Response | Notes |
|---|---|---|---|
| POST | /api/attachments | multipart: `file` (≤ 200 MB), `pageId?`, `id?` (client UUID v1–v8) → `201 {id, url:"/api/files/<id>", name, size, mime, hasText, pages}`; existing id → `200` + `x-existing: 1` | blocked mimes: `application/x-msdownload`, `application/x-sh`, `text/html`, `application/javascript`; whole file buffered in memory; text extracted **synchronously** in the request (pdf-parse / mammoth / utf-8 for text-like, `src/lib/files/extract.ts`); unknown pageId → stored with `pageId null` silently; content-addressed storage (dedupe by sha256) |
| GET | /api/attachments?pageId= | ≤ 200 non-deleted: `{id, filename, mime, size, pageId, pageCount, createdAt, hasText, url}` | no pagination |
| DELETE | /api/attachments?id= | soft delete + remove chunks → `{ok}` | id unvalidated; always `{ok:true}` even when nothing matched; file stays on disk forever |
| GET | /api/files/[id] | streams the file; `content-disposition` inline for png/jpeg/gif/webp/svg/pdf/txt/mp4/mp3, else attachment; `cache-control: private, max-age=31536000, immutable`; SVG served with `content-security-policy: script-src 'none'` | **no Range support** (no 206; a whole video/audio/PDF is streamed each time); serves soft-deleted files (D-5); `410` when missing on disk |

No thumbnail/preview generation, no image resizing, no OCR, no audio transcription, no virus scan. No endpoint to re-attach, rename or restore an attachment.

### 2.5 Tasks, tags, settings, jobs

- `GET /api/tasks?done=1` → ≤ 500 tasks `{id,title,status,priority,dueAt,completedAt,project,pageId,createdAt,updatedAt,pageTitle,pageIcon}`, open first, by due date. `POST {title, dueAt? (ISO with offset), priority?: low|medium|high, project?≤100, pageId?}` → 201 row. `PATCH {id, title?, dueAt?, priority?, project?, pageId?, status?: todo|done}` (id in the BODY) → row. `DELETE ?id=` → soft delete. No client-chosen id, no `rev`, no `since` filter, no subtasks, no recurrence, no reminders, no assignee, no link to a block (only to a page). Tasks are a table — they are NOT derived from `taskItem` nodes in documents (the two are unrelated; see section 5/6 sub-audit for the capture "tasks" kind and `components/tasks/parse.ts`).
- `GET /api/tags` → `[{id, name, color, pages}]` (`pages` is always 0 — D-1). No POST/PATCH/DELETE: tags are created implicitly by `PUT /api/pages/[id]/tags`, can never be renamed, recolored, merged or deleted (orphan tags accumulate).
- `GET /api/settings` → `{id, username, displayName, email, preferences, createdAt, workspace:{id,name}, aiBudgetUsd (settings key ai.daily_budget_usd, default 20), sessionId}`. `PATCH {displayName?, email?, preferences?}` (preferences shallow-merged into `users.preferences`, arbitrary keys) → `{displayName,email,preferences}`. `ai.daily_budget_usd` is written by `POST /api/ai/models {action:"budget", usd}` (`src/app/api/ai/models/route.ts:22`), not here.
- `GET /api/settings/audit?limit=≤200` → audit rows of the owner + anonymous ones.
- `GET /api/jobs` → `{worker:{alive,lastBeatAt,version}, queues:[{name, policy:{retryLimit,backoff,expireInSeconds}, created, retry, active, completed, failed}], stuck:[], active:[], failed:[{id,name,at,attempts,error,sourceType,sourceId,executionId,jobId,kind}], deadLetter:n}` (reads `pgboss.job` directly). `POST {action:"retry", name, id}` → `{ok}` (only failed jobs; `409 not_failed`).

### 2.6 Routes documented in the sub-audited sections

`/api/ai/*`, `/api/agents*`, `/api/research/*` → section 4/7 tables. `/api/databases*`, `/api/graph*`, `/api/search*`, `/api/capture`, `/api/inbox*`, `/api/dashboard*`, `/api/export`, `/api/import` → section 5/6 tables.
Complete route inventory (72 `route.ts` files under `src/app/api`): agents, agents/[id], ai/action, ai/chat, ai/chat/plan, ai/compare, ai/compare/vote, ai/conversations, ai/models, ai/usage, attachments, auth/* (13), capture, dashboard, dashboard/summary, databases, databases/templates, databases/[id], …/ai, …/apply-template, …/duplicate, …/import, …/properties, …/query, …/rows, …/rows/restore, …/views, export, files/[id], graph, graph/backlinks, graph/neighbors, graph/suggestions, health, import, inbox, inbox/[id], inbox/undo, jobs, pages (6), research/ai, research/experiments(+[id]), research/overview, research/papers, research/references(+[id], [id]/extracts, [id]/links, doi, export.bib, import-bibtex), research/tasks(+[id]), search, search/duplicates, search/index-state, settings, settings/audit, sync, tags, tasks, trash, tree.
App pages (`src/app/(app)`): `/` (dashboard), `/p/[id]`, `/inbox`, `/tasks`, `/search`, `/graph`, `/backlinks`, `/research`, `/ai/agents`, `/ai/compare`, `/ai/models`, `/archive`, `/trash`, `/settings`; outside the shell: `/login`, `/enroll`, `/offline`.


---

# How this file is organised

| Requested section | Where |
|---|---|
| 0 Deployment facts, 1 Schema, 2 API (cross-cutting rules, auth, sync, pages, attachments/files, tasks, tags, settings, jobs) | first part below (lead auditor) |
| 3 Editor, 8 Offline/PWA, 9 Design system | **Part A** (sub-audit) |
| 4 AI, agents, 7 Research + routes `/api/ai/*`, `/api/agents*`, `/api/research/*` | **Part B** (sub-audit) |
| 5 Knowledge graph, 6 Databases, search, capture/inbox, dashboard, import/export + their routes | **Part C** (sub-audit) |
| 10 Worker/jobs, 11 Tests + scratch environments, 12 Defects (D-1…D-23) | after Part C (lead auditor) |
| 13 Consolidated gap list | end of file |

Defect numbering: `D-n` (with hyphen) = lead auditor, section 12. Part C has its own list `D1…D24`, `U…` (UI) and import/export items in its section (g) — cited here as `C-D8` etc. Part C's D1/D2 are the same findings as D-1/D-3.

Verification status:
- Lead-auditor sections: read line by line. Two library behaviours were checked in the INSTALLED packages on the node: Drizzle's unqualified column rendering (D-1) and Tiptap's empty-document fallback (13.6 item 1) — the latter resolves Part A's main `[UNVERIFIED-LIB]` flag. Part A's other `[UNVERIFIED-LIB]` tags (default attrs of stock Tiptap nodes) remain unverified.
- Sub-audits: nothing executed; items they could not verify are listed at the end of each part. Parts of B and C (UI components, `src/lib/import/**`, `src/lib/export/**`) were read by second-level readers and only spot-checked: line numbers there are less certain than elsewhere. Longer raw notes: `/tmp/spnote-next/c-work/{database-ui,other-ui,import-export}.md`.
- Correction to Part A/B/C statements, if any conflict: the lead-auditor sections prevail for auth, sync, pages, attachments, jobs.
- Test counts are `test(` occurrences; no suite was run.


---

# Part A — Editor (§3), Offline/PWA (§8), Design system (§9)

Source audited: `/tmp/spnote-next/_src` (read-only copy, `package.json` name `note-spboucher-ai` v2.0.0). Nothing was run, built or installed.
All paths are relative to the repo root. `file:N` = line number.

**Verification legend**
- No tag = read directly in the source.
- **[UNVERIFIED-LIB]** = behaviour/default that lives inside an npm package (Tiptap 3.32, ProseMirror). `node_modules` is absent from the copy, so these are stated from knowledge of Tiptap 3 and must be confirmed against the installed version before relying on them.

---

## Section 3 — Editor

### 3.1 Files

| File | Lines | Role |
|---|---|---|
| `src/components/editor/Editor.tsx` | 168 | The only editor component (`Editor`), upload helper `uploadFile`, bubble menu, drag handle, link sheet, image zoom sheet |
| `src/components/editor/extensions/nodes.ts` | 52 | Custom nodes `Callout`, `AIBlock`, `FileBlock`, `FootnoteRef`, `Footnote` + extension `BlockId` |
| `src/components/editor/extensions/slash.tsx` | 79 | `slashItems`, `SlashCommand` |
| `src/components/editor/extensions/mention.tsx` | 26 | `PageMention` (configured `@tiptap/extension-mention`) |
| `src/components/editor/extensions/suggestion-ui.tsx` | 50 | `SuggestionList`, `makeRenderer` (ReactRenderer + tippy.js) |
| `src/components/editor/MobileToolbar.tsx` | 78 | Touch formatting bar |
| `src/components/editor/AIInline.tsx` | 168 | AI actions sheet on selection |
| `src/lib/editor/text.ts` | 87 | `PMNode`, `nodeText`, `docText`, `wordCount`, `docBlocks`, `extractPageRefs`, `toMarkdown`, `emptyDoc`, `ensureBlockIds` |
| `src/lib/editor/markdown-client.ts` | 60 | `markdownToDoc` (marked lexer → PM JSON) |
| `src/lib/editor/validate.ts` | 23 | `assertDoc` (server sanity check) |
| `src/components/page/PageView.tsx` | 165 | Page screen: title, editor mount, sync status, conflict UI, version history |
| `src/components/page/PageProperties.tsx` | 18 | Page-level `properties.tags` chips |
| `src/lib/client/page-sync.ts` | 138 | `usePageSync` autosave engine |
| `src/lib/pages/service.ts` | 144 | `createPage`, `updatePage`, `snapshot`, `resolveConflict`, `pruneVersions`, `afterContentChange` |
| `src/app/api/pages/**` | — | `route.ts`, `[id]/route.ts`, `[id]/resolve`, `[id]/versions`, `[id]/beacon`, `[id]/tags` |

Editor consumers: `PageView.tsx:117` (main), `PageView.tsx:125-126` (conflict compare, read-only ×2), `PageView.tsx:141` (version preview, read-only), `src/components/database/RowPeek.tsx:197` (row notes). `uploadFile` is also imported by `src/lib/client/outbox.ts:4`, `src/components/research/FilesTab.tsx:8`, `src/components/research/ReferenceSheet.tsx:12`.

There is **no collaborative layer** (no Yjs/Hocuspocus dependency in `package.json`); the document is a single ProseMirror JSON blob in `pages.content` (jsonb, `src/db/schema.ts:83`).

### 3.2 Schema — extension list exactly as registered

`Editor.tsx:75-93` (`extensions` memo), in order:

1. `StarterKit.configure({ codeBlock: false, link: { openOnClick: false, autolink: true, defaultProtocol: "https", HTMLAttributes: { rel: "noopener noreferrer" } }, heading: { levels: [1, 2, 3] } })` — `Editor.tsx:76`
2. `TaskList`, `TaskItem.configure({ nested: true })` (from `@tiptap/extension-list`) — `:77`
3. `Table.configure({ resizable: true, lastColumnResizable: false })`, `TableRow`, `TableHeader`, `TableCell` (from `@tiptap/extension-table`) — `:78`
4. `Image.configure({ inline: false, allowBase64: false })`, `Highlight.configure({ multicolor: false })`, `Subscript`, `Superscript`, `TextAlign.configure({ types: ["heading", "paragraph"] })` — `:79`
5. `Youtube.configure({ nocookie: true, width: 640, height: 360 })` — `:80`
6. `Details.configure({ persist: true, HTMLAttributes: { class: "details" } })`, `DetailsSummary`, `DetailsContent` — `:81`
7. `Placeholder.configure({ placeholder: fn, includeChildren: false })` — heading → "Heading", `detailsSummary` → "Toggle title", else the `placeholder` prop (default `Write, or press “/” for blocks and “@” to link pages…`) — `:82`
8. `CharacterCount`, `Dropcursor.configure({ color: "var(--accent)", width: 2 })`, `Gapcursor`, `TrailingNode` (from `@tiptap/extensions`) — `:83`
9. `CodeBlockLowlight.configure({ lowlight, defaultLanguage: "plaintext" })` with `lowlight = createLowlight(common)` (`:35`) — `:84`
10. `Mathematics.configure({ katexOptions: { throwOnError: false }, inlineOptions: { onClick }, blockOptions: { onClick } })` — click opens `window.prompt("Inline LaTeX" | "Block LaTeX")` then `updateInlineMath` / `updateBlockMath` — `:85`
11. `FileHandler.configure({ allowedMimeTypes: undefined, onDrop, onPaste })` → `insertUploaded` — `:86`
12. `Callout, AIBlock, FileBlock, FootnoteRef, Footnote, BlockId, PageMention` — `:87`
13. `SlashCommand.configure({ ctx: { onAI, onUpload, onNewPage } })` — `:88-92`

StarterKit nodes/marks: only `codeBlock` is disabled (replaced by `CodeBlockLowlight`, same node name `codeBlock`). Everything else in StarterKit stays enabled. **[UNVERIFIED-LIB]** Tiptap 3 StarterKit also bundles `link`, `underline`, `listKeymap`, `dropcursor`, `gapcursor`, `trailingNode`, `undoRedo`; if so, `Dropcursor`, `Gapcursor` and `TrailingNode` are registered twice (`:76` and `:83`) and Tiptap logs a duplicate-extension warning. `@tiptap/extension-underline`, `-link`, `-placeholder`, `-character-count`, `-bubble-menu`, `-task-item`, `-task-list`, `-table-row/-cell/-header` are listed in `package.json` but **not imported directly** anywhere in `src` (they come through StarterKit / `@tiptap/extensions` / `@tiptap/extension-list` / `@tiptap/extension-table` / `@tiptap/react/menus`).

`useEditor` options (`Editor.tsx:96`): `content`, `editable`, `immediatelyRender: false`, `autofocus: "end" | false`, `editorProps.attributes` (`class: "ProseMirror"`, `spellcheck`, `aria-label: "Page content"`, `role: "textbox"`, `aria-multiline`), `scrollThreshold`/`scrollMargin` `{ top: 72, bottom: 132 }`, `handleClickOn` (read-only image click → zoom sheet), `handleKeyDown` (⌘/Ctrl+J → AI on selection), `onUpdate → onChange(editor.getJSON())`. **`enableContentCheck` / `onContentError` are absent** (grep over `src`: no match).

### 3.3 Node types as stored in JSON

Custom nodes are fully verified from `nodes.ts`. Library node attrs are **[UNVERIFIED-LIB]** except where the repo itself reads/writes them (cited).

| JSON `type` | Source | Group / content | Attrs (default) | Evidence in repo |
|---|---|---|---|---|
| `doc` | StarterKit | `block+` | — | `text.ts:66` `emptyDoc()` = `{type:"doc",content:[{type:"paragraph"}]}` |
| `paragraph` | StarterKit | block, `inline*` | `textAlign` (TextAlign) **[UNVERIFIED-LIB]**, `id` (BlockId, null) | `Editor.tsx:79`, `nodes.ts:43` |
| `text` | StarterKit | inline | — | — |
| `heading` | StarterKit | block | `level` (1; allowed 1–3), `textAlign`, `id` | `Editor.tsx:76`; `markdown-client.ts:34` clamps `Math.min(3, depth)` |
| `blockquote` | StarterKit | block, `block+` | `id` | — |
| `bulletList` | StarterKit | block | `id` | — |
| `orderedList` | StarterKit | block | `start` (1), `id` | `markdown-client.ts:44`, `export/html.ts:32` |
| `listItem` | StarterKit | — | none (no block id) | `markdown-client.ts:43` |
| `taskList` | `@tiptap/extension-list` | block | `id` | `inbox/service.ts` capture builder |
| `taskItem` | `@tiptap/extension-list` | — | `checked` (false); `nested: true` | `text.ts:50`, `markdown-client.ts:43`, `export/html.ts:33` |
| `codeBlock` | CodeBlockLowlight | block, `text*` | `language` (null; `defaultLanguage: "plaintext"`), `id` | `text.ts:47`, `markdown-client.ts:38` |
| `horizontalRule` | StarterKit | block | none (no block id) | `text.ts:52` |
| `hardBreak` | StarterKit | inline | — | `text.ts:6` |
| `image` | `@tiptap/extension-image` | block (`inline: false`), `allowBase64: false` | `src`, `alt`, `title` (+ `width`/`height` **[UNVERIFIED-LIB]**), `id` | `Editor.tsx:61` inserts `{src, alt, title}` |
| `table` | `@tiptap/extension-table` | block | `id` | — |
| `tableRow` | idem | — | — | `markdown-client.ts:47` |
| `tableHeader` / `tableCell` | idem | `block+` | `colspan` (1), `rowspan` (1), `colwidth` (null) **[UNVERIFIED-LIB]** | `export/html.ts:34` reads `colspan`/`rowspan` |
| `youtube` | `@tiptap/extension-youtube` | block | `src`, `start`, `width`, `height` **[UNVERIFIED-LIB]** | `text.ts:55`, `export/html.ts:38` read `src` |
| `details` | `@tiptap/extension-details` | block | `open` (persisted because `persist: true`), `id` | `slash.tsx:47` inserts `attrs: { open: true }` |
| `detailsSummary` | idem | inline content | — | `slash.tsx:47` |
| `detailsContent` | idem | `block+` | — | `slash.tsx:47` |
| `inlineMath` | `@tiptap/extension-mathematics` | inline atom | `latex` | `slash.tsx:54`, `markdown-client.ts:13,24` |
| `blockMath` | idem | block atom | `latex`, `id` | `slash.tsx:53`, `markdown-client.ts:35,38` |
| `mention` | `@tiptap/extension-mention` (`PageMention`) | inline atom | `id` (page UUID), `label` (page title) | `mention.tsx:14,22`; `text.ts:29` also tolerates `attrs.kind === "user"` (never produced by the client) |
| `callout` | custom `nodes.ts:6-12` | block, `block+`, `defining` | `kind` ("note"; documented values note\|info\|warning\|danger\|ai), `icon` ("💡"), `id` | HTML `div.callout[data-kind][data-icon]`; commands `setCallout`, `toggleCallout` |
| `aiBlock` | custom `nodes.ts:14-19` | block, `block+`, `defining` | `model` (null), `prompt` (null), `at` (null), `id` | HTML `div.ai-block[data-model][data-prompt][data-at]` |
| `fileBlock` | custom `nodes.ts:21-26` | block, `atom`, `draggable` | `src` (null), `name` ("file"), `size` (0), `mime` (""), `attachmentId` (null), `id` | HTML `a.file-block` |
| `footnoteRef` | custom `nodes.ts:28-33` | inline atom | `id` (null) — the footnote number as a string | HTML `sup.footnote-ref[data-id]` |
| `footnote` | custom `nodes.ts:34-39` | block, `inline*` | `id` (null) — footnote number, **not** a block id (`footnote` is not in the BlockId type list) | HTML `div.footnote[data-id]` |

`text.ts` also tolerates a legacy node name `math` (`text.ts:8`, `:38`; `export/html.ts:20`) — no extension in the editor produces it.

**Marks** (JSON `marks[].type`): `bold`, `italic`, `strike`, `code`, `underline`, `link` (attrs `href`, plus `target`/`rel`/`class` **[UNVERIFIED-LIB]**; `rel` forced to `noopener noreferrer`), `highlight` (no colour attr, `multicolor: false`), `subscript`, `superscript`. Marks handled by converters: `toMarkdown` handles bold/italic/code/strike/link/highlight only (`text.ts:37`); `docToHtml` handles all nine (`export/html.ts:17`).

**Absent as schema features:** text colour / font family / font size marks, multi-colour highlight, columns/layout, embed/iframe node other than `youtube`, bookmark/link-preview node, audio/video file node, comment marks, heading levels 4–6.

**Custom-node HTML round-trip caveat (verified in source, runtime effect not tested):** `FileBlock` attrs (`nodes.ts:23`) and `FootnoteRef`/`Footnote` `id` (`:30`, `:36`) declare no `parseHTML`, while `renderHTML` emits `href` / `data-*`. Stored JSON is unaffected, but an HTML clipboard round-trip (copy/paste, drag) would re-parse those attrs from attributes that are not rendered (`src`, `name`, `id`…) and likely lose them.

### 3.4 Custom extensions and editor chrome

- **Mentions / wikilinks** — `mention.tsx`. Trigger `@`, `allowSpaces: true`. Items from `GET /api/search?mode=quick&q=…&limit=8` (`:7`) plus a synthetic `Create page “q”` item (`:9`) which `POST /api/pages {title}` then inserts the mention (`:21`). Inserts `[{type:"mention",attrs:{id,label}},{type:"text",text:" "}]`. Renders `<a class="mention" href="/p/<id>" data-type="mention" data-id data-label>@label</a>`. There is **no `[[` trigger** in the editor; `[[Wiki links]]` exist only as (a) Markdown export syntax for mentions (`text.ts:38`) and (b) Markdown import → mention when the title resolves (`src/lib/import/markdown.ts:58,97`). Backlinks are derived server-side from `mention` nodes and `link` marks whose href matches `/p/<uuid>` (`text.ts:27-31`, `service.ts:100-112`).
- **Math** — `@tiptap/extension-mathematics` + KaTeX (`globals.css:2` imports `katex/dist/katex.min.css`). Editing is by `window.prompt` only (`Editor.tsx:85`, `MobileToolbar.tsx:40`). No inline `$…$` input rule is configured in the repo (**[UNVERIFIED-LIB]** whether the extension ships one). `globals.css:180-181` styles `.Tiptap-mathematics-editor/-render` (class names of the older API — possibly dead CSS, unverified).
- **Callout** — custom, see table. Slash inserts `kind:"note"`; mobile toolbar toggles `kind:"info"` (`MobileToolbar.tsx:40`). **No UI to change `kind` or `icon` after insertion** (absent). CSS variants: `globals.css:171-176` (`info`, `warning`, `danger`, `ai`).
- **Details/toggle** — `@tiptap/extension-details`, `persist: true`.
- **Embeds** — only `youtube` (nocookie, 640×360). The slash item is labelled "Video — YouTube / Vimeo URL" (`slash.tsx:29`) and the CSP allows `player.vimeo.com` frames (`next.config.ts`), but there is **no Vimeo extension**: the handler calls `setYoutubeVideo({ src })` only (`slash.tsx:58`). Generic iframe/embed node: absent.
- **File handler / uploads** — `FileHandler` drop + paste, any MIME. `uploadFile` (`Editor.tsx:40-50`) = `XMLHttpRequest POST /api/attachments` (multipart `file`, optional `pageId`), progress + abort, 413 → "File too large (200 MB max)". Result `Uploaded { id, url, name, size, mime }`. Image MIME → `image` node, otherwise `fileBlock` (`:61`). Upload queue UI with progress/cancel/retry (`:149-152`). Uploads require the network (no offline queue for in-editor uploads).
- **Drag handle** — `@tiptap/extension-drag-handle-react` `DragHandle`, only when `editable && !isTouch` (`Editor.tsx:125-127`), `placement: "left-start"`, CSS `.drag-handle` (`globals.css:185`). No block menu attached to the handle (absent).
- **Bubble menu** — `@tiptap/react/menus` `BubbleMenu`, desktop only; hidden on empty selection, in `codeBlock`, on `image` (`:129`). Buttons: AI, Bold, Italic, Underline, Strike, Highlight, Code, Subscript, Superscript, Link, Heading 2, Bullet list, Quote (`:131-144`).
- **Mobile toolbar** — `MobileToolbar.tsx`, shown when `editable && isTouch && (focused || linkOpen) && !ai` (`Editor.tsx:153`), positioned `bottom: inset` from `useKeyboardInset`; sets `html[data-editing="1"]` (`:17`). Main row: `+` panel toggle, AI (when selection), then contextual: image (View, Delete) / table (+Row, +Col, −Row, −Col, Next, Prev, Header, delete Table, Bold) / code (Copy, Exit block, Text) / default (Bold, Italic, H2, Bullets, Checklist, Outdent/Indent when in list, Link, Quote, Attach); then Undo, Redo, Hide keyboard. Panel "Text": Text, H1, H2, H3, Underline, Strike, Highlight, Inline code. Panel "Insert": Numbered, Quote, Code block, Table 3×3, Callout, Toggle, Divider, Math, Photo (camera capture), Image, File / PDF, Link page (`@`), and "All blocks ( / )".
- **Link editing** — sheet (`Editor.tsx:154-161`), `applyLink` (`:110-117`) prefixes `https://`, refuses `javascript:|vbscript:|data:`.
- **AI inline** — `AIInline.tsx`. Opened by bubble "AI", ⌘J, mobile AI, or slash AI items. Actions (`ACTIONS`, `:26-29`): `rewrite`, `fix`, `summarize`, `expand`, `explain`, `to_list`, `to_tasks`, `table`; plus `translate` (fr, en, es, de, it, pt), `custom` instruction, `continue`, `write`. `AUTO` set (`:32`) also names `shorten`, `formal`, `simplify`, `translate_fr`, `translate_en`, `explain_math`, `action_items` (no UI button for those). Dry-run plan `GET /api/ai/chat/plan?actions=1&chars=N` (`:46`); stream `POST /api/ai/action` via SSE (`:55`) with events `text`/`meta`/`done`/`error` (`confirm_expensive` gate). Result is previewed; apply = one transaction: **Replace** (refused if the selected text changed, `:83`) or **Insert below**; content = `markdownToDoc(out)` wrapped in `aiBlock { model, prompt, at }` (`:80`), except a single-paragraph replace inside one textblock which is inserted inline unwrapped (`:85-86`).
- **Panel → page insertion** — window event `note:insert-markdown` (`PageView.tsx:48`): string → wrapped in `aiBlock { model: "assistant", at }`; `{ markdown, plain: true }` → plain blocks. Emitters: `shell/AIPanel.tsx:20`, `research/LatexSnippets.tsx`, `research/ui.tsx`.
- **Deep link to a block** — `#block-<id>` + optional `?hl=words` (`PageView.tsx:50-54`): scroll to centre + Web Animations flash.
- **CharacterCount** is registered but the word count shown is the server value `page.wordCount` (`PageView.tsx:69`).
- **TextAlign** is registered but **no button sets alignment** anywhere (only the extension's own shortcuts **[UNVERIFIED-LIB]**).

### 3.5 Slash menu — complete list (`slash.tsx:11-37`, handlers `:38-66`)

Trigger `/`, `startOfLine: false`, `allowSpaces: false`; filter on title or `keywords`; max 30 (`:68`).

| Group | Label (hint) | Inserts / does |
|---|---|---|
| Basic | Text (Plain paragraph) | `setParagraph()` |
| Basic | Heading 1 (Section title) | `setHeading({level:1})` |
| Basic | Heading 2 | `setHeading({level:2})` |
| Basic | Heading 3 | `setHeading({level:3})` |
| Basic | Bulleted list | `toggleBulletList()` |
| Basic | Numbered list | `toggleOrderedList()` |
| Basic | To-do list (Checklist) | `toggleTaskList()` |
| Basic | Toggle (Collapsible block) | `details{open:true}` > `detailsSummary["Toggle"]` + `detailsContent[paragraph]` |
| Basic | Quote | `toggleBlockquote()` |
| Basic | Callout (Highlighted note) | `callout{kind:"note",icon:"💡"}` > `paragraph` |
| Basic | Divider | `setHorizontalRule()` |
| Advanced | Code block (Syntax highlighted) | `toggleCodeBlock()` |
| Advanced | Table (3 × 3 with header) | `insertTable({rows:3,cols:3,withHeaderRow:true})` |
| Advanced | Equation (Block LaTeX) | `blockMath{latex:"E = mc^2"}` |
| Advanced | Inline equation | `inlineMath{latex:"x^2"}` |
| Advanced | Footnote | `footnoteRef{id:n}` at cursor + `footnote{id:n}` ("Footnote text") appended at document end; `n` = 1 + count of top-level `footnote` nodes |
| Media | Image (Upload or paste) | file picker `accept="image/*"` → upload → `image` |
| Media | Video (YouTube / Vimeo URL) | `window.prompt` → `setYoutubeVideo({src})` |
| Media | File (Attach PDF, DOCX, …) | file picker `*/*` → upload → `fileBlock` (or `image`) |
| Links | Link to page (Type @ to mention) | inserts the character `@` (opens the mention menu) |
| Links | New sub-page | `POST /api/pages {title:"New page", parentId: pageId, type:"page"}` → inserts a `mention` to it |
| Links | New database (Table / board / calendar) | `POST /api/pages {title:"New database", parentId, type:"database", section:"databases"}` → inserts a `mention` |
| AI | Ask AI to write (Generate content here) | opens `AIInline` mode `write` |
| AI | Continue writing | `AIInline` mode `continue` (auto-runs on full page text) |
| AI | Summarize page | `AIInline` mode `summarize` (auto-runs) |

25 items. Note: `slash.tsx:12` has `run: undefined` on the first item; execution is via `data: run(id)` (`:68`, `:75`).

### 3.6 Block ids

- **Attr name:** `id` (global attribute), rendered as `data-id="<id>"` **and** DOM `id="block-<id>"` (`nodes.ts:43`). `keepOnSplit: false`.
- **Node types that get one (14):** `paragraph, heading, blockquote, codeBlock, bulletList, orderedList, taskList, table, callout, details, aiBlock, blockMath, image, fileBlock` — the list is duplicated in three places that must stay in sync: `nodes.ts:43`, `nodes.ts:45`, `text.ts:69` (`ID_TYPES`).
- **Not covered:** `listItem`, `taskItem`, `tableRow`/cells, `horizontalRule`, `youtube`, `footnote`, `detailsSummary`, `detailsContent`, all inline nodes. So an individual task or list item has **no stable id**.
- **Client side:** `BlockId` ProseMirror plugin `appendTransaction` (`nodes.ts:46-50`): on any `docChanged` transaction, every covered node with a missing **or duplicate** id gets `nanoid(10)`.
- **Server side:** `ensureBlockIds` (`text.ts:76-87`) — same rule (missing, non-string, or duplicate → new id); id = 10 chars from the 64-char alphabet `0-9a-zA-Z_-` using `crypto.getRandomValues` (`rid`, `text.ts:70`). Called in `createPage` (`service.ts:28`) and `updatePage` when `patch.content` is present (`service.ts:49`). A background backfill runs in the index worker, `src/worker/handlers/index-source.ts:6` (`withIds`), writing ids in place **without bumping `version`**.
- **Format:** 10-char URL-safe string on both sides; uniqueness is per document only.
- **Consumers:** `docBlocks` (`text.ts:18-26`) → `chunkDocument` (`src/lib/search/chunk.ts`) stores `blockId` per chunk → search hits link to `/p/<pageId>#block-<blockId>` (`shell/CommandPalette.tsx:40`).
- **Risk noted:** the client compares its pending content with the server copy by `sameJson` (`page-sync.ts:43,96,127`). When the server had to add ids the client did not send (content not produced by the editor), the two differ structurally and an "equal" case can be reported as a conflict. Normal editor saves already carry ids, so this is an edge case.

### 3.7 Server-side document validation

**There is NO allow-list validator.** No node-type list, no mark list, no attr schema exists server-side.

What exists:

1. **zod at the route:** `content: z.any().optional()` — `src/app/api/pages/route.ts:25` (POST), `src/app/api/pages/[id]/route.ts:16` (PATCH), `[id]/resolve/route.ts:9` (`mine.content`). `title` max 500, `icon` max 16, `cover` max 2000, `properties: z.record(z.string(), z.unknown())`, `baseVersion: int ≥ 0`, `versionReason` max 100. The beacon route does not use zod (`[id]/beacon/route.ts:12-15`, manual key filter + title check).
2. **`assertDoc(doc)`** (`src/lib/editor/validate.ts:7-23`), called by POST, PATCH, resolve, beacon and `src/lib/agents/apply.ts` (2 calls):
   - root must be an object with `type === "doc"` and array `content` → else 400 `bad_document`;
   - limits: `MAX_BYTES = 8 MiB` of `JSON.stringify` (413), `MAX_DEPTH = 60` (400), `MAX_NODES = 200_000` (413);
   - every node: object, `type` a string ≤ 64 chars; `text` (if present) a string; `content` (if present) an array; `marks` (if present) an array of objects with string `type`;
   - URL check: node `attrs.href ?? attrs.src` and mark `attrs.href` must not match `/^\s*(javascript|vbscript|data:text\/html)/i` → 400 "Unsafe URL in document".
3. **Unknown node types / marks / attrs: accepted and stored verbatim** — neither rejected nor stripped. A new block type therefore passes the server today with no change, provided it respects the limits above.
4. Not validated: attr values/shapes, heading level, schema conformance (content expressions), `properties` content, text length per node.

**Consequences for new block types (important):**
- Server helpers have `default:` fall-through that recurses into `content` (`toMarkdown` `text.ts:61`, `docToHtml` `export/html.ts:44`, `nodeText` `text.ts:10`): an unknown **container** degrades to its children; an unknown **atom** contributes nothing to `plain_text`, word count, Markdown export, print HTML or search chunks. `docBlocks` (`text.ts:22`) only emits chunks for an explicit type list, and `BLOCKS` (`text.ts:12`) decides newline joining.
- New types must be added to the three block-id lists (§3.6) to be linkable/citable.
- **[UNVERIFIED-LIB]** Client-side, Tiptap builds the document with `schema.nodeFromJSON`; with `enableContentCheck` off (it is not set, §3.2) an unknown node type makes content creation fail and Tiptap falls back to an **empty document** with only a console warning. An older client bundle (stale tab, service-worker-cached JS, native app) opening a page that contains a new block type could therefore show it empty, and the next keystroke would autosave that empty doc (the previous state stays recoverable in `page_versions`). This needs confirming against the installed Tiptap and guarding (`enableContentCheck` + `onContentError`, or a schema-version gate) before shipping new node types.

### 3.8 Autosave, versioning, conflict — end to end

**Client engine:** `usePageSync(page, hooks)` (`page-sync.ts:34`). States `SyncStatus = "saved" | "saving" | "offline" | "error" | "conflict"` (`:15`).

1. **Queue.** `PageView` calls `queue({ content })` on every editor update (`PageView.tsx:117`), `queue({ title })` (`:106`), `queue({ icon })`, `queue({ cover })`, `queue({ properties })` (`:111`). `queue` merges into one `pending` patch (`:68`), mirrors it immediately to IndexedDB (`persist` → `putDraft`, `:41`), and arms a **800 ms** debounce timer (`:71`).
2. **Flush.** One request at a time (`inflight`). `PATCH /api/pages/:id` with the pending patch; if the patch contains any of `VERSIONED = ["title","content","properties"]` it adds **`baseVersion: version.current`** (`:55`); timeout 20 s. Payload fields actually sent: any of `title`, `content` (full PM JSON — no diff/steps), `icon`, `cover`, `properties`, plus `baseVersion`. **No `rev`, no `contentText`, no client timestamp** is sent; `plain_text` and `word_count` are computed server-side (`service.ts:49`). PATCH carries no `Idempotency-Key` (only POST gets one by default, `client/api.ts:19-20`).
3. **Success.** Response `{ id, version, updatedAt, title, wordCount }` (`[id]/route.ts:21`); client stores the new version; if nothing new is pending it deletes the draft (`dropDraft`) and shows "Saved"; otherwise re-persists and re-flushes after **400 ms** (`:64`).
4. **Failure handling** (`:58-64`): the patch is merged back into `pending` and persisted, then
   - `409` + `code === "conflict"` + `body.server` → `raiseConflict`;
   - `401` → redirect to login (draft stays on device);
   - status `0` (network/timeout) or `≥ 500` → status `offline` (or `error` for 5xx while online), exponential backoff **3 s → ×2 → max 30 s**, automatic retry;
   - other `4xx` → `blocked`, status `error`, manual Retry only.
5. **Server write** — `updatePage` (`service.ts:43-64`): versioned fields bump `pages.version` by 1 in SQL (`:51`); when `baseVersion` is supplied the check is done twice — an early read (`:53`) and atomically in the `UPDATE … WHERE version = expect` (`:54`); zero rows → conflict. Non-versioned fields (`icon`, `cover`, `parentId`, `section`, `position`, `pinned`, `archived`, `type`, `inboxAt`) do not bump the version and are not concurrency-checked. Callers without `baseVersion` (imports, agents, restore) overwrite but still bump the version.
6. **Conflict response:** **HTTP 409**, body `{ error: "This note was changed in another session", code: "conflict", server: { version, title, content, properties, updatedAt } }` (`service.ts:36,53,55`; `HttpError.extra` is spread into the JSON by `jsonError`, `src/lib/auth/guard.ts:50`).
7. **Client conflict handling** (`raiseConflict`, `:44-48`): if the server copy already equals the pending patch (`sameAsServer`, `:43` — the client's own keepalive save won the race) it silently adopts the server version; otherwise `blocked = true`, status `conflict`, and edits keep accumulating locally. UI (`PageView.tsx:87-95`, compare dialog `:122-130`): **Compare** (two read-only editors side by side), **Keep mine**, **Keep theirs**, **Keep both**. There is **no merge** (no 3-way merge, no OT/CRDT).
8. **Resolve:** `POST /api/pages/:id/resolve { choice, serverVersion, mine: { title?, content? } }` → `resolveConflict` (`service.ts:78-94`):
   - `mine` → snapshot server copy (reason `conflict · other session's copy`) then `updatePage` with `baseVersion = cur.version`;
   - `theirs` → local copy stored as a **negative-version** history row (`unappliedVersion() = -floor(now/1000)`, reason `conflict · this device's copy (not applied)`), page unchanged;
   - `both` → local copy becomes a new sibling page `"<title> (conflict copy)"`, page unchanged; returns `copyId`.
   - If the page moved again (`cur.version !== serverVersion`) → a fresh 409 with the new server copy (`:80`), surfaced as "The note changed again — review the new version." (`page-sync.ts:86`).
9. **Last-chance save** (`lastChance`, `page-sync.ts:113-119`), on `pagehide` and `visibilitychange → hidden`: (a) synchronous `localStorage["note-draft-<pageId>"]` write; (b) IndexedDB persist; (c) if online and body ≤ `BEACON_MAX = 60_000` chars, `fetch POST /api/pages/:id/beacon` with `keepalive: true`, same body + `baseVersion`. Server (`[id]/beacon/route.ts`): only `title, content, icon, cover, properties` accepted; on conflict it never overwrites — identical content → `{ ok: true, duplicate: true }`; otherwise the unsaved copy is stored as a negative-version snapshot (`unsynced copy from a closed tab (not applied)`) and it answers 409 `{ ok:false, code:"conflict", preserved:true }`.
10. **Remote-change detection** (`check`, `:120-131`), on `visibilitychange → visible` and window `focus`: `GET /api/pages/:id?head=1` (8 s timeout) → `{ id, version, updatedAt, deletedAt }`; if the version differs it fetches the full page; with nothing pending it applies the remote copy (`editor.commands.setContent(c.content, { emitUpdate: false })`, `PageView.tsx:33`) and dispatches `note:remote-update` (toast "Updated"); with pending edits it raises a conflict unless equal. **There is no push channel** (no WebSocket/SSE for page changes) and **no polling timer** — a second open tab only notices on focus/visibility.
11. **Draft recovery on mount** (`:92-105`): newest of the IndexedDB draft and the localStorage draft; identical to server → dropped; `baseVersion === page.version` → applied to the editor, toast "Unsaved changes restored", flushed; otherwise → conflict UI.
12. **Other hooks:** `online` event → immediate flush; unmount → flush (`:134`). Before archive / trash / restore-version, `PageView` awaits `sync.flush()` (`:56,80,82`).

**`page_versions` snapshots** (`src/db/schema.ts:94-98`: `id, page_id, version, title, content, properties, reason, created_at, word_count`; unique `(page_id, version)`):
- Cadence (`service.ts:57-61`), evaluated on every save that changes `content` or `title`: snapshot the **previous** state when there is no positive-version snapshot yet, **or** an explicit `versionReason` is given, **or** `prev.version − lastSnapshot.version ≥ 20`, **or** more than **10 minutes** since the last snapshot. Reason defaults to `autosave`.
- Retention: `pruneVersions` keeps the **200** most recent rows per page by `created_at` (`:95-98`).
- Snapshots are idempotent per version (`onConflictDoNothing`, `:69`).
- List: `GET /api/pages/:id/versions` (≤ 200, newest first: `id, version, title, reason, createdAt, wordCount`); one: `GET …/versions?v=<n>`.
- **Restore:** `POST /api/pages/:id/versions { version }` → `updatePage(title, content, properties)` with `versionReason: "restore v<n>"` and **no `baseVersion`** (so the current state is snapshotted first, the version is bumped, and no conflict check is made). Client: `restore()` flushes, posts, then `window.location.reload()` (`PageView.tsx:56`). Negative "Unapplied copy" entries are restorable the same way.
- No diff view between versions (preview is a read-only editor only): absent.

**After every content/title save** (`afterContentChange`, `service.ts:100-112`): rebuild `links` rows of kind `link`, upsert/delete `knowledge_edges` of kind `link`, enqueue one index job per page per 20 s (`singletonKey: page:<id>`).

`pages.rev` (`schema.ts`, bigint, maintained by DB trigger `sync_bump_rev` per the column comment) exists for native-client pull sync; the web autosave does not read or send it.

### 3.9 Markdown conversion and text extraction

**PM JSON → Markdown** — `toMarkdown` (`text.ts:34-65`), pure, shared by server and client. Used by `src/lib/export/markdown.ts:52` (`pageMarkdown`, adds YAML front-matter + `# title`), `src/lib/ai/chat.ts`, `src/lib/agents/runner.ts`, `src/lib/agents/tools.ts`, `src/lib/research/ai.ts`.
- Inline: `**bold**`, `*italic*`, `` `code` ``, `~~strike~~`, `[t](href)`, `==highlight==`; `hardBreak` → two spaces + newline; `mention` → `[[label]]`; `inlineMath`/`math` → `$latex$`; `footnoteRef` → `[^id]`.
- Blocks: paragraph, `#`×level heading, `> ` blockquote, fenced `codeBlock` with language, `- ` / `1. ` / `- [x] ` lists (2-space nesting), GFM table (first row as header), `---`, `![alt](src)`, `fileBlock` → `[📎 name](src)`, `youtube` → bare URL, `blockMath` → `$$\n…\n$$`, `callout` → `> [!KIND] icon` + quoted body, `details` → raw `<details><summary>…</summary>`, `aiBlock` → `> [!AI] model` + quoted body, `footnote` → `[^id]: text`; unknown → children.
- **Lossy:** `underline`, `subscript`, `superscript` marks; `textAlign`; block ids; table `colspan`/`rowspan`/`colwidth`; `aiBlock.prompt`/`at`; `details.open`; image `title`.

**Markdown → PM JSON** — `markdownToDoc(md): PMNode[]` (`markdown-client.ts:56-60`), `marked.lexer(…, { gfm: true })`. Used client-side (`AIInline.tsx:78`, `PageView.tsx:48`, `chat/Chat.tsx`, `ai/compare/ComparePanel.tsx`, `dashboard/widgets.tsx`, `research/ui.tsx`) **and server-side** (`src/lib/import/markdown.ts:68,136`, `src/lib/agents/apply.ts`). There is one implementation for both sides.
- Produces: `heading` (level clamped to 3), `paragraph`, `blockquote`, `codeBlock{language}`, `horizontalRule`, `bulletList`/`orderedList{start}`/`taskList` with `listItem`/`taskItem{checked}`, `table`/`tableRow`/`tableHeader`/`tableCell`, `hardBreak`, `blockMath` (a paragraph that is exactly `$$…$$`, or a ```` ```math ```` fence), `inlineMath` (`$…$` in text, or a code span that is `$…$`); marks `bold`, `italic`, `strike`, `code`, `link{href}`.
- **Not produced** (so `toMarkdown → markdownToDoc` does not round-trip): `callout`, `aiBlock`, `details`, `footnote`/`footnoteRef`, `fileBlock`, `youtube`, `highlight`, `mention`, `image` (inline images become the text `[image: …]`, `:18`); raw HTML becomes literal text (`:17,50`).
- Server import layer `mdToDoc` (`src/lib/import/markdown.ts:63-120`) adds: `![…](…)` → `image` nodes backed by attachments (paragraphs split around them), `[[Wiki|alias]]` → `mention` when the target resolves else plain text, relative links → `/p/<id>` or `/api/files/<id>`, YAML front-matter and Notion-style header parsing (`parseFrontMatter`, `parseNotionHeader`).
- DOCX import: mammoth → HTML → `turndown` → Markdown → the same path (`src/lib/import/docx.ts`).

**PM JSON → HTML** (print / "PDF") — `docToHtml` (`src/lib/export/html.ts:14-49`), KaTeX rendered server-side; `GET /api/export?format=pdf&pageId=` returns print-ready HTML (browser print), not a generated PDF file.

**Chat/AI Markdown rendering** — `src/components/markdown.tsx`: `react-markdown` + `remark-gfm` + `remark-math` + `rehype-katex`.

**Text extraction** (`text.ts`):
- `nodeText` (`:4-11`): text; `hardBreak` → `\n`; `mention` → `@label`; math → latex; children joined with `\n` when any child is in `BLOCKS` (`:12`), else `""`.
- `docText` (`:14`): `nodeText(doc)`, collapses 3+ newlines, trims → stored in `pages.plain_text` (feeds the generated `tsv` column, `schema.ts:85`).
- `wordCount` (`:15`): Unicode letters/digits regex with inner `' ’ -`.
- `docBlocks` (`:18-26`): flat list `{ id, type, heading, text }`; emits headings and non-empty `paragraph, blockquote, codeBlock, bulletList, orderedList, taskList, table, callout, details, aiBlock, blockMath` as whole units (does not descend into them); `image`, `fileBlock`, `youtube`, `footnote`, `horizontalRule` produce no block.
- `extractPageRefs` (`:27-31`): page ids from `mention` nodes (unless `attrs.kind === "user"`) and `link` hrefs `/p/<uuid>`.

---

## Section 8 — Offline / PWA

### 8.1 Service worker (`public/sw.js`, 34 lines)

- **Registration:** `src/components/shell/Shell.tsx:41-52` — `navigator.serviceWorker.register("/sw.js")`, **production only** (`process.env.NODE_ENV !== "production"` → skip), inside the authenticated shell (not on `/login`, `/enroll`, `/offline`). Default **scope `/`** (script at the origin root, no `scope` option). `reg.update()` on each `visibilitychange → visible`.
- **Update flow:** a new worker waits; UI banner "A new version is ready." (`Shell.tsx:71`) → `postMessage({ type: "SKIP_WAITING" })` → `controllerchange` → reload only if `window.__noteUpdateAccepted` (`:51`). No `skipWaiting()` at install; `clients.claim()` at activate (`sw.js:21`).
- **Cache name:** a single cache, `VERSION = "note-static-v3"` (`sw.js:9`). `activate` deletes every other cache (`:21`). (`wipeLocalData` also deletes caches prefixed `note-rt-`, `offline.ts:49` — no code creates such a cache: legacy.)
- **Precache** (`SHELL`, `sw.js:10`): `/offline`, `/manifest.webmanifest`, `/icons/icon-192.png`, `/icons/icon-512.png`, `/icons/icon.svg`, `/icons/apple-touch-icon.png` (fetched with `cache: "reload"`), plus every `/_next/static/…` URL found by regex in the `/offline` HTML (best effort, `:18`). `/icons/icon-maskable-512.png` is not precached.

| Request | Strategy | Evidence |
|---|---|---|
| non-GET, cross-origin | not handled (network) | `sw.js:24-25` |
| `/_next/static/*`, `/icons/*` | **cache-first**, runtime-cached into `note-static-v3` on `res.ok && res.type === "basic"` | `sw.js:11,26-28` |
| navigations (`req.mode === "navigate"`) | **network-only**; on failure → cached `/offline` page, else `503 "Offline"` text | `sw.js:30-31` |
| everything else (API, RSC payloads, `/api/files/*`, manifest at runtime) | untouched, straight to network | `sw.js:33` |

- **Never cached:** API responses, page HTML, RSC payloads, uploaded files (stated in the header comment `sw.js:3-6` and consistent with the code). API responses are also sent `cache-control: private, no-store` (`src/lib/api.ts:36`).
- **Background Sync / Periodic Sync / Push:** **absent** (no `sync`, `periodicsync` or `push` listener in `sw.js`; no `SyncManager`/`registration.sync` anywhere in `src`). Replay is driven by page events only.

### 8.2 Manifest (`public/manifest.webmanifest`)

`id: "/"`, `name: "Note SPBoucher AI"`, `short_name: "Note"`, `start_url: "/"`, `scope: "/"`, `display: "standalone"`, `display_override: ["standalone","minimal-ui"]`, `orientation: "any"`, `background_color` and `theme_color` `#12141c`, `lang: "en"`, `categories: ["productivity"]`. Icons: `icon.svg` (any), `icon-192.png`, `icon-512.png`, `icon-maskable-512.png` (maskable). Shortcuts: "Quick capture" `/?capture=1`, "Search" `/search`, "Inbox" `/inbox`. `/?capture=1` and `/?ai=1` are handled in `Shell.tsx:54`. **Absent:** `share_target`, `file_handlers`, `protocol_handlers`, `screenshots`.
Linked from `src/app/layout.tsx:9`; `appleWebApp { capable: true, statusBarStyle: "black-translucent", title: "Note" }` (`:10`).

### 8.3 Device storage — exactly what is stored

**IndexedDB — yes, used.** Database `note-local`, version `1` (`src/lib/client/offline.ts:11,19-20`), two object stores:

| Store | keyPath | Shape | Written by |
|---|---|---|---|
| `drafts` | `pageId` | `Draft { pageId: string; baseVersion: number; patch: Record<string, unknown>; updatedAt: number }` — `patch` is the pending PATCH body (may hold the full `content` JSON, `title`, `icon`, `cover`, `properties`) | `page-sync.ts:41` (`putDraft`), deleted on confirmed save |
| `outbox` | `id` | `OutboxItem { id: string; kind: "capture"; body: { kind: string; text?: string; url?: string }; files?: File[]; uploadedIds?: string[]; createdAt: number; attempts: number; lastError?: string }` — `id` doubles as the `Idempotency-Key`; `File` objects are stored structurally | `outbox.ts:14` (`enqueueCapture`) |

- No indexes. Retention 30 days (`RETENTION_MS`, purge at shell start: `purgeExpired`, `Shell.tsx:56`). Not encrypted (rationale in the header comment `offline.ts:7-9`). Erased by `wipeLocalData` (`offline.ts:45-51`) on "Lock this device" (`Sidebar.tsx:37`, `MobileNav.tsx:94`).
- **Not stored in IndexedDB:** pages, the page tree, attachments, search index, databases, settings, tasks. There is **no local copy of any note** that was not being edited.
- The header comment (`offline.ts:5`) mentions "page saves" in the outbox, but the type only allows `kind: "capture"` — page saves live in `drafts`, not `outbox`.

**localStorage keys**

| Key | Content | Source |
|---|---|---|
| `note-theme` | `"system" \| "light" \| "dark"` | `store.ts:10`, read by the inline script `layout.tsx:17` |
| `note-ui` (zustand persist) | `{ state: { sidebarOpen, aiWidth, theme }, version }` | `store.ts:11` |
| `note-prefs` | `Prefs { density?, editorFont?, defaultSection?, aiDefaultTask?, aiAlwaysCite? }` | `settings/prefs.ts:4-9` |
| `note-draft-<pageId>` | synchronous copy of a `Draft` (written only on tab hide/unload) | `page-sync.ts:28-31,114` |
| `note-draft-capture` | `{ text, kind }` of the open capture sheet | `CaptureSheet.tsx:15,31-32,65` |
| `note-tree-open` | `Record<id \| "sec:<section>", boolean>` | `Sidebar.tsx:23,25` |
| `db-view-<dbId>` | last view id of a database | `database/DatabaseView.tsx:45,48` |
| new-row draft (`newRowDraftKey(dbId)`) | database new-row draft | `database/NewRowSheet.tsx:20-30` |
| `research-panel-open`, `research-tab-<pageId>` | research panel UI state | `research/ResearchPanel.tsx:29,47,60` |
| search filters (`STORE`) | search page filters | `search/SearchPage.tsx:43-44` |

`wipeLocalData` removes keys prefixed `note-pending-`, `note-draft-`, `note-search`, and `note-recent-searches` (`offline.ts:47`) — so `note-draft-capture` is wiped, but `note-ui`, `note-prefs`, `note-tree-open`, `db-view-*`, `research-*` are kept. `note-pending-*` has no writer (legacy).

**sessionStorage:** `note-offline-from` (`auth/OfflineScreen.tsx:6`), `draft:<key>` (`research/ui.tsx:72-74`), search scroll (`search/SearchPage.tsx:56`); all cleared by `wipeLocalData` (`offline.ts:48`).

**Cache Storage:** only `note-static-v3` (§8.1). React Query cache is in memory only (`providers.tsx:5`: `staleTime 15_000`, `refetchOnWindowFocus: false`, `retry: 1`; no persister).

### 8.4 What works offline, and what does not

| Capability | Status | Detail |
|---|---|---|
| Open the app cold while offline | **No** | Navigation is network-only → `/offline` screen (`sw.js:30-31`). The screen says so: "Your notes are not stored on this device, so they cannot be shown without a connection." (`OfflineScreen.tsx:12`); it reloads to the previous URL when `online` fires. |
| Read a note not already on screen | **No** | No local page store; client-side route changes need RSC/API from the network. |
| Keep editing the page **already open** when the network drops | **Yes (partial)** | Edits accumulate in memory + `drafts` store; status "Offline · kept on this device" + Retry; auto-retry with backoff and on `online`. Survives tab close/crash and is replayed on the next online visit to that page (`page-sync.ts:92-105`). The page must be reopened online for the replay — there is no global draft replayer. |
| Create a new page offline | **No** | `POST /api/pages` is a direct `api()` call everywhere (`Shell.tsx:31`, `Sidebar.tsx:27`, `TopBar.tsx:30`, `CommandPalette.tsx:29,37`, `slash.tsx`/`Editor.tsx:91`, `mention.tsx:21`); no queue. (The server does support client-chosen UUIDs for native clients, `api/pages/route.ts:25-29`, but the web client never sends `id`.) |
| Quick capture offline (text / to-do / link / photo / file / voice memo) | **Yes** | `enqueueCapture` writes to `outbox` first, then sends; replay is idempotent (`Idempotency-Key = item.id`, uploaded attachment ids recorded so files are not re-uploaded) (`outbox.ts`). Works only if the shell is already loaded. "Capture and open" is disabled offline (`CaptureSheet.tsx:89`). Without IndexedDB (private mode) it sends directly and reports failure. |
| Sidebar quick-capture field | **No** | `Sidebar.tsx:32` posts `/api/capture` directly, bypassing the outbox. |
| Upload a file/image in the editor offline | **No** | `uploadFile` fails with "Network lost during upload"; manual Retry in the upload list (`Editor.tsx:46,149-152`). |
| Search, AI, databases, tasks, graph, settings offline | **No** | Network only. AI sheet shows "You are offline: nothing can be sent." (`AIInline.tsx:107`). |
| Delete / move / pin / tag offline | **No** | Direct API calls, no queue. |
| Queue replay trigger | Page events only | `flushOutbox()` at shell mount and on `online`, `visibilitychange → visible`, `pageshow` (`Shell.tsx:56`); also from `SyncPill` (`MobileNav.tsx:22`). Oldest first, stops at the first non-fatal failure; a 4xx other than 401/409/429 is "fatal" and is skipped (`outbox.ts:29,38`). |
| Background sync when the app is closed | **No** | No Background Sync API (§8.1). |
| Offline indicators | Yes | `useOnline` (`hooks.ts:6`); `SyncPill` in the mobile header only ("Offline", "Offline · N kept", "N to sync") (`MobileNav.tsx:20-25`); page status pill (`PageView.tsx:64-68`). No desktop-wide offline indicator outside the page status. |

`src/lib/client/api.ts`: `api()` (JSON fetch, auto `Idempotency-Key` on POST, `x-request-id`, optional timeout, `ApiError { status, code, body }`, status 0 = network, 401 → `toLogin()`), `sse()` (POST + `data:` lines, `[DONE]`), `newKey()`.

---

## Section 9 — Design system

### 9.1 Stack

- **Tailwind CSS v4** via `@tailwindcss/postcss` (`postcss.config.mjs`: `{ plugins: { "@tailwindcss/postcss": {} } }`). **No `tailwind.config.*` file** — configuration is CSS-first in `src/app/globals.css` (`@import "tailwindcss"`, `@theme { … }`, `@custom-variant dark (&:where(.dark, .dark *))`).
- `class-variance-authority` (only in `ui/button.tsx`), `clsx` + `tailwind-merge` (`cn`, `src/lib/utils.ts:3`), Radix primitives, `cmdk`, `tippy.js` (suggestion popups), `lucide-react`.
- Design name in the CSS comment: "Graphite & Ultramarine" (`globals.css:42`).

### 9.2 Tokens (`src/app/globals.css`)

**Colours** — raw custom properties on `:root` (light, `:43-66`) and `.dark` (`:68-91`), aliased to Tailwind colour utilities through `--color-*` in `@theme` (`:11-28`), e.g. `bg-bg`, `text-fg-muted`, `border-line`, `bg-accent-soft`, `text-ai`.

| Token | Light (`:root`) | Dark (`.dark`) |
|---|---|---|
| `--bg` | `oklch(98.7% 0.003 255)` | `oklch(17.2% 0.013 268)` |
| `--bg-elev` | `oklch(100% 0 0)` | `oklch(21% 0.015 268)` |
| `--bg-sunk` | `oklch(96.3% 0.005 255)` | `oklch(14.6% 0.012 268)` |
| `--bg-side` | `oklch(97.2% 0.005 255)` | `oklch(15.6% 0.013 268)` |
| `--bg-hover` | `oklch(94.6% 0.007 258)` | `oklch(24.5% 0.016 268)` |
| `--fg` | `oklch(21.5% 0.018 265)` | `oklch(94% 0.006 255)` |
| `--fg-muted` | `oklch(46% 0.018 262)` | `oklch(72% 0.014 260)` |
| `--fg-faint` | `oklch(63% 0.014 260)` | `oklch(54% 0.014 262)` |
| `--line` | `oklch(91.8% 0.006 258)` | `oklch(26.5% 0.015 268)` |
| `--line-strong` | `oklch(85.5% 0.009 258)` | `oklch(33.5% 0.018 268)` |
| `--accent` | `oklch(52.5% 0.2 265)` | `oklch(73% 0.14 265)` |
| `--accent-fg` | `oklch(99% 0.003 265)` | `oklch(17% 0.03 265)` |
| `--accent-soft` | `oklch(95.4% 0.032 265)` | `oklch(29% 0.065 265)` |
| `--danger` | `oklch(55% 0.2 25)` | `oklch(69% 0.17 25)` |
| `--success` | `oklch(56% 0.14 155)` | `oklch(73% 0.13 155)` |
| `--warning` | `oklch(70% 0.15 70)` | `oklch(80% 0.14 75)` |
| `--ai` | `oklch(53% 0.21 298)` | `oklch(75% 0.14 298)` |
| `--ai-soft` | `oklch(95.5% 0.035 298)` | `oklch(29% 0.07 298)` |
| `--ring` | `oklch(52.5% 0.2 265 / 0.35)` | `oklch(73% 0.14 265 / 0.4)` |
| `color-scheme` | `light` | `dark` |

`--ring` has no `--color-ring` alias (used directly in the focus-visible rule, `:100`).

**Shadows**

| Token | Light | Dark |
|---|---|---|
| `--shadow-card` | `0 1px 2px oklch(25% 0.03 265 / 0.05), 0 0 0 1px oklch(25% 0.03 265 / 0.02)` | `0 1px 2px oklch(0% 0 0 / 0.35), 0 0 0 1px oklch(100% 0 0 / 0.02)` |
| `--shadow-pop` | `0 16px 40px -12px oklch(25% 0.04 265 / 0.22), 0 3px 8px -2px oklch(25% 0.04 265 / 0.08)` | `0 18px 44px -14px oklch(0% 0 0 / 0.75), 0 0 0 1px oklch(100% 0 0 / 0.05)` |

Utilities `shadow-card`, `shadow-pop` (`:29-30`).

**Type scale** (`@theme`, `:31-38`; comment "1.2 minor third, 16 px base for reading, 13 px for chrome")

| Utility | Size | Line height |
|---|---|---|
| `text-micro` | 0.6875rem (11 px) | 1rem |
| `text-ui` | 0.8125rem (13 px) | 1.25rem |
| `text-body` | 1rem | 1.75rem |
| `text-h3` | 1.25rem | 1.75rem |
| `text-h2` | 1.5rem | 2rem |
| `text-h1` | 1.875rem | 2.375rem |
| `text-display` | 2.5rem | 3rem |

In practice most chrome uses arbitrary sizes (`text-[13px]`, `text-[10.5px]`, `text-[15px]`, …) rather than these tokens.

**Radii:** one token, `--radius: 0.5rem` (`:10`). Components use Tailwind's default scale directly (`rounded-md`, `-lg`, `-xl`, `-2xl`, `-3xl`, `-full`). No radius scale tokens.

**Spacing:** **no custom spacing tokens** — Tailwind default scale plus arbitrary values. Runtime layout variables set by JS on `<html>`: `--kb` (keyboard inset px) and `--vvh` (visual viewport height px) (`src/lib/client/hooks.ts:26`).

**Motion:** **no duration/easing tokens.** The only animation token is `--animate-shimmer: shimmer 1.6s ease-in-out infinite` (`:39`). Hard-coded animations:

| Name | Definition | Where |
|---|---|---|
| `fade-up` | `180ms ease-out both`, `opacity 0 → 1`, `translateY(4px) → 0` | `:202-203`; popovers, menus, dialogs, toasts, tooltips, palette, suggestion list |
| `sheet-up` (`.sheet`) | `220ms cubic-bezier(.2,.8,.2,1) both`, `translateY(24px)` + fade; from 640 px up `.sheet` uses `fade-up` | `:213-215` |
| `pulse-soft` | `1.4s ease-in-out infinite`, opacity 1 ↔ .45 | `:204-205` |
| `shimmer` (`.skeleton`) | `1.6s ease-in-out infinite` background slide | `:108-109` |
| sidebar width | `transition-[width] duration-200 ease-out` | `Shell.tsx:61` |
| block highlight flash | Web Animations API, 2600 ms `ease-out` | `PageView.tsx:52` |

Dead class: `data-[state=open]:animate-in` on the dialog overlay (`ui/primitives.tsx:16`) — no `animate-in` utility/plugin exists in the repo. The `drawer` class on the mobile drawer (`MobileNav.tsx:100`) has no CSS rule: the drawer has **no open/close animation** (only the drag transform).

**Other global CSS:** `.safe-top` / `.safe-bottom` (`:97-98`), global focus ring `outline: 2px solid var(--ring); outline-offset: 2px` on `:focus-visible` (`:99-102`), thin scrollbars (`:95`), `::selection` = `--accent-soft` (`:96`), `.measure { max-width: 46rem }`, `.tabular`, `.side-label` / `.side-item` (`:113-115`), cover presets `.cover-aurora|ink|paper|dusk|moss|grid` (`:119-124`), `.db-scroll`, `.graph-canvas`, `.note-editor …` rules (`:141-185`, `:216-232`), `.prose-md`, `.cite-chip`, `.chat-md`. Body: `font-feature-settings: "cv11", "ss01", "liga"`, `antialiased`.

### 9.3 Themes

- **Two themes:** light (`:root`) and dark (`.dark` class on `<html>`); user choice is three-way: `system | light | dark`. No additional/accent/high-contrast themes (absent).
- **Switch/store:** `useUI().setTheme` (`src/lib/client/store.ts:10`) toggles `document.documentElement.classList.toggle("dark", …)` and writes `localStorage["note-theme"]`; the value is also persisted in the zustand `note-ui` blob. A blocking inline script in `<head>` applies `.dark` before paint (`layout.tsx:17,22`). `Shell.tsx:24` re-applies on mount.
- **UI entry points:** sidebar header menu Light/Dark/System (`Sidebar.tsx:71-72`), Settings → Appearance (`settings/AppearanceSection.tsx:21`), command palette "Dark mode" / "Light mode" (`CommandPalette.tsx:37`; no "System" command).
- Theme is **device-local** ("Stored on this device", `AppearanceSection.tsx:21`), not in `users.preferences`.
- **Gap:** in `system` mode there is no `matchMedia` change listener — an OS theme change is only picked up on the next load.
- `viewport.themeColor`: light `#f9fafc`, dark `#12141c` (`layout.tsx:15`), keyed on `prefers-color-scheme` (not on the manual choice).
- **Other appearance prefs** (`settings/prefs.ts`): `density` `comfortable | compact` (sets `html[data-density]` and root `font-size: 15px` when compact — no CSS rule targets `data-density`), `editorFont` `sans | serif` (injects `<style id="note-prefs-style">` setting `.note-editor .ProseMirror { font-family: var(--font-serif) }`). Stored server-side in `users.preferences` (`PATCH /api/settings`) and mirrored in `localStorage["note-prefs"]`.

### 9.4 Fonts

Declared stacks (`globals.css:7-9`):
- `--font-sans: "Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`
- `--font-serif: "Source Serif 4", "Iowan Old Style", ui-serif, Georgia, serif`
- `--font-mono: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace`

**No font is loaded by the app:** no `next/font`, no `@font-face`, no font files in `public/`, no external font URL (and the CSP `font-src 'self' data:` would block a CDN). Inter / Source Serif 4 / JetBrains Mono render only if installed on the device; otherwise the system fallbacks apply. The only bundled webfonts are KaTeX's (via `katex/dist/katex.min.css`, `globals.css:2`). `<body className="font-sans">` (`layout.tsx:23`).

### 9.5 Component primitives (`src/components/ui`)

| File | Export | Variants / props |
|---|---|---|
| `button.tsx` | `Button`, `buttonVariants` (cva) | `variant`: `default`, `secondary`, `ghost`, `outline`, `danger`, `ai`, `link`; `size`: `default` (h-9), `sm` (h-8), `xs` (h-7), `lg` (h-10), `icon` (size-9), `iconSm` (size-8), `iconXs` (size-7); `asChild` (Radix `Slot`) |
| `input.tsx` | `Input`, `Textarea`, `Label` | no variants |
| `primitives.tsx` | `Dialog`, `DialogTrigger`, `DialogClose`, `DialogContent` | `title`, `description`, `wide` (`max-w-4xl` vs `max-w-lg`) — Radix Dialog |
| | `SheetContent` | bottom sheet on phones, centred dialog from `sm`; `title`, `description`; max height follows `--vvh`; safe-area bottom padding |
| | `Popover`, `PopoverTrigger`, `PopoverAnchor`, `PopoverContent` | `align` ("start"), `sideOffset` (6) |
| | `Tip` | tooltip; `label`, `side` (`top`/`bottom`/`left`/`right`, default bottom), delay 400 ms; wraps its own `TooltipProvider` |
| | `Menu`, `MenuTrigger`, `MenuContent`, `MenuItem`, `MenuSeparator` | Radix DropdownMenu; `MenuItem.danger`; 44 px rows below `md`, 32 px above |
| | `Switch` | Radix Switch |
| | `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent` | Radix Tabs (segmented style) |
| | `Badge` | `tone`: `neutral`, `accent`, `ai`, `success`, `warning`, `danger` |
| | `Kbd`, `Spinner`, `Empty` (`icon`, `title`, `hint`, `action`), `Skeleton` | — |
| `toast.tsx` | `toast(title, opts)`, `Toaster` | `tone`: `neutral`, `success`, `danger`, `ai`; `description`; `action { label, run }`; `duration` (default 4200 ms, 8000 ms with an action); max 3 visible; custom implementation |

**Absent as shared primitives:** Select, Checkbox, Radio, Avatar, ScrollArea, Separator, ContextMenu, Accordion, Slider, DatePicker, Card, Table, Breadcrumb, Combobox. The packages `@radix-ui/react-avatar`, `-checkbox`, `-context-menu`, `-scroll-area`, `-select`, `-separator`, `-toast` are in `package.json` but imported nowhere in `src` (only `react-dialog`, `-dropdown-menu`, `-popover`, `-slot`, `-switch`, `-tabs`, `-tooltip` are). `sanitize-html` is likewise unused. Feature folders define their own local UI helpers (e.g. `src/components/research/ui.tsx`, `src/components/database/Responsive.tsx`) — not audited here.

### 9.6 Animation library

The **`motion` package (`^14.9.0`) is a dependency but is not imported anywhere** — grep for `from "motion…"` / `framer-motion` over `src` returns nothing. All animation is CSS keyframes/transitions (§9.2), Tailwind `animate-spin` / `animate-pulse`, one Web Animations API call (`PageView.tsx:52`), and manual touch-drag transforms (`MobileNav.tsx:86-87`). Drag-and-drop uses `@dnd-kit` (database views, 4 files); the graph uses `react-force-graph-2d`.

### 9.7 `prefers-reduced-motion`

One global rule, `globals.css:135-138`: every element and pseudo-element gets `animation-duration: 0.001ms !important; animation-iteration-count: 1 !important; transition-duration: 0.001ms !important; scroll-behavior: auto !important`, and `.skeleton { animation: none }`. No JS-level handling: the Web Animations flash (`PageView.tsx:52`), `scrollIntoView` calls and the force-graph simulation are not gated (no `useReducedMotion`, no `matchMedia("(prefers-reduced-motion…")` in `src`).

### 9.8 Shell layout

- **Root** (`src/app/layout.tsx`): `<html lang="en">`, theme script, `<Providers>` (React Query only, `components/providers.tsx`) + `<Toaster />`. Viewport: `viewportFit: "cover"`, `width: device-width`, `initialScale: 1`, **`maximumScale: 1`** (pinch-zoom disabled), `interactiveWidget: "resizes-content"`. `robots` noindex.
- **App layout** (`src/app/(app)/layout.tsx`): server component; `requireUserPage()`, `getWorkspace()`, `listTree()` → `<Shell user workspace initialTree>`. `loading.tsx` = skeleton grid.
- **`Shell`** (`shell/Shell.tsx:59-74`): `div.flex.h-dvh` = desktop `<aside>` sidebar (`w-[17rem]`, collapses to `w-0`, hidden below `md`) + column [`TopBar` (desktop) / `MobileHeader` (phone) → `<main id="main-scroll">` (the scroll container; phone bottom padding `4.5rem + safe-area`) → `MobileNav`] + optional `AIPanel` + `CommandPalette` + `CaptureSheet` + update banner + `ShortcutsDialog` + focus-mode exit button. "Skip to content" link (`:60`). The tree is live via React Query key `["tree"]` → `GET /api/tree`, `staleTime 10_000`.
- **Global shortcuts** (`Shell.tsx:26-35`; ⌘ or Ctrl): `K` palette, `/` AI panel, `\` sidebar, `⇧N` new page, `⇧C` quick capture, `.` focus mode, `?` shortcuts help, `Esc` leaves focus mode (when not inside the editor). `ShortcutsDialog.tsx` lists them (it omits ⌘⇧C). In-editor: ⌘J AI on selection (`Editor.tsx:96`).
- **UI state** (`store.ts`, zustand `useUI`): `sidebarOpen`, `aiOpen`, `aiWidth` (400), `focusMode`, `theme`, `paletteOpen`, `captureOpen`, `drawerOpen`, `aiContext { pageId, selection, conversationId, prefill }`.

**Sidebar** (`shell/Sidebar.tsx`), top to bottom:
1. Header: app icon + workspace name + user display name (link to `/`); theme menu.
2. "Search ⌘K" button (opens the palette); "Quick capture…" inline field (`POST /api/capture`, kind `link` if URL else `note`).
3. Primary nav: **Home** `/`, **Ask AI** (⌘/), **Inbox** `/inbox`, **Tasks** `/tasks`, **Graph** `/graph`.
4. Scrollable tree (`role="tree"`): **Pinned** (if any); **Databases** (up to 12, `+` creates one); **Workspace** — sections `SECTIONS` (`:15-17`): **Notes**, **Documents**, **Projects**, **Research** (creates `type: "research"`), each collapsible with a root-page count and `+`; nested page items (indent `4 + depth×14` px, expand chevron, hover actions: menu [Add sub-page, Pin/Unpin, Duplicate, Move to trash] and `+`); **Intelligence**: Research `/research`, Backlinks `/backlinks`, Agents `/ai/agents`, AI models `/ai/models`, Compare models `/ai/compare`.
5. Footer icons: Archive `/archive`, Trash `/trash`, Settings `/settings`, Keyboard shortcuts, **Lock** (logout + `wipeLocalData`).
- Tree open state in `localStorage["note-tree-open"]`. **No drag-and-drop reordering of pages in the tree** (no dnd import in `Sidebar.tsx`).

**TopBar** (desktop, `shell/TopBar.tsx`, `h-12`): sidebar toggle, breadcrumb (page ancestors or route label), "Search or jump to… ⌘K" button (`lg`+; icon only below), New page, Focus mode, Shortcuts, "Ask AI" toggle. (`ROUTE_LABEL` maps `inbox` → "Tasks" at `:11` — a labelling bug; the mobile map is correct.)

**Command palette** (`shell/CommandPalette.tsx`, `cmdk`), opened by ⌘K / search buttons. Two modes toggled with **Tab** or the badge: `quick` ("Titles", cmdk filtering on, `GET /api/search?mode=quick&q=&limit=12`) and `full` ("Content", `mode=hybrid`, ≥ 3 characters, results carry `chunkId`, `pageId`, `blockId`, `heading`, `semantic` score). Complete command list (quick mode):

| Group | Command | Action |
|---|---|---|
| Search (when query) | Search content for “q” | → `/search?q=` |
| Create (when query) | New page “q” | `POST /api/pages {title:q}` → open |
| Create (when query) | Ask AI “q” | `openAI({ prefill: q })` |
| Pages | search hits, or the first 8 tree nodes when the query is empty | → `/p/<id>` |
| Go to | Home | `/` |
| Go to | Quick capture | opens the capture sheet |
| Go to | Inbox | `/inbox` |
| Go to | Tasks | `/tasks` |
| Go to | Archive | `/archive` |
| Go to | Knowledge graph | `/graph` |
| Go to | AI models dashboard | `/ai/models` |
| Go to | Compare models | `/ai/compare` |
| Go to | Agents | `/ai/agents` |
| Go to | Trash | `/trash` |
| Go to | Settings | `/settings` |
| Actions | New page (⌘⇧N) | `POST /api/pages {title:""}` → open |
| Actions | New database | `POST /api/pages {title:"New database", type:"database", section:"databases"}` |
| Actions | Open AI assistant (⌘/) | `openAI()` |
| Actions | Dark mode | `setTheme("dark")` |
| Actions | Light mode | `setTheme("light")` |

Not in the palette: Research, Backlinks, focus mode, toggle sidebar, system theme, shortcuts help, lock, and any page-context or editor command (no "insert block", "export", "version history" …). No recent-commands memory, no extensibility registry (items are hard-coded JSX).

**Mobile** (`shell/MobileNav.tsx`, below `md`):
- `MobileHeader` (`h = 3rem + safe-area-inset-top`): Back (browser history, else parent/home) with parent/section label, centred route title, `SyncPill`, AI button.
- **Bottom tab bar** `MobileNav` (`.mobile-nav`, fixed, `safe-bottom`): **Home** `/`, **Search** `/search`, centre **+** (quick capture), **Inbox** `/inbox` (badge from `GET /api/inbox?count=1`), **More** (opens the drawer). Hidden while the keyboard is open or the editor is being edited (`globals.css:211`) and in focus mode.
- `MobileDrawer` (Radix Dialog, left, `w-[86vw] max-w-[22rem]`; opens by "More" or a left-edge swipe from the first 20 px; swipe left closes): Favourites (≤ 8), Recent (≤ 5, `GET /api/pages?view=recent&limit=6`), Spaces (Notes, Documents, Projects, Research — one level at a time), Databases (≤ 8) + New database, Tools (Tasks, Research & references, Connections `/backlinks`, Graph, Agents, AI models & costs), Library (Archive, Trash, Settings, Lock this device).

**Capture sheet** (`shell/CaptureSheet.tsx`): `SheetContent` "Quick capture". Kind radio: **Note / To-do / Link** (auto-switch to Link when the text is a URL). One textarea (⌘/Ctrl+Enter saves). Actions: camera photo (`capture="environment"`), attach file (≤ 200 MB each), **voice memo** (`MediaRecorder`, `audio/mp4` → `.m4a` else `audio/webm` → `.webm`, shown only when supported), **dictation** (`SpeechRecognition` / `webkitSpeechRecognition`, final results appended to the text, shown only when supported), **Capture**, **Capture and open**. Saves through `enqueueCapture` (offline-capable, §8.4). Draft in `localStorage["note-draft-capture"]`. Server kinds: `note | tasks | link | photo | file | audio` (`src/app/api/capture/route.ts:10`).

**AI panel** (`shell/AIPanel.tsx`): desktop = right `<aside>`, resizable 320–720 px (`aiWidth`); phone = full-screen `role="dialog"` pinned to `bottom: var(--kb)`. Hosts `components/chat/Chat`.

**Breakpoints:** Tailwind v4 defaults only (no custom breakpoints in `@theme`): `sm` 640, `md` 768, `lg` 1024 (+ `xl`, `2xl` unused in the files read). The **phone/desktop split is `md` (768 px)**: `hidden md:flex` / `md:hidden`, `useIsPhone` = `(max-width: 767.98px)` (`hooks.ts:10`), CSS `@media (max-width: 767.98px)` (`globals.css:223`). `sm` (640) switches bottom sheet ↔ centred dialog. Input-type queries: `(pointer: coarse)` (`useIsTouch`, `hooks.ts:12`; `globals.css:237,252`). One ad-hoc `max-[380px]:` (`PageView.tsx:66`). Page column widths: `max-w-[50rem]` for pages, `max-w-[84rem]` for databases (`PageView.tsx:59`).

**Safe-area handling:** `viewportFit: "cover"`; `.safe-top` / `.safe-bottom` (`env(safe-area-inset-top|bottom)`) on sidebar, top bar, mobile header, mobile nav, drawer, AI panel, offline screen; `main` bottom padding `calc(4.5rem + env(safe-area-inset-bottom))`; sheet body `pb-[max(1rem,env(safe-area-inset-bottom))]`; toaster `bottom: calc(var(--kb,0px) + 5rem + env(safe-area-inset-bottom))`; update banner `top: calc(env(safe-area-inset-top) + 0.5rem)`. Left/right insets (`safe-area-inset-left/right`) are **not** handled (landscape notch).
**Keyboard handling:** `useKeyboardInset` (`hooks.ts:19-33`) publishes `--kb`, `--vvh`, `html[data-kb="open"]` (threshold 80 px); mobile forms forced to ≥ 16 px (`globals.css:234`).

**Icon set:** `lucide-react` (^1.66.0) everywhere for UI icons; emoji for page icons, callout icons, default page/database glyphs (📄 🗂 🔬) and the file block (📎); app icon `public/icons/icon.svg` (+ PNG 192/512, maskable 512, apple-touch).

---

## Gaps list for the upgrade

| Item | Status | Evidence |
|---|---|---|
| Drawing block | **absent** | no canvas/drawing lib in `package.json`; no drawing node in `nodes.ts` |
| Diagram / Mermaid block | **absent** | grep `mermaid` over `src` + `package.json`: none; code blocks are highlight-only |
| Data / chart block | **absent** | no chart lib; only hand-written SVG in `src/components/ai/models/Scatter.tsx`, `UsagePanel.tsx` (not editor blocks) |
| Scientific citation block | **partial** | references/BibTeX/DOI/extracts exist outside the editor (`src/lib/research/cite.ts`, `references.ts`, `bibtex.ts`, `/api/research/references/**`, `components/research/*`) and reach the page only as inserted Markdown (`note:insert-markdown`); in the editor only generic `footnoteRef`/`footnote` (`nodes.ts:28-39`). No citation node bound to a reference id, no bibliography block |
| Formula / math | **exists** | `inlineMath`, `blockMath` via `@tiptap/extension-mathematics` + KaTeX (`Editor.tsx:85`); editing by `window.prompt` only, no live editor |
| Annotatable PDF | **absent** | PDFs are a `fileBlock` link opening in a new tab (`nodes.ts:25`); server text extraction only (`pdf-parse`, `src/lib/files/extract.ts`, `src/lib/import/pdf.ts`); no pdf.js viewer, no annotation model |
| File block | **exists** | `fileBlock` atom (`nodes.ts:21-26`), upload with progress (`Editor.tsx:40-72`); no inline preview, name/size only |
| Interactive table | **partial** | Tiptap `table` with resizable columns (`Editor.tsx:78`), row/column ops only in the mobile toolbar (`MobileToolbar.tsx:52-57`); no desktop table menu, no sort/filter/formulas. The full database engine (`src/components/database/**`) is a page type (`type: "database"`), referenced from a page by a `mention` only — not embeddable as a block |
| Enriched tasks | **partial** | `taskItem` has only `checked` (no id, due date, assignee, priority; not in the block-id list). A separate `tasks` table + `/tasks` screen + natural-language parser exist (`src/db/schema.ts:142`, `src/components/tasks/parse.ts`); linkage between editor checkboxes and `tasks` rows not found in the files read (not audited further) |
| Executable code | **absent** | `codeBlock` = lowlight highlighting only; no runtime/sandbox (grep `pyodide|sandbox|runCode|WebContainer`: none) |
| AI result block | **exists** | `aiBlock { model, prompt, at }` (`nodes.ts:14-19`), produced by `AIInline.tsx:80` and `PageView.tsx:48`; static provenance wrapper — no regenerate/refresh, no stored cost/sources |
| Cross-reference / transclusion / synced block | **partial** | page-level `mention` + backlinks + `#block-<id>` deep links exist (`mention.tsx`, `text.ts:27`, `PageView.tsx:50`); no block reference node, no transclusion/embed of another page or block, no synced blocks (grep: none) |
| Infinite canvas | **absent** | no canvas/whiteboard page type; `/graph` is a force-directed knowledge graph (`react-force-graph-2d`, `src/components/graph/GraphCanvas.tsx`), not an editable canvas |
| Full offline (IndexedDB) on web | **partial** | IndexedDB `note-local` holds only unsaved drafts + capture outbox (`src/lib/client/offline.ts`); no local page store, navigation is network-only (`public/sw.js:30-31`), no Background Sync; cannot read or create notes offline |
| Voice notes / transcription | **partial** | voice memo recording (`MediaRecorder`) → audio attachment, and live browser dictation (`SpeechRecognition`) in `CaptureSheet.tsx:38-58`; capture kind `audio` server-side. **No server-side transcription** of recorded audio (grep `transcri|whisper`: only the dictation callback and a model-id exclusion regex in `src/lib/ai/catalog.ts:39`); no audio player block in the editor; no recording from inside the editor. `Permissions-Policy: microphone=(self)` (`next.config.ts`) |
| Command palette | **exists** | `src/components/shell/CommandPalette.tsx` (cmdk): 16 static commands + page search + hybrid content search; no editor/page-context commands, no plugin registry |
| Semantic zoom | **absent** | no zoom/outline-level concept (grep: none); only a focus mode (`Shell.tsx:33`) and collapsible `details` |
| Living / query blocks | **absent** | no query/live block node (grep `queryBlock|liveQuery|dataview`: none); dynamic views exist only in the database page type and in dashboard widgets (`src/components/dashboard/widgets.tsx`) |

---

## Could not verify

1. **Library internals** (`node_modules` absent): exact default attrs of Tiptap 3.32 nodes/marks (`image` width/height, `tableCell` `colwidth`, `youtube` attrs, `textAlign` default, `link` attrs, `mention` extra attrs), the exact StarterKit 3 bundle (duplicate `Dropcursor`/`Gapcursor`/`TrailingNode`), whether Mathematics ships `$…$` input rules, and Tiptap's fallback to an empty document on unknown node types. All tagged **[UNVERIFIED-LIB]**.
2. Nothing was executed: runtime behaviour (SW caching in a real browser, conflict flows, HTML clipboard round-trip of custom nodes) is inferred from source only.
3. Out of the assigned file set and only skimmed or not read: `src/components/chat/**`, `src/components/database/**`, `src/components/research/**` (local UI helpers), `src/lib/files/extract.ts`, `src/app/api/attachments`, `src/app/api/capture` (one line), `src/app/api/tree`, `src/app/api/export`, `src/proxy.ts`, DB triggers in `drizzle/` (e.g. `sync_bump_rev`), and any native-client sync API. The link between editor `taskItem` nodes and the `tasks` table was not traced.

---

# Part B — AI, agents, research (code-level inventory)

Source: `/tmp/spnote-next/_src` (read-only copy). Paths are relative to repo root. "absent" = searched and not found. Items marked **[unverified]** were not read in full. Sections 1 (research UI), 2 (models dashboard), 3 (compare UI), 4 (AISection) of the UI detail come from a delegated full read of the component files; everything in `src/lib/**`, `src/app/api/**`, `src/worker/**`, `Chat.tsx`, `AIInline.tsx`, `ProposalCard.tsx`, `ExecutionDrawer.tsx`, `ExecutionList.tsx` was read directly.

## 0. Shared route contract (applies to every route below)

All routes are wrapped by `handler()` (`src/lib/api.ts:22`):
- **Auth**: `requireUser(req)` (`src/lib/auth/guard.ts:13`) → 401 `unauthenticated` without a session. Mutating methods (non GET/HEAD/OPTIONS) also run `assertSameOrigin()` (`guard.ts:33`): `Sec-Fetch-Site` must be `same-origin` and/or `Origin` must be in `allowedOrigins()`, else 403 `csrf`.
- **Workspace**: `getWorkspace(user.id)` (single owner workspace) → `ctx.ws`.
- **Step-up**: only when the route passes `{ fresh: true }` → `requireFresh` → 403 `reauth_required` (passkey verified < 5 min). **None of the AI / agents / research routes pass `fresh`** (absent in all 24 route files). (`/api/export` whole-workspace formats do — outside this part.)
- **Idempotency**: optional. If a POST/PATCH/PUT/DELETE carries `Idempotency-Key` (`^[A-Za-z0-9_-]{8,100}$`), `idempotent()` (`api.ts:44`) stores the 2xx **JSON** response (≤ 512 KB) in `idempotency_keys` and replays it (`idempotent-replay: true`); 409 `in_progress` for a concurrent duplicate < 60 s; 422 `idempotency_mismatch`. **SSE responses are never stored** (not JSON) — the key is released. The client helper `api()` (`src/lib/client/api.ts:19`) adds a key to every POST automatically; whether `sse()` does is **[unverified]**.
- **Errors**: `{ error, code?, ...extra }`; every response gets `x-request-id`, `cache-control: private, no-store`.
- **SSE format** (helper `sse()` in `src/lib/ai/chat.ts:288`): `content-type: text/event-stream`; each event is `data: <JSON>\n\n` (no `event:` names — the discriminator is the JSON `type` field); terminated by `data: [DONE]\n\n`; a thrown generator yields `{type:"error", code:"server_error", retryable:true, message}`.

---

## (a) API routes

### `src/app/api/ai/*`

| File | Method | Purpose | Request | Response |
|---|---|---|---|---|
| `ai/chat/route.ts` | POST (`maxDuration=600`) | Assistant chat | zod: `conversationId?` uuid\|null, `clientId?` `/^[A-Za-z0-9_-]{8,64}$/`, `message` 1–60 000, `mode?` enum `CHAT_MODES`, `pageId?` uuid, `model?` ≤80, `task?` enum of the 10 `TaskClass`, `useWorkspace?` bool, `confirmExpensive?` bool, `images?` ≤4 × `{mime: image/(png\|jpeg\|webp\|gif), dataBase64 ≤ 8 000 000}`, `scopePageIds?` uuid[] ≤50 | SSE of `ChatEvent` (see below) |
| `ai/chat/plan/route.ts` | GET | Dry run, never calls a provider | query: `mode?`, `action?` (enum `ACTION_IDS`), `actions?="1"`, `pageId?`, `model?`, `chars?` 0–2 000 000, `images?` 0–4 | `actions=1` → `{[action]: ActionPlan}` for the fixed list `rewrite, fix, translate, summarize, expand, explain, to_list, to_tasks, table, custom` (l.14); `action=` → `ActionPlan`; otherwise `ChatPlan` (message simulated as `"x".repeat(min(chars,60000))`) |
| `ai/action/route.ts` | POST (`maxDuration=300`) | Inline action on a selection; writes nothing | zod: `action` enum `ACTION_IDS`, `text` ≤120 000, `instruction?` ≤4000, `model?`, `language?` ≤8, `confirmExpensive?` | Pre-stream errors: 400 `bad_language` (translate without a `TRANSLATE_TARGETS` key), 400 `no_instruction` (custom), 503 `no_model`/`not_configured`, 409 `confirm_expensive` with `{plan}`. Then SSE: `{type:"meta", model, provider, reason, budgetNote}` → `{type:"text", delta}`* → `{type:"done", usage, costUsd, latencyMs}` or `{type:"error", code:"refused"\|"provider_error", retryable:true, message}` |
| `ai/conversations/route.ts` | GET | `?id=` → conversation row + `messages[]` (full `ai_messages` rows incl. `sources`, `meta`); else list (optional `?pageId=`), not deleted, order `pinned desc, updatedAt desc`, limit 100 | — | JSON |
| | PATCH | rename / pin / set model | `{id, title? ≤200, pinned?, model?}` | `{ok:true}` |
| | DELETE | soft delete `?id=`; `&restore=1` undeletes | — | `{ok:true}` |
| `ai/models/route.ts` | GET | Catalogue + routes | `?all=1` includes disabled/unavailable/embedding | `{models[] (ai_models rows, sorted provider then benchmark.mean_score), providers[] (ai_providers rows + `configured`), routes, defaultRoutes, taskLabels, benchmark (settings `ai.benchmark_summary`)}` |
| | POST | Admin actions (audit-logged) | `{action: "discover"\|"toggle"\|"routes"\|"budget", id?, enabled?, routes? (record any), usd? 0–10 000}` | discover → report `{[provider]:{listed,status}}`; toggle → `{ok}` (sets `ai_models.enabled`); routes → upsert settings `ai.routes`; budget → upsert settings `ai.daily_budget_usd` |
| `ai/usage/route.ts` | GET | Usage aggregates | `?days=` (default 30, max 90) | `{days, byModel[{model,provider,calls,errors,inputTokens,outputTokens,costUsd,latency(p50),ttft(p50)}], byDay[{day,costUsd,calls}], byTask[{task,calls,costUsd}], recent[50 ai_usage rows]}`. Note: not filtered by workspace. |
| `ai/compare/route.ts` | POST (`maxDuration=600`) | Run one prompt on N models in parallel (non-streaming `callAI` per model, `maxTokens 6000`, system = `system` or `ASSISTANT_SYSTEM`) | `{prompt 1–60 000, models: string[] 1–6, system? ≤4000}` | SSE: one `{type:"result", model, provider, text, usage, costUsd, latencyMs, ttftMs, refusal}` (or `{…, error}`) per model in completion order, then `{type:"saved", id}` after insert into `ai_comparisons`. No token deltas. No expensive-confirmation, no router (model ids used as given). |
| | GET | `?id=` → one `ai_comparisons` row; else last 50 `{id,prompt,models,createdAt}` | — | JSON |
| `ai/compare/vote/route.ts` | GET | Votes | — | `{votes: {[comparisonId]: {model, at}}, tally: {[model]: wins}}` |
| | POST | "Best answer" vote | `{comparisonId uuid, model ≤120 \| null}` (null removes) | `{ok, votes}`; 404/400 if comparison/model invalid. Stored in **settings key `compare.votes`** (no table). Audit `ai.compare_vote`. |

`ChatEvent` (`src/lib/ai/chat.ts:59-64`):
- `meta` `{conversationId, clientId, mode, model, provider, reason, task, sources: SourceRef[], weak: SourceRef[], evidence, sent: Sent, budgetNote, replayed}`
- `text` `{delta}`
- `done` `{messageId, content, usage, costUsd, latencyMs, ttftMs, sources (only the cited ones), evidence, invalidCitations: number[], uncited, replayed}`
- `needs_confirmation` `{reason, plan: ChatPlan}` (expensive class without `confirmExpensive`; nothing written or sent)
- `error` `{message, code: not_configured|page_required|not_found|no_model|refused|provider_error|server_error, retryable, conversationId?, alternative?: {model, provider}}`

Chat-level idempotency is separate from the header: `clientId` — if an assistant message with `meta.clientId` already exists it is replayed with `replayed:true`, no provider call (`chat.ts:153-161`, `findByClientId` l.141).

### `src/app/api/agents/*`

| File | Method | Purpose | Request | Response |
|---|---|---|---|---|
| `agents/route.ts` | GET | Catalogue + recent runs; calls `reapStale` | `?limit=` 1–100 (default 40) | `{agents: AgentInfo[], configured, target: {provider, model}\|null, budgetNote, executions[{id, agent, model, status, outcome, error, costUsd, tokensIn, tokensOut, createdAt, startedAt, finishedAt, proposals, pendingProposals, toolCalls}]}` |
| | POST | Start a run (creates `ai_executions` row `pending`, enqueues pg-boss `agent-run` with `singletonKey agent:<id>`) | `{agent ≤40, pageId? uuid\|null, confirmCost?}` | 201 `{id, status}`. Errors: 400 `unknown_agent`, 503 `not_configured`, **409 `confirm_required`** unless `confirmCost:true`, 400 `page_required`, 404 page, **409 `already_running`** (one live run per workspace), 503 `queue_unavailable`. Audit `agent.run`. |
| `agents/[id]/route.ts` | GET | One execution (polled every 2 s by the UI while live) | — | full `ai_executions` row + `contextPageId, agentName, agentIcon, info: AgentInfo, documents[{id,title,icon,deletedAt}]` |
| | POST | Decide / undo / cancel | discriminated union on `action`: `approve {changes: int[] 1–200, confirmDestructive?}`, `reject {changes}`, `undo {changes}`, `cancel` | approve/reject → `{status, applied[], failed[{idx,error}], pending}`; undo → `{status, undone[], failed[]}`; cancel → `{ok}`. 409 `confirm_destructive` `{changes}` for trash proposals without `confirmDestructive`; 409 `not_awaiting`. |

### `src/app/api/research/*`

| File | Method | Purpose | Request | Response |
|---|---|---|---|---|
| `research/ai/route.ts` | POST (`maxDuration=300`) | 7 research AI features | `{feature: enum RESEARCH_FEATURES, pageId uuid, referenceIds? uuid[] ≤50, attachmentIds? uuid[] ≤20, text? ≤200 000, instruction? ≤4000, question? ≤4000, latex? ≤20 000, language? "fr"\|"en"\|null, model?}` | SSE `ResearchAIEvent`: `meta {feature, model, provider, reason, context:{references, attachments, sources, pageChars}}`, `text {delta}`, `result {data}` (refcheck, plan only), `done {usage, costUsd, latencyMs}`, `error {message}`. No expensive-confirmation gate here (absent). |
| `research/overview/route.ts` | GET | Working-paper tracker | — | `PaperOverview[]` (`src/lib/research/overview.ts:7`) |
| `research/papers/route.ts` | POST | New research page from `workingPaperTemplate` | `{title? ≤300, status? enum PAPER_STATUSES, venue? ≤200}` | 201 page (`type:"research"`, `section:"research"`, icon 🔬, `properties {status, venue?, tags:["working-paper"]}`) |
| `research/references/route.ts` | GET | List (`?pageId=` or whole library) | — | `references` rows, order `year desc, citeKey asc` |
| | POST | Create (manual) | `refSchema`: `pageId?, citeKey?, entryType?, title 1–1000, authors? string[] ≤100, year? 1000–2100, journal?, doi?, url?, fields? record, verified? user\|doi_verified\|ai_suggested, attachmentId?` | 201 row |
| `research/references/[id]/route.ts` | GET / PATCH / DELETE | Read / partial edit (`fields` = partial BibTeX tag edit, empty removes a tag) / soft delete | PATCH `patchSchema` (same fields, all optional) | row / `{ok}` |
| | POST | `?action=attach {attachmentId\|null}` · `?action=verify` (Crossref re-check) · `?action=restore` | — | row |
| `research/references/[id]/extracts/route.ts` | GET / POST / PATCH / DELETE | Quoted extracts stored in `references.fields.extracts` | POST `{id? uuid (client-chosen = retry-safe), quote 1–8000, page? ≤40, note? ≤4000}`; POST `?restore=1 {extract}`; PATCH `{id, quote?, page?, note?}`; DELETE `?extractId=` | `{extract, extracts[]}` |
| `research/references/[id]/links/route.ts` | GET | Where a reference is used | — | `{attached, citing[], experiments[], pdf}` (`ReferenceLinks`, `references.ts:213`) — "citing" = regex match of the cite key in `pages.plain_text` |
| `research/references/doi/route.ts` | GET (`maxDuration=60`) | Crossref preview, nothing saved; duplicate check first | `?doi=` | `DoiMeta` + `duplicate` |
| | POST | Add by DOI | `{doi 5–200, pageId?}` | 201 new `doi_verified` reference, or 200 `{…, duplicate:true, linked}` |
| `research/references/import-bibtex/route.ts` | POST (`maxDuration=120`) | BibTeX import, multipart (`file`/`text`, `pageId`, `dryRun`) or JSON `{text, pageId?, dryRun?}`; `?dryRun=1`; max 20 MB | — | `{dryRun, parsed, created[], wouldCreate[], skipped[], failed[], counts}` |
| `research/references/export.bib/route.ts` | GET | `.bib` of a page (`?pageId=`) or whole library; `?inline=1` omits attachment header | — | `application/x-bibtex`, `x-export-count`, filename `<slug>.bib` / `library.bib`; audit `export` |
| `research/experiments/route.ts` | GET (`?pageId=`) / POST | Experiments | `expSchema`: `pageId?, name 1–300, status? planned\|running\|done\|failed, params? record, metrics? record, datasetRef?, repoUrl?, notes? ≤20 000` | rows / 201 row |
| `research/experiments/[id]/route.ts` | PATCH / DELETE (hard delete) | — | same fields optional | row / `{ok}` |
| `research/tasks/route.ts` | GET (`?pageId=` required) / POST | Research tasks = rows of `tasks` scoped to a page | single `{pageId, title 1–500, status? todo\|doing\|done, priority? low\|medium\|high, dueAt?, project?}` or bulk `{pageId, items[1–50]}` | rows |
| `research/tasks/[id]/route.ts` | PATCH / DELETE (soft) / POST `?action=restore` | — | — | row / `{ok}` |

All research mutations write `audit()` entries (ids/keys only).

---

## (b) Section 4 — AI

### Provider adapters — `src/lib/ai/providers.ts`
- SDKs: `openai` ^7.47.0 and `@anthropic-ai/sdk` ^1.3.0 (`package.json:88,20`). Two lazily created singletons `oa()`, `an()` (l.7-8) built with **no explicit key and no baseURL**: `new OpenAI({ maxRetries: 2, timeout: 600 000 })`, `new Anthropic({...})` — i.e. the SDK defaults read `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` from the environment.
- Env names referenced in code: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` (`catalog.ts:23`, `search/index.ts:75,142`, `api/ai/models/route.ts:14`), `CROSSREF_MAILTO`, `APP_URL` (`research/references.ts:126`). **Base-URL handling: absent** — no `baseURL`, `OPENAI_BASE_URL`, `ANTHROPIC_BASE_URL`, OpenRouter, MLX or Ollama string anywhere in `src/`, `scripts/`, `benchmarks/`, `docs/` (grep).
- `streamAI(o: AICallOptions): AsyncGenerator<AIEvent>` (l.14): a two-way branch `if (o.provider === "openai") {…} else {…Anthropic…}`.
  - OpenAI branch uses the **Responses API** (`oa().responses.create`, `input_text`/`input_image`, `instructions`, `text.format json_schema strict`, function tools `strict:false`, `reasoning.effort` only when `isReasoningOpenAI(model)` = `/^(o\d|gpt-5|gpt-6)/` and not `chat-latest`). It is **not** Chat Completions.
  - Anthropic branch: `an().messages.stream`, system as a cached block (`cache_control: ephemeral`), `output_config.format json_schema`, tools `input_schema`; thinking: models matching `/4-5-\d{8}$/` get `thinking:{type:"enabled", budget_tokens:2048}` when effort ≠ low, others get `thinking:{type:"adaptive"}` + `output_config.effort`.
  - Tool calls are emitted only after the stream ends (`tool_call` events); usage normalised to `AIUsage {inputTokens, outputTokens, cachedTokens, reasoningTokens}`; refusals: OpenAI by `REFUSAL_RE` text heuristic (l.12), Anthropic by `stop_reason === "refusal"`.
- `callAI(o)` (l.64): collects the stream; returns `AIResult` with `costUsd` from the catalogue.
- Types (`src/lib/ai/types.ts`): `Provider = "openai" | "anthropic"` (l.1); `ChatMessage {role: "user"|"assistant", content, images?}` — no tool-result role (agents feed tool results back as user text).

### Router — `src/lib/ai/router.ts`
- Task classes (`TaskClass`, `types.ts:2`), exactly 10: `chat, quick, write, reason, deep, code, extract, longctx, agent, judge`. Labels in `TASK_LABELS` (l.20).
- `DEFAULT_ROUTES` (l.7-18), each `{primary, fallback, effort, categories, avoid?}`:

| task | primary | fallback | effort |
|---|---|---|---|
| chat | gpt-6-sol | claude-sonnet-5-5 | medium |
| quick | claude-haiku-5-5 | gpt-5.4-mini | low |
| write | gpt-6-sol | claude-sonnet-4-6 | medium |
| reason | claude-opus-5-5 | gpt-6-astra | high |
| deep | claude-fable-5-1 | gpt-6-astra | high |
| code | gpt-5.3-codex | claude-sonnet-5-5 | medium |
| extract | gpt-5.4-mini | claude-haiku-5-5 | low |
| longctx | gpt-6.1-terra | claude-sonnet-5-5 | medium (avoid: gpt-5.6-terra, gpt-6-luna, claude-fable-5) |
| agent | claude-sonnet-5-5 | gpt-5.4 | medium |
| judge | claude-haiku-5-5 | gpt-5.4-mini | low |

- Overrides: settings key `ai.routes`, shallow-merged over defaults (`getRoutes`, l.40).
- `route(n: RouteNeeds {task, tools?, schema?, vision?, estTokens?, preferred?})` (l.53): (1) budget downgrade `deep→reason`, `reason→chat` when `overBudget()`; (2) `preferred` if eligible → "user selection"; (3) primary; (4) fallback; (5) best remaining eligible model with a `benchmark.pass_rate`, sorted by mean `benchmark.by_category[c].score` over the route's `categories`, then `total_median_ms`, then `cost_mean`; (6) throws `"No eligible AI model …"`.
- `eligible()` (l.25): `available && enabled && category !== "embedding" && providerConfigured(provider)` **and `probes.text.status === "ok"`**; plus `probes.tool_use` / `structured_output` / `vision` `=== "ok"` when needed; `contextWindow ≥ estTokens × 1.2` when both known. ⇒ a model with empty `probes` is never routable.
- `classifyTask(prompt, ctx)` (l.72): regex heuristic → longctx (>60 000 ctx tokens) / code / reason / deep / write / extract / quick / chat.
- `EMBEDDING_MODEL = "text-embedding-3-small"` (l.19).

### Model catalogue — `src/lib/ai/catalog.ts`, `src/cli/seed-ai-models.ts`, schema
- Tables (`src/db/schema.ts:190-201`):
  - `ai_providers`: `id` text PK, `name`, `enabled`, `lastDiscoveryAt`, `status`, `statusDetail`. No base URL, no key reference, no kind/type column.
  - `ai_models`: `id` text PK (the provider's model id — globally unique, **not** namespaced by provider), `provider` FK → `ai_providers.id`, `displayName`, `category` (default `text`), `available`, `enabled`, `contextWindow`, `maxOutput`, `inputPrice`, `cachedPrice`, `outputPrice` (USD per 1M tokens), `pricingSource`, `probes` jsonb `{[probe]: {status, detail?, ms?}}`, `benchmark` jsonb, `capabilities` jsonb, `notes` jsonb string[], `discoveredAt`, `probedAt`, `benchmarkedAt`, `createdAt`, `updatedAt`.
  - **Creator/vendor field distinct from provider: absent. Logo/icon field: absent.**
- DB enums/checks on provider: **absent** — `provider` columns are plain `text` (`ai_models.provider`, `ai_messages.provider`, `ai_usage.provider`); no CHECK / `CREATE TYPE` for providers/models in `drizzle/*.sql` (grep). The only DB constraint is the FK `ai_models.provider → ai_providers.id`.
- Seeding: `pnpm seed:ai` → `src/cli/seed-ai-models.ts`: reads `benchmarks/results/discovery.json` (+ optional `summary.json`), inserts providers `openai`/`anthropic` (l.8; also `src/cli/bootstrap.ts:40`), upserts models (enabled only when `verdict === "tested"` or embedding), stores `benchmark {pass_rate, mean_score, judged_mean, ttft_median_ms, total_median_ms, tps_median, cost_mean, by_category, runs, errors}`, writes settings `ai.benchmark_summary`. `benchmarks/results/` is **absent from this copy** (only `benchmarks/prompts`, `benchmarks/scripts/{bench,discover,graders,lib,providers,report}.ts`); scripts `bench:discover|run|report` in `package.json:128-130`. `benchmarks/scripts/*` not read **[unverified]**.
- Live discovery: `refreshDiscovery()` (`catalog.ts:26`), triggered by `POST /api/ai/models {action:"discover"}`: loops `["openai","anthropic"]`, calls `models.list()` on each SDK, flips `available`, inserts unknown ids as `enabled:false` with a note (OpenAI ids filtered by `/^(gpt|o\d|chat-latest)/` minus image/audio/embedding/… names), updates `ai_providers.status`. Pricing/context are **not** discovered live (only from the seed JSON).
- In-process cache: `listModels()` 60 s (`catalog.ts:9`); `invalidateCatalog()`.
- Docs: `docs/ai-provider-discovery.md`, `ai-routing-strategy.md`, `ai-model-comparison.md`, `anthropic-model-benchmarks.md`, `openai-model-benchmarks.md` (generated reports; only the first skimmed).

### Where a new OpenAI-compatible provider (OpenRouter, local MLX with custom base URL) would plug in
Server (must change):
1. `src/lib/ai/types.ts:1` — `Provider` union.
2. `src/lib/ai/providers.ts:6-8,17,36` — only two clients and an `if openai / else anthropic` branch. The OpenAI branch speaks the **Responses API**; an OpenAI-compatible endpoint (OpenRouter, `mlx_lm.server`) generally needs a new **Chat Completions** branch + a client constructed with `baseURL`/key per provider. No adapter interface/registry exists.
3. `src/lib/ai/catalog.ts:23` `providerConfigured(p)` — binary `openai ? OPENAI_API_KEY : ANTHROPIC_API_KEY` (any other provider is treated as Anthropic). `catalog.ts:29-34` `refreshDiscovery` — hard-coded two-provider loop.
4. "Is AI configured" checks hard-coded to the two providers: `src/lib/ai/chat.ts:122,165,277` (`configured: {openai, anthropic, any}` is part of the `ChatPlan`/`ActionPlan` response shape), `src/app/api/agents/route.ts:23,33`, `src/app/api/ai/models/route.ts:14` (`configured` per provider row).
5. `ai_providers` has no `base_url`/`kind`/key column (schema change), and rows are only seeded for the two (`seed-ai-models.ts:8`, `bootstrap.ts:40`). `seed-ai-models.ts:16` picks `pricingSource` by `provider === "openai"`.
6. Router eligibility requires `probes.text.status === "ok"` (and `tool_use`/`structured_output`/`vision` probes) — new models need probe data or a bypass (`router.ts:28-31`); cost needs `inputPrice`/`outputPrice` or `costUsd()` returns null.
7. `ai_models.id` is the PK across providers — OpenRouter ids (`vendor/model`) fit as text but collide conceptually with direct ids; API zod caps `model` at 80 chars.
8. Embeddings are OpenAI-only regardless: `src/lib/search/embed.ts` (own `new OpenAI()`, hard-coded price `0.02`/1M, `provider:"openai"`), `vector(1536)` in `schema.ts:9`, `semanticOn = providerConfigured("openai")` (`chat.ts:106`), `process.env.OPENAI_API_KEY` gate in `search/index.ts:75`.
9. Minor: `src/worker/handlers/ai-property.ts:54` logs failures as `provider:"openai"`.

UI (hard-coded, from the delegated read): `src/components/ai/models/format.ts:3,15` (type + `providerTone` colours), `CatalogueTable.tsx:28` (filter buttons All/OpenAI/Anthropic), `RoutingTable.tsx:18` (`["openai","anthropic"]` optgroups — other providers' models would not appear in pickers), `Scatter.tsx:18,39`, `ModelsDashboard.tsx:33` + `Provenance.tsx:3,15` (pricing links), `src/components/ai/compare/ModelPicker.tsx:9,15` (two fixed groups; presets with fixed model ids l.10), `ComparePanel.tsx:20` (default models). Not hard-coded: `ProviderCards.tsx` (iterates `providers`), `Heatmap`, `UsagePanel`, `src/components/settings/AISection.tsx`, and the chat model `<select>` (`Chat.tsx:149`, renders `provider · id` from `/api/ai/models`).

### Inline AI actions
- Ids: `ACTION_IDS` (`src/lib/ai/chat.ts:271`), 21: `rewrite, fix, translate, summarize, expand, explain, to_list, to_tasks, table, shorten, formal, simplify, translate_fr, translate_en, explain_math, continue, outline, study_notes, action_items, contradictions, custom`.
- Prompts: `src/lib/ai/prompts.ts` — `ACTION_SYSTEMS` (l.9-29; keys: rewrite, shorten, expand, formal, simplify, fix, summarize, translate_fr, translate_en, explain_math, continue, outline, table, study_notes, action_items, contradictions, explain, to_list, to_tasks), `translateSystem(target)` with `TRANSLATE_TARGETS` (fr, en, es, de, it, pt), `custom` uses an inline fallback string in `api/ai/action/route.ts:19`. `INJECTION_GUARD` appended; text wrapped in `<workspace kind="text">`.
- Task class per action: `ACTION_TASK` (`chat.ts:273`): explain_math/contradictions → reason; table/to_list/to_tasks/action_items → extract; fix → quick; custom/explain → chat; all others → write.
- Where offered (`src/components/editor/AIInline.tsx`, mounted in `src/components/editor/Editor.tsx:165`):
  - Picker chips `ACTIONS` (l.26-29): rewrite, fix, summarize, expand, explain, to_list, to_tasks, table; Translate (→ Français, → English, select among 6 `LANGS`); free "custom" instruction.
  - Slash menu (`src/components/editor/extensions/slash.tsx:34-36,62-64`): `ai-write` → mode `write` (custom with empty text), `ai-continue` → `continue`, `ai-summary` → `summarize` (whole page text).
  - Mobile toolbar "AI on selection" (`MobileToolbar.tsx:48` → `openAIForSelection("custom")`, `Editor.tsx:100`). Desktop bubble/toolbar entry points other than these: **[unverified]**.
  - Auto-start set `AUTO` (l.32) also accepts `shorten, formal, simplify, translate_fr, translate_en, explain_math, action_items`, but **no UI entry point for `shorten, formal, simplify, explain_math, outline, study_notes, action_items, contradictions` was found** in the files read (API-only).
- Apply: preview first; `Replace selection` (refused if the doc changed) / `Insert below` / Copy / Discard / Regenerate; result is wrapped in an `aiBlock` node `{model, prompt, at}` (l.80) unless it is a single inline paragraph replacement; one transaction = one undo.

### Chat
- Storage: `ai_conversations` (`title` = first 80 chars of the first message, `pageId`, `model`, `routing` `auto|manual`, `pinned`, soft `deletedAt`) and `ai_messages` (`role`, `content`, `model`, `provider`, `sources` jsonb, `usage`, `costUsd`, `latencyMs`, `ttftMs`, `meta` jsonb `{mode, clientId, evidence, sent, task, reason, stop, invalidCitations, uncited, pageId}`) — `schema.ts:202-212`. History sent to the model: last `RETRIEVAL.history = 20` messages.
- Modes = the scope options (`CHAT_MODES`, `chat.ts:35`; UI list `MODES` in `src/components/chat/Chat.tsx:32-39`): `notes` (retrieval only), `summarise` / `actions` (open page text only), `contradictions` (page + excerpts from other pages), `draft` (retrieval restricted to `sourceTypes:["attachment"]` + matching `references` rows as a `reference-list` block), `general` (no workspace content). `PAGE_MODES` need `pageId`.
- Other scoping: the API accepts `scopePageIds` (≤50, → `hybridSearch pageIds`), `useWorkspace`, `task`; **the Chat UI sends none of them** (`Chat.tsx:88` sends `conversationId, clientId, message, mode, pageId, model, confirmExpensive, images`). Scope by tag / section / database / date: absent in chat (the `SearchFilters` type supports `section`, `kinds`, `since/until` but chat does not pass them).
- Model selector: plain `<select>` "Auto (measured routing)" + `provider · id` options (`Chat.tsx:148-150`). No logos.
- Mounts: `src/components/shell/AIPanel.tsx` and dashboard widget `<Chat compact />` (`src/components/dashboard/widgets.tsx:139`).

#### RAG pipeline
- **Chunking** (`src/lib/search/chunk.ts`): `chunkDocument(title, doc, {target:350, max:500, overlap:60})` — tokens approximated as `chars/3.6` (`approxTokens`). Walks `docBlocks(doc)`; a heading flushes the buffer and becomes the chunk's `heading` (and `blockId`); blocks are accumulated until ~350 tokens; a single block > 500 tokens is split by sentence (`chunkLongText`) with ~60-token overlap. Each chunk keeps **one `blockId` = the id of its first block** (or of the heading right after a heading), `ordinal`, `tokenCount`, `contentHash` (sha256, 32 hex). Attachments/plain text: `chunkPlainText` (paragraph-based, same 350/500, `blockId: null`). Empty page → one chunk with the title.
- **Indexing** (`src/lib/search/index.ts:11` `indexSource`): source types `page | attachment | row` (`row` is ignored by the worker handler). Incremental: source hash over `contentHash:blockId:heading`; unchanged chunks keep their embedding; text embedded = `heading + "\n" + content`. Tables `chunks` (with generated `tsv` = `to_tsvector('simple', heading || ' ' || content)`, GIN), `embeddings` (`chunkId` PK, `model`, `version`, `embedding vector(1536)`, HNSW `vector_cosine_ops`), `index_state`.
- **Embeddings**: `text-embedding-3-small`, **1536 dims** (`schema.ts:9`), `EMBEDDING_VERSION = 1`; computed in `src/lib/search/embed.ts` (`embedTexts`, batches of 64, each text cut to 8000 chars) by the **pg-boss worker** (`src/worker/handlers/index-source.ts`, queues `index-source` / `reindex-all`; also assigns block ids via `ensureBlockIds`). The **query** embedding is computed synchronously in the web process inside `hybridSearch` (task `search`).
- **Hybrid search SQL** (`hybridSearch`, `search/index.ts:59-96`): `k = max(30, limit×4)`.
  - FTS: `select c.id, ts_rank_cd(c.tsv, q) … from chunks c left join pages p …, websearch_to_tsquery('simple', $query) q where … and c.tsv @@ q order by r desc limit k`.
  - Vector (if `semantic !== false` and `OPENAI_API_KEY`): `select c.id, 1 - (e.embedding <=> $v::vector) as s from embeddings e join chunks c … where … and e.model = EMBEDDING_MODEL order by e.embedding <=> $v::vector limit k`.
  - Fusion: **Reciprocal Rank Fusion**, `score += 1/(60 + rank)` per list; a vector-only hit is kept only if cosine ≥ `SEARCH_MIN_SEMANTIC = 0.33`.
  - Filters: workspace, `pageIds`, `sourceTypes`, `kinds`, `section`, `since/until`, archived excluded by default, trashed pages excluded. Snippets via `ts_headline` with control-char markers `HL_START/HL_END`. `group` mode collapses per source and appends `searchReferences` (ILIKE/trigram on `references`).
- **Chat retrieval** (`chat.ts:193-210`): `RETRIEVAL = {candidates:12, keep:8, excerptChars:600, minSemantic:0.3, pageChars:40 000, history:20, outputTokens:8000}`. Evidence gate `isSupporting` = `keyword > 0 || semantic ≥ 0.30`. Optional LLM re-rank `rerank()` (route `judge`, JSON schema, 2.5 s budget, only when > 4 supporting hits; usage task `rerank`). In `notes`/`draft` with zero supporting sources **no answering provider is called** (fixed "No supporting … found" message, `evidence:"none"`). Model can emit the `[[INSUFFICIENT]]` sentinel (`prompts.ts:38`).
- Prompt assembly: `<workspace kind="current-page" …>`, `<workspace kind="retrieved-sources">` with `[n] "title" › heading\nexcerpt`, optional `<workspace kind="reference-list">`; system prompt `MODE_SYSTEMS[mode]` (`prompts.ts:41-48`).

#### Citations
- Structure `SourceRef` (`chat.ts:50`): `{ n, chunkId, pageId|null, title, icon, heading, blockId|null, excerpt (≤600 chars), score (RRF), semantic (cosine, 3 dp), sourceType }`. Persisted in `ai_messages.sources` (the schema's `$type` at `schema.ts:210` lists only `chunkId, pageId, title, excerpt, score` — stale type; actual rows carry the full `SourceRef`).
- Granularity: **chunk-level with one block anchor** (first block of the chunk), not per-sentence/per-block spans; attachment chunks have `blockId: null`.
- Validation: `validateCitations()` (`chat.ts:72`) keeps `[n]` markers in the retrieved set, normalises `[1, 3]` → `[1][3]`, strips unknown ones (reported in `invalidCitations`), skips code spans; `done.sources` = only cited sources; `uncited` flag when none cited.
- Rendering: `src/components/markdown.tsx:10-14` rewrites `[n]` to `#cite-n` links → `<button class="source-ref">`; below the answer, chips `cite-chip` "n · icon title › heading" (`Chat.tsx:248`); weak (below-threshold) passages listed with `~` (l.251). Click → `openSource` (`Chat.tsx:109`): same page → `document.getElementById("block-<blockId>")`, scroll + 2 s highlight; other page → `router.push("/p/<pageId>#block-<blockId>")`; a file without a page → toast only. Block DOM ids come from the `BlockId` extension (`src/components/editor/extensions/nodes.ts:40-45`, `id="block-<id>"`).
- Answer actions: Copy, Insert into the page (`onInsert`), Save as a new note (`POST /api/pages`), in `actions` mode "Create N tasks" (`POST /api/tasks`, with Undo) / "Insert as checklist".

#### `/api/ai/chat/plan`
See table in (a). `planChat()` (`chat.ts:121`) returns `ChatPlan {configured:{openai,anthropic,any}, mode, task, provider, model, reason, estTokens, estCostUsd, expensive, budget:{budgetUsd,spentUsd,over}, budgetNote, sends:{pageChars,maxExcerpts,embeddedBy,rankedBy}, error}`; `planAction()` (l.276) returns `ActionPlan`. Used by `Chat.tsx:63` (disclosure line "Send = … → provider · model") and `AIInline.tsx:46`. It is a routing/cost dry run — **not** a multi-step task planner.

### Compare / vote
- API in (a). Table `ai_comparisons` (`schema.ts:227`: `prompt`, `models` jsonb, `results` jsonb). Votes in settings `compare.votes`. UI `/ai/compare` (`src/components/ai/compare/*`): 2–6 models, presets, per-model completion (no token streaming), "unique sentences" highlight (`diff.ts`: word-set overlap < 0.4 vs other answers — not a textual diff), "Mark as best", history list, save result as note. Bypasses the router, the expensive-confirmation gate and the daily budget (only `recordUsage` task `compare`).

### Usage / cost accounting
- Table `ai_usage` (`schema.ts:222`): `workspaceId?, provider, model, task, inputTokens, outputTokens, cachedTokens, reasoningTokens, costUsd, latencyMs, ttftMs, ok, error, refId, createdAt`. Written by `recordUsage()` (`src/lib/ai/usage.ts:4`) on every call (also failures/aborts). Task labels seen: TaskClass names (chat), `rerank`, `action:<id>`, `compare`, `agent:<id>`, `research:<feature>`, `ai_property`, `embed`, `search`; others in `src/lib/graph/suggest.ts` and `src/app/api/dashboard/summary/route.ts` **[unverified]**.
- Cost: `costUsd(model, usage)` (`catalog.ts:17`) = `((input − cached)×inputPrice + cached×(cachedPrice ?? inputPrice) + output×outputPrice) / 1e6`; null when prices are missing. Embeddings: hard-coded `0.02`/1M. Per-message cost also on `ai_messages.costUsd`; per-run on `ai_executions.costUsd/tokensIn/tokensOut`.
- Budget: one setting `ai.daily_budget_usd` (default 20), rolling 24 h sum over **all** `ai_usage` (not per workspace). Effect: downgrade only (`deep→reason`, `reason→chat`) — **no hard stop**. `budgetStatus()` / `budgetMessage()` surface it.
- Expensive gate (`usage.ts:17-23`): classes `deep, reason, longctx` or est. input > 30 000 tokens require `confirmExpensive` (chat: `needs_confirmation` event; action: 409 `confirm_expensive`). Not applied to research AI, compare, agents (agents have `confirmCost` + per-run caps).
- UI: `/ai/models` `UsagePanel` (spend by day, by task, by model, recent errors, budget input) and Settings → AI (`AISection.tsx`: default task mode pref `aiDefaultTask`, `aiAlwaysCite`, daily budget, routes table). Per-model/monthly/token limits: absent.

### Other AI consumers (outside the listed dirs)
- `src/worker/handlers/ai-property.ts`: database property type `ai` — route `quick`, `{{Property}}` templating, result written to `database_rows.values`.
- `src/worker/handlers/suggest-links.ts` → `src/lib/graph/suggest.ts` (embedding neighbours + LLM judgement → `knowledge_edges` `ai_suggested`) **[unverified beyond imports]**.
- `src/app/api/dashboard/summary/route.ts`: weekly digest (see gap list) **[only header lines read]**.

---

## (c) Agents

- Model: **fixed catalogue of bounded agents that only propose** (`src/lib/agents/types.ts:1-6`). No free-form prompt, no search tool, no network, no shell.
- Definitions (`AGENTS`, `src/lib/agents/definitions.ts:14-43`), exactly 4:

| id | name | page | description | tools | limits (overrides of default) |
|---|---|---|---|---|---|
| `sort_inbox` | Sort my inbox | none | "For each item waiting in the inbox, proposes where to file it, which tags to add, or to archive it." | list_inbox, list_tags, read_page, propose_inbox_triage | maxToolCalls 40 |
| `suggest_tags` | Suggest tags | optional | "Proposes tags for the open page, or for your recent untagged pages when no page is chosen." | list_tags, list_candidate_pages, read_page, propose_tags | maxToolCalls 20 |
| `plan_from_page` | Make a plan from this page | required | "Turns the chosen page into a concrete plan: a new sub-page with a checklist, or a checklist added at the end of the page." | read_page, propose_new_page, propose_page_append | maxToolCalls 6, maxTurns 5, maxProposals 2 |
| `check_references` | Check references | none | "Flags references with missing fields or a DOI that is malformed or was never verified, and proposes a fix-up task for each." | list_references, propose_task | maxToolCalls 32, maxTurns 6 |

  Default `limits()` (l.11): `maxToolCalls 30, maxTurns 8, maxTokens 120 000, maxCostUsd 0.75, timeoutMs 300 000, maxProposals 30`. Scopes type `Scope` (`types.ts:8`). `AgentInfo` (no prompts) is what the browser gets.
- Tool allow-list (`TOOLS`, `src/lib/agents/tools.ts:180`), 10 tools:
  - Read (`proposal:false`): `list_inbox` (≤25 items, 400-char excerpts), `list_tags` (≤300), `list_candidate_pages` (context page or 12 recent untagged pages), `read_page` (only ids in `ctx.readable`; default 12 000 chars, `offset`/`maxChars ≤ 24 000`), `list_references` (≤30 flagged of ≤500, deterministic `referenceIssues()` l.100).
  - "Write" (`proposal:true`) — all only append a `Proposal` to the run, **none writes to the workspace**: `propose_inbox_triage` (keep+section / archive / trash, ≤3 tags; `destructive` when trash), `propose_tags` (1–4 tags), `propose_new_page` (one per run, Markdown ≤20 000, child of the context page), `propose_page_append` (one per run, Markdown ≤12 000, append only), `propose_task`.
  - Inputs zod-validated; JSON schema generated with `z.toJSONSchema` (`toolDefs`); `logSafe()` strips note text from the execution log.
- Runner (`src/lib/agents/runner.ts`, executed by the worker `src/worker/handlers/agent.ts`, queue `agent-run`, `retryLimit 0`, queue timeout 840 s):
  - Atomic claim `pending → running` (`runExecution` l.58); `reapStale()` fails abandoned rows (never re-runs).
  - Model: `route({task:"agent", tools:true, preferred: ex.model})` → default `claude-sonnet-5-5`, fallback `gpt-5.4` (`ex.model` is always inserted as null by the API, so no user model choice).
  - Loop: `for turn = 1..limits.maxTurns` (default **8** turns), `callAI` non-streaming with `maxTokens 4000`; stops on no tool calls, turn cap, tool-call cap, token cap, cost cap; wall-clock timeout aborts. Tool results are sent back as a **user message** `<workspace kind="tool-results"><tool_result name=…>JSON</tool_result>…` (≤14 000 chars each), the assistant turn is summarised as text `[Called tools: …]` — not native tool-result messages.
  - Persists progress on the row after each turn (also the cancellation check). End status: `awaiting_approval` (≥1 proposal) or `completed`; failures → `failed` with `proposedChanges: []`.
- Approval / proposal model:
  - Storage: **single table `ai_executions`** (`schema.ts:213-221`): `agent, task, model, status, scopes, toolsInvoked[] (ToolStep), documentsAccessed[], proposedChanges[] (Proposal), approvals[{change, approved, at}], outcome, result, error, costUsd, tokensIn, tokensOut, createdAt, startedAt, finishedAt`. No separate proposals table. (While pending, `outcome` holds JSON `{pageId}` — `parseMeta`, `runner.ts:39`.)
  - Execution statuses: `pending, running, awaiting_approval, approved, rejected, completed, failed`. Proposal statuses (`ProposalStatus`): `proposed, applied, rejected, failed, undone`. Proposal kinds (`ProposalKind`): `inbox_triage, tags, new_page, page_edit, task`. `ProposalBase` (`types.ts:26`): `idx, tool, kind, rationale, title, destructive, status, pageId, before: Preview|null, after: Preview, at, decidedAt?, appliedAt?, undoneAt?, error?, result?, undo?` + typed `payload`. `Preview = {label, lines[], markdown?}` built server-side.
  - Apply (`src/lib/agents/apply.ts`): `decideProposals(ws, userId, executionId, {approve[], reject[], confirmDestructive?})` — requires status `awaiting_approval`; destructive approvals need `confirmDestructive` (409 `confirm_destructive`); each approved index → `applyOne()`; persisted after every change; `summarise()` sets execution status (`awaiting_approval` while any `proposed`, else `approved` if any applied/undone, else `rejected`). `applyOne` per kind: `tags` (snapshot + union via `setPageTags`), `inbox_triage` (snapshot, tags, `triage()` from `src/lib/inbox/service`), `new_page` (`markdownToDoc` → `createPage` with `properties {ai_generated:true, agent_execution}`), `page_edit` (append nodes via `updatePage` with `baseVersion` and `versionReason "before agent addition"`), `task` (insert into `tasks`). `undoProposals()` → `undoOne()` reverses each (page_edit refuses with 409 `changed_since` if the page version moved). Audit entries `agent.proposal_apply|reject|fail|undo`, `agent.run`, `agent.cancel`.
- UI (`/ai/agents`, `src/components/ai/agents/*`):
  - `ProposalCard.tsx`: per proposal — kind icon/label, title, status badge, "Why: rationale", **Before panel stacked above After panel** (`Side`, red/green left border; `lines[]` + optional rendered Markdown, max-h 56), "Open the page concerned" link, Approve / Reject (Approve… in danger style when destructive), Undo when applied. It is a before/after preview, **not a line/word diff**.
  - `ExecutionDrawer.tsx`: polls `GET /api/agents/<id>` every 2 s while live; status badge, cost, tool-call count, duration, Cancel run; Summary (`result` Markdown); proposal list; collapsible "Execution log" (scope reads/proposes, steps with log-safe input → output, documents accessed as links, approvals, cost/tokens/model/timestamps/run id); sticky "Reject all / Approve all (N)"; second-confirmation dialog for trash.
  - `ExecutionList.tsx`: rows with status labels (`queued, running, to review, reviewed, done, rejected, failed`).
  - `AgentsConsole.tsx` (launch cards, scope/cost confirmation): **[not read]**.

---

## (d) Section 7 — Research workspace

### Data
- `references` table (Drizzle name `researchReferences`, `schema.ts:233-239`): `id, workspaceId, pageId?, citeKey (unique per workspace), entryType (default article), title, authors string[], year, journal, doi, url, bibtex (entry as imported), fields jsonb (every BibTeX tag as written + app data `extracts`), verified (user | doi_verified | ai_suggested), attachmentId? → attachments, createdAt, updatedAt, deletedAt`.
- `experiments` (`schema.ts:240`): `pageId?, name, status (planned|running|done|failed), params jsonb, metrics jsonb, datasetRef, repoUrl, notes, startedAt, finishedAt`.
- "Papers" = `pages` with `type:"research"`, `section:"research"`; paper metadata lives in `pages.properties` (`PaperMeta`: `status` in `PAPER_STATUSES` = planning, research, development, writing, submitted, published; `venue, deadline, repoUrl, datasets[], tags[]`). No papers table.
- Research tasks = rows of the general `tasks` table scoped by `pageId` (`src/lib/research/tasks.ts`).
- Extracts ("highlights") = `references.fields.extracts[]` (`Extract {id, quote, page, note, createdAt, updatedAt?}`, limits `EXTRACT_LIMITS` quote 8000 / note 4000 / page 40 / 500 per reference; `src/lib/research/cite.ts:4-6`). Manually typed/pasted quotes; **PDF highlighting/annotation: absent**.

### Services
- `src/lib/research/references.ts`: CRUD with soft delete/restore; `uniqueKey` (suffix a…z); **DOI lookup = Crossref** `https://api.crossref.org/works/<doi>` (`lookupDoi` l.133, 15 s timeout, User-Agent with `APP_URL` + optional `CROSSREF_MAILTO`), `TYPE_MAP` to BibTeX types, fields volume/number/pages/publisher/abstract/issn/isbn/keywords; `addByDoi`, `findByDoi`, `verifyReference` (fills missing tags only); `attachPdf`; `importBibtex` (dedupe by DOI then cite key, never overwrites, `dryRun`); extracts CRUD; `referenceLinks`. DataCite / OpenAlex / Semantic Scholar / arXiv / PubMed lookups: absent.
- `src/lib/research/bibtex.ts`: parser on `bibtex-parse-js` ^0.0.24 with per-entry splitting (`splitEntries`), `@string` macro expansion, LaTeX accent cleanup (`cleanLatex`), `makeCiteKey` (`lastnameYEARfirstword`), `formatBibtex` (deterministic tag order), `fieldsOf`, `referenceBibtex`, `bibFile`, `shortCite`. A second Next-free importer exists at `src/lib/import/bibtex.ts` (used by the general import pipeline) **[header only read]**.
- `src/lib/research/cite.ts` — citation formats: `shortLabel` (author–year "Gorton & Metrick (2019)"), `formatCitation` (**one style: APA-like plain text**, handles book / incollection / inproceedings / theses / article, DOI link), `extractMarkdown` (block quote + `— (citeKey, p. N)`). CSL / Chicago / MLA / RIS / style picker: absent.
- `src/lib/research/template.ts`: `workingPaperTemplate` (callout, Abstract, 1–6 sections, a `blockMath` example, References note).
- `src/lib/research/overview.ts`: `researchOverview` (counts of refs / experiments / open & overdue tasks / attachments per research page).
- Files/PDF: generic attachments (`attachments.extractedText`, `pageCount`); upload via `POST /api/attachments`, open via `/api/files/<id>` in the browser's native viewer; text extraction (deps `pdf-parse` ^2.4.5, `mammoth` ^1.13.0) and indexing as `sourceType:"attachment"` chunks. **Embedded PDF viewer: absent** (`src/components/research/FileActions.tsx` comment l.2-6). Extraction code itself (`src/app/api/attachments`, `src/lib/files`) **[not read]**.

### AI features — `src/lib/research/ai.ts` (`RESEARCH_FEATURES`, l.21), 7
| feature | task class | what it does | output |
|---|---|---|---|
| `synthesis` | deep | Literature synthesis from page (≤12 000 chars), page references (+abstracts), attached PDF text (≤12 000 chars each), 12 retrieved passages scoped to the page; asks for `\cite{key}` citations and a reference table | streamed Markdown |
| `compare` | reason | Methodology comparison of ≥2 references/files (PDF text ≤18 000 chars each) | streamed Markdown (table + discussion) |
| `question` | reason | Research-question refinement (page ≤15 000, refs, 6 passages) | streamed Markdown |
| `equation` | reason | Explain a LaTeX equation using page notation | streamed Markdown |
| `draft` | write | Edit a section to journal standard, cite only listed keys, then "Changes" list | streamed Markdown |
| `refcheck` | reason (JSON schema) | Deterministic extraction of `\cite{…}` (incl. citep/citet/parencite/textcite/autocite…) and Author (Year) strings (`extractCitations`, ≤80), deterministic match (`matchDeterministic`), LLM adjudication of the rest (unknown keys rejected) | one Markdown report + `result {items: CitationHit[], matched, unverified, found}` |
| `plan` | deep (JSON schema) | Experimental plan `PlanData {title, objective, hypotheses[], design, data[], steps[], tasks[{title, priority, dueInDays}], risks[]}` | Markdown + `result` |

Nothing is written by these; usage task `research:<feature>`. In-text retrieval markers `[S1]…` are plain text (no clickable citations, no `SourceRef` returned). No result history (component state only).

### UI
- `/research` → `ResearchOverview` (`src/app/(app)/research/page.tsx`): tabs `papers` "Working papers" (status chips, table: Paper, Status, Venue, Deadline, Refs, Exp., Open tasks, Words, Last activity; "New working paper") and `library` "Library" (all references; Add to the library; "Library .bib").
- `/p/[id]` when `page.type === "research"` → `ResearchPanel` (`src/components/research/ResearchPanel.tsx:62-72`, mounted from `src/components/page/PageView.tsx:112`). Tabs: `references` "References", `files` "Files", `experiments` "Experiments", `tasks` "Tasks", `ai` "AI". Header: status select, venue, deadline, Git repository, datasets chips (stored in `page.properties`), `LatexSnippets`, link to Overview.
  - References tab: Add reference (modes `doi` / `bibtex` (file or paste, two-step dry run) / `manual`; `ENTRY_TYPES` article, book, incollection, inproceedings, techreport, phdthesis, mastersthesis, unpublished, misc), filter, copy `\cite{key}`, "Export .bib". `ReferenceSheet`: Copy citation (APA), copy `\cite{…}`, copy BibTeX, Open DOI, Verify (Crossref), Edit, PDF attach/replace/detach, Extracts (add/edit/delete, "Insert as citation" → Markdown block quote into the page, copy), Links (attached page, citing pages, experiments), Delete with undo.
  - Files tab: multi-upload (`.pdf,.docx,.txt,.md,.csv,.tex,.bib`, 200 MB), Open / Download / Share, "searchable"/"no text" badge.
  - Experiments tab: name, status, key-value Parameters and Metrics, dataset, repository, notes.
  - Tasks tab: title, due date, priority, status; overdue counts.
  - AI tab (`AITab.tsx`): the 7 features above with a language switch (auto/fr/en); result actions "Insert into page", "Save as note" (new page wrapping an `aiBlock`), "Copy"; plan → "Add N tasks" (`POST /api/research/tasks {items}`). No model picker in this tab.

### Exports
- `.bib`: `GET /api/research/references/export.bib` (page or library); also `GET /api/export?format=bib` and `references.bib` inside the workspace ZIP (`src/lib/export/zip.ts:71`; extracts and experiments go to `workspace.json`).
- "LaTeX snippets" (`src/components/research/LatexSnippets.tsx`): 21 **equation templates** (groups Regression, State space, Expectations, Sums & integrals) inserted as `$$…$$` blocks or copied — not an export.
- `.tex` / LaTeX document export, CSL/RIS/EndNote export, Word export of a paper: **absent** (`/api/export` formats are `md, zip, json, csv, pdf, html, bib` — `src/app/api/export/route.ts:25`; that route is outside this part and only its header was read).

---

## (e) Gap list

| Capability | Status | Evidence |
|---|---|---|
| Ask-my-knowledge with block-level citations | **partial** | Exists: chat mode `notes` with hybrid retrieval, evidence gate, validated `[n]` markers, `SourceRef.blockId`, click-through to `#block-<id>` (`src/lib/ai/chat.ts:50,72,193-263`; `src/components/chat/Chat.tsx:109-117,248`). Limits: anchor = first block of a ~350-token chunk (`src/lib/search/chunk.ts:11-18`), not the exact supporting block/span; attachments have no block anchor; UI cannot scope by pages/tags/section although the API has `scopePageIds`. |
| Contextual AI actions list | **exists (partial coverage)** | 21 ids in `ACTION_IDS` (`chat.ts:271`), prompts `src/lib/ai/prompts.ts:9-32`; UI offers 8 chips + translate + custom + 3 slash items (`src/components/editor/AIInline.tsx:26-32`, `extensions/slash.tsx:34-36`); 8 ids have no UI entry point found. Static list — not adapted to block type/context. |
| LaTeX export | **absent** | Export formats `md, zip, json, csv, pdf, html, bib` (`src/app/api/export/route.ts:25`); only `.bib` export (`api/research/references/export.bib/route.ts`) and equation snippet insertion (`LatexSnippets.tsx`). LaTeX is input/rendering only (KaTeX, `blockMath`). |
| OpenRouter / local providers | **absent** | `Provider = "openai" \| "anthropic"` (`src/lib/ai/types.ts:1`); two SDK clients without `baseURL` (`providers.ts:7-8`); `providerConfigured` binary (`catalog.ts:23`); no `baseURL`/openrouter/mlx string in the repo; `ai_providers` has no URL column (`schema.ts:190`). |
| Model selector with creator logos | **partial (selector yes, logos/creator no)** | Selectors: `<select>` in `Chat.tsx:148-150`, `compare/ModelPicker.tsx`, `RoutingTable.tsx`, `AISection.tsx`. Only a coloured dot (`providerTone`, `src/components/ai/models/format.ts:15`); no logo asset, no creator/vendor column in `ai_models` (`schema.ts:193-201`). |
| Voice notes / transcription | **partial (recording + browser dictation; no server transcription)** | `src/components/shell/CaptureSheet.tsx:27-54`: `MediaRecorder` voice memo saved as an attachment (`captureKind "audio"`, `src/lib/inbox/service.ts:13,40`) and Web Speech API dictation (`SpeechRecognition`). No transcription/Whisper call anywhere (grep `transcri` → only a discovery filter regex in `catalog.ts:39`). CaptureSheet read by excerpt only **[partly unverified]**. |
| Smart inbox AI suggestions | **partial** | Only via the on-demand agent `sort_inbox` (proposals to file/tag/archive/trash, `src/lib/agents/definitions.ts:16-21`, applied through `triage()` in `apply.ts:82-91`). `src/lib/inbox/service.ts` and `src/app/api/inbox` contain no AI call (grep); no automatic/inline suggestions in the inbox UI found. Inbox components not read **[unverified]**. |
| Daily brief | **absent (weekly digest exists)** | `src/app/api/dashboard/summary/route.ts:10` — on-demand "weekly digest" of the past 7 days, shown by a dashboard widget (`src/components/dashboard/widgets.tsx:123`). No daily/scheduled brief: worker schedules only `backup` and `maintenance` (`src/worker/index.ts:38-39`). Route body beyond the header **[unverified]**. |
| AI result block in the editor | **exists** | Tiptap node `aiBlock` (`src/components/editor/extensions/nodes.ts:14-19`; attrs `model, prompt, at`; renders `div.ai-block`), produced by `AIInline.apply` (`AIInline.tsx:80`) and research "Save as note"; handled in `src/lib/editor/text.ts`, `src/lib/export/html.ts`. Static provenance wrapper — no regenerate/refresh in place, no stored sources. |
| Scientific citation block in the editor | **absent** | No citation/reference node in `extensions/nodes.ts` (nodes: Callout, AIBlock, FileBlock, FootnoteRef, Footnote, BlockId; `Editor.tsx:22`). Citations are plain text `\cite{key}` copied from the References tab, or a Markdown block quote from an extract (`cite.ts:48`); the slash item `footnote` merely has keyword "citation" (`slash.tsx:27`). "Citing pages" are found by regex on `plain_text` (`references.ts:224`). |

## Not verified / caveats
- Not read: `src/components/ai/agents/AgentsConsole.tsx`, `benchmarks/scripts/*`, `src/lib/graph/suggest.ts` (imports only), `src/app/api/dashboard/summary/route.ts` (first lines only), `src/lib/import/bibtex.ts` (header), `src/app/api/export/route.ts` (header), `src/components/shell/CaptureSheet.tsx` (excerpts), attachment upload/text-extraction code, inbox UI components, `src/lib/client/api.ts` `sse()` body, docs `ai-*.md` other than the top of `ai-provider-discovery.md`.
- Desktop entry points to `AIInline` other than slash menu and mobile toolbar (e.g. a bubble menu calling `openAIForSelection(mode)`) were not traced.
- `benchmarks/results/discovery.json` / `summary.json` are not in the copy, so the actual seeded model list and prices could not be checked; the model ids quoted come from `DEFAULT_ROUTES` and UI presets.
- Research/models/compare/settings UI details come from a delegated full read of those component files (line numbers as reported by it), not re-checked line by line.
- No migration SQL was read in full; "no DB enum/check on provider" rests on `schema.ts` plus a grep of `drizzle/*.sql`.

---

# Part C — Databases, knowledge graph, search, inbox/capture, tasks, tags, dashboard, import/export

Source: read-only copy `/tmp/spnote-next/_src` (package.json `"version": "2.0.0"`, next ^16.4.3, drizzle-orm ^0.45.4, pg-boss ^12.38.0, react-force-graph-2d ^1.29.2, papaparse ^5.7.0). Nothing was run, built or installed; `node_modules` is absent from the copy. Paths are relative to the repo root. "absent" means I looked for it and it is not in the code.

Verification levels: server side (schema, `src/lib/**`, API routes, worker handlers) was read in full by the author of this part. Component-level sections (marked **[UI]**) and the import/export library section were read in full by delegated readers and are reported from their notes; line numbers there were spot-checked, not all re-read.

---

## 0. Shared route contract (applies to every route below)

Every route file in scope wraps its methods in `handler()` (`src/lib/api.ts:21`). None passes `{ fresh: true }`. **Step-up (`requireFresh`, `src/lib/auth/guard.ts:21`, passkey verified < 5 min, else 403 `reauth_required`) is required only in three cases, all called inline: JSON export, whole-workspace ZIP export, and a JSON-backup import in overwrite mode** (see Import / export below). Every other route in this part needs the session only.

- **Auth**: `requireUser(req)` (`src/lib/auth/guard.ts:14`) → 401 `{error:"Sign-in required", code:"unauthenticated"}` without a session.
- **CSRF**: for non GET/HEAD/OPTIONS, `assertSameOrigin()` (`guard.ts:34`) → 403 code `csrf` (Origin must be in `allowedOrigins()`, or `Sec-Fetch-Site: same-origin`; a request with neither header is refused).
- **Workspace**: `getWorkspace(user.id)` (`guard.ts:43`) — single owner workspace; every service call is scoped by `ws.id`.
- **Idempotency**: optional, generic. Any POST/PATCH/PUT/DELETE carrying `Idempotency-Key` (`/^[A-Za-z0-9_-]{8,100}$/`, else 400 `bad_idempotency_key`) is run once per key (`idempotent()`, `api.ts:42`): replay returns the stored JSON with header `idempotent-replay: true`; same key on another method/path → 422 `idempotency_mismatch`; still running (<60 s) → 409 `in_progress`. Only 2xx JSON responses ≤ 512 KB are stored (`MAX_STORED`, `api.ts:11`); errors and non-JSON (CSV/ZIP downloads) are not replayable. No route *requires* the header; `POST /api/capture` documents that clients always send it (`src/app/api/capture/route.ts:7`).
- **Errors**: `HttpError` → `{error, code?, ...extra}` with its status; **anything else (including `ZodError` from a bare `uuid.parse(...)`, plain `Error`, Postgres errors) → 500 `{error:"Internal error", requestId}`** (`jsonError`, `guard.ts:48-52`). `parseBody()` (`api.ts:67`) converts zod failures into 400 `Validation: …`, but direct `uuid.parse()` calls do not (see defects).
- Responses get `x-request-id` and default `cache-control: private, no-store` (`api.ts:36`).

---

## (a) API routes

### Databases

| Method + path | File | Purpose | Request | Response |
|---|---|---|---|---|
| GET `/api/databases` | `src/app/api/databases/route.ts:4` | List databases of the workspace | — | `[{id, pageId, name, icon, isTemplate, templateOf, updatedAt, rowCount}]` ordered by page title (`listDatabases`, `src/lib/databases/service.ts:33`) |
| GET `/api/databases/templates` | `src/app/api/databases/templates/route.ts:3` | Built-in template catalogue | — | `[{id, name, icon, description, properties: string[]}]` (`templateSummaries`, `src/lib/databases/templates.ts:58`) |
| GET `/api/databases/[id]` | `src/app/api/databases/[id]/route.ts:7` | Database definition. `[id]` = database id **or host page id**; lazily creates the database for a page of `type="database"` (`ensureDatabase`, `service.ts:16`) | query `format=csv`, `viewId` | JSON `Database` `{id, pageId, name, description, icon, isTemplate, templateOf, properties: Property[], views: View[]}` (`src/lib/databases/types.ts:40`); or `text/csv` attachment `<name>.csv` (view filter/sorts applied, hidden columns removed, **max 1000 rows**) |
| PATCH `/api/databases/[id]` | same `:15` | Rename / describe / icon / template flag | zod `{name?: string≤500, description?: string≤2000\|null, icon?: string≤16\|null, isTemplate?: boolean}` | `Database`; audit `database.update` |
| GET `/api/databases/[id]/rows` | `src/app/api/databases/[id]/rows/route.ts:7` | Row refs for relation pickers, or hydrated rows | query `q`, `limit` (≤500, default 50), `full=1`, `offset` | default: `RelationRef[]` `{rowId, pageId, title, icon}` (`listRowsSimple`, `service.ts:176`); `full=1`: `QueryResult` `{rows: RowOut[], total, limit, offset}` |
| POST `/api/databases/[id]/rows` | same `:13` | Create one row or up to 500 | zod union: `{rows: Row[]≤500}` or strict `Row` = `{title?: string≤500, values?: Record<string, unknown>, position?: number, content?: any, icon?: string≤16\|null}` | 201 `RowOut` or `RowOut[]`; audit `database.row.create` |
| PATCH `/api/databases/[id]/rows` | same `:21` | Update one / many rows, or reorder | zod `{id?: uuid, values?: Record, updates?: [{id: uuid, values}]≤500, order?: uuid[]≤5000}`; precedence `order` > `updates` > `id` (400 "id required" if none) | `{ok:true}` / `RowOut[]` / `RowOut` |
| DELETE `/api/databases/[id]/rows` | same `:29` | Soft-delete rows (row + its page) | query `id=` and/or `ids=a,b,c` (bare `uuid.parse`) | `{ok:true, deleted:n}`; audit `database.row.delete` |
| POST `/api/databases/[id]/rows/restore` | `src/app/api/databases/[id]/rows/restore/route.ts:13` | Undo a row deletion (row + page restored) | zod `{ids: uuid[] 1..500}` | `{ok:true, restored:n}`; audit `database.row.restore` |
| POST `/api/databases/[id]/query` | `src/app/api/databases/[id]/query/route.ts:8` | Filter / sort / search / paginate | zod `{viewId?: uuid, filter?: Group\|null, sorts?: [{property: string, dir: "asc"\|"desc"}], search?: string≤200, limit?: int 1..1000, offset?: int≥0}`; `Group = {and?: (Rule\|Group)[], or?: (Rule\|Group)[]}`, `Rule = {property: string, op: string, value?: unknown}` (**`op` is a free string**, not checked against `FILTER_OPS`). Explicit fields override the view's config. | `QueryResult` |
| GET `/api/databases/[id]/query` | same `:14` | Same query via a view; CSV export | query `viewId`, `q`, `format=csv` | `QueryResult` (limit 1000) or `text/csv` attachment `<db>-<view>.csv` |
| POST `/api/databases/[id]/properties` | `src/app/api/databases/[id]/properties/route.ts:7` | Add a property | zod `{name: string≤200, type: enum PROPERTY_TYPES, config?: Record, width?: int 40..2000\|null, position?: number}` (type `title` refused 400, `service.ts:57`) | 201 `Property`; audit `database.property.create` |
| PATCH `/api/databases/[id]/properties` | same `:13` | Update one property or reorder | zod `{id?: uuid, name?, type?, config?, width?, position?, order?: uuid[]}` | `Property` or `{ok:true}` |
| DELETE `/api/databases/[id]/properties` | same `:19` | Delete property (+ its key in every row's `values`, + relation pair) | query `id` (bare `uuid.parse`) | `{ok:true}`; audit `database.property.delete` |
| GET `/api/databases/[id]/views` | `src/app/api/databases/[id]/views/route.ts:6` | List views | — | `View[]` |
| POST `…/views` | same `:7` | Create view | zod `{name: string≤200, type: enum VIEW_TYPES, config?: Record}` | 201 `View` |
| PATCH `…/views` | same `:8` | Update view (config is shallow-merged, `service.ts:198`) | zod `{id: uuid, name?, type?, config?, position?, isDefault?}` | `View` |
| DELETE `…/views` | same `:9` | Delete view (400 if it is the last one, `service.ts:203`) | query `id` (bare `uuid.parse`) | `{ok:true}` |
| POST `/api/databases/[id]/duplicate` | `src/app/api/databases/[id]/duplicate/route.ts:5` | Duplicate a database | zod `{withRows?: boolean, title?: string≤500, asTemplate?: boolean, parentId?: uuid\|null}` | 201 `Database`; audit `database.duplicate` |
| POST `/api/databases/[id]/apply-template` | `src/app/api/databases/[id]/apply-template/route.ts:5` | Apply a built-in template onto a database | zod `{template: string≤50}` | `{applied, properties:n}`; audit `database.template` |
| POST `/api/databases/[id]/import` | `src/app/api/databases/[id]/import/route.ts:5` | CSV → rows (synchronous) | multipart `file` (≤ 20 MB, else 413) | 201 `{created:n, properties: string[]}` (names of auto-created text columns); audit `database.import` |
| POST `/api/databases/[id]/ai` | `src/app/api/databases/[id]/ai/route.ts:5` | Queue AI-property computation | zod `{rowId?: uuid, rowIds?: uuid[]≤200, propertyId: uuid}` | `{ok:true, queued:n}` (n = ids requested, not jobs actually accepted) |

Auth for all: session + same-origin on mutations; no step-up; idempotency optional.

### Graph

| Method + path | File | Purpose | Request | Response |
|---|---|---|---|---|
| GET `/api/graph` | `src/app/api/graph/route.ts:6` | Whole or neighbourhood graph | query `types=page,database,research,row,attachment,tag` (unknown values dropped), `section`, `since` (ISO date → `pages.updated_at >=`), `pageId`+`depth` (clamped 1..4), `hideOrphans=1`, `suggestions=0` | `GraphData` `{nodes: GraphNode[], edges: GraphEdge[], center, stats:{pages, edges, suggested}}` |
| GET `/api/graph/neighbors` | `src/app/api/graph/neighbors/route.ts:5` | Mini graph around one page | query `pageId` (uuid, 400 otherwise), `depth` (1..3), `suggestions=0`, `linked=1` | `GraphData`; with `linked=1` also `linked: [{id,title,icon,kind:"link"\|"relation",direction:"out"\|"in"}]` and `suggestions: Suggestion[]` (pending, ≤50) |
| GET `/api/graph/suggestions` | `src/app/api/graph/suggestions/route.ts:9` | AI link suggestions queue | query `status=suggested\|accepted\|rejected` (default suggested), `pageId` | `{items: Suggestion[]≤200, counts:{suggested,accepted,rejected}}` |
| POST `/api/graph/suggestions` | same `:18` | Produce suggestions | zod `{action:"suggest", pageId?: uuid\|null, inline?: boolean}` | inline+pageId: `{queued:false, result: SuggestResult}` (synchronous model call); else `{queued:true, jobId}` on queue `suggest-links` (singleton 30 s per page / 300 s per workspace); audit `graph.suggest` |
| PATCH `/api/graph/suggestions` | same `:31` | Accept / reject / undo | zod `{id: uuid, status:"accepted"\|"rejected"\|"suggested"}` | `{ok, id, status, fromId, toId}`; audit `graph.suggestion.<status>` / `.reverted` |
| GET `/api/graph/backlinks` | `src/app/api/graph/backlinks/route.ts:7` | Backlink ranking + unlinked mentions | query `q` (title filter), `pageId` (scopes mentions) | `{pages: BacklinkRow[]≤300, mentions: UnlinkedMention[]≤400}` |
| POST `/api/graph/backlinks` | same `:14` | Turn a mention into a link, or dismiss / undismiss it | zod `{action:"link"\|"dismiss"\|"undismiss", fromId: uuid, toId: uuid}` | `{ok:true}`; audit `backlinks.link` only |

### Search

| Method + path | File | Purpose | Request | Response |
|---|---|---|---|---|
| GET `/api/search` | `src/app/api/search/route.ts:8` | Quick title search or hybrid passage search | query `q` (cut to 500), `mode=quick\|hybrid` (default quick; anything not `quick` is hybrid), `limit` (1..60; default 10 quick / 20 hybrid), `semantic=0`, `kinds=page,entry,file,reference`, legacy `types=page,attachment`, `section` ∈ notes/documents/projects/research/databases (else 400), `since`/`until` `YYYY-MM-DD` (else 400), `archived=1`, `group=1` | quick: `[{id,title,icon,type,section,updatedAt}]`; hybrid: `Hit[]` (shape in section (d)); hybrid with `q` < 2 chars → `[]` |
| GET `/api/search/index-state` | `src/app/api/search/index-state/route.ts:7` | Index counters + health | — | `{pages, attachments, chunks, embedded, indexed_sources, last_indexed, stale, model, version, health:{pending:[{id,title,icon,updatedAt}]≤50, pendingFiles, failed:[{id,sourceId,sourceType,error,at}], queued, embeddingsConfigured}}` |
| POST `/api/search/index-state` | same `:12` | Re-index | zod `{scope: "all"\|"pending"}` default `all` | `{ok:true, queued:n}`; `all` → one `reindex-all` job (singleton 120 s); `pending` → one `index-source` job per pending page / failed attachment; audit `search.reindex` |
| GET `/api/search/duplicates` | `src/app/api/search/duplicates/route.ts:3` | Near-duplicate pages | query `threshold` (default 0.93, unvalidated `Number()`) | `[{a:{id,title,icon,wordCount,updatedAt}, b:{…}, similarity}]` ≤ 50 |

### Capture / inbox

| Method + path | File | Purpose | Request | Response |
|---|---|---|---|---|
| POST `/api/capture` | `src/app/api/capture/route.ts:9` | Create one inbox page | zod `{kind: "note"\|"tasks"\|"link"\|"photo"\|"file"\|"audio", text?: string≤100000, url?: string≤2000, attachmentIds?: uuid[]≤20}` | 201 `{id, title, kind, inboxAt}`; audit `inbox.capture`. Idempotency-Key expected from clients (comment `:7`), not enforced |
| GET `/api/inbox` | `src/app/api/inbox/route.ts:4` | Captures awaiting triage (newest first, ≤300) | query `count=1` | `{count}` or `[{id, title, icon, kind, inboxAt, updatedAt, wordCount, excerpt, tags: string[], url, image, openTasks}]` |
| POST `/api/inbox/[id]` | `src/app/api/inbox/[id]/route.ts:12` | Triage one capture | zod discriminated union on `action`: `keep {section?: notes\|documents\|projects\|research, parentId?: uuid\|null}` · `task {dueAt?: ISO datetime with offset\|null, priority?: low\|medium\|high}` · `database {databaseId: uuid}` · `reference` · `archive` · `trash` | `{actionId, summary, created}`; 409 `not_in_inbox` if already triaged; audit `inbox.<action>` |
| POST `/api/inbox/undo` | `src/app/api/inbox/undo/route.ts:5` | Reverse a triage action | zod `{actionId: uuid}` | `{ok:true, already: boolean}`; audit `inbox.undo` |

### Tasks / tags

| Method + path | File | Purpose | Request | Response |
|---|---|---|---|---|
| GET `/api/tasks` | `src/app/api/tasks/route.ts:12` | Open tasks (+ done with `done=1`), ≤500 | query `done=1` | `[{id,title,status,priority,dueAt,completedAt,project,pageId,createdAt,updatedAt,pageTitle,pageIcon}]`, ordered open first, `due_at asc nulls last`, `created_at desc` |
| POST `/api/tasks` | same `:19` | Create task | zod `{title: 1..500 (trimmed), dueAt?: ISO datetime with offset\|null, priority?: low\|medium\|high, project?: string≤100\|null, pageId?: uuid\|null}` | 201 task row; audit `task.create` |
| PATCH `/api/tasks` | same `:25` | Update / complete / reopen | zod `{id: uuid, title?, dueAt?, priority?, project?, pageId?, status?: "todo"\|"done"}` | task row; 404 if missing; audit `task.complete` / `task.reopen` |
| DELETE `/api/tasks` | same `:40` | Soft delete | query `id` (bare `uuid.parse`) | `{ok:true}`; audit `task.delete` |
| GET `/api/tags` | `src/app/api/tags/route.ts:3` | All tags with page counts | — | `[{id, name, color, pages}]` ordered by name (`listTags`, `src/lib/inbox/service.ts:106`) — **`pages` is always 0, see section (e) and defect D1** |

(Out of the listed directories but relevant: `GET/PUT /api/pages/[id]/tags` in `src/app/api/pages/[id]/tags/route.ts:5,7` reads/replaces a page's tags — body `{tags: string[]≤20, each ≤60}`; this is the only HTTP writer of tags.)

### Dashboard

| Method + path | File | Purpose | Request | Response |
|---|---|---|---|---|
| GET `/api/dashboard` | `src/app/api/dashboard/route.ts:21` | Everything the home widgets need | — | `{layout:{widgets, custom}, user:{displayName, username, preferences}, recent[8], pinned[8], modified[8], projects[8], tasks[≤30 with pageTitle], research:{pages[5], experiments[5], counts:{references, experiments, researchPages}}, graph:{top[≤6 with degree], suggested, edges}, usage:{today:{calls, costUsd, errors}, budgetUsd}, summary, stats:{editedThisWeek}}` |
| PUT `/api/dashboard` | same `:63` | Save or reset the layout | zod `{widgets?: Widget[]≤40, reset?: boolean}`; `Widget = {id: 1..64, type: enum WIDGET_TYPES, size: "half"\|"wide"\|"third", config?: Record}` | `{widgets, custom}`; audit `dashboard.layout` / `dashboard.reset` |
| GET `/api/dashboard/summary` | `src/app/api/dashboard/summary/route.ts:13` | Last stored weekly summary | — | settings value `dashboard.summary` or `null` |
| POST `/api/dashboard/summary` | same `:16` | Generate the weekly AI summary (synchronous model call) | no body | `{text, model, provider, costUsd, latencyMs, at, pages, tasks, reason}`; 400 if nothing edited and no open tasks; 502 on model failure; audit `dashboard.summary` |

### Import / export

Both files use `handler()` without `{fresh}`, and call `requireFresh(user)` **inline, conditionally** — these are the only step-up requirements in this part. No rate limiting on either route. Reported from the delegated read (**[delegated]**).

**`/api/import`** — `src/app/api/import/route.ts` (`maxDuration = 300`, `:24`)

| Method | Mode | Request | Response | Step-up |
|---|---|---|---|---|
| POST | upload with preview (`:92-110`) | multipart: `file` (required), `kind?` ∈ `KINDS`, `parentId?` (uuid of a live page), `preview=1` (query or field). Caps: 500 MB upload (`LIMITS.upload`, `src/lib/import/validate.ts:23`) + per-kind caps | 200 `{jobId, kind, inline, preview}`; nothing created, file staged, record status `preview` | none |
| POST | confirm a preview (`:81-90`), `content-type: application/json` | zod `{jobId: uuid, duplicates?: "skip"\|"import"}` | `done` → 200 `{done:true, jobId, pageId, stats}`; `queued/running` → 202 `{jobId, kind}`; `preview` → starts (201 or 202) | `requireFresh` when kind `json` **and** `duplicates="import"` (`:88`) |
| POST | one-step upload (`:111-113`) | multipart as above + `duplicates`, `sync=1` (force in-request run) | inline run → 201 `{done:true, jobId, kind, pageId, title?, stats, detail?}`; queued → 202 `{jobId, kind}` | same rule (`:111`) |
| POST | retry (`:71-79`) | query `retry=<jobId>` | as confirm; 409 `in_progress` unless failed / cancelled / stalled; 410 `missing_upload` | same rule (`:76`) |
| GET | job status / list (`:116-121`) | query `jobId?` | one `publicJob` (`status, progress, done, total, message, kind, filename, size, pageId, stats, error, errorCode, retryable, attempts, maxAttempts, duplicates, parentId, createdAt, updatedAt, …, stalled, canRetry`) or `{jobs:[≤10]}` | none |
| DELETE | cancel or dismiss (`:123-134`) | query `jobId` | `{ok:true, cancelled:true}` (queued/running; already-created items are kept) or `{ok:true, removed:true}` | none |

Inline vs queued: `(kind ∈ {markdown, csv, bibtex, docx, pdf} && size ≤ 2 MB) || sync` runs in the request (`start()`, `:33-61`; `INLINE_KINDS`, `INLINE_MAX`, `src/lib/import/index.ts:14-15`); otherwise pg-boss `import-file`. Error codes: `file_too_large` 413, `bad_upload` 400, `unsupported_type` 415, `type_mismatch` 415, `empty_file` 400, `bad_json` 400, `bad_zip`, `zip64`, `zip_too_many_entries`, `zip_unsafe_path`, `zip_encrypted`, `zip_entry_too_large`, `zip_too_large`, `zip_bomb`, `bad_backup` 400, `bibtex_parse` 400, `cancelled` 409, `missing_upload` 410, `queue_unavailable` 503, `import_failed` 500. Idempotency: optional; note the key is bound to method + path only, so one key reused for the preview POST and the confirm POST replays the preview (`src/lib/api.ts:25,46`).

**`/api/export`** — `src/app/api/export/route.ts` (GET only, `:29`)

Query: `format` ∈ `FORMATS = md | zip | json | csv | pdf | html | bib` (default `zip`, `:25,30`), `pageId`, `databaseId` (both `uuid.safeParse` → 400), `check=1` (no export; `{ok:true, format, fresh}` — used to pre-flight the step-up), `versions=0` (JSON without page versions), `print=1` (auto-print script).

| `format` | Scope | Response | Step-up |
|---|---|---|---|
| `zip` | workspace, or subtree with `pageId` | `application/zip` stream, `<slug>-<date>.zip`, header `x-export-report` | `requireFresh` **when no `pageId`** (`sensitive()`, `:27,35-36`) |
| `json` | workspace only | `application/json`, `<slug>-backup-<date>.json` | `requireFresh` always |
| `md` | one page (`pageId` required) | `text/markdown`, `<slug>.md` | none |
| `csv` | one database (`databaseId` or its `pageId`) | `text/csv` with BOM | none |
| `bib` | all references, or those of a subtree | `application/x-bibtex`, `references.bib` | none (also for the whole workspace) |
| `html` / `pdf` | one page | **`text/html`** print page, inline | none |

Errors: 413 `export_too_large` (ZIP > `EXPORT_MAX_BYTES` or 500 MB), 404 `not_found`.

---

## (b) Section 6 — Databases

### Data model

- `databases` (`src/db/schema.ts:101`): `id, workspaceId, pageId` (the host page, `pages.type="database"`), `name, description, icon, isTemplate, templateOf, createdAt, updatedAt, deletedAt`. Name/icon are mirrored from the host page on every read (`getDatabase`, `service.ts:30`).
- `database_properties` (`schema.ts:107`): `id, databaseId, name, type` (text column, no DB enum/check), `config jsonb`, `position int`, `width int default 180`.
- `database_rows` (`schema.ts:113`): `id, databaseId, pageId` (every row owns a page), `values jsonb` keyed by **property id**, `position double`, timestamps, `deletedAt`. GIN index `db_rows_values_idx` on `values`.
- `database_views` (`schema.ts:119`): `id, databaseId, name, type` (default `"table"`), `config jsonb`, `position`, `isDefault`.
- `relations` (`schema.ts:124`, exported as `relationsTable`): `id, propertyId, fromRowId, toRowId, createdAt`; unique `(propertyId, fromRowId, toRowId)`, index on `toRowId`.
- Row page: `pages.databaseId` is set for row pages (`schema.ts:79`); row pages are created with `parentId = host page`, `section="databases"`, `type="page"` (`createRow`, `service.ts:146`). The title cell is `pages.title` (also copied into `values[titlePropId]`, `service.ts:135,145`).
- Cell values: plain JSON in `database_rows.values`, except title (page title), relations (`relations` table), and computed types (never stored — `COMPUTED_TYPES`, `types.ts:4`; `splitValues` skips them, `service.ts:137`). Empty values (`null`, `""`, `[]`) are removed from the JSON (`service.ts:138`). There is no per-cell table and no cell history.

### Property types — exact enum and value shape

`PROPERTY_TYPES` (`src/lib/databases/types.ts:2`): `"title", "text", "number", "date", "checkbox", "status", "select", "multi_select", "url", "file", "relation", "rollup", "formula", "created_time", "last_edited_time", "ai"`. `READONLY_TYPES` (`types.ts:5`) = rollup, formula, created_time, last_edited_time, ai.

| Type | Stored / returned value | Config keys (`PropertyConfig`, `types.ts:15`) |
|---|---|---|
| title | string = `pages.title` (hydrated `query.ts:39`); exactly one per database, cannot be created, retyped or deleted (`service.ts:57,77,98`) | — |
| text, url | string | — |
| number | number (strings parsed by `numberOf`, `values.ts:10`) | `format`: `"number" \| "integer" \| "percent" \| "currency"` (currency is hard-coded CAD / en-CA, `values.ts:17`) |
| date | string, `YYYY-MM-DD` or ISO datetime (`parseValue`, `values.ts:85`); single date only — **no date range / end date in the value** | `includeTime` |
| checkbox | boolean | — |
| select, status | option **id** (string) | `options: SelectOption[]` `{id, name, color, group?}`; colors `OPTION_COLORS` (`types.ts:10`); status groups `todo \| in_progress \| done`; default status options `DEFAULT_STATUS` (`service.ts:13`) |
| multi_select | option id[] | `options` |
| file | `FileRef[]` `{id, url, name, mime?}` (`types.ts:43`) | — |
| relation | not in `values`; returned as `RelationRef[]` `{rowId, pageId, title, icon}` (`query.ts:42`); written as an array of row ids or refs (`relIds`, `service.ts:124`) | `targetDatabaseId`, `twoWay`, `syncedPropertyId` (on the reverse side), `single` |
| rollup | computed: number, string[], ISO date, `null` or `{error}` (`rollup()`, `query.ts:51`) | `relationPropertyId`, `targetPropertyId`, `aggregate` ∈ `AGGREGATES` = count, count_values, sum, avg, min, max, unique, show (`types.ts:8`) |
| formula | computed: string \| number \| boolean \| null \| `{error}` (`evaluate`, `formula.ts:109`; dates become ISO strings, arrays become a joined string) | `expression` |
| created_time | ISO string from `database_rows.created_at` (`query.ts:40`) | — |
| last_edited_time | ISO string, later of row `updated_at` and page `updated_at` (`query.ts:41`) | — |
| ai | string, or `{pending:true, at}` (`AiPending`, `types.ts:46`) while queued, or `{error}` | `prompt` |

Type change: `updateProperty` (`service.ts:69`) converts stored values best-effort (`convertValues`, `service.ts:107`: to text/url/ai, number, checkbox, date, select/status, multi_select; anything else becomes null), one UPDATE per row.

### View types

Schema / API enum: `VIEW_TYPES` = `"table", "board", "calendar", "gallery", "timeline", "list"` (`types.ts:6`; column comment `schema.ts:121`). `ViewConfig` keys (`types.ts:34`): `filter, sorts, groupBy, hidden, order, widths, dateProperty, startProperty, endProperty, coverProperty, scale ("week"|"month")`. The server does not validate config per view type (`createView`, `service.ts:189`).

**Implemented in the UI [UI]: all six.** `VIEWS` map in `src/components/database/DatabaseView.tsx:26`; an unknown type falls back to `TableView` (`:118`). Every view renders the same single result set of `useRows` (one `POST …/query` with hard-coded `limit: 500`, `src/components/database/hooks.ts:48`).

| View | Component | What works | Config keys read | Not there |
|---|---|---|---|---|
| table | `src/components/database/views/TableView.tsx:25` (`GridLayout` `:57`; phone default `CardsLayout` `:30`) | inline cell edit, keyboard navigation (`nav`, `:64-70`), column resize saved per view (`widths`, `:71`), row drag-reorder when no group/sort/search (`:62,72`), multi-select + bulk delete (`:77`), optional grouping | `groupBy, widths, sorts, hidden`, phone-only `mobileLayout, mobileProps` | column drag-reorder (`ViewConfig.order` is never read or written), column footer aggregates, select-all, virtualisation |
| board | `views/BoardView.tsx:22` | columns per option of the group property (+ "No …" column), drag a card between columns (`:39-50`) with Undo toast; on phones drag is off and a "Move to…" list replaces it (`:60,107-111`) | `groupBy` | ordering inside a column, column reorder/collapse, WIP limits, sub-groups |
| calendar | `views/CalendarView.tsx:16` (phone: `Agenda` `:99`) | month grid (Monday start), prev/today/next, create on a day (only for a `date` property, `:42`) | `dateProperty` only | **drag to reschedule**, week/day views, multi-day spans (`endProperty` not read), "+N more" is plain text (`:85`) |
| timeline | `views/TimelineView.tsx:21` (phone: `PhoneList` `:126`) | bars from start to end, today line, week/month scale, colour from the first status/select property | `startProperty, endProperty, scale` | **any drag / resize / create on the chart**, grouping, dependencies, configurable colour |
| gallery | `views/GalleryView.tsx:11` | card grid, cover = first image of the cover file property | `coverProperty` | grouping, card size, page cover |
| list | `views/ListView.tsx:11` | one line per row, optional grouping | `groupBy` | inline edit, reorder |

View management (`src/components/database/ViewTabs.tsx`): create (`:24-31`, with `defaultConfig` `:105`), rename, change layout, per-type settings, make default, delete (native confirm). Duplicate view and reorder views: absent.

### Query engine (`src/lib/databases/query.ts`)

- **Where it runs: mostly JavaScript, over the whole database.** `queryRows` (`query.ts:128`) loads every non-deleted row of the database with `loadRaw` (`query.ts:11`, one join `database_rows ⨝ pages`, no LIMIT), hydrates all of them (`hydrate`, `query.ts:27`), then filters, searches, sorts and paginates in memory (`query.ts:133-137`). `total` is the in-memory length.
- **SQL pushdown** (`sqlFilter`, `query.ts:104`): only when *every* rule of the filter tree is "simple"; otherwise the whole filter runs in JS. Pushed: on `title, text, url, select, status, ai` — `empty`, `not_empty`; `eq`/`neq` (select/status by option id; others case-insensitive); `contains, not_contains, starts_with, ends_with` (ILIKE, not for select/status); on `checkbox` — `eq`/`neq`. Any rule on number, date, multi_select, relation, rollup, formula, file, created/last_edited time, or any other operator, disables pushdown for the whole tree. Even with pushdown, sort/search/pagination stay in JS.
- **Operators** — `FILTER_OPS` (`types.ts:27`): `eq, neq, contains, not_contains, starts_with, ends_with, empty, not_empty, gt, gte, lt, lte, before, after, on`. Semantics in `matchRule` (`query.ts:69`):
  - `empty` / `not_empty`: any type (`isEmpty`, `values.ts:9`; pending/error AI or formula values count as empty).
  - `eq` / `neq`: checkbox (true/"true"/1), select/status (option id or name), multi_select (contains the option), relation (row id or exact title), number / numeric formula, date (same calendar day; the literal `"today"` is accepted, `query.ts:67`), otherwise case-insensitive display string.
  - `contains` / `not_contains`: multi_select (option id/name), relation (row id or title substring), otherwise display-string substring.
  - `starts_with` / `ends_with`: display string.
  - `gt, gte, lt, lte`: numeric, or by day for date / created_time / last_edited_time.
  - `before, after, on`: always by calendar day (server local time, `day()`, `query.ts:68`).
  - A rule on an unknown property, or with an unknown operator, matches everything (`query.ts:70,95`).
- **Filter tree**: nested `{and: [...]}` / `{or: [...]}` groups (`matchFilter`, `query.ts:97`); when a group has both keys, `or` wins.
- **Search** (`query.ts:134`): substring over title and every property's display value, in JS.
- **Sorts** (`sortRows`, `query.ts:122`): multi-key, in JS; `sortKey` (`values.ts:68`) — numbers, dates by timestamp, checkbox, select/status by option order, else lowercase display string (`localeCompare`); empty last; ties by `position`.
- **Grouping**: **absent on the server** — `groupBy` is only a view-config key; no grouped response, no per-group counts/aggregates.
- **Pagination**: `limit` default 200, max 1000; `offset`; applied by `Array.slice` after the full load (`query.ts:136-137`). No cursor.
- **View resolution**: `filter`/`sorts` default to the view's config when not given (`query/route.ts:11`; helper `resolveView`, `query.ts:139`, is exported but the routes inline the same logic).

### Formulas (`src/lib/databases/formula.ts`)

- Hand-written lexer + recursive-descent parser + tree-walking evaluator, no `eval` (`lex` `:8`, `parseFormula` `:21`, `evalNode` `:85`); client-safe; parsed ASTs cached (≤500, `:107`); depth limit 200 (`:86`).
- Grammar (precedence low → high): ternary `c ? a : b` → `||` / `or` → `&&` / `and` → `!` / `not` → comparison `== != <= >= < >` (`=` accepted as `==`; non-associative) → `+ -` → `* / %` → unary `- +` → `^` → primary. Primaries: number (decimals, exponent), string in `"` or `'` with backslash escapes, `true`, `false`, `null`, parenthesised expression, function call `name(args…)`, bare identifier = property reference by name (`{k:"id"}` → `ctx.prop(name)`, `:89`; only names matching `[A-Za-z_][A-Za-z0-9_]*`; others need `prop("Name")`).
- Value types `FVal` (`:2`): number, string, boolean, Date, null, array. `+` concatenates when either side is a string; Date ± number is in days; Date − Date gives days (`:98-99`). Division by zero throws.
- Functions (`FNS`, `:63-83`): `prop, if, ifs, empty, not, and, or, concat, join, length, upper, lower, trim, contains, replace, replaceAll, slice, format, toNumber, test, round, floor, ceil, abs, sqrt, pow, mod, min, max, sum, avg, count, now, today, date, year, month, day, weekday, dateDiff, dateAdd, formatDate, dateBetween` (alias of `dateDiff`), `dateSubtract`. Units for date functions: ms, seconds, minutes, hours, days, weeks (`UNIT`, `:58`) plus months, years.
- Property references resolve by **name**; formula-to-formula references are evaluated recursively with a per-row memo and a cycle check (`query.ts:46`). Errors return `{error: message}` and never throw.
- Evaluated on every read, for every row, in `hydrate` (`query.ts:47`); nothing is persisted. `FORMULA_HELP` (`formula.ts:118`) is the in-app cheat sheet.

### Rollups — exist (partial)

`rollup()` (`query.ts:51`): follows one relation property of the same database (`relationPropertyId`) and aggregates one property of the target rows (`targetPropertyId`) with `count, count_values, show, unique, sum, avg, min, max`; min/max work on dates; checkbox counts as 0/1. Limitation confirmed in code: target rows are raw rows (`targets`, `query.ts:31`), so a rollup over a target property that is itself a relation, rollup or formula reads `t.values[tp.id]`, which is never stored for those types → always empty (`query.ts:56`). Rollups are read-only and computed on read.

### Relations

- Stored in the `relations` table, one row per (property, from row, to row); never in `values`.
- One-way by default; **two-way supported**: creating a relation with `config.twoWay` and `targetDatabaseId` also creates a reverse relation property on the target database with `config.syncedPropertyId = <forward id>` (`createProperty`, `service.ts:62-66`; named after the source database, or `"<name> (reverse)"` for a self-relation). Both sides read the same `relations` rows: the forward side by `fromRowId`, the synced side by `toRowId` (`loadRelations`, `query.ts:17-23`; `setRelations`, `service.ts:125`).
- `config.single` limits to one target (`service.ts:126`).
- Deleting the forward property deletes the reverse property and the relation rows (`deleteRelationPair`, `service.ts:88`). Changing the target database clears the relation rows (`service.ts:83`).
- Targets are not checked to belong to `targetDatabaseId` when writing (`setRelations` inserts any row uuid; FK only requires an existing row).
- Relations between row pages also appear as `relation` edges in the knowledge graph (`src/lib/graph/service.ts:60,64`).

### Templates (`src/lib/databases/templates.ts:15`)

Three built-in templates, code-defined (not rows in the DB):
1. `research-papers` "Research papers" — Status (status), Domain (multi_select), AI model (select), Year (number/integer), Venue (text), DOI (url), Notes (**ai**, with prompt), Added (created_time); views: table "All papers", board "By status", gallery.
2. `tasks` "Tasks" — Status, Priority (select), Due (date), Project (select), Done (checkbox), Days left (**formula** `if(empty(prop("Due")), "", dateDiff(prop("Due"), today(), "days"))`); views: table (sorted by Due), board, calendar (Due), timeline (start = end = Due).
3. `reading-list` "Reading list" — Type, Status, Author, Link, Rating, Tags (multi_select), Finished on (date), Pitch (**ai**); views: list, table, gallery, board.

`applyTemplate` (`templates.ts:45`) renames the title property, adds missing properties (matched by name, case-insensitive), reuses the single default view if its type matches the template's first view, creates the other views, sets the icon if empty. It is additive: it can be applied to a non-empty database. Separately, any database can be flagged `isTemplate` and duplicated (`templateOf` is set on the copy, `service.ts:212`); there is no API that lists user templates other than filtering `GET /api/databases` on `isTemplate`.

### AI column

- Property type `ai` with `config.prompt`. Trigger: `POST /api/databases/[id]/ai` → `enqueueAi` (`service.ts:181`) writes `{pending:true, at}` into the cell, then enqueues queue `ai-property` (`QUEUES.aiProperty`, `src/lib/jobs/queues.ts:1`) with `singletonKey ai:<rowId>:<propertyId>`, 5 s window. Queue policy: 1 retry after 20 s, 300 s expiry, dead-letter (`queues.ts:19`).
- Worker `handleAiProperty` (`src/worker/handlers/ai-property.ts:14`): loads row + page title + `plainText`; builds `Row properties:` lines from every non-AI, non-rollup, non-formula property (relation titles resolved); substitutes `{{Property name}}` placeholders in the prompt (`:40`); appends up to 6000 chars of the row page's text (`:41`); wraps the data in `<workspace>` tags; system prompt `SYSTEM` (`:11`) + `INJECTION_GUARD`; model chosen by `route({task:"quick"})` (`:45`); `maxTokens 1200`, timeout 120 s. Result (trimmed, outer quotes stripped) is written into `values[propId]`; refusal or exception writes `{error}`; no prompt → `{error:"No prompt configured"}`. Usage recorded with task `ai_property`.
- **When recomputed: only on explicit request.** `updateRow`/`createRow` never enqueue (`service.ts:142-162`); CSV import and templates do not either. There is no staleness flag, no "source values changed" detection and no schedule (`src/worker/index.ts:38-39` schedules only backup and maintenance).
- An `ai` cell is also writable as plain text through the API (`splitValues` only blocks `COMPUTED_TYPES`, which does not include `ai`, `service.ts:137`).

- **AI column UI [UI]**: `AiCell` (`src/components/database/cells/Cell.tsx:76-84`) — "Generate" on an empty cell, "Regenerate" on a filled one; one row and one property per call (`DatabaseView.tsx:88-93`); rows are polled every 2.5 s while any loaded value is pending (`hooks.ts:49`). **Whole-column fill: absent in the UI** although the route accepts `rowIds` (≤200). Model choice / auto-run options: absent.

### UI side of filters, sorts, grouping, pagination **[UI]**

- Filter builder (`src/components/database/FilterBuilder.tsx`): saved with the view (no temporary filter); and/or with one level of nested groups (`:48,53`). Operators offered per family (`OPS`, `:9-14`; family by `kind()`, `:15`): text (title, text, url, formula, ai): contains, not_contains, eq, neq, starts_with, ends_with, empty, not_empty · number (number, rollup): eq, neq, gt, gte, lt, lte, empty, not_empty · date (date, created_time, last_edited_time): on, before, after, empty, not_empty (+ a "today" toggle) · checkbox: eq · select/status: eq, neq, empty, not_empty · multi (multi_select, relation): contains, not_contains, empty, not_empty · file: empty, not_empty. A relation filter value is free text (no row picker). Relative dates other than "today", "between": absent.
- Sorts (`SortBuilder`, `FilterBuilder.tsx:73-91`): multi-sort saved with the view, any property.
- **Grouping is computed client-side** on the loaded rows (`groupRows`, `src/components/database/group.ts:4-11`), offered for table / board / list (`GROUPABLE_VIEWS`, `Toolbar.tsx:18`) on select / status / checkbox properties only (`:17`). Group counts are counts of loaded rows. Collapse, group sort, sub-groups, per-group aggregates: absent.
- Search box → server `search` field, one request per keystroke (no debounce).
- **Pagination / load more / virtualisation: absent.** Rows beyond 500 are unreachable in the UI; only the table footer hints at it ("N rows · showing M", `TableView.tsx:52,99`).

### Row pages, RowPeek **[UI + server]**

- **Each row is a page**: `database_rows.page_id` (server), `RowOut.pageId` (`types.ts:42`). `RowPeek` (`src/components/database/RowPeek.tsx:24`; desktop side panel, phone bottom sheet) shows the title, every property as an editable cell, and the page body in the shared `Editor` (`GET`/`PATCH /api/pages/[pageId]`, `:143,152-155`), plus "Open as page" (`/p/<pageId>`, `:85`), "Move to…" (when the view is grouped) and Delete. A row page opened directly shows a `RowBanner` back to its database (`src/components/page/PageView.tsx:109,161`). Row pages get links, backlinks, graph node kind `row`, search kind `entry`, version history of the body.
- Absent in the peek: comments, value history, previous/next navigation, **duplicate row** (no UI and no endpoint).
- `NewRowSheet` (`src/components/database/NewRowSheet.tsx:39`): phone-only quick-create with a localStorage draft; desktop "New" creates the row immediately (`DatabaseView.tsx:81`).

### Property management **[UI]**

`PropertyEditor` (`src/components/database/PropertyEditor.tsx:18`): 15 creatable types (`CREATABLE`, `:16` — all but title); per-type config: options with 9 colours and status groups (`OptionsEditor`, `:65`), number format, date `includeTime`, relation target / two-way / single (`RelationConfig`, `:87`), rollup relation + target property + aggregate (`RollupConfig`, `:98`), formula expression with live preview on the first loaded row and function help (`FormulaConfig`, `:109`), AI prompt with `{{Property}}` hint (`:61`). Rename, type change (with warning), two-step delete (no undo). `PropertyManager` (`PropertyManager.tsx:14`): global drag reorder, per-view show/hide. Duplicate property, option reorder: absent.

### Templates, CSV, duplicate in the UI **[UI]**

- `TemplateChooser` (`src/components/database/TemplateChooser.tsx:11`) appears automatically on a fresh database (≤1 property and 0 rows, `DatabaseView.tsx:116-117`) and from the toolbar menu; applying to a non-empty database has no confirmation. A database can be flagged as a template from the menu (`Toolbar.tsx:55-61`) but **no UI creates a database from a user-flagged template**.
- CSV: toolbar "More" → "Import CSV…" (`Toolbar.tsx:34-46,69`; no mapping, preview or progress) and "Export CSV (this view)" (`:68`; the search box value is not passed).
- "Duplicate (structure)" / "Duplicate with rows" (`Toolbar.tsx:47-54,71-72`).
- Entry point for a new database: slash command "New database" creates a **sub-page of type `database`** (`src/components/editor/extensions/slash.tsx:33,61`); the database is rendered full-width on its own page (`PageView.tsx:114`).

### Bulk actions and undo in the UI **[UI]**

- Bulk: multi-select + bulk delete in the table grid only (`TableView.tsx:77,110`). Bulk edit, select-all, shift-range, bulk actions in other views: absent.
- Undo: row deletion (toast → `POST …/rows/restore`, `DatabaseView.tsx:58-64`) and board moves (`BoardView.tsx:49`). No undo for cell edits, property or view deletion, CSV import, template application; no Ctrl+Z stack.

### Mobile handling **[UI]**

`src/components/database/Responsive.tsx`: `ResponsivePanel` (`:11-48`) renders a Radix popover on desktop and a bottom sheet (`Dialog` + `SheetContent`) on phones, switching on `useIsPhone()` = `(max-width: 767.98px)` (`src/lib/client/hooks.ts:10`); single breakpoint, no tablet tier. `SheetSection` (`:51-59`) is a titled section for the phone options sheet. Used by view settings, property editor, select / relation / file pickers, "Move to…". Other phone switches via `ctx.isMobile`: one "View options" sheet instead of four toolbar popovers, table → cards by default, calendar → agenda, timeline → list, board → no drag, row detail and new row as sheets.

### CSV import / export (server)

- Export: `exportCsv` (`src/lib/databases/csv.ts:9`) — UTF-8 BOM, papaparse `unparse`; columns = title + non-hidden properties in display order; dates and numbers raw, files as URLs, everything else as display string. Reached by `GET /api/databases/[id]?format=csv` and `GET /api/databases/[id]/query?format=csv`, **capped at 1000 rows** (`limit: 1000`) with no continuation.
- Import: `importCsv` (`csv.ts:14`) — papaparse with header row; title column = the column named like the title property, else `name|title|titre|nom`, else the first column; unknown columns are created as `text` properties (no type inference); existing columns parsed by `parseValue` (`values.ts:80`: number, checkbox `true|yes|y|1|x|✓|oui`, date, select/status and multi_select auto-create options, split on `, ; |`); relation columns matched by target row title; rollup/formula/created/last-edited/file columns ignored. One `createRow` per record, synchronously inside the HTTP request, no row limit other than the 20 MB file cap, no transaction, no dry run.

### Duplicate

`duplicateDatabase` (`service.ts:209`): new host page "<name> (copy)", copies properties (ids remapped inside configs and view configs by string replacement, `remapConfig`, `:208`), views, and with `withRows` every row + its page content + forward relations (self-relations remapped to the new rows). Relation properties lose `twoWay`/`syncedPropertyId` on the copy (`:216`) — copies of the *reverse* side of a two-way relation therefore become independent one-way relations with no data. Single-row duplicate endpoint: **absent** (no route; the UI part below says whether the client emulates it).

### Bulk actions / undo (server side)

- Bulk endpoints exist: `POST rows {rows:[…]}` (≤500), `PATCH rows {updates:[…]}` (≤500), `PATCH rows {order:[…]}` (≤5000), `DELETE rows ?ids=`, `POST rows/restore {ids}` (≤500), `POST ai {rowIds}` (≤200). Each is a sequential loop of single-row operations, not one statement and not one transaction (`rows/route.ts:16,24`).
- Undo: only for row deletion (`rows/restore/route.ts`, soft-delete based). No undo log for cell edits, property changes, view changes or CSV imports. Row pages keep page version history (`page_versions`) for their body, not for `values`.

---

## (c) Section 5 — Knowledge graph

### Tables

- `links` (`schema.ts:154`): `id, fromPageId, toPageId, kind text default "link", createdAt`; unique `(from, to, kind)`; index on `toPageId`. Values of `kind` actually written: `"link"` (`src/lib/pages/service.ts:106`) and `"ai"` (accepted suggestion, `src/lib/graph/service.ts:118`).
- `knowledge_edges` (`schema.ts:158`): `id, workspaceId, fromId, toId, fromType default "page", toType default "page", kind, status default "accepted", confidence double, rationale text, model text, createdAt, decidedAt`; unique `(fromId, toId, kind)`. No FK on `fromId`/`toId`.
- Also read as graph sources: `relations` (database relations), `attachments.page_id`, `tags` + `page_tags`.
- Unlinked-mention dismissals: a single `settings` row, key `backlinks.dismissed`, JSON array of `"<fromId>:<toId>"` capped at 5000 (`src/lib/graph/backlinks.ts:10,29-33`).

### Edge / link kinds

- Schema comment for `knowledge_edges.kind` (`schema.ts:161`): `link | backlink | relation | ai_suggested | concept`. **Only `link` and `ai_suggested` are ever written** (`pages/service.ts:107`; `graph/suggest.ts:60`). `backlink`, `relation`, `concept`: no writer anywhere in `src/` — absent in practice. `fromType`/`toType` are always `"page"`.
- `knowledge_edges.status`: `suggested | accepted | rejected` (`schema.ts:162`).
- API-level edge kinds (`EdgeKind`, `src/lib/graph/types.ts:3`): `"link" | "relation" | "ai_suggested" | "attachment" | "tag"`; node kinds (`NodeKind`, `types.ts:2`): `"page" | "database" | "research" | "row" | "attachment" | "tag"`.
- **Typed relations (supports / contradicts / cites / depends-on …): absent.** The only "type" information is the edge source (link, database relation with the property name in `sub`, AI suggestion, attachment, tag).
- **Temporal attributes: absent** beyond `createdAt` / `decidedAt`. No validity interval, no "as of", no event time. The `since` filter of `/api/graph` filters *nodes* by `pages.updated_at` (`graph/service.ts:47`), not edges.

### Link extraction

- `extractPageRefs` (`src/lib/editor/text.ts:27`): collects (1) `mention` nodes with `attrs.id` and `attrs.kind !== "user"`, (2) `link` marks whose `href` matches `^/p/<uuid>`. **Wikilink `[[…]]` syntax is not parsed in documents** — `[[label]]` only exists as the Markdown *export* form of a mention (`text.ts:38`); the editor creates mentions with `@` (`src/components/editor/extensions/mention.tsx`, slash item "Link to page", `slash.tsx:31`). Whether Markdown *import* turns `[[…]]` back into mentions is covered in the import section.
- When: **synchronously on every content/title save**, in `afterContentChange` (`pages/service.ts:100`), called from `createPage` (`:30`) and from `updatePage` when `content` or `title` changed (`:61`). It deletes the page's `links` rows of kind `link`, re-inserts one per valid referenced page of the same workspace (`:102-106`), mirrors them into `knowledge_edges` kind `link` status `accepted` (`:107`) and removes stale mirror rows (`:110`), then enqueues `index-source` for the page (singleton 20 s, `:111`). Not transactional. No worker is involved in link extraction.
- Block-level anchors: links are page → page only; the source block id of a mention is not stored.

### Backlinks

- Per page: `backlinks()` (`pages/service.ts:133`) — pages with a `links` row pointing to the page (all kinds), not deleted.
- Explorer: `backlinkStats` (`graph/backlinks.ts:13`) — pages ranked by incoming count with outgoing and pending-suggestion counts, three correlated sub-selects per page, limit 300, optional title `ilike` filter.
- **Unlinked mentions** (`unlinkedMentions`, `backlinks.ts:37`): SQL self-join of `pages` × `pages` with `strpos(lower(m.plain_text), lower(t.title)) > 0`, titles ≥ 4 chars and not "Untitled", minus existing links and dismissed pairs; excerpt = 200 chars around the first occurrence; limit 400. `linkMention` (`backlinks.ts:52`) appends a paragraph `"See also " + mention node` at the **end** of the mentioning page (it does not convert the occurrence in place) via `updatePage(..., {versionReason:"backlink"})`.

### AI link suggestions

- Candidate generation: **embedding similarity** — `nearestPages` (`graph/suggest.ts:19`): up to the first 24 chunk embeddings of the source page, each joined laterally to its 20 nearest chunks of other pages (pgvector `<=>`, HNSW index `embeddings_hnsw_idx`), aggregated per page with `max(sim)`; excludes self, pages already linked in either direction, and any pair that already has an `ai_suggested` edge in any status; threshold `minSim = 0.25`; top `k` (8 for one page, 5 per page in a workspace pass).
- Confirmation: **LLM** — `suggestLinksForPage` (`suggest.ts:43`): one call, model from `route({task:"quick", schema:true})`, structured output `link_suggestions` (`SCHEMA`, `:38`: per candidate `{id, related, confidence, rationale}`), strict system prompt `SYSTEM` (`:39`), source excerpt 2000 chars, candidate excerpts 1200 chars.
- Storage: every judged candidate is inserted in `knowledge_edges` with `kind="ai_suggested"`, `confidence`, `rationale` (≤600 chars), `model`; `status="suggested"` when `related && confidence >= 0.35`, else `status="rejected"` so the pair is never proposed again (`suggest.ts:59-60`).
- UI threshold: `LOW_CONFIDENCE_THRESHOLD = 0.6` (`graph/types.ts:31`) collapses weaker suggestions under "Low confidence".
- When: **on demand only** — `POST /api/graph/suggestions` (inline for one page, or queue `suggest-links`); workspace pass = the 150 most recently edited pages that have embeddings (`suggestLinksForWorkspace`, `suggest.ts:71`). No schedule and no trigger on save (`worker/index.ts:38-39`). Queue policy: no retry, 600 s expiry (`queues.ts:18`).
- Accept (`decideSuggestion`, `graph/service.ts:114`): sets `status="accepted"`, `decidedAt`, and inserts `links(from, to, kind="ai")` — so it becomes a real backlink and a `link` edge with `sub:"ai"`; **the document content is not modified** (no mention is inserted). Reject: `status="rejected"`, removes any `ai` link. Undo (`revertSuggestion`, `:127`): back to `suggested`, `decidedAt=null`, `ai` link removed. A pending suggestion disappears from lists once the two pages are linked explicitly (`:103`).

### Graph API shapes (`graph/types.ts:8-25`)

- `GraphNode`: `{id, kind, title, icon, section, updatedAt, databaseId, degree, in, out}`; attachment nodes have id `att:<uuid>`, tag nodes `tag:<uuid>` with title `#name`.
- `GraphEdge`: `{id, source, target, kind, status: "accepted"|"suggested", sub, confidence, rationale, model?}`; `sub` = `links.kind` (`"link"` | `"ai"`) for links, the relation property name for relations, the model id for suggestions, the tag colour for tag edges.
- `GraphData`: `{nodes, edges, center?, stats:{pages, edges, suggested}}`.
- `buildGraph` (`graph/service.ts:40`): one page query (whole workspace unless `pageId`), then links / relations / knowledge edges in parallel, then attachments and tags; duplicate pairs collapsed per kind; an accepted AI edge already mirrored as a link is drawn once and its rationale/confidence/model are copied onto the link edge (`:66-73`). `degree/in/out` are computed in JS from the returned edges. No server-side layout, clustering, centrality, community or path computation. No pagination or node cap.
- Neighbourhood: breadth-first over links ∪ relations ∪ non-link knowledge edges, one SQL per hop, depth ≤ 4 (`neighbourhoodIds`, `:30`).

### Graph UI **[UI]**

- **`GraphExplorer`** (`src/components/graph/GraphExplorer.tsx:30`, route `/graph`): desktop = canvas + toolbar + filter popover + right panel (`"inspector" | "suggestions"`, `:37`); phone = `BacklinksExplorer` list first, canvas as a secondary mode (`:32,90-92`).
  - Filters — exact list (`:60-73`), all applied server-side through `/api/graph`: node-kind chips (Pages, Databases, Research, Database rows, Attachments, Tags), Section (`notes, documents, databases, projects, research`, `:19`), "Edited within" (All time / 7 / 30 / 90 days / year, `:20`), neighbourhood depth 1–3 (only in local mode; default 2), "Hide orphans", "AI suggestions". Absent: edge-kind filter, tag filter, database filter, free date range.
  - Search box: client-side substring match on titles of loaded nodes (`:45`), Enter focuses the first match. No content search.
  - **Local vs global**: global = no `pageId`; local = `pageId` + `depth`, entered by `?focus=`, the Inspector's "Neighbourhood" button, or "Open full graph" on a page; "Whole graph" returns (`:113`).
  - Layout: one force layout; "Fit to view" and "Freeze layout" only. Layout choices, time slider, clustering, centrality metric, path finding: absent.
- **`GraphCanvas`** (`src/components/graph/GraphCanvas.tsx:27`): `react-force-graph-2d` loaded dynamically, `ssr:false` (`:13`); custom node painting (`paintNode`, `:60-71`): radius `2.2 + min(10, sqrt(degree)*1.4)` (`:24`), ring look for database/research nodes, dimming of non-neighbours. Colours per node kind `kindColor` (`src/components/graph/colors.ts:18`), per edge `edgeColor` (`:19`); suggested edges dashed; arrowheads only on `link` and `relation` (`:77`). Labels appear from zoom scale ≥ `labelsAt` (default 1.7) or for selected/hovered/highlighted nodes (`:68`). Interactions: click select, hover, drag (unless frozen), zoom 0.15–12, auto-fit once per data key. Positions are cached across refreshes. Edge click: prop exists (`onEdgeClick`, `:20`) but no caller passes it.
- **`Inspector`** (`src/components/graph/Inspector.tsx:13`): for the selected node — kind, section, degree, in/out, relative update time; buttons Open, Neighbourhood, "Suggest connections with AI"; list of its connections within the loaded graph with badges (AI %, relation property name, "AI ✓") and, for AI edges, rationale + provenance (model, confidence). No content preview, no tags, no accept/reject in place, no edge deletion.
- **`ConnectionsList`** (`src/components/graph/ConnectionsList.tsx:101`; data from `GET /api/graph/neighbors?pageId&depth=1&linked=1`, `:24`): sections "Links from this page", "Backlinks", "Relations", "Accepted AI links", "Tags and files", then "Suggested by AI — to review" and a per-page suggest button. Rows show a title and a generic reason; **no backlink context snippet**.
- **`PageGraphCard`** (`src/components/graph/PageGraphCard.tsx:22`): local graph at the bottom of every page (`src/components/page/PageView.tsx:120`) and in the dashboard widget (`src/components/dashboard/widgets.tsx:132`). Depth is a prop defaulting to 1; both call sites use 1, so depth 2/3 is not reachable from this card. Desktop: compact canvas + list toggle + "Open graph" (`/graph?focus=`). Phone: list first, canvas behind "Open full graph".
- **`BacklinksExplorer`** (`src/components/graph/BacklinksExplorer.tsx:30`, route `/backlinks`): tabs Pages (table: Page, Section, Incoming, Outgoing, AI, Updated, Details) / Unlinked mentions (excerpt with the title highlighted, "Link it", "Dismiss" with undo) / AI suggestions. One title filter applied client-side to the full payload (`:41-42`); no sorting, no pagination. Header shows a count of pages without any link (`:43,82`) but there is no orphan list or filter.
- **`SuggestionList`** (`src/components/graph/SuggestionList.tsx:181`): card per suggestion — source → target, "Why:" rationale, confidence bar, model, age; suggestions below 0.6 or without confidence are collapsed under "Low confidence" (`isLowConfidence`, `:20`). Accept / Reject = `PATCH /api/graph/suggestions` with optimistic removal (`useDecide`, `:33`); Undo only from the toast (`status:"suggested"`, `:38-45`). Generation per page (inline) or whole workspace (queued, behind a `confirm`). Absent: bulk accept/reject, a history of past decisions, the embedding similarity score.

---

## (d) Search

### Index tables

- `chunks` (`schema.ts:173`): `id, workspaceId, sourceType` (comment: `page | attachment | row`; **only `page` and `attachment` are indexed** — `handleIndex` ignores anything else, `src/worker/handlers/index-source.ts:18`; database row *values* are not indexed, only the row page's body), `sourceId, pageId, ordinal, blockId, heading, content, tokenCount, contentHash`, generated `tsv`.
- `embeddings` (`schema.ts:181`): `chunkId` PK, `model, version, embedding vector(1536)`; HNSW index `vector_cosine_ops`.
- `index_state` (`schema.ts:185`): per source `contentHash, model, version, indexedAt` — makes indexing incremental.
- `pages.tsv` (`schema.ts:85`): generated column (title weight A, plain_text weight B) with GIN index `pages_tsv_idx` — **not used by any query** (only `chunks.tsv` is queried, `src/lib/search/index.ts:73`). `pages_title_trgm_idx` (trigram on title) serves quick search.

### Indexing

- Chunking (`src/lib/search/chunk.ts:8`): follows headings and blocks (`docBlocks`, `editor/text.ts:18`), target ~350 tokens, max 500, 60-token overlap for long blocks; each chunk keeps the `blockId` of its first block and the current heading; token count approximated as chars/3.6. Attachments: paragraph chunking of `extracted_text` (`chunkPlainText`, `:29`).
- `indexSource` (`search/index.ts:11`): skips when the source hash (chunk hashes + block ids + headings) is unchanged; re-embeds only changed chunks; embeddings from OpenAI through `embedTexts` (`src/lib/search/embed.ts:6`, model `EMBEDDING_MODEL` from `@/lib/ai/router` — the comment at `index.ts:50` names text-embedding-3-small; batches of 64, text cut to 8000 chars).
- Trigger: queue `index-source` after every page create/update (`pages/service.ts:111`), restore, and manual re-index; `reindex-all` walks every page and attachment sequentially (`index-source.ts:20`). Soft-deleting a page deletes its chunks immediately (`pages/service.ts:116`).

### Query

- FTS configuration: **`'simple'`** everywhere (`schema.ts:85,178`; `websearch_to_tsquery('simple', …)`, `index.ts:73`). No stemming, no stop words, no language detection, no French/English dictionary, no `unaccent`.
- `hybridSearch` (`index.ts:59`): keyword leg = `ts_rank_cd` over `chunks.tsv`, top `k = max(30, limit×4)`; semantic leg = cosine over `embeddings` for the embedded query, same `k`, only when `semantic` is not disabled and `OPENAI_API_KEY` is set (failure is logged and ignored); **fusion = reciprocal rank fusion, `1/(60+rank)` per leg** (`:78,80`); a semantic-only hit is kept only if similarity ≥ `SEARCH_MIN_SEMANTIC = 0.33` (`:51,80`). No reranker, no recency/authority boost, no typo tolerance on the passage leg.
- Filters (`SearchFilters`, `index.ts:48`): `kinds` (page = non-row page, entry = database row page, file = attachment, reference), legacy `sourceTypes`, `section`, `since`/`until` (on `pages.updated_at`, or chunk creation for files), `includeArchived`, `pageIds` (internal callers only), `semantic`, `group`, `limit`. **Not available: tag filter, database/property filter, author, has-task, link-based filters.**
- Result shape `Hit` (`index.ts:47`): `{chunkId, pageId, sourceType, sourceId, title, icon, heading, blockId, content, score, semantic, keyword, kind, section, archived, updatedAt, snippet, more?, attachmentId}`. **Block-level: yes** — one hit per chunk with `blockId` + `heading`; `snippet` is `ts_headline` with control-character markers `HL_START`/`HL_END` (`\u0001`/`\u0002`, `:52`). With `group=1` hits collapse to the best passage per source with `more` = number of other matching passages, and up to 8 bibliographic references are appended (`searchReferences`, `:98`, `ilike` + trigram on title/cite key/DOI/journal/authors; not embedded).
- `quickSearch` (`index.ts:109`): title `ilike` + trigram similarity, prefix matches first; empty query returns recently opened pages.
- `findDuplicates` (`index.ts:115`): pairs of pages having two chunks with cosine similarity ≥ threshold (default 0.93), top 50.
- `indexHealth` / `indexStats` (`index.ts:131,144`): pending pages (never indexed or changed > 90 s after last indexing), files awaiting indexing, failed `index-source` jobs of the last 7 days read from `pgboss.job`, queued count, whether embeddings are configured.

### SearchPage **[UI]** (`src/components/search/SearchPage.tsx:39`, route `/search`)

- Request is always `mode=hybrid&limit=40&group=1` (`:47`); the only mode control is the switch "Search by meaning" (`semantic=1|0`, `:70`). No keyword/semantic/hybrid selector.
- Filters (`:64-74`), stored in `localStorage["note-search-filters"]`: Type (Pages, Database entries, Files, References), Space (All, Notes, Documents, Projects, Research, Databases), Last changed (Any, 7 d, 30 d, year, Custom with From/To), "Include archived pages", Reset. Absent: tag, database/property, sort order, title-only.
- Results: one card per best passage of a source — icon, title, `› heading`, snippet with `<mark>` highlights (server markers, client fallback, `:25-32`), kind badge, section, relative date, "archived", "by meaning" (semantic-only hit), "+N more passages" (display only, cannot be expanded).
- Deep link to the block: `/p/<pageId>?hl=<terms>#block-<blockId>` (`hrefOf`, `:33`; consumed in `src/components/page/PageView.tsx:51-52`).
- Tabs: Results / Index (counters, pending + failed lists, "Index pending (N)", "Rebuild everything"; polls every 8 s while open) / Duplicates (pairs with % similarity, read-only — no merge, dismiss or compare).
- Absent: pagination or load-more (hard cap 40), recent/saved searches, arrow-key navigation of results. Query is mirrored to the URL; scroll position restored on return.

---

## (e) Inbox / capture, tasks, tags, dashboard, import / export

### Capture and inbox (`src/lib/inbox/service.ts`)

- **There is no inbox table.** A capture is an ordinary `pages` row with `inbox_at` set and `capture_kind` (`schema.ts:92`); it is indexed and editable immediately and excluded from the tree until triaged (service comment `:1-4`).
- Capture payload: `{kind, text?, url?, attachmentIds?}`; kinds `note | tasks | link | photo | file | audio` (`CaptureKind`, `:13`). Behaviour (`capture`, `:18`): `link` requires an http(s) URL (from `url` or the first text line), title = host or first line, body = linked URL + note lines; `tasks` turns each line into an unchecked `taskItem` of one `taskList`; others: first line (≤120 chars) is the title, long/multi-line text becomes paragraphs; attachments become `image` or `fileBlock` nodes and are re-parented to the page. Always `section="notes"`. No URL fetching/unfurling, no OCR/transcription here (audio/photo are stored as attachments only).
- **Statuses: no status column.** State is derived: in inbox = `inbox_at is not null and archived = false and deleted_at is null` (`listInbox`, `:47`); archived = `archived = true`; trashed = `deleted_at`. `listInbox` adds `tags`, first `url`, first `image`, `openTasks` (unchecked task items) per item.
- Triage actions (`triage`, `:60`; `TriageAction`, `:58`): `keep` (file into a section, optionally under `parentId`) · `task` (creates one `tasks` row per unchecked task item, or one from the title; the note stays, linked by `tasks.page_id`) · `database` (creates a row in the chosen database with the page's title and content, archives the capture) · `reference` (finds a DOI in title/text → `addByDoi` (Crossref), else a plain reference with the first URL; archives the capture) · `archive` · `trash`. Every action clears `inbox_at` and writes an `inbox_actions` journal row (`schema.ts:148`: `before` page state + `created` ids).
- Undo (`undoTriage`, `:92`): restores `inbox_at`, `archived`, `section`, `parentId`; soft-deletes created tasks, deletes the created row and reference; idempotent via `undoneAt`. Journal rows are purged after 90 days (`src/worker/handlers/maintenance.ts:15`).
- "File into an existing page" (append the capture to another page / merge): **absent** — `keep` only re-parents. "Convert to page" is implicit (it already is one).
- **AI suggestion in the inbox service or routes: absent** (no suggested destination, tags, title or action in `service.ts`, `/api/inbox*`, `/api/capture`). Related but separate: the agents subsystem has an `inbox_triage` proposal kind that applies `triage()` + tags after human approval (`src/lib/agents/apply.ts:82-90`); that code is outside this part and was only skimmed.

**Inbox UI [UI]** — `InboxView` (`src/components/inbox/InboxView.tsx:21`, route `/inbox`): rows show kind icon (`KIND`, `:14`), title, excerpt, age, "N to do", link host, `#tags`, thumbnail; a row opens the page. Actions: "File in a space" (notes / documents / projects / research), "Turn into a task" / "Create N tasks", "Add to a database", "Save as a reference", tag editor (`PUT /api/pages/[id]/tags`), Archive, "Move to trash"; every triage toast carries Undo (`POST /api/inbox/undo`, `:33`); tag edits have no undo. The API's `parentId` (file under a page), `dueAt` and `priority` of the `task` action are never sent by this UI. Absent: AI-suggested destination / tags / title, bulk selection, filter by kind, pagination. The capture form is `src/components/shell/CaptureSheet.tsx` (outside the listed directories, **not audited**). `ArchiveView` (`src/components/inbox/ArchiveView.tsx:12`, route `/archive`) lists archived pages (`GET /api/pages?view=archived&limit=100`) with Restore + undo only.

**Trash UI [UI]** — `TrashView` (`src/components/trash/TrashView.tsx:17`): trashed pages only (`GET /api/pages?view=trash&limit=100`); restore one (`POST /api/pages/[id]?action=restore`), purge one (`DELETE /api/pages/[id]?purge=1`), empty trash (`DELETE /api/trash`), purge older than 30 days (`POST /api/trash`); the three destructive calls are wrapped in `withFreshAuth` on the client (those routes are outside this part; their server-side step-up was not verified here). Deleted database rows appear as their row pages; deleted tasks have no trash UI.

### Tasks

- **Tasks are rows of the `tasks` table** (`schema.ts:142`), not derived from documents: `id, workspaceId, pageId (nullable, on delete set null), title, status default "todo", priority default "medium", dueAt, completedAt, project (free text), createdAt, updatedAt, deletedAt`. Index only on `dueAt`.
- **No link to `taskItem` nodes**: checking a to-do in a document does not touch `tasks`, and completing a task does not check a box. The only bridge is one-shot: inbox triage `task` copies unchecked task items into task rows (`inbox/service.ts:70-72`).
- Absent fields: description/notes, sub-tasks, recurrence, reminders, assignee, labels/tags, ordering/position, start date, estimate, block anchor (only `pageId`).
- Status vocabulary differs by path: `/api/tasks` accepts `todo | done` (`tasks/route.ts:26`); the research module uses `todo | doing | done` on the same table (`src/lib/research/tasks.ts:7`); priority `low | medium | high`.
- API: section (a). Other writers: research tasks (`src/lib/research/tasks.ts`), agents (`agents/apply.ts:107`).

**TasksInbox UI [UI]** (`src/components/tasks/TasksInbox.tsx:80`, route `/tasks`): groups Overdue / Today / This week / Later / No date / Done (`GROUPS` `:18`, `groupOf` `:24`); filters Project and Priority (client-side on the loaded ≤500 tasks, `:89`) and "Show done" (`?done=1`); toggle = optimistic `PATCH /api/tasks {id, status}` (`:68,103-104`); inline edit of title, due (datetime-local), priority, project, linked page (picker over `/api/tree`); delete without confirmation or undo (`:106`). Quick-add line parsed live by `parseTaskInput`. Absent: sub-tasks, recurrence, reminders, drag ordering, bulk actions, board/calendar view, text search.

**`parse.ts`** (`src/components/tasks/parse.ts:13`, client-only natural-language quick add; English keywords only): priority `!high|!medium|!med|!low` (`:17`), `!`/`!!`/`!!!` (`:18`), `p1|p2|p3` (`:19`); one `#project` (`:21`); time `5pm`, `at 5:30pm` (`:24`), `at 17` (`:25`); relative dates `today|tonight` (18:00), `tomorrow|tmr|tmrw`, `[in] N day(s)|week(s)|month(s)`, `next <weekday>`, `next week`, `next month`, `[this] weekend`, `end of [the] week|month`, bare weekday (`:27-35`); absolute `nov 15[, 2026]`, `15 nov`, `YYYY-MM-DD`, `M/D[/Y]` (`:37-40`); default time 17:00. Output `{title, dueAt, priority, project}`. Absent: `@mentions`, several tags, recurrence, "in 2 hours", French keywords.

### Tags

- Model: `tags` (`schema.ts:137`: `id, workspaceId, name, color default "gray", createdAt`, unique `(workspaceId, name)`) + `page_tags` (`schema.ts:141`: `(pageId, tagId)` PK). Flat (no hierarchy), page-level only (no block tags, no inline `#tag` extraction from text — `extractPageRefs` does not look at hashtags), names normalised to lowercase, `#` stripped, ≤40 chars, ≤20 per page (`setPageTags`, `inbox/service.ts:109-116`). No rename, merge, delete or colour-edit endpoint (`/api/tags` is GET only). Tags are never deleted when unused.
- **`GET /api/tags` "counts 0 pages" — cause: `src/lib/inbox/service.ts:107`.**
  ```ts
  db.select({ id: schema.tags.id, name: schema.tags.name, color: schema.tags.color,
    pages: dsql<number>`(select count(*)::int from page_tags pt join pages p on p.id = pt.page_id
                         where pt.tag_id = ${schema.tags.id} and p.deleted_at is null)` })
    .from(schema.tags).where(eq(schema.tags.workspaceId, wsId)).orderBy(schema.tags.name);
  ```
  The select has a single table and no join. In that case drizzle-orm renders column references **inside the selected fields** without the table qualifier (the single-table branch of the pg dialect's `buildSelection` replaces each column chunk of an `sql` field by its bare identifier). `${schema.tags.id}` therefore becomes `"id"`, and the sub-select reads `… where pt.tag_id = "id" …`. Inside the sub-select, an unqualified `id` binds to the nearest scope that has such a column: `pages p` (`page_tags` has no `id`). The predicate is effectively `pt.tag_id = p.id`, which is never true, so every tag reports `pages: 0`. The query raises no error.
  Supporting evidence in the same codebase: `listDatabases` (`src/lib/databases/service.ts:34`) uses the same correlated-count pattern but its select has an `innerJoin`, so columns stay qualified and `rowCount` works.
  Status: **confirmed by reading; not executed** (no `node_modules`, no database in this copy). The rendering rule is drizzle-orm's documented single-table behaviour, stated here from knowledge of the library rather than from the installed source. A one-line check on a node settles it: run the query with `.toSQL()` and look for `pt.tag_id = "id"`. Fix direction: write the outer reference as literal SQL (`"tags"."id"`), or compute counts with a `leftJoin` + `groupBy`.
  Blast radius: `GET /api/tags` only. `/api/sync` also calls `listTags` but keeps only `name` and `color` (`src/app/api/sync/route.ts:41`). No test covers `listTags` (no match for `listTags` or `/api/tags` under `tests/`).

### Dashboard

- Widgets — exact enum `WIDGET_TYPES` (`src/components/dashboard/types.ts:2`): `quick_capture, recent_pages, pinned, tasks_due, active_projects, research_activity, recently_modified, ai_summary, graph_highlights, ai_chat, usage`. Sizes `half | wide | third`. Default layout `DEFAULT_WIDGETS` (`types.ts:6`) = all of them except `ai_chat`.
- Layout persistence: `dashboard_layouts` (`schema.ts:253`), one default row per user, `widgets` JSON; `PUT /api/dashboard` saves or resets.
- `GET /api/dashboard` (`dashboard/route.ts:21`): 15 parallel queries + 5 sequential ones. Data: recent (by `greatest(last_opened_at, updated_at)`), pinned, recently modified, tasks due within 7 days incl. overdue (≤30), active projects (section `projects`, or research pages whose `properties.status` ∈ `PROJECT_STATUSES`, `:10`), research pages/experiments/counts, graph highlights (top 6 pages by degree over accepted `knowledge_edges`, pending-suggestion count, accepted edge count), AI usage today vs `settings["ai.daily_budget_usd"]` (default 20), stored summary, pages edited this week.
- Summary route: `POST /api/dashboard/summary` (`dashboard/summary/route.ts:16`) — **weekly** digest: up to 40 pages edited in the last 7 days (title + first 400 chars) and up to 40 open tasks, one model call (`route({task:"chat"})`, `maxTokens 1200`, prompt `SYSTEM` `:10` asks for 120–220 words of Markdown), stored in `settings["dashboard.summary"]` (one value for the whole instance, overwritten each time, no history). Manual trigger only; not scheduled.
- Absent: daily brief, knowledge-health widget, timeline / event-journal widget, inbox widget, per-widget data endpoints (one monolithic GET).

**Dashboard UI [UI]** (`src/components/dashboard/Dashboard.tsx:43`, `widgets.tsx:151` `WIDGET_COMPONENTS`): `quick_capture` (title + Markdown → `POST /api/pages`, or "Ask AI instead"; note it creates a normal page, not an inbox capture), `recent_pages`, `pinned`, `tasks_due` (first 10, inline complete), `active_projects`, `research_activity` (3 counters + lists), `recently_modified` (+ "N pages edited this week"), `ai_summary` (Markdown + model/cost, "Summarize my week" / Refresh), `graph_highlights` (`PageGraphCard` of the top page + top 5 + pending suggestions), `ai_chat` (embedded chat), `usage` (spend vs budget). "Customize" mode: drag reorder (`@dnd-kit`), resize third/half/wide, remove, add (duplicates allowed), reset; saved with `PUT /api/dashboard`. The per-widget `config` field is stored but read by no widget.

### Import / export

Reported from the delegated read of `src/lib/import/**`, `src/lib/export/**`, both routes and `src/worker/handlers/import.ts` (**[delegated]**).

**Formats**

| Format | Export | Import |
|---|---|---|
| Markdown | **yes** — one page with YAML front-matter (`pageMarkdown`, `src/lib/export/markdown.ts:45`; converter `toMarkdown`, `src/lib/editor/text.ts:34`). A subtree as Markdown only inside the ZIP | **yes** — `.md/.markdown/.txt`, `marked` lexer (`src/lib/editor/markdown-client.ts:57`) + hand-written front-matter parser (`src/lib/import/markdown.ts:23`) |
| ZIP | **yes** — Markdown tree + one CSV per database + `attachments/` + `references.bib` + `workspace.json` + `export-report.json` (`buildZip`, `src/lib/export/zip.ts:41`) | **yes** — `jszip` after an own central-directory check (`importZip`, `src/lib/import/zip.ts:103`) |
| JSON | **yes** — full backup of 15 tables, format `"note-spboucher-ai/1"` (`workspaceJson`, `src/lib/export/json.ts:8`); attachment *files* not included | **only the app's own backup** (`restoreJson`, `src/lib/import/restore.ts:51`) |
| CSV | **yes** — one database (`databaseCsv`, `src/lib/export/csv.ts:17`; plus the per-view export in section (b)) | **yes** — a CSV file becomes a **new** database with type inference (`src/lib/import/csv.ts`); CSV into an existing database is the route in section (b) |
| BibTeX | **yes** (`bibFile`, `src/lib/research/bibtex.ts:140`) | **yes** — `bibtex-parse-js` → `references` rows (`src/lib/import/bibtex.ts:33`) |
| HTML | **yes, as a print view of one page** (`docToHtml` / `printHtml`, `src/lib/export/html.ts:14,92`) | **absent** |
| PDF | **absent as a generated file** — `format=pdf` returns the same HTML page; the browser prints it (`src/app/api/export/route.ts:75-84`, `window.print()` in `html.ts:98,101`) | **yes** — text layer only via `pdf-parse`, no OCR (`src/lib/import/pdf.ts:11`): one page with a file block and "Page N" headings |
| DOCX | **absent** | **yes** — `mammoth` → HTML → `turndown` → Markdown (`src/lib/import/docx.ts:9,13,29`) |
| **LaTeX** | **absent** — no `.tex` export; LaTeX exists only as math source inside Markdown (`$…$`, `$$…$$`) and as KaTeX input | absent |
| Notion | absent | **only the "Markdown & CSV" ZIP** — detected by the 32-hex id suffix in names (`NOTION_ID`, `isNotionExport`, `src/lib/import/zip.ts:20,26`); Notion HTML export and API: absent |
| Obsidian | absent | **only a vault as ZIP** — `.obsidian` folder detected and ignored (`zip.ts:28,64`); `[[wikilinks]]` handled; `![[embeds]]`, inline `#tags`, callouts, block references: absent |
| `.doc`, ENEX, OPML, Roam/Logseq, EPUB, RTF, XLSX | absent | absent (`.doc` refused explicitly, `src/lib/import/validate.ts:132`) |

**Export details**

- Scopes: single page (md, html/pdf), subtree (zip, bib), workspace (zip, json, bib), database (csv). Subtree as JSON: absent.
- ZIP contents: pages as `<path>/<slug>.md`, row pages under their database folder, `<slug>.csv` per database, all attachments of the set, `references.bib`, `workspace.json` manifest (pages without content, databases with properties / views / rows, attachments, references, experiments, tasks, tags — `zip.ts:80-92`), `export-report.json` (`ExportReport`, `zip.ts:21-32`: counts, `complete`, `notIncluded[]`, `unresolved`, `byDesign[]`). Not in a ZIP by design: page versions, knowledge-graph edges, links table, search data, trashed pages (`BY_DESIGN`, `zip.ts:33-39`). Cap 500 MB (`ZIP_MAX_BYTES`, `zip.ts:18`).
- JSON backup arrays: `pages` (trashed included), `pageVersions`, `databases`, `databaseProperties`, `databaseRows`, `databaseViews`, `relations`, `attachments` (rows only), `tags`, `pageTags`, `tasks`, `links`, `knowledgeEdges`, `references`, `experiments` (`json.ts:21-36`). Not included: attachment files, chunks/embeddings, AI conversations, usage, audit log, sessions, passkeys. No size cap.
- Markdown conversion handles: paragraph, heading, blockquote, codeBlock, bullet / ordered / task lists, table, horizontalRule, image, fileBlock, youtube, blockMath, callout (`> [!KIND]`), details (raw `<details>`), aiBlock (`> [!AI]`), footnote; marks bold, italic, code, strike, link, highlight (`==…==`); mention → `[[label]]`; inline math → `$…$` (`text.ts:37-61`). Lost: underline / subscript / superscript marks, block ids, ordered-list start, image title, table spans, no escaping of Markdown characters. The HTML export keeps underline/sub/sup and table spans (`html.ts:17-44`).

**Import details**

- Markdown mapping: front-matter (`title, icon, tags, properties, created, updated, section`; other keys become page properties; `id, type, database, cover` ignored — `import/markdown.ts:155-164`); Notion header lines; **wikilinks `[[Target]]`, `[[Target|Alias]]`, `[[Target#anchor]]` → `mention` nodes when the title or archive path resolves, else plain text** (`WIKI_RE`, `markdown.ts:58,76,97`); relative links → `/p/<id>` or `/api/files/<id>`; images resolved inside a ZIP; GFM task lists and tables; `$…$` / `$$…$$` / ```` ```math ```` → math nodes. Tags go to `properties.tags` — **the `tags` / `page_tags` tables are not written by the importer**, and inline `#hashtags` are not parsed. Not parsed back: highlight, callouts, `<details>`, footnotes; headings deeper than 3 become level 3 (`markdown-client.ts:34`).
- Validation (`src/lib/import/validate.ts`): per-kind size caps (markdown 20 MB, csv 100, bibtex 20, docx 100, pdf 200, json 500, zip 500, `:24`); magic-byte sniffing vs declared kind; ZIP checks on the central directory before inflation — ≤ 20 000 entries, ≤ 2 GB uncompressed, ≤ 250 MB per entry, ratio ≤ 150 above 50 MB (`zip_bomb`), unsafe paths (absolute, drive letter, `..`, NUL, > 1024 chars) refuse the whole archive, encrypted and ZIP64 refused, symlinks skipped (`validateZip`, `:102-118`); a counting stream guards each member at read time (`readEntry`, `src/lib/import/zip.ts:39-48`). Row / column / page count limits: absent. Schema validation of backup rows: absent.
- Preview (`previewImport`, `src/lib/import/preview.ts:35`): dry run returning `{kind, detected, filename, size, counts, countsAll, tree[≤400], treeTruncated, duplicates{total, pages[], databases[], references[]}, warnings[], modes{skip, import}}`. Duplicate rules: pages by title + normalised text, databases by name + row count, DOCX/PDF by sha256, references by DOI then cite key, backup pages by id.
- **Job flow**: route → validate → stage the upload at `$DATA_DIR/imports/<jobId>-<name>` (`stageFile`, `src/lib/import/job.ts:27-32`) → job record. **There is no import-jobs table**: the record is a `settings` row keyed `import.<jobId>` (`importKey`, `src/lib/import/pages.ts:190`), with a per-item ledger in the same table under `import.<jobId>.i.<hash>` (`openLedger`, `pages.ts:43-57`) so a retry does not recreate items. Small files run inline; otherwise queue `import-file` (1 retry after 30 s, 3600 s expiry, dead-letter — `src/lib/jobs/queues.ts:15`) → `handleImport` (`src/worker/handlers/import.ts:19`) → `executeJob` (`job.ts:61`: run id, 30 s heartbeat, progress writes throttled to 500 ms, cancellation check) → `runImport` (`src/lib/import/index.ts:19`) → writers in `src/lib/import/pages.ts` (`createPage :113`, `updatePage :125`, `createDatabase :140`, `addRow :155`, `createAttachment :163`). Statuses (`ImportStatus`, `pages.ts:180`): `preview → queued → running → done | error | cancelled`; `stalled` is derived (no progress for 10 min). No transaction around a run. The importer has **its own copy of link maintenance** (`afterContentChange`, `pages.ts:98-110`) rather than calling `src/lib/pages/service.ts`. Staged files are purged after 24 h (previews), 7 days (finished/failed), 14 days (others) (`purgeStaleImports`, `job.ts:44-54`).
- **Restore** (`src/lib/import/restore.ts`): from the JSON backup only; 15 tables in dependency order (`RESTORE_TABLES`, `:43`), batches of 200; **additive, never deletes**; **ids kept, no remapping** (only `workspaceId` rewritten). Mode `skip` = `onConflictDoNothing` (adds missing rows); mode `import` = `onConflictDoUpdate` on `id` (overwrites existing rows — the path that needs step-up). Attachment files are not restored; a `reindex-all` job is queued afterwards (`:81`). A ZIP export is re-imported as a plain Markdown archive with new ids — `workspace.json` is ignored (`zip.ts:27,85`), so views, property types and options, relations, tasks and row ids do not come back from a ZIP.

---

## (f) Gap list

Status: **exists** / **partial** / **absent**, with the evidence.

| Capability | Status | Evidence |
|---|---|---|
| Typed graph relations (supports, contradicts, cites, part-of…) | **absent** | `links.kind` only ever `"link"` / `"ai"` (`src/lib/pages/service.ts:106`, `src/lib/graph/service.ts:118`); `knowledge_edges.kind` only `"link"` / `"ai_suggested"` written (`pages/service.ts:107`, `graph/suggest.ts:60`); `concept`, `relation`, `backlink` exist only in the comment `src/db/schema.ts:161`. Database relations carry a property *name* (`sub`), not a semantic type |
| Temporal graph relations (valid-from/to, event time) | **absent** | `knowledge_edges` has only `createdAt`, `decidedAt` (`schema.ts:163`); `links` only `createdAt` (`:156`) |
| Graph view — global | **exists** | `GET /api/graph` without `pageId`; `GraphExplorer.tsx:30` |
| Graph view — local (page neighbourhood) | **exists** | `pageId` + `depth` ≤ 4 server (`graph/route.ts:10`), 1–3 in UI (`GraphExplorer.tsx:66`); `PageGraphCard` depth 1 |
| Graph view — project | **partial** | only the Section filter value `projects` (`GraphExplorer.tsx:19,64`); no project entity or project-scoped graph |
| Graph view — chronological | **absent** | only "Edited within" presets filtering nodes by `updated_at` (`GraphExplorer.tsx:20`, `graph/service.ts:47`); no time axis, slider or replay |
| Graph view — concept | **absent** | no concept/entity nodes; `NodeKind` has none (`graph/types.ts:2`); no entity extraction anywhere in `src/lib/graph` |
| Graph view — document | **partial** | node-kind chips (page / database / research / row / attachment) and Section `documents`; no dedicated view |
| Graph view — reference | **absent** | bibliographic `references` are not graph nodes (`buildGraph` reads pages, attachments, tags only, `graph/service.ts:49,78,82`) |
| Graph intelligence — central concepts | **partial** | degree only: node radius (`GraphCanvas.tsx:24`), dashboard top 6 by degree (`src/app/api/dashboard/route.ts:44`). No PageRank/betweenness, and nodes are pages, not concepts |
| Graph intelligence — orphans | **partial** | `hideOrphans` (`graph/service.ts:88`), count "N without any link" (`BacklinksExplorer.tsx:43,82`); no orphan list, filter or remediation |
| Graph intelligence — contradictions | **absent** | no code in `src/lib/graph/**`; the word appears only in chat/agent prompts (`src/lib/ai/prompts.ts`, outside this part, not read) |
| Graph intelligence — clusters / communities | **absent** | no match for cluster / community / louvain in `src/` |
| Graph intelligence — open questions | **absent** | not in graph or dashboard code; phrase appears only in `src/lib/agents/definitions.ts` and AI prompts (outside this part, not read) |
| Unlinked mentions | **exists** | `unlinkedMentions` (`graph/backlinks.ts:37`), exact-title match only |
| AI link suggestions with rationale, confidence, provenance, undo | **exists** | `graph/suggest.ts`, `graph/service.ts:114-133`, `SuggestionList.tsx` |
| Database view — table | **exists** | `views/TableView.tsx` |
| Database view — board | **exists** | `views/BoardView.tsx` (no in-column ordering) |
| Database view — calendar | **partial** | `views/CalendarView.tsx`: month only, no drag, no multi-day |
| Database view — timeline | **partial** | `views/TimelineView.tsx`: read-only bars, no drag/resize |
| Database view — gallery | **exists** | `views/GalleryView.tsx` |
| Database view — list | **exists** | `views/ListView.tsx` |
| Rollups | **partial** | `rollup()` (`src/lib/databases/query.ts:51`), 8 aggregates; cannot roll up a target relation / rollup / formula (`:56`); computed in JS on every read |
| Formulas | **exists** | `src/lib/databases/formula.ts` (≈45 functions); evaluated in JS per row per read; not sortable/filterable in SQL |
| Grouping | **partial** | client-side only (`group.ts:4`), one level, select/status/checkbox only, on ≤500 loaded rows; no server grouping or aggregates |
| Bulk actions | **partial** | API: batch create / update / delete / restore / AI (`rows/route.ts`, `ai/route.ts`); UI: multi-select + bulk delete in the table grid only (`TableView.tsx:77`); no bulk edit |
| Undo (databases) | **partial** | row deletion (`rows/restore/route.ts`) and board move (`BoardView.tsx:49`) only |
| AI database properties | **partial** | type `ai` + worker (`src/worker/handlers/ai-property.ts`); manual, one cell at a time in the UI, never recomputed automatically, no staleness, no structured output (text only), no retry button on an errored cell (`cells/Cell.tsx:80-81`) |
| Knowledge timeline / event journal | **absent** | no event table for knowledge changes. Nearest: `page_versions` (page history, `schema.ts:94`), `audit_logs` (security/ops audit, `schema.ts:247`), `inbox_actions` (triage undo journal, `schema.ts:148`), `pages.rev` change sequence for sync (`schema.ts:91`) |
| Knowledge health dashboard | **absent** | nearest pieces are scattered: index health (`indexHealth`, `src/lib/search/index.ts:131`, Search → Index tab), duplicates (`findDuplicates`, `:115`), orphan count (`BacklinksExplorer.tsx:43`), unlinked mentions. No stale-page, broken-link, untagged or contradiction metrics; no single screen |
| Daily brief | **absent** | only the manual weekly digest `POST /api/dashboard/summary` (`dashboard/summary/route.ts:16`), single stored value, not scheduled |
| Smart inbox AI suggestions | **absent** in inbox service, routes and `InboxView` | `src/lib/inbox/service.ts` has no model call. A separate agent proposal kind `inbox_triage` exists (`src/lib/agents/apply.ts:82-90`) — approval-based batch flow, not inline suggestions on inbox items (agents code is outside this part, skimmed only) |
| Semantic zoom | **absent** | only label visibility by zoom threshold (`GraphCanvas.tsx:68`); no aggregation or level of detail |
| Living / query blocks (database or query embedded in a page) | **absent** | custom editor nodes are `callout, aiBlock, fileBlock, footnoteRef, footnote` (`src/components/editor/extensions/nodes.ts:7-35`); slash "New database" creates a sub-page (`slash.tsx:61`); `DatabaseView` is mounted only by `PageView.tsx:114` for pages of type database. No linked view of a database, no saved-query block, no transclusion |
| Tag management (rename / merge / delete / hierarchy / counts) | **absent / broken** | `/api/tags` GET only; count always 0 (D1) |
| Task ↔ document to-do synchronisation | **absent** | `tasks` table is independent of `taskItem` nodes; one-shot copy at inbox triage only (`inbox/service.ts:70-72`) |
| Search: stemming / language awareness | **absent** | `'simple'` config (`schema.ts:85,178`; `search/index.ts:73`) |
| Search: database row *values* searchable | **absent** | `handleIndex` indexes pages and attachments only (`src/worker/handlers/index-source.ts:18`) |
| LaTeX export | **absent** | no `.tex` writer in `src/lib/export/**`; `FORMATS` (`src/app/api/export/route.ts:25`) has no such value |
| PDF export (server-generated) | **absent** | `format=pdf` returns `text/html` (`export/route.ts:75-84`) |
| DOCX export | **absent** | `mammoth` is import-only |
| HTML import | **absent** | not in `KINDS` (`src/lib/import/validate.ts:17`) |
| Lossless ZIP round-trip of databases | **absent** | `workspace.json` ignored on import (`src/lib/import/zip.ts:27,85`); types re-inferred from CSV |
| Full backup / restore | **partial** | JSON backup + additive restore; attachment files excluded from the JSON, no transaction, no row validation (`src/lib/import/restore.ts`) |

---

## (g) Confirmed defects

All confirmed by reading the cited lines; none was executed. "(UI)" items come from the delegated component read.

### Server

- **D1 — `GET /api/tags` always returns `pages: 0`.** `src/lib/inbox/service.ts:107`. Correlated sub-select written with `${schema.tags.id}` inside a single-table drizzle select; the column is rendered unqualified and binds to `pages.id` inside the sub-select. Full analysis in section (e) → Tags. Not executed.
- **D2 — bare `uuid.parse()` turns bad input into HTTP 500 instead of 400.** `ZodError` is not an `HttpError`, so `jsonError` (`src/lib/auth/guard.ts:51`) answers 500 "Internal error". Sites: `src/app/api/databases/[id]/rows/route.ts:30` (DELETE `id`/`ids`), `src/app/api/databases/[id]/properties/route.ts:20` (DELETE `id`, also when missing), `src/app/api/databases/[id]/views/route.ts:9` (DELETE `id`), `src/app/api/tasks/route.ts:41` (DELETE `id`), `src/app/api/inbox/[id]/route.ts:13` (path id). Same pattern just outside this part: `src/app/api/pages/[id]/tags/route.ts:5,7`.
- **D3 — `GET /api/graph` accepts a non-UUID `pageId`.** `src/app/api/graph/route.ts:13` validates with `/^[0-9a-f-]{36}$/`, which accepts e.g. 36 hyphens or a mis-grouped hex string; the value reaches `::uuid[]` casts (`src/lib/graph/service.ts:20,48`) → Postgres error → 500. (Values such as `att:<uuid>` / `tag:<uuid>` sent by the Inspector's "Neighbourhood" button on non-page nodes fail the regex and silently return the **whole graph** instead — `Inspector.tsx:33`, `GraphExplorer.tsx:74`.) Also `depth` can never be 0: `Number(…) || 1` (`route.ts:10`).
- **D4 — CSV import without a header row → 500.** `src/lib/databases/csv.ts:17` throws a plain `Error`. A non-multipart body also → 500 (`req.formData()` rejection, `src/app/api/databases/[id]/import/route.ts:6`).
- **D5 — the database query engine loads and hydrates the whole database on every request.** `src/lib/databases/query.ts:132-137`: no LIMIT in `loadRaw` (`:11-13`); relations, rollups and formulas computed for every row; filter (unless fully pushable), search, sort and pagination in JS. `limit`/`offset` only slice the result. Every grid load, CSV export, and each keystroke of the search box and filter inputs pays this (UI sends one request per keystroke: `Toolbar.tsx:105,126`, `FilterBuilder.tsx:68`).
- **D6 — per-row write loops (N+1), no transaction.**
  - `createRow` (`src/lib/databases/service.ts:142-151`) runs `ensureDatabase` + `loadProps` + position `max()` + `createPage` (itself a `max()` query, insert, link sync, index enqueue) + insert + `getRows` (full hydrate) per row; called in a loop by `POST rows {rows}` (`rows/route.ts:16`, ≤500) and by `importCsv` (`csv.ts:31-35`, unbounded row count within 20 MB) **inside the HTTP request**. A failure midway leaves a partial import.
  - `PATCH rows {updates}` (`rows/route.ts:24`): same per-row cost, ≤500.
  - `reorderRows` / `reorderProperties` (`service.ts:164-167`, `:102-105`): one UPDATE per id (≤5000 for rows).
  - `convertValues` (`service.ts:107-118`): one UPDATE per row on a type change.
  - `deleteRows` (`service.ts:173`): `softDeletePage` per row, errors swallowed (`.catch(() => {})`) — a row can end up deleted while its page is not.
  - `rows/restore` (`rows/restore/route.ts:22`): `restorePage` per row.
  - `duplicateDatabase` with rows (`service.ts:221-225`): `createPage` + insert per row.
- **D7 — partial row reorder corrupts ordering.** `reorderRows` assigns `position = i + 1` to the ids it receives and leaves the others untouched (`service.ts:166`); the table sends only loaded / filtered ids (`TableView.tsx:62,72` — reorder is allowed while a filter is active or when the database has more than 500 rows), so reordered rows collide with the positions of rows that were not sent.
- **D8 — AI cell can stay "pending" forever.** `enqueueAi` writes `{pending:true}` then calls `enqueue` and ignores its result (`service.ts:184-185`); `enqueue` returns `null` when the queue is unreachable or the job is de-duplicated (`src/lib/jobs/index.ts:25-27`). The route still answers `queued: n` (`ai/route.ts:8`). Nothing clears a stale pending marker, and the UI polls every 2.5 s while one exists (`hooks.ts:49`). Related (UI): an errored AI cell offers neither Generate nor Regenerate (`cells/Cell.tsx:80-81` with `isEmpty` treating `{error}` as empty, `values.ts:9`).
- **D9 — rollups over computed or relation target properties are always empty.** `query.ts:56` reads `t.values[tp.id]` from raw target rows (`:31`), but relation, rollup and formula values are never stored in `values`. The UI excludes those target types from the picker (`PropertyEditor.tsx:104`), the API does not.
- **D10 — filter rules are not validated.** `query/route.ts:5`: `op` is any string; an unknown operator or unknown property matches every row (`query.ts:70,95`), so a typo silently disables a filter. In a group carrying both `and` and `or`, `and` is ignored (`query.ts:100-101`; `sqlFilter` `:105` likewise).
- **D11 — CSV export silently truncates at 1000 rows.** `src/app/api/databases/[id]/route.ts:10`, `query/route.ts:16`.
- **D12 — `decideSuggestion` does not check the edge kind.** `src/lib/graph/service.ts:115` selects by id + workspace only (unlike `revertSuggestion`, `:128`); a PATCH with the id of a `kind="link"` mirror edge flips its status and inserts or deletes a `links(kind="ai")` row.
- **D13 — unlinked-mention search is an unindexed self-join.** `src/lib/graph/backlinks.ts:39-46`: `pages × pages` with `strpos(lower(plain_text), lower(title))`, executed on every `GET /api/graph/backlinks` together with `backlinkStats` (three correlated sub-selects per page, `:16-19`), with no pagination; the `LIMIT 400` applies after the join. Dismissals live in one JSON array in `settings`, read-modify-written without a lock (`:29-33`) — concurrent dismissals can lose entries. Matching is plain substring (a short title matches inside longer words).
- **D14 — `findDuplicates` is a full self-join over all chunk embeddings.** `src/lib/search/index.ts:117-120`: the `a.embedding <=> b.embedding <= x` join predicate cannot use the HNSW index, so cost grows with (number of chunks)². `threshold` is unvalidated `Number()` (`src/app/api/search/duplicates/route.ts:3`); a non-numeric value reaches SQL as NaN (resulting comparison behaviour not tested).
- **D15 — `quickSearch` and `backlinkStats` do not escape LIKE wildcards.** `src/lib/search/index.ts:111` (`"%" + q + "%"`), `src/lib/graph/backlinks.ts:14`; `%` or `_` in the query act as wildcards (the database code does escape, e.g. `query.ts:115`).
- **D16 — `pages.tsv` and its GIN index are maintained but never queried.** `schema.ts:85,93`; only `chunks.tsv` is used (`search/index.ts:73`). Write cost with no reader.
- **D17 — tasks: unknown `pageId` → 500.** `src/app/api/tasks/route.ts:21,33` insert/update `page_id` without checking that the page exists in the workspace (FK violation → 500; a page id from elsewhere would be accepted if it existed). Status vocabularies differ on the same table (`todo|done` here, `todo|doing|done` in `src/lib/research/tasks.ts:7`); `GET /api/tasks` without `done=1` returns `doing` tasks, and the UI toggle sends them to `done` or `todo`.
- **D18 — inbox triage is not transactional and "database" duplicates content.** `src/lib/inbox/service.ts:60-90`: side effects (tasks, row, reference) are created before the page update and the journal insert, with no transaction — a failure in between leaves created objects with no undo record. The `database` action copies the capture's content into a new row page and archives the original (`:75-76`), leaving two pages with the same body (both indexed, likely to surface in Duplicates).
- **D19 — link maintenance on save is not atomic.** `afterContentChange` (`src/lib/pages/service.ts:100-111`) deletes and re-inserts `links` and `knowledge_edges` in separate statements outside a transaction, after the page row is already written; a concurrent reader can see a page with no outgoing links, and a crash between statements leaves them missing until the next save.
- **D20 — relation targets are not validated.** `setRelations` (`service.ts:125-129`) inserts any existing row id regardless of `targetDatabaseId` or workspace; hydration then shows rows of another database (`query.ts:31,42`).
- **D21 — two-way relation leftovers.** Deleting the *reverse* (synced) property removes only itself (`deleteRelationPair`, `service.ts:90`); the forward property keeps `config.twoWay = true` with no counterpart. Changing a synced property's type keeps the shared relation rows (`:82` → early return at `:90`).
- **D22 — dashboard "suggested" count disagrees with the review queue.** `src/app/api/dashboard/route.ts:38` counts every `knowledge_edges.status='suggested'`; `suggestionCounts` excludes pairs already linked (`src/lib/graph/service.ts:108-109`).
- **D23 — `limit` on `GET /api/databases/[id]/rows` is not validated.** `rows/route.ts:8`: `Number("abc")` → NaN → empty result instead of 400; negative values pass `Math.min`.
- **D24 — user-supplied regex in formulas.** `test(s, regex)` builds `new RegExp()` from the expression (`formula.ts:73`) and runs server-side for every row on every read; a catastrophic pattern blocks the Node event loop. Single-owner app, so self-inflicted only.

### UI (from the delegated read; main ones)

- **U1** Desktop number cell erases the value on non-numeric input (`src/components/database/cells/Cell.tsx:58`).
- **U2** Rows beyond 500 unreachable; group counts, calendar, timeline computed on that slice (`hooks.ts:48`).
- **U3** Stale `total` after delete (`hooks.ts:52,75`); two "default" views in cache until refetch (`hooks.ts:83-84`); every view-config patch (including each column resize) refetches rows (`hooks.ts:84`).
- **U4** Filter text input: one PATCH + one row refetch per keystroke, with a possible roll-back race (`FilterBuilder.tsx:25,68`).
- **U5** Grid key handler swallows Enter on in-cell buttons (`views/TableView.tsx:68`).
- **U6** Calendar "+N more" not clickable (`views/CalendarView.tsx:85`); undated rows capped at 5 in calendar and timeline (`CalendarView.tsx:60-61`, `TimelineView.tsx:73-74`).
- **U7** Layout change resets view config to defaults (`ViewTabs.tsx:135`).
- **U8** Template list has no error state → permanent spinner on a fresh database (`TemplateChooser.tsx:18`, `DatabaseView.tsx:139`).
- **U9** Load failures displayed as empty states: Tasks "Inbox zero" (`TasksInbox.tsx:83,124`), Trash "Trash is empty" (`TrashView.tsx:20,42`), Duplicates tab (`SearchPage.tsx:54,113`); Index tab skeleton forever (`SearchPage.tsx:53,103`).
- **U10** Search hard cap 40, no pagination (`SearchPage.tsx:47`); archive and trash lists capped at 100 (`ArchiveView.tsx:14`, `TrashView.tsx:20`).
- **U11** `BacklinksExplorer` filters the whole payload client-side, no pagination (`BacklinksExplorer.tsx:37,41-42`).
- **U12** Task quick-add false positives: bare `sun|sat|mon…` and "3 days" inside a title become due dates (`src/components/tasks/parse.ts:29,35`); `at 99` accepted (`:25`); "next monday" = "monday" (`:30,35`).
- **U13** Task delete button invisible on touch, no confirmation or undo (`TasksInbox.tsx:75,106`); due date hidden below `sm` (`:74`).
- **U14** `GraphCanvas`: `onEdgeClick` never wired, pin-on-drag unreachable (`GraphCanvas.tsx:20,91,95`); `ConnectionsList` shows "No connection yet" for pages with only tag/file edges (`ConnectionsList.tsx:53,106`).

Full UI defect lists (30 database items, 47 others) were kept in the working notes `/tmp/spnote-next/c-work/database-ui.md` §12 and `/tmp/spnote-next/c-work/other-ui.md` §8.

### Import / export (from the delegated read; main ones)

- **I1** Malformed `parentId` → 500: bare `uuid.parse` (`src/app/api/import/route.ts:98`).
- **I2** Empty CSV → 500 `import_failed` flagged retryable: plain `Error` (`src/lib/import/csv.ts:38`); inside a ZIP one empty `.csv` fails the whole archive although the preview says it will be skipped (`src/lib/import/preview.ts:56` vs `zip.ts:161`).
- **I3** Restore has no row validation and no transaction (`src/lib/import/restore.ts:18-42,60-74`): malformed rows surface as raw Postgres errors; a failure at table N leaves tables 1..N-1 applied (already overwritten in `import` mode).
- **I4** Restore conflicts only on `id` (`restore.ts:30,37`): rows with a new id but an existing unique tuple (`links_unique`, `tags_unique`, `references_key_unique`, `relations_unique`, `kedges_unique`, `page_versions_unique`) abort the restore in `import` mode, and in `skip` mode a skipped tag leaves `pageTags` rows pointing at a missing tag id. Link rows get new ids on every save (`src/lib/pages/service.ts:102-106`, confirmed), so this state is normal. Outcome inferred, not executed.
- **I5** The ZIP manifest `workspace.json` carries the same `format` string as the JSON backup (`src/lib/export/zip.ts:81`, `json.ts:6`) with a different shape; uploaded as a backup it passes `checkBackupFormat` (`restore.ts:45`) and fails later in the database.
- **I6** Whole upload buffered in memory, twice (`req.formData()` + `arrayBuffer()`, `import/route.ts:94,100`; up to 500 MB); JSON backup parsed as one string for preview and again for import (`src/lib/import/index.ts:39`, `preview.ts:92`); JSON export builds one string with every table and has no size cap (`src/lib/export/json.ts:10-35`).
- **I7** `loadExportSet` loads all attachments (with `extractedText`), references, experiments, tags and tasks of the workspace for any export, including a single page (`src/lib/export/data.ts:44-55`).
- **I8** Every import and every preview loads and hashes the `plainText` of every live page for duplicate detection (`src/lib/import/pages.ts:66-67,78`).
- **I9** CSV-to-new-database import: about 8 sequential statements per row, including a `max(position)` over all siblings (quadratic) (`src/lib/import/csv.ts:58-64`, `pages.ts:113-123,155-162`); ZIP import creates then updates each page, running link maintenance and index enqueue twice (`zip.ts:132-144,175-182`).
- **I10** Decimal comma: `1,5` is stored as **15** (`src/lib/import/csv.ts:11` + `src/lib/databases/values.ts:10`); long digit strings become lossy JS numbers; a 0/1 column becomes a checkbox (`csv.ts:15-16`); duplicate headers overwrite each other (`csv.ts:48,52`); papaparse `errors` never read (`csv.ts:23`, `src/lib/databases/csv.ts:16`).
- **I11** Markdown import turns any text with two `$` on a line into inline math — "costs $5 and $10" (`src/lib/editor/markdown-client.ts:24`).
- **I12** Markdown round-trip losses: underline/sub/sup dropped on export (`src/lib/editor/text.ts:37`); highlight, callout, aiBlock, details, footnotes exported but not parsed back (`text.ts:37,57-60` vs `markdown-client.ts`); headings 4–6 → 3 (`markdown-client.ts:34`); no escaping of Markdown characters on export (`text.ts:37`); front-matter keys with accents or parentheses are exported but skipped on import (`src/lib/import/markdown.ts:30,38`).
- **I13** ZIP round-trip losses: `created` date lost for pages inside a ZIP (`zip.ts:141` + `markdown.ts:163`); row pages with the same title collide in a `Map` and all but one body are silently dropped (`zip.ts:158`); attachments not referenced in a body are dropped (`zip.ts:184-185`); attachments whose filename contains a space are written unencoded and cannot be matched by `IMG_RE` on import (`src/lib/export/data.ts:108`, `export/markdown.ts:43`, `import/markdown.ts:57`).
- **I14** Wikilinks / images inside `~~~` fences, indented code and inline code are rewritten by the importer (`import/markdown.ts:66-67,90-104`); the first `# heading` of every Markdown source is removed and leading `Key: value` lines are moved into properties (`parseNotionHeader`, `markdown.ts:45-53`).
- **I15** Encoding: "text" means "no NUL byte in the first 8192 bytes"; Latin-1 / Windows-1252 files import with replacement characters (`src/lib/import/validate.ts:58-60,140`).
- **I16** No neutralisation of CSV cells starting with `= + - @` on export (`src/lib/export/csv.ts:25-26`, `src/lib/databases/csv.ts:11`).
- **I17** Whole-workspace BibTeX export needs no step-up, unlike the other whole-workspace exports (`src/app/api/export/route.ts:27,70-74`) — observed behaviour, intent not documented. The 400 message for a bad `format` omits `html` (`:31`).
- **I18** Concurrency: two confirm requests can both start the same previewed job (no compare-and-set, `import/route.ts:83-89`); the ledger claim ignores a lost race (`src/lib/import/pages.ts:50-55`).

Full list (72 items) in the working notes `/tmp/spnote-next/c-work/import-export.md` §5.


---

# Lead-auditor sections 10–12

## 10. Worker / jobs

`src/worker/index.ts` (pg-boss 12, schema `pgboss`, pool 4; web process uses its own pg-boss client with pool 3 only to enqueue, `src/lib/jobs/index.ts`). All consumers `batchSize: 1`, wrapped by `src/worker/run.ts::wrap` (in-process timeout, one log line with numeric/id-only summary). Policies in `src/lib/jobs/queues.ts`:

| Queue (const) | Handler | Payload | Retry / expiry | What it does |
|---|---|---|---|---|
| `index-source` (`QUEUES.index`) | `handlers/index-source.ts::handleIndex` | `{sourceType: page\|attachment\|row, sourceId, workspaceId}` | 4 retries, 15 s backoff, expire 300 s | page: back-fills block ids in place if missing (no version bump), then `indexSource` (chunk + embed); deleted → `removeSource`. attachment: indexes `filename + extractedText`. **`row` is ignored** (`{ignored:true}`). Polling 2 s. |
| `reindex-all` | `handleReindexAll` | `{workspaceId}` | 1 retry, 1 h | sequential re-index of all live pages and attachments |
| `import-file` | `handlers/import.ts::handleImport` | see section 5/6 | 1 retry, 1 h | staged import job |
| `backup` | `handlers/backup.ts::handleBackup` | `{kind?, backupJobId?, dryRun?}` | 0 retry, 4 h | spawns `scripts/backup.sh` (pg_dump + uploads → AES-256 tar, sha256, prune, rsync offsite), records `backup_jobs`; fails if `BACKUP_PASSPHRASE` unset. Scheduled `30 3 * * *` America/Toronto. |
| `agent-run` | `handlers/agent.ts::handleAgentRun` | `{executionId}` | 0 retry, 900 s | `reapStale()` then `runExecution` (atomic pending→running) |
| `suggest-links` | `handlers/suggest-links.ts` | `{workspaceId, pageId?, k?, limit?}` | 0 retry, 600 s | one page (k=8) or workspace pass (k=5/page) via `src/lib/graph/suggest.ts` |
| `ai-property` | `handlers/ai-property.ts` | see section 6 | 1 retry, 300 s | computes AI database cells |
| `maintenance` | `handlers/maintenance.ts` | `{}` | 0 retry, 300 s; scheduled `17 * * * *` | deletes idempotency keys > 48 h, expired challenges, login attempts > 30 d, old enrollments, dead sessions > 90 d, inbox_actions > 90 d; marks backups "running" > 6 h as failed; deletes orphan `chunks` / `index_state` whose page/attachment row no longer exists. **Never purges the trash, never deletes attachment files, never hard-deletes soft-deleted attachments.** |
| `dead-letter` | — | — | kept 30 d | copy of jobs that exhausted retries |

Heartbeat: `settings['worker.heartbeat'] = {at, pid, version}` every 30 s. `enqueue()` swallows errors and returns null (a save succeeds even if the queue is down; the page is then simply not re-indexed until the next edit or a reindex-all).
No queue exists for: transcription, OCR, thumbnailing, daily brief, graph analytics, scheduled agents, notifications/reminders, embedding of database rows.

## 11. Tests and scratch environments

Suites (counts by `test(` occurrences, not executed by this audit):
- Unit, `pnpm test` = `tsx --test --test-force-exit --test-concurrency=1 tests/unit/*.test.ts` (node:test; needs a scratch DB — `tests/helpers/testdb.ts` throws unless the database name ends in `_dev|_test|_scratch`): `webauthn.test.ts` 15, `pages.test.ts` 9, `import-validate.test.ts` 8, `jobs.test.ts` 7, `import-bibtex-roundtrip.test.ts` 5, `import-zip-plan.test.ts` 5, `sync.test.ts` 5, `client-logic.test.ts` 4 → **58 unit tests**. `tests/helpers/softauthn.ts` = software authenticator.
- E2E, `pnpm test:e2e` (Playwright, Chromium only, 1 worker, base `E2E_BASE_URL` default `http://localhost:8481`): `auth.spec.ts` 10, `mobile.spec.ts` 12, `mobile-data.spec.ts` 3, `desktop.spec.ts` 4 → **29 specs**; projects `auth`, `phone-360` (360×740), `iphone-se` (375×667), `iphone-max` (430×932), `desktop` (1280×800) — mobile specs run 3× → 59 test runs. `global-setup.ts` wipes passkeys/sessions on the TEST db, opens a CLI enrollment window, enrolls with Chrome's virtual authenticator, saves storage state. Manual scripts: `tests/e2e/{debug,live-ai,overflow,probe,shots,shots2}.mjs`, `scripts/smoke.sh`.
- Not covered by any test (by file inventory): databases (query/formula/views), graph, search/RAG, agents, AI routes, research, export. No component tests. No test asserts `GET /api/tags` counts (the tags test at `tests/unit/pages.test.ts:90` checks names only — which is why D-1 went unnoticed). `tests/unit/sync.test.ts:38` explicitly documents that purging a parent orphans its child ("the child row is orphaned by the model, not deleted").

Scratch environments on M4M64c (git worktrees of the same repo; `git worktree list`):

| Worktree | Branch @ commit | DB | PORT / APP_URL | DATA_DIR | State on 2026-11-19 |
|---|---|---|---|---|---|
| `~/apps/note-spboucher-ai` | `main` @ 77ef5f0 | `note_spboucher` | 8480 / https://note.spboucher.ai | `~/apps/note-spboucher-ai/data` | PM2 note-web + note-worker, online |
| `~/dev/note-v2` | `v2` @ 65b3e16 (untracked `.spn-schema.mts`) | `note_dev` | 8481 / http://localhost:8481 | `~/dev/note-v2-data` (+ `~/dev/note-v2-backups`) | not listening |
| `~/dev/note-native` | `native-sync` @ 31b354d | `note_native_dev` | 8482 / http://localhost:8482 | `~/dev/note-native-data` | **still running**: `next-server` pid 31220 bound to 127.0.0.1:8482 since 2026-11-18 14:48, started by hand (not PM2) with output to `~/dev/note-native-data/web.log` and `web.pid`; no worker process seen for it |
| `~/dev/note-next` | `next` @ 77ef5f0, clean | `note_next_dev` (exists) | 8483 / http://localhost:8483 | `~/dev/note-next-data` (uploads/, backups/) | **already created today 12:30** (not by this audit); nothing listening on 8483 |

`.env` variable NAMES in the dev worktrees (identical set in note-v2 and note-native): `DATABASE_URL OPENAI_API_KEY ANTHROPIC_API_KEY BACKUP_PASSPHRASE BACKUP_KEEP_DAYS LOG_LEVEL TZ PORT APP_URL APP_VERSION DATA_DIR BACKUP_DIR BACKUP_OFFSITE` (no `NODE_ENV`, so cookies are named `note_session` / `note_wa` and are not `Secure`; `AUTH_EXTRA_ORIGINS` is honoured only when `NODE_ENV !== "production"`). Documented recipe (`docs/testing.md:14`): worktree outside `~/apps`, own `.env`, `pnpm db:migrate`, `pnpm build`, `next start -p <port>`, `tsx src/worker/index.ts`; native testing gets a session with `tsx scripts/dev-session.ts` (prints a token for the cookie). Rule in `docs/dev-conventions.md:9`: never build or start anything inside `~/apps/note-spboucher-ai`.

## 12. Defects / debt confirmed in code

Reported by the native team — all six confirmed:

- **D-1 `GET /api/tags` counts 0 pages** — `src/lib/inbox/service.ts:107` (`listTags`). The count is a raw correlated subquery: `` dsql`(select count(*)::int from page_tags pt join pages p on p.id = pt.page_id where pt.tag_id = ${schema.tags.id} and p.deleted_at is null)` `` inside `db.select({...}).from(schema.tags)`. In a single-table Drizzle select, an interpolated column is rendered **unqualified** (`"id"`). Inside the subquery, `"id"` binds to the nearest scope — `pages p` (page_tags has no `id`) — so the predicate becomes `pt.tag_id = p.id`, never true → 0. Fix: qualify explicitly (`tags.id` as raw text / `sql.raw`) or use a join + group by. Also affects the `tags` array semantics nowhere else (`/api/sync` drops the count). Rendering rule verified in the installed library (`node_modules/.pnpm/drizzle-orm@0.45.4…/drizzle-orm/pg-core/dialect.js:142-170`, `buildSelection` with `isSingleTable = !joins || joins.length === 0`: `PgColumn` chunks inside an SQL field become a bare `sql.identifier(column)`). The query itself was not executed (production has 0 tags).
- **D-2 Purging a page leaves its attachments** — `src/lib/pages/service.ts:124-128` (`purgePage`) and `src/app/api/trash/route.ts:8-13` (`purge`) only `DELETE FROM pages`. `attachments.page_id` is `ON DELETE SET NULL` (`schema.ts:133`), so the rows survive with `page_id = null`, the bytes stay in `DATA_DIR/uploads`, the extracted text stays indexed (chunks with `source_type='attachment'` are untouched) and remains reachable by search/RAG and by `/api/files/<id>`. Nothing ever deletes an attachment row or file: grep finds no `unlink`/`rm` on uploads and no `db.delete(schema.attachments)`; the maintenance job does not do it either. Corollary: attachment tombstones can only ever be produced by a workspace cascade, i.e. never.
- **D-3 Malformed ids answer 500** — `src/lib/api.ts:72` exports `uuid = z.string().uuid()` and 21 route files call `uuid.parse(params.id)` (38 call sites, e.g. `src/app/api/pages/[id]/route.ts:8,15,24,31`, `files/[id]/route.ts:9`, `tasks/route.ts:41`). `parse` throws `ZodError`, which is not an `HttpError`; `handler` (`api.ts:32-35`) logs it and `jsonError` (`guard.ts:51`) returns `500 Internal error`. No `ZodError` handling exists anywhere (grep: 0). Second family: routes that pass the raw string to Postgres with no validation → `invalid input syntax for type uuid` → 500: `GET /api/pages?view=children:<x>` (`pages/route.ts:20`), `DELETE /api/attachments?id=` (`attachments/route.ts:38`, also crashes on a missing id), `GET /api/attachments?pageId=`. (The `src/app/api/databases/[id]/*` routes are NOT affected for the path id: `ensureDatabase` (`src/lib/databases/service.ts:17`) tests a UUID regex and answers 400; their query-string ids are — see section 6 defects D2/D3.) Fix once in `handler`: map `ZodError` → 400 and Postgres `22P02` → 400/404.
- **D-4 No cycle check on `parentId`** — `src/lib/pages/service.ts:45`: the only guard is `patch.parentId === id`. A→B then B→A is accepted; `parentId` existence/workspace is not checked on PATCH either (POST nulls an unknown parent, `pages/route.ts:30`), and the column has no FK (`schema.ts:78`). Consequences in code: `descendants()` (`service.ts:129`) is a `WITH RECURSIVE … UNION ALL` with no depth/cycle guard → **non-terminating query** on a cycle, reached by `softDeletePage`, `restorePage`, `purgePage`; `breadcrumb()` is bounded (`t.d < 20`) but returns garbage; the cycle disappears from any root-anchored tree UI.
- **D-5 `/api/files/<id>` serves a soft-deleted file** — `src/app/api/files/[id]/route.ts:10`: the lookup filters on id + workspace only, no `isNull(attachments.deletedAt)`. Combined with `cache-control: … max-age=31536000, immutable` (line 15), a deleted file also stays in every client cache for a year. (Whether to keep serving while the *page* is merely in the trash is a product decision; today the attachment's own `deleted_at` is ignored.)
- **D-6 Tasks have no change feed** — `tasks` has no `rev` column and no trigger (`drizzle/0002_native_sync.sql` touches only pages, attachments, page_tags); `/api/sync` does not return tasks; `GET /api/tasks` has no `since`/`updatedAfter` filter and hides soft-deleted rows, so a client cannot learn about a deletion; `POST /api/tasks` accepts no client id (offline creation → duplicates on retry unless `Idempotency-Key` is sent). Same gap for every other entity listed in 1.3.

Additional defects / debt found during this audit:

- **D-7 Purging a parent orphans its children instead of deleting them.** `purgePage` computes the descendant ids but only deletes their *chunks*, then deletes the single root row (`service.ts:125-127`); with no FK on `parent_id` the children stay (trashed, `parent_id` dangling, de-indexed). The unit test documents it (`tests/unit/sync.test.ts:43`). A later restore of such a child shows a top-level page whose index rows were deleted only if a re-index runs (restore does enqueue it). The API doc string says "hard delete"; the user-visible effect of "Delete forever" on a tree is partial.
- **D-8 Trash purge leaves index rows until the hourly job.** `src/app/api/trash/route.ts:11` deletes pages without deleting chunks (soft delete already removed page chunks, so this matters only for pages re-indexed while trashed); orphans are swept by `handleMaintenance` (`maintenance.ts:17`).
- **D-9 `softDeletePage` / `restorePage` do not verify the root id.** `service.ts:113-123`: `descendants()` is workspace-scoped but the root id is pushed unconditionally and the UPDATE is `WHERE id IN (...)` with no workspace filter and no existence check → `DELETE /api/pages/<unknown uuid>` answers `{ok:true, trashed:1}`; restore likewise (and restore un-trashes ALL descendants, including ones trashed separately earlier). Harmless with one workspace, wrong as an API contract.
- **D-10 `touchOpened(id)`** (`service.ts:140`) has no workspace filter (same remark).
- **D-11 The back-fill of block ids changes `content` without changing `version`** (`src/worker/handlers/index-source.ts:6`): the trigger bumps `rev`, so native clients receive a page whose content differs but whose `version` is the one they already hold; a client that then PATCHes with that `baseVersion` overwrites nothing harmful (ids are re-ensured server-side) but any client-side "same version ⇒ same content" assumption is false.
- **D-12 `knowledge_edges` has no FK to pages** (`schema.ts:160`): purged pages leave edges behind. Production shows 8 `link/accepted` edges for 1 row in `links` — consistent with stale edges (not inspected further: content was out of scope). `afterContentChange` only cleans edges whose `from_id` is the saved page.
- **D-13 Server-side document validation is structural only** (`src/lib/editor/validate.ts`): `type:"doc"`, ≤ 8 MB serialized, depth ≤ 60, ≤ 200 000 nodes, each node `type` a string ≤ 64 chars, `text` a string, `marks[].type` a string, and no `javascript:`/`vbscript:`/`data:text/html` in `attrs.href|src` or mark `href`. **There is no allow-list of node types or attrs**: any new block type passes today (good for the upgrade) — and so does any garbage (unknown nodes are stored, then dropped/crash at render depending on Tiptap's schema check on the client). `content` in the zod schemas is `z.any()`.
- **D-14 Idempotency replay is keyed by `key` only** (`src/lib/api.ts:48`): the stored `session_id` is never compared. Single owner today; a latent cross-session replay otherwise.
- **D-15 Attachment upload is fully buffered and synchronous**: `Buffer.from(await file.arrayBuffer())` for up to 200 MB plus PDF/DOCX text extraction inside the request (`attachments/route.ts:23-25`); `extractedText` for text-like files is capped at 2 000 000 chars, PDF/DOCX uncapped. No Range on download (2.4). Painful for audio/video/voice notes and annotatable PDFs.
- **D-16 MIME is taken from the client** (`file.type`), the block-list is 4 types, and `image/svg+xml` is served inline (mitigated by a per-response CSP). No sniffing.
- **D-17 Free-text enumerations**: `pages.type`, `pages.section` (PATCH accepts any string), `tasks.status`, `knowledge_edges.kind`, `database_properties.type`, `database_views.type` have no CHECK constraint; validity lives only in zod schemas of some routes.
- **D-18 Full-text search uses the `'simple'` configuration** for both `pages.tsv` and `chunks.tsv` (no stemming, no stop words, no accent folding in the generated column — `unaccent` is installed but not used in the generated expressions): French/English morphological matching relies entirely on the vector side and the title trigram index.
- **D-19 Dead columns / leftovers**: `users.password_hash` (`'!'`), `totp_secret`, `totp_enabled`, `sessions.mfa_passed`, `.gitignore.bak` committed, `knowledge_edges.kind` values `backlink|relation|concept` documented but (per sub-audit, section 5) not all produced; `handleIndex` accepts `sourceType: "row"` and ignores it (database rows are not embedded as rows).
- **D-20 Embedding dimension is compiled in** (`vector(1536)`, `schema.ts:9`; HNSW index): switching to a local embedding model with another dimension requires a migration + full re-embed; `embeddings.model/version` and `index_state.model/version` exist to detect staleness.
- **D-21 `tags` in `/api/sync` are sent whole on every call** and carry no id; tag deletion/rename does not exist at all (2.5).
- **D-22 `GET /api/pages`, `/api/attachments`, `/api/tasks` have hard caps (100 / 200 / 500) and no cursor**: fine at 7 pages, not a paging contract.
- **D-23 Trash auto-purge is client-triggered** (`POST /api/trash {action:"purge-old"}` needs a fresh passkey); nothing purges on a schedule.

---

# 13. Consolidated gap list vs the "SP Note Next Generation" brief

Status = exists / partial / absent. Detailed evidence tables are in Part A ("Gaps list for the upgrade"), Part B ("(e) Gap list") and Part C ("(f) Gap list"); this table is the single index. Where two sub-audits judged the same item, the stricter reading is kept and the nuance stated.

## 13.1 Block types (editor nodes — `src/components/editor/extensions/nodes.ts`, `Editor.tsx`)

| Item | Status | Evidence |
|---|---|---|
| Drawing | absent | no drawing node, no canvas library in `package.json` |
| Diagram / Mermaid | absent | no `mermaid` anywhere; `codeBlock` is lowlight highlighting only |
| Data / chart | absent | no chart library; only hand-written SVG in `src/components/ai/models/Scatter.tsx`, `UsagePanel.tsx` |
| Scientific citation | absent as a block (partial as a feature) | no node bound to a `references` row; citations reach a page as plain `\cite{key}` text or a Markdown quote (`src/lib/research/cite.ts:48`); only generic `footnoteRef`/`footnote` nodes; "citing pages" found by regex on `plain_text` (`src/lib/research/references.ts:224`) |
| Formula / math | exists | `inlineMath`, `blockMath` (`@tiptap/extension-mathematics` + KaTeX); edited through `window.prompt` only (`Editor.tsx:85`) |
| Annotatable PDF | absent | PDF = `fileBlock` link opened in a new tab; server text extraction only (`src/lib/files/extract.ts`); no pdf.js, no annotation model; `/api/files` has no Range support |
| File | exists | `fileBlock` atom (`nodes.ts:21-26`), upload with progress; name/size only, no preview |
| Interactive table | partial | Tiptap `table` with resizable columns; row/column ops only in `MobileToolbar.tsx:52-57`; no sort/filter/formula; a database cannot be embedded in a page |
| Enriched tasks | partial | `taskItem` has only `checked` (no id — not in the block-id list — no due date/priority); separate `tasks` table + `/tasks` screen + NL parser (`src/components/tasks/parse.ts`); the two are not synchronised (one-shot copy at inbox triage, `src/lib/inbox/service.ts:70-72`) |
| Executable code | absent | no runtime/sandbox |
| AI result | exists | `aiBlock {model, prompt, at}` (`nodes.ts:14-19`); static wrapper: no regenerate, no stored sources/cost |
| Cross-reference / transclusion | partial | page-level `mention` + backlinks + `#block-<id>` deep links; no block-reference node, no embed of a page/block, no synced blocks |

## 13.2 Canvas, graph, knowledge intelligence

| Item | Status | Evidence |
|---|---|---|
| Infinite canvas | absent | no canvas page type; `/graph` is a read-only force graph (`GraphCanvas.tsx`, react-force-graph-2d) |
| Typed graph relations | absent | only `link` and `ai_suggested` are ever written to `knowledge_edges` (`src/lib/pages/service.ts:107`, `src/lib/graph/suggest.ts:60`); `links.kind` ∈ {`link`,`ai`}; `concept|relation|backlink` exist only in the schema comment |
| Temporal graph relations | absent | edges carry `created_at`, `decided_at` only |
| Graph views: global / local | exists | `GET /api/graph` with/without `pageId` + `depth` (`GraphExplorer.tsx`, `PageGraphCard.tsx`) |
| Graph views: project / document | partial | only a Section filter value and node-kind chips |
| Graph views: chronological / concept / reference | absent | "Edited within" presets only; no concept/entity nodes (`graph/types.ts:2`); `references` are not graph nodes |
| Central concepts | partial | degree only (node radius; dashboard top 6 by degree, `src/app/api/dashboard/route.ts:44`) |
| Orphans | partial | `hideOrphans` + a count; no list or remediation |
| Contradictions | absent in graph (a chat mode `contradictions` exists in prompts) | no code in `src/lib/graph/**` |
| Clusters | absent | no clustering code |
| Open questions | absent | phrase appears only in AI prompts / agent definitions |
| Semantic zoom | absent | label-visibility threshold only (`GraphCanvas.tsx:68`); nothing in the editor |
| Living / query blocks | absent | no query node; "New database" slash item creates a sub-page |
| Knowledge timeline / event journal | absent | nearest: `page_versions`, `audit_logs`, `inbox_actions`, `pages.rev` |
| Knowledge health dashboard | absent | scattered pieces: index health and duplicates (Search tabs), orphan count, unlinked mentions |
| Daily brief | absent | on-demand weekly digest only (`src/app/api/dashboard/summary/route.ts`); the worker schedules only backup + maintenance |

## 13.3 AI

| Item | Status | Evidence |
|---|---|---|
| Ask-my-knowledge with block citations | partial | chat mode `notes`: hybrid retrieval (FTS `simple` + HNSW cosine, RRF k=60), evidence gate, server-validated `[n]` markers, `SourceRef {n, chunkId, pageId, title, icon, heading, blockId, excerpt, score, semantic, sourceType}`, chips open `/p/<id>#block-<blockId>`. Limits: anchor = first block of a ~350-token chunk, attachments have no block anchor, UI never sends `scopePageIds` |
| Contextual AI actions list | exists (static) | 21 ids in `ACTION_IDS` (`src/lib/ai/chat.ts:271`), prompts in `src/lib/ai/prompts.ts`; UI exposes 8 chips + translate + custom + 3 slash items; 8 ids without UI entry; list not adapted to block type |
| LaTeX export | absent | `FORMATS` = md, zip, json, csv, pdf (really HTML), html, bib (`src/app/api/export/route.ts:25`) |
| OpenRouter / local providers | absent | `Provider = "openai" \| "anthropic"` (`src/lib/ai/types.ts:1`); SDK clients built without `baseURL` (`providers.ts:7-8`); OpenAI path uses the **Responses API**, not Chat Completions (an OpenAI-compatible MLX/OpenRouter endpoint needs a new adapter, not just a base URL); `ai_providers` has no URL column |
| Model selector with creator logos | partial | plain `<select>`s (`Chat.tsx:148-150`, `ModelPicker.tsx`, `RoutingTable.tsx`); a coloured dot per provider; no logo asset, no creator column in `ai_models` |
| Voice notes / transcription | partial | `MediaRecorder` memo → audio attachment and browser `SpeechRecognition` dictation (`src/components/shell/CaptureSheet.tsx`); no server transcription, no audio block |
| Smart inbox AI suggestions | absent inline (partial via agent) | no model call in `src/lib/inbox/service.ts`; only the on-demand agent `sort_inbox` producing approval proposals |
| AI database properties | partial | type `ai` + `src/worker/handlers/ai-property.ts`; manual per cell, text only, never recomputed, pending can stick (C-D8) |

## 13.4 Databases

| Item | Status | Evidence |
|---|---|---|
| Views: table, board, gallery, list | exists | `src/components/database/views/{Table,Board,Gallery,List}View.tsx` |
| Views: calendar, timeline | partial | month only / read-only bars; no drag |
| Rollups | partial | 8 aggregates, computed in JS per read; empty over relation/rollup/formula targets (`query.ts:56`) |
| Formulas | exists | `src/lib/databases/formula.ts`, ≈45 functions, JS per row per read |
| Grouping | partial | client-side, one level, select/status/checkbox, on ≤ 500 loaded rows |
| Bulk actions | partial | API batches exist; UI = multi-select + delete in the table only |
| Undo | partial | row delete and board move only (inbox triage has a full undo journal) |

## 13.5 Platform

| Item | Status | Evidence |
|---|---|---|
| Full offline (IndexedDB) on web | partial (thin) | IndexedDB `note-local` v1: stores `drafts` (pending patch per page) and `outbox` (captures) only (`src/lib/client/offline.ts`); SW `note-static-v3` caches static assets, navigations are network-only with `/offline` fallback (`public/sw.js`); cannot read, open or create notes offline; no Background Sync. The web client does not use `/api/sync` at all |
| Command palette | exists | `src/components/shell/CommandPalette.tsx` (cmdk): 16 static commands + page/content search; no contextual commands |
| Passkey device management | exists | `/api/auth/passkeys*`, `/api/auth/sessions*`, `src/components/settings/SecuritySection.tsx` (add, rename, revoke, sessions, revoke-all, step-up) |
| Non-cookie API credential (extensions, widgets, share sheet, CLI) | absent | cookie session + forged `Origin` only (section 2.0) |
| Change feed for anything but pages/attachments | absent | section 1.3 |
| Realtime push / collaboration | absent | no websocket/SSE change channel, no Yjs; remote change detected on focus via `?head=1` |

## 13.6 Cross-cutting facts the upgrade must plan around (lead auditor's synthesis)

1. **New block types pass the server today** (structural validator only, D-13) — but **old clients destroy them**: `enableContentCheck` is not set in `Editor.tsx`, Tiptap's default is `false` (installed `@tiptap/core` dist `index.js:6588`), and on an unknown node `createNodeFromContent` logs a warning and returns an EMPTY document (`index.js:596-604`, verified in the installed 3.32.2 source). The 800 ms autosave then PATCHes that empty doc with a valid `baseVersion`. A stale browser tab or an un-updated native build opening a page that contains a new block type can wipe it (the previous state survives only if a `page_versions` snapshot was due). Ship `enableContentCheck` + `onContentError` (read-only on error) BEFORE the first new node type, and give the native apps an "unknown block" passthrough.
2. The block-id type list exists in three places (client `BlockId` plugin, server `ensureBlockIds` in `src/lib/editor/text.ts`, and the text/markdown walkers); every new block type must be added to each, and `listItem`/`taskItem` currently get no id (blocks citations and task enrichment).
3. Markdown round-trip already loses callout, aiBlock, details, footnotes, fileBlock, highlight, underline, sub/sup: Markdown cannot be the interchange format between web and native; the ProseMirror JSON is.
4. Fonts named in CSS (Inter, Source Serif 4, JetBrains Mono) are never loaded and `motion` is installed but unused: the "design system" is tokens + CSS keyframes; there is little to preserve.
5. The database engine filters/sorts/paginates in JS over the whole database and the UI caps at 500 rows; fine at 0 rows in production, a rewrite candidate before native clients depend on it.
6. Production holds 7 pages, 0 databases, 0 tags: data migration is not a constraint; API compatibility with the shipped native apps (`/api/sync` shape, cookie auth, `POST /api/pages` with client id) is.
