# Infinite Canvas — format, operations, merge (`CANVAS.md`)

Contract of the canvas for every client (web, SPNotesCore, macOS, iOS / iPadOS). Storage and HTTP: `SPEC.md` §3.4 and
`API-NEXT.md` §4.8. Web model: `src/lib/canvas/model.ts` (pure: no DOM, no I/O). Native model: SPNotesCore `Canvas.swift`,
`CanvasMerge.swift`, `CanvasLayout.swift`. **Shared proof: `tests/fixtures/canvas/merge-cases.json` (39 cases) and
`layout-cases.json` (9 cases + generator values) — produced by the web model and checked against the Swift implementation on
2026-11-19 (60 / 60 identical).** Regenerate: `node_modules/.bin/tsx scripts/canvas-fixtures.ts`.

## 1. Format `spn-canvas-1`

```jsonc
{ "format": "spn-canvas-1",
  "nodes": [ { "id": "…", "kind": "text", "x": 0, "y": 0, "w": 240, "h": 120, "z": 0, /* fields of the kind */ } ],
  "edges": [ { "id": "…", "from": "<node id>", "to": "<node id>", "label": "…", "kind": "arrow", "color": "#rrggbb" } ],
  "viewport": { "x": 0, "y": 0, "zoom": 1 } }
```

- **Units**: world units, y down. `x, y` = top-left corner of the card, `w, h` its size. Positions written by a client are rounded
  to 1/100.
- **Ids**: any string of 1…64 characters, unique per list. New elements get a lower-case UUID on every platform.
- **Stacking**: ascending `z`; the array order breaks ties; a missing `z` is 0. `z` may be any number (fractions, negatives).
  The **array order** is the order of the outline / list mode and of the Markdown export — it is not the stacking.
- **Viewport** (web and natives must read it the same way): `(x, y)` is the **world point shown at the top-left corner of the
  view**, `zoom` = screen points per world unit: `screen = (world − (x, y)) × zoom`. It is per-device view state (see §6).
- **Unknown content**: a node kind, a node / edge / viewport field or a top-level key a client does not know is **kept verbatim**
  through load → edit → save, copy / paste, layout and merge (explicit `null` included). An unknown kind is drawn as a neutral
  read-only card that can still be moved, resized, stacked, connected and deleted. An unknown edge `kind` draws as an arrow.

### 1.1 Node kinds

