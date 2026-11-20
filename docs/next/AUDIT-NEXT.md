# SP Note Next Generation — initial audit (2026-11-19)

Scope: everything that exists before the upgrade. Method: three read-only code audits (web/backend on the
production node, shared Swift core + macOS app, iOS/iPadOS app) plus baseline test runs. The full
inventories are in `docs/next/audit/` (`audit-web.md`, `audit-core-macos.md`, `audit-ios.md`); this file
is the decision-level synthesis. Statements are code facts unless marked *(project's own claim)*.

## 1. What exists

| Component | Where | Version | State |
|---|---|---|---|
| Web + backend | `M4M64c:~/apps/note-spboucher-ai` (spbgit `note-spboucher-ai.git`), PM2 `note-web` (:8480) + `note-worker`, PostgreSQL 17 + pgvector, route Caddy BHS64 → note.spboucher.ai | 2.0.0 (`77ef5f0`) | In production, clean tree |
| Shared Swift core | `~/Desktop/Cluster/apple/SPNotesCore` (spbgit `sp-notes-core.git`) | 1.0 (`267a673`) | 4 modules, 283 declared tests |
| macOS app | `~/Desktop/Cluster/apple/SPNotes` (spbgit `sp-notes-macos.git`) | 1.0.2 (3) | Signed, notarised, installed |
| iOS / iPadOS app | `~/Desktop/Cluster/apple/SPNotes-iOS` (spbgit `sp-notes-ios.git`) | 1.0.0 (1) | On internal TestFlight (ASC 6836504456) *(claim)* |

All four repositories were found and read. None is a WebView wrapper: both native apps are SwiftUI +
TextKit 2 and synchronise through `GET /api/sync` (change feed added 2026-11-18).

Baseline tests run for this audit: web `pnpm test` 61/61 on a fresh scratch database
(`note_next_dev`); `swift test` on SPNotesCore exit 0. The native app suites were not re-run at audit time.

The brief describes a shared password and an unlock link. That is outdated: since 2.0.0 (2026-11-17)
access is passkeys only (WebAuthn, server-verified, revocable sessions, step-up, CLI-only enrolment and
recovery). Section 16 of the brief is therefore largely already delivered; what remained was confirming
it on real devices and managing devices from the native apps.

Production data is very small (7 pages, 0 databases, 0 tags, 3 tasks, 1 attachment, 3 references,
1 passkey): data migration risk is low; compatibility with the shipped native apps is the real constraint.

## 2. Web / backend — findings that drive the upgrade

- **Schema**: ~45 tables (pages with ProseMirror JSON, versions, blocks index, databases, relations, tasks,
  links, knowledge edges, chunks + 1536-d embeddings, AI catalogue/usage/executions, research, audit).
  Three migrations, each with a hand-written down file.
- **Change feed**: `rev` exists only on `pages` and `attachments` (+ tombstones). Tasks, databases, rows,
  views, edges, references have no feed — the reason the native apps cannot show them.
- **Auth for native clients**: no bearer token; the passkey session cookie with `Origin` on mutations.
- **Document validation** is structural (size, depth, URLs): new node types are accepted by the server.
- **Risk found**: the web editor does not enable Tiptap content checking; a document containing a node the
  client does not know loads as an empty document, and autosave would then store it. Must be fixed before
  any new node type ships.
- **AI**: two hard-wired providers (OpenAI Responses API, Anthropic); no base URL, no creator/logo field;
  routing is driven by measured benchmarks (38 models). RAG citations already carry `blockId`, anchored on
  the first block of a ~350-token chunk; list items have no block id.
- **Databases**: six view types render; the query engine filters/sorts in JS over the whole database
  (UI cap 500 rows); formulas exist, rollups partial, AI column manual per cell.
- **Graph**: only `link` and `ai_suggested` edges; global and local views; no typed or temporal relations.
- **Offline (web)**: IndexedDB holds unsaved drafts and a capture outbox only.
- **Design**: oklch light/dark tokens, one radius, no motion tokens, declared fonts never loaded,
  `motion` installed but unused.
- **Absent**: drawing, Mermaid, chart, annotatable PDF, executable code, canvas, query blocks, LaTeX
  export, transcription, daily brief, health dashboard, event journal, Range support on files.
- **Confirmed defects** (all reported earlier by the native work): tag counts always 0; purge leaves
  attachments (and orphans children); malformed ids answer 500; no parent-cycle check (a cycle makes
  trash/restore recurse forever); soft-deleted files still served; tasks have no change feed.

## 3. Shared Swift core — findings

- Node types are strings classified by sets; unknown nodes and attributes already round-trip losslessly.
- Three-way merge works per top-level block.
- Store is at schema v1; any new table is the first migration ever run on shipped data.
- Sync has no entity abstraction: pages (dirty flags) + five op kinds; **unknown op kinds are dropped as
  completed** (data-safety issue for any future op).
- The HTTP client never retries.

## 4. macOS app — findings

- Three separate editor implementations exist (Core commands, macOS AppKit, iOS UIKit): every new block
  costs Core + two renderers.
- Atoms are static bitmaps edited in sheets; nothing interactive in place.
- The release gate (`verify-release.sh`) fails if WebKit or JavaScriptCore is linked: Mermaid and code
  execution cannot be done with a web view or JS engine in the native apps.
- **Data-safety defect**: if the SQLite store fails to open, the app silently continues on an in-memory
  store; typed text would be lost.
- Design system is a handful of colours (amber accent, unlike the web's ultramarine); no reduced-motion
  handling; AI limited to two endpoints.
- Absent: databases, graph, backlinks, tasks, inbox triage, research, semantic search, canvas, voice,
  PDF annotation, Spotlight, notifications.
- Never verified *(project's own report)*: passkey sign-in in the signed app, UI tests, mouse interactions.

## 5. iOS / iPadOS app — findings

- Real three-column iPad layout with multi-scene support; iPhone is a single stack.
- `Design/` holds icons only; tokens are 16 colour sets; Reduce Motion read in one place.
- The app assumes "page = note": database pages are placeholders, routes carry no block anchor.
- AI: actions + chat over SSE; citations do not link to blocks; search is local FTS only.
- Present and specific to iOS: PencilKit drawings (as image + companion file), scanner + on-device OCR,
  widgets, share extension, App Intents, Spotlight, reminders, app lock.
- Absent: databases, graph, global tasks, inbox AI triage, research, canvas, voice notes, PDF annotation,
  Quick Actions, health/brief/timeline, command palette.
- Never run on a physical device *(project's own report)*, including passkey sign-in.

## 6. Consequences for the plan

1. Contract first: one specification for new nodes, the entity feed and the new endpoints
   (`ARCHITECTURE-NEXT.md`, `API-NEXT.md`), then four codebases implement it.
2. New blocks are leaf atoms whose data lives in attributes and attachments, so that clients that do not
   know them preserve them, and so that native rendering fits the existing "atom + native sheet" model.
3. Server-computed intelligence (ask, graph views, insights, health, brief, timeline, time machine) is
   exposed as endpoints and rendered natively: parity without re-implementing logic three times.
4. Safety work precedes features: content-check on the web, store-open failure and dropped-op fixes in
   the core, tested store migration v2, additive SQL migrations with down files.
5. What cannot be verified here (real-device biometrics, Pencil, camera, widgets) is listed as such in
   the parity matrix and the test plan; it is never reported as done.
