# Databases Next Generation (SP Note 3.0, productivity workstream)

Branch `next-p-db`. This file says what exists after this work, what changed in the data and in the API, what was measured, and
where the limits are. Routes that existed in 2.x keep their paths and their answer shapes; every change below is additive unless it is
listed under "Behaviour changes".

## 1. What exists

| Area | State |
|---|---|
| Query engine | Filters, sorts, search, grouping, aggregates and pagination run in PostgreSQL (`src/lib/databases/engine.ts`) for every stored type: title, text, URL, number, date, checkbox, select, status, multi-select, AI text, file (empty / not empty), created time, last-edited time. Only the requested window is hydrated (relations, rollups, formulas). |
| JavaScript fallback | A rule or a sort on a **relation, rollup or formula**, a date operator (`before / after / on`) on a non-date property, a text operator on a number / date / checkbox, and a **search in a database that has a rollup or a formula** use the 2.x path (`queryRowsJs`: load, hydrate, filter in memory). For a top-level AND, the rules that can run in SQL still do. The answer says so: `engine: "js"`, `fallback: ["filter:formula", …]`; the table footer shows "computed". |
| Windows | The UI loads pages of 100 rows by offset (`window.ts`); the 500-row cap is gone. The **table is virtualised** (36 px rows, only the rows on screen + 8 of overscan are in the DOM). Phone cards, list, gallery and board columns load 100 (board: 50) more on demand — they are not virtualised: their DOM grows with what was loaded. |
| Grouping | Table, board, list and phone cards, by a select, status or checkbox property. Counts, offsets and per-number-property sum / average / min / max of each group are computed by the server on the whole result. Groups collapse; the collapsed keys are saved with the view (`config.collapsed`). |
| Rollups | 19 aggregates: count, count values, sum, average, min, max, unique, show original + count unique, empty, not empty, percent empty / not empty, checked, unchecked, percent checked / unchecked, median, range. Rollups over a relation, a rollup or a formula of the target rows are computed (audit D9), two levels deep at most. |
| Formulas | Errors are per cell with their message; an error in a formula that another formula reads is reported (`Error in "X": …`) instead of being read as empty; a dependency cycle is detected, named (`A → B → A`), refused when the property is saved (400 `formula_cycle`) and shown in the property editor; `test(s, regex)` refuses catastrophic patterns (D24). |
| Calendar | Loads the six weeks on screen from the server (not a slice of the database). Drag a row to another day (the time of day is kept), drag a row without a date onto a day, undo. "+N more" opens the day (U6); rows without a date are counted on the whole database and listed (first 50). |
| Timeline | Loads the dated rows (first 500 in the view's order, with a notice beyond). Drag a bar to move it, drag an end to stretch it, Alt+←/→ (Shift = end only) from the keyboard; undo. |
| Gallery | Cover = a file property, the page cover, or none; card size (small / medium / large); image fill or fit; properties shown on cards — saved with the view. |
| Filter builder | AND / OR groups nested up to three levels; a local draft saved 400 ms after the last change (U4); incomplete rules are marked and not applied; the server validates (D10). |
| Table editing | Keyboard: arrows, Home / End, PageUp / PageDown, Enter or F2 (edit; toggles a checkbox), Tab / Shift+Tab (move, and commit + move while editing), type-to-edit, Delete / Backspace (clear), Escape (cancel; clears the selection), Space (toggle / open the row). A non-number typed in a number cell is refused and the value kept (U1). Enter on a control inside a cell goes to that control (U5). |
| Selection, bulk | Row checkboxes, shift-range (fetches the ids of windows that are not loaded), select-all on every row of the view + search (not only the loaded ones). Bulk: edit a property, move to a group, duplicate, delete. |
| Undo / redo | ⌘Z / ⇧⌘Z (Ctrl+Z / Ctrl+Y) and buttons: cell edits, new row, duplicate, delete, calendar / timeline drags, board moves, every bulk action. The client stack holds 50 entries for the time the database is open; each entry calls the server (re-sent values, `rows/restore`, or the bulk journal `rows/undo`). |
| Columns | Width, order (drag a header, or Move left / right) and visibility are saved per view (`config.widths`, `config.order`, `config.hidden`). Footer per number column: sum, average, min, max of the whole result (`config.footers`). |
| Row templates | Presets of values + page body per database; "Save as template" from a row, New ▾ creates from a template, one template can be the default of the New button. |
| CSV | Export streams every row of the view (D11; the search box is passed too). Import: no header / empty / not multipart → 400 (D4). |
| Smart (AI) properties | Configuration UI (task, prompt, choices, model through `ModelPicker`, auto-run, AI-managed), generate / regenerate per cell, retry on a failed cell (D8), "Fill empty cells" and "Recompute all" for the rows of the view (1 000 per click, with a confirmation that states the count), runs log drawer (status, trigger, model, provider, tokens, cost, error, retry). AI text carries the AI mark. A value typed by hand is protected by the API (`user_edited`); the UI offers "Replace with AI", which sends `force`. |
| Phones | 360 / 375 / 430 px: every view fits; cards, list and gallery load by pages; the grid is the same virtualised grid; bulk bar, filter builder (in the options sheet), New ▾ are touch-sized. |

## 2. Data changes — migration `0005_next_productivity`

Additive only; rollback in `drizzle/0005_next_productivity.down.sql`; journal entry idx 5 (`when` 1795305600000).

| Object | Columns / definition | Use |
|---|---|---|
| table `database_row_templates` | `id, workspace_id → workspaces, database_id → databases (cascade), name, icon, values jsonb, content jsonb, position, is_default, created_at, updated_at`; index `(database_id, position)` | row templates |
| table `database_row_ops` | `id, workspace_id → workspaces, database_id → databases (cascade), kind (update / delete / duplicate), data jsonb, row_count, created_at, undone_at`; index `(database_id, created_at)` | undo / redo journal of bulk actions; entries older than 7 days are deleted when a new one is written |
| index `db_rows_db_pos_idx` | `database_rows (database_id, position, created_at)` | default order read window by window |

Neither table is in the sync feed (`/api/sync`): native clients do not read them. `src/db/schema.ts`: `databaseRowTemplates`,
`databaseRowOps`, and the index on `databaseRows`.

View configuration (JSON, no migration) gains: `collapsed: string[]`, `order: string[]` (now read), `footers: {propertyId: "sum" |
"avg" | "min" | "max"}`, `cover: "property" | "page" | "none"`, `cardSize`, `coverFit`, `cardProps: string[]`.

## 3. API changes

### 3.1 `POST /api/databases/<id>/query` (existing; answer still `{rows, total, limit, offset}`)

New optional inputs: `extraFilter` (group ANDed with the filter), `groupBy` (id of a select / status / checkbox property, or null),
`skipGroups` (keep the group-first order, skip the group counts), `aggregates` (bool), `rowIds` (≤ 500 uuids: only those rows),
`limit: 0` (counts only; was min 1). New answer fields: `engine` (`"sql"` | `"js"`), `fallback` (reasons, JavaScript path only),
`hasMore`, `groups: [{key, count, offset, aggregates}]` (with `groupBy`; key = option id, `"true"` / `"false"`, or `"__none"`;
`offset` = index of the group's first row in the returned order), `aggregates: {propertyId: {sum, avg, min, max, count}}`. With
`groupBy`, rows are ordered by group (option order, "no value" last), then by the sorts. Rows gain `cover` when the row page has one.

Errors: an explicit `filter` / `extraFilter` / `sorts` naming an unknown property, an unknown operator, a group with both `and` and
`or`, or nested deeper than 4 → `400 bad_filter` / `400 bad_sort`. `groupBy` on another type → `400 bad_request`.

### 3.2 New routes

| Route | Body → answer |
|---|---|
| `PATCH /api/databases/<id>/rows` `{move: {id, after? \| before?}}` | → `{id, position}`. One row written (fractional position; renormalised when no room is left). Replaces the full `order` list for a single move (D7); `order` still works. |
| `POST /api/databases/<id>/rows/duplicate` `{id}` \| `{ids ≤ 200}` | → 201 the new row / rows. Copies stored values, forward relations, body, icon, cover; title `"<title> (copy)"`; placed after its source. |
| `POST /api/databases/<id>/rows/bulk` `{action: "update" \| "delete" \| "duplicate", values?, ids? \| all?: {viewId?, filter?, extraFilter?, search?, except?}}` | → `{ok, action, affected, opId, rows?}`. Limits: update 50 000 rows, delete 5 000, duplicate 200 (`400 too_many`). `update` accepts text, number, date, checkbox, status, select, multi-select, URL. |
| `POST /api/databases/<id>/rows/undo` `{opId, redo?}` | → `{ok, kind, affected, undone}`; `404` when the journal entry is gone, `409` when already in that state. |
| `GET / POST / PATCH / DELETE /api/databases/<id>/row-templates` | list · create `{id?, name, icon?, values?, content?, fromRowId?, isDefault?}` → 201 · patch `{id, …}` · delete `?id=` |
| `POST /api/databases/<id>/rows` (existing) | new optional `templateId`: template values are the defaults (explicit values win), its body and icon fill what is not sent. |

### 3.3 Behaviour changes (all fixes of audited defects)

- **D4** CSV import without header / empty file / non-multipart body: 400 (`bad_csv`, `bad_request`) instead of 500.
- **D7** the web client moves one row with `{move}`; drag-reorder is disabled while a filter is active.
- **D9** rollups over relation / rollup / formula targets compute. A rollup whose relation has no linked row now answers `0` / `null`
  instead of `{error: "No target property"}`.
- **D10** view `POST` / `PATCH` validate `config.filter` and `config.sorts` (400). Deleting a property removes its rules, sorts and
  settings from every view of the database, so a stored view never holds a dead reference.
- **D11** `GET …/query?format=csv` and `GET /api/databases/<id>?format=csv` stream every row (was 1 000). An empty database exports
  the header line without a trailing line break.
- **D20** relation writes keep only rows of the target database. **D21** deleting the reverse side of a two-way relation clears
  `twoWay` on the forward property.
- **D23** `GET …/rows?limit=&offset=`: not a whole number ≥ 1 / ≥ 0 → 400.
- **D24** `test(s, regex)`: pattern > 300 characters or with nested quantifiers → `{error}` in the cell; tested string capped at 20 000 characters.
- **Formulas**: a formula reading a formula in error now shows `Error in "X": …` (it used to compute with an empty value).
- **Filters on AI cells**: a pending or failed AI cell is *empty* for `empty` / `not_empty` in every path (the 2.x SQL pushdown called it filled, the JavaScript path empty).
- **Search (SQL path)** also matches a date by its ISO form (`2026-11`); the displayed form (`Nov 14`) still matches. Checkbox "Yes / No" and created / last-edited times are not searched in SQL (they were in 2.x, through their display text).
- **Text sorts** use the ICU root collation (`und-x-icu`) when the server has it (PostgreSQL 17 here), else the database collation; the 2.x path used `localeCompare`.
- `GET …/rows?q=` (relation picker) now applies its limit in SQL.
- Bulk edits through `rows/bulk` trigger AI auto-run only for ≤ 25 rows sent as `ids`.

## 4. Measurements

Machine: M4M64c (Mac Studio M4 Max, 64 GB), PostgreSQL 17.11 shared with other databases, Node v26.10.0. Database "BENCH 20k rows":
20 000 rows, 12 properties (status, select, multi-select, 2 numbers, date, checkbox, text, URL, created time, 1 formula), seeded by
`scripts/db-seed-bench.ts` (deterministic). Nothing below is estimated.

### 4.1 Server query time, in process (`scripts/db-bench.ts`, 9 runs after 1 warm-up, median / p95 in ms)

"2.x" = `queryRowsJs`, the previous engine, kept in the code as the fallback; "3.0" = `queryRows`. Both hydrate what they return
(2.x: 500 rows, the old UI window; 3.0: 100 rows, the new window — the second line uses 500 for both).

| Scenario | 2.x median (p95) | 3.0 median (p95) | engine | × | rows matched |
|---|---|---|---|---|---|
| first page, default order | 105.5 (107.4) | 6 (6.2) | sql | 17.6 | 20,000 |
| first page, same window as 2.x (500 rows) | 105.2 (109.3) | 8.1 (8.6) | sql | 13 | 20,000 |
| filter: Status = doing AND Estimate > 100 | 106 (110) | 13.8 (15) | sql | 7.7 | 3,280 |
| filter: Owner contains "mat" (pushdown existed in 2.x) | 18.6 (19.8) | 9.6 (9.7) | sql | 1.9 | 2,480 |
| sort: Cost descending | 111.4 (113.2) | 15.4 (17.1) | sql | 7.2 | 20,000 |
| sort: Due ascending, then title | 124.7 (127.8) | 19.7 (23.5) | sql | 6.3 | 20,000 |
| filter + sort (Tags contains research, Due before 2027, by Estimate desc) | 110.8 (112.1) | 17.2 (19.4) | sql | 6.4 | 2,240 |
| search "zephyr 12" | 157.3 (161.7) | 157.4 (160.9) | js | 1 | 38 |
| deep window (offset 19 900) | 105.3 (106.6) | 17.6 (24.5) | sql | 6 | 20,000 |
| grouped by Status: window + whole-database counts and sums | 104.2 (106.6) | 38.9 (40.6) | sql | 2.7 | 20,000 |
| sort on a formula (JavaScript fallback in 3.0) | 106.4 (113.1) | 106.6 (112.9) | js | 1 | 20,000 |

Note on the search line: the 2.x number above was measured after the `Intl` formatters were cached in `values.ts` (a change of this
branch that also speeds up the old path). Before that change the same 2.x search took **1 658–1 925 ms** (measured on this database,
same script). The benchmark database has a formula, so 3.0 searches it through the JavaScript path; on the same rows without the
formula property the SQL search took 17–59 ms warm over six search terms (measured once with an ad-hoc script that is not kept in the repository).

### 4.2 HTTP (running server: auth, JSON), from the Playwright run — `db-metrics.json`

| Request | median ms | p95 ms | engine | rows matched |
|---|---|---|---|---|
| first window (100 rows, default order) | 64.3 | 66.2 | sql | 20,000 |
| filtered (Status = doing AND Estimate > 100), sorted by Due desc | 35.4 | 37 | sql | 3,280 |
| sorted by Cost desc | 37.3 | 39.5 | sql | 20,000 |
| grouped by Status (window + counts + sums) | 75.1 | 76.7 | sql | 20,000 |
| deep window (offset 19 900) | 42.2 | 42.8 | sql | 20,000 |
| search “zephyr 12” (database has a formula → JavaScript path) | 166.9 | 184.5 | js | 38 |
| sorted by a formula (JavaScript path) | 104.9 | 114.6 | js | 20,000 |

These HTTP times were taken with the web server limited to one connection per pool (the scratch database accepts 6 connections in
all); an earlier run of the same test with pools of two measured medians of 27.8 / 31.3 / 24.3 / 40.3 ms for the first four lines.

CSV export of the 20 000 rows: 2,742,907 characters in 422 ms (one GET, whole body read by the test).

### 4.3 Browser scroll (headless Chromium via Playwright, 1280×800, production build)

Frame-to-frame time measured with `requestAnimationFrame` while `scrollTop` advances every frame. The first rows were visible
383 ms after navigation started; 24 rows in the DOM at rest.

| Pattern | frames | median ms | p95 ms | p99 ms | max ms | frames > 16.7 ms | > 33 ms | > 50 ms | max rows in DOM |
|---|---|---|---|---|---|---|---|---|---|
| wheel-like (36 px / frame ≈ 60 rows / s) | 299 | 16.7 | 16.8 | 16.8 | 16.8 | 0 | 0 | 0 | 33 |
| fast (360 px / frame ≈ 600 rows / s) | 299 | 16.7 | 16.7 | 16.8 | 16.8 | 0 | 0 | 0 | 33 |
| scrollbar sweep (3 600 px / frame, whole 20 000 rows in ≈ 3.3 s) | 199 | 16.7 | 16.8 | 16.8 | 16.8 | 0 | 0 | 0 | 32 |

Windows fetched during the three scroll patterns: 77 of 200 (requests are throttled to one per 120 ms while scrolling).

Headless Chromium is not a display: these are main-thread frame times, not presented frames on a screen. No "before" was measured
for scrolling: the 2.x grid could not show more than 500 rows.

### 4.4 Smart property with a real provider (one run)

One cell classified by `claude-haiku-5-5` (anthropic): 538 input + 13 output tokens, **0.0000603 USD**, answer `Urgent` — read from `ai_property_runs` by the opt-in e2e test (`E2E_REAL_AI=1`). Every other AI test uses the local fake model.

## 5. Limits (known, not hidden)

- **Virtualisation is the table only.** Cards, list, gallery and board grow in the DOM as more pages are loaded (100 per step).
- **JavaScript path** (see §1) still loads and hydrates the whole (pre-filtered) database per query: a sort on a formula over 20 000
  rows costs what 2.x cost (§4.1, last line). CSV export and bulk-by-query of such a view load it once and slice.
- **Timeline** shows at most 500 dated rows; **calendar** at most 1 000 rows per six-week window; undated lists show 50.
- **Grouping** only by select, status, checkbox (as in 2.x). No sub-groups, no manual order inside a board column.
- **Row height is fixed** (36 px): a cell with many chips is clipped in the grid (the row panel shows everything).
- **Bulk limits**: 50 000 rows per edit, 5 000 per delete, 200 per duplicate. A delete of more than 100 rows uses a batch path that
  writes no per-page `page.trashed` journal event (the rows and pages are trashed and restorable the same way).
- **Undo** lives in the open page (not across reloads); bulk undo entries are kept 7 days on the server but the client forgets its
  stack on reload. Property and view changes are not on the undo stack (hiding a column offers its own Undo toast).
- **Shift-range** selects at most 5 000 rows; "Select all" covers more.
- **Column fill** of an AI property runs on the rows of the view, 1 000 per click, sequential batches of 200 (the API limit).
- **Rollup depth**: a rollup of a rollup of a rollup answers `{error: "Rollup nested too deep"}`.
- **Regex guard** is a heuristic (nested quantifiers, length); it does not prove a pattern safe.
- **Search parity**: see §3.3. A number stored as text with separators other than a comma is searched as stored.
- **Sync / natives**: row templates and the undo journal are web-only for now (not in `/api/sync`).
- Dragging a calendar chip or a column header uses HTML5 drag and drop: mouse / trackpad only. On phones the date is changed from the
  row sheet and columns are moved with "Move left / right".

## 6. Files

Server: `src/lib/databases/engine.ts` (SQL engine), `query.ts` (hydration, rollups, JS reference), `rows.ts` (move, duplicate, bulk,
undo journal, templates), `group.ts`, `formula.ts`, `csv.ts`, `service.ts`; routes under `src/app/api/databases/[id]/`.
Client: `src/components/database/` — `window.ts` (windowed loader), `undo.ts`, `views/TableView.tsx` (virtual grid), `BulkBar.tsx`,
`FilterBuilder.tsx` + `filter-logic.ts`, `view-logic.ts`, `growing.tsx`, `dates.ts`, `SmartProperty.tsx`, `RowTemplates.tsx`, and
the six views. Scripts: `scripts/db-seed-bench.ts`, `scripts/db-bench.ts`, `scripts/db-one-connection.ts`.
Tests: `tests/unit/next-p-db-engine.test.ts`, `next-p-db-rows.test.ts`, `next-p-db-client.test.ts`;
`tests/e2e/next-p-db.spec.ts`, `next-p-db-phones.spec.ts` (Playwright projects `next-p-db`, `next-p-db-phone-360/375/430`).

## 7. Verification (2026-11-19, M4M64c, scratch database `note_next_pdb_dev`)

| Command | Result |
|---|---|
| `pnpm typecheck` | exit 0 |
| `pnpm test` | 286 tests: 284 pass, 0 fail, 2 skipped (26 of them are the three `next-p-db-*` files: 26 / 26) |
| `pnpm test:http` | 9 tests: 8 pass, 1 fail — `GET /api/pages/<id>/zoom?level=1` is expected to answer 501 by `tests/http/next-api.test.ts`, and answers 200 since the AI workstream wired it (that test and that route are not part of this work) |
| `pnpm test:e2e` | 102 tests: 97 pass, 4 fail, 1 skipped (the opt-in real-provider test, run once apart: pass). Projects of this work: `next-p-db` 13 / 13 (+1 opt-in), `next-p-db-phone-360 / 375 / 430` 2 / 2 each |
| `pnpm build` | exit 0 |
| migration 0005 | down, then up again on the scratch database: tables and index removed, then back |

The 4 e2e failures are the tests that need the **worker process** (`mobile.spec.ts` "search: filters…" on the three phone projects —
"worker indexed the page" — and `desktop.spec.ts` "desktop layout…" — "Worker running" in Settings → Jobs). On this node the scratch
database is capped at 6 connections and the production build opens one pool per server bundle: the web server, the worker and the
tests do not fit together (the worker exits with "too many connections"). They were therefore not verified here; nothing they
exercise (search index, jobs panel) is touched by this branch. For the same reason the AI e2e test runs the worker's real handler
through `scripts/e2e-ai-runner.ts` (one connection) instead of the worker process: the pg-boss dispatch is not exercised by it.

Two suites assume a small scratch database and fail while the 20 000-row benchmark database (or the tombstones left by deleting it)
is present: `next-sync` ("without kinds": the page must be in the first 500 of `/api/sync`) and `next-knowledge` (health lists are
capped at 200). `tsx scripts/db-seed-bench.ts --drop` plus `delete from sync_tombstones` restores the state they expect — that is
how the 284 / 0 above was obtained; the Playwright suites re-seed the benchmark themselves.

Screenshots of the runs: `~/dev/note-next-p-db-data/shots/` (table at 20 000 rows top / bottom, collapsed groups, board, keyboard,
bulk bar, filter builder, calendar, timeline, gallery, formula cycle, AI configuration / error / runs log / real run, phones).
