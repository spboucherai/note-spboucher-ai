# SP Note 3.0 — API contract of the backend foundation (`API-NEXT.md`)

Reference for the native clients (SPNotesCore 2.0, SP Notes macOS / iOS 2.0) and the web client. It specifies what the backend
workstream added for « Next Generation » (SPEC v1, 2026-11-19): change feed for entities, tasks, events journal, time machine,
knowledge graph 2.0, canvas, knowledge health, brief, living blocks, semantic zoom (levels 2–3), the document layer of the new nodes,
and the defects fixed. Everything that existed in 2.x keeps its path and its shape (see `docs/architecture.md` and audit-web §2); only
the differences are written here.

**Every JSON example in this file is a real answer** of the scratch instance (`note_next_dev`, branch `next`), recorded by
`scripts/next-api-examples.ts` on {{generatedAt}} and inlined by `scripts/next-api-doc.py`. Do not edit `API-NEXT.md` by hand: edit
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

`code` is what clients test. A `500` is `{"error":"Internal error","requestId":"…"}` and always a server bug. Since 3.0 **malformed
input never answers 500**: a path / query / body value that is not what the route expects (a non-UUID id, an unparsable date, an
unknown enum value) answers `400` — with `code: "bad_request"` when the check is central (path and query ids), or without `code`
when it comes from the body schema (`"error": "Validation: <field> <reason>; …"`). A well-formed id that does not exist answers `404`.
The full list of codes is in [§5](#5-error-codes).

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
   | reference | `POST /api/research/references` `{id}` | new field; answers `201` both times (no `x-existing`) |
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

## 1. Meta

### `GET /api/meta`

{{ex:meta}}

`api` is the API level (3). `version` is `3.0.0` in production (a scratch build keeps its suffix). **Gate UI on `features`, never on
`version`.** Flags of this workstream: {{cat:features}}. The AI workstream appends its own (see `API-NEXT-AI.md`). A 2.x server
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
- **With `kinds`** — a comma list among {{cat:entityKinds}}, or `kinds=all` — the answer gains one key, **last**:
  `"entities": { "<kind>": [ row, … ] }` (one array per requested kind, in the order above, possibly empty), and `tombstones`
  also contains the tombstones of the requested kinds. An unknown kind → `400 bad_kinds` (the body lists the valid ones).

Windowing is the one of pages, applied to every list together: each list is `since < rev ≤ head`, oldest first, at most `limit` rows;
when at least one list was cut, `more` is `true`, `cursor` is the lowest last revision among the cut lists, and **every** list is
trimmed to `rev ≤ cursor` — nothing is skipped, nothing is sent twice. Call again with `since=cursor` until `more` is `false`
(`cursor == head`). `since > head` → `reset: true` (restart from 0), with `"entities": {}` when `kinds` was given.

**A cursor is only valid for the set of kinds it was obtained with.** A client that starts asking for a kind it did not ask for
before must read that kind from `since=0` (simplest: keep one cursor for `kinds=all` and, on first run of 2.0, restart from 0;
pages already known are simply overwritten with identical data).

Soft-deleted rows (tasks, databases, database rows, references) stay in the feed as rows with `deletedAt`. A **tombstone**
`{id, kind, rev, deletedAt}` means the row no longer exists: permanent deletion, including by cascade (purging a database page emits
tombstones for the page, the database, its properties, views and rows; purging a canvas page for the page and the canvas — the
canvas tombstone's `id` is the page id). Re-creating an id removes its tombstone.

Example — everything created by one small scenario, `kinds=all` (the `pages` array and the long lists are abbreviated here, nothing else):

{{ex:sync_entities}}

The same server, asked without `kinds` right after (2.x shape):

{{ex:sync_2x}}

{{ex:sync_bad_kinds}}

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
| `edge` | `id` uuid · `fromId` uuid · `toId` uuid · `sourceKind` · `targetKind` (`page\|reference\|concept`) · `kind` (`link` document link · `cites` citation · `relation` typed relation · `ai_suggested` 2.x link suggestion) · `relType` ({{cat:relTypes}}) · `origin` (`user\|ai\|system`) · `status` (`suggested\|accepted\|rejected`) · `confidence` number? · `rationale` string? · `note` string? · `model` string? · `validFrom` date? · `validTo` date? · `sourceBlockId` string? · `targetBlockId` string? · `createdAt` · `updatedAt` · `decidedAt` date? · `rev` |
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

{{ex:task_create}}

The same request sent again (lost answer, retry):

{{ex:task_create_again}}

{{ex:task_bad_page}}

### `GET /api/tasks`

`?done=1` (include done tasks) · `?pageId=<uuid>` · `?since=<rev>` (delta: the tasks whose `rev` is greater, **deleted ones
included**, whatever `done`, oldest revision first; for a complete, paged feed use `/api/sync?kinds=task`). → array (≤ 500), open
first, then by `dueAt` (nulls last), then newest. Keys: the
12 keys of 2.x in the same order (`id, title, status, priority, dueAt, completedAt, project, pageId, createdAt, updatedAt, pageTitle,
pageIcon`) followed by `blockId, deletedAt, rev`.

{{ex:tasks_list}}

### `GET /api/tasks/<id>` · `PATCH /api/tasks/<id>` · `DELETE /api/tasks/<id>`

- `GET` → the task, in any state (a deleted task answers `200` with `deletedAt`). `404 not_found`.
- `PATCH` body: any of `title, status, priority, dueAt | due, project, pageId, blockId` (same types as POST) → the task.
  `404 not_found` (unknown or deleted), `400 bad_page`. Setting `pageId: null` without `blockId` also clears `blockId`.
- `DELETE` → soft delete, `200 {"ok":true,"deleted":true}`; **idempotent**: on an already deleted task
  `200 {"ok":true,"deleted":false}`; unknown id `404`.

{{ex:task_patch}}

{{ex:task_delete}}

{{ex:task_delete_again}}

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

{{ex:task_get_linked}}

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

`relType` ∈ {{cat:relTypes}}. Several relations of different types may join the same two nodes; (`fromId`, `toId`, `kind`, `relType`)
is unique. Direction matters: `fromId` —relType→ `toId`.

**Anything created by a model is `status: "suggested"`, `origin: "ai"`, and stays so until the user decides** (`PATCH … {status}`).
`origin` never changes: an accepted AI relation is `origin: "ai", status: "accepted"`. Clients must mark `origin: "ai"` visibly.

### `POST /api/graph/relations`

Body: `id?` uuid · `fromId` uuid · `toId` uuid · `sourceKind?` · `targetKind?` (`page|reference|concept`, default `page`) · `relType`
· `note?` string ≤ 2 000 \| null · `validFrom?` · `validTo?` ISO datetime with offset \| null · `sourceBlockId?` · `targetBlockId?`
string ≤ 64 \| null.

→ `201` relation (`origin: "user"`, `status: "accepted"`, `decidedAt` set). Idempotent on `id` (`200`, `x-existing: 1`).
Errors: `400` validation · `400 bad_node` (a node does not exist, is trashed, or both ends are the same node; `field` says which) ·
`400 bad_request` (`validTo` before `validFrom`) · `409 relation_exists` (same from, to, relType; `id` and `status` of the existing one) ·
`409 id_taken`.

{{ex:relation_create}}

{{ex:relation_exists}}

### `GET /api/graph/relations`

`?nodeId=<uuid>` (relations touching that node) · `?status=` · `?relType=` · `?origin=` · `?include=cites,ai_suggested,link` (adds
those families; default: kind `relation` only). → `{ "relations": [ … ] }`, newest first, ≤ 500. Relation object = the `edge` row of
the feed + `fromTitle`, `toTitle`.

{{ex:relations_list}}

### `GET | PATCH | DELETE /api/graph/relations/<id>`

- `PATCH` body: any of `status` (`accepted|rejected|suggested`), `relType`, `note`, `validFrom`, `validTo` → relation. A status
  change sets `decidedAt` (null when put back to `suggested`). `409 derived_edge` for `link` / `cites`; an `ai_suggested` edge accepts
  only `status` (2.x behaviour kept: accepting it creates the backlink). `409 relation_exists` when the new `relType` collides.
- `DELETE` → `{"ok":true}`; only kind `relation` (`409 derived_edge` otherwise; a link suggestion is rejected, not deleted).

{{ex:relation_patch}}

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

{{ex:graph_local}}

{{ex:graph_timeline}}

### Concepts — `GET | POST | PATCH /api/concepts`, `GET | PATCH | DELETE /api/concepts/<id>`

- `GET /api/concepts?status=accepted|suggested|rejected|all&pageId=` → `{ "concepts": [ … ] }` by name (default `accepted`). Concept
  object = the feed row + `pages` (accepted links to live pages) + `suggestedPages`.
- `POST` body: `id?` · `name` 1…120 (whitespace collapsed; unique per workspace, case-insensitive) · `description?` ≤ 2 000 ·
  `pageIds?` uuid[≤ 200] → `201` concept **with `pageLinks`** (`200` + `x-existing: 1` for a known `id`). `409 concept_exists`
  (`id`, `status`) · `400 bad_page` (`pageIds`).
- `GET /api/concepts/<id>` → concept + `pageLinks: [{pageId, title, icon, origin, status, confidence, blockId, model, createdAt}]`.
- `PATCH /api/concepts/<id>` (or `PATCH /api/concepts` with `id` in the body) — any of: `name`, `description`, `status`
  (`accepted|rejected|suggested`), `addPages` uuid[], `removePages` uuid[], `pageLinks: [{pageId, status}]` (accept / reject a
  suggested link) → concept + `pageLinks`.
- `DELETE /api/concepts/<id>` → `{"ok":true}` (its links and the relations touching it go with it).

{{ex:concept_create}}

{{ex:concept_patch}}

### Insights — `GET /api/graph/insights`, `POST /api/graph/insights/run`, `PATCH /api/graph/insights/<id>`

`GET /api/graph/insights?status=suggested|accepted|dismissed|all&kind=&limit=<1..100, default 20>&intelligence=0`
→ `{ intelligence, insights, counts }`.

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

{{ex:insights_run}}

{{ex:insights}}

`PATCH /api/graph/insights/<id>` `{ "status": "accepted" | "dismissed" | "suggested" }` → the insight + `relationId`. Accepting a
`contradiction` between two pages records the relation `contradicts` (`origin: "ai"`, accepted by that decision) and returns its id.

{{ex:insight_patch}}

<!-- AI-WORKSTREAM --> The AI job's provider call goes through `routedInsightModel` in `src/lib/graph/insights.ts` (existing router,
task `reason`, strict JSON schema `INSIGHT_SCHEMA`). It has been tested with an injected model only; no real provider call was made
by this workstream.

---

## 4.4 Events journal and time machine

### Events

An event: `{ id, at, kind, pageId, pageTitle, pageIcon, entityKind, entityId, actor, device, summary, data }`.
`actor` ∈ `user | agent | ai | system`; `device` is the session's device label (null for jobs); `pageTitle` / `pageIcon` are the
**current** ones (null when the page was purged); `summary` is the title or the name at the time of the event.

Kinds (30): {{cat:eventKinds}}.

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

{{ex:events}}

{{ex:events_project}}

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
| `none` | `existed: false` (created after `at`), or it existed and no history covers that date | — |

`relations[]`: edges touching the pages of the scope that were created by `at`, accepted by `at`, and valid at `at` when they carry a
validity interval (edge keys + `fromTitle`, `toTitle`). `references[]`: references created by `at` (and not deleted by then) attached
to or cited by those pages. `removedSince[]`: `link.removed` / `relation.removed` events after `at` on those pages — what existed
then and is gone now, as far as the journal knows.

To bring a page back to a listed state: **`POST /api/pages/<id>/versions/<versionId>/restore`** — optional body
`{ "baseVersion": <currentVersion> }` → `200 {"ok":true,"version":<new>,"restored":<version number>}`. `<versionId>` is the entry id
(or its version number). The current state is saved in the history first (same path as the 2.x `POST /api/pages/<id>/versions
{version}`, which still exists). With `baseVersion`, `409 conflict` when the page changed meanwhile. `404` unknown entry, `400`
malformed.

{{ex:timemachine_page}}

{{ex:timemachine_project}}

---

## 4.5 Knowledge health

### `GET /api/health/knowledge`

`?inactiveDays=<1..3650, default 30>`. Authenticated (the public liveness probe `GET /api/health` is unchanged). Computed from real
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

{{ex:health}}

---

## 4.6 Brief

### `GET /api/brief`

`?tz=<IANA zone>` (default: the server's `TZ`, `America/Toronto`); `400 bad_request` for an unknown zone. **No model is called.**

`recentNotes` (8 most recently modified live pages, outside the inbox and database rows) · `activeProjects` (top-level pages of the
section `projects` with a change in their subtree in the last 14 days: `pages`, `openTasks`) · `tasks.overdue` / `tasks.dueToday` /
`tasks.dueSoon` (the 6 days after today), « today » being the calendar day in `tz` · `unfiledCaptures` `{count, items ≤ 10}` ·
`linkSuggestions` `{count, items ≤ 5}` — suggested page ↔ page edges awaiting a decision, each **`ai: true`** · `toRevisit` (≤ 8
connected pages nobody opened or edited for 30 days, most central first) · `aiSummary` — `null`, or the last summary explicitly
requested `{ai: true, text, model, at}`.

{{ex:brief}}

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

{{ex:query_tasks}}

{{ex:query_database}}

{{ex:query_backlinks}}

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

{{ex:canvas_get}}

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

{{ex:canvas_put}}

{{ex:canvas_conflict}}

{{ex:canvas_bad}}

{{ex:canvas_not_canvas}}

---

## 4.9 Semantic zoom

### `GET /api/pages/<id>/zoom?level=1|2|3` (default 2)

- **3** → `{ level: 3, pageId, title, version, updatedAt, ai: false, content }` — the full document.
- **2** → the outline, computed without any model: `{ level: 2, pageId, title, version, updatedAt, ai: false, sections }`. One
  section per top-level heading (any level), preceded by a section with `heading: null`, `level: 0` for the text before the first
  heading. `sections[]`: `blockId` (of the heading; of the first block for the leading section) · `level` 0…6 · `heading` ·
  `firstSentence` — of the first non-empty block of the section: up to the first `.`, `!`, `?` or `…` followed by whitespace or the
  end, at most 240 characters (cut on a word + `…`) · `words` · `blocks` (non-empty body blocks).
- **1** → <!-- AI-WORKSTREAM --> AI synopsis, cached and marked `ai: true` (shape `ZoomSynopsis` in `src/lib/pages/zoom.ts`;
  documented in `API-NEXT-AI.md`). Until the AI workstream provides it: `501 not_implemented`. Seam: assign
  `zoomSynopsis.provider` in `src/lib/pages/zoom.ts`.

Works on a trashed page. `400 bad_request` for another level.

{{ex:zoom2}}

{{ex:zoom1}}

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

{{ex:file_range}}

{{ex:file_range_416}}

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

{{ex:error_bad_id}}

### Parent cycles

`PATCH /api/pages/<id> { parentId }`: the new parent must be a page of the workspace (`400 bad_parent`) and must not be the page
itself (`400`) or one of its descendants (`409 cycle`). Nothing is written when refused.

{{ex:error_cycle}}

### Tags

`GET /api/tags` → `[{id, name, color, pages}]`: `pages` is now the number of live pages carrying the tag (it was always 0).

{{ex:tags}}

---

## 5. Error codes

| HTTP | `code` | Where | Meaning |
|---|---|---|---|
| 400 | — | any body | `"error": "Validation: …"` (body schema) or `"Invalid JSON body"` |
| 400 | `bad_request` | path / query values, a few body checks | malformed id, date, number or enum |
| 400 | `bad_cursor` | `/api/sync`, `/api/events`, `/api/tasks?since=` | cursor not usable |
| 400 | `bad_kinds` | `/api/sync`, `/api/events` | unknown kind; `kinds` lists the valid ones |
| 400 | `bad_view` | `/api/graph` | unknown `view` |
| 400 | `bad_page` | tasks, concepts | the page is not a (live) page of the workspace |
| 400 | `bad_parent` | `PATCH /api/pages/<id>` | unknown parent |
| 400 | `bad_node` | relations | a node does not exist / same node twice; `field` |
| 400 | `bad_document` | pages | document refused (structure or attr limits) |
| 400 / 413 | `bad_canvas` | canvas | canvas refused (413: too large) |
| 401 | `unauthenticated` | everywhere | no valid session |
| 403 | `csrf` | mutations | missing or foreign `Origin` |
| 403 | `reauth_required` | purge | passkey verified more than 5 minutes ago |
| 404 | `not_found` | everywhere | well-formed id, no such object (some 2.x routes answer 404 without `code`) |
| 404 | `not_canvas` | canvas | the page exists and is not a canvas |
| 409 | `conflict` | pages, canvases, restore | `baseVersion` is stale; `server` = current copy |
| 409 | `cycle` | `PATCH /api/pages/<id>` | the parent is a descendant of the page |
| 409 | `id_taken` | creates | the id belongs to another workspace / parent |
| 409 | `relation_exists` | relations | same (from, to, relType); `id`, `status` |
| 409 | `concept_exists` | concepts | same name; `id`, `status` |
| 409 | `derived_edge` | relations | the edge comes from a document (or is a link suggestion): not editable this way |
| 409 | `row_deleted` | database rows | the client id belongs to a deleted row |
| 410 | `gone` | files | file missing on disk |
| 416 | — | files | unsatisfiable range (no JSON body) |
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
