# SP Note Next Generation — feature parity matrix (state at delivery, 2026-11-19)

Versions: Web/backend **3.0.0** (in production) · macOS **2.0.0 (4)** (notarised, installed) ·
iOS/iPadOS **2.0.0 (2)** (uploaded to App Store Connect) · shared Swift core **2.0.0**.

Legend — **✅** implemented and verified by a test that ran (unit, hosted, UI or live against the
integration server) · **◐** implemented, partly verified or with a stated limit · **○** implemented, not
exercised (needs a real device, a signed build or real pointer/touch input) · **—** absent.
"Verified" never means "used by a person on a device": see `TEST-PLAN.md` §6 for what only the owner can check.
iPadOS shares the iOS binary; its column is given only where it differs.

Before = state at the audit (web 2.0.0, macOS 1.0.2, iOS 1.0.0).

## 1. Notes and editor

| Feature | Backend | Web | macOS | iOS | iPadOS | Before → action taken |
|---|---|---|---|---|---|---|
| ProseMirror JSON canonical, lossless round trip, unknown nodes preserved | ✅ | ✅ (new: content check + read-only on unknown schema) | ✅ | ✅ | = | Web could blank a page containing unknown nodes → fixed (P0) |
| Paragraphs, headings, lists, tasks, quotes, callouts, code, tables, images, files, math, mentions | ✅ | ✅ | ✅ | ✅ | = | existing, kept |
| Slash menu | n/a | ✅ | ✅ | ✅ (new) | = | absent on iOS → added |
| Markdown typing shortcuts | n/a | ✅ | ✅ | ✅ (new) | = | absent on iOS → added |
| Rich tasks (due, priority, linked task row) | ✅ | ✅ | ✅ | ✅ | = | new |
| Callout kinds decision / question / hypothesis + kind picker | ✅ | ✅ | ✅ | ✅ | = | new |
| Toggles and footnotes: create | ✅ | ✅ | ✅ | ✅ | = | natives could only display → added |
| Mermaid diagram | ✅ export/index | ✅ render + stored preview | ◐ source editor + stored preview (no native renderer: no JS engine allowed) | ◐ same | = | new |
| Drawing (`spn-ink-1`) | ✅ | ✅ pointer editor | ◐ view ✅; mouse ink editor ○ | ✅ conversion PencilKit ⇄ ink tested; real strokes ○ | Pencil ○ | iOS had image + companion file → new shared format, old drawings kept |
| Chart (bar, line, area, pie, scatter; live from a database) | ✅ | ✅ | ✅ Swift Charts | ✅ | = | new |
| Living view (`queryView`) | ✅ `/api/query` | ✅ | ✅ | ✅ | = | new |
| Citation + bibliography | ✅ | ✅ | ✅ | ✅ | = | new (APA only on natives) |
| PDF block with annotations | ✅ | ✅ highlights + notes verified; ink/zoom ○ | ◐ mapping tested; interactive view ○ | ◐ mapping tested (rotations); Pencil ink ○ | Pencil ○ | new |
| Block reference / transclusion | ✅ | ✅ | ✅ | ✅ | = | new |
| Runnable code | ✅ stores output | ✅ sandboxed, no network, kill on loop | ◐ shows code + last output; no execution by design | ◐ same | = | new |
| Voice note (`audio`) | ✅ | ✅ record, pause/resume, transcript seek | ◐ model tested; microphone ○ | ◐ one simulator recording; real microphone ○ | = | new |
| Canvas link card | ✅ | ✅ | ✅ | ✅ | = | new |
| AI result block with sources | ✅ | ✅ | ✅ | ✅ | = | existed (`aiBlock`), extended |
| Syntax colouring in code | n/a | ✅ | ✅ | ✅ (new) | = | absent on iOS → added |
| Table editing | n/a | ✅ in place | ◐ grid sheet | ◐ grid sheet | = | unchanged (limit kept) |
| Morphing toolbar, Living Pages, Reduce Motion | n/a | ✅ | ✅ | ◐ decisions tested, not watched in motion | = | new |

## 2. Organisation, capture, tasks