| kind | fields | web behaviour | default size |
|---|---|---|---|
| `text` | `text` (Markdown: bold, italic, code, lists, headings, GFM) | rendered Markdown; edited in place as plain text | 240 × 120 |
| `page` | `pageId` | live title, icon and excerpt of the page; double-click opens the note; makes the canvas a backlink of the page | 280 × 132 |
| `image` | `attachmentId`, `text` = file name / alt | the image (cover); resize keeps the proportions unless Shift | 320 × 240 (file's ratio) |
| `pdf` | `attachmentId`, `text` = file name | first-page thumbnail (pdf.js), page count, "open" | 240 × 320 |
| `link` | `url`, `text` = title | host, title, address; only `http(s)`, `mailto` and same-site paths are clickable | 280 × 96 |
| `drawing` | `ink` = attachment id of an `spn-ink-1` file | strokes drawn with the editor's ink renderer, stretched to the card | bounding box of the ink |
| `shape` | `shape`: `rect` \| `ellipse` \| `diamond`, `text` = label | outline + centred label | 160 × 120 |
| `reference` | `refId` | title, authors, year of the research reference | 300 × 120 |
| `math` | `latex` | KaTeX (display mode) | 240 × 100 |
| `table` | `text` | small editable grid | 320 × 160 |

Every kind may carry `color` (`#rrggbb`). The web offers the semantic hues of the design system: `#2f5ddb` ultramarine, `#008b4e`
green, `#d98b09` amber, `#cc272e` red, `#535862` graphite (violet is reserved for AI and is not offered). Any `#rrggbb` is drawn.

**Conventions added by the web (SPEC §3.4 is silent; nothing here needs a schema change — unknown-field preservation covers it):**

1. **`table`** — SPEC gives a table no field of its own: its cells are a **GitHub-flavoured Markdown table in `text`**
   (`| a | b |`, a `| --- | --- |` line after the first row, `\|` for a pipe, `<br>` for a line break; the first row is the header).
   A client without a table editor shows readable text.
2. **`drawing`** — the `spn-ink-1` document has `width` / `height` = the card's size when the ink was committed and points relative
   to the card's top-left corner. A card resized later stretches the ink (`scale = w / ink.width`, `h / ink.height`). Drawing more
   on a card writes a **new** attachment and a new bounding box (same node id).
3. **Edge `route`** (optional): `"orthogonal"` or `"curved"`; absent = straight. Display only (§3).

## 2. Operations (`src/lib/canvas/core.ts`) — what a native implementation must match

Every operation returns a new document and leaves untouched elements as they are (no re-serialisation from known fields).

| Operation | Semantics |
|---|---|
| `readCanvas` | tolerant reader: missing `nodes` / `edges` → `[]`; missing or invalid viewport → `{0, 0, 1}` (unknown viewport keys kept); elements that are not objects with a non-empty string `id` are dropped; everything else kept |
| `addNode` | appended; its `z` is raised to `max(z) + 1` when it is not already above; no-op when the id exists |
| `updateNode` / `updateEdge` | patch by spread; `id` cannot change; an `undefined` value removes the key |
| `removeNodes` | removes the nodes **and every edge attached to them** |
| `addEdge` | no-op when the id exists or an end is not a node |
| `bringToFront` / `sendToBack` | the moved nodes get `max + 1, +2…` / `min − n … min − 1` in their current relative order; other nodes untouched |
| `stepZ` | one step up / down: each selected node swaps rank with its unselected neighbour, then `z` is renumbered 0, 1, 2… |
| `normalizeZ` | renumbers `z` to 0, 1, 2… keeping the order |
| `reorderNode` | moves a node inside the array (outline order); `z` untouched |
| `nodeAt` | front-most node containing the point; `shape` nodes are tested against their real outline (ellipse: `dx²/a² + dy²/b² ≤ 1`; diamond: `|dx|/a + |dy|/b ≤ 1`), every other kind against its rectangle (SPNotesCore `node(at:)` uses the rectangle for all kinds — a UI nicety, not a format rule) |
| `nodesInRect` | marquee: nodes whose rectangle intersects (or is contained in) the rectangle, back to front |
| `moveNodes` | translation, rounded to 1/100 |
| `snapMove` | alignment guides: on each axis the start / centre / end lines of the dragged box are compared with those of the other rectangles; the smallest correction within the threshold (6 screen px) wins; one guide per snapped axis. Alt disables it; Shift constrains the move to one axis |
| `resizeNodes` | the bounding box of the selection is dragged by one of 8 handles; every node is scaled proportionally (positions and sizes); minimum 24 units per side, never flipped; aspect lock for corner and side handles |
| `alignNodes` | left / center / right / top / middle / bottom of the selection's bounding box (≥ 2 nodes) |
| `distributeNodes` | equal gaps along an axis, the first and last node (by position, then array order) fixed (≥ 3 nodes) |
| `copyNodes` / `pasteClip` | a copy takes the selected nodes and the edges whose two ends are selected, verbatim; paste gives fresh ids, remaps the edges, translates, and stacks the copies above everything in their relative order |

Undo history (`history.ts`) is local to a client: one step per gesture; **dropped when a remote document is applied** (an older
snapshot would not contain the other session's work).

## 3. Connections (`routing.ts`)

- An edge draws an arrowhead at `to` unless `kind` is `"line"`.
- **Anchors sit on the node's outline**: the point where the ray from the node's centre towards the other node's centre crosses
  the rectangle, the ellipse or the diamond (`anchorToward`).
- `straight` (default): outline(from → centre of to) to outline(to → centre of from).
- `orthogonal`: leaves and arrives at the **middle of the facing sides** (the pair along the axis with the larger gap between the
  two boxes; horizontal wins a tie), one elbow half-way: 3 segments.
- `curved`: cubic Bézier between the same side anchors; control points pushed out along the side normals by
  `max(40, distance / 2)`; arrives perpendicular to the side.
- Overlapping boxes fall back to straight. A node connected to itself draws a loop above its top-right corner.
- Label: at the midpoint of the route by length. Arrowhead: triangle, 11 units, half-angle π/7.

## 4. Three-way merge by node / edge id (`merge.ts` ⇔ `CanvasMerge.swift`)

Used on `409 conflict` (base = the copy the local edits were made from, local = the document on screen, remote = `server.data`),
and when an offline draft meets a newer server copy. Equality is JSON equality (key order irrelevant; `null` ≠ absent).

1. **Whole-document shortcuts**: `local = remote` or `remote = base` → local, untouched; `local = base` → remote, untouched.
2. **Nodes, then edges, id by id** (`L`, `R`, `B` = the element on each side; absent is a value):

   | case | result | conflict |
   |---|---|---|
   | `L = R` | that value | — |
   | `L = B` | `R` (remote change, or remote deletion) | — |
   | `R = B` | `L` | — |
   | both present, different | **`L` (local)** | `bothEdited` |
   | one absent, the other changed | **the present one (the edited version)** — SPEC §7 | `editedAndDeleted` |

   The merge is **by element**: the same node moved on one side and retitled on the other is a conflict (not a field merge).
   Order: base order, then the ids added by either side **sorted by Unicode scalar value** (so a clean merge is the same document
   whichever side is local — in JS compare code points, not UTF-16 units: `"ﬁ"` U+FB01 sorts before `"😀"` U+1F600).
   Duplicate ids inside one canvas: the first occurrence counts.
3. **Edges left without an end** (an end missing from the merged nodes that existed in the base): dropped when the edge is
   **unchanged since the base** (it goes with its node); otherwise (created or edited by the other side) the node is **restored
   from the base at its base position** and reported as `deletedButReferenced` (its `local` / `remote` value is the base node on
   the side that still had it, absent on the side that deleted it).
4. **Top-level fields** (every key except `nodes`, `edges`), in sorted key order: same rule; a two-sided change keeps local and
   reports a `field` conflict — **except `viewport`**: local wins unless only the remote changed; never a conflict.
   `format` is always `"spn-canvas-1"`.

A conflict is `{ kind: "node" | "edge" | "field", id, reason, base?, local?, remote? }` (absent key = absent / deleted on that side).
**Nothing is lost**: the merged canvas holds one version, the conflict carries the others. Conflicts are listed in the order:
nodes (document order), edges, restored nodes, fields.

`resolveConflict(doc, conflict, takeRemote)` replaces the element by the conflict's `remote` (or `local`) value, or removes it when
that value is absent (removing a node removes its edges).

### Examples (all in `merge-cases.json`)

- *different-nodes*: local moves and retitles `a`, remote recolours `b` → both, no conflict.
- *both-edited*: `a.text` = "mine" locally, "theirs" remotely → canvas shows "mine"; conflict `node a bothEdited` with both.
- *edit-vs-delete-local-edits*: remote deleted `b` (and its edges), local edited `b` → `b` is kept (edited); conflict
  `editedAndDeleted` with `remote` absent. The edges `e1`, `e2` that local still lists unchanged are kept (their ends exist).
- *deleted-node-untouched-edge*: remote deleted `b`, local did not touch it → `b` goes, and so do its unchanged edges.
- *deleted-but-referenced*: remote deleted `c`; local added edge `e9 a→c` → `c` restored, `e9` kept, conflict `deletedButReferenced`.
- *fields-and-viewport*: both changed `theme` → local kept + `field theme bothEdited`; both moved the viewport → local, no conflict.

Verified on the web by `tests/unit/next-canvas-model.test.ts`: the fixtures, 2 000 randomised merges (deterministic; per-id rule;
every edited or added node survives; never a dangling edge; symmetric when clean; stable when re-merged) and 500 simulations of
two clients against a versioned server (PUT → 409 → merge → retry): both end on the server copy and no card that nobody deleted
is lost.

## 5. Automatic layout (`layout.ts` ⇔ `CanvasLayout.swift`)

Same generator (SplitMix64; `signedUnit = (next >> 11) / 2^53 × 2 − 1`), same order of floating-point operations, rounding to
1/100 **half away from zero** (`Math.round` is not that for negatives) — the same canvas, seed and parameters give the same
positions on every platform (fixtures).

- **Grid** `gridLayout(doc, {columns = ⌈√n⌉, spacing = 48, origin = (0, 0), pinned})`: array order, row by row; each column as
  wide as its widest card, each row as tall as its tallest.
- **Force-directed** `forceLayout(doc, {iterations = 200, seed = 1, forces, pinned})`: `iterations` steps with temperature
  `1 − i/n`. A step: every pair of cards closer than the sum of their half-diagonals + `spacing` (48) is pushed apart by
  `(rest − d) × 0.5`; every edge longer than that rest length pulls its ends by `(d − rest) × 0.08`; a card moves by at most
  `120 × temperature`; cards at the same centre separate in a direction drawn from the generator.
- **"Tidy up"** (web UI policy, not a format rule; `tidyLayout`): the selection when it holds ≥ 2 cards (the others pinned), else
  everything. A canvas with connections gets the force-directed layout (200 steps; 120 above 250 cards; 60 above 600), one
  without connections the grid. The result is translated so that the top-left corner of the moved cards stays where it was.
  Seed fixed to 1. Animated over 420 ms (positions interpolated; one undo step; instant under Reduce Motion).

## 6. Sync on the web (`src/lib/canvas/sync-client.ts`)

- **Autosave**: `PUT /api/canvases/<pageId>` `{data, baseVersion}` 900 ms after the last change, one request at a time,
  **never during a gesture** (drag, resize, ink stroke, layout animation: the save waits for the release; a 409 that arrives
  mid-gesture is merged at the release).
- **409** → three-way merge against the remembered base → the result is shown (undo history dropped) → sent again on top of
  `server.version` (up to 6 rebases in a row, then a pause). Edges that lost an end are never sent.
- **Conflicts**: a small review panel, non-blocking (the canvas stays editable): per element "Keep mine" / "Keep theirs" /
  "Show"; closing the panel keeps this device's versions.
- **Offline / unsaved**: the document **and its base** are mirrored to IndexedDB (the app's draft store, key
  `canvas:<pageId>`; same retention and wipe rules as page drafts) 350 ms after a change and when the tab is hidden. On the next
  visit: same server version → replayed; newer server version → merged against the draft's base (conflicts reviewed as above).
  Reconnection (`online`), tab back in front and window focus trigger a retry / a refresh.
- **Viewport — the choice**: the API has no version-free write (any change of `data` creates a version, a `rev`, a journal
  entry), so **a change of the viewport alone is never sent**. Each device remembers its own viewport in `localStorage`
  (`note-canvas-vp-<pageId>`); the stored `viewport` travels with the next real change and is only the starting point of a device
  that has none (a canvas whose stored viewport is the default is fitted to the view on first open).
- **Search**: `PUT` copies the canvas text (per node: `text`, `latex`, `url`; then edge labels; a table reduced to its cells)
  into the page's `plain_text` / `word_count`, and the index worker reads a canvas page from that text — a canvas is found by
  what is written on it.

## 7. Web interface (for parity reviews)

Desktop: wheel = zoom around the cursor (mouse) or pan (trackpad two-finger scroll); pinch / Ctrl-wheel = zoom; Space-drag,
middle button or the hand tool = pan; click, Shift-click, marquee; drag with alignment guides; 8 resize handles; 4 connection
handles on the selected card (drag to another card); double-click a card to edit it (a page card opens the note), a connection
to label it, empty space to write; right-click menu; toolbar; minimap; drop files, pages of the sidebar, links, text.
Shortcuts: `V` select · `H` pan · `D` draw · `T` text · `S` shape · `⌘Z` / `⇧⌘Z` · `⌘C` `⌘X` `⌘V` `⌘D` · `⌘A` · `⌫` ·
arrows (Shift = 10) · `Tab` next card · `Enter` edit · `⌘]` `⌘[` (Shift = front / back) · `⇧1` fit · `⇧2` fit selection ·
`0` 100 % · `+` `−` · `Esc`.

Phone (below 768 px): a dedicated interface — one finger pans (on a card: moves it), two fingers pan + pinch, tap selects,
double-tap edits; bottom dock (Add, Edit, Connect, Copy, Delete, Undo, Redo, Fit, More); bottom sheets to add and edit cards;
**Canvas / List** switch — the list shows every card with its kind and connections, opens and edits it, reorders it (array order)
and locates it on the canvas. Handles and connectors are finger-sized; nothing depends on hover.

Rendering: one CSS transform for the viewport (applied outside React); only the cards and connections within the view plus half
a screen are in the DOM; below 30 % zoom, for cards smaller than 18 px on screen, or when more than 240 are within reach, cards are drawn as light placeholders.
Measured numbers: see the workstream report (`perf-1000.json`).

Exports: PNG (2×, from the SVG), standalone SVG (images, PDF thumbnails and ink embedded), Markdown outline:

```md
# <title>

## Cards

- **Text** — <first line>
  <other lines>
- **Page** — [<page title>](/p/<pageId>)
- **Formula** — $<latex>$

## Connections

- <from label> → <to label> — <edge label>
- <from label> — <to label>          (kind "line")
```
