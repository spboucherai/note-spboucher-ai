# SP Note Next Generation — architecture (ARCHITECTURE-NEXT)

> Status 2026-11-20: this is the cross-platform contract the upgrade was built against (web/backend 3.0.0 in
> production; SPNotesCore 2.0; SP Notes macOS 2.0.0 and iOS/iPadOS 2.0.0 on their `next` branches). Sections 0–6
> are the original specification; §7 records the decisions taken during the work and supersedes earlier text where
> they differ; §8 is the native architecture. Exact request/response shapes: `API-NEXT.md`, `API-NEXT-AI.md`.
> Node behaviour on the web: `EDITOR-NODES.md`. Canvas semantics: `CANVAS.md`. Tokens and motion:
> `DESIGN-SYSTEM-NEXT.md`. Offline web: `OFFLINE-WEB.md`. Databases: `DATABASES-NEXT.md`.

## Overview

```
              ┌──────────────────────── one backend (M4M64c) ────────────────────────┐
 Web (Next.js, Tiptap) ─┐   Next.js route handlers ── service layer ── PostgreSQL 17 + pgvector
 macOS (SwiftUI/AppKit) ─┼─► /api/* (session cookie + Origin)   │        ├─ pages (ProseMirror JSON), versions
 iOS/iPadOS (SwiftUI)  ─┘   /api/sync?kinds= change feed (rev)   │        ├─ entity feed: tasks, databases, edges,
                             /api/meta feature gating             │        │   references, canvases, concepts
                                                                  │        ├─ knowledge_events (journal)
        pg-boss worker: index, import, backup, agents, AI         │        └─ AI catalogue, usage, synopses, transcripts
        properties, graph insights, transcription ◄───────────────┘
 Providers (server side only): OpenAI, Anthropic, any OpenAI-compatible (OpenRouter, MacLustr local) — keys in .env
```

Native stack: `SPNotesCore` package = `SPNotesDocument` (lossless ProseMirror model, typed 3.0 nodes, ink,
canvas, merge) · `SPNotesStore` (SQLite v2: pages, FTS, entities cache, outboxes, canvases, events) ·
`SPNotesAPI` (typed client for every route) · `SPNotesSync` (engine + repositories) · `SPNotesDesign`
(tokens, motion) · `SPNotesFeatures` (cross-platform SwiftUI screens). The two apps own their shells, their
TextKit 2 editors and platform integration. No WebView, no JavaScript engine in the native apps.

Document rule: ProseMirror JSON stays canonical. New blocks are leaf atoms whose data is in attributes and
attachments; every client preserves what it does not know, byte for byte.

Sync rule: pages, attachments, tasks and canvases are editable offline (journal/outbox, stable client ids,
versioned saves, 3-way merge per block / per canvas element, explicit conflicts). Databases, graph, research
and server-computed read models are readable offline from the last copy and written online. The server is the
shared source of truth after synchronisation; unsent local changes are always kept.

This file is the contract between every workstream (backend, web, SPNotesCore, macOS, iOS/iPadOS).
It is a MAJOR UPGRADE of working, deployed software. If something here conflicts with what the code can
safely do, stop and report rather than improvise a different contract: four codebases implement it.

Audits (read the one for your codebase before coding): `/tmp/spnote-next/audit-web.md`,
`/tmp/spnote-next/audit-core-macos.md`, `/tmp/spnote-next/audit-ios.md`.

## 0. Rules for every workstream

1. Never touch production: `M4M64c:~/apps/note-spboucher-ai`, PM2 `note-web`/`note-worker`, database
   `note_spboucher`, https://note.spboucher.ai. Backend/web work happens in a git worktree under
   `M4M64c:~/dev/` against a scratch database whose name ends in `_dev`. Deployment is done later by the lead.
2. Never `pkill -f`/`killall` on a node (shared machine): kill by PID of the port you own.
3. On the laptop never run `open`, never launch an app window that can take focus (the owner is working).
   Use the projects' own background recipes (`Scripts/run-dev.sh --shot`, hosted tests, simulators by UDID).
   Use a dedicated simulator per UI-test suite (create one named after your workstream if needed).