| Feature | Backend | Web | macOS | iOS | iPadOS | Before → action |
|---|---|---|---|---|---|---|
| Page tree / folders, tags, pin, favourite, archive, trash, restore | ✅ | ✅ | ✅ | ✅ | = | existing; tag counts, purge, cycles fixed server-side |
| Quick capture (text, idea, link, image, PDF, audio, screenshot, document, selection) | ✅ | ✅ | ◐ quick note panel: model tested; global hotkey, drag & drop ○ | ◐ 8 modes; camera/scanner ○ | = | extended |
| Capture reaches the server inbox when made offline | ✅ (new: `inboxAt` on page create) | ✅ | ✅ | ✅ live test | = | iOS captures became plain notes → fixed |
| Inbox triage with undo | ✅ | ✅ | ✅ (own screen, offline) | ✅ (own screen, offline) | = | natives listed only → added |
| Smart inbox AI suggestions (on demand, applied selectively) | ✅ | ✅ | — (app keeps its offline inbox screen) | — (same) | = | new on web; not surfaced in the native inbox screens |
| Global tasks list, due, priority | ✅ feed + client ids | ✅ | ✅ offline outbox | ✅ offline outbox, live test | = | absent natively → added |
| Task due notifications | n/a | — | ○ | ○ | = | new, never delivered on a device |
| Share extension / PWA share target | n/a | ✅ share target | ○ Services menu | ✅ lands in inbox | = | iOS fixed (was plain notes) |
| Widgets | n/a | n/a | — | ◐ rendered; interactive task widget; redacted when locked; real Home Screen ○ | = | lock leak fixed |
| Siri / App Intents, Spotlight | n/a | n/a | ○ Spotlight | ○ | = | extended, device-only |

## 3. Databases

| Feature | Backend | Web | macOS | iOS | iPadOS | Before → action |
|---|---|---|---|---|---|---|
| Table, board, list, gallery, calendar, timeline views | ✅ | ✅ | ✅ opened on live data | ✅ opened on live data (compact = cards) | ✅ | natives had a read-only banner → native screen |
| Filters (AND/OR), sorts, grouping, saved views | ✅ SQL engine | ✅ | ✅ | ✅ | = | engine moved to SQL (first page 105 → 6 ms on 20 000 rows) |
| Inline editing, keyboard navigation, bulk actions, undo/redo | ✅ | ✅ | ◐ row edit; no relation/file/AI cell editing, no column resize | ◐ sheet edit | = | new on web; partial natively |
| Relations, rollups, formulas | ✅ | ✅ | ◐ displayed with server values | ◐ same | = | rollups completed, formula errors per cell |
| Smart (AI) properties: config, runs log, protected hand edits | ✅ | ✅ | — | — | = | web only |
| Offline | n/a | ◐ "not kept on this device" state | ◐ readable from cache, written online | ◐ same | = | by design (SPEC §6) |
| CSV import/export, row templates | ✅ | ✅ | — | — | = | web only |

## 4. Knowledge: graph, timeline, health, brief

| Feature | Backend | Web | macOS | iOS | iPadOS | Before → action |
|---|---|---|---|---|---|---|
| Graph views: global, local, project, chronological, concepts, documents, references | ✅ | ✅ | ✅ opened on live data | ✅ opened | ✅ | 2 views on web only → 7 everywhere |
| Typed relations (create, edit, accept / reject AI suggestions) | ✅ | ✅ | ◐ view-model tested; not driven by hand | ◐ same | = | new |
| Graph intelligence: central pages, orphans, clusters, topics, duplicates | ✅ deterministic | ✅ | ✅ | ✅ | = | new |
| AI analysis: contradictions, open questions | ◐ job + validation tested with a fake model; never run with a real model | ◐ UI tested on fixtures | ◐ | ◐ | = | new; needs one real run by the owner |
| Thought Constellation | ✅ projection of real embeddings | ✅ | ✅ | ✅ | ✅ | new (Labs) |
| Knowledge Timeline (real events only; back-filled ones marked) | ✅ journal | ✅ | ✅ | ✅ | = | new |
| Knowledge Time Machine + restore | ✅ | ✅ | ◐ opened; restore not driven | ◐ same | = | new |
| Knowledge Health | ✅ | ✅ | ✅ | ✅ | = | new |
| Daily Brief (AI summary only on request) | ✅ | ✅ (new Home) | ✅ | ✅ | = | new |
| Semantic Zoom (synopsis AI-marked, outline, full) | ✅ | ✅ | ◐ wired, logic tested | ✅ opened | = | new |
| Backlinks | ✅ | ✅ | ✅ inspector | ✅ | = | absent natively → added |
| Infinite canvas | ✅ versioned, feed | ✅ 10 card kinds, merge on conflict, 60 fps at 1 000 cards | ◐ opened on live data; gestures not driven | ◐ opened; list mode; Pencil hook ○ | ◐ | new; merge identical web/Swift on 60 shared cases |

