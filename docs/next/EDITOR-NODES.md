# Editor nodes — SP Note Next Generation (web)

Contract: `SPEC.md` §2. The stored format is the ProseMirror JSON; attrs below are exactly those of the SPEC (defaults in
`src/lib/editor/next-nodes.ts`). Every new block is a **leaf atom** (no `content`) that carries the usual block `id`; binary data is
an attachment referenced by id (`/api/files/<id>`). Schema: `src/components/editor/extensions/next-nodes.tsx`; views:
`src/components/editor/nodes/*`. Slash menu, ⌘K ("Insert …"), Markdown paste, drag handle and block menu know all of them.

## 0. Safety (read first)

- `enableContentCheck` is on. A document that fails the schema check **opens read-only** ("Read-only — this page holds newer content")
  and is **never autosaved**: the editor emits nothing while locked and the page's sync engine reads the copy received from the server.
  When the document could be built completely the banner offers "Edit anyway…" behind a confirmation; when it could not (what is on
  screen is partial) there is no override. `Editor` prop `onLock(lock | null)`.
- **Unknown content round-trips verbatim** (`src/lib/editor/unknown.ts`):
  unknown node type → `unknownBlock` / `unknownInline` atom (attr `raw`, neutral card "Unsupported block"); unknown mark, or known mark
  with unknown attrs → `unknownMark` (text stays editable, dotted underline); unknown attrs on a known node → reserved attr `xattrs`.
  Boxing happens before the JSON reaches ProseMirror, unboxing in everything the editor emits. `unknownBlock`, `unknownInline`,
  `unknownMark` and `xattrs` never reach the server. **Always use `getEditorDoc(editor)` / `setEditorDoc(editor, doc)`** instead of
  `editor.getJSON()` / `commands.setContent()`.
- A failed *insert* (pasted or generated content that does not fit) shows a toast and changes nothing; it does not lock the page.

## 1. New nodes

| Node | Attrs | Behaviour on the web | Limits |
|---|---|---|---|
| `mermaid` | `code`, `preview`, `previewHash` | `mermaid` 12 loaded on demand (block near the viewport), `securityLevel: "strict"`, SVG text labels. On-screen render 450 ms after the last change. Stored render: **PNG at 2×** (max side 4096 px) of the light theme uploaded as an attachment, `previewHash` = sha256 hex of `code`; uploaded only when the code is valid, stable for 2.5 s **and the source field is not focused**. A syntax error keeps the last valid render and uploads nothing. | If rasterising fails the SVG itself is uploaded (SPEC allows SVG or PNG). Offline: hash stays stale (natives show the source + notice); "Save the render now" retries. |
| `drawing` | `ink`, `preview`, `pk`, `width`, `height`, `background` | Ink editor in a sheet: pointer events with pressure, pen / marker / highlighter / eraser (stroke eraser), 8 colours, 3 widths, undo / redo, clear. Save uploads `spn-ink-1` JSON (`application/json`) + PNG preview and sets `pk: null`. Re-editing loads the ink file. | Canvas 1200×800 units. A drawing with a preview but no readable ink cannot be edited (never overwritten). Unknown ink keys are preserved. |
| `chart` | `kind`, `title`, `columns`, `rows`, `x`, `y`, `source` | Own SVG renderer (bar, line, area, pie, scatter), responsive, legend + `<title>` on marks, `role="img"`. Editable data grid (cells, rows, columns, x/y mapping, paste a table). | `source` (live database data) is **not resolved in this wave**: the snapshot is rendered with a note; `source` is never modified. Grid shows 100 rows at a time. 8 series colours then repeat. |
| `queryView` | `source`, `databaseId`, `viewId`, `filter`, `layout`, `limit`, `title` | Config UI + `POST /api/query` `{source, databaseId?, viewId?, filter, limit}`; list / table / board (grouped by status). Refetched on window focus (30 s stale time). | **Feature-detected**: 404/405/501 → "Live views are not available on this server yet", config kept. Row shape is normalised tolerantly (`src/lib/editor/query.ts`) until `docs/next/API-NEXT.md` fixes it. For `source: "backlinks"` the current page id is sent as top-level `pageId`. Limit 1–200. |
| `citation` (inline) | `refId`, `locator`, `label` | Chip `(Author Year, locator)`; popover to pick a reference (fuzzy search of the library) and edit the locator. `label` is cached as "Author Year". | Read-only editors link to `/research?ref=<id>`. A citation without `refId` is shown dashed. |
| `bibliography` | `style`, `title` | APA list of the references cited in the page, computed from the document; resolved with `GET /api/research/references?ids=` (a server that ignores `ids` returns the library, filtered client-side). | Only `apa` is rendered. Deleted references are listed as not found. |
| `pdf` | `attachmentId`, `name`, `page`, `annotations` | pdf.js 6 loaded when the block scrolls into view; one page at a time (canvas + text layer), fit / zoom, page navigation (`page` = reading position, debounced). Select text → Highlight (4 colours) or Add note → annotation `{id, page, kind, color, rects (0..1, origin top-left), text, note, createdAt}`; list under the page, jump, edit note, delete. | Worker and data files are served from `/vendor/pdfjs` (copied by `scripts/copy-vendor.mjs` before dev/build). `kind: "ink"` annotations from other clients are drawn and preserved, not editable. Password-protected / corrupt files show an error state. |
| `blockRef` | `pageId`, `blockId`, `mode` | Picker (search a page → choose a block). `embed`: the source block rendered read-only by the editor itself, refreshed on focus (15 s stale time); `link`: one-line link. "Jump to the source" → `/p/<pageId>#block-<blockId>`. | Missing target → "Reference not found — Référence introuvable". Nested references are embedded 2 levels deep, then shown as links. |
| `runCode` | `language`, `code`, `output` | Runs **only on the Run button** (or ⌘/Ctrl+Enter in the code field). Sandbox: hidden `<iframe sandbox="allow-scripts">` (opaque origin) built from `srcdoc` with CSP `default-src 'none'; script-src 'nonce-…' 'unsafe-eval'; worker-src blob:; base-uri 'none'; form-action 'none'`; the code runs in a blob Worker inside the frame, so an endless loop cannot freeze the app. Console output, returned value and errors are captured into `output = {text, error, ms, at}`. | JavaScript only (other languages are stored and displayed). Timeout 5 s, output 20 000 characters. No network, no DOM, no storage, no cookies. |
| `audio` | `attachmentId`, `duration`, `title`, `recordedAt`, `transcript`, `transcriptStatus`, `transcriptEngine`, `summary` | Recorder (MediaRecorder: mp4/m4a preferred, else webm/opus) with level meter → upload → node; or upload a file. Player: play/pause, scrubber, rate, waveform (decoded lazily, ≤ 25 MB), transcript lines `[m:ss] text` that seek. "Transcribe" → `POST /api/audio/<id>/transcribe`. `summary` is displayed in an AI-labelled box, never generated here. | **Feature-detected** transcription (404/405/501 → "not available on this server yet"). Seeking long files needs `Range` on `/api/files` (backend). |
| `canvasLink` | `pageId` | Card that opens the canvas page; picker of existing canvases (`type: "canvas"` in the tree) or "New canvas". | **Feature-detected**: a server that refuses `type: "canvas"` shows "Canvases are not available on this server yet". |

