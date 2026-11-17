# Developer conventions — Note SPBoucher AI (v2)

Read this before touching the code. Stack: Next.js 16 (App Router, `src/proxy.ts`, React 19, TypeScript strict), Tailwind v4 (tokens in `src/app/globals.css`: `bg`, `bg-elev`, `bg-sunk`, `bg-side`, `bg-hover`, `fg`, `fg-muted`, `fg-faint`, `line`, `line-strong`, `accent`, `accent-soft`, `ai`, `ai-soft`, `danger`, `success`, `warning`), Drizzle ORM + PostgreSQL 17 + pgvector (`src/db/schema.ts`, **snake_case casing**), pg-boss worker (`src/worker`), official `openai` + `@anthropic-ai/sdk` behind `src/lib/ai`, SimpleWebAuthn 14 (`src/lib/auth`).

## Hard rules
- **Single owner.** No multi-user features, no change of data ownership.
- **Nothing private before authentication.** Every API route uses `handler()` (`src/lib/api.ts`); every page under `src/app/(app)` calls `requireUserPage()`. The only public routes are listed in `src/proxy.ts` (`PUBLIC`). `tests/e2e/auth.spec.ts` walks every `route.ts` and fails if one answers an anonymous request.
- **Schema changes = a Drizzle migration + a `.down.sql`** (`pnpm db:generate`, then review the SQL; data statements are appended by hand). Additive first; never drop or rewrite content columns. Flexible data still goes in the existing `jsonb` columns.
- **Never build or start anything in `~/apps/note-spboucher-ai` while developing** — that folder is production (port 8480). Develop in a separate worktree with its own `.env` pointing to a `*_dev` database and another port (tests refuse any database whose name does not end in `_dev`, `_test` or `_scratch`).
- **Secrets and content never reach logs.** Use `log` from `src/lib/log.ts` with ids, counts, durations and status codes only. No note text, excerpts, prompts, cookies, tokens, WebAuthn payloads, file contents.
- AI calls go through `src/lib/ai` only (router → providers); record usage with `recordUsage`; any system prompt that sees workspace content appends `INJECTION_GUARD` and wraps the content in `<workspace>` tags. Opening a page must never trigger an AI call by itself.
- New dependencies need a reason written in the commit message. Do not hand-roll cryptography.

## Server-side helpers
- `handler(({ req, user, ws, params, requestId }) => Response, { fresh? })` — same-origin check, session, workspace, error mapping, `x-request-id`, `Idempotency-Key` replay protection, one structured log line. `{ fresh: true }` (or `requireFresh(user)`) demands a passkey verification younger than 5 minutes; the client wraps such calls in `withFreshAuth()` (`src/lib/client/passkey.ts`).
- `parseBody(req, zodSchema)`; `HttpError(status, message, code?, extra?)` — `code` is a stable machine string the client can branch on (`conflict`, `reauth_required`, `not_configured`, …); `uuid` zod helper; `assertDoc(doc)` (`src/lib/editor/validate.ts`) before storing editor JSON.
- `db`, `schema` from `@/db`; `audit(userId, action, target?, detail?)` from `@/lib/audit` for every security-relevant or destructive action (detail = ids and counts, never content).
- Pages service `src/lib/pages/service.ts`: `createPage`, `updatePage(ws, id, patch, { baseVersion })` (optimistic concurrency → `HttpError 409 conflict` with the server copy), `resolveConflict`, `snapshot`, `softDeletePage`, `restorePage`, … Pages are the universal container: `type` = page | database | research; database rows are pages with `database_id`; captures are pages with `inbox_at`.
- Inbox/capture/tags: `src/lib/inbox/service.ts`. Search: `hybridSearch`, `indexSource` (`src/lib/search`). Jobs: `enqueue(QUEUES.x, data, opts)` from `src/lib/jobs`; handlers in `src/worker/handlers/*` (relative imports only, no `@/`, no `next/*`).
- AI: `route({ task, … })` (`src/lib/ai/router.ts`) → `callAI` / `streamAI` (`src/lib/ai/providers.ts`); `sse(generator)` (`src/lib/ai/chat.ts`).