4. No WebView / WebKit / JavaScriptCore in the native apps (macOS `Scripts/verify-release.sh` enforces it).
5. No existing feature removed, no existing node/attr renamed, no destructive migration. Every SQL migration
   is additive and has a hand-written `.down.sql`. Unknown content must round-trip untouched everywhere.
6. Nothing is "done" without a test that ran. Report honestly: verified / implemented-unverified / not done.
   Never fabricate AI output, citations, benchmark numbers or test results. No mock presented as a feature.
7. Secrets stay in `.env` on the node / Keychain on devices. Never print or commit them.
8. Keep each project's conventions (file header with file/description/author/contact, French UI strings as
   the source language, existing lint/typecheck). Commit on your branch with clear messages; do not push to
   `main`, do not merge, do not tag, do not release. End commit messages with
   `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`.
9. Respect Reduce Motion (web `prefers-reduced-motion`, Apple `accessibilityReduceMotion`) for every animation.
10. AI-generated content (summaries, suggested links, suggested tags…) is always visibly marked as such and
    is never applied without an explicit user action; agent writes go through the existing proposal/approval model.

## 1. Versions

Web/backend 3.0.0 · SPNotesCore 2.0.0 · SP Notes macOS 2.0.0 · SP Notes iOS/iPadOS 2.0.0.
`GET /api/meta` (authenticated) → `{ "api": 3, "version": "3.0.0", "features": ["entities","events","canvas",…] }`.
Clients gate new UI on `features`. Existing routes keep their paths and shapes (shipped 1.x natives use them).

## 2. Document format — new nodes (ProseMirror JSON stays canonical)

All existing nodes/marks are unchanged (see audit-web §3.3). New nodes are **block-level leaf atoms**
(no `content`), carry the usual block `id` attr, and keep all their data in `attrs`. Binary data is never
inline: it is an attachment referenced by id (`/api/files/<id>`). A client that does not know a node keeps it
verbatim and shows a neutral read-only card (never plain-text conversion, never deletion).

| type | attrs (defaults) | notes |
|---|---|---|
| `mermaid` | `code:""`, `preview:null` (attachment id of an SVG or PNG render), `previewHash:null` (sha256 hex of `code` the render was made from) | Web renders with the `mermaid` library and uploads the render when it changes. Natives show the render if `previewHash` matches the sha256 of `code`, else show the source with a « rendu à mettre à jour depuis le Web » notice; natives can edit `code`. |
| `drawing` | `ink:null` (attachment id, JSON `spn-ink-1`), `preview:null` (attachment id PNG), `pk:null` (attachment id of native PKDrawing data, optional), `width:0`, `height:0`, `background:"none"` | `spn-ink-1` = `{"format":"spn-ink-1","width":W,"height":H,"strokes":[{"tool":"pen|marker|highlighter","color":"#rrggbbaa","width":n,"points":[[x,y,pressure 0..1],…]}]}` (points in canvas units). Every editor writes `ink` + `preview`. iOS also writes `pk`; an editor that changes `ink` without PencilKit sets `pk:null`. |
| `chart` | `kind:"bar"` (`bar|line|area|pie|scatter`), `title:""`, `columns:[]` (strings), `rows:[]` (arrays of string|number|null), `x:null` (column name), `y:[]` (column names), `source:null` (`{databaseId, viewId?}` → data read live from a database; `columns/rows` then hold the last snapshot) | Web: SVG renderer. Natives: Swift Charts. |
| `queryView` | `source:"tasks"` (`tasks|pages|database|references|backlinks`), `databaseId:null`, `viewId:null`, `filter:{}` (`{tag?, section?, status?, parentId?, text?, dueBefore?, dueAfter?}`), `layout:"list"` (`list|table|board`), `limit:25`, `title:""` | "Living document" block: resolved at display time through `POST /api/query` (§4.7). |
| `citation` (**inline** atom) | `refId:null` (research reference uuid), `locator:""`, `label:""` (cached "Author Year") | |
| `bibliography` | `style:"apa"`, `title:"Références"` | Lists the references cited in the page (computed). |
| `pdf` | `attachmentId:null`, `name:""`, `page:1`, `annotations:[]` | annotation = `{id, page, kind:"highlight|note|ink", color:"#rrggbb", rects:[[x,y,w,h]…] (0..1, origin top-left of the page), text:"", note:"", ink:[[x,y]…]?, createdAt}` |
| `blockRef` | `pageId:null`, `blockId:null`, `mode:"embed"` (`embed|link`) | Cross-reference / transclusion, rendered read-only from the source block. A missing target shows « Référence introuvable ». |
| `runCode` | `language:"javascript"`, `code:""`, `output:null` (`{text, error:bool, ms, at}`) | Executed only on explicit click, on the web, inside a sandboxed iframe (`sandbox="allow-scripts"`, opaque origin, no network through CSP). Natives show code + last output and can edit `code`; they do not execute (no JS engine allowed). |
| `audio` | `attachmentId:null`, `duration:0`, `title:""`, `recordedAt:null`, `transcript:[]` (`[{t:seconds, text}]`), `transcriptStatus:"none"` (`none|pending|done|failed`), `transcriptEngine:null`, `summary:null` (`{text, decisions:[], tasks:[], model, at}`) | Voice note. |
| `canvasLink` | `pageId:null` | Card that opens a canvas page (§3.4). |