## 5. AI

| Feature | Backend | Web | macOS | iOS | iPadOS | Before → action |
|---|---|---|---|---|---|---|
| Ask My Knowledge with scope and verified block citations | ✅ | ✅ | ◐ opened; no message sent in tests | ◐ same | = | citations now anchor the best block and are clickable natively |
| Contextual actions (15 existing + coherence, questions, links, synthesis, structure) | ✅ | ✅ | ◐ existing actions tested; new ones through the same path | ◐ same | = | extended |
| Providers: OpenAI, Anthropic | ✅ | ✅ | via server | via server | = | kept; routing table unchanged |
| Providers: OpenRouter, MacLustr local (OpenAI-compatible) | ◐ adapter tested against a fake server; no key configured, never called live | ◐ listed as unavailable | ◐ | ◐ | = | new; needs keys |
| Model selector with creator logos, route, context, price, availability | ✅ | ✅ | ◐ wired | ✅ opened | = | new (13 logos from simple-icons; others use a neutral mark) |
| Agents with proposals and approval | ✅ | ✅ | — | — | = | unchanged, web only |
| Transcription | ✅ one real run (whisper-1) | ✅ | ○ | ◐ server path; on-device speech ○ | = | new |
| Research workspace, DOI/BibTeX, LaTeX export | ✅ | ✅ | ✅ opened | ✅ opened | = | natives had nothing → references screen; LaTeX zip web only |

## 6. Sync, offline, account

| Feature | Backend | Web | macOS | iOS | iPadOS | Before → action |
|---|---|---|---|---|---|---|
| Change feed for pages + attachments | ✅ | ✅ (now used) | ✅ | ✅ | = | existing |
| Change feed for tasks, databases, edges, references, canvases, concepts | ✅ | ✅ tasks | ✅ | ✅ | = | new |
| Offline read / create / edit notes | n/a | ✅ (new replica + journal) | ✅ | ✅ live scenario | = | web kept only drafts → full replica |
| Conflict handling without silent loss | ✅ | ✅ | ✅ | ✅ | = | existing; extended to canvases |
| Offline images | n/a | ◐ 10 MB each, 100 MB queued | ✅ | ✅ | = | new on web |
| Passkeys (WebAuthn, server-verified), sessions, device management | ✅ | ✅ | ○ in the signed build | ○ on a device | = | already delivered in 2.0; unchanged |
| Store-open failure is a blocking error (no silent in-memory store) | n/a | n/a | ✅ | ✅ | = | data-safety defect → fixed |
| Local store migration v1 → v2 with backup | n/a | n/a | ✅ on a copy of real 1.0.2 data | ✅ incl. widget + share extension | = | new |
| Universal links `/p/<id>` | ✅ AASA | n/a | — | ○ entitlement + parser tested | = | new |
| Command center (⌘K) | n/a | ✅ | ✅ | ◐ touch entry | ◐ ⌘K; Escape not reproduced in simulator | new |
| Multi-window, menus, keyboard shortcuts | n/a | ✅ side pane | ○ | n/a | ○ | iPad `.commands` added |

## 7. What is not delivered (and why)

- Native execution of code blocks and native rendering of Mermaid: a JavaScript engine is excluded from the
  native apps on purpose; both show the stored result/preview and edit the source.
- Smart-inbox suggestions, agents, smart database properties, CSV, bulk import: web only.
- End-to-end encryption: not offered, not claimed.
- Real-time multi-cursor collaboration (CRDT): not introduced; single-owner product, block-level merge kept.
- OpenRouter and MacLustr local models: architecture in place, no keys configured, nothing benchmarked, so
  they are not routed automatically.