## Client-side helpers
- `api(url, { method, json, idempotencyKey?, timeoutMs? })` → throws `ApiError { status, code, body }`; adds `Idempotency-Key` on every POST and `x-request-id`; a 401 sends the browser to `/login?next=…`. `sse(url, body, onEvent, signal)`.
- `usePageSync` (`src/lib/client/page-sync.ts`) is the only place that saves page content. Device-local storage is `src/lib/client/offline.ts` (IndexedDB drafts + outbox); captures go through `enqueueCapture` (`src/lib/client/outbox.ts`).
- UI store `useUI()` (`paletteOpen`, `captureOpen`, `drawerOpen`, `aiOpen`, `openAI({ pageId, prefill })`, theme). Hooks in `src/lib/client/hooks.ts`: `useIsPhone`, `useIsTouch`, `useOnline`, `useKeyboardInset`.
- Primitives in `src/components/ui/*`: `Button`, `Input`, `Dialog` + `DialogContent` (centred) or **`SheetContent`** (bottom sheet on phones, dialog from `sm`), `Popover`, `Menu*`, `Tabs*`, `Badge`, `Switch`, `Tip`, `Empty`, `Skeleton`, `Spinner`, `toast(title, { description, tone, action: { label, run } })`.
- React Query keys in use: `["tree"]`, `["inbox"]`, `["inbox-count"]`, `["recent-pages"]`, `["ai-models"]`, `["convs", pageId]`, `["search", …]`, `["passkeys"]`, `["sessions"]`, `["auth-state"]`. Invalidate `["tree"]` after creating/renaming/moving/deleting pages.

## Phone-first UI rules (every screen, checked at 360 px)
1. **No horizontal page scroll, ever.** Wide things (tables, code, boards, timelines, maths) scroll inside their own container (`overflow-x-auto`, `overscroll-behavior-x: contain`, `min-w-0` on flex/grid children). `tests/e2e/mobile*.spec.ts` asserts `scrollWidth <= clientWidth` on the document and on `#main-scroll`.
2. **Touch targets ≥ 44 px** (`h-11`/`size-11`) for anything tappable on phones; lists use rows ≥ 48 px. Hover-only affordances must have a visible touch equivalent.
3. **Inputs are 16 px or more on phones** (iOS zooms the page below that) — `text-[16px]`, or rely on the global rule in `globals.css`.
4. **Details and forms open in a `SheetContent`**, not a popover or a centred dialog full of small controls. Filters/sort/group = one sheet. A form keeps its draft while open and after an error.
5. **Nothing fixed may cover content or the caret.** Bottom-docked UI uses `bottom: var(--kb, 0px)` (keyboard inset from `useKeyboardInset`) and safe areas (`env(safe-area-inset-*)`, classes `safe-top` / `safe-bottom`); heights use `dvh` / `var(--vvh)`, never `100vh`.
6. **Every state exists**: loading (skeleton), empty (`Empty` with one useful action), error (message + retry), offline (say what is kept on the device).
7. **Accessibility**: real `<button>`/`<a>`, `aria-label` on icon-only controls, `aria-pressed`/`aria-current`/`role="status"` where relevant, visible focus ring (global), colours from tokens (both themes), no information by colour or gesture alone, `prefers-reduced-motion` honoured (global), browser zoom never disabled.
8. **Dangerous or bulk actions**: confirmation that says what will happen, then an Undo toast when the action is reversible; permanent ones require a fresh passkey.

## Tests
- `pnpm typecheck` — must be clean.
- `pnpm test` — node:test unit/integration suites in `tests/unit` (need `DATABASE_URL` → a `*_dev` database).
- `pnpm test:e2e` — Playwright against a running build on `E2E_BASE_URL` (default `http://localhost:8481`): passkey journeys with Chrome's virtual authenticator, then phone journeys at 360×740, 375×667 and 430×932.
See `docs/testing.md` for what these do and do not prove.
