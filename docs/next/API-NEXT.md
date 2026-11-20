# SP Note 3.0 — API contract of the backend foundation (`API-NEXT.md`)

Reference for the native clients (SPNotesCore 2.0, SP Notes macOS / iOS 2.0) and the web client. It specifies what the backend
workstream added for « Next Generation » (SPEC v1, 2026-11-19): change feed for entities, tasks, events journal, time machine,
knowledge graph 2.0, canvas, knowledge health, brief, living blocks, semantic zoom (levels 2–3), the document layer of the new nodes,
and the defects fixed. Everything that existed in 2.x keeps its path and its shape (see `docs/architecture.md` and audit-web §2); only
the differences are written here.

**Every JSON example in this file is a real answer** of the scratch instance (`note_next_dev`, branch `next`), recorded by
`scripts/next-api-examples.ts` on 2026-11-19T23:28:08.296Z and inlined by `scripts/next-api-doc.py`. Do not edit `API-NEXT.md` by hand: edit
`API-NEXT.template.md`. The AI workstream documents its part in `docs/next/API-NEXT-AI.md`; its sections are marked
`<!-- AI-WORKSTREAM -->` below.

Contents: [0 Conventions](#0-conventions) · [1 Meta](#1-meta) · [2 Document format](#2-document-format--new-nodes) ·
[3 Change feed](#3-change-feed--get-apisync) · [4.2 Tasks](#42-tasks) · [4.3 Graph](#43-knowledge-graph-20) ·
[4.4 Events & time machine](#44-events-journal-and-time-machine) · [4.5 Health](#45-knowledge-health) · [4.6 Brief](#46-brief) ·
[4.7 Query](#47-living-blocks--post-apiquery) · [4.8 Canvas](#48-canvas) · [4.9 Zoom](#49-semantic-zoom) ·
[4.15 Files, purge, ids, cycles](#415-files-purge-identifiers-parent-cycles) · [5 Error codes](#5-error-codes) ·
[6 Deviations and limits](#6-deviations-from-spec-v1-and-known-limits) · [7 Testing against the scratch instance](#7-testing-against-the-scratch-instance)

---

## 0. Conventions

### 0.1 Authentication, same-origin rule, headers

Unchanged from 2.x. Every route below needs the session cookie (`__Host-note_session=<token>`; the cookie name is `note_session`
only under `next dev`). Without it: `401 {"error":"Sign-in required","code":"unauthenticated"}`.

Every `POST` / `PUT` / `PATCH` / `DELETE` must carry `Origin: <APP_URL origin>` (exactly the origin of the server, e.g.
`https://note.spboucher.ai`), else `403 {"code":"csrf"}`. `POST /api/query` is a read, but it is a POST: it needs `Origin` too.

Send `User-Agent: SPNotes/<version> (Macintosh|iPhone|iPad; …)`: the device label derived from it (`SP Notes · Mac`, …) is stored in
every journal event written while serving the request (`device`).

Responses: `Content-Type: application/json`, `Cache-Control: private, no-store`, `x-request-id`. Dates are ISO 8601 UTC with
milliseconds (`2026-11-19T18:22:18.475Z`). Ids are lower-case UUIDs unless stated (block ids are 10-character strings from
`0-9a-zA-Z_-`; canvas node / edge ids are client strings of 1–64 characters).

### 0.2 Errors

```json
{ "error": "human message (English)", "code": "machine_code", "...": "extra fields for some codes" }
```

**Every error answer carries a stable `code`** (integration pass, 2026-11-19: several 2.x and 3.0 answers had none). `code` is what
clients test — never the English message. When the service gives no specific code, the code is the default of the HTTP status:

| HTTP | default `code` | | HTTP | default `code` |
|---|---|---|---|---|
| 400 | `bad_request` | | 413 | `too_large` |
| 401 | `unauthenticated` | | 415 | `unsupported_media_type` |
| 403 | `forbidden` | | 422 | `unprocessable` |
| 404 | `not_found` | | 429 | `rate_limited` |
| 409 | `invalid_state` | | 500 | `internal` (`{"error":"Internal error","code":"internal","requestId":"…"}` — always a server bug) |
| 410 | `gone` | | 501 / 502 / 503 | `not_implemented` / `upstream_error` / `unavailable` |

Since 3.0 **malformed input never answers 500**: a path / query / body value that is not what the route expects (a non-UUID id, an
unparsable date, an unknown enum value, a body that fails its schema — `"error": "Validation: <field> <reason>; …"` —, invalid JSON)
answers `400 bad_request` unless a more specific code is documented. A well-formed id that does not exist answers `404 not_found`.
The full list of specific codes is in [§5](#5-error-codes).

### 0.3 Idempotency

Two mechanisms, both usable together:

1. **Client-chosen id** (preferred for offline creation). Every create route of a synchronised kind accepts a UUID `id`; sending the
   same `id` again returns the **stored** object, untouched, with status `200` and the header `x-existing: 1` (first time: `201`).
   A retry never overwrites and never resurrects: if the object was edited, completed or deleted meanwhile, that state is returned.
   An id that belongs to another workspace → `409 id_taken`.

   | Kind | Create route | Notes |
   |---|---|---|
   | page (incl. canvas) | `POST /api/pages` `{id}` | 2.x; `type: "canvas"` is new |
   | attachment | `POST /api/attachments` (multipart field `id`) | 2.x |
   | task | `POST /api/tasks` `{id}` | new |
   | edge (typed relation) | `POST /api/graph/relations` `{id}` | new |
   | concept | `POST /api/concepts` `{id}` | new |
   | reference | `POST /api/research/references` `{id}` | new field; a known id answers `200` + `x-existing: 1` with the stored row (it answered `201` before the integration pass); the id of a **deleted** reference → `409 reference_deleted` `{id, deletedAt}` — a retry never resurrects; bring it back with `POST /api/research/references/<id>?action=restore` |
   | database | created with its host page (`POST /api/pages` `{id, type:"database"}`); the database object gets a server id the first time the database is opened (`GET /api/databases/<pageId>`) | every database route accepts the host page id in place of the database id |
   | database_property | `POST /api/databases/<db>/properties` `{id}` | new field; answers `201` both times |
   | database_view | `POST /api/databases/<db>/views` `{id}` | new field; answers `201` both times |
   | database_row | `POST /api/databases/<db>/rows` `{id, pageId}` (`pageId` = id of the row's page) | new fields; answers `201` both times; a row id whose row was deleted → `409 row_deleted` |
   | canvas | no create route: the row is born with its page; `PUT /api/canvases/<pageId>` is naturally idempotent | |

2. **`Idempotency-Key`** header (2.x, unchanged): any mutating request carrying it runs at most once; the stored 2xx JSON answer is
   replayed with `idempotent-replay: true`.

### 0.4 `rev` and `version`

- `rev` (integer, one sequence for the whole workspace) is the **change signal**: it grows every time a row changes for any reason.
  It orders the change feed. Compare revs only for equality / order; never do arithmetic on them.
- `version` (pages, canvases) is the **edit guard**: it grows by one when a client-visible edit is saved (page: title, content or
  properties; canvas: `data`) and is what `baseVersion` is compared with.

A row can therefore move in the feed (`rev`) **without** a new `version`: metadata (pin, archive, move, tags), and server-assigned
block ids (the background back-fill that gives ids to blocks and list items written before they had one). Rule for clients: *when a
row arrives with a new `rev` and there is no pending local edit for it, replace the local copy, whatever its `version`*. With a
pending local edit, keep the local copy and save it with the `baseVersion` you hold: if the versions match the save is accepted.

Block ids are **stable** since 3.0: when a saved document contains a block without `id` (a client that never received the ids), the
server gives it back the id the same block (same type, same text, document order) had in the stored document; only a really new block
gets a fresh id. A client never needs to merge ids by hand.

---

### 0.5 DELETE is idempotent

One rule for every `DELETE` (integration pass): **deleting something that is already gone — deleted by an earlier call, or never
existing — answers the same `200` as the first call**, with the same body keys (`{"ok":true}`; routes that report what they did say
so truthfully: `"deleted": false`, `"deleted": 0`, `"purged": 0`, `"extract": null`). Nothing is written the second time (no event,
no audit entry, no new `rev`). A `DELETE` answers an error only when:

- the id is malformed → `400 bad_request`;
- a **container** named in the path does not exist → `404 not_found` (`/api/databases/<unknown>/…`, `/api/research/references/<unknown>/extracts`);
- the object exists and may not be deleted this way → `409 derived_edge` (document link, citation, link suggestion),
  `400 bad_request` (the title property of a database), `400 last_view` (the only view of a database);
- permanent deletion without a recent passkey verification → `403 reauth_required`.

Applies to: `/api/pages/<id>`, `/api/tasks/<id>`, `/api/graph/relations/<id>`, `/api/concepts/<id>`, `/api/research/tasks/<id>`,
`/api/research/references/<id>`, `/api/research/experiments/<id>`, `/api/attachments?id=`, `/api/ai/conversations?id=`,
`/api/databases/<db>/views|properties|rows|row-templates?id=`, `/api/trash`. **One frozen exception**: the 2.x query form
`DELETE /api/tasks?id=<id>` still answers `404 not_found` for an unknown or already deleted task (kept byte-compatible; 3.0 clients
use `DELETE /api/tasks/<id>`).

### 0.6 Dates, numbers, bare dates, clamping

- Every date in every JSON answer is an ISO-8601 UTC string with milliseconds and every count is a JSON number. The integration pass
  removed the last raw PostgreSQL values (`"2026-11-19 13:45:47.060354-05"`, counts as strings): `updatedAt` of
  `GET /api/search` (quick mode), `calls / errors / inputTokens / outputTokens` of `GET /api/ai/usage`, the counters and
  `last_indexed` of `GET /api/search/index-state` (and `health.pending[].updatedAt`, `health.failed[].at`), `time` of `GET /api/health`.
- **A bare date** (`"2026-12-05"`) given as a due date means « that day » and is stored at **12:00 UTC** of that day — the same
  calendar day in every time zone from UTC−11 to UTC+11 — by every route: `POST | PATCH /api/tasks` (`dueAt` or `due`),
  `POST | PATCH /api/research/tasks` (`dueAt`; it stored 00:00 UTC before), and the `due` attr of a `taskItem`. A datetime with an
  offset is kept as given. Anything else → `400 bad_request`.
- **Numeric query parameters are clamped, not refused**, when they are integers outside their range: the nearest bound is used
  (`limit=0` → 1, `limit=999` → the maximum, `inactiveDays=0` → 1). The applied value is visible in the answer where the route
  echoes it (`inactiveDays`, `limit`). A value that is not an integer → `400 bad_request`.

---

## 1. Meta

### `GET /api/meta`

```http
GET /api/meta
```

```http
HTTP 200
```

```json
{
  "api": 3,
  "version": "3.0.0-dev",
  "features": [
    "entities",
    "tasks-v2",
    "events",
    "timemachine",
    "graph-v2",
    "insights",
    "canvas",
    "health",
    "brief",
    "query",
    "zoom",
    "nodes-v3",
    "files-range",
    "zoom-synopsis",
    "ask-scope",
    "actions-v2",
    "models-v2",
    "inbox-suggestions",
    "transcription",
    "research-export",
    "smart-properties",
    "constellation"
  ],
  "serverTime": "2026-11-19T23:28:08.058Z"
}
```

`api` is the API level (3). `version` is `3.0.0` in production (a scratch build keeps its suffix). **Gate UI on `features`, never on
`version`.** Flags of this workstream: `entities`, `tasks-v2`, `events`, `timemachine`, `graph-v2`, `insights`, `canvas`, `health`, `brief`, `query`, `zoom`, `nodes-v3`, `files-range`, `zoom-synopsis`, `ask-scope`, `actions-v2`, `models-v2`, `inbox-suggestions`, `transcription`, `research-export`, `smart-properties`, `constellation`. The AI workstream appends its own (see `API-NEXT-AI.md`). A 2.x server
answers `404` on this route: treat that as `api: 2`, `features: []`.

---

## 2. Document format — new nodes

ProseMirror JSON stays canonical; SPEC §2 defines the nodes and their attrs. This section specifies what the **server** does with them.

### 2.1 Storage and validation

- The server has **no allow-list of node types**: an unknown node (and an unknown attr of a known node) is stored and returned
  verbatim. Clients must do the same (neutral read-only card, never conversion, never deletion).
- `assertDoc` (every route that stores a document) keeps the 2.x structural limits (8 MiB, depth 60, 200 000 nodes, no
  `javascript:` URL) and adds bounds on the attrs of the 3.0 nodes. A violation answers `400 {"code":"bad_document","error":"Invalid document: <reason>"}`.

| Node | Checks (a `null` / absent attr is always accepted) |
|---|---|
| `mermaid` | `code` string ≤ 200 000 chars; `preview` UUID; `previewHash` 64 hex chars |
| `drawing` | `ink`, `preview`, `pk` UUIDs |
| `runCode` | `code` ≤ 200 000 chars; `language` ≤ 64; `output.text` string ≤ 200 000 |
| `chart` | `columns`: ≤ 100 strings (each ≤ 2 000); `rows`: ≤ 5 000 arrays of ≤ 100 cells, a cell is string (≤ 2 000) \| number \| null; `title` ≤ 500 |
| `pdf` | `attachmentId` UUID; `name` ≤ 500; `annotations`: ≤ 2 000 objects, `text` / `note` ≤ 10 000 chars each, `rects` ≤ 500, `ink` ≤ 20 000 points |
| `audio` | `attachmentId` UUID; `title` ≤ 500; `transcript`: ≤ 20 000 `{t, text}` with `text` string ≤ 5 000; `summary.text` ≤ 20 000 |
| `queryView` | `databaseId`, `viewId` UUIDs; `title` ≤ 500; `limit` integer 1…500 |
| `blockRef` | `pageId` UUID; `blockId` ≤ 64 chars |
| `canvasLink` | `pageId` UUID |
| `citation` | `refId` UUID; `locator` ≤ 200; `label` ≤ 500 |
| `bibliography` | `style` ≤ 32; `title` ≤ 500 |

An attachment is always referenced by its **id** (never a URL, never inline bytes): `"/api/files/<id>"` in an id attr is refused.
The same numbers are exported as `NEXT_LIMITS` in `src/lib/editor/next-nodes.ts`.

### 2.2 Block ids

Blocks that receive an `id` attr server-side when they lack one: the 14 types of 2.x (`paragraph, heading, blockquote, codeBlock,
bulletList, orderedList, taskList, table, callout, details, aiBlock, blockMath, image, fileBlock`) **plus `listItem`, `taskItem`** and
the ten new block atoms (`mermaid, drawing, chart, queryView, bibliography, pdf, blockRef, runCode, audio, canvasLink`). `citation` is
inline and has none. Ids are unique per document; a duplicate id (copy / paste) is replaced on the second occurrence.

### 2.3 What saving a document does (server side)

On every save of a page (`POST /api/pages`, `PATCH /api/pages/<id>`, restore, import, agent), in one transaction:

| Found in the document | Effect |
|---|---|
| `mention` (not `kind:"user"`), `link` mark to `/p/<uuid>[#block-<blockId>]`, `blockRef`, `canvasLink` | page → page link: a row in `links` (kind `link`, the backlinks) and an **edge** `kind:"link"`, `relType:"related"`, `origin:"system"`, with `sourceBlockId` (the block that holds the reference) and `targetBlockId` (for `blockRef` / `#block-`). Only targets that are pages of the workspace. |
| `citation` with a `refId` that is a reference of the workspace | **edge** `kind:"cites"`, `relType:"cites"`, `origin:"system"`, `sourceKind:"page"`, `targetKind:"reference"`, `sourceBlockId` |
| `taskItem` with `taskId` | see [§4.2 Tasks and documents](#tasks-and-documents) |
| a new `aiBlock` (id not in the previous version) | event `ai.applied` |
| a new `callout` with `kind:"decision"` | event `decision.recorded` |

Edges derived from a document disappear when the reference is removed from the document; they cannot be edited through the relations API.

### 2.4 Export rules (Markdown, plain text) — byte-exact contract

Implemented in `src/lib/editor/next-nodes.ts` (`nextNodeMarkdown`, `nextNodeText`), called by `toMarkdown` / `docText` in
`src/lib/editor/text.ts`. SPNotesCore `MarkdownExport` must produce the same bytes. **Fixtures**: `tests/fixtures/next-nodes/*.json`
with the expected `.md`, `.txt` (and `.html`) next to each — `all-nodes`, `defaults` (every attr at its default), `edge-cases`,
`mixed-document`. `tests/unit/next-nodes.test.ts` compares byte for byte.

Common rules. A *label* is `oneLine(x)`: the string with every run of whitespace containing a newline replaced by one space, then
trimmed; a non-string is `""`. A *uuid* attr that is not a valid UUID is treated as `null` and written lower-case otherwise. In
Markdown every block ends with exactly one `\n`; top-level blocks are joined with `\n` (one blank line between them), runs of 3+
newlines collapse to 2, and the document is trimmed and ends with `\n` (2.x rules, unchanged).

| Node | Markdown | Plain text (search index, word count) |
|---|---|---|
| `mermaid` | ```` ```mermaid\n<code>\n```\n ```` | `<code>` |
| `runCode` | ```` ```<language>\n<code>\n```\n ```` then, **iff `output` is an object with a string `text`** (even empty), `\n` + ```` ```output\n<output.text>\n```\n ```` | `<code>`, then `\n<output.text>` when it is non-empty |
| `chart` | no columns: `<title>\n`, or `[Graphique]\n` when the title is empty. With columns: `<title>\n\n` (omitted when empty) then a GFM table: header `\| c1 \| c2 \|`, separator `\| --- \| --- \|`, one line per row with exactly one cell per column (missing cells empty, extra cells ignored). Cells: `cellText`, then `\|` escaped as `\\\|` | lines joined by `\n`, empty lines dropped: title, columns joined by one space, each row's cells joined by one space (trimmed) |
| `drawing` | `![Dessin](/api/files/<preview>)\n`, or `[Dessin]\n` without a valid `preview` | `Dessin` |
| `pdf` | `[PDF: <name>](/api/files/<attachmentId>)\n` (`[PDF](…)` when the name is empty; no `(…)` part without a valid id), then, when there are annotations, a blank line and one line per annotation: `> ` + the non-empty parts of `p.<page>`, `<text>`, `<note>` joined by ` — ` (space, U+2014, space). `page` is floored, minimum 1 | `PDF: <name>` (or `PDF`), then the annotation lines without `> ` |
| `audio` | `[Audio: <title>](/api/files/<attachmentId>)\n` (same fallbacks as pdf), then, when the transcript has segments with text, a blank line and one line per segment: `[mm:ss] <text>` | `Audio: <title>` (or `Audio`), then one line per segment: `<text>` **without the time code** |
| `queryView` | `[Vue: <title>]\n`, or `[Vue]\n` | `Vue: <title>`, or `Vue` |
| `blockRef` | `[[<pageId>#<blockId>]]\n`; without block id `[[<pageId>]]\n`; without page id `[[]]\n` or `[[#<blockId>]]\n` | empty string |
| `citation` (inline) | `[@<label>]`; when the label is empty `[@<refId>]`; when both are missing `[@?]` | `<label>` (empty when there is none) |
| `bibliography` | `## <title>\n`; `## Références\n` when the title is empty | `<title>`, or `Références` |
| `canvasLink` | `[Canvas](/p/<pageId>)\n`, or `[Canvas]\n` without a valid page id | `Canvas` |

`cellText(v)`: `null` / missing → empty; boolean → `true` / `false`; number → **ECMAScript `Number::toString`**: an integer-valued
finite number prints without a decimal point (`3`, never `3.0`; `-0` prints `0`), other finite numbers print the shortest decimal
that round-trips (`0.1`, `135.5`, `1e+21`, `1.5e-7`), `NaN` / `±Infinity` → empty; string → its label (newlines become one space).

`[mm:ss]`: `t` floored to whole seconds (non-numbers and negatives → 0); `mm = ⌊t/60⌋` on at least two digits and **not capped at 59**
(`[125:03]`), `ss` on two digits.

Transcript and annotation text are indexed for search (each new block atom is one search chunk carrying its block id); attachment,
page and block ids and time codes are not. `summary`, `output.error`, `ink`, `rects` are not exported.

When an export rewrites attachment links (ZIP, standalone HTML / Markdown), `/api/files/<id>` in the forms above is replaced by the
resolved path; nothing else changes.

HTML (print export, `?format=pdf|html`): `src/lib/export/next-nodes-html.ts`, one element per node with class `nx nx-<type>`; a chart
is its data table, a drawing / diagram its stored render, code is never executed. HTML is not part of the cross-platform contract.

---

## 3. Change feed — `GET /api/sync`

`GET /api/sync?since=<rev>&limit=<1..500, default 200>[&kinds=<list>]`

- **Without `kinds`** the answer is the 2.x one, byte for byte: same keys in the same order, tombstones of `page` and `attachment`
  only, and a `head` that ignores the revisions of the new kinds (a 1.x native client sees nothing new).
- **With `kinds`** — a comma list among `task`, `database`, `database_property`, `database_view`, `database_row`, `edge`, `reference`, `canvas`, `concept`, or `kinds=all` — the answer gains one key, **last**:
  `"entities": { "<kind>": [ row, … ] }` (one array per requested kind, in the order above, possibly empty), and `tombstones`
  also contains the tombstones of the requested kinds. An unknown kind → `400 bad_kinds` (the body lists the valid ones).

Windowing is the one of pages, applied to every list together: each list is `since < rev ≤ head`, oldest first, at most `limit` rows;
when at least one list was cut, `more` is `true`, `cursor` is the lowest last revision among the cut lists, and **every** list is
trimmed to `rev ≤ cursor` — nothing is skipped, nothing is sent twice. Call again with `since=cursor` until `more` is `false`
(`cursor == head`). `since > head` → `reset: true` (restart from 0); when `kinds` was given the answer still carries `"entities"` with **one empty
list per requested kind** (`{"task":[],"canvas":[]}` — same keys as a normal answer, never `{}`).

**A cursor is only valid for the set of kinds it was obtained with.** A client that starts asking for a kind it did not ask for
before must read that kind from `since=0` (simplest: keep one cursor for `kinds=all` and, on first run of 2.0, restart from 0;
pages already known are simply overwritten with identical data).

Soft-deleted rows (tasks, databases, database rows, references) stay in the feed as rows with `deletedAt`. **A database follows its
host page**: moving the host page to the trash sets the `deletedAt` of its `database` row to the same instant (new `rev`), restoring
the page puts it back to `null` (new `rev`) — a native client hides / shows the database from that row alone. Its `database_row`s
keep their own `deletedAt` (a row deleted on its own); the rows of a trashed database are hidden through the database. A **tombstone**
`{id, kind, rev, deletedAt}` means the row no longer exists: permanent deletion, including by cascade (purging a database page emits
tombstones for the page, the database, its properties, views and rows; purging a canvas page for the page and the canvas — the
canvas tombstone's `id` is the page id). Re-creating an id removes its tombstone.

Example — everything created by one small scenario, `kinds=all` (the `pages` array and the long lists are abbreviated here, nothing else):

```http
GET /api/sync?kinds=all&since=619750&limit=500
```

```http
HTTP 200
```

```json
{
  "cursor": 619779,
  "head": 619779,
  "more": false,
  "reset": false,
  "serverTime": "2026-11-19T23:28:08.214Z",
  "workspace": {
    "id": "75bbf9cf-0dad-4ae6-b50c-021e50b12457",
    "name": "Note SPBoucher AI"
  },
  "user": {
    "displayName": "Simon-Pierre Boucher"
  },
  "pages": "[… 6 pages, same shape as 2.x …]",
  "attachments": [
    {
      "id": "725b9723-c31a-40a9-b2ca-6b2f7e48c72f",
      "pageId": "a875edb2-ed14-4a41-a91c-8fdf8053f6c1",
      "filename": "memo.mp3",
      "mime": "audio/mpeg",
      "size": 200,
      "sha256": "295cbb667c2d2380418d4c7576c666c4f1690de2a2433f0e301bd5923377f8ed",
      "pageCount": null,
      "createdAt": "2026-11-19T23:28:08.202Z",
      "deletedAt": null,
      "rev": 619779
    }
  ],
  "tombstones": [],
  "tags": [
    {
      "name": "31999de6",
      "color": "gray"
    },
    {
      "name": "garch",
      "color": "gray"
    },
    {
      "name": "hors-ligne",
      "color": "gray"
    },
    {
      "name": "it-3de28bc7",
      "color": "gray"
    },
    {
      "name": "journal",
      "color": "gray"
    },
    {
      "name": "offline",
      "color": "gray"
    },
    {
      "name": "thèse",
      "color": "gray"
    }
  ],
  "entities": {
    "task": [
      {
        "id": "910c305f-64c6-4d08-b584-28fbeb6fcc29",
        "pageId": "a875edb2-ed14-4a41-a91c-8fdf8053f6c1",
        "blockId": "FKmM69LEHF",
        "title": "Relire la section 2",
        "status": "todo",
        "priority": "high",
        "dueAt": "2026-11-25T12:00:00.000Z",
        "completedAt": null,
        "project": null,
        "createdAt": "2026-11-19T23:28:08.099Z",
        "updatedAt": "2026-11-19T23:28:08.099Z",
        "deletedAt": null,
        "rev": 619757
      },
      "… 1 more"
    ],
    "database": [
      {
        "id": "b7b47434-f9a0-4267-a6fc-433e0ea48b5a",
        "pageId": "db26dee6-75cf-43ef-bfb3-df26094e1661",
        "name": "Exemple · Lectures",
        "description": null,
        "icon": null,
        "isTemplate": false,
        "templateOf": null,
        "createdAt": "2026-11-19T23:28:08.188Z",
        "updatedAt": "2026-11-19T23:28:08.188Z",
        "deletedAt": null,
        "rev": 619773
      }
    ],
    "database_property": [
      {
        "id": "5baddb10-dcbb-46ba-86d5-878db2099eed",
        "databaseId": "b7b47434-f9a0-4267-a6fc-433e0ea48b5a",
        "name": "Name",
        "type": "title",
        "config": {},
        "position": 0,
        "width": 260,
        "createdAt": "2026-11-19T23:28:08.189Z",
        "rev": 619774
      },
      "… 1 more"
    ],
    "database_view": [
      {
        "id": "69eb4f2b-0fff-481c-b994-9a783cdd80fc",
        "databaseId": "b7b47434-f9a0-4267-a6fc-433e0ea48b5a",
        "name": "Table",
        "type": "table",
        "config": {},
        "position": 0,
        "isDefault": true,
        "createdAt": "2026-11-19T23:28:08.189Z",
        "rev": 619775
      }
    ],
    "database_row": [
      {
        "id": "0660e2fc-499b-44b9-86d9-115fc7d257ab",
        "databaseId": "b7b47434-f9a0-4267-a6fc-433e0ea48b5a",
        "pageId": "67a70821-dc3a-4d76-8ade-6602d6cc873c",
        "values": {
          "5baddb10-dcbb-46ba-86d5-878db2099eed": "Engle (1982)",
          "626cdc7c-1ae3-4281-b5ca-a9439fa8d737": 1982
        },
        "position": 1,
        "createdAt": "2026-11-19T23:28:08.197Z",
        "updatedAt": "2026-11-19T23:28:08.197Z",
        "deletedAt": null,
        "rev": 619778
      }
    ],
    "edge": [
      {
        "id": "ec20b9d6-21ba-4294-b3e3-ed9fd4e895af",
        "fromId": "a875edb2-ed14-4a41-a91c-8fdf8053f6c1",
        "toId": "d50d7a0b-4ae3-4740-be08-4e27790f0254",
        "sourceKind": "page",
        "targetKind": "page",
        "kind": "link",
        "relType": "related",
        "origin": "system",
        "status": "accepted",
        "confidence": null,
        "rationale": null,
        "note": null,
        "model": null,
        "validFrom": null,
        "validTo": null,
        "sourceBlockId": "dSno8OQ_kP",
        "targetBlockId": null,
        "createdAt": "2026-11-19T23:28:08.099Z",
        "updatedAt": "2026-11-19T23:28:08.099Z",
        "decidedAt": null,
        "rev": 619755
      },
      "… 2 more"
    ],
    "reference": [
      {
        "id": "07cd9555-0e33-4006-af38-9005598bdde8",
        "pageId": null,
        "citeKey": "tim1986generalized",
        "entryType": "article",
        "title": "Generalized autoregressive conditional heteroskedasticity",
        "authors": [
          "Bollerslev, Tim"
        ],
        "year": 1986,
        "journal": "Journal of Econometrics",
        "doi": null,
        "url": null,
        "bibtex": "@article{tim1986generalized,\n  author  = {Bollerslev, Tim},\n  title   = {Generalized autoregressive conditional heteroskedasticity},\n  journal = {Journal of Econometrics},\n  year    = {1986}\n}",
        "fields": {
          "year": "1986",
          "title": "Generalized autoregressive conditional heteroskedasticity",
          "author": "Bollerslev, Tim",
          "journal": "Journal of Econometrics"
        },
        "verified": "user",
        "attachmentId": null,
        "createdAt": "2026-11-19T23:28:08.087Z",
        "updatedAt": "2026-11-19T23:28:08.087Z",
        "deletedAt": null,
        "rev": 619752
      }
    ],
    "canvas": [
      {
        "id": "495f8abd-a19d-485b-acc1-377b4e43ddd3",
        "pageId": "495f8abd-a19d-485b-acc1-377b4e43ddd3",
        "data": {
          "edges": [
            {
              "id": "e1",
              "to": "n2",
              "from": "n1",
              "kind": "arrow",
              "label": "motive"
            }
          ],
          "nodes": [
            {
              "h": 120,
              "w": 240,
              "x": 0,
              "y": 0,
              "z": 0,
              "id": "n1",
              "kind": "page",
              "pageId": "a875edb2-ed14-4a41-a91c-8fdf8053f6c1"
            },
            {
              "h": 80,
              "w": 200,
              "x": 320,
              "y": 20,
              "z": 1,
              "id": "n2",
              "kind": "text",
              "text": "Hypothèse H1",
              "color": "#3157d5"
            }
          ],
          "format": "spn-canvas-1",
          "viewport": {
            "x": 0,
            "y": 0,
            "zoom": 1
          }
        },
        "version": 2,
        "createdAt": "2026-11-19T23:28:08.160Z",
        "updatedAt": "2026-11-19T23:28:08.169Z",
        "rev": 619770
      }
    ],
    "concept": [
      {
        "id": "4f1e5a5c-ef5f-4310-b35a-daded50f3f26",
        "name": "Exemple · hétéroscédasticité",
        "description": "Variance non constante",
        "origin": "user",
        "status": "accepted",
        "model": null,
        "createdAt": "2026-11-19T23:28:08.148Z",
        "updatedAt": "2026-11-19T23:28:08.154Z",
        "decidedAt": "2026-11-19T23:28:08.149Z",
        "rev": 619767
      }
    ]
  }
}
```

The same server, asked without `kinds` right after (2.x shape):

```http
GET /api/sync?since=619779&limit=5
```

```http
HTTP 200
```

```json
{
  "cursor": 619779,
  "head": 619779,
  "more": false,
  "reset": false,
  "serverTime": "2026-11-19T23:28:08.218Z",
  "workspace": {
    "id": "75bbf9cf-0dad-4ae6-b50c-021e50b12457",
    "name": "Note SPBoucher AI"
  },
  "user": {
    "displayName": "Simon-Pierre Boucher"
  },
  "pages": [],
  "attachments": [],
  "tombstones": [],
  "tags": [
    {
      "name": "31999de6",
      "color": "gray"
    },
    {
      "name": "garch",
      "color": "gray"
    },
    {
      "name": "hors-ligne",
      "color": "gray"
    },
    {
      "name": "it-3de28bc7",
      "color": "gray"
    },
    {
      "name": "journal",
      "color": "gray"
    },
    {
      "name": "offline",
      "color": "gray"
    },
    {
      "name": "thèse",
      "color": "gray"
    }
  ]
}
```

```http
GET /api/sync?kinds=task,unicorn
```

```http
HTTP 400
```

```json
{
  "error": "Unknown kind: unicorn",
  "code": "bad_kinds",
  "kinds": [
    "task",
    "database",
    "database_property",
    "database_view",
    "database_row",
    "edge",
    "reference",
    "canvas",
    "concept"
  ]
}
```

### 3.1 Row shape per kind

Keys are always present and always in this order. `rev` is last. Types: `uuid`, `string`, `int`, `number`, `bool`, `date` (ISO
string), `json`; `?` = nullable.

| kind | keys (in order) |
|---|---|
| `task` | `id` uuid · `pageId` uuid? · `blockId` string? (block id of the `taskItem`) · `title` string · `status` `todo\|doing\|done` · `priority` `low\|medium\|high`? · `dueAt` date? · `completedAt` date? · `project` string? · `createdAt` date · `updatedAt` date · `deletedAt` date? · `rev` int |
| `database` | `id` uuid · `pageId` uuid (host page) · `name` string · `description` string? · `icon` string? · `isTemplate` bool · `templateOf` uuid? · `createdAt` · `updatedAt` · `deletedAt` date? · `rev` |
| `database_property` | `id` uuid · `databaseId` uuid · `name` string · `type` (`title text number date checkbox status select multi_select url file relation rollup formula created_time last_edited_time ai`) · `config` json · `position` int · `width` int? · `createdAt` · `rev` |
| `database_view` | `id` uuid · `databaseId` uuid · `name` string · `type` (`table board calendar gallery timeline list`) · `config` json (`filter, sorts, groupBy, hidden, …`) · `position` int · `isDefault` bool · `createdAt` · `rev` |
| `database_row` | `id` uuid · `databaseId` uuid · `pageId` uuid (the row's page, itself in `pages`) · `values` json (keyed by property id; stored values only — relations, rollups and formulas are computed, use `POST /api/query` or the database routes) · `position` number · `createdAt` · `updatedAt` · `deletedAt` date? · `rev` |
| `edge` | `id` uuid · `fromId` uuid · `toId` uuid · `sourceKind` · `targetKind` (`page\|reference\|concept`) · `kind` (`link` document link · `cites` citation · `relation` typed relation · `ai_suggested` 2.x link suggestion) · `relType` (`related`, `supports`, `contradicts`, `extends`, `example_of`, `part_of`, `cites`, `precedes`, `follows`, `about`, `answers`, `duplicates`) · `origin` (`user\|ai\|system`) · `status` (`suggested\|accepted\|rejected`) · `confidence` number? · `rationale` string? · `note` string? · `model` string? · `validFrom` date? · `validTo` date? · `sourceBlockId` string? · `targetBlockId` string? · `createdAt` · `updatedAt` · `decidedAt` date? · `rev` |
| `reference` | `id` uuid · `pageId` uuid? · `citeKey` string · `entryType` string · `title` string · `authors` string[] · `year` int? · `journal` string? · `doi` string? · `url` string? · `bibtex` string? · `fields` json · `verified` (`user\|doi_verified\|ai_suggested`) · `attachmentId` uuid? · `createdAt` · `updatedAt` · `deletedAt` date? · `rev` |
| `canvas` | `id` uuid (= `pageId`) · `pageId` uuid · `data` json (`spn-canvas-1`, §4.8) · `version` int · `createdAt` · `updatedAt` · `rev` |
| `concept` | `id` uuid · `name` string · `description` string? · `origin` (`user\|ai`) · `status` (`suggested\|accepted\|rejected`) · `model` string? · `createdAt` · `updatedAt` · `decidedAt` date? · `rev` |

The concept ↔ page links are not a kind of their own: a change of a concept's page links bumps the concept's `rev`; read the links
with `GET /api/concepts/<id>`.

Writes stay on the REST routes; there is no upload through `/api/sync`.

---

## 4.2 Tasks

A task is a row of `tasks` (the source of truth), optionally anchored to a page (`pageId`) and to a `taskItem` of that page
(`blockId`). Task object = the stored row:

`{ id, workspaceId, pageId, title, status, priority, dueAt, completedAt, project, createdAt, updatedAt, deletedAt, rev, blockId }`

`status`: `todo | doing | done` (`doing` is used by the research workspace). `completedAt` is set when the status becomes `done`,
cleared otherwise.

### `POST /api/tasks`

Body: `id?` uuid · `title` string 1…500 (trimmed) · `dueAt?` \| `due?` — ISO datetime **with offset**, or a bare date
`YYYY-MM-DD`, or null · `priority?` `low|medium|high` (default `medium`) · `project?` string ≤ 100 \| null · `pageId?` uuid \| null ·
`blockId?` string ≤ 64 \| null · `status?` `todo|doing|done` (default `todo`).

`due` is an alias of `dueAt` (`dueAt` wins when both are sent). **A bare date is stored at 12:00 UTC of that day**, so that it is
the same calendar day in every time zone from UTC−11 to UTC+11; a client that shows only the date reads the UTC date part.

→ `201` task. With an `id` that already exists: `200`, `x-existing: 1`, the stored task. Errors: `400` (validation),
`400 bad_page` (the page is not a page of the workspace), `409 id_taken`.

```http
POST /api/tasks

{
  "id": "d222d0f5-4dd7-42da-a848-c1f7b1dc5d55",
  "title": "Envoyer le plan au directeur",
  "due": "2026-11-21",
  "priority": "medium",
  "pageId": "a875edb2-ed14-4a41-a91c-8fdf8053f6c1"
}
```

```http
HTTP 201
```

```json
{
  "id": "d222d0f5-4dd7-42da-a848-c1f7b1dc5d55",
  "workspaceId": "75bbf9cf-0dad-4ae6-b50c-021e50b12457",
  "pageId": "a875edb2-ed14-4a41-a91c-8fdf8053f6c1",
  "title": "Envoyer le plan au directeur",
  "status": "todo",
  "priority": "medium",
  "dueAt": "2026-11-21T12:00:00.000Z",
  "completedAt": null,
  "project": null,
  "createdAt": "2026-11-19T23:28:08.106Z",
  "updatedAt": "2026-11-19T23:28:08.106Z",
  "deletedAt": null,
  "rev": 619758,
  "blockId": null
}
```

The same request sent again (lost answer, retry):

```http
POST /api/tasks

{
  "id": "d222d0f5-4dd7-42da-a848-c1f7b1dc5d55",
  "title": "Envoyer le plan au directeur"
}
```

```http
HTTP 200
x-existing: 1
```

```json
{
  "id": "d222d0f5-4dd7-42da-a848-c1f7b1dc5d55",
  "workspaceId": "75bbf9cf-0dad-4ae6-b50c-021e50b12457",
  "pageId": "a875edb2-ed14-4a41-a91c-8fdf8053f6c1",
  "title": "Envoyer le plan au directeur",
  "status": "todo",
  "priority": "medium",
  "dueAt": "2026-11-21T12:00:00.000Z",
  "completedAt": null,
  "project": null,
  "createdAt": "2026-11-19T23:28:08.106Z",
  "updatedAt": "2026-11-19T23:28:08.106Z",
  "deletedAt": null,
  "rev": 619758,
  "blockId": null
}
```

```http
POST /api/tasks

{
  "title": "x",
  "pageId": "9938bc75-88fe-4863-bf9f-63ffa7b2123d"
}
```

```http
HTTP 400
```

```json
{
  "error": "Unknown page",
  "code": "bad_page"
}
```

### `GET /api/tasks`

`?done=1` (include done tasks) · `?pageId=<uuid>` · `?since=<rev>` (delta: the tasks whose `rev` is greater, **deleted ones
included**, whatever `done`, oldest revision first; for a complete, paged feed use `/api/sync?kinds=task`). → array (≤ 500), open
first, then by `dueAt` (nulls last), then newest. Keys: the
12 keys of 2.x in the same order (`id, title, status, priority, dueAt, completedAt, project, pageId, createdAt, updatedAt, pageTitle,
pageIcon`) followed by `blockId, deletedAt, rev`.

```http
GET /api/tasks?pageId=a875edb2-ed14-4a41-a91c-8fdf8053f6c1&done=1
```

```http
HTTP 200
```

```json
[
  {
    "id": "910c305f-64c6-4d08-b584-28fbeb6fcc29",
    "title": "Relire la section 2",
    "status": "todo",
    "priority": "high",
    "dueAt": "2026-11-25T12:00:00.000Z",
    "completedAt": null,
    "project": null,
    "pageId": "a875edb2-ed14-4a41-a91c-8fdf8053f6c1",
    "createdAt": "2026-11-19T23:28:08.099Z",
    "updatedAt": "2026-11-19T23:28:08.099Z",
    "pageTitle": "Exemple · Revue de littérature",
    "pageIcon": null,
    "blockId": "FKmM69LEHF",
    "deletedAt": null,
    "rev": 619757
  },
  {
    "id": "d222d0f5-4dd7-42da-a848-c1f7b1dc5d55",
    "title": "Envoyer le plan au directeur",
    "status": "done",
    "priority": "medium",
    "dueAt": "2026-11-21T12:00:00.000Z",
    "completedAt": "2026-11-19T23:28:08.113Z",
    "project": null,
    "pageId": "a875edb2-ed14-4a41-a91c-8fdf8053f6c1",
    "createdAt": "2026-11-19T23:28:08.106Z",
    "updatedAt": "2026-11-19T23:28:08.113Z",
    "pageTitle": "Exemple · Revue de littérature",
    "pageIcon": null,
    "blockId": null,
    "deletedAt": null,
    "rev": 619759
  }
]
```

### `GET /api/tasks/<id>` · `PATCH /api/tasks/<id>` · `DELETE /api/tasks/<id>`

- `GET` → the task, in any state (a deleted task answers `200` with `deletedAt`). `404 not_found`.
- `PATCH` body: any of `title, status, priority, dueAt | due, project, pageId, blockId` (same types as POST) → the task.
  `404 not_found` (unknown or deleted), `400 bad_page`. Setting `pageId: null` without `blockId` also clears `blockId`.
- `DELETE` → soft delete, `200 {"ok":true,"deleted":true}`; **idempotent**: on an already deleted task
  `200 {"ok":true,"deleted":false}` — and the same for an unknown id (§0.5; it answered `404` before the integration pass).

```http
PATCH /api/tasks/d222d0f5-4dd7-42da-a848-c1f7b1dc5d55

{
  "status": "done"
}
```

```http
HTTP 200
```

```json
{
  "id": "d222d0f5-4dd7-42da-a848-c1f7b1dc5d55",
  "workspaceId": "75bbf9cf-0dad-4ae6-b50c-021e50b12457",
  "pageId": "a875edb2-ed14-4a41-a91c-8fdf8053f6c1",
  "title": "Envoyer le plan au directeur",
  "status": "done",
  "priority": "medium",
  "dueAt": "2026-11-21T12:00:00.000Z",
  "completedAt": "2026-11-19T23:28:08.113Z",
  "project": null,
  "createdAt": "2026-11-19T23:28:08.106Z",
  "updatedAt": "2026-11-19T23:28:08.113Z",
  "deletedAt": null,
  "rev": 619759,
  "blockId": null
}
```

```http
DELETE /api/tasks/d222d0f5-4dd7-42da-a848-c1f7b1dc5d55
```

```http
HTTP 200
```

```json
{
  "ok": true,
  "deleted": true
}
```

```http
DELETE /api/tasks/d222d0f5-4dd7-42da-a848-c1f7b1dc5d55
```

```http
HTTP 200
```

```json
{
  "ok": true,
  "deleted": false
}
```

The 2.x forms still work and are unchanged: `PATCH /api/tasks` with `id` in the body, `DELETE /api/tasks?id=` (answers `404` when the
task is already deleted).

### Tasks and documents

`taskItem` attrs (SPEC §2): `checked`, `due` (ISO date or datetime), `priority`, `taskId`. When a page is saved:

1. A `taskItem` whose `taskId` (a UUID chosen by the client) **is not stored yet** creates the task: `title` = the text of the
   item's first block (≤ 500 chars; `Tâche` when empty), `status` from `checked`, `due`, `priority`, `pageId` = the page,
   `blockId` = the item's block id. An offline client therefore needs one write path only: put a fresh UUID in `taskId` and save
   the page. (Creating the task first with `POST /api/tasks {id}` and then saving the page is equivalent.)
2. For a stored task, **only what changed in the document since the previous save of that page** is applied: `checked` ↔ `status`
   (`done` / `todo`), item text → `title`, `due` → `dueAt`, `priority`. The task is (re-)anchored to the item (`pageId`, `blockId`).
3. Removing the item does not delete the task. A `taskId` of another workspace, or of a deleted task, is ignored.

The other direction is **not** automatic: `PATCH /api/tasks/<id> {status:"done"}` does not rewrite the page (it would bump the page
`version` under an open editor). The client that completes a linked task from a task list should also set `checked` on the item when
it has the page open; if it does not, the task stays `done` (rule 2: a later save of the page that did not touch that item never
reverts it) and the box stays unchecked until someone ticks it. `GET /api/tasks/<id>` gives the anchor:

```http
GET /api/tasks/910c305f-64c6-4d08-b584-28fbeb6fcc29
```

```http
HTTP 200
```

```json
{
  "id": "910c305f-64c6-4d08-b584-28fbeb6fcc29",
  "workspaceId": "75bbf9cf-0dad-4ae6-b50c-021e50b12457",
  "pageId": "a875edb2-ed14-4a41-a91c-8fdf8053f6c1",
  "title": "Relire la section 2",
  "status": "todo",
  "priority": "high",
  "dueAt": "2026-11-25T12:00:00.000Z",
  "completedAt": null,
  "project": null,
  "createdAt": "2026-11-19T23:28:08.099Z",
  "updatedAt": "2026-11-19T23:28:08.099Z",
  "deletedAt": null,
  "rev": 619757,
  "blockId": "FKmM69LEHF"
}
```

Events: `task.created`, `task.completed`, `task.reopened` (§4.4), with `data.via` = `document | inbox | research | agent` when the task
was not written through `/api/tasks`.

---

## 4.3 Knowledge graph 2.0

### Model

An **edge** (row of `knowledge_edges`, kind `edge` of the feed) joins two nodes; a node is a page, a reference or a concept
(`sourceKind` / `targetKind`). `kind` is the family, `relType` the meaning:

| `kind` | Written by | `origin` | Editable |
|---|---|---|---|
| `link` | saving a document (mention, link, `blockRef`, `canvasLink`) | `system` | no (`409 derived_edge`) |
| `cites` | saving a document (`citation`) | `system` | no |
| `relation` | `POST /api/graph/relations` (user), analysis jobs (AI) | `user` \| `ai` | yes |
| `ai_suggested` | 2.x link suggestions (`/api/graph/suggestions`, unchanged) | `ai` | accept / reject only |

`relType` ∈ `related`, `supports`, `contradicts`, `extends`, `example_of`, `part_of`, `cites`, `precedes`, `follows`, `about`, `answers`, `duplicates`. Several relations of different types may join the same two nodes; (`fromId`, `toId`, `kind`, `relType`)
is unique. Direction matters: `fromId` —relType→ `toId`.

**Anything created by a model is `status: "suggested"`, `origin: "ai"`, and stays so until the user decides** (`PATCH … {status}`).
`origin` never changes: an accepted AI relation is `origin: "ai", status: "accepted"`. Clients must mark `origin: "ai"` visibly.

### `POST /api/graph/relations`

Body: `id?` uuid · `fromId` uuid · `toId` uuid · `sourceKind?` · `targetKind?` (`page|reference|concept`, default `page`) · `relType`
· `note?` string ≤ 2 000 \| null · `validFrom?` · `validTo?` ISO datetime with offset \| null · `sourceBlockId?` · `targetBlockId?`
string ≤ 64 \| null.

→ `201` relation (`origin: "user"`, `status: "accepted"`, `decidedAt` set). Idempotent on `id` (`200`, `x-existing: 1`).
Errors: `400` validation · `400 bad_node` (a node does not exist, is trashed, or both ends are the same node; `field` = `fromId` or `toId` — `toId` when both ends are the same node) ·
`400 bad_request` (`validTo` before `validFrom`) · `409 relation_exists` (same from, to, relType; `id` and `status` of the existing one) ·
`409 id_taken`.

```http
POST /api/graph/relations

{
  "fromId": "d50d7a0b-4ae3-4740-be08-4e27790f0254",
  "toId": "a875edb2-ed14-4a41-a91c-8fdf8053f6c1",
  "relType": "supports",
  "note": "Les données appuient la revue",
  "validFrom": "2026-01-01T00:00:00Z"
}
```

```http
HTTP 201
```

```json
{
  "id": "72693b47-4de2-4c4c-9f23-e9bf70169092",
  "fromId": "d50d7a0b-4ae3-4740-be08-4e27790f0254",
  "toId": "a875edb2-ed14-4a41-a91c-8fdf8053f6c1",
  "sourceKind": "page",
  "targetKind": "page",
  "kind": "relation",
  "relType": "supports",
  "origin": "user",
  "status": "accepted",
  "confidence": null,
  "rationale": null,
  "note": "Les données appuient la revue",
  "model": null,
  "validFrom": "2026-01-01T00:00:00.000Z",
  "validTo": null,
  "sourceBlockId": null,
  "targetBlockId": null,
  "createdAt": "2026-11-19T23:28:08.136Z",
  "updatedAt": "2026-11-19T23:28:08.136Z",
  "decidedAt": "2026-11-19T23:28:08.136Z",
  "rev": 619764,
  "fromTitle": "Exemple · Données",
  "toTitle": "Exemple · Revue de littérature"
}
```

```http
POST /api/graph/relations

{
  "fromId": "d50d7a0b-4ae3-4740-be08-4e27790f0254",
  "toId": "a875edb2-ed14-4a41-a91c-8fdf8053f6c1",
  "relType": "supports"
}
```

```http
HTTP 409
```

```json
{
  "error": "This relation already exists",
  "code": "relation_exists",
  "id": "72693b47-4de2-4c4c-9f23-e9bf70169092",
  "status": "accepted"
}
```

### `GET /api/graph/relations`

`?nodeId=<uuid>` (relations touching that node) · `?status=` · `?relType=` · `?origin=` · `?include=cites,ai_suggested,link` (adds
those families; default: kind `relation` only). → `{ "relations": [ … ] }`, newest first, ≤ 500. Relation object = the `edge` row of
the feed + `fromTitle`, `toTitle`.

```http
GET /api/graph/relations?nodeId=a875edb2-ed14-4a41-a91c-8fdf8053f6c1&include=cites
```

```http
HTTP 200
```

```json
{
  "relations": [
    {
      "id": "72693b47-4de2-4c4c-9f23-e9bf70169092",
      "fromId": "d50d7a0b-4ae3-4740-be08-4e27790f0254",
      "toId": "a875edb2-ed14-4a41-a91c-8fdf8053f6c1",
      "sourceKind": "page",
      "targetKind": "page",
      "kind": "relation",
      "relType": "extends",
      "origin": "user",
      "status": "accepted",
      "confidence": null,
      "rationale": null,
      "note": null,
      "model": null,
      "validFrom": "2026-01-01T00:00:00.000Z",
      "validTo": null,
      "sourceBlockId": null,
      "targetBlockId": null,
      "createdAt": "2026-11-19T23:28:08.136Z",
      "updatedAt": "2026-11-19T23:28:08.143Z",
      "decidedAt": "2026-11-19T23:28:08.136Z",
      "rev": 619765,
      "fromTitle": "Exemple · Données",
      "toTitle": "Exemple · Revue de littérature"
    },
    {
      "id": "af53442d-1347-4ff3-ad2f-d5b6550f9222",
      "fromId": "a875edb2-ed14-4a41-a91c-8fdf8053f6c1",
      "toId": "07cd9555-0e33-4006-af38-9005598bdde8",
      "sourceKind": "page",
      "targetKind": "reference",
      "kind": "cites",
      "relType": "cites",
      "origin": "system",
      "status": "accepted",
      "confidence": null,
      "rationale": null,
      "note": null,
      "model": null,
      "validFrom": null,
      "validTo": null,
      "sourceBlockId": "dSno8OQ_kP",
      "targetBlockId": null,
      "createdAt": "2026-11-19T23:28:08.099Z",
      "updatedAt": "2026-11-19T23:28:08.099Z",
      "decidedAt": null,
      "rev": 619756,
      "fromTitle": "Exemple · Revue de littérature",
      "toTitle": "Generalized autoregressive conditional heteroskedasticity"
    }
  ]
}
```

### `GET | PATCH | DELETE /api/graph/relations/<id>`

- `PATCH` body: any of `status` (`accepted|rejected|suggested`), `relType`, `note`, `validFrom`, `validTo` → relation. A status
  change sets `decidedAt` (null when put back to `suggested`). `409 derived_edge` for `link` / `cites`; an `ai_suggested` edge accepts
  only `status` (2.x behaviour kept: accepting it creates the backlink). `409 relation_exists` when the new `relType` collides.
- `DELETE` → `{"ok":true}`, idempotent (§0.5: an unknown or already deleted id answers the same `200`, and writes no second
  `relation.removed` event); only kind `relation` (`409 derived_edge` otherwise; a link suggestion is rejected, not deleted).

```http
PATCH /api/graph/relations/72693b47-4de2-4c4c-9f23-e9bf70169092

{
  "relType": "extends",
  "note": null
}
```

```http
HTTP 200
```

```json
{
  "id": "72693b47-4de2-4c4c-9f23-e9bf70169092",
  "fromId": "d50d7a0b-4ae3-4740-be08-4e27790f0254",
  "toId": "a875edb2-ed14-4a41-a91c-8fdf8053f6c1",
  "sourceKind": "page",
  "targetKind": "page",
  "kind": "relation",
  "relType": "extends",
  "origin": "user",
  "status": "accepted",
  "confidence": null,
  "rationale": null,
  "note": null,
  "model": null,
  "validFrom": "2026-01-01T00:00:00.000Z",
  "validTo": null,
  "sourceBlockId": null,
  "targetBlockId": null,
  "createdAt": "2026-11-19T23:28:08.136Z",
  "updatedAt": "2026-11-19T23:28:08.143Z",
  "decidedAt": "2026-11-19T23:28:08.136Z",
  "rev": 619765,
  "fromTitle": "Exemple · Données",
  "toTitle": "Exemple · Revue de littérature"
}
```

### `GET /api/graph?view=…`

`view` ∈ `global | local | project | timeline | concepts | documents | references`. **Without `view` the 2.x answer is returned
unchanged** (`{nodes, edges, center, stats:{pages, edges, suggested}}` with the 2.x node / edge shapes and query parameters).

| Parameter | |
|---|---|
| `pageId` | required for `local` (the centre) and `project` (the root page of the project) |
| `depth` | `local` only, 1…4 (default 1) |
| `from`, `to` | `timeline`: ISO dates (default: the last 90 days) |
| `suggestions=0` | hide `suggested` edges, concepts and concept links |
| `hideOrphans=1` | drop nodes without an edge in the view |

| View | Pages | Also |
|---|---|---|
| `global` | every live page | all references, all concepts |
| `local` | the page and its neighbours up to `depth` hops | their references, concepts, attachments |
| `project` | the root page and its sub-pages; pages one hop outside are kept with `external: true` | linked references and concepts |
| `timeline` | pages created or modified in the range | only edges created in the range (or whose validity interval overlaps it); `range` and `buckets` (per UTC day: pages created, pages modified, edges created) |
| `concepts` | pages linked to a concept | all concepts; only `about` edges and edges touching a concept |
| `documents` | pages of the section `documents` | their attachments, linked references |
| `references` | pages that own or cite a reference | all references; only edges touching a reference |

Answer: `{ view, nodes, edges, center, [range, buckets,] stats: {pages, references, concepts, edges, suggested} }`.

- **Node**: `id` (the page uuid; `ref:<uuid>`, `concept:<uuid>`, `att:<uuid>` for the other kinds) · `entityId` (the bare uuid) ·
  `kind` (`page|database|research|row|canvas|reference|concept|attachment`) · `title` · `icon` · `section` · `createdAt` · `updatedAt` ·
  `databaseId` · `degree`, `in`, `out` (within the view) · `status`, `origin` (concepts) · `external` (project view).
  Sorted by degree (desc), then title, then id.
- **Edge**: `id` · `source`, `target` (node ids) · `kind` (`link` · `typed` = a relation of kind `relation` · `ai_suggested` · `cites` ·
  `reference` = a reference attached to a page · `about` = page → concept · `relation` = a **database** relation, `sub` = property
  name · `attachment`) · `relType` · `origin` · `status` · `confidence` · `rationale` · `note` · `model` · `validFrom` · `validTo` ·
  `sourceBlockId` · `targetBlockId` · `createdAt` · `sub`. Edges with a real row carry its uuid as `id` (usable with the relations
  routes); synthetic ones have ids starting with `e-`.

```http
GET /api/graph?view=local&pageId=a875edb2-ed14-4a41-a91c-8fdf8053f6c1&depth=1
```

```http
HTTP 200
```

```json
{
  "view": "local",
  "nodes": [
    {
      "id": "a875edb2-ed14-4a41-a91c-8fdf8053f6c1",
      "entityId": "a875edb2-ed14-4a41-a91c-8fdf8053f6c1",
      "kind": "page",
      "title": "Exemple · Revue de littérature",
      "icon": null,
      "section": "projects",
      "createdAt": "2026-11-19T23:28:08.098Z",
      "updatedAt": "2026-11-19T23:28:08.098Z",
      "databaseId": null,
      "degree": 5,
      "in": 1,
      "out": 4
    },
    {
      "id": "d50d7a0b-4ae3-4740-be08-4e27790f0254",
      "entityId": "d50d7a0b-4ae3-4740-be08-4e27790f0254",
      "kind": "page",
      "title": "Exemple · Données",
      "icon": null,
      "section": "projects",
      "createdAt": "2026-11-19T23:28:08.091Z",
      "updatedAt": "2026-11-19T23:28:08.091Z",
      "databaseId": null,
      "degree": 2,
      "in": 1,
      "out": 1
    },
    {
      "id": "concept:4f1e5a5c-ef5f-4310-b35a-daded50f3f26",
      "entityId": "4f1e5a5c-ef5f-4310-b35a-daded50f3f26",
      "kind": "concept",
      "title": "Exemple · hétéroscédasticité",
      "icon": null,
      "section": null,
      "createdAt": "2026-11-19T23:28:08.148Z",
      "updatedAt": "2026-11-19T23:28:08.154Z",
      "databaseId": null,
      "degree": 1,
      "in": 1,
      "out": 0,
      "status": "accepted",
      "origin": "user"
    },
    {
      "id": "ref:07cd9555-0e33-4006-af38-9005598bdde8",
      "entityId": "07cd9555-0e33-4006-af38-9005598bdde8",
      "kind": "reference",
      "title": "Generalized autoregressive conditional heteroskedasticity",
      "icon": null,
      "section": null,
      "createdAt": "2026-11-19T23:28:08.087Z",
      "updatedAt": "2026-11-19T23:28:08.087Z",
      "databaseId": null,
      "degree": 1,
      "in": 1,
      "out": 0
    },
    {
      "id": "att:725b9723-c31a-40a9-b2ca-6b2f7e48c72f",
      "entityId": "725b9723-c31a-40a9-b2ca-6b2f7e48c72f",
      "kind": "attachment",
      "title": "memo.mp3",
      "icon": null,
      "section": null,
      "createdAt": "2026-11-19T23:28:08.202Z",
      "updatedAt": "2026-11-19T23:28:08.202Z",
      "databaseId": null,
      "degree": 1,
      "in": 1,
      "out": 0
    },
    {
      "id": "495f8abd-a19d-485b-acc1-377b4e43ddd3",
      "entityId": "495f8abd-a19d-485b-acc1-377b4e43ddd3",
      "kind": "canvas",
      "title": "Exemple · Carte du projet",
      "icon": null,
      "section": "projects",
      "createdAt": "2026-11-19T23:28:08.160Z",
      "updatedAt": "2026-11-19T23:28:08.170Z",
      "databaseId": null,
      "degree": 0,
      "in": 0,
      "out": 0
    }
  ],
  "edges": [
    {
      "relType": "about",
      "origin": "user",
      "status": "accepted",
      "confidence": null,
      "rationale": null,
      "note": null,
      "model": null,
      "validFrom": null,
      "validTo": null,
      "sourceBlockId": null,
      "targetBlockId": null,
      "createdAt": "2026-11-19T23:28:08.148Z",
      "sub": null,
      "id": "e-about-a875edb2-ed14-4a41-a91c-8fdf8053f6c1-4f1e5a5c-ef5f-4310-b35a-daded50f3f26",
      "source": "a875edb2-ed14-4a41-a91c-8fdf8053f6c1",
      "target": "concept:4f1e5a5c-ef5f-4310-b35a-daded50f3f26",
      "kind": "about"
    },
    {
      "id": "ec20b9d6-21ba-4294-b3e3-ed9fd4e895af",
      "source": "a875edb2-ed14-4a41-a91c-8fdf8053f6c1",
      "target": "d50d7a0b-4ae3-4740-be08-4e27790f0254",
      "kind": "link",
      "relType": "related",
      "origin": "system",
      "status": "accepted",
      "confidence": null,
      "rationale": null,
      "note": null,
      "model": null,
      "validFrom": null,
      "validTo": null,
      "sourceBlockId": "dSno8OQ_kP",
      "targetBlockId": null,
      "createdAt": "2026-11-19T23:28:08.099Z",
      "sub": null
    },
    {
      "id": "af53442d-1347-4ff3-ad2f-d5b6550f9222",
      "source": "a875edb2-ed14-4a41-a91c-8fdf8053f6c1",
      "target": "ref:07cd9555-0e33-4006-af38-9005598bdde8",
      "kind": "cites",
      "relType": "cites",
      "origin": "system",
      "status": "accepted",
      "confidence": null,
      "rationale": null,
      "note": null,
      "model": null,
      "validFrom": null,
      "validTo": null,
      "sourceBlockId": "dSno8OQ_kP",
      "targetBlockId": null,
      "createdAt": "2026-11-19T23:28:08.099Z",
      "sub": null
    },
    {
      "id": "72693b47-4de2-4c4c-9f23-e9bf70169092",
      "source": "d50d7a0b-4ae3-4740-be08-4e27790f0254",
      "target": "a875edb2-ed14-4a41-a91c-8fdf8053f6c1",
      "kind": "typed",
      "relType": "extends",
      "origin": "user",
      "status": "accepted",
      "confidence": null,
      "rationale": null,
      "note": null,
      "model": null,
      "validFrom": "2026-01-01T00:00:00.000Z",
      "validTo": null,
      "sourceBlockId": null,
      "targetBlockId": null,
      "createdAt": "2026-11-19T23:28:08.136Z",
      "sub": null
    },
    {
      "relType": "related",
      "origin": "system",
      "status": "accepted",
      "confidence": null,
      "rationale": null,
      "note": null,
      "model": null,
      "validFrom": null,
      "validTo": null,
      "sourceBlockId": null,
      "targetBlockId": null,
      "createdAt": "2026-11-19T23:28:08.202Z",
      "sub": null,
      "id": "e-att-725b9723-c31a-40a9-b2ca-6b2f7e48c72f",
      "source": "a875edb2-ed14-4a41-a91c-8fdf8053f6c1",
      "target": "att:725b9723-c31a-40a9-b2ca-6b2f7e48c72f",
      "kind": "attachment"
    }
  ],
  "center": "a875edb2-ed14-4a41-a91c-8fdf8053f6c1",
  "stats": {
    "pages": 3,
    "references": 1,
    "concepts": 1,
    "edges": 5,
    "suggested": 0
  }
}
```

```http
GET /api/graph?view=timeline&from=2026-11-19T22%3A28%3A08.241Z
```

```http
HTTP 200
```

```json
{
  "view": "timeline",
  "nodes": "[… 9 nodes …]",
  "edges": "[… 4 edges …]",
  "center": null,
  "range": {
    "from": "2026-11-19T22:28:08.241Z",
    "to": "2026-11-19T23:28:08.242Z"
  },
  "buckets": [
    {
      "date": "2026-11-19",
      "created": 7,
      "updated": 0,
      "edges": 4
    }
  ],
  "stats": {
    "pages": 7,
    "references": 1,
    "concepts": 1,
    "edges": 4,
    "suggested": 0
  }
}
```

### Concepts — `GET | POST | PATCH /api/concepts`, `GET | PATCH | DELETE /api/concepts/<id>`

- `GET /api/concepts?status=accepted|suggested|rejected|all&pageId=` → `{ "concepts": [ … ] }` by name (default `accepted`). Concept
  object = the feed row + `pages` (accepted links to live pages) + `suggestedPages`.
- `POST` body: `id?` · `name` 1…120 (whitespace collapsed; unique per workspace, case-insensitive) · `description?` ≤ 2 000 ·
  `pageIds?` uuid[≤ 200] → `201` concept **with `pageLinks`** (`200` + `x-existing: 1` for a known `id`). `409 concept_exists`
  (`id`, `status`) · `400 bad_page` (`pageIds`).
- `GET /api/concepts/<id>` → concept + `pageLinks: [{pageId, title, icon, origin, status, confidence, blockId, model, createdAt}]`.
- `PATCH /api/concepts/<id>` (or `PATCH /api/concepts` with `id` in the body) — any of: `name`, `description`, `status`
  (`accepted|rejected|suggested`), `addPages` uuid[], `removePages` uuid[], `pageLinks: [{pageId, status}]` (accept / reject a
  suggested link) → concept + `pageLinks`. Renaming to the name of another concept → `409 concept_exists` with the `id` and
  `status` of that concept (same body as on create).
- `DELETE /api/concepts/<id>` → `{"ok":true}` (its links and the relations touching it go with it); idempotent (§0.5).

```http
POST /api/concepts

{
  "name": "Exemple · hétéroscédasticité",
  "description": "Variance non constante",
  "pageIds": [
    "a875edb2-ed14-4a41-a91c-8fdf8053f6c1",
    "d50d7a0b-4ae3-4740-be08-4e27790f0254"
  ]
}
```

```http
HTTP 201
```

```json
{
  "id": "4f1e5a5c-ef5f-4310-b35a-daded50f3f26",
  "name": "Exemple · hétéroscédasticité",
  "description": "Variance non constante",
  "origin": "user",
  "status": "accepted",
  "model": null,
  "createdAt": "2026-11-19T23:28:08.148Z",
  "updatedAt": "2026-11-19T23:28:08.148Z",
  "decidedAt": "2026-11-19T23:28:08.149Z",
  "rev": 619766,
  "pages": 2,
  "suggestedPages": 0,
  "pageLinks": [
    {
      "pageId": "d50d7a0b-4ae3-4740-be08-4e27790f0254",
      "title": "Exemple · Données",
      "icon": null,
      "origin": "user",
      "status": "accepted",
      "confidence": null,
      "blockId": null,
      "model": null,
      "createdAt": "2026-11-19T23:28:08.148Z"
    },
    {
      "pageId": "a875edb2-ed14-4a41-a91c-8fdf8053f6c1",
      "title": "Exemple · Revue de littérature",
      "icon": null,
      "origin": "user",
      "status": "accepted",
      "confidence": null,
      "blockId": null,
      "model": null,
      "createdAt": "2026-11-19T23:28:08.148Z"
    }
  ]
}
```

```http
PATCH /api/concepts/4f1e5a5c-ef5f-4310-b35a-daded50f3f26

{
  "removePages": [
    "d50d7a0b-4ae3-4740-be08-4e27790f0254"
  ]
}
```

```http
HTTP 200
```

```json
{
  "id": "4f1e5a5c-ef5f-4310-b35a-daded50f3f26",
  "name": "Exemple · hétéroscédasticité",
  "description": "Variance non constante",
  "origin": "user",
  "status": "accepted",
  "model": null,
  "createdAt": "2026-11-19T23:28:08.148Z",
  "updatedAt": "2026-11-19T23:28:08.154Z",
  "decidedAt": "2026-11-19T23:28:08.149Z",
  "rev": 619767,
  "pages": 1,
  "suggestedPages": 0,
  "pageLinks": [
    {
      "pageId": "a875edb2-ed14-4a41-a91c-8fdf8053f6c1",
      "title": "Exemple · Revue de littérature",
      "icon": null,
      "origin": "user",
      "status": "accepted",
      "confidence": null,
      "blockId": null,
      "model": null,
      "createdAt": "2026-11-19T23:28:08.148Z"
    }
  ]
}
```

### Insights — `GET /api/graph/insights`, `POST /api/graph/insights/run`, `PATCH /api/graph/insights/<id>`

`GET /api/graph/insights?status=suggested|accepted|dismissed|all&kind=&limit=<1..100>&intelligence=0`
→ `{ intelligence, insights, counts }`. **`limit` caps every list of the answer**: each list of `intelligence` *and* `insights`
(newest first). Without `limit`: 20 per `intelligence` list, 200 `insights`. Out-of-range integers are clamped (`0` → 1, `500` → 100,
§0.6); `counts` is never capped (totals per status).

- `intelligence` — **computed from the data at each call, no model**, same data ⇒ same answer (`null` with `intelligence=0`):
  `stats`; `centralPages` (PageRank, damping 0.85, over accepted page → page edges and database relations; with `degree`, `in`,
  `out`); `centralConcepts` (by number of pages); `orphans` (live, non-archived, non-row, non-inbox pages without any accepted edge;
  ≤ 200); `clusters` (connected components of ≥ 2 pages, large ones split by weighted label propagation; `label` = title of the most
  central page; `id` is stable for a given member set); `recurringTopics` (tags and accepted concepts carried by ≥ 2 pages);
  `duplicates` (same normalised title, or same text of ≥ 5 words). `limit` caps each list.
- `insights` — stored findings awaiting a decision: `{ id, kind, status, title, detail, data, origin, model, createdAt, decidedAt }`,
  `kind` ∈ `contradiction | open_question | cluster | recurring_topic | duplicate`, `origin` `system` (deterministic) or `ai`,
  `data.pageIds` always present, `data.blockIds` when passages are cited (`contradiction`: also `data.a`, `data.b` =
  `{pageId, blockId}` and `data.confidence`; `open_question`: `data.source`).
- `counts` — `{suggested, accepted, dismissed}`.

`POST /api/graph/insights/run` — body (required, may be `{}`): `mode?` `all | deterministic | ai` (default `all`) · `pageIds?`
uuid[≤ 40] · `limit?` 2…40 (pages sent to the model, default 24, most recently edited).
The deterministic part (clusters of ≥ 3 pages, recurring topics, duplicates) is done in the request; the AI part (contradictions,
open questions, concept suggestions) is **one job** on the queue `graph-insights` (at most one per workspace per 5 minutes, never
retried automatically). → `202` when a job was queued, `200` otherwise:
`{ mode, deterministic: {created, considered} | null, queued, jobId, [reason] }`. Results appear in `GET /api/graph/insights` as
`suggested`; a finding that cites a page or a block that does not exist is dropped by the server and never stored; a finding already
known (same pages / passages) is not stored twice; a dismissed one does not come back.

```http
POST /api/graph/insights/run

{
  "mode": "deterministic"
}
```

```http
HTTP 200
```

```json
{
  "mode": "deterministic",
  "deterministic": {
    "created": 1,
    "considered": 1
  },
  "queued": false,
  "jobId": null
}
```

```http
GET /api/graph/insights?limit=5
```

```http
HTTP 200
```

```json
{
  "intelligence": {
    "computedAt": "2026-11-19T23:28:08.251Z",
    "stats": {
      "pages": 6,
      "edges": 2,
      "orphans": 4,
      "clusters": 1,
      "concepts": 1,
      "tags": 2
    },
    "centralPages": [
      {
        "id": "a875edb2-ed14-4a41-a91c-8fdf8053f6c1",
        "title": "Exemple · Revue de littérature",
        "icon": null,
        "degree": 1,
        "in": 1,
        "out": 1,
        "pagerank": 0.384615
      },
      {
        "id": "d50d7a0b-4ae3-4740-be08-4e27790f0254",
        "title": "Exemple · Données",
        "icon": null,
        "degree": 1,
        "in": 1,
        "out": 1,
        "pagerank": 0.384615
      }
    ],
    "centralConcepts": [
      {
        "id": "4f1e5a5c-ef5f-4310-b35a-daded50f3f26",
        "name": "Exemple · hétéroscédasticité",
        "status": "accepted",
        "origin": "user",
        "pages": 1
      }
    ],
    "orphans": [
      {
        "id": "db26dee6-75cf-43ef-bfb3-df26094e1661",
        "title": "Exemple · Lectures",
        "icon": null,
        "section": "databases",
        "updatedAt": "2026-11-19T23:28:08.182Z"
      },
      {
        "id": "495f8abd-a19d-485b-acc1-377b4e43ddd3",
        "title": "Exemple · Carte du projet",
        "icon": null,
        "section": "projects",
        "updatedAt": "2026-11-19T23:28:08.170Z"
      },
      {
        "id": "20709b78-b934-40aa-8fa9-8698e5039d5a",
        "title": "Exemple · Thèse",
        "icon": null,
        "section": "projects",
        "updatedAt": "2026-11-19T23:28:08.078Z"
      },
      {
        "id": "acbd524f-4899-4964-8ac7-102ad893d29c",
        "title": "it-f0ea9fbc ia",
        "icon": null,
        "section": "notes",
        "updatedAt": "2026-11-19T23:16:44.139Z"
      }
    ],
    "clusters": [
      {
        "id": "561133d57f20a5a5083a5c83a3e68803e3a6a7ba",
        "size": 2,
        "label": "Exemple · Revue de littérature",
        "pageIds": [
          "a875edb2-ed14-4a41-a91c-8fdf8053f6c1",
          "d50d7a0b-4ae3-4740-be08-4e27790f0254"
        ],
        "top": [
          {
            "id": "a875edb2-ed14-4a41-a91c-8fdf8053f6c1",
            "title": "Exemple · Revue de littérature",
            "icon": null
          },
          {
            "id": "d50d7a0b-4ae3-4740-be08-4e27790f0254",
            "title": "Exemple · Données",
            "icon": null
          }
        ]
      }
    ],
    "recurringTopics": [
      {
        "kind": "tag",
        "id": "e31f9c2e-00f0-4218-8e19-bb8004d5b7a4",
        "name": "thèse",
        "pages": 2,
        "pageIds": [
          "a875edb2-ed14-4a41-a91c-8fdf8053f6c1",
          "d50d7a0b-4ae3-4740-be08-4e27790f0254"
        ],
        "lastActivityAt": "2026-11-19T23:28:08.098Z"
      }
    ],
    "duplicates": []
  },
  "insights": [
    {
      "id": "75c406e6-70d3-417d-b5bd-fca0c6725c68",
      "kind": "recurring_topic",
      "status": "suggested",
      "title": "#thèse",
      "detail": "2 pages",
      "data": {
        "name": "thèse",
        "pages": 2,
        "pageIds": [
          "a875edb2-ed14-4a41-a91c-8fdf8053f6c1",
          "d50d7a0b-4ae3-4740-be08-4e27790f0254"
        ],
        "topicId": "e31f9c2e-00f0-4218-8e19-bb8004d5b7a4",
        "topicKind": "tag"
      },
      "origin": "system",
      "model": null,
      "createdAt": "2026-11-19T23:28:08.248Z",
      "decidedAt": null
    },
    {
      "id": "6249494f-afa7-4029-a1b4-26a604eb7fe0",
      "kind": "recurring_topic",
      "status": "suggested",
      "title": "#nx-graph-topic",
      "detail": "2 pages",
      "data": {
        "name": "nx-graph-topic",
        "pages": 2,
        "pageIds": [
          "3ab2d619-c3f1-4274-87f6-b0d666424b3d",
          "5833ebff-edc1-43d9-8309-3533cc2acd2e"
        ],
        "topicId": "c13c32b8-0311-4c67-be02-c788cf810032",
        "topicKind": "tag"
      },
      "origin": "system",
      "model": null,
      "createdAt": "2026-11-19T23:27:36.989Z",
      "decidedAt": null
    },
    {
      "id": "efd6da23-e1d9-47eb-8bb9-28bc58ab3a54",
      "kind": "recurring_topic",
      "status": "suggested",
      "title": "#nx-graph-topic",
      "detail": "2 pages",
      "data": {
        "name": "nx-graph-topic",
        "pages": 2,
        "pageIds": [
          "ca5be17e-9cd6-4676-9268-b01806c601ec",
          "e01f4f8e-879f-4820-bed2-fc013dc72144"
        ],
        "topicId": "86f43c98-104d-4eea-9fea-9a891f156202",
        "topicKind": "tag"
      },
      "origin": "system",
      "model": null,
      "createdAt": "2026-11-19T22:29:22.688Z",
      "decidedAt": null
    },
    {
      "id": "c9ca0a42-5757-4f94-93e7-35f0fafbffa7",
      "kind": "recurring_topic",
      "status": "suggested",
      "title": "#nx-graph-topic",
      "detail": "2 pages",
      "data": {
        "name": "nx-graph-topic",
        "pages": 2,
        "pageIds": [
          "107747fb-333f-43b7-bf66-fab9a1c866f7",
          "247b045d-6979-48ef-97b4-f6c935db42fb"
        ],
        "topicId": "45573363-dbf8-4ae1-8a4a-7d0b1a39e668",
        "topicKind": "tag"
      },
      "origin": "system",
      "model": null,
      "createdAt": "2026-11-19T22:26:59.763Z",
      "decidedAt": null
    }
  ],
  "counts": {
    "suggested": 4,
    "accepted": 0,
    "dismissed": 0
  }
}
```

`PATCH /api/graph/insights/<id>` `{ "status": "accepted" | "dismissed" | "suggested" }` → the insight + `relationId`. Accepting a
`contradiction` between two pages records the relation `contradicts` (`origin: "ai"`, accepted by that decision) and returns its id.

```http
PATCH /api/graph/insights/75c406e6-70d3-417d-b5bd-fca0c6725c68

{
  "status": "dismissed"
}
```

```http
HTTP 200
```

```json
{
  "id": "75c406e6-70d3-417d-b5bd-fca0c6725c68",
  "kind": "recurring_topic",
  "status": "dismissed",
  "title": "#thèse",
  "detail": "2 pages",
  "data": {
    "name": "thèse",
    "pages": 2,
    "pageIds": [
      "a875edb2-ed14-4a41-a91c-8fdf8053f6c1",
      "d50d7a0b-4ae3-4740-be08-4e27790f0254"
    ],
    "topicId": "e31f9c2e-00f0-4218-8e19-bb8004d5b7a4",
    "topicKind": "tag"
  },
  "origin": "system",
  "model": null,
  "createdAt": "2026-11-19T23:28:08.248Z",
  "decidedAt": "2026-11-19T23:28:08.254Z",
  "relationId": null
}
```

<!-- AI-WORKSTREAM --> The AI job's provider call goes through `routedInsightModel` in `src/lib/graph/insights.ts` (existing router,
task `reason`, strict JSON schema `INSIGHT_SCHEMA`). The automated suites test it with an injected model; one real run through the live worker (`claude-opus-5-5`, 18 s, 0.043 USD:
the seeded contradiction found, every cited page and block existing) is recorded in `docs/next/AI-LIVE-VERIFICATION.md`.

### Constellation — `GET /api/graph/constellation` <!-- NEXT-K (knowledge screens workstream) -->

Feature flag `constellation`. The « Thought Constellation » (Labs): notes placed by meaning. `?refresh=1` recomputes the projection.
**No model is called**: the positions come from the embeddings the search index already stores.

→ `{ model, computedAt, cached, signature, explained, stats, points, clusters, links, projects, tags }`

- A point is a live, non-archived page outside the inbox that has at least one embedded chunk. Its vector is the mean of its chunk
  embeddings (pgvector `avg`); the cloud is projected to the plane by a **deterministic PCA** (power iteration with a fixed start
  vector, each axis signed so that its largest loading is positive, coordinates scaled together into [-1, 1], `y` up). The same
  embeddings always give the same map; near-identical notes are fanned out on a small spiral so every star stays reachable.
- `explained` — share of the variance carried by each of the two axes (their sum says how much the flat map can be trusted).
- The projection is cached per workspace (settings row) and recomputed only when `signature` changes
  (`<embedding model>:<embeddings>:<embedded pages>:<date of the latest embedding>`); `cached` says which happened. Titles, tags,
  projects and links are read at each call.
- `stats`: `pages` (live pages) · `embedded` (pages with vectors) · `shown` (points) · `links` · `truncated` (more than 5 000 embedded
  pages: the 5 000 most recently edited are shown). **`embedded: 0` ⇒ `points: []`**: clients show an empty state, never a made-up layout.
- `points[]`: `id` · `title` · `icon` · `type` · `section` · `x`, `y` · `cluster` (index in `clusters`) · `projectId` (top-most ancestor
  in the section `projects`, or itself; null outside a project) · `tags` (names) · `updatedAt` · `words` · `degree` (links below).
- `clusters[]` (deterministic k-means in the plane, about √(n/2) clusters, at most 18): `id` · `x`, `y` · `r` (distance to the farthest
  member) · `size` · `label` (title of the page closest to the centre) · `topTags`.
- `links[]`: accepted page ↔ page edges between two points, one per pair: `id` · `source` · `target` · `kind` · `relType` · `origin`.
- `projects[]` `{id, title, icon, pages}` and `tags[]` `{name, color, pages}` — for colouring, most frequent first.

Measured on a synthetic workspace of 4 999 embedded pages (1536-d vectors): first computation 2.1 s, cached answer 0.12 s.

(Real answer of the scratch instance `note_next_k_dev`; `points`, `clusters`, `links`, `projects` and `tags` cut to their first items.)

```http
GET /api/graph/constellation
```

```http
HTTP 200
```

```json
{
  "model": "text-embedding-3-small",
  "computedAt": "2026-11-19T20:16:34.434Z",
  "cached": false,
  "signature": "text-embedding-3-small:13:9:2026-11-19T19:32:57.895Z",
  "explained": [
    0.28118,
    0.17206
  ],
  "stats": {
    "pages": 9,
    "embedded": 9,
    "shown": 9,
    "links": 6,
    "truncated": false
  },
  "points": [
    {
      "id": "10563baa-0631-4f9a-a9e7-14390f56a724",
      "title": "Demo · Mortgage renewal",
      "icon": "🏦",
      "type": "page",
      "section": "projects",
      "x": -0.25529,
      "y": 0.00405,
      "cluster": 0,
      "projectId": "10563baa-0631-4f9a-a9e7-14390f56a724",
      "tags": [],
      "updatedAt": "2026-11-19T19:32:36.705Z",
      "words": 27,
      "degree": 2
    },
    {
      "id": "115dfe11-7419-452c-a041-647f3e89d029",
      "title": "Demo · Reading notes — fixed vs variable",
      "icon": "📚",
      "type": "page",
      "section": "documents",
      "x": -0.49232,
      "y": 0.07143,
      "cluster": 0,
      "projectId": null,
      "tags": [],
      "updatedAt": "2026-11-19T19:32:36.825Z",
      "words": 28,
      "degree": 1
    },
    {
      "id": "3cba9d2f-f1e9-4ed6-9156-550614756f88",
      "title": "Demo · Household budget",
      "icon": "🧮",
      "type": "page",
      "section": "notes",
      "x": -0.25166,
      "y": -0.01337,
      "cluster": 0,
      "projectId": null,
      "tags": [],
      "updatedAt": "2026-11-19T19:32:36.815Z",
      "words": 15,
      "degree": 1
    }
  ],
  "clusters": [
    {
      "id": 0,
      "x": -0.125,
      "y": -0.09891,
      "r": 0.95743,
      "size": 8,
      "label": "Demo · Household budget",
      "topTags": [
        "finance",
        "mortgage"
      ]
    },
    {
      "id": 1,
      "x": 1,
      "y": 0.79128,
      "r": 0,
      "size": 1,
      "label": "Demo · Garden ideas",
      "topTags": []
    }
  ],
  "links": [
    {
      "id": "6123d6c5-501c-4b0e-8f61-05f6e8448a2b",
      "source": "57d7caa6-c60f-41d7-bab6-b03e4f8fcdb6",
      "target": "ff05a3e9-4d72-4b05-bcdb-04100a82f838",
      "kind": "link",
      "relType": "related",
      "origin": "system"
    },
    {
      "id": "1671f387-7b14-4dab-ba89-5959c5af4960",
      "source": "5be0006b-6515-4c22-bfd5-86295f3706fe",
      "target": "57d7caa6-c60f-41d7-bab6-b03e4f8fcdb6",
      "kind": "link",
      "relType": "related",
      "origin": "system"
    },
    {
      "id": "b7274800-7b41-4fee-b7d6-5324665ffcaf",
      "source": "5be0006b-6515-4c22-bfd5-86295f3706fe",
      "target": "ff05a3e9-4d72-4b05-bcdb-04100a82f838",
      "kind": "link",
      "relType": "related",
      "origin": "system"
    }
  ],
  "projects": [
    {
      "id": "10563baa-0631-4f9a-a9e7-14390f56a724",
      "title": "Demo · Mortgage renewal",
      "icon": "🏦",
      "pages": 3
    }
  ],
  "tags": [
    {
      "name": "finance",
      "color": "gray",
      "pages": 3
    },
    {
      "name": "mortgage",
      "color": "gray",
      "pages": 2
    }
  ]
}
```

---

## 4.4 Events journal and time machine

### Events

An event: `{ id, at, kind, pageId, pageTitle, pageIcon, entityKind, entityId, actor, device, summary, data }`.
`actor` ∈ `user | agent | ai | system`; `device` is the session's device label (null for jobs); `pageTitle` / `pageIcon` are the
**current** ones (null when the page was purged); `summary` is the title or the name at the time of the event.

Kinds (30): `page.created`, `page.renamed`, `page.edited`, `page.moved`, `page.archived`, `page.unarchived`, `page.trashed`, `page.restored`, `page.purged`, `page.version`, `tag.added`, `tag.removed`, `link.added`, `link.removed`, `relation.created`, `relation.accepted`, `relation.rejected`, `relation.removed`, `reference.added`, `reference.linked`, `attachment.added`, `task.created`, `task.completed`, `task.reopened`, `capture.created`, `capture.filed`, `ai.applied`, `agent.applied`, `decision.recorded`, `canvas.edited`.

| kind | written when | `entityKind` / `entityId` | `data` |
|---|---|---|---|
| `page.created` | a page is created (any path: API, capture, import, database row, agent) | page | `section, type, [parentId, databaseId, via:"import"], [backfilled:true]` |
| `page.renamed` | the title changes | page | `from, to` |
| `page.edited` | the content changes — **coalesced: at most one per page per 10 minutes** | page | `version, wordCount` (of the save that opened the window) |
| `page.moved` | `parentId` or `section` changes | page | `from:{parentId, section}, to:{…}` |
| `page.archived` / `page.unarchived` | | page | — |
| `page.trashed` / `page.restored` | on the page given to the route (not on each sub-page) | page | `count` (pages affected) |
| `page.purged` | one per page permanently deleted | page | `attachments` |
| `page.version` | a history entry is taken | `page_version` / entry id | `version, reason, [unapplied:true], [backfilled:true]` |
| `tag.added` / `tag.removed` | | `tag` / tag name | `tag` |
| `link.added` / `link.removed` | a page → page reference appears in / disappears from a document | page / target id | `toId, [toTitle, sourceBlockId, targetBlockId]` |
| `relation.created` | a user creates a typed relation | `edge` / id | `relationId, relType, origin, fromId, toId, sourceKind, targetKind, fromTitle, toTitle, [model]` |
| `relation.accepted` / `relation.rejected` | a decision on a suggested relation or link suggestion | `edge` | same |
| `relation.removed` | a relation is deleted | `edge` | same |
| `reference.added` | a reference is created | `reference` / id | `citeKey, verified, [doi]` |
| `reference.linked` | a reference is attached to a page, or cited for the first time in a page | `reference` | `referenceId, citeKey, title, via:"page"\|"citation", [sourceBlockId]` |
| `attachment.added` | upload | `attachment` / id | `mime, size` |
| `task.created` / `task.completed` / `task.reopened` | | `task` / id | `[priority, dueAt, blockId, via]` |
| `capture.created` | `POST /api/capture` | page | `kind, attachments` |
| `capture.filed` | inbox triage | page | `action, [actionId, section]` |
| `ai.applied` | an `aiBlock` appears in a saved document | `block` / block id | `blockId, model, action` |
| `agent.applied` | an agent proposal is approved and applied (`actor: "agent"`) | `execution` / id | `executionId, agent, change, kind, model, …` |
| `decision.recorded` | a `callout` of kind `decision` appears in a saved document; `summary` = its text | `block` / block id | `blockId` |
| `canvas.edited` | a canvas is saved — coalesced like `page.edited` | `canvas` / page id | `version, nodes, edges` |

Events are written by the mutation, in its transaction: a refused save (409) or a failed one leaves no event. **Nothing is
back-filled** except `page.created` (from `pages.created_at`) and `page.version` (from the existing history), both with
`data.backfilled = true` and `actor: "system"`; everything else exists only from the deployment of 3.0 on (`journalSince` of the time
machine gives the date of the first real event).

### `GET /api/events`

`?pageId=<uuid>` | `?projectId=<uuid>` (a page and all its sub-pages, trashed ones included; not both) · `?from=` · `?to=` ISO dates
· `?kinds=a,b` (exact kinds or families: `page.*`, `task.*`) · `?limit=<1..200, default 50>` · `?cursor=<opaque>`.
→ `{ "events": [ … ], "nextCursor": "<opaque>" | null }`, newest first. Pass `nextCursor` back as `cursor` until it is null; the
cursor is a position in (time, id) order, so events that arrive while paging never shift a page already read.
Errors: `400 bad_kinds` · `400 bad_cursor` · `400 bad_request` · `404` (unknown `projectId`).

```http
GET /api/events?pageId=a875edb2-ed14-4a41-a91c-8fdf8053f6c1&limit=4
```

```http
HTTP 200
```

```json
{
  "events": [
    {
      "id": "fd9237fa-a8b8-4405-a1d3-3f6ca79f1a5f",
      "at": "2026-11-19T23:28:08.202Z",
      "kind": "attachment.added",
      "pageId": "a875edb2-ed14-4a41-a91c-8fdf8053f6c1",
      "pageTitle": "Exemple · Revue de littérature",
      "pageIcon": null,
      "entityKind": "attachment",
      "entityId": "725b9723-c31a-40a9-b2ca-6b2f7e48c72f",
      "actor": "user",
      "device": "SP Notes · Mac",
      "summary": "memo.mp3",
      "data": {
        "mime": "audio/mpeg",
        "size": 200
      }
    },
    {
      "id": "fb4914b5-9ce7-438a-b109-822aba12733b",
      "at": "2026-11-19T23:28:08.128Z",
      "kind": "tag.added",
      "pageId": "a875edb2-ed14-4a41-a91c-8fdf8053f6c1",
      "pageTitle": "Exemple · Revue de littérature",
      "pageIcon": null,
      "entityKind": "tag",
      "entityId": "thèse",
      "actor": "user",
      "device": "SP Notes · Mac",
      "summary": "thèse",
      "data": {
        "tag": "thèse"
      }
    },
    {
      "id": "90d53386-892b-498d-a28d-4d7a5135a017",
      "at": "2026-11-19T23:28:08.128Z",
      "kind": "tag.added",
      "pageId": "a875edb2-ed14-4a41-a91c-8fdf8053f6c1",
      "pageTitle": "Exemple · Revue de littérature",
      "pageIcon": null,
      "entityKind": "tag",
      "entityId": "garch",
      "actor": "user",
      "device": "SP Notes · Mac",
      "summary": "garch",
      "data": {
        "tag": "garch"
      }
    },
    {
      "id": "be080627-00cc-44f7-9fa2-8d8bf66c52bd",
      "at": "2026-11-19T23:28:08.112Z",
      "kind": "task.completed",
      "pageId": "a875edb2-ed14-4a41-a91c-8fdf8053f6c1",
      "pageTitle": "Exemple · Revue de littérature",
      "pageIcon": null,
      "entityKind": "task",
      "entityId": "d222d0f5-4dd7-42da-a848-c1f7b1dc5d55",
      "actor": "user",
      "device": "SP Notes · Mac",
      "summary": "Envoyer le plan au directeur",
      "data": {}
    }
  ],
  "nextCursor": "MjAyNi0xMS0xOVQyMzoyODowOC4xMTJafGJlMDgwNjI3LTAwY2MtNDRmNy05ZmEyLThkOGJmNjZjNTJiZA"
}
```

```http
GET /api/events?projectId=20709b78-b934-40aa-8fa9-8698e5039d5a&kinds=relation.*,task.*&limit=3
```

```http
HTTP 200
```

```json
{
  "events": [
    {
      "id": "d4756e3a-64c6-4e3a-8c89-4b244164479f",
      "at": "2026-11-19T23:28:08.136Z",
      "kind": "relation.created",
      "pageId": "d50d7a0b-4ae3-4740-be08-4e27790f0254",
      "pageTitle": "Exemple · Données",
      "pageIcon": null,
      "entityKind": "edge",
      "entityId": "72693b47-4de2-4c4c-9f23-e9bf70169092",
      "actor": "user",
      "device": "SP Notes · Mac",
      "summary": "Exemple · Données — supports → Exemple · Revue de littérature",
      "data": {
        "toId": "a875edb2-ed14-4a41-a91c-8fdf8053f6c1",
        "fromId": "d50d7a0b-4ae3-4740-be08-4e27790f0254",
        "origin": "user",
        "relType": "supports",
        "toTitle": "Exemple · Revue de littérature",
        "fromTitle": "Exemple · Données",
        "relationId": "72693b47-4de2-4c4c-9f23-e9bf70169092",
        "sourceKind": "page",
        "targetKind": "page"
      }
    },
    {
      "id": "be080627-00cc-44f7-9fa2-8d8bf66c52bd",
      "at": "2026-11-19T23:28:08.112Z",
      "kind": "task.completed",
      "pageId": "a875edb2-ed14-4a41-a91c-8fdf8053f6c1",
      "pageTitle": "Exemple · Revue de littérature",
      "pageIcon": null,
      "entityKind": "task",
      "entityId": "d222d0f5-4dd7-42da-a848-c1f7b1dc5d55",
      "actor": "user",
      "device": "SP Notes · Mac",
      "summary": "Envoyer le plan au directeur",
      "data": {}
    },
    {
      "id": "6888a8d6-af97-4e6d-976f-a61baba0346d",
      "at": "2026-11-19T23:28:08.106Z",
      "kind": "task.created",
      "pageId": "a875edb2-ed14-4a41-a91c-8fdf8053f6c1",
      "pageTitle": "Exemple · Revue de littérature",
      "pageIcon": null,
      "entityKind": "task",
      "entityId": "d222d0f5-4dd7-42da-a848-c1f7b1dc5d55",
      "actor": "user",
      "device": "SP Notes · Mac",
      "summary": "Envoyer le plan au directeur",
      "data": {
        "dueAt": "2026-11-21T12:00:00.000Z",
        "priority": "medium"
      }
    }
  ],
  "nextCursor": "MjAyNi0xMS0xOVQyMzoyODowOC4xMDZafDY4ODhhOGQ2LWFmOTctNGU2ZC05NzZmLWE2MWJhYmEwMzQ2ZA"
}
```

### `GET /api/timemachine`

`?at=<ISO date>` (required) and exactly one of `?pageId=<uuid>` | `?projectId=<uuid>` · `?content=0|1` (default: content included for
`pageId`, omitted for `projectId`).

→ `{ at, scope, pages, relations, references, removedSince, journalSince }`.

`pages[]` (the root first, then by creation date): `id` · `title` (at that date) · `icon` · `section` · `parentId` (current) ·
`existed` · `trashedAt` (when it was in the trash at that date) · `source` · `exact` · `version` · `versionId` · `versionAt` ·
`wordCount` · `currentTitle` · `currentVersion` · `changedSince` · `content`, `properties` (when included).

| `source` | Meaning | `exact` |
|---|---|---|
| `current` | the page has not changed since `at`: its present state is the state at that date | `true` |
| `version` | the most recent history entry taken at or before `at` (SPEC: nearest version ≤ at). History entries are taken every 10 minutes / 20 saves: edits between that entry and `at` are not in it | `false` |
| `version_after` | no entry at or before `at`: the first one taken after it, i.e. the page as it was just before that later save (exact when nothing was saved in between — the usual case right after creation — but the server cannot prove it) | `false` |
| `none` | **the page did not exist yet** (`existed: false`: created after `at` — `version`, `versionId`, `versionAt`, `wordCount` are `null`, no `content`), or it existed and no history covers that date (`existed: true`) | `false` (there is no state to be exact about; it said `true` for a page not yet created before the integration pass) |

`relations[]`: edges touching the pages of the scope that were created by `at`, accepted by `at`, and valid at `at` when they carry a
validity interval (edge keys + `fromTitle`, `toTitle`). `references[]`: references created by `at` (and not deleted by then) attached
to or cited by those pages. `removedSince[]`: `link.removed` / `relation.removed` events after `at` on those pages — what existed
then and is gone now, as far as the journal knows.

To bring a page back to a listed state: **`POST /api/pages/<id>/versions/<versionId>/restore`** — optional body
`{ "baseVersion": <currentVersion> }` → `200 {"ok":true,"version":<new>,"restored":<version number>}`. `<versionId>` is the entry id
(or its version number). The current state is saved in the history first (same path as the 2.x `POST /api/pages/<id>/versions
{version}`, which still exists). With `baseVersion`, `409 conflict` when the page changed meanwhile. `404` unknown entry, `400`
malformed.

```http
GET /api/timemachine?at=2026-11-19T23%3A28%3A08.226Z&pageId=d50d7a0b-4ae3-4740-be08-4e27790f0254
```

```http
HTTP 200
```

```json
{
  "at": "2026-11-19T23:28:08.226Z",
  "scope": {
    "pageId": "d50d7a0b-4ae3-4740-be08-4e27790f0254"
  },
  "pages": [
    {
      "id": "d50d7a0b-4ae3-4740-be08-4e27790f0254",
      "icon": null,
      "section": "projects",
      "parentId": "20709b78-b934-40aa-8fa9-8698e5039d5a",
      "trashedAt": null,
      "currentTitle": "Exemple · Données",
      "currentVersion": 1,
      "title": "Exemple · Données",
      "existed": true,
      "source": "current",
      "exact": true,
      "version": 1,
      "versionId": null,
      "versionAt": "2026-11-19T23:28:08.091Z",
      "wordCount": 6,
      "changedSince": false,
      "content": {
        "type": "doc",
        "content": [
          {
            "type": "paragraph",
            "attrs": {
              "id": "7ta0gBIZrD"
            },
            "content": [
              {
                "text": "Les séries couvrent 2010 à 2025.",
                "type": "text"
              }
            ]
          }
        ]
      },
      "properties": {}
    }
  ],
  "relations": [
    {
      "id": "ec20b9d6-21ba-4294-b3e3-ed9fd4e895af",
      "fromId": "a875edb2-ed14-4a41-a91c-8fdf8053f6c1",
      "toId": "d50d7a0b-4ae3-4740-be08-4e27790f0254",
      "sourceKind": "page",
      "targetKind": "page",
      "kind": "link",
      "relType": "related",
      "origin": "system",
      "note": null,
      "validFrom": null,
      "validTo": null,
      "sourceBlockId": "dSno8OQ_kP",
      "targetBlockId": null,
      "createdAt": "2026-11-19T23:28:08.099Z",
      "fromTitle": "Exemple · Revue de littérature",
      "toTitle": "Exemple · Données"
    },
    {
      "id": "72693b47-4de2-4c4c-9f23-e9bf70169092",
      "fromId": "d50d7a0b-4ae3-4740-be08-4e27790f0254",
      "toId": "a875edb2-ed14-4a41-a91c-8fdf8053f6c1",
      "sourceKind": "page",
      "targetKind": "page",
      "kind": "relation",
      "relType": "extends",
      "origin": "user",
      "note": null,
      "validFrom": "2026-01-01T00:00:00.000Z",
      "validTo": null,
      "sourceBlockId": null,
      "targetBlockId": null,
      "createdAt": "2026-11-19T23:28:08.136Z",
      "fromTitle": "Exemple · Données",
      "toTitle": "Exemple · Revue de littérature"
    }
  ],
  "references": [],
  "removedSince": [],
  "journalSince": "2026-11-19T21:42:40.365Z"
}
```

```http
GET /api/timemachine?at=2026-11-19T23%3A28%3A08.231Z&projectId=20709b78-b934-40aa-8fa9-8698e5039d5a
```

```http
HTTP 200
```

```json
{
  "at": "2026-11-19T23:28:08.231Z",
  "scope": {
    "projectId": "20709b78-b934-40aa-8fa9-8698e5039d5a"
  },
  "pages": [
    {
      "id": "20709b78-b934-40aa-8fa9-8698e5039d5a",
      "icon": null,
      "section": "projects",
      "parentId": null,
      "trashedAt": null,
      "currentTitle": "Exemple · Thèse",
      "currentVersion": 1,
      "title": "Exemple · Thèse",
      "existed": true,
      "source": "current",
      "exact": true,
      "version": 1,
      "versionId": null,
      "versionAt": "2026-11-19T23:28:08.078Z",
      "wordCount": 0,
      "changedSince": false
    },
    {
      "id": "d50d7a0b-4ae3-4740-be08-4e27790f0254",
      "icon": null,
      "section": "projects",
      "parentId": "20709b78-b934-40aa-8fa9-8698e5039d5a",
      "trashedAt": null,
      "currentTitle": "Exemple · Données",
      "currentVersion": 1,
      "title": "Exemple · Données",
      "existed": true,
      "source": "current",
      "exact": true,
      "version": 1,
      "versionId": null,
      "versionAt": "2026-11-19T23:28:08.091Z",
      "wordCount": 6,
      "changedSince": false
    },
    {
      "id": "a875edb2-ed14-4a41-a91c-8fdf8053f6c1",
      "icon": null,
      "section": "projects",
      "parentId": "20709b78-b934-40aa-8fa9-8698e5039d5a",
      "trashedAt": null,
      "currentTitle": "Exemple · Revue de littérature",
      "currentVersion": 1,
      "title": "Exemple · Revue de littérature",
      "existed": true,
      "source": "current",
      "exact": true,
      "version": 1,
      "versionId": null,
      "versionAt": "2026-11-19T23:28:08.098Z",
      "wordCount": 25,
      "changedSince": false
    },
    {
      "id": "495f8abd-a19d-485b-acc1-377b4e43ddd3",
      "icon": null,
      "section": "projects",
      "parentId": "20709b78-b934-40aa-8fa9-8698e5039d5a",
      "trashedAt": null,
      "currentTitle": "Exemple · Carte du projet",
      "currentVersion": 1,
      "title": "Exemple · Carte du projet",
      "existed": true,
      "source": "current",
      "exact": true,
      "version": 1,
      "versionId": null,
      "versionAt": "2026-11-19T23:28:08.170Z",
      "wordCount": 3,
      "changedSince": false
    }
  ],
  "relations": [
    {
      "id": "af53442d-1347-4ff3-ad2f-d5b6550f9222",
      "fromId": "a875edb2-ed14-4a41-a91c-8fdf8053f6c1",
      "toId": "07cd9555-0e33-4006-af38-9005598bdde8",
      "sourceKind": "page",
      "targetKind": "reference",
      "kind": "cites",
      "relType": "cites",
      "origin": "system",
      "note": null,
      "validFrom": null,
      "validTo": null,
      "sourceBlockId": "dSno8OQ_kP",
      "targetBlockId": null,
      "createdAt": "2026-11-19T23:28:08.099Z",
      "fromTitle": "Exemple · Revue de littérature",
      "toTitle": "Generalized autoregressive conditional heteroskedasticity"
    },
    {
      "id": "ec20b9d6-21ba-4294-b3e3-ed9fd4e895af",
      "fromId": "a875edb2-ed14-4a41-a91c-8fdf8053f6c1",
      "toId": "d50d7a0b-4ae3-4740-be08-4e27790f0254",
      "sourceKind": "page",
      "targetKind": "page",
      "kind": "link",
      "relType": "related",
      "origin": "system",
      "note": null,
      "validFrom": null,
      "validTo": null,
      "sourceBlockId": "dSno8OQ_kP",
      "targetBlockId": null,
      "createdAt": "2026-11-19T23:28:08.099Z",
      "fromTitle": "Exemple · Revue de littérature",
      "toTitle": "Exemple · Données"
    },
    {
      "id": "72693b47-4de2-4c4c-9f23-e9bf70169092",
      "fromId": "d50d7a0b-4ae3-4740-be08-4e27790f0254",
      "toId": "a875edb2-ed14-4a41-a91c-8fdf8053f6c1",
      "sourceKind": "page",
      "targetKind": "page",
      "kind": "relation",
      "relType": "extends",
      "origin": "user",
      "note": null,
      "validFrom": "2026-01-01T00:00:00.000Z",
      "validTo": null,
      "sourceBlockId": null,
      "targetBlockId": null,
      "createdAt": "2026-11-19T23:28:08.136Z",
      "fromTitle": "Exemple · Données",
      "toTitle": "Exemple · Revue de littérature"
    }
  ],
  "references": [
    {
      "id": "07cd9555-0e33-4006-af38-9005598bdde8",
      "citeKey": "tim1986generalized",
      "title": "Generalized autoregressive conditional heteroskedasticity",
      "authors": [
        "Bollerslev, Tim"
      ],
      "year": 1986,
      "pageId": null,
      "createdAt": "2026-11-19T23:28:08.087Z"
    }
  ],
  "removedSince": [],
  "journalSince": "2026-11-19T21:42:40.365Z"
}
```

---

## 4.5 Knowledge health

### `GET /api/health/knowledge`

`?inactiveDays=<1..3650, default 30>` — an integer outside the range is clamped and the applied value is echoed in `inactiveDays`
(§0.6). `score` is `{pages, truncated, issues}`: `pages` = live pages read, most recently changed first, at most 50 000;
`truncated: true` (new key, integration pass) says older pages were left out — the cut used to be an unordered 20 000. Authenticated (the public liveness probe `GET /api/health` is unchanged). Computed from real
data at each call, no model. Every section is `{ count, ids, items }` (`ids` ≤ 200 page / task ids, `items` ≤ 200 with details).

| Section | Definition | Item |
|---|---|---|
| `orphans` | live, non-archived, non-row, non-inbox pages without any accepted edge | `{id, title, icon, section, updatedAt}` |
| `brokenLinks` | in a live page: a link / mention / `blockRef` / `canvasLink` to a page that does not exist (`missing`) or is in the trash (`trashed`); a block anchor that no longer exists in its page (`kind:"block"`); an attachment id (3.0 node attr or `/api/files/<id>`) that does not exist or is deleted (`kind:"file"`) | `{pageId, title, kind, targetId, targetBlockId?, blockId, reason}` — `blockId` = the block that holds the link |
| `missingReferences` | a `citation` whose reference does not exist (`missing`) or is deleted (`deleted`) | `{pageId, title, refId, blockId, reason}` |
| `potentialDuplicates` | same normalised title, or same text (≥ 5 words) | `{reason:"title"\|"content", pageIds, title}` |
| `untitled` | non-archived pages titled ``, `Untitled` or `Sans titre` | `{id, section, updatedAt, empty}` |
| `inactiveProjects` | top-level pages of the section `projects` whose whole subtree has not changed for `inactiveDays` | `{id, title, icon, lastActivityAt, idleDays}` |
| `openTasks` | tasks not done, not deleted; plus `overdue` and `withoutDate` counts | `{id, title, dueAt, pageId, priority, overdue}` (≤ 100) |

`score: {pages, issues}` — `issues` is the sum of the counts above with `overdue` in place of all open tasks.

```http
GET /api/health/knowledge
```

```http
HTTP 200
```

```json
{
  "computedAt": "2026-11-19T23:28:08.256Z",
  "inactiveDays": 30,
  "score": {
    "pages": 7,
    "truncated": false,
    "issues": 4
  },
  "orphans": {
    "count": 4,
    "ids": [
      "db26dee6-75cf-43ef-bfb3-df26094e1661",
      "495f8abd-a19d-485b-acc1-377b4e43ddd3",
      "20709b78-b934-40aa-8fa9-8698e5039d5a",
      "acbd524f-4899-4964-8ac7-102ad893d29c"
    ],
    "items": [
      {
        "id": "db26dee6-75cf-43ef-bfb3-df26094e1661",
        "title": "Exemple · Lectures",
        "icon": null,
        "section": "databases",
        "updatedAt": "2026-11-19T23:28:08.182Z"
      },
      {
        "id": "495f8abd-a19d-485b-acc1-377b4e43ddd3",
        "title": "Exemple · Carte du projet",
        "icon": null,
        "section": "projects",
        "updatedAt": "2026-11-19T23:28:08.170Z"
      },
      {
        "id": "20709b78-b934-40aa-8fa9-8698e5039d5a",
        "title": "Exemple · Thèse",
        "icon": null,
        "section": "projects",
        "updatedAt": "2026-11-19T23:28:08.078Z"
      },
      {
        "id": "acbd524f-4899-4964-8ac7-102ad893d29c",
        "title": "it-f0ea9fbc ia",
        "icon": null,
        "section": "notes",
        "updatedAt": "2026-11-19T23:16:44.139Z"
      }
    ]
  },
  "brokenLinks": {
    "count": 0,
    "ids": [],
    "items": []
  },
  "missingReferences": {
    "count": 0,
    "ids": [],
    "items": []
  },
  "potentialDuplicates": {
    "count": 0,
    "ids": [],
    "items": []
  },
  "untitled": {
    "count": 0,
    "ids": [],
    "items": []
  },
  "inactiveProjects": {
    "count": 0,
    "ids": [],
    "items": []
  },
  "openTasks": {
    "count": 1,
    "overdue": 0,
    "withoutDate": 0,
    "ids": [
      "910c305f-64c6-4d08-b584-28fbeb6fcc29"
    ],
    "items": [
      {
        "id": "910c305f-64c6-4d08-b584-28fbeb6fcc29",
        "title": "Relire la section 2",
        "dueAt": "2026-11-25T12:00:00.000Z",
        "pageId": "a875edb2-ed14-4a41-a91c-8fdf8053f6c1",
        "priority": "high",
        "overdue": false
      }
    ]
  }
}
```

---

## 4.6 Brief

### `GET /api/brief`

`?tz=<IANA zone>` (default: the server's `TZ`, `America/Toronto`); `400 bad_request` for an unknown zone. **No model is called.**

`recentNotes` (8 most recently modified live pages, outside the inbox and database rows) · `activeProjects` (top-level pages of the
section `projects` with a change in their subtree in the last 14 days: `pages`, `openTasks`) · `tasks.overdue` / `tasks.dueToday` /
`tasks.dueSoon` (the 6 days after today), « today » being the calendar day in `tz` · `unfiledCaptures` `{count, items ≤ 10}` ·
`linkSuggestions` `{count, items ≤ 5}` — suggested page ↔ page edges awaiting a decision, each **`ai: true`** · `toRevisit` (≤ 8
connected pages nobody opened or edited for 30 days, most central first) · `aiSummary` — `null`, or the last summary explicitly
requested `{ai: true, text, model, at}`. `aiSummary` is **only ever present after a `POST /api/brief/summary`** made by the owner:
`GET` never calls a model and never stores anything (a non-null `aiSummary` seen on the scratch instance during the Core live tests
was a fixture left by a unit suite; the suites now put the stored summary back as they found it).

```http
GET /api/brief?tz=America/Toronto
```

```http
HTTP 200
```

```json
{
  "generatedAt": "2026-11-19T23:28:08.259Z",
  "date": "2026-11-19",
  "timeZone": "America/Toronto",
  "recentNotes": [
    {
      "id": "db26dee6-75cf-43ef-bfb3-df26094e1661",
      "title": "Exemple · Lectures",
      "icon": null,
      "section": "databases",
      "type": "database",
      "updatedAt": "2026-11-19T23:28:08.182Z",
      "wordCount": 0
    },
    {
      "id": "495f8abd-a19d-485b-acc1-377b4e43ddd3",
      "title": "Exemple · Carte du projet",
      "icon": null,
      "section": "projects",
      "type": "canvas",
      "updatedAt": "2026-11-19T23:28:08.170Z",
      "wordCount": 3
    },
    {
      "id": "a875edb2-ed14-4a41-a91c-8fdf8053f6c1",
      "title": "Exemple · Revue de littérature",
      "icon": null,
      "section": "projects",
      "type": "page",
      "updatedAt": "2026-11-19T23:28:08.098Z",
      "wordCount": 25
    },
    {
      "id": "d50d7a0b-4ae3-4740-be08-4e27790f0254",
      "title": "Exemple · Données",
      "icon": null,
      "section": "projects",
      "type": "page",
      "updatedAt": "2026-11-19T23:28:08.091Z",
      "wordCount": 6
    },
    {
      "id": "20709b78-b934-40aa-8fa9-8698e5039d5a",
      "title": "Exemple · Thèse",
      "icon": null,
      "section": "projects",
      "type": "page",
      "updatedAt": "2026-11-19T23:28:08.078Z",
      "wordCount": 0
    },
    {
      "id": "acbd524f-4899-4964-8ac7-102ad893d29c",
      "title": "it-f0ea9fbc ia",
      "icon": null,
      "section": "notes",
      "type": "page",
      "updatedAt": "2026-11-19T23:16:44.139Z",
      "wordCount": 23
    }
  ],
  "activeProjects": [
    {
      "id": "20709b78-b934-40aa-8fa9-8698e5039d5a",
      "title": "Exemple · Thèse",
      "icon": null,
      "lastActivityAt": "2026-11-19T23:28:08.170Z",
      "pages": 4,
      "openTasks": 1
    }
  ],
  "tasks": {
    "overdue": [],
    "dueToday": [],
    "dueSoon": [
      {
        "id": "910c305f-64c6-4d08-b584-28fbeb6fcc29",
        "title": "Relire la section 2",
        "status": "todo",
        "priority": "high",
        "dueAt": "2026-11-25T12:00:00.000Z",
        "pageId": "a875edb2-ed14-4a41-a91c-8fdf8053f6c1",
        "pageTitle": "Exemple · Revue de littérature",
        "blockId": "FKmM69LEHF",
        "project": null
      }
    ]
  },
  "unfiledCaptures": {
    "count": 0,
    "items": []
  },
  "linkSuggestions": {
    "count": 0,
    "items": []
  },
  "toRevisit": [],
  "aiSummary": null
}
```

### `POST /api/brief/summary`

Optional body `{ "tz": "<IANA zone>" }` → `{ "ai": true, "text", "model", "at", "costUsd" }`. One short model call over the titles
and counts of the brief (never the note contents), only on this explicit request; the result is stored and returned by `GET` as
`aiSummary`. `502 ai_empty` when the model returns nothing. <!-- AI-WORKSTREAM --> Provider seam: `routedBriefModel` in
`src/lib/knowledge/brief.ts` (existing router, task `quick`); tested with an injected model only — **not verified against a real
provider**. No example is given here for that reason.

---

## 4.7 Living blocks — `POST /api/query`

Resolves a `queryView` (or the live data of a `chart` with `source`) at display time. Read-only and safe to repeat (it is a POST
because the query is a body; it needs `Origin`).

Body: `source` `tasks | pages | database | references | backlinks` · `databaseId?` · `viewId?` · `pageId?` uuids · `limit?` 1…500
(default 25) · `filter?` `{ tag?, section?, status?, parentId? (uuid), text?, dueBefore?, dueAfter? }`.

→ `{ source, columns: [{key, label, type}], rows: [{id, pageId, …}], total, limit, table: {columns: string[], rows: (string|number|null)[][]}, resolvedAt }`
(+ `databaseId, viewId, name` for `database`). `rows[i][column.key]` is the typed value; `table` is the same data flattened (ready
for a `chart` node's `columns` / `rows`, or a native table). `total` counts beyond `limit`. Column `type` ∈ `text | number | date |
checkbox | select | page | tags | url | json`.

| `source` | Rows | Filters | Order |
|---|---|---|---|
| `tasks` | tasks; `id` = task id, `pageId`, `blockId` | `status`: `open` (default) `\| todo \| doing \| done \| all`; `parentId` = tasks of that page; `tag` / `section` = of the task's page; `text` in the title; `dueBefore` (exclusive) / `dueAfter` (inclusive), ISO date or datetime | open first, due date, newest |
| `pages` | live pages (no rows, no inbox) | `status`: `active` (default) `\| archived \| pinned \| all \|` any other value = `properties.status`; `section`; `parentId` = children; `tag`; `text` in title or text | last modified |
| `database` | rows of `databaseId` (database id or host page id), through the database engine: the view's filter and sorts (`viewId`, default view otherwise), formulas, rollups, relations; hidden columns removed; select / status options resolved to their names | `text` = the database search | the view's |
| `references` | references | `text` (title, key, authors); `parentId` = attached to or cited by that page; `status` = `verified` value | year desc, key |
| `backlinks` | pages linking to `pageId` (or `filter.parentId`); `via` = link kinds (`link`, `ai`, `canvas`) | `text`, `section` | last modified |

Errors: `400` validation · `400 bad_request` (missing `databaseId` / `pageId`, bad `status`, bad date) · `404` (database or view).

```http
POST /api/query

{
  "source": "tasks",
  "filter": {
    "parentId": "a875edb2-ed14-4a41-a91c-8fdf8053f6c1",
    "status": "all"
  },
  "limit": 10
}
```

```http
HTTP 200
```

```json
{
  "source": "tasks",
  "columns": [
    {
      "key": "title",
      "label": "Tâche",
      "type": "text"
    },
    {
      "key": "status",
      "label": "État",
      "type": "select"
    },
    {
      "key": "priority",
      "label": "Priorité",
      "type": "select"
    },
    {
      "key": "dueAt",
      "label": "Échéance",
      "type": "date"
    },
    {
      "key": "pageTitle",
      "label": "Page",
      "type": "page"
    },
    {
      "key": "project",
      "label": "Projet",
      "type": "text"
    }
  ],
  "rows": [
    {
      "id": "910c305f-64c6-4d08-b584-28fbeb6fcc29",
      "pageId": "a875edb2-ed14-4a41-a91c-8fdf8053f6c1",
      "blockId": "FKmM69LEHF",
      "title": "Relire la section 2",
      "status": "todo",
      "priority": "high",
      "dueAt": "2026-11-25T12:00:00.000Z",
      "completedAt": null,
      "pageTitle": "Exemple · Revue de littérature",
      "project": null
    }
  ],
  "total": 1,
  "limit": 10,
  "table": {
    "columns": [
      "Tâche",
      "État",
      "Priorité",
      "Échéance",
      "Page",
      "Projet"
    ],
    "rows": [
      [
        "Relire la section 2",
        "todo",
        "high",
        "2026-11-25T12:00:00.000Z",
        "Exemple · Revue de littérature",
        null
      ]
    ]
  },
  "resolvedAt": "2026-11-19T23:28:08.263Z"
}
```

```http
POST /api/query

{
  "source": "database",
  "databaseId": "db26dee6-75cf-43ef-bfb3-df26094e1661",
  "limit": 10
}
```

```http
HTTP 200
```

```json
{
  "source": "database",
  "columns": [
    {
      "key": "5baddb10-dcbb-46ba-86d5-878db2099eed",
      "label": "Name",
      "type": "page"
    },
    {
      "key": "626cdc7c-1ae3-4281-b5ca-a9439fa8d737",
      "label": "Année",
      "type": "number"
    }
  ],
  "rows": [
    {
      "id": "0660e2fc-499b-44b9-86d9-115fc7d257ab",
      "pageId": "67a70821-dc3a-4d76-8ade-6602d6cc873c",
      "title": "Engle (1982)",
      "icon": null,
      "5baddb10-dcbb-46ba-86d5-878db2099eed": "Engle (1982)",
      "626cdc7c-1ae3-4281-b5ca-a9439fa8d737": 1982
    }
  ],
  "total": 1,
  "limit": 10,
  "table": {
    "columns": [
      "Name",
      "Année"
    ],
    "rows": [
      [
        "Engle (1982)",
        1982
      ]
    ]
  },
  "resolvedAt": "2026-11-19T23:28:08.266Z",
  "databaseId": "b7b47434-f9a0-4267-a6fc-433e0ea48b5a",
  "viewId": "69eb4f2b-0fff-481c-b994-9a783cdd80fc",
  "name": "Exemple · Lectures"
}
```

```http
POST /api/query

{
  "source": "backlinks",
  "pageId": "d50d7a0b-4ae3-4740-be08-4e27790f0254"
}
```

```http
HTTP 200
```

```json
{
  "source": "backlinks",
  "columns": [
    {
      "key": "title",
      "label": "Page",
      "type": "page"
    },
    {
      "key": "section",
      "label": "Espace",
      "type": "select"
    },
    {
      "key": "updatedAt",
      "label": "Modifiée",
      "type": "date"
    }
  ],
  "rows": [
    {
      "id": "a875edb2-ed14-4a41-a91c-8fdf8053f6c1",
      "pageId": "a875edb2-ed14-4a41-a91c-8fdf8053f6c1",
      "title": "Exemple · Revue de littérature",
      "icon": null,
      "section": "projects",
      "updatedAt": "2026-11-19T23:28:08.098Z",
      "via": [
        "link"
      ]
    }
  ],
  "total": 1,
  "limit": 25,
  "table": {
    "columns": [
      "Page",
      "Espace",
      "Modifiée"
    ],
    "rows": [
      [
        "Exemple · Revue de littérature",
        "projects",
        "2026-11-19T23:28:08.098Z"
      ]
    ]
  },
  "resolvedAt": "2026-11-19T23:28:08.269Z"
}
```

---

## 4.8 Canvas

A canvas is a page with `type: "canvas"` (its `content` stays an empty document) plus one canvas row. Create it with
`POST /api/pages { id?, title, type: "canvas", parentId?, section? }` — the canvas row is created in the same transaction (empty
`spn-canvas-1`, `version: 1`). Trash / restore / purge are those of the page (purge → tombstones `page` + `canvas`).

`data` (`spn-canvas-1`):

```jsonc
{ "format": "spn-canvas-1",
  "nodes": [ { "id": "n1", "kind": "text|page|image|pdf|link|drawing|shape|reference|math|table", "x": 0, "y": 0, "w": 240, "h": 120, "z": 0,
               "text": "…", "pageId": "uuid", "attachmentId": "uuid", "url": "https://…", "refId": "uuid", "latex": "…",
               "color": "#rrggbb", "shape": "rect|ellipse|diamond", "ink": "attachment uuid" } ],
  "edges": [ { "id": "e1", "from": "n1", "to": "n2", "label": "…", "kind": "arrow|line", "color": "#rrggbb" } ],
  "viewport": { "x": 0, "y": 0, "zoom": 1 } }
```

Server validation (`400 bad_canvas`, or `413 bad_canvas` for size): `format` exact; `nodes` ≤ 5 000, `edges` ≤ 10 000, serialized
size ≤ 4 MiB; node `id` unique string 1…64, `kind` a string ≤ 32 (**unknown kinds and unknown fields are kept**), `x y w h` finite
numbers (`w, h ≥ 0`), `z` number; `pageId, attachmentId, refId, ink` UUIDs; `text, latex` ≤ 100 000 chars; `url` ≤ 2 000 and not
`javascript:`; edge `id` unique, `from` / `to` are node ids of the same canvas, `label` ≤ 500; `viewport` `{x, y, zoom > 0}`.

### `GET /api/canvases/<pageId>`

→ `{ pageId, title, data, version, rev, updatedAt }` (readable in the trash too). `404 not_found` · `404 not_canvas` (the page is
not of type `canvas`).

```http
GET /api/canvases/495f8abd-a19d-485b-acc1-377b4e43ddd3
```

```http
HTTP 200
```

```json
{
  "pageId": "495f8abd-a19d-485b-acc1-377b4e43ddd3",
  "title": "Exemple · Carte du projet",
  "data": {
    "edges": [],
    "nodes": [],
    "format": "spn-canvas-1",
    "viewport": {
      "x": 0,
      "y": 0,
      "zoom": 1
    }
  },
  "version": 1,
  "rev": 619769,
  "updatedAt": "2026-11-19T23:28:08.160Z"
}
```

### `PUT /api/canvases/<pageId>`

Body `{ "data": <spn-canvas-1>, "baseVersion": <int> }` — **`baseVersion` is required**.
→ `200 { version, rev, updatedAt, unchanged }`. The write happens only if the canvas is still at `baseVersion` (one statement);
otherwise `409 conflict` with the server copy and nothing is written — merge by node / edge id (take the server copy, re-apply the
local changes of the ids the user touched) and send again with `server.version`. Saving exactly what is stored is a no-op
(`unchanged: true`, same `version`). A trashed canvas → `404`.

Side effects: `canvas.edited` (coalesced, 10 min); the canvas page's `updatedAt` moves (it shows in « recent » and in the page feed);
cards of kind `page` make the canvas a **backlink** of those pages (`links` of kind `canvas`, visible in `backlinks` of
`GET /api/pages/<id>` and in `POST /api/query` source `backlinks`).

**Search (canvas workstream)**: a save also writes the text of the canvas into the canvas page — `plainText` = per node, in array
order, its `text`, `latex` and `url` (each when present, one per line; a `table` card's Markdown reduced to its cells), then the
edge `label`s, capped at 200 000 characters; `wordCount` follows. The page is queued for indexing like a page save, and the index
worker reads a canvas page from that text (it has no document). Nothing changes in the request or the response. The canvas
format, its operations and the merge rules every client must match are in `docs/next/CANVAS.md`.

```http
PUT /api/canvases/495f8abd-a19d-485b-acc1-377b4e43ddd3

{
  "data": {
    "format": "spn-canvas-1",
    "nodes": [
      {
        "id": "n1",
        "kind": "page",
        "x": 0,
        "y": 0,
        "w": 240,
        "h": 120,
        "z": 0,
        "pageId": "a875edb2-ed14-4a41-a91c-8fdf8053f6c1"
      },
      {
        "id": "n2",
        "kind": "text",
        "x": 320,
        "y": 20,
        "w": 200,
        "h": 80,
        "z": 1,
        "text": "Hypothèse H1",
        "color": "#3157d5"
      }
    ],
    "edges": [
      {
        "id": "e1",
        "from": "n1",
        "to": "n2",
        "label": "motive",
        "kind": "arrow"
      }
    ],
    "viewport": {
      "x": 0,
      "y": 0,
      "zoom": 1
    }
  },
  "baseVersion": 1
}
```

```http
HTTP 200
```

```json
{
  "version": 2,
  "rev": 619770,
  "updatedAt": "2026-11-19T23:28:08.169Z",
  "unchanged": false
}
```

```http
PUT /api/canvases/495f8abd-a19d-485b-acc1-377b4e43ddd3

{
  "data": {
    "format": "spn-canvas-1",
    "nodes": [],
    "edges": [],
    "viewport": {
      "x": 0,
      "y": 0,
      "zoom": 1
    }
  },
  "baseVersion": 1
}
```

```http
HTTP 409
```

```json
{
  "error": "This canvas was changed in another session",
  "code": "conflict",
  "server": {
    "version": 2,
    "data": {
      "edges": [
        {
          "id": "e1",
          "to": "n2",
          "from": "n1",
          "kind": "arrow",
          "label": "motive"
        }
      ],
      "nodes": [
        {
          "h": 120,
          "w": 240,
          "x": 0,
          "y": 0,
          "z": 0,
          "id": "n1",
          "kind": "page",
          "pageId": "a875edb2-ed14-4a41-a91c-8fdf8053f6c1"
        },
        {
          "h": 80,
          "w": 200,
          "x": 320,
          "y": 20,
          "z": 1,
          "id": "n2",
          "kind": "text",
          "text": "Hypothèse H1",
          "color": "#3157d5"
        }
      ],
      "format": "spn-canvas-1",
      "viewport": {
        "x": 0,
        "y": 0,
        "zoom": 1
      }
    },
    "updatedAt": "2026-11-19T23:28:08.169Z"
  }
}
```

```http
PUT /api/canvases/495f8abd-a19d-485b-acc1-377b4e43ddd3

{
  "data": {
    "format": "v0"
  },
  "baseVersion": 2
}
```

```http
HTTP 400
```

```json
{
  "error": "Invalid canvas: data.format must be \"spn-canvas-1\"",
  "code": "bad_canvas"
}
```

```http
GET /api/canvases/a875edb2-ed14-4a41-a91c-8fdf8053f6c1
```

```http
HTTP 404
```

```json
{
  "error": "This page is not a canvas",
  "code": "not_canvas"
}
```

---

## 4.9 Semantic zoom

### `GET /api/pages/<id>/zoom?level=1|2|3` (default 2)

- **3** → `{ level: 3, pageId, title, version, updatedAt, ai: false, content }` — the full document.
- **2** → the outline, computed without any model: `{ level: 2, pageId, title, version, updatedAt, ai: false, sections }`. One
  section per top-level heading (any level), preceded by a section with `heading: null`, `level: 0` for the text before the first
  heading. `sections[]`: `blockId` (of the heading; of the first block for the leading section) · `level` 0…6 · `heading` ·
  `firstSentence` — of the first non-empty block of the section: up to the first `.`, `!`, `?` or `…` followed by whitespace or the
  end, at most 240 characters (cut on a word + `…`) · `words` · `blocks` (non-empty body blocks).
- **1** → <!-- AI-WORKSTREAM --> AI synopsis, cached by content hash and always marked `ai: true` with `model` and `generatedAt`
  (shape and the dedicated route `GET | POST /api/pages/<id>/zoom/ai` in `API-NEXT-AI.md`). **Without `cachedOnly=1` a missing
  synopsis is generated: a paid model call.** With `?cachedOnly=1` no provider is ever called (`status: "missing"` when nothing
  valid is cached) — what a client sends on first paint, and what every automated suite sends.

Works on a trashed page. `400 bad_request` for another level.

```http
GET /api/pages/a875edb2-ed14-4a41-a91c-8fdf8053f6c1/zoom?level=2
```

```http
HTTP 200
```

```json
{
  "level": 2,
  "pageId": "a875edb2-ed14-4a41-a91c-8fdf8053f6c1",
  "title": "Exemple · Revue de littérature",
  "version": 1,
  "updatedAt": "2026-11-19T23:28:08.098Z",
  "ai": false,
  "sections": [
    {
      "blockId": "406lGFlGau",
      "level": 1,
      "heading": "Volatilité conditionnelle",
      "firstSentence": "Le modèle fondateur est Bollerslev 1986.",
      "words": 23,
      "blocks": 4
    }
  ]
}
```

```http
GET /api/pages/a875edb2-ed14-4a41-a91c-8fdf8053f6c1/zoom?level=1&cachedOnly=1
```

```http
HTTP 200
```

```json
{
  "pageId": "a875edb2-ed14-4a41-a91c-8fdf8053f6c1",
  "level": 1,
  "contentHash": "f170bd35bf5f766fe7fa0a3cf609276d",
  "ai": false,
  "status": "missing",
  "synopsis": null,
  "model": null,
  "provider": null,
  "generatedAt": null,
  "cached": false,
  "costUsd": null,
  "title": "Exemple · Revue de littérature",
  "version": 1
}
```

<!-- AI-WORKSTREAM -->
## 4.10 – 4.14 (AI workstream)

Documented in `docs/next/API-NEXT-AI.md`: §4.10 Ask (`POST /api/ai/chat` `scope`, `POST /api/ai/action` new actions), §4.11 Models
(`GET /api/ai/models`), §4.12 Capture extensions and inbox suggestions (`GET /api/inbox/<id>/suggestions`, `POST /api/inbox/<id>/apply`),
§4.13 Voice (`POST /api/audio/<attachmentId>/transcribe`, `GET /api/audio/<attachmentId>`), §4.14 Research
(`GET /api/research/export.tex`, `GET /api/research/references?ids=`).
<!-- /AI-WORKSTREAM -->

---

## 4.15 Files, purge, identifiers, parent cycles

### `GET /api/files/<id>` — Range

Always sent: `Accept-Ranges: bytes`, `ETag: "<sha256 of the content>"`, `Content-Length`, `Cache-Control: private, max-age=31536000, immutable`.
One range per request: `Range: bytes=a-b`, `bytes=a-`, `bytes=-n` → `206` with `Content-Range: bytes a-b/<size>`. An unsatisfiable
range → `416` with `Content-Range: bytes */<size>`. Several ranges or a malformed header → the whole file (`200`). `If-Range` with
another ETag → the whole file. **A soft-deleted attachment answers `404`** (2.x kept serving it); `410 gone` when the file is missing
on disk. Inline `Content-Disposition` now also for `audio/mp4`, `audio/x-m4a`, `audio/wav`, `audio/webm`, `audio/ogg`, `application/json`.

```http
GET /api/files/725b9723-c31a-40a9-b2ca-6b2f7e48c72f
Range: bytes=0-9
```

```http
HTTP 206
content-range: bytes 0-9/200
accept-ranges: bytes
content-length: 10
content-type: audio/mpeg
etag: "295cbb667c2d2380418d4c7576c666c4f1690de2a2433f0e301bd5923377f8ed"
```

`<10 bytes>`

```http
GET /api/files/725b9723-c31a-40a9-b2ca-6b2f7e48c72f
Range: bytes=500-
```

```http
HTTP 416
content-range: bytes */200
accept-ranges: bytes
content-type: audio/mpeg
etag: "295cbb667c2d2380418d4c7576c666c4f1690de2a2433f0e301bd5923377f8ed"
```

`<0 bytes>`

### Purge (`DELETE /api/pages/<id>?purge=1`, `DELETE | POST /api/trash`) — step-up still required

Permanently deleting a page now also deletes:

- **the sub-pages that were moved to the trash by the same action as that page** (trashing a page trashes its live sub-pages in one
  statement; they share its `deletedAt`). 2.x left them orphaned in the trash;
- **the attachments of the deleted pages**: rows (→ `attachment` tombstones), their search index, and the file on disk — except an
  attachment that something surviving still uses (another page whose document references it, a reference whose PDF it is); a file
  shared by another attachment row (same content) stays on disk.

It never deletes a **live** sub-page (restored on its own, or moved under a trashed page) nor a sub-page that was **trashed
separately**: those are kept and re-attached to the top level (`parentId: null`). One `page.purged` event per deleted page.
The answer of the routes is unchanged (`{"ok":true}` / `{ok, purged}`); `purged` counts pages.

### Identifiers

Any malformed id in a path or a query string answers `400` (it answered `500`): see §0.2.

```http
GET /api/pages/not-a-uuid
```

```http
HTTP 400
```

```json
{
  "error": "Validation: Invalid UUID",
  "code": "bad_request"
}
```

### Parent cycles

`PATCH /api/pages/<id> { parentId }`: the new parent must be a page of the workspace (`400 bad_parent`) and must not be the page
itself (`400`) or one of its descendants (`409 cycle`). Nothing is written when refused.

```http
PATCH /api/pages/20709b78-b934-40aa-8fa9-8698e5039d5a

{
  "parentId": "a875edb2-ed14-4a41-a91c-8fdf8053f6c1"
}
```

```http
HTTP 409
```

```json
{
  "error": "A page cannot be moved under one of its own sub-pages",
  "code": "cycle"
}
```

### Tags

`GET /api/tags` → `[{id, name, color, pages}]`: `pages` is now the number of live pages carrying the tag (it was always 0).

```http
GET /api/tags
```

```http
HTTP 200
```

```json
[
  {
    "id": "4ba442f8-4d7f-4c97-a5f1-d195e0a058b8",
    "name": "31999de6",
    "color": "gray",
    "pages": 0
  },
  {
    "id": "dedf187a-bae4-4e64-bc08-27b617f2c768",
    "name": "garch",
    "color": "gray",
    "pages": 1
  },
  {
    "id": "93eca24f-765d-4ff3-9424-06667d02854b",
    "name": "hors-ligne",
    "color": "gray",
    "pages": 0
  },
  {
    "id": "9c19fc6f-1f44-41c7-afa6-b25a7453f3ad",
    "name": "it-3de28bc7",
    "color": "gray",
    "pages": 0
  },
  {
    "id": "17a8d9b4-7a87-4327-ad6c-e808f6586440",
    "name": "journal",
    "color": "gray",
    "pages": 0
  },
  {
    "id": "20cbf6ed-2a1e-480d-a0ad-07c168109cee",
    "name": "offline",
    "color": "gray",
    "pages": 0
  },
  {
    "id": "e31f9c2e-00f0-4218-8e19-bb8004d5b7a4",
    "name": "thèse",
    "color": "gray",
    "pages": 2
  }
]
```

---

### Search — `GET /api/search` (2.x route; what a 3.0 client must know)

`?q=&mode=quick|hybrid&limit=&semantic=0|1&kinds=&section=&since=&until=&archived=1&group=1`.

- **`mode` absent = `quick`** (unchanged from 2.x): a title search in PostgreSQL, no provider, rows
  `{id, title, icon, type, section, updatedAt}`.
- > **`mode=hybrid` sends the query text to the embedding provider (a paid call, and the text leaves the server) unless
  > `semantic=0`.** `semantic` defaults to `1`. A client that wants a local, free, private search sends
  > `mode=hybrid&semantic=0` (full-text + trigram only). The automated suites and the perf probe always send `semantic=0`.

### Database query filters — `POST /api/databases/<id>/query`, `POST /api/databases/<id>/rows/bulk`

`filter` / `extraFilter` (and `all.filter` / `all.extraFilter` of a bulk action) accept: a group `{"and":[…]}` or `{"or":[…]}`
(rules and nested groups, depth ≤ 4), `{}` or `null` (no filter), **or one bare rule** `{"property":"<id>","op":"<op>","value":…}`,
read as `{"and":[rule]}` (it was silently dropped before the integration pass: the answer was every row — and a bulk action touched
every row). Anything else → `400 bad_filter` (an object that is neither, a group that is also a rule, an unknown property or
operator, a non-object). A filter is never ignored.

### Research tasks and references (2.x routes)

- `POST | PATCH /api/research/tasks`: `dueAt` follows the bare-date rule of §0.6 (12:00 UTC; an unparsable date → `400 bad_request`,
  it used to answer 500).
- `GET /api/research/references?ids=<uuid,…>` (≤ 200) → exactly those references, each with `label` (author–year) and `citation`
  (formatted entry); ids that do not exist **or are deleted** are listed, comma-separated, in the response header `x-missing-ids`
  (empty when none). `?projectId=<page id>` → the references attached to a page of that project or cited in its text.
  `400 bad_id` for a malformed id, `400 too_many_ids`.
- `POST /api/research/references` with a client `id`: see §0.3 (`200` + `x-existing: 1` on a replay, `409 reference_deleted`).

### Offline-first captures — `POST /api/pages` with `inboxAt` | `inbox` and `captureKind`

A capture made offline by a native client is a page created under its client `id`; so that it reaches the **server inbox**,
`POST /api/pages` accepts three optional fields (integration pass):

- `inboxAt` — ISO date: the moment of the capture (kept as given) — or `inbox: true` (= now). Unparsable → `400 bad_request`.
- `captureKind` — open string, 1–32 characters (`note`, `tasks`, `link`, `photo`, `file`, `audio`, `screenshot`, `selection`,
  `document`, or a kind of your own). Given alone it implies `inbox: true`; in the inbox without a kind it is stored as `note`.

The page is then an inbox item like one made by `POST /api/capture`: listed by `GET /api/inbox`, `inboxAt` / `captureKind` in the
page and in its feed row, one `capture.created` event (`data: {kind, attachments: 0, via: "pages"}`) next to `page.created`. The call
stays idempotent on `id` (`200` + `x-existing: 1`, the stored page untouched — a replay never moves a filed note back to the inbox).
Without these fields nothing changes (`inboxAt: null`, `captureKind: null`).

### Universal links — `GET /.well-known/apple-app-site-association`

Public. `webcredentials` is unchanged; `applinks` is new: `/p/*` (a page, with an optional `#<blockId>` fragment) opens in the
iOS / iPadOS app when it is installed.

```json
{ "webcredentials": { "apps": ["3YM54G49SN.ai.spboucher.spnotes", "3YM54G49SN.ai.spboucher.spnotes.ios"] },
  "applinks": { "details": [ { "appIDs": ["3YM54G49SN.ai.spboucher.spnotes.ios"], "components": [ { "/": "/p/*", "comment": "a page, optional #blockId" } ] } ] } }
```

### Capture kinds

`POST /api/capture` accepts `kind`: `note | idea | tasks | link | photo | file | audio | screenshot | selection | document`
(the last three since the productivity merge; details and examples in `API-NEXT-AI.md` §5.0). `400 bad_request` for another kind.

### Liveness — `GET /api/health`

Public, unchanged keys. `version` is now the same string as `GET /api/meta` (`3.0.0…`; it reported the raw `APP_VERSION` of the
environment, e.g. `2.0.0-dev`), and `time` is ISO-8601 UTC.

---

## 5. Error codes

| HTTP | `code` | Where | Meaning |
|---|---|---|---|
| 400 | `bad_request` | everywhere | malformed id, date, number or enum; a body that fails its schema (`"error": "Validation: …"`); invalid JSON; a page set as its own parent |
| 400 | `bad_filter` / `bad_sort` | database query, bulk | filter / sort not understood (unknown property or operator, wrong shape) |
| 400 | `last_view` | `DELETE …/views` | the only view of a database cannot be deleted |
| 400 | `bad_id` / `too_many_ids` | `/api/research/references` | malformed id in `ids`, `projectId`, `pageId`, `attachmentId`; more than 200 ids |
| 400 | `bad_cursor` | `/api/sync`, `/api/events`, `/api/tasks?since=` | cursor not usable |
| 400 | `bad_kinds` | `/api/sync`, `/api/events` | unknown kind; `kinds` lists the valid ones |
| 400 | `bad_view` | `/api/graph` | unknown `view` |
| 400 | `bad_page` | tasks, concepts | the page is not a (live) page of the workspace |
| 400 | `bad_parent` | `PATCH /api/pages/<id>` | unknown parent |
| 400 | `bad_node` | relations | a node does not exist / same node twice; `field` (`fromId` \| `toId`) |
| 400 | `bad_document` | pages | document refused (structure or attr limits) |
| 400 / 413 | `bad_canvas` | canvas | canvas refused (413: too large) |
| 401 | `unauthenticated` | everywhere | no valid session |
| 403 | `csrf` | mutations | missing or foreign `Origin` |
| 403 | `reauth_required` | purge | passkey verified more than 5 minutes ago |
| 404 | `not_found` | everywhere | well-formed id, no such object (every 404 carries it now, 2.x routes included) |
| 404 | `not_canvas` | canvas | the page exists and is not a canvas |
| 409 | `conflict` | pages, canvases, restore | `baseVersion` is stale; `server` = current copy |
| 409 | `cycle` | `PATCH /api/pages/<id>` | the parent is a descendant of the page |
| 409 | `id_taken` | creates | the id belongs to another workspace / parent |
| 409 | `relation_exists` | relations | same (from, to, relType); `id`, `status` |
| 409 | `concept_exists` | concepts (create and rename) | same name; `id`, `status` |
| 409 | `reference_deleted` | `POST /api/research/references` | the client id belongs to a deleted reference; `id`, `deletedAt` |
| 409 | `invalid_state` | agents, inbox | default code of a 409: the object is not in a state that allows the action |
| 409 | `derived_edge` | relations | the edge comes from a document (or is a link suggestion): not editable this way |
| 409 | `row_deleted` | database rows | the client id belongs to a deleted row |
| 410 | `gone` | files | file missing on disk |
| 416 | — | files | unsatisfiable range (no JSON body) |
| 500 | `internal` | everywhere | server bug; `requestId` |
| 501 | `not_implemented` | zoom level 1 | feature not provided by this server yet |
| 502 | `ai_empty` | brief summary | the model returned nothing |

---

## 6. Deviations from SPEC v1 and known limits

1. **`canvas.edited` is coalesced** like `page.edited` (SPEC lists coalescing for `page.edited` only): a canvas autosaves on every
   gesture and would otherwise flood the journal.
2. **Extra columns** beyond SPEC §3: `knowledge_edges.updated_at`; `concepts.model / created_at / updated_at / decided_at`;
   `page_concepts.block_id / model / created_at / decided_at`; `knowledge_insights.origin / fingerprint / decided_at`;
   `canvases.workspace_id / created_at`; `database_properties|views|rows.workspace_id` (needed to scope the feed and the tombstones);
   `knowledge_events.entity_id` is text (a tag has no uuid). The unique index of `knowledge_edges` now includes `rel_type`.
3. **`knowledge_edges.source_kind / target_kind`** are the 3.0 names; the 2.x columns `from_type / to_type` are still written with
   the same values.
4. **Time machine**: states between two history entries cannot be rebuilt (the history is a snapshot every 10 minutes / 20 saves,
   not a log of every save) — reported through `source` / `exact` rather than hidden. Edges deleted before 3.0 are unknown.
5. **Task ↔ document**: one direction is automatic (document → task); see §4.2.
6. **`reference`, `database_property`, `database_view`, `database_row` creates** answer `201` on an idempotent repeat (no
   `x-existing` header): their 2.x routes return the object directly and were kept as they are.
7. **`GET /api/tasks` and `POST|PATCH /api/tasks`** return three more keys than 2.x (`blockId`, `deletedAt`, `rev`; `rev`, `blockId`
   for the row form). Additive.
8. **Saving the same tag set again** no longer rewrites the page's tags (2.x deleted and re-inserted them, bumping `rev` twice).
9. **`DELETE /api/pages/<unknown id>`** still answers `200 {ok:true, trashed:1}` (2.x contract kept for shipped clients); nothing is
   written and nothing is journaled.
10. The **web editor** does not yet keep `id` on `listItem` / `taskItem` (Tiptap drops unknown attrs until the web workstream
    registers them): the server re-attaches the same ids at each save (§0.4), so they are stable anyway.
11. The `POST /api/pages/<id>/versions/<vid>/restore` route is new (SPEC called it "existing"); the 2.x
    `POST /api/pages/<id>/versions {version}` is unchanged.

---

## 7. Testing against the scratch instance

**Integration instance (all web workstreams merged, the one the native live tests use):** worktree `~/dev/note-next-int` (branch
`next-int`, database `note_next_int_dev`, `http://localhost:8486`), server **and worker** managed by
`bash ~/dev/note-next-int-data/srv.sh start|stop|restart|build`; a session token:
`set -a && . ./.env && set +a && node_modules/.bin/tsx scripts/dev-session.ts`. A full `pnpm test:e2e` run resets passkeys and
**revokes every session** of the scratch database at its start (the auth journeys need a clean state): make a new token afterwards.
The paragraphs below describe the foundation instance; the commands are the same with the paths and port above.

On `M4M64c`, worktree `~/dev/note-next` (branch `next`, database `note_next_dev`, `http://localhost:8483`, bound to 127.0.0.1):

```bash
ssh M4M64c
cd ~/dev/note-next
bash scripts/next-dev-server.sh status          # start | stop | status   (pid: ~/dev/note-next-data/web.pid, log: web.log)
TOKEN=$(bash scripts/next-dev-server.sh token)   # a session token for the owner of the scratch database (dev only, no passkey)
curl -s -H "Cookie: __Host-note_session=$TOKEN" http://localhost:8483/api/meta
curl -s -H "Cookie: __Host-note_session=$TOKEN" -H "Origin: http://localhost:8483" -H "Content-Type: application/json" \
     -d '{"title":"Essai"}' http://localhost:8483/api/tasks
```

From the laptop: `ssh -N -L 8483:127.0.0.1:8483 M4M64c`, then use `http://localhost:8483` with the same cookie and
`Origin: http://localhost:8483`. The token is a real session of the scratch database (90 days); a session made this way counts as
freshly verified for 5 minutes (purge routes answer `403 reauth_required` afterwards — make a new token). No worker runs for this
instance: indexing, the `graph-insights` AI job and transcription are not processed (`POST /api/graph/insights/run` with
`mode: "deterministic"` works in the request). No AI key is configured on it.

Suites: `pnpm test` (unit / integration, scratch database) · `pnpm test:http` (HTTP-level, needs the server running) ·
`bash scripts/next-migration-check.sh` (migration 0003 applied, rolled back and re-applied on a throw-away copy of the scratch
database). Regenerate this file: `node_modules/.bin/tsx scripts/next-api-examples.ts && python3 scripts/next-api-doc.py`.