Existing nodes extended (new **optional** attrs, default null, old clients keep them):
`taskItem`: `due` (ISO date), `priority` (`low|medium|high`), `taskId` (uuid of the linked `tasks` row).
`aiBlock`: `sources` (`[{pageId, blockId, title}]`), `action` (string). `callout.kind` gains `decision`, `question`, `hypothesis`.
`listItem`/`taskItem` now receive a block `id` (fixes citations into lists).

Text/Markdown/HTML export of new nodes (must be byte-identical between server `src/lib/editor/text.ts` and
Core `MarkdownExport`): mermaid → fenced ```` ```mermaid ```` block; runCode → fenced block with its language,
then a fenced `output` block when present; chart → `title` line + Markdown table of columns/rows;
drawing → `![Dessin](/api/files/<preview>)` (or `[Dessin]`); pdf → `[PDF: name](/api/files/<id>)` then one
`> p.<page> — <text> — <note>` line per annotation; audio → `[Audio: title](/api/files/<id>)` then the
transcript lines `[mm:ss] text`; queryView → `[Vue: title]`; blockRef → `[[<pageId>#<blockId>]]`;
citation → `[@<label or refId>]`; bibliography → `## <title>`; canvasLink → `[Canvas](/p/<pageId>)`.
Plain text (search index, word count): the same without Markdown syntax; transcript and annotation text ARE indexed.

## 3. Backend data model additions (migrations 0003+; all additive)

### 3.1 Entity change feed
`rev` + the existing `sync_bump_rev` / `sync_tombstone` trigger mechanism is extended to:
`tasks`, `databases`, `database_properties`, `database_views`, `database_rows`, `knowledge_edges`,
`references`, `canvases`, `concepts`. `GET /api/sync` accepts `kinds=task,database,database_property,
database_view,database_row,edge,reference,canvas,concept` (comma list). Without `kinds` the answer is
byte-compatible with 2.x. With it, the answer adds `"entities": { "<kind>": [ {…row…, "rev": n} ] }`
windowed exactly like pages (same cursor rules), and tombstones of those kinds. Writes stay on REST routes;
every create route of these kinds accepts a client-chosen uuid `id` and is idempotent on it.

### 3.2 Events journal — `knowledge_events`
`id, workspace_id, at, kind, page_id?, entity_kind?, entity_id?, actor ('user'|'agent'|'ai'|'system'), device?, summary, data jsonb`.
Written in the service layer (same transaction as the mutation) for: `page.created|renamed|edited|moved|archived|
unarchived|trashed|restored|purged`, `page.version` (snapshot taken), `tag.added|removed`, `link.added|removed`,
`relation.created|accepted|rejected|removed`, `reference.added|linked`, `attachment.added`, `task.created|completed|reopened`,
`capture.created|filed`, `ai.applied` (an AI result inserted by the user), `agent.applied`, `decision.recorded`
(callout kind `decision` added), `canvas.edited`. `page.edited` is coalesced (at most one per page per 10 min).
Only real events are shown anywhere; nothing is back-filled except `page.created` from `pages.created_at` and
`page.version` from existing `page_versions` (flagged `data.backfilled = true`).

### 3.3 Knowledge graph 2.0
`knowledge_edges` gains: `rel_type` (`related|supports|contradicts|extends|example_of|part_of|cites|precedes|
follows|about|answers|duplicates`), `origin` (`user|ai|system`), `note`, `valid_from`, `valid_to`,
`source_kind`/`target_kind` (`page|reference|concept`), `source_block_id`, `target_block_id`, `decided_at`.
Existing rows keep their meaning (`kind` link/ai_suggested). AI-created edges are always `status='suggested'`,
`origin='ai'` until the user accepts. New `concepts (id, workspace_id, name, description, origin, status, rev)`
and `page_concepts (page_id, concept_id, origin, status, confidence)`.
`knowledge_insights (id, kind 'contradiction|open_question|cluster|recurring_topic|duplicate', status
'suggested|accepted|dismissed', title, detail, data jsonb{pageIds, blockIds, …}, model, created_at)`.

### 3.4 Canvas
A canvas is a page with `type='canvas'` (empty ProseMirror doc as `content`) plus one row in
`canvases (page_id PK, data jsonb, version int, rev, updated_at)`.
`data = {"format":"spn-canvas-1","nodes":[{id, kind:"text|page|image|pdf|link|drawing|shape|reference|math|table",
x,y,w,h,z, text?, pageId?, attachmentId?, url?, refId?, latex?, color?, shape?:"rect|ellipse|diamond", ink?: attachment id}],
"edges":[{id, from, to, label?, kind?:"arrow|line", color?}], "viewport":{x,y,zoom}}`.
`GET /api/canvases/<pageId>` · `PUT /api/canvases/<pageId>` `{data, baseVersion}` → 200 `{version}` | 409 with the
server copy (same optimistic model as pages; clients merge by node/edge id when both sides changed different ids).

### 3.5 AI providers
`ai_providers` gains `kind` (`openai|anthropic|openai_compatible`), `base_url`, `key_env` (NAME of the env var),
`label`. Seeded rows: `openai`, `anthropic` (unchanged), `openrouter` (`https://openrouter.ai/api/v1`,
`OPENROUTER_API_KEY`), `maclustr` (`https://llm.spboucher.ai/v1`, `MACLUSTR_LLM_API_KEY`). A provider with no
key in the environment is listed as unavailable and never routed to. `ai_models` gains `creator` (anthropic,
openai, google, meta, mistral, qwen/alibaba, deepseek, xai, …), `route` (= provider id), `context_window`,
`price_in`, `price_out`, `capabilities jsonb`. The measured routing table is NOT changed: new-provider models
are selectable manually and enter automatic routing only after `pnpm bench:run` covers them.

## 4. New / changed HTTP API (all under the existing auth: session cookie + Origin on mutations)

Exact request/response shapes are written by the backend workstream in `docs/next/API-NEXT.md`
(in the web repo) — that file is the reference for the native clients. Planned surface:

4.1 `GET /api/meta` · `GET /api/sync?kinds=` (§3.1)
4.2 Tasks: `GET/POST /api/tasks` (client `id`, `due`, `priority`, `pageId`, `blockId`), `PATCH/DELETE /api/tasks/<id>`.
4.3 Graph: `GET /api/graph?view=global|local|project|timeline|concepts|documents|references&pageId=&from=&to=`,
    `POST /api/graph/relations` (typed, user), `PATCH /api/graph/relations/<id>` (accept/reject/edit), `DELETE`,
    `GET /api/graph/insights`, `POST /api/graph/insights/run` (queues the AI analysis job),
    `PATCH /api/graph/insights/<id>` (accept/dismiss), `GET/POST/PATCH /api/concepts`.
4.4 Timeline: `GET /api/events?pageId=&projectId=&from=&to=&kinds=&cursor=`; Time machine:
    `GET /api/timemachine?at=<ISO>&pageId=|projectId=` → state at that date (nearest version ≤ at per page,
    relations/references existing at that date), `POST /api/pages/<id>/versions/<vid>/restore` (existing restore path).
4.5 Health: `GET /api/health/knowledge` → orphans, broken links, missing references, potential duplicates,
    untitled, inactive projects, open tasks (ids + counts, computed from real data).
4.6 Brief: `GET /api/brief` → recent notes, active projects, tasks due/overdue, unfiled captures, link
    suggestions, documents to revisit; optional AI summary only on explicit `POST /api/brief/summary`.
4.7 Living blocks: `POST /api/query` `{source, databaseId?, viewId?, filter, limit}` → rows for `queryView`/`chart`.
4.8 Canvas (§3.4). 4.9 Semantic zoom: `GET /api/pages/<id>/zoom?level=1|2|3` (1 = AI synopsis, cached and marked
    AI; 2 = outline: headings + first sentence of each section, computed without AI; 3 = full).
4.10 Ask: `POST /api/ai/chat` gains `scope` (`all|page|project|selection`) and citations keep `blockId`;
     `POST /api/ai/action` gains the actions `coherence`, `questions`, `links`, `synthesis`, `structure`.
4.11 Models: `GET /api/ai/models` gains creator/route/context/price/capabilities/available + `logo` path
     (`/model-logos/<creator>.svg`, neutral fallback `generic.svg`).
4.12 Capture: `POST /api/capture` kinds extended (`audio`, `screenshot`, `selection`, `document`);
     `GET /api/inbox/<id>/suggestions` (AI title/tags/project/relations/summary — suggestions only),
     `POST /api/inbox/<id>/apply` applies the chosen subset (journaled, undoable).
4.13 Voice: `POST /api/audio/<attachmentId>/transcribe` (queues job; engine reported; result written into the
     `audio` node through a normal versioned save), `GET /api/audio/<attachmentId>`.
4.14 Research: `GET /api/research/export.tex?projectId=`, project-scoped listing, `citation` resolution
     `GET /api/research/references?ids=`.
4.15 `/api/files/<id>` supports `Range`. Malformed ids → 400 everywhere. Purge deletes attachments. Parent cycles refused (409).

## 5. Note Visual System 2.0 — « Graphite & Ultramarine · Lumen »

Evolution of the existing identity (do not restart it): graphite neutrals, ultramarine accent, violet for
anything AI. New in 2.0: editorial serif for reading titles, a spacing/radius/elevation/motion scale,
translucent "glass" chrome, and seven signature motions. The same tokens exist on the web (CSS custom
properties, `src/app/globals.css`) and in Swift (`SPNotesDesign` module in SPNotesCore). The native apps
abandon their amber accent for ultramarine (amber stays only as the `warning` hue).

Colour (sRGB approximations for Swift; web keeps its oklch sources of truth — audit-web §9.2):

| token | light | dark |
|---|---|---|
| bg | #F9FAFC | #12141C |
| bgElevated | #FFFFFF | #1A1D27 |
| bgSunken | #F1F3F7 | #0D0F15 |
| bgSidebar | #F4F6F9 | #0F1118 |
| bgHover | #EBEEF4 | #222633 |
| fg | #161A26 | #EBEEF4 |
| fgMuted | #535B6E | #A6AEC0 |
| fgFaint | #8A91A3 | #707889 |
| line | #E3E6EC | #262A36 |
| lineStrong | #CFD4DE | #363B4A |
| accent | #3157D5 | #8AA2FF |
| accentFg | #FBFCFF | #0B1230 |
| accentSoft | #E9EEFF | #1F2C5C |
| ai | #7A3FD6 | #B699FF |
| aiSoft | #F1EAFF | #33205E |
| success | #2E8B57 | #6CCB93 |
| warning | #C98A1A | #F0BC5E |
| danger | #D14343 | #F08A80 |

Signature gradient « Lumen » (hero surfaces, capture pulse, graph links, AI shimmer): accent → ai at 135°.
Typography: UI = system sans (SF Pro / Inter on web, self-hosted); reading titles + optional body = serif
(New York on Apple = `Font.Design.serif`; Source Serif 4 on web, self-hosted); code = SF Mono / JetBrains Mono.
Scale (pt/px): micro 11, ui 13, body 16 (reading 17 on iPhone), h3 20, h2 24, h1 30, display 40; reading measure 46rem / ~680 pt.
Spacing: 2, 4, 8, 12, 16, 24, 32, 48, 64. Radii: xs 4, sm 6, md 10, lg 14, xl 20, pill 999.
Elevation: card (hairline + 1px shadow), pop (16/40 blur), glass (material/backdrop-blur 20px + 60–72 % surface + hairline).
Motion tokens: instant 90 ms, fast 160 ms, base 240 ms, slow 420 ms, ambient 900 ms;
easing standard `cubic-bezier(.2,.8,.2,1)`, exit `cubic-bezier(.4,0,1,1)`, spring (response .38, damping .82).
Signature motions (each must degrade to a plain cross-fade ≤ 120 ms under Reduce Motion):
1 Living Pages (blocks rise 6 px + fade, 18 ms stagger, capped at the first 24 blocks) · 2 Morphing Editor
(toolbar content morphs with the selected block type) · 3 Knowledge Connections (edges draw themselves in the
graph/constellation) · 4 Fluid Navigation (shared-element title transition list → page) · 5 Intelligent Panels
(AI/search/properties panels slide + blur in from their edge) · 6 Quick Capture (sub-200 ms scale-in, Lumen pulse
on save) · 7 Semantic Zoom (level change cross-dissolves while keeping the scroll anchor).

## 6. Platform expectations

Functional parity is the goal; ergonomics differ. Server-computed features (ask, timeline, time machine,
health, brief, graph views, insights, query blocks, semantic zoom, models) are rendered **natively** from the
same endpoints. Offline: pages/attachments/tasks/canvases are editable offline on natives; databases, graph,
research, health, brief are readable offline from the last synced copy and editable online. The parity
matrix must state the truth per platform.

## 7. Amendments (lead decisions after wave 1)

- **Contrast**: `fgFaint` is for placeholders/decoration only (never body or label text). Semantic hues used
  as *small text* in light mode use darker text variants: `successText #1F7A47`, `warningText #8A5A00`,
  `dangerText #B93232` (dark mode keeps the base hues). Fills, icons and borders keep the base hues.
- **Block ids on list items**: loading a 2.x document now assigns ids to `listItem`/`taskItem`; this is a
  content change only when the page is next saved by the user (clients must not mark a page dirty just
  because ids were assigned at load).
- **Callout icons for the new kinds**: decision ⚖️, question ❓, hypothesis 🧪 (all platforms).
- **Canvas merge edit-vs-delete**: the edited node is kept and the conflict is reported (all platforms).
- **Exact colours (supersede the §5 approximations; measured sRGB of the web oklch tokens — natives must use these)**:

| token | light | dark |
|---|---|---|
| bg | #F9FBFD | #0D1016 |
| bgElevated | #FFFFFF | #15181F |
| bgSunken | #F0F3F6 | #080A0F |
| bgSidebar | #F3F6F9 | #0A0C12 |
| bgHover | #EAEDF2 | #1D2028 |
| fg | #151922 | #E8EBEF |
| fgMuted | #535862 | #A0A5AE |
| fgFaint | #848992 | #6A6F77 |
| line | #E1E4E8 | #22252D |
| lineStrong | #CCD0D5 | #333640 |
| accent | #2F5DDB | #7CA5FF |
| accentFg | #FBFCFE | #090F1C |
| accentSoft | #E5F0FF | #1B2A4C |
| ai | #7E41D2 | #B999FB |
| aiSoft | #F3ECFF | #302249 |
| success | #008B4E | #5BC083 |
| warning | #D98B09 | #F2AF48 |
| danger | #CC272E | #F26A64 |

  Light-mode small-text variants: `successText #006B3C`, `warningText #8A5A00`, `dangerText #B0181F`.
- **Languages**: web UI strings stay English (the web app's existing convention); native UI strings stay French
  as source with the English catalogue (existing convention of each project).
- **Mermaid preview** is a 2× PNG attachment (natives draw it as an image).
- **Web client module names**: client node definitions `src/lib/editor/next-node-defs.ts`; server node rules
  `src/lib/editor/next-nodes.ts`.
- Integration branch for backend + web: `M4M64c:~/dev/note-next-int` (branch `next-int`, DB `note_next_int_dev`,
  port 8486, `~/dev/note-next-int-data/srv.sh`). Contracts: `docs/next/API-NEXT.md`, `docs/next/API-NEXT-AI.md`,
  `docs/next/EDITOR-NODES.md`, `docs/next/DESIGN-SYSTEM-NEXT.md` (laptop copies of the two API files in `/tmp/spnote-next/`).

## 8. Native architecture for the feature screens (lead decision after Core wave 2)

To guarantee parity and avoid writing every screen twice, cross-platform SwiftUI feature screens live in a new
library **`SPNotesFeatures`** inside the SPNotesCore package (depends on SPNotesDesign, SPNotesSync repositories,
SPNotesDocument; SwiftUI + Swift Charts + PDFKit + AVFoundation; `#if os()` only where a platform API differs;
no WebKit/JavaScriptCore). Each screen takes `NotesRepositories` (plus a small `FeatureRouter` protocol the host app
implements: `openPage(id:blockId:)`, `openDatabase(id:)`, `openCanvas(pageId:)`, `openURL(_:)`, `presentError(_:)`)
and adapts by size class (compact = iPhone layouts; regular = Mac/iPad multi-column). Public screens:

`TasksScreen`, `InboxScreen` (triage + AI suggestions checklist), `DatabaseScreen` (table, board, list, gallery,
calendar, timeline views; filters/sorts/grouping; row editor; online-write/offline-read as the repositories do),
`GraphScreen` (7 views, typed relations, insights panel), `ConstellationScreen`, `TimelineScreen` (+ time machine),
`KnowledgeHealthScreen`, `DailyBriefScreen`, `AskScreen` (scope, block citations → router), `ModelPickerView`
(creator logos generated from the web `public/model-logos/registry.json`), `UnifiedSearchScreen`, `ResearchScreen`
(references, DOI/BibTeX, LaTeX export share), `CanvasScreen` (infinite canvas; compact = list/outline mode),
`SemanticZoomControl` + `PageOutlineView`, `CommandCenterView` (palette over a command registry),
and block detail views used by both editors' atom sheets: `MermaidBlockView`, `DrawingBlockViewer` (ink render;
editing: PencilKit on iOS in the app, mouse/trackpad ink editor in Features for macOS), `ChartBlockView`
(Swift Charts + data grid editor), `QueryViewBlockView`, `BlockRefView`, `CitationPickerView`/`BibliographyView`,
`PDFBlockView` (PDFKit, highlight/note/ink annotations ⇄ `PDFAnnotation` normalised rects), `RunCodeBlockView`
(code + last output; no execution), `AudioBlockView` (record/pause/resume, player, transcript with seek, summary).

The app projects own: the shell/navigation, the TextKit editors (atom cards for the new nodes → open the Features
view in a sheet/inspector/window), platform integration (windows, menus, Quick Note, Spotlight, widgets, share,
intents, Pencil, haptics), signing and release.
Live test server for natives: integration build on `M4M64c:127.0.0.1:8486` (tunnel with the SAME local port:
`ssh -f -N -L 8486:127.0.0.1:8486 M4M64c`; cancel only your own forward; token:
`ssh M4M64c 'cd ~/dev/note-next-int && export PATH=/opt/homebrew/bin:$PATH && set -a && . ./.env && set +a && node node_modules/tsx/dist/cli.mjs scripts/dev-session.ts'`;
mutations need `Origin: http://localhost:8486`).
