# Web offline-first (SP Note 3.0)

Status: implemented on branch `next-p`, verified by `tests/unit/next-p-offline.test.ts` and `tests/e2e/next-p-offline.spec.ts`
(production build + service worker + `context.setOffline`). This file describes what the code does, not an intention.

## 1. What the owner can do without a connection

| Action | Offline | How |
|---|---|---|
| Open the app cold (new tab, reload, bookmark, installed PWA) | yes | the service worker answers the navigation with the static shell `/offline`, which reads the device replica |
| Read any note that was synced (content included) | yes | replica store `pages` |
| Search the notes on the device (title + text, substring) | yes | in memory over the replica; the server search index, semantic search and AI are **not** available |
| Edit a note (title, content) | yes | per-page versioned draft (`drafts`), sent on reconnect with `baseVersion` |
| Create a note | yes | client-chosen uuid, journal entry `page.create` |
| Pin / archive / move / rename (tree) / trash / restore, tags | yes | journal entries `page.update`, `page.trash`, `page.restore`, `page.tags` |
| Tasks: create, edit, complete, reopen, delete | yes | client-chosen uuid, `task.create` / `task.update` / `task.delete` |
| Quick capture (text, link) | yes | the existing capture outbox (idempotency key = item id) |
| Add an image to a note | yes, bounded | **10 MB per image, 100 MB queued in total**; kept as a blob, shown from the device, uploaded later under the same attachment id |
| Add another kind of file (PDF, audio…), record a voice note | no | refused with a clear message; needs a connection |
| Databases, canvases, graph, research, AI, settings, version history, conflict resolution | no (read-only notice) | they open when the connection returns. Database / canvas pages are listed but not rendered offline |