## 2. Extended nodes

- `taskItem`: optional `due` (ISO date), `priority` (`low|medium|high`), `taskId`. Chips at the end of the item (due date — red when
  overdue and unchecked — priority, a "linked" mark when `taskId` is set); click a chip or use the context bar to edit. The web editor
  never writes `taskId` (the link to the `tasks` table is the backend's).
- `listItem` / `taskItem` now receive a block `id` (client `BLOCK_ID_TYPES`; the server list is `ID_TYPES` in `src/lib/editor/text.ts`).
- `aiBlock`: optional `sources` (`[{pageId, blockId, title}]`, rendered as numbered chips linking to the block) and `action` (shown in the "AI · action" tag).
- `callout.kind`: + `decision`, `question`, `hypothesis` (labelled, own tint; kind switcher in the context bar; `/decision`, `/question`, `/hypothesis`).

## 3. Editor chrome

- **Context bar** (desktop, Morphing Editor): tools for the block under the cursor — table (rows, columns, header, merge/split, delete),
  code (language, copy), callout (kind), image (size presets, alt text), task (due, priority).
- **Drag handle**: drag to move any block; `+` adds a block below (opens "/"); click the grip for the block menu (turn into, duplicate,
  copy link to block, move up/down, delete). New blocks are not HTML-draggable themselves (it would break text selection and drawing inside them).
- **Images**: resize handles left/right on desktop (stores `width`), presets in the context bar.
- **Markdown paste**: plain text that is clearly Markdown becomes blocks (⌘⇧V pastes as plain text).
- **Semantic zoom**: "Zoom out to the outline" (level 2: headings + first block of each section; read-only; click a heading to return).
  Level 1 (AI synopsis) needs `GET /api/pages/<id>/zoom` — later wave.

## 4. Markdown (client) — `src/lib/editor/markdown-client.ts`

`docToMarkdown(doc)` expands the new nodes to the forms of SPEC §2, then calls the shared `toMarkdown`. `markdownToDoc(md)` reads back
the forms that identify their node:

| Node | Export | Import |
|---|---|---|
| mermaid | ```` ```mermaid ```` fence | yes |
| runCode | fence with its language + ```` ```output ```` fence | only when followed by an `output` fence (else a plain code block) |
| chart | title line + Markdown table | no (stays a table) |
| drawing | `![Dessin](/api/files/<preview>)` or `[Dessin]` | preview only (`ink: null`) |
| pdf | `[PDF: name](/api/files/<id>)` + `> p.<page> — <text> — <note>` lines | yes (annotations without rects) |
| audio | `[Audio: title](/api/files/<id>)` + `[mm:ss] text` lines | yes |
| queryView | `[Vue: title]` | title only |
| blockRef | `[[<pageId>#<blockId>]]` | yes |
| citation | `[@<label or refId>, locator]` | yes (label + locator, or a reference uuid) |
| bibliography | `## <title>` | no (a heading) |
| canvasLink | `[Canvas](/p/<pageId>)` | yes |

Server-side text / Markdown / HTML export of these nodes is owned by the backend workstream (`src/lib/editor/text.ts`, `src/lib/export/*`).