Lazily loaded editor blocks (Mermaid, PDF viewer) work offline only if their code was loaded once online on this device (the worker
caches build assets on first use; the shell's own assets are pre-cached).

## 2. Pieces

| File | Role |
|---|---|
| `public/sw.js` (v3, cache `note-static-v4`) | navigation: network (12 s timeout) → fallback to the cached shell `/offline`; build assets cache-first; `/api/files/<id>`: network, and only when the server cannot answer with the file, the image still queued on the device; message `REFRESH_SHELL` re-caches the shell of the running build |
| `src/app/offline/page.tsx` + `src/components/offline/OfflineApp.tsx` | the static shell (no data in the HTML) and the offline app: home, note (real editor), inbox, tasks, capture; same addresses as online (`/`, `/p/<id>`, `/tasks`, `/inbox`, `/share`) |
| `src/lib/client/offline.ts` | IndexedDB `note-local` **version 2**: `drafts`, `outbox` (unchanged) + `pages`, `tasks`, `attachments`, `journal`, `blobs`, `meta`; `wipeLocalData()` clears all of them |
| `src/lib/client/replica.ts` | `pullReplica()` (change feed), `replicaTree()`, `verifyIntegrity()` |
| `src/lib/client/journal-core.ts` | pure rules: request mapping, coalescing, de-duplication, error classification, image bounds (unit-tested) |
| `src/lib/client/journal.ts` | `mutate()`, helpers (`createPage`, `updatePageMeta`, `trashPage`, `setPageTags`, `createTask`, `updateTask`, `deleteTask`, `queueImageUpload`), replay (`flushJournal`, `flushDrafts`, `syncNow`, `startSyncEngine`), `ensurePageReady`, `pendingState` |
| `src/lib/client/page-sync.ts` | unchanged autosave engine + 3 hooks: waits for the creation of a page made offline before its first save, keeps the replica current after each confirmed save, registers the open editor so the background replay leaves its draft alone |
| `src/components/offline/SyncStatus.tsx` | status pill (top bar, phone header, offline app) + inspector |
| `src/app/api/sync/integrity/route.ts`, `src/lib/stable-json.ts` | integrity fingerprints (new, additive route) |

## 3. Replica

Fed by `GET /api/sync?since=<cursor>&limit=200&kinds=task`, looped until `more` is false. Each window is written to IndexedDB (one
transaction per store) **before** the cursor is saved, so an interrupted sync resumes without skipping a revision. Stored: whole pages
in every state (live, inbox, archived, trash) with content and tags, attachment metadata (never the files), tasks, the tag list;
tombstones delete rows. `reset: true` or another workspace id → the replica is cleared and rebuilt from 0.
Runs at every start of the shell, when the network returns, when the tab becomes visible, every 2 minutes, and after each replay.
Reads that fall back to the replica when the network fails: the page tree of the shell (React Query `tree`), and everything in the
offline app. The replica is never the source of a save: a page save always carries the server version it was based on.

## 4. Mutation journal

Entry: `{ seq (auto-increment = replay order), id (idempotency key, constant across attempts), kind, entityId (client uuid), body,
createdAt, attempts, lastError, state: pending|failed }`.

`mutate(kind, entityId, body)`: (1) apply the effect to the replica; (2) if online and nothing older is waiting, send now — success →
done; network error / 5xx / 408 / 425 / 429 → fall through; other 4xx → thrown to the caller as before (replica refreshed);
(3) otherwise write to the journal, merging with the last pending entry of the same entity when that cannot change the order of
effects (update+update, tags+tags, update folded into a create that was never attempted); a create whose id is already queued is skipped.

Replay (`flushJournal`), oldest first, one request at a time, under the Web Lock `note-journal` (one tab at a time):
success → entry deleted; transient error (network, 5xx, 401, 408, 425, 429) → **stop**, same entry and same key next time;
404/410 on a deletion → done; any other 4xx (incl. 409) → entry parked as `failed` (visible in the inspector with Retry / Discard) and
the following entries go on. Duplicates are impossible by construction: creates carry the client id (the server answers the stored
row, `x-existing: 1`), every request carries its idempotency key, uploads carry the attachment id.

Page text is not journaled keystroke by keystroke: it is the existing per-page draft (one coalesced `PATCH` with `baseVersion`).
`flushDrafts` sends the drafts of pages that are **not open in this tab** after the journal (a page is created before it is edited);
the open page is saved by its own editor, which first calls `ensurePageReady` (replays the journal if the page was created offline,
then adopts the created version). A page created offline has `version: 0` on the device until the server confirms it.

## 5. Conflicts — never a silent overwrite

A draft `PATCH` refused with `409 conflict`: if the server copy equals what the device wanted to write, the draft is dropped (our own
earlier save won); otherwise nothing is written, the draft stays on the device, and the conflict is recorded (`meta` key
`conflict:<pageId>`) and listed in the inspector with a link to the note. Opening the note online shows the **existing** conflict
banner (Compare / Keep mine / Keep theirs / Keep both → `POST /api/pages/<id>/resolve`), which keeps both versions (history or a
"(conflict copy)" page). The offline app shows a notice and hands over to the full app for the choice.

## 6. Status and inspector

Pill states: `Synced` · `N to sync` · `Offline` / `Offline · N waiting` · `N to review` (refused entries, conflicts). The inspector
shows: online/offline, last sync, replica size (notes, tasks, storage estimate), last sync error, the conflicts, every waiting item
(journal entries with their label, attempts and last error; page drafts; captures; queued images with the bound), **Sync now**, and
**Verify integrity**.

## 7. Integrity check

`GET /api/sync/integrity` → `{ algorithm: "sha256-stable-json-1", count, pages: [{ id, version, hash }] }` — `hash` = SHA-256 of the
canonical JSON of `content` (keys sorted). The device hashes each replica page the same way (WebCrypto): same version + different
hash → damaged copy, fetched again and replaced (`repaired`); different version / missing / extra → the replica is only behind
(counted, fixed by a sync); pages created on the device and not yet sent are left alone. The report is kept in `meta.integrity`.

## 8. Privacy rules (unchanged, extended)

- The HTTP cache (Cache Storage) holds only public files: the static shell `/offline`, the manifest, icons and hashed build assets.
  No API response, page HTML, RSC payload or uploaded file is ever cached (asserted by the e2e suite on the real cache content).
- The replica, the journal, drafts, captures and queued images live in IndexedDB `note-local`; not encrypted (same rationale as the
  drafts: a key readable by the same JavaScript adds nothing). **"Lock this device" / sign-out everywhere / removing the passkey of
  the current session erase all of it** (`wipeLocalData`), after which the offline app has nothing to show.
- A session that merely expires does not erase the device copy (that would lose unsent text); the next request answers 401 and the
  app goes to the sign-in page.

## 9. PWA share target

`manifest.webmanifest` declares `share_target` (GET `/share?title=&text=&url=`): online it opens the capture sheet prefilled; offline
the shell shows the same text in its capture form (outbox).

## 10. Known limits

- No Background Sync API: replay happens while the app is open (start, network back, tab visible, every 2 min).
- A rename done from the tree while offline is last-writer-wins (unversioned `PATCH`, as online); text and titles edited in the note
  itself are versioned.
- Offline search is a substring scan of the replica, not the server index.
- Only images are queued offline; other attachments need a connection.
- `navigator.onLine` can lie (captive portal): the offline app probes `GET /api/health` every 15 s before handing over.
