# SP Note Next Generation — code audit of SPNotesCore and SP Notes (macOS)

Audit date: 2026-11-19. Read-only: nothing was edited, built or launched.
Sources read: `~/Desktop/Cluster/apple/SPNotesCore` (git `main` @ `267a673`, clean, origin `gitsrv:srv/git/sp-notes-core.git`)
and `~/Desktop/Cluster/apple/SPNotes` (git `main` @ `bc6ea93`, clean, origin `gitsrv:srv/git/sp-notes-macos.git`).
The production server route list was read over SSH on `M4M64c:~/apps/note-spboucher-ai` (HEAD `77ef5f0`) with `find`.

Legend: **[code]** = read in the source; **[doc]** = taken from the project's own docs and not re-checked line by line;
**[not verified]** = not checked. No test was run during this audit: every test count below is a count of declarations
or a number reported by the projects' docs.

---

## A. SPNotesCore

### A.6 Package.swift (first, because it frames the rest) [code]

- `swift-tools-version: 6.0`, every target `.swiftLanguageMode(.v6)`.
- Platforms: `.iOS(.v18)`, `.macOS(.v15)`. `defaultLocalization: "fr"`.
- **No external dependency.** Only the system `sqlite3` (linker setting on `SPNotesStore`).
- Products: libraries `SPNotesDocument`, `SPNotesStore`, `SPNotesAPI`, `SPNotesSync`, plus umbrella `SPNotesCore`
  (`Sources/SPNotesCore/SPNotesCore.swift` = four `@_exported import`).
- Dependencies between modules: Document, Store, API are independent of each other. Sync depends on the three.
  `SPNotesStore` does not import `SPNotesDocument`: content is opaque `Data`, the caller supplies plain text, word count, preview.
- `SPN_ONLY=Document|Store|API|Sync` (read from the environment inside `Package.swift`) declares a single module and its
  tests; `SPN_ONLY=Sync` also declares the three it depends on. The umbrella product exists only when `SPN_ONLY` is unset.
- Size: 44 source files / about 12 500 lines, 27 test files / about 9 000 lines.
- Stale scratch directories are present in the tree: `.build-api`, `.build-doc`, `.build-main`, `.build-store`, `.build-synctest`.

Name clashes to know before importing the umbrella: `SearchHit`, `PurgeResult` and `Tombstone` exist in both `SPNotesAPI`
and `SPNotesStore` (the sync engine already writes `SPNotesStore.Tombstone`). `JSONValue` exists twice: public in
`SPNotesDocument/Model.swift:14`, internal in `SPNotesAPI/JSONSupport.swift:72` (the API exposes `RawJSON` instead).

### A.1 SPNotesDocument [code]

Files (`Sources/SPNotesDocument/`): `Model.swift` 406, `Schema.swift` 271, `Commands.swift` 609, `InlineCommands.swift` 135,
`Inline.swift` 181, `MarkdownImport.swift` 605, `MarkdownExport.swift` 89, `HTMLExport.swift` 179, `Text.swift` 245,
`Merge.swift` 138, `SchemaValidation.swift` 96, `Tables.swift` 120, `BlockIds.swift` 64, `JSONValue.swift` 329.

**Model types** (`Model.swift`)

| Type | Role |
|---|---|
| `JSONValue` (l.14) | `null, bool, int(Int64), double, string, array, object`; integers stay integers |
| `PMMark` (l.61) | `type: String`, `attrs: [String: JSONValue]?` |
| `PMNode` (l.99) | `type, attrs?, content?, text?, marks?, extra` — the raw ProseMirror node |
| `NoteDocument` (l.232) | `lines: [Line]` + internal `root: PMNode` (the `doc` shell) + `nextKey` |
| `Line` (l.209) | `path: [Container]`, `type: String`, `attrs`, `content: LineContent`, internal `preserved` |
| `Container` (l.177) | `key: Int` (local, not persisted), `type`, `attrs`, internal `preserved` |
| `LineContent` (l.200) | `.inline([InlineRun])` or `.blockAtom(PMNode)` |
| `InlineRun` (l.192) | `.text(String, marks: [PMMark])` or `.atom(PMNode)` |
| `MergeResult` (l.226) | `.merged(NoteDocument)` or `.conflict` |

There is **no per-node Swift type**. A node type is a `String`; "typed support" means: a constant in `enum NodeType`,
membership in the `Schema` sets, default attributes, a factory, and a `case` in each exporter. Classification happens in
one function, `NoteDocument.shape(of:)` (`Model.swift:320-327`):

1. a node with `text` → atom;
2. type in `Schema.textBlocks` → text line;
3. type in `Schema.blockAtoms` → block atom line;
4. no children → atom;
5. type in `Schema.containers` → container frame;
6. otherwise: any child that is text or in `Schema.inlineTypes` → text line, else container.

**Known node types** (`Schema.swift:11-42`, 30 constants, identical to `docs/reference/web-editor-schema.txt`, recorded from
backend commit `2c18f85`):

| Class | Types |
|---|---|
| text blocks (`Schema.textBlocks`, l.85) | `paragraph`, `heading`, `codeBlock`, `footnote`, `detailsSummary` |
| block atoms (`Schema.blockAtoms`, l.86) | `table` (whole subtree raw), `image`, `fileBlock`, `blockMath`, `horizontalRule`, `youtube` |
| containers (`Schema.containers`, l.87) | `bulletList`, `orderedList`, `taskList`, `listItem`, `taskItem`, `blockquote`, `callout`, `aiBlock`, `details`, `detailsContent` |
| inline (`Schema.inlineTypes`, l.89) | `text`, `hardBreak`, `mention`, `inlineMath`, `footnoteRef`, and the legacy name `"math"` |
| structural only | `doc`, `tableRow`, `tableHeader`, `tableCell` |

Marks: `Schema.markOrder` (l.107) = `link, bold, code, italic, strike, underline, highlight, subscript, superscript`.
`MarkKind` (l.45) is the toggleable set (all but `link`); `code` excludes the others.

None of `mermaid`, `drawing`, `chart`, `citation`, `pdf`, `blockRef`, `aiResult`, `queryView`, `runnableCode` exists
anywhere in Core or in the reference schema file. A grep for these names returns only `"mermaid"` as a *code block
language* in the macOS syntax highlighter (mapped to "no grammar").

**Unknown content: how it survives the round trip**

- Unknown node type: falls through `shape(of:)` rules 4-6. A leaf becomes `.blockAtom(node)` (block level) or
  `.atom(node)` (inline), kept as the raw `PMNode`. A node with block children becomes a `Container` frame of that type;
  a node with inline children becomes a text line of that type.
- Unknown attributes: `attrs` is a dictionary, nothing is filtered.
- Unknown keys on a node: `PMNode.extra` (`Model.swift:106`), also used for a known key with an unexpected shape
  (`attrs: null`, malformed `marks`). For lines and containers the same data is carried by `Preserved` (`Model.swift:166`:
  `emptyAttrs`, `emptyContent`, `marks`, `extra`).
- Unknown marks: `PMMark.type` is a string; marks are kept in document order on the run. `PMMark(json:)` refuses a mark
  with keys other than `type`/`attrs` (l.74), in which case the whole `marks` array stays in `extra`.
- Text nodes the model could not give back identically (adjacent same-mark text nodes, empty text, `marks: []`, text with
  `attrs` or extra keys) are kept as raw `.atom` runs of type `text` (`Model.swift:366-374`).
- Absent vs empty `attrs` / `content` is preserved.
- Stated guarantee [doc, `DOCUMENT_API.md`]: unmodified document → `jsonData()` semantically identical, key order aside.
  Output is canonical JSON with sorted keys.

Consequence for the upgrade: a new *leaf* node type already round-trips with zero change in Core. A new node type that has
children is where behaviour depends on the `Schema` sets (see "adding a type" below).

**Block ids**

- `BlockID.generate()` (`Schema.swift:147`): 10 characters of the 64-character nanoid alphabet.
- `Schema.idTypes` (l.91) = the server's `ID_TYPES`: `paragraph, heading, blockquote, codeBlock, bulletList, orderedList,
  taskList, table, callout, details, aiBlock, blockMath, image, fileBlock`. Not in the list: `horizontalRule`, `youtube`,
  `footnote`, `listItem`, `taskItem`, table rows and cells.
- `NoteDocument.ensureBlockIds()` → `assignBlockIds()` (`BlockIds.swift:12`): pre-order walk, assigns an id when missing or
  when it duplicates an earlier one. Described as equivalent to the server's `ensureBlockIds`.
- New nodes get an id at creation through `Schema.attrs(_:_:)` (`Schema.swift:138`).

**Exports and text** (all `switch n.type` with a `default` that recurses into children)

| Function | File | Unknown node |
|---|---|---|
| `markdown()` | `MarkdownExport.swift:45` (`block`) and `:11` (`inline`) | children concatenated, a leaf yields nothing |
| `html(title:)`, `htmlBody()` | `HTMLExport.swift:73` (`block`) and `:42` (`inline`) | `default:` at l.127 [branch body not read] |
| `plainText()`, `wordCount`, `preview(maxLength:)` | `Text.swift:141-170` | text of descendants |
| `pageReferences()` | `Text.swift:179` | `mention` ids (not `kind: "user"`) and link hrefs containing `/p/<uuid>` |
| `attachmentReferences()` | `Text.swift:192` | any node `attrs.src` with `/api/files/<uuid>`, plus `fileBlock.attachmentId` |
| `taskItems()` | `Text.swift:204` | — |
| `init(markdown:)` | `MarkdownImport.swift` | port of the server's `marked`-based import |

`plainText`, `wordCount` and `markdown` are stated to match the server byte for byte [doc]. That contract is the reason
every new node type needs the same `case` on the server (`text.ts`, `html.ts`) and here, in the same commit.
`attachmentReferences()` already picks up any new node type that stores a file in `attrs.src`.

**Three-way merge** (`Merge.swift`, 138 lines)

- Granularity: **top-level blocks of `doc`**, each compared as a whole canonical JSON string. An entire list, quote,
  callout or table is one block: two edits inside the same list conflict.
- Identity: the block id; a block without an id is identified by its content plus occurrence rank (l.19-36).
- Order: diff3 over the identity sequences using an LCS (`mergeOrder`, l.63).
- `.conflict` when: same block changed differently on both sides; changed on one side and deleted on the other; both sides
  inserted or reordered differently at the same place; the `doc` shell changed on both sides; the result would be empty;
  duplicate ids (top level before, any nested id after the merge).
- No intra-block text merge, no CRDT, no operational transform.
- Title and properties are merged outside this module, in `SyncEngine.merge` (`SyncEngine.swift:946`) and `mergeObjects`
  (l.968): title "one side changed", properties key by key.

**Schema validation** (`SchemaValidation.swift`): `SchemaChecker.known` (l.31) is a closed set; `check` reports
`unknown node type` for anything else and `strict` mode compares attribute key sets with `Schema.nodeDefaults`. Used by tests
and debug assertions.

**Commands** (`Commands.swift`, `InlineCommands.swift`, `Tables.swift`): `setLineType`, `toggleList`, `indentListItems`,
`outdentListItems`, `toggleBlockquote`, `toggleCallout`, `setTaskChecked`, `splitLine`, `mergeWithPrevious`,
`insertBlockAtom`, `replaceBlockAtom`, `deleteLine`, `replaceText`, `insertInlineAtom`, `toggleMark`, `setLink`,
`removeLink`, queries (`listKind`, `listDepth`, `isListItemHead`, `isTaskChecked`, `listItemNumber`), and table helpers on
`PMNode` (`tableGrid`, `setTableCellText`, `insert/deleteTableRow`, `insert/deleteTableColumn`, `toggleTableHeaderRow`).
Table helpers do not resolve `colspan`/`rowspan` geometry [doc]. Headings are clamped to levels 1-3.

**What it takes to add typed support for a new node type** — exact places:

| # | Place | What to add |
|---|---|---|
| 1 | `Schema.swift:11` `enum NodeType` | a `public static let` |
| 2 | `Schema.swift:85-89` | the type in exactly one of `textBlocks`, `blockAtoms`, `containers`, `inlineTypes` |
| 3 | `Schema.swift:95` `blockGroup` or `:99` `inlineGroup` | group membership (drives the validator) |
| 4 | `Schema.swift:91` `idTypes` | only if the server's `ID_TYPES` gains it too |
| 5 | `Schema.swift:111` `nodeDefaults` | the full default attribute set, as the web editor serializes it |
| 6 | `Schema.swift:178+` `extension PMNode` | a factory (`PMNode.mermaid(source:)`, …) |
| 7 | `SchemaValidation.swift:29` `leaves`, `:31` `known`, `:44` `switch n.type` | leaf or content rule |
| 8 | `MarkdownExport.swift:45` and `:27` | a `case` identical to the server's `toMarkdown` |
| 9 | `HTMLExport.swift:73` and `:62` | a `case` identical to the server's print view |
| 10 | `Text.swift:141` `nodeText` | only if the plain text is not "text of descendants" |
| 11 | `MarkdownImport.swift` | only if Markdown should produce the node (e.g. a ```` ```mermaid ```` fence) |
| 12 | `docs/reference/web-editor-schema.txt` and `Tests/SPNotesDocumentTests/Fixtures/*.json` | re-record from the web app |
| 13 | `Merge.swift` | nothing: whole-block comparison |

Suggested class for each requested type (my reading of the model, to be confirmed against the web schema once it exists):

| Type | Class | Note |
|---|---|---|
| `mermaid`, `chart`, `pdf`, `drawing`, `queryView`, `blockRef` (block embed) | block atom, attrs only | zero structural risk; round-trips today as an unknown leaf |
| `citation`, inline `blockRef` | inline atom | add to `inlineTypes` and `inlineGroup`; counts as 1 UTF-16 unit |
| `aiResult` | container of blocks, like `aiBlock` | also add to `Schema.wrappers` (l.103) and `blockParents` (l.105) if blocks may be lifted out |
| `runnableCode` | text block like `codeBlock`, or block atom | as a text block it must join every `codeBlock` special case: grep `NodeType.codeBlock` in `Commands.swift`, `Inline.swift`, `SchemaValidation.swift:49`; and `ParaStyle.isCode` in both native editors |

Hazard: a node type that holds text and is *not* registered falls to rule 6 and is flattened into an editable text line
of an unknown type. The codec keeps it, but an editor that does not know the type will let the user type into it.

### A.2 SPNotesStore [code]

Files: `Schema.swift` 204, `SQLite.swift` 254, `NotesStore.swift` 341, `+Pages` 434, `+Queries` 242, `+Sync` 445,
`+Queue` 276, `+History` 216, `Models.swift` 554. `public actor NotesStore`.

**Connection**: `SQLITE_OPEN_FULLMUTEX`, `journal_mode=WAL`, `synchronous=FULL`, `foreign_keys=ON`, `busy_timeout` 8 s,
write transactions `BEGIN IMMEDIATE` [doc, `STORE_API.md` §1]. One file may be opened by several processes; a read-only
store never creates or migrates.

**Migrations** (`Schema.swift:9-38`): `PRAGMA user_version`; `Schema.migrations: [Migration] = [v1]`; `currentVersion` =
array count; each step runs in one transaction with its version bump; a file newer than the build is refused
(`StoreError.schema`). **To add tables: append a `v2` closure to the array (l.13). Never edit `v1`.** The current schema
version is 1, so the first schema change of the upgrade is the first migration this code has ever run on real user files.

**Schema v1** — 10 tables + 1 FTS5 virtual table:

| Table | Columns |
|---|---|
| `pages` | `rid` INTEGER PK AUTOINCREMENT, `id` TEXT UNIQUE, `parent_id`, `database_id`, `type` ('page'), `section` ('notes'), `title`, `icon`, `cover`, `content` BLOB, `properties` BLOB, `position` REAL, `pinned`, `archived`, `server_version`, `word_count`, `created_at`, `updated_at`, `last_opened_at`, `deleted_at`, `inbox_at`, `capture_kind`, `rev`, `needs_create`, `dirty_content`, `dirty_meta` TEXT, `tags_dirty`, `edit_seq`, `sync_state` ('synced'), `sync_error`, `plain_text`, `preview`, `favorite`, `is_folder`, `local_updated_at` |
| `page_bases` | `page_id` PK, `title`, `content`, `properties`, `version` |
| `tags` | `name` PK, `color` |
| `page_tags` | (`page_rid` → `pages.rid` ON DELETE CASCADE, `name`) PK |
| `pages_fts` | FTS5 `(title, body, tags)`, `tokenize='unicode61 remove_diacritics 2'`, rowid = `pages.rid` |
| `attachments` | `id` PK, `page_id`, `filename`, `mime`, `size`, `sha256`, `page_count`, `created_at`, `deleted_at`, `rev`, `state` ('remote'), `local_path`, `keep_offline`, `uploaded`, `upload_attempts`, `last_error`, `last_accessed_at` |
| `ops` | `seq` PK AUTOINCREMENT, `kind`, `target_id`, `payload` BLOB, `idem_key` UNIQUE, `created_at`, `attempts`, `next_attempt_at`, `leased_until`, `handed_out`, `coalescable`, `last_error` |
| `conflicts` | `page_id` PK, `version`, `title`, `content`, `properties`, `updated_at`, `detected_at` |
| `local_versions` | `seq` PK AUTOINCREMENT, `id` UNIQUE, `page_id`, `created_at`, `title`, `content`, `word_count`, `reason`, `plain_text`, `preview` |
| `reminders` | `id` PK, `page_id`, `title`, `due_at`, `done`, `server_task_id`, `dirty`, `deleted`, `edit_seq`, `created_at`, `updated_at` |
| `meta` | `key` PK, `value` |

Indexes on `pages`: `pages_parent`, `pages_live_updated`, `pages_live_recent`, `pages_pinned`, `pages_favorite`,
`pages_inbox`, `pages_archived`, `pages_trash`, `pages_folders`, `pages_section_root`, `pages_dirty` (partial, on
`Schema.dirtyPredicate`, which must stay textually identical to the index), `pages_unsynced_state`. Others:
`page_tags_name`, `attachments_page`, `attachments_not_uploaded`, `attachments_local`, `ops_target`, `local_versions_page`,
`reminders_page`, `reminders_due`, `reminders_dirty`.

Only `page_tags` has a declared foreign key; every other relation is by page id in code. Timestamps are integer
milliseconds. Ids are lowercase UUID strings.

**Entity kinds stored**: pages (which also stand for folders = `properties.folder`, and can hold database pages and rows
through `type` / `database_id`), base copies, tags, attachments metadata, queued ops, conflict copies, local versions,
reminders, key/value meta. **Not stored**: tasks as the server models them (only "reminders"), database schemas / views /
properties, graph edges or backlinks, embeddings, AI conversations, research references, agents, saved searches,
comments, canvases, user settings.

**Public API surface** [doc `STORE_API.md`, signatures spot-checked]:

- Engine: `init(url:readOnly:)`, `inMemory()`, `close()`, `integrityCheck()`, `checkpoint()`, `rebuildSearchIndex()`, `wipeAll()`.
- Pages, local mutations (one transaction each): `createPage`, `createPages`, `updateContent`, `setProperties`,
  `setFavorite`, `setFolder`, `setPinned`, `setArchived`, `setIcon`, `setCover`, `setInbox`, `move`, `setTags`, `trash`,
  `restore`, `purge`, `duplicate`, `markOpened`.
- Queries: `page`, `summary`, `pageCount`, `summaries(list:)` with `SmartList` (`all, recent, pinned, favorites, inbox,
  archived, trash`), `children(of:)`, `folderTree`, `ancestors`, `summaries(tag:)`, `tags()`, `counts()`.
- Search: `search(query:filters:limit:)`, bm25 weights title 10 / tags 4 / body 1, last term as prefix, input always quoted.
- Sync primitives: `syncCursor`/`setSyncCursor`, `pagesNeedingPush`, `pendingPushCount`, `pageBase`, `markPushed`,
  `markPushFailed`, `applyRemote(pages:attachments:tombstones:tags:cursor:)`, `resetSyncState`,
  `removeSyncedPages(notIn:)`, `resolveConflictUsingCopy`, `resolveConflictKeepingLocal`.
- Conflicts: `recordConflict`, `conflict`, `conflicts`, `clearConflict`.
- Ops queue: `enqueueOp(kind:targetId:payload:)`, `nextOps` (leases, per-target ordering), `completeOp`, `failOp`
  (backoff 5 s doubling to 900 s), `releaseOp`, `releaseAllOpLeases`, `queuedOps`, `opCount`.
- Attachments: `addLocalAttachment`, `attachment`, `attachments(pageId:)`, `pendingUploads`, the `markAttachment…` family,
  `setAttachmentKeepOffline`, `touchAttachment`, `evictionCandidates`, `attachmentsWantedOffline`,
  `resetTransientAttachmentStates`.
- Local versions: `snapshot`, `localVersions`, `localVersion`, `restoreVersion`; 100 per page.
- Reminders: `createReminder`, `updateReminder`, `deleteReminder`, `reminder`, `reminders(pageId:)`,
  `upcomingReminders`, `dirtyReminders`, `markReminderSynced`.
- Meta: `meta`, `setMeta`, `allMeta`.
- Change stream: `changes() -> AsyncStream<StoreChange>` with `pages(Set<String>), tags, attachments(Set<String>), queue,
  conflicts, reminders, meta(String), reset`; `noteExternalChange()` for another process's writes.

### A.3 SPNotesAPI [code]

Files: `NotesAPI.swift` 432, `HTTPClient.swift` 546, `APIError.swift` 201, `AuthService.swift` 80,
`PasskeyAuthorizer.swift` 137, `PasskeyCeremony.swift` 335, `SessionTokenStore.swift` 117, `SSEParser.swift` 111,
`AIModels.swift` 161, `PageModels.swift` 412, `ServiceModels.swift` 377, `JSONSupport.swift` 321, `MultipartForm.swift` 113,
`APIConfiguration.swift` 136.

**Every endpoint method** (`NotesAPI.swift`, line of the method):

| Method (line) | Verb and path |
|---|---|
| `sync(since:limit:)` (32) | GET `/api/sync?since=&limit=` |
| `createPage` (45) | POST `/api/pages` |
| `page(id:open:)` (52) | GET `/api/pages/{id}[?open=1]` |
| `pageHead` (57) | GET `/api/pages/{id}?head=1` |
| `patchPage` (63) | PATCH `/api/pages/{id}` |
| `resolveConflict` (75) | POST `/api/pages/{id}/resolve` |
| `trashPage` (82) | DELETE `/api/pages/{id}` |
| `purgePage` (88) | DELETE `/api/pages/{id}?purge=1` |
| `emptyTrash` (95) | DELETE `/api/trash[?olderThanDays=]` |
| `restorePage` (102) | POST `/api/pages/{id}?action=restore` |
| `duplicatePage` (107) | POST `/api/pages/{id}?action=duplicate` |
| `pageVersions` (114) | GET `/api/pages/{id}/versions` |
| `pageVersion` (119) | GET `/api/pages/{id}/versions?v=` |
| `restorePageVersion` (126) | POST `/api/pages/{id}/versions` |
| `pageTags` (133) / `setPageTags` (141) | GET / PUT `/api/pages/{id}/tags` |
| `tags` (146) | GET `/api/tags` |
| `uploadAttachment` (159) | POST `/api/attachments` (multipart, streamed from a file, progress callback) |
| `attachments(pageID:)` (174) | GET `/api/attachments[?pageId=]` |
| `deleteAttachment` (181) | DELETE `/api/attachments?id=` |
| `downloadFile` (187) | GET `/api/files/{id}` (to a file, progress callback) |
| `loginOptions` (237) / `loginVerify` (242) | POST `/api/auth/login/options` / `…/verify` |
| `reauthOptions` (247) / `reauthVerify` (252) | POST `/api/auth/reauth/options` / `…/verify` |
| `authState` (257) | GET `/api/auth/state` |
| `logout` (264) | POST `/api/auth/logout` |
| `sessions` (269), `revokeSession` (276), `revokeAllSessions` (285) | GET `/api/auth/sessions`, DELETE `…/{id}`, DELETE `/api/auth/sessions` |
| `passkeys` (290) | GET `/api/auth/passkeys` |
| `passkeyRegistrationOptions` (295) / `…Verify` (301) | POST `/api/auth/passkeys/options` / `…/verify` |
| `renamePasskey` (310) / `deletePasskey` (315) | PATCH / DELETE `/api/auth/passkeys/{id}` |
| `aiAction` (327) | POST `/api/ai/action` (SSE) |
| `aiChat` (333) | POST `/api/ai/chat` (SSE) |
| `search` (366) | GET `/api/search` (`mode=quick|hybrid`, `semantic`, `section`, `since`, `until`, `archived`) |
| `tasks` (380), `createTask` (385), `updateTask` (390), `deleteTask` (396) | GET / POST / PATCH / DELETE `/api/tasks` |
| `inbox` (403), `triageInboxItem` (408), `undoInboxAction` (416) | GET `/api/inbox`, POST `/api/inbox/{id}`, POST `/api/inbox/undo` |
| `capture` (422) | POST `/api/capture` |
| `health` (429) | GET `/api/health` |

Helpers: `NotesAPI.newID()`, `newIdempotencyKey()`, `filePath(id:)`, `fileID(fromSource:)`.

**Auth and session** (`HTTPClient.swift`, an `actor`):

- The backend authenticates with an HttpOnly **cookie**, not a bearer header. The client uses an ephemeral `URLSession`
  with cookie storage, cookie handling, credential storage and URL cache switched off (l.189-197), reads the token from
  `Set-Cookie` itself (`absorb`, l.381-402) and sends `Cookie: __Host-note_session=<token>` by hand (l.365-371).
- Mutating requests (everything but GET) carry `Origin: <configuration.origin>` and, when given, `Idempotency-Key` (l.360-363).
- `User-Agent: SPNotes/<x.y.z> (iPhone|iPad|Macintosh; <os>) native` (`APIConfiguration.userAgent`); the server labels the session from it.
- Redirects are refused (session delegate, l.494). TLS ≥ 1.2 [doc].
- Token rotation: a `Set-Cookie` with a new value replaces the token and is saved to the `SessionTokenStore`; a cleared
  cookie or a 401 ends the session; `sessionEvents()` yields `signedIn`, `tokenRotated`, `signedOut(reason)`.
- WebAuthn ceremony state travels in a second cookie `__Host-note_wa`: captured on an `options` call
  (`HTTPRequest.Ceremony.begin(key)`), replayed once on the matching `verify` (`.complete(key)`), keys `login | reauth | register`.
- `SessionTokenStore` protocol; `KeychainTokenStore` (`SessionTokenStore.swift:33`): generic password, service
  `ai.spboucher.spnotes.session` by default, account = the backend origin, `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`,
  not synchronizable, optional access group, data-protection keychain on macOS by default. `InMemoryTokenStore` for tests.
- `AuthService` (`AuthService.swift`): `signIn()`, `stepUp()`, `addPasskey(label:stepUpIfNeeded:)`,
  `withFreshSession { }` (one automatic step-up on `403 reauth_required`), `signOut()`.
- `SystemPasskeyAuthorizer` (`PasskeyAuthorizer.swift:24`): `ASAuthorizationController` for assertion and registration;
  `PasskeyCeremony` does the JSON/base64url work; `PasskeyError` = `cancelled, noCredentials, alreadyRegistered,
  notInteractive, inProgress, notAssociated, invalidOptions, failed(code:message:)`.
- There is no client for first enrolment (`/api/auth/enroll/*`): the first passkey is created on the web.

**Streaming**: `HTTPClient.openStream` (l.313) uses `URLSession.bytes(for:)` with `Accept: text/event-stream` and
`streamIdleTimeout` (120 s). `SSEParser` is a byte-fed parser. `NotesAPI.events(from:)` (l.343) turns it into
`AsyncThrowingStream<AIEvent, Error>`, ends at `data: [DONE]`, and cancels the reader when the stream is dropped.
`AIEvent` (`AIModels.swift:128`) = `meta, text, done, error, needsConfirmation, other(type:raw:)`. The `other` case means
new server event types (tool calls, citations, agent steps) do not break old clients, but they are untyped: sources of
grounded chat answers arrive today as `.other` or inside `AIMeta.raw` and nothing decodes them.
SSE is used for the two AI routes only. There is no general event channel (no WebSocket, no SSE feed for sync or presence).

**Error model** (`APIError.swift:30`): `offline, transport(URLError.Code), timeout, cancelled, invalidResponse,
decoding(String), file(String), http(status:code:message:body:), conflict(server: PageConflict, message:),
confirmExpensive(plan: RawJSON, message:)`. Stable codes in `APIError.Code`. Helpers: `isRetryable` (offline, transport,
timeout, 429, 408, 5xx, `409 in_progress`; not `not_configured`/`no_model`), `isConflict`, `needsReauth`,
`isUnauthenticated`, `isRateLimited`, `isOffline`, `isNotFound`, `serverCopy`, `plan`. Descriptions never include request data.
**`HTTPClient` does not retry by itself**; retry policy lives in `SyncEngine`.

**Server areas with no client** — production route tree (`M4M64c:~/apps/note-spboucher-ai/src/app/api`) versus `NotesAPI`:

| Area | Routes on the server with no method in `NotesAPI` |
|---|---|
| Databases | `/api/databases`, `/api/databases/templates`, `/api/databases/[id]`, `…/properties`, `…/views`, `…/rows`, `…/rows/restore`, `…/query`, `…/import`, `…/duplicate`, `…/apply-template`, `…/ai` |
| Graph | `/api/graph`, `/api/graph/backlinks`, `/api/graph/neighbors`, `/api/graph/suggestions` |
| Research | `/api/research/overview`, `…/papers`, `…/references` (+ `[id]`, `[id]/extracts`, `[id]/links`, `doi`, `import-bibtex`, `export.bib`), `…/experiments` (+ `[id]`), `…/tasks` (+ `[id]`), `…/ai` |
| Agents and jobs | `/api/agents`, `/api/agents/[id]`, `/api/jobs` |
| AI beyond action/chat | `/api/ai/models`, `/api/ai/conversations`, `/api/ai/usage`, `/api/ai/chat/plan`, `/api/ai/compare`, `/api/ai/compare/vote` |
| Search extras | `/api/search/duplicates`, `/api/search/index-state` |
| Dashboard | `/api/dashboard`, `/api/dashboard/summary` |
| Import / export | `/api/import`, `/api/export` |
| Settings | `/api/settings`, `/api/settings/audit` |
| Tree | `/api/tree` |
| Pages | `/api/pages/[id]/beacon`; list `GET /api/pages` |
| Auth | `/api/auth/enroll/options`, `/api/auth/enroll/verify` |

Covered by a client method but used by no macOS code: `search`, `tasks`/`createTask`/`updateTask`/`deleteTask` (the engine
uses the last three for reminders), `inbox`/`triageInboxItem`/`undoInboxAction` (engine only, for queued triage),
`capture`, `tags`, `pageTags`, `attachments`, `duplicatePage`, `emptyTrash`, `authState`, `health`, `renamePasskey`,
`deletePasskey`, `revokeAllSessions`.

The dev worktree `M4M64c:~/dev/note-v2` additionally has `/api/backups` and has **no** `/api/sync` and no
`apple-app-site-association` route; production has both. The request and response shapes of the uncovered routes were
not read. [not verified]

### A.4 SPNotesSync [code + doc]

One file, `SyncEngine.swift` (1 014 lines): `public actor SyncEngine`, `SyncOptions` (`autoDownloadLimit` 25 MiB,
`includeDatabaseRows = false`, `feedPageSize = 200`), `SyncStatus`, `SyncOutcome`, `ConflictResolution`,
`AttachmentFileLocating`, `ContentDigest`, `QueuedTriage`.

**There is no general op journal.** State-based sync with two mechanisms:

1. **Dirty flags on the page row** for page state: `needs_create`, `dirty_content` (title / content / properties, the
   version-guarded fields), `dirty_meta` (a set among `parentId, section, position, pinned, archived, icon, cover, inboxAt`),
   `tags_dirty`, plus `edit_seq` incremented by every local change to push. The base copy in `page_bases` is the last
   state common with the server.
2. **The `ops` table** for actions that are not state: `OpKind` (`Models.swift:395`) = `trash, restore, purge,
   deleteAttachment, createTask, updateTask, deleteTask, triage`. A row is `seq`, `kind` (free string), `target_id`,
   `payload` (opaque BLOB; JSON `QueuedTriage` for triage), `idem_key` (32 hex characters generated once), `attempts`,
   `next_attempt_at`, `leased_until`. The dispatch is the `switch op.kind` at `SyncEngine.swift:574-589`; only `trash,
   restore, purge, deleteAttachment, triage` are handled. **An unknown kind falls to `default: break` and is then
   completed, i.e. silently dropped** (l.587-590). `createTask`/`updateTask`/`deleteTask` are declared but not dispatched:
   reminders go through `pushReminders()` (l.608) from the `reminders` table.

**Cycle** (`cycle()`, l.179): up to 4 rounds of push then pull, then downloads.

- Push (`push()`, l.263): creations, parents first (`POST /api/pages` with the local id, then one unguarded PATCH and
  `PUT tags`); uploads (`uploadPending`, l.529); edits of known pages (`sendChanges`, l.385): unguarded fields and tags,
  then title/content/properties with `baseVersion`; queue (`runQueue`, l.563); reminders (`pushReminders`, l.608).
- Pull (`pull()`, l.651): `GET /api/sync?since=<cursor>` until `more` is false; each answer applied by
  `store.applyRemote` in one transaction with its cursor.
- Downloads (`downloadWanted`, l.814): up to 40 files [doc].

**Cursor**: `meta["sync.cursor"]`, an `Int64` equal to the server `rev`, a single sequence bumped by database triggers on
every write. `since=0` = full copy. `reset: true` → `resetSyncState()` and a full re-download, at most twice per cycle.
The feed must strictly advance while `more`.

**Conflicts** (`reconcile`, l.485): server copy equal to local → adopted; equal to what this device sent before a lost
answer (`sync.sent.<pageId>` fingerprint) → base moved; server older than the base → local sent again with a snapshot;
otherwise three-way merge (title, `NoteDocument.merge`, properties key by key); otherwise a `conflicts` row, local text
untouched, the page leaves the push list until `resolveConflict(pageId:choice:)` (`keepMine | keepTheirs | keepBoth`).
Flags, tags, moves, icon, cover, position are last-writer-wins.

**Idempotency**: page creation and upload rely on the client-chosen id and deliberately send **no** key; guarded PATCH on
`baseVersion`; ops on their stored key; task creation on `spn-task-<reminder id>`; resolution on a key built from page,
server version, choice and a fingerprint of the local text.

**Entity kinds that flow**

| Kind | Push | Pull |
|---|---|---|
| pages (notes, folders) | yes | yes |
| tags (per page, and the workspace tag list with colours) | yes | yes |
| attachments (metadata + bytes) | yes | yes |
| tombstones (`page`, `attachment`) | — | yes |
| trash / restore / purge / attachment deletion / inbox triage | yes (ops) | effects arrive as page changes |
| reminders → server tasks | yes | **no** — tasks created or changed on the web never come back |
| database row pages | no | filtered out at `SyncEngine.swift:680` unless `includeDatabaseRows` |
| workspace name, user display name | — | yes, into `meta` |
| databases (schema, views, properties), graph edges, research, agents, AI conversations, settings | no | no |

The feed (`SyncPage`, `PageModels.swift:24`) carries `pages, attachments, tombstones, tags` only. `Tombstone.kind` is a
string; the engine maps it with `SPNotesStore.Tombstone.Kind(rawValue:)` and **drops unknown kinds** (l.682-685).

**How to extend the engine to new entity kinds** (database rows, tasks, graph edges, canvases)

The engine has no entity abstraction: no protocol, no registry. Each kind is hand-written across four layers. Per new kind:

1. Server: add the kind to the `GET /api/sync` payload and to the `rev` triggers, with tombstones.
2. `SPNotesAPI/PageModels.swift:24` `SyncPage`: a new optional array (decoding must tolerate its absence so old servers
   still work) and the DTO; endpoint methods in `NotesAPI`.
3. `SPNotesStore/Schema.swift:13`: migration `v2` (table with `rev`, dirty flags, `edit_seq`, optional base copy);
   `Models.swift`: record types, a new `Tombstone.Kind`, a new `StoreChange` case; `NotesStore+Sync.swift`: extend
   `applyRemote(…)` and `ApplySummary`, add `…NeedingPush` / `mark…Pushed`.
4. `SyncEngine.swift`: a push phase in `push()` (l.263), mapping in `pull()` (l.680-687), a `case` in `runQueue()` (l.574)
   for any new op kind, and the tombstone mapping (l.682).

Cheaper routes that avoid a new kind:

- **Database rows are already pages** (`database_id`, `type`). Setting `includeDatabaseRows = true` brings rows into the
  existing page pipeline, with versioned `properties` and the key-by-key merge. What is still missing is the database
  *definition* (properties, views), which has no feed entry and no table. `NoteSession.isEditable` in the macOS app
  currently makes such pages read-only.
- **Canvases, drawings, charts** stored as page content (a node type) or as a page of a new `type` need no engine change;
  only the 3-way merge granularity (whole top-level block) limits concurrent editing.
- **Graph edges** are derivable from content (`pageReferences()` exists); a local `links` table filled by the store at
  write time would give offline backlinks without syncing anything. The store does not import `SPNotesDocument`, so the
  caller would have to supply the references, as it does for plain text.
- **Tasks**: two models exist on the server — task items inside documents (`taskItem` nodes, counted by `taskItems()`)
  and `/api/tasks` rows. The store's `reminders` table is a push-only shadow of the second. Bidirectional tasks need the
  feed entry and an "apply remote reminder".

Known limits listed by the project [doc `SYNC_ENGINE.md` §6]: reminders push-only; moves are last-writer-wins and the
server does not check cycles; no compare-and-set on the conflict helpers; a restored server whose head has passed the
cursor is undetectable; 500 pages per round, 4 rounds per cycle; ops refused for good are retried forever; `stop()` reads
as `.offline`.
Doc inconsistency: `SYNC_ENGINE.md` §6 says a purged folder queues one op for the root only; `STORE_API.md` §2.2 and the
macOS 1.0.1 release notes say one op per page of the subtree. The second is the later text. [not verified in code]

### A.5 Tests [declarations counted; nothing run]

| Target | Framework | Suites → declared tests |
|---|---|---|
| `SPNotesDocumentTests` | Swift Testing | Command 35, Model 22, Text 16, Merge 7, Dump 1 = **81** |
| `SPNotesStoreTests` | Swift Testing | Sync 15, Page 12, Engine 11, Search 6, QueueHistory 5 = **49** |
| `SPNotesAPITests` | XCTest | HTTPClient 22, ErrorAndModel 17, PasskeyAndAuth 15, RoutesAndMultipart 12, SSEAndAI 11, LiveBackend 11 = **88** |
| `SPNotesSyncTests` | Swift Testing | Fault 26, MergeConflict 16, TrashAttachmentQueue 14, SyncEngine 7, RandomConvergence 1, LiveSmoke 1 = **65** |

Total 283, matching the README. Fixtures: `Tests/SPNotesDocumentTests/Fixtures/{rich,unknown,expected,md-samples,
md-server,random-server}.json`. `Tests/SPNotesSyncTests/FakeBackend.swift` (1 072 lines) is an in-memory backend written
from the server's route handlers; it will need every new route and feed field.

How they are run:

```sh
swift test                                              # everything
SPN_ONLY=Document swift test --scratch-path .build-document
SPN_ONLY=Store    swift test --scratch-path .build-store
SPN_ONLY=API      swift test --scratch-path .build-api
SPN_ONLY=Sync     swift test --scratch-path .build-sync
```

Environment variables: `SPN_ONLY`; `SPN_LIVE_URL` + `SPN_LIVE_TOKEN` (live tests, skipped with `XCTSkip` when unset, and
any `*.spboucher.ai` host is refused); `SPN_LIVE_TOKEN_DISPOSABLE`, `SPN_LIVE_TOKEN_DISPOSABLE2`; `SPN_RANDOM_SEEDS`,
`SPN_RANDOM_ONLY`; `SPN_DUMP`. Live server = SSH tunnel to `M4M64c:8482` (`~/dev/note-native`, database
`note_native_dev`), token minted by `scripts/dev-session.ts` on the node. `swift test` writes every emitted document to
`/tmp/spn-docs.json` for validation against the real web schema on `M4M64c:~/dev/note-v2`.

Flakiness: no test is marked flaky and no known-flaky note exists in the docs. Time- or environment-dependent items:
the live tests' "fresh" window (a dev token is fresh for 5 minutes; after that the purge and revocation tests assert
`reauth_required` instead), and the keychain test, which skips when no usable keychain exists. `/tmp/spn-dev-token.txt`
exists on this laptop from an earlier session (not opened).

---

## B. macOS app (SP Notes 1.0.2, build 3)

44 Swift files, about 6 600 lines. `project.yml` (XcodeGen) + a local SwiftPM package for the editor.

### B.1 Structure — every file

**App/**

| File | Lines | Role |
|---|---|---|
| `SPNotesApp.swift` | 44 | `@main`; scenes: `WindowGroup("SP Notes", id: "main")`, `WindowGroup("Note", id: "note", for: String.self)`, `Settings`, `MenuBarExtra` |
| `AppEnvironment.swift` | 170 | `LaunchOptions`, `Connectivity` (NWPathMonitor), `AttachmentFiles`, `AppEnvironment` (the dependency container: HTTP, API, auth, store, sync, preferences, account, library, sync monitor, lock, note sessions) |
| `MainWindow.swift` | 140 | `WindowModel` (per-window state), `MainWindow` (3-column `NavigationSplitView`), `LockScreen`, `AppEnvironment.start()` |
| `AppCommands.swift` | 102 | the menu bar: File, Edit additions, Format, Insérer, Note, View additions, Synchronisation |
| `AppDelegate.swift` | 206 | `DeepLink`, `AppDelegate` (URL open, Service, terminate flush), `GlobalHotKey` (Carbon), `QuickNotePanel`, `QuickNoteModel`, `QuickNoteView` |
| `SyncMonitor.swift` | 133 | `SyncMonitor` (drives `SyncEngine`, 75 s timer), `ToastCenter`, `ImageCache` |
| `AppLock.swift` | 40 | optional local lock through LocalAuthentication |
| `Preferences.swift` | 64 | `AppearanceMode`, `NoteSort`, `Preferences` (16 UserDefaults keys) |

**Components/**

| File | Lines | Role |
|---|---|---|
| `DesignSystem.swift` | 91 | `Palette`, `Format`, `SyncDot`, `ToastOverlay`, `EmptyState`, `HighlightedText`, `onChangeAsync` |
| `EditorController.swift` | 62 | owns one `NoteTextView` + scroll view, implements `NoteTextViewDelegate` and `AtomResources`; `NoteEditorView` (`NSViewRepresentable`) |

**Features/**

| File | Lines | Role |
|---|---|---|
| `Account/AccountModel.swift` | 101 | phases `local | signedIn | expired`, sign-in, sign-out with or without local erase |
| `Account/AccountSheet.swift` | 113 | sign-in, passkey list, session list, sync box, reauth button |
| `Account/WelcomeView.swift` | 37 | first-launch screen |
| `AI/AssistantPanel.swift` | 155 | `AssistantModel` + side panel |
| `Attachments/AttachmentService.swift` | 133 | import and validation of files and images, Quick Look, save copy, disk usage, eviction |
| `History/HistoryAndConflicts.swift` | 147 | `HistorySheet` (local + server versions), `ConflictBanner`, `ConflictSheet` |
| `Home/LibraryModel.swift` | 191 | `SidebarItem`, `FolderNode`, `LibraryModel` (lists, folders, tags, search, all organisational actions) |
| `Home/SidebarView.swift` | 119 | sidebar + `SyncStatusBar` |
| `Notes/NoteSession.swift` | 156 | one open note: editor, title, autosave, snapshots, merge of remote changes |
| `Notes/NoteDetailView.swift` | 287 | `NoteDetailView`, `NoteEditorPane`, `Banner`, `FormatBar`, `StatusBar` |
| `Notes/AtomEditors.swift` | 220 | `AtomEditorSheet`, `TableEditor`, `MathEditor`, `ImageDetails`, `FileDetails`, `UnknownBlock`, `LinkEditorSheet` |
| `Notes/InspectorPanel.swift` | 104 | tags, organisation, info, attachments, links; `FlowLayout` |
| `Notes/NoteListView.swift` | 168 | middle column, `NoteRow`, `SearchFilterBar` |
| `Notes/Exporter.swift` | 171 | export Markdown / text / HTML / RTF / PDF / ZIP, print, import |
| `Search/CommandPalette.swift` | 114 | palette (⇧⌘P) and quick open (⌘O), `AppActions` |
| `Settings/SettingsView.swift` | 116 | General, Editor, Sync, Security, Storage tabs |

**Editor/** (SwiftPM target `SPNotesEditor`, AppKit only, depends on `SPNotesDocument` and SwiftMath 1.7.3)

| File | Lines | Role |
|---|---|---|
| `NoteTextView.swift` | 642 | the `NSTextView` subclass on TextKit 2: load, serialize, `applyRemote`, incremental styling, the `replace` primitive, Return / Tab / Backspace, Markdown shortcuts, mouse handling |
| `EditorCommands.swift` | 341 | `BlockKind`, `SelectionState`, block and mark commands, atom insertion, Markdown insertion |
| `DocumentCodec.swift` | 151 | `NoteDocument` ⇄ `NSAttributedString` |
| `EditorAttributes.swift` | 162 | `.spPara`, `.spMarks`, `.spDecoration`, `ParaStyle`, `MarkSet`, `ParaDecoration`, `EditorTheme`, `KeyAllocator` |
| `Styler.swift` | 185 | fonts, colours, indents, decorations for the touched paragraphs |
| `BlockLayoutFragment.swift` | 100 | `NSTextLayoutFragment` subclass drawing markers, quote bars, panels |
| `AtomAttachment.swift` | 267 | `NodeBox`, `AtomResources`, `AtomAttachment`, `AtomRenderer` |
| `Completion.swift` | 215 | "/" and "@" menus, `CompletionPanel`, `EditorImages` |
| `NoteFragment.swift` | 158 | pasteboard: private structured type, RTF, plain text, foreign rich text |
| `SyntaxHighlighter.swift` | 119 | hand-written tokenizer, about 20 language families |
| `ExportComposer.swift` | 96 | attributed string for RTF / PDF / print |
| `MathRenderer.swift` | 46 | SwiftMath typesetting with a cache |

**Tests/**: `EditorTests/EditorTests.swift` (288, SwiftPM), `EditorTests/SnapshotSupport.swift`, `AppTests/EndToEndTests.swift`
(305, hosted), `UITests/SPNotesUITests.swift` (45).

### B.2 Editor architecture [code]

**Storage ⇄ model mapping.** The text view's `NSTextStorage` is the live model; `NoteDocument` exists only at load and at
save. Conventions (`DocumentCodec.swift:7-12`):

- every line ends with `\n`, the last included; the newline carries the paragraph attributes;
- `.spPara` → a `ParaStyle` object (`EditorAttributes.swift:18`) = the `Line` without its content (`template`), so unknown
  node keys survive; the paragraphs of one code block share **the same instance** (identity is the block);
- `.spMarks` → a `MarkSet` of raw `PMMark`, unknown marks included;
- a block atom = a paragraph made of one `U+FFFC` attachment character carrying an `AtomAttachment`;
- an inline atom = one attachment character; a `hardBreak` = `U+2028` tagged `.spInlineNode` with a `NodeBox`;
- `.spDecoration` → `ParaDecoration`, derived, never serialized.

`DocumentCodec.attributedString(from:)` (l.23) and `DocumentCodec.lines(from:in:)` (l.70) are the two directions. Save:
`NoteSession.saveNow` → `editor.document()` → `jsonData()` → `ContentDigest` → `store.updateContent`. So **every autosave
(350 ms after the last keystroke) re-serializes the whole document**; measured 32 ms for 4 000 blocks [doc `TEST_REPORT.md`].

**Styling.** `NSTextStorageDelegate.textStorage(_:didProcessEditing:…)` (`NoteTextView.swift:202`) calls
`Styler.affectedRange` then `Styler.style`, which restyles the edited paragraphs widened to their top-level structure.
`Styler.apply` (`Styler.swift:73`) walks `ParaStyle.path` and switches on the container type (l.79-110).

**How each block type is rendered**

| Node | Rendering | Where |
|---|---|---|
| paragraph, heading 1-3, footnote | fonts / sizes from `EditorTheme` | `Styler.swift:134-154` |
| marks bold, italic, underline, strike, code, highlight, sub, superscript, link | attributes | `Styler.swift:135-153` |
| codeBlock | monospaced font, panel, token colours | `Styler.swift:114-117`, `highlightCode` l.158, panel in `BlockLayoutFragment.draw` |
| bulletList / orderedList / taskList | indent + marker (`bullet(level)`, `number`, `checkbox`) drawn by the layout fragment | `Styler.swift:86-108`, `BlockLayoutFragment.swift:70-90` |
| blockquote | bars | `Styler.swift:80`, fragment |
| callout | tinted panel + icon | `Styler.swift:81`, fragment |
| aiBlock | tinted panel | `Styler.swift:83`, fragment |
| details | disclosure marker on the summary, content indented; **no collapse** — `open` is ignored | `Styler.swift:85, 113` |
| table | **bitmap** of the grid | `AtomRenderer.table`, `AtomAttachment.swift:246` |
| image | bitmap, max width 720; placeholder card when the file is not local | `picture`, l.143 |
| blockMath / inlineMath | SwiftMath bitmap; fallback = source text | l.158, l.173 |
| fileBlock, youtube | a generic "card" bitmap (symbol + title + subtitle) | l.106-107 |
| mention, footnoteRef | "pill" bitmap | l.108, l.110 |
| horizontalRule | 1-pt line bitmap | l.137 |
| unknown block | card "Bloc « type » — Conservé tel quel — modifiable sur le site web" | l.112 |
| unknown inline | pill `⟨type⟩` | l.113 |

**Atoms are static images.** `AtomAttachment` is an `NSTextAttachment` whose `image` is produced by `AtomRenderer` into a
2× `NSBitmapImageRep` and cached per (width, dark). There is no `NSTextAttachmentViewProvider`, no live subview, no
in-place interaction: a table cannot be edited in the text, an image cannot be resized, a video does not play. Interaction
is **double-click → `noteDelegate.noteTextView(_:activate:at:)` → `EditorController.activeAtom` → a SwiftUI sheet**
(`AtomEditorSheet`, `AtomEditors.swift:22` `switch atom.node.type`). The bitmap scale is hard-coded to 2 (l.120).

**Commands and toolbar.** Everything goes through `NoteTextView.replace(_:with:select:actionName:)`
(`NoteTextView.swift:239`) or `restyleParagraphs` (l.256): one undo step each, with the view's own `UndoManager`.
`EditorCommands.swift`: `setBlock(_:toggle:)` (l.51) over `BlockKind` (`paragraph, heading(Int), code, bullet,
ordered(start:), task, quote, callout`), `indent`, `outdent`, `moveBlock(up:)`, `toggleMark`, `clearFormatting`,
`setLink`, `insertBlockAtom` (l.239), `insertInlineAtom` (l.258), `replaceAtom` (l.267), `insertRule`, `insertTable`,
`insertBlockMath`, `insertInlineMath`, `insertMention`, `insertImage`, `insertFile`, `insert(_ doc:)`, `insertMarkdown`,
`selectedMarkdown`. The SwiftUI `FormatBar` (`NoteDetailView.swift:196`) and `AppCommands` call these directly and read
`EditorController.selection: SelectionState`. The same command list is written three times: `AppCommands.swift`,
`FormatBar`, and the palette in `CommandPalette.swift`.

**Slash and mention menus.** `Completion.swift`: `builtinSlashItems()` (l.17) returns 14 static entries (text, h1-h3,
bullet, ordered, todo, quote, callout, divider, code, table, math, inline math); the app appends its own through
`NoteTextViewDelegate.noteTextView(_:completionsFor:query:)` — `NoteEditorPane.slashItems()` (`NoteDetailView.swift:128`:
image, file, link to a note, new sub-note, ask the assistant) and `mentionItems(_:)` (l.139: local FTS `quickFind`, plus
"create the note"). The menu is a borderless non-key `NSPanel` (`CompletionPanel`, l.102) with AppKit rows.
Markdown shortcuts at the start of a line: `NoteTextView.applyMarkdownShortcut` (l.396).

**Exactly where to add rendering for a new atom or block type**

For a new **atom** (block or inline) — the minimum, three places:

1. `Editor/AtomAttachment.swift:100` `AtomRenderer.image(for:isBlock:width:)` — a `case "<type>":` returning an image
   (reuse `card`, `pill`, or write a drawer like `table`).
2. `Features/Notes/AtomEditors.swift:22` `AtomEditorSheet.content` — a `case "<type>":` with its SwiftUI editor.
3. Insertion: a method next to `EditorCommands.swift:282-290` built on `insertBlockAtom` / `insertInlineAtom`; an entry in
   `Completion.swift:19` (built-in) or `NoteDetailView.swift:129` (needs app services); menu items in `AppCommands.swift:68`
   and `FormatBar` (`NoteDetailView.swift:232`); the palette.

Plus, when relevant: `NoteTextView.idTypes` (`NoteTextView.swift:346`) if the node takes an id; `ExportComposer.swift:52`
(`switch` for RTF / PDF / print text fallbacks); `AtomAttachment.rendered` l.50 (the "do not cache a placeholder" rule is
written for `image` only — any atom whose rendering depends on an asynchronous resource needs the same);
`AtomRenderer.inlineDescent` (l.95) for inline atoms with a baseline.

For a new **container** (e.g. `aiResult`): `Styler.swift:79` `switch c.type` (indent + `deco.panel`),
`EditorAttributes.swift:80` `ParaDecoration.Panel` (new case), `BlockLayoutFragment.swift:44` (panel colour `switch`),
`EditorTheme` (colour), `EditorCommands.swift:124` `toggleWrapper`, `BlockKind` (l.7) and `selectionState` (l.27),
`NoteTextView.lifted` (l.549) for leaving the container.

For a new **text block** like `runnableCode`: `ParaStyle.isCode` (`EditorAttributes.swift:39`) is tested throughout
`NoteTextView` (Return, Tab, Backspace, `codeBlockRange`), `DocumentCodec` (line joining, l.89), `Styler` and
`Completion`. A second code-like type means generalising `isCode`.

For anything **interactive in place** (a chart that responds, a query view that scrolls, a drawing, a PDF page, a Mermaid
diagram that re-renders, a runnable cell with output): the bitmap model is the wall. It needs
`NSTextAttachmentViewProvider` (hosting an `NSView` / `NSHostingView`) or overlay views positioned from layout fragments.
Neither exists in the codebase; `AtomAttachment` overrides the image and bounds methods only.

### B.3 Design [code]

**Tokens that exist**

- `Components/DesignSystem.swift:7` `enum Palette`: `amber = Color("AccentColor")`, `subtle = Color.primary.opacity(0.06)`,
  `tag(_:)` mapping seven colour names to system colours. That is the whole SwiftUI palette.
- `Resources/Assets.xcassets/AccentColor.colorset`: light sRGB (0.890, 0.520, 0.040), dark (1.000, 0.690, 0.200).
  The catalog holds `AccentColor` and `AppIcon` only.
- `Editor/EditorAttributes.swift:99` `EditorTheme`: `fontSize` 15, `fontDesign` (`system | serif | rounded | monospaced`),
  `lineSpacing` 3, `indentWidth` 26; heading scale 1.75 / 1.4 / 1.18; code font 0.9×; static dynamic `NSColor`s `accent`
  (a second, slightly different amber: light (0.80, 0.45, 0.02)), `link`, `codeBackground`, `inlineCodeBackground`,
  `highlight`, `quoteBar`, `calloutBackground`, `aiBackground`; `tokenColor(_:)` for syntax.
- `Preferences`: `fontSize` (12-22 through the menu), `fontDesign`, `columnWidth` 780.

**What does not exist**: no spacing scale, no radius scale, no typography scale for the chrome, no elevation or material
tokens, no semantic colour roles, no shared button / field / card styles. Spacing and radii are literals in the views
(`padding(12)`, `padding(18)`, `cornerRadius: 5/6/7/8/9`, widths 270 / 330 / 560). Fonts are SwiftUI text styles or
literals (`.system(size: 26, weight: .bold)` for the title). Editor metrics are literals in `Styler` (18, 38, 12) and in
`BlockLayoutFragment`.

**Appearance**: `AppearanceMode` (`system | light | dark`) applied with `.preferredColorScheme` on the main window and
Settings. Editor colours are dynamic `NSColor(name:)` providers. `NoteTextView.viewDidChangeEffectiveAppearance` (l.191)
→ `refreshAtoms()` invalidates the atom bitmaps. `.tint(Palette.amber)`. Materials used: `.ultraThinMaterial` (lock),
`.regularMaterial` (welcome, quick note, toast), `.bar` (status bar), `NSVisualEffectView.material = .menu` (completion).
No increase-contrast or differentiate-without-colour handling (grep: no hit).

**Animations** (complete list, by grep): `.transition(.opacity)` on the welcome view, the palette and the filter bar;
toast `.transition(.move(edge: .bottom).combined(with: .opacity))` with `.animation(.spring(duration: 0.3))`;
`$showFilters.animation()`; `.symbolEffect(.pulse)` on the sync icon. Nothing else: no `withAnimation`, no
`matchedGeometryEffect`, no animated panel open/close (assistant and inspector appear by `if`).

**Reduced motion**: **not handled.** No `accessibilityReduceMotion`, no `NSWorkspace.accessibilityDisplayShouldReduceMotion`.

Language: every user-facing string is a French literal in the Swift source. `developmentLanguage: fr`; no string catalog
or `.strings` file is present in `Resources/`.

### B.4 Navigation and windows [code]

- Scenes (`SPNotesApp.swift`): main `WindowGroup` (default 1180×760), a second `WindowGroup` keyed by note id
  (980×720) that reuses the same `MainWindow` view, `Settings`, `MenuBarExtra` (off by default; three items: quick note,
  open, quit).
- `MainWindow`: one `NavigationSplitView` with three columns — `SidebarView` (190-320), `NoteListView` (240-460),
  `NoteDetailView`. The navigation model is `LibraryModel.selection: SidebarItem` (`list(SmartList) | section(String) |
  folder(String) | tag(String) | unsynced`) plus `WindowModel.selectedNotes`. The detail column can only show a note
  editor or an empty state: there is no router and no notion of a non-note destination (database, graph, tasks, home,
  search results page). `LibraryModel.selection` lives in the shared `LibraryModel`, so **the sidebar selection is shared
  by every window**, while the note selection is per window.
- Sidebar sections: Bibliothèque (all, recent, favourites, pinned, inbox when not empty, unsynced when not empty),
  Espaces (`notes, documents, projects, research` — the server's `databases` section is not listed), Dossiers
  (`OutlineGroup`), Tags, then archives and trash; `SyncStatusBar` at the bottom.
- Inspector and assistant: **not** the SwiftUI `.inspector` modifier. Both are fixed-width columns (270 and 330) appended
  in an `HStack` inside the detail pane (`NoteDetailView.swift:46-47`), not resizable.
- Sheets: account, atom editors, link editor, history, conflict. Overlays in a `ZStack`: lock screen, welcome, command
  palette, toasts.
- Quick note: `QuickNotePanel`, a floating non-activating `NSPanel` hosting SwiftUI with a plain `TextEditor` (not the note
  editor); first line = title; global hot key ⌃⌥⌘N registered through Carbon `RegisterEventHotKey` (no permission needed),
  on by default.
- Commands: see B.1; shortcuts include ⌘N, ⇧⌘N, ⌥⌘N, ⌘O, ⇧⌘P, ⌘S (snapshot), ⇧⌘I (import), ⌘P, ⌥⌘F, ⌘K, ⌥⌘0-3,
  ⇧⌘7/8/9, ⌘]/[, ⌃⌘↑/↓, ⌥⌘I (inspector), ⇧⌘A (assistant), ⌘R (sync), ⌃⌘L (lock), ⌘+/−.
- Deep links (`AppDelegate.swift:10`): `spnotes://note/<uuid>` (or `/p/`), `spnotes://new?text=…`. Nothing else. No
  universal links (the entitlement has `webcredentials:` only, no `applinks:`).
- Services: one, "Nouvelle note SP Notes avec la sélection" (`NSServices` in `Info.plist`, `newNoteFromSelection`).
- File open: `application(_:open:)` imports file URLs through `Exporter.importFiles`. No document types are declared in
  `Info.plist`, so the Finder does not offer the app for any file type.
- Window tabbing allowed; secure restorable state on; a 900 ms launch guard reopens a main window when restoration
  brought none.
- Quit: `applicationShouldTerminate` flushes every session and checkpoints the database before replying.

### B.5 AI features [code]

- Endpoints used: **`POST /api/ai/action`** and **`POST /api/ai/chat`** only (`AssistantPanel.swift:31, 39`).
- UI: one side panel (`AssistantPanel`, 330 pt, ⇧⌘A or the toolbar sparkle, hidden when `preferences.aiEnabled` is off).
  Quick action buttons (a static list of `AIActionKind` values: summarize, rewrite, fix, shorten, …), a Translate menu
  with six languages, a free instruction field (`.custom`), then a question field with a three-way scope picker mapped to
  `AIChatMode`: "Cette note" → `.summarise`, "Toutes mes notes" → `.notes`, "Général" → `.general`.
- Input is the selection or the whole note converted to Markdown (`selectedMarkdown()`), cut to 120 000 characters.
- Output: streamed plain `Text` (Markdown is **not rendered** in the panel), with model name and cost. Actions on the
  result: replace the selection, insert after / into the note (`insertMarkdown`, one undo step), copy, new note, ignore.
  Nothing is written without a click.
- `confirm_expensive` handled both as a thrown error and as a stream event.
- Absent: conversation history (each question is a single turn; `conversationId` is never sent, only a fresh `clientId`),
  model picker (`AIActionRequest.model` / `AIChatRequest.model` never set; `/api/ai/models` has no client), citations
  and sources display, usage view, compare, chat plan, agents, AI over a database, research AI, inline AI in the text
  (no "continue writing" at the caret, no AI block insertion — `aiBlock` is rendered but nothing native creates one).

### B.6 Account and passkeys [code]

- Flow: `WelcomeView` (first launch) or `AccountSheet` → `AccountModel.signIn()` → `AuthService.signIn()` →
  `loginOptions` → system passkey sheet (`ASAuthorizationController`) → `loginVerify` → the session cookie value is stored
  by `HTTPClient` in the keychain. Phases: `local` (fully usable without an account), `signedIn`, `expired` (a session
  ended by the server never erases anything). Store meta keys: `account.everSignedIn`, `account.displayName`.
- Keychain (`AppEnvironment.swift:119`): `KeychainTokenStore(configuration:, service: (bundleIdentifier ?? "ai.spboucher.spnotes") + ".session", useDataProtectionKeychain: false)`,
  account = the server origin, **no access group passed**. So the session token lives in the **legacy file-based login
  keychain**, not the data-protection keychain, and the `keychain-access-groups` entitlement is unused. A share extension
  or widget could not read the token as things stand. In-memory store for tests, UI tests and injected dev sessions.
- Entitlements, Release (`Resources/SPNotes.entitlements`): app sandbox, `network.client`,
  `files.user-selected.read-write`, `print`, `com.apple.developer.associated-domains` = `webcredentials:note.spboucher.ai`,
  application identifier `3YM54G49SN.ai.spboucher.spnotes`, team `3YM54G49SN`, keychain access group
  `3YM54G49SN.ai.spboucher.spnotes`. Debug (`SPNotes-Debug.entitlements`): sandbox, network client, user-selected files,
  print — **no associated domain**, so passkeys cannot work in a Debug build; Debug uses a session minted on the dev server.
- Not in the entitlements: app groups, iCloud, push (`aps-environment`), camera, microphone, calendars, `applinks`.
- The server's AASA lists `3YM54G49SN.ai.spboucher.spnotes` (macOS) and `…spnotes.ios` [doc `BACKEND_CONTRACT.md`].
  The Debug bundle id `ai.spboucher.spnotes.debug` is deliberately different so a dev copy never shadows the installed app.
- `WelcomeView.isInstalled` warns when the app does not run from `/Applications/`.
- Device management UI (`AccountSheet`): list of passkeys (label, "synchronisée"), "add a passkey on this Mac"
  (`auth.addPasskey(label: "Mac · SP Notes")`), list of sessions with "Déconnecter" per other session
  (`withFreshSession { revokeSession }`), "confirm with my passkey" when a purge waits (`stepUp`), sign-out with the choice
  to keep or erase the local copy. Rename and delete of a passkey, and "revoke all sessions", have API methods but no UI
  (the passkey row shows label, "synchronisée" and last use only).
- Local lock (`AppLock`): Touch ID or the Mac password, on launch and/or after N minutes; a screen lock, not encryption.

### B.7 Build, release, tests [code + doc]

**`project.yml`**

- Deployment target macOS 15.0; `SWIFT_VERSION` 6.0; `SWIFT_STRICT_CONCURRENCY: complete`; hardened runtime; team `3YM54G49SN`.
- `MARKETING_VERSION` 1.0.2, `CURRENT_PROJECT_VERSION` 3.
- App target `SPNotes`: sources `App`, `Features`, `Components`, `Resources`; product name "SP Notes"; module `SPNotes`;
  bundle id `ai.spboucher.spnotes` (Debug: `ai.spboucher.spnotes.debug`);
  **`SWIFT_DEFAULT_ACTOR_ISOLATION: MainActor`** and `SWIFT_APPROACHABLE_CONCURRENCY: YES` (app target only).
- Release: manual signing, identity "Developer ID Application", profile specifier **"SP Notes Developer ID"**,
  `--timestamp`, whole-module, universal. Debug: ad hoc (`-`), automatic.
- `SPNotesTests` (hosted unit tests, `Tests/AppTests`, bundle id `…spnotes.tests`), `SPNotesUITests` (`Tests/UITests`,
  `…spnotes.uitests`, hardened runtime off).
- Schemes `SPNotes` (build, test = `SPNotesTests`, archive = Release) and `SPNotesUITests`.
- Packages: `../SPNotesCore` (product `SPNotesCore`) and `.` (product `SPNotesEditor`); the editor package pins
  SwiftMath `exact: "1.7.3"` from GitHub — the only third-party dependency.

**Scripts/**

| Script | What it does | Needs |
|---|---|---|
| `build.sh generate|debug|core-test|app-test|ui-test|run` | xcodegen, Debug build, `swift test` (editor), hosted tests, UI tests; **`run` uses `open`** | `xcodegen`, Xcode; `LINES_MAX` optional |
| `integration-test.sh [--server]` | hosted tests; with `--server` also the end-to-end sync tests | `--server`: SSH to `M4M64c`; passes `TEST_RUNNER_SPNOTES_IT_SERVER` / `TEST_RUNNER_SPNOTES_IT_TOKEN` |
| `dev-session.sh` | opens the tunnel to the dev backend and mints a session; prints `export SPNOTES_SERVER=… SPNOTES_SESSION_TOKEN=…` | `DEV_NODE` (M4M64c), `DEV_DIR` (`dev/note-native`), `DEV_PORT` (8482) |
| `run-dev.sh [--local] [--shot …]` | launches the Debug build against the dev backend in the background; **uses `pkill -f` on the Debug app path and `open`** | a Debug build; `APP` optional |
| `shot.sh`, `window-shot.swift` | captures the app window to a PNG | — |
| `release.sh` | finds the "Developer ID Application" identity in the keychain, installs `Build/SPNotes_Developer_ID.provisionprofile`, xcodegen, archive Release, copies `dist/SP Notes.app` | the identity; the profile file |
| `verify-release.sh [app]` | checks signature, hardened runtime, timestamp, sandbox, associated domain, no debug entitlement, embedded profile, **no WebKit / JavaScriptCore linked, no HTML / JS / CSS resource**, no secret patterns | — |
| `notarize.sh` | notarizes and staples the app, builds / signs / notarizes / staples the DMG, writes the SHA-256 | `NOTARY_PROFILE` (default `MacLustr-Notarize`) |
| `provision.py`, `asc.py` | registers the bundle id, the Associated Domains capability and the Developer ID profile through the App Store Connect API | `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_PATH` (falls back to values read from `maclustr-ios-v2/app/scripts/testflight-archive-upload.sh`) |
| `make-icon.sh` | SVG → AppIcon set, light and dark | `rsvg-convert` |
| `check-headers.sh` | fails when a source file lacks the author header | git |

`verify-release.sh` **fails the release if a web engine is linked or any HTML/JS/CSS file is in the bundle.** Rendering
Mermaid, charts or other content through `WKWebView` breaks this gate; the choice is native renderers or a deliberate
change of that policy.

`release.sh` mixes `build/` and `Build/` paths (the same directory on a case-insensitive volume).
Distribution: DMGs in `dist/` (1.0.0, 1.0.1, 1.0.2). No auto-update: `SPNotesUpdateFeedURL` is empty; Sparkle 2 is the
stated plan [doc `UPDATES.md`].

**Tests** [declarations counted; none run]

| Suite | Count | How |
|---|---|---|
| Editor (`Tests/EditorTests`, SwiftPM) | 30 declared (docs say 31 including the offscreen render) | `swift test` / `Scripts/build.sh core-test` |
| App, hosted (`Tests/AppTests/EndToEndTests.swift`) | 13 (7 without server, 6 with) | `Scripts/integration-test.sh [--server]`; env `SPNOTES_IT_SERVER`, `SPNOTES_IT_TOKEN` |
| UI (`Tests/UITests`) | 2 | `Scripts/build.sh ui-test` |

Launch arguments honoured by the app: `-SPNotesDataDir`, `-SPNotesInMemory`; DEBUG only: `-SPNotesServer` /
`SPNOTES_SERVER` (loopback hosts only), `SPNOTES_SESSION_TOKEN`, `-SPNotesUITest`, `-SPNotesOffline`, `-SPNotesOpen`,
`-SPNotesRoute` (`assistant | inspector | palette | account`), `-SPNotesNoActivate`.

**`TEST_REPORT.md` (1.0.2, 2026-11-18) — verified** [doc]: editor codec round trip on all schema types, typing,
commands, undo, remote apply, pasteboard, completion; a 4 000-block document (load 95 ms, 3.3 ms per keystroke,
serialize 32 ms); hosted tests: autosave, crash safety, organisation, local history, exports, two windows on one note,
5 000-note library (lists 2-3 ms, FTS 4-5 ms); with the dev server: the offline scenario end to end, remote change into
an open editor, merge and conflict on two devices, image upload, trash both ways, "Résumer" streamed; release checks and
notarization (Accepted for app and DMG).

**`TEST_REPORT.md` — NOT verified** [doc]: passkey sign-in in the signed app (Touch ID sheet, domain association);
a real reboot and a physical network cut; **the XCUITests were written and compiled but never executed**; all mouse
interactions (checkbox click, double-click on a table, file drag and drop); window restoration, full screen, multiple
windows on screen; quick note hot key, the Service, `spnotes://` links, the menu bar extra, Quick Look, printing, the
share sheet, the Touch ID lock; assistant actions other than "Résumer" and all questions; server history in the app;
passkey and device lists; a purge pushed to the server; VoiceOver; any other Mac, Intel, macOS 15 or 26 (the x86_64 slice
never ran); Instruments.

So the passkey sign-in — the only way into sync in a release build — has never been confirmed in the shipped app by the
project's own account.

### B.8 Absent natively vs the web — confirmed against code

| Capability | In the macOS code? | Evidence |
|---|---|---|
| Databases (tables, views, properties, rows) | **No.** Database pages show a read-only banner | `NoteSession.swift:37`, `NoteDetailView.swift:90`; rows filtered by the engine; `databases` section not in the sidebar; no API client |
| Graph view, graph API | **No** | no client; no view |
| Backlinks | **No.** The inspector lists *outgoing* links only, computed locally from `document().pageReferences()` (first 12), although its file header says "to and from" | `InspectorPanel.swift:83`; no `backlink` in the app; `PageDetail.backlinks` from `GET /api/pages/{id}` is never requested |
| Tasks view | **No.** Task lists render and toggle inside a note; no cross-note task list | no use of `api.tasks`; no reminder call in the app |
| Reminders | **No UI.** The store table and the engine push exist; the app never creates one | grep `reminder` in App / Features / Components: no hit |
| Inbox triage | **No.** The inbox is a smart list shown when non-empty; no keep / task / archive actions, no undo | `SidebarView.swift:22`; no `triage` / `enqueueOp` in the app |
| Capture (`/api/capture`) | **No** | quick note creates an ordinary page |
| Research (references, papers, experiments, BibTeX) | **No** | "Recherche" is only a page section |
| Semantic / hybrid search | **No.** Local FTS5 only | `api.search` never called |
| AI: model choice, conversations, usage, compare, agents, jobs | **No** | B.5 |
| Dashboard / home | **No** | — |
| Canvas / whiteboard | **No** | — |
| Drawing | **No** native drawing. A PencilKit drawing from iOS is an `image` node + `.pkdrawing` attachment and shows as a picture | data convention in `BACKEND_CONTRACT.md` |
| Voice notes, dictation capture, audio | **No** | no AVFoundation / Speech import; no microphone entitlement |
| PDF viewing in place, PDF annotation | **No.** PDFs are file cards opened in Quick Look | no PDFKit import |
| Mermaid, charts, runnable code, citations, block references, query views | **No** | A.1; shown as unknown-block cards if the web produced them |
| Spotlight indexing | **No** | no CoreSpotlight import |
| Notifications | **No** | no UserNotifications import, no push entitlement |
| App Intents / Shortcuts, widgets, share extension | **No** | no AppIntents / WidgetKit import; no extension target in `project.yml` |
| Handoff / `NSUserActivity` | **No** | grep |
| Universal links | **No** | `webcredentials` only |
| Auto-update | **No** | `UPDATES.md` |
| In-place table editing, image resize, video playback, collapsible details | **No** | B.2 |
| Drag handle per block | **No** (keyboard move ⌃⌘↑/↓ only) | `ARCHITECTURE.md` §5 |
| Real-time collaboration / presence | **No** | no socket; 75 s polling + 2 s debounce |
| Localisation other than French | **No** | B.3 |
| Server-side import/export, settings, audit | **No** | export and import are local (`Exporter.swift`) |

What it does have that is worth keeping: full offline use with no account, durable autosave, local + server history,
conflict UI, attachments with keep-offline and eviction, six export formats and print, command palette, quick note,
local lock, multi-window with shared sessions.

### B.9 Code smells and risks for a large upgrade

**Architecture**

1. **Three implementations of the editing logic.** Core has `Commands.swift` + `InlineCommands.swift` (744 lines,
   tested by 35 command tests). The macOS editor does not call them: `Editor/EditorCommands.swift` and `NoteTextView.swift`
   re-implement lists, indent, split, merge, marks and links directly on `NSTextStorage`. The iOS app
   (`../SPNotes-iOS/Editor/`, 9 files, 2 237 lines: `AttributedCodec`, `EditorStyler`, `EditorLayoutFragment`,
   `AtomRenderer`, `StructureCommands`, …) is a separate editor that does call Core's commands (grep hits in
   `StructureCommands.swift`, `NoteTextView.swift`, `NoteEditorModel.swift`). Every new block type must therefore be
   implemented in Core, in the macOS editor and in the iOS editor, with three renderers. `Package.swift` of the editor
   declares `platforms: [.macOS(.v15)]` and imports AppKit throughout, so it cannot be shared as it is.
2. **Duplicated schema knowledge in the macOS editor**: `NoteTextView.idTypes` and `idAlphabet` / `newBlockID()`
   (l.344-346) copy `Schema.idTypes` and `BlockID.generate()` because `Schema` is `internal` to Core; `Styler.listTypes` /
   `itemTypes` copy `Schema.lists` / `items`; node type names are string literals everywhere in `Editor/` and `Features/`
   instead of `NodeType.*`. A type added to the server's `ID_TYPES` must be changed in two Swift places.
3. **Atoms are bitmaps** (B.2). This is the largest single constraint on mermaid / chart / pdf / drawing / queryView /
   runnable code.
4. **`verify-release.sh` forbids web engines** (B.7), which removes the cheapest way around item 3.
5. **Navigation cannot express non-note destinations** (B.4), and the sidebar selection is global across windows.
6. **The sync engine has no extension seam** (A.4): one 1 014-line actor, hand-written per kind; unknown op kinds are
   dropped as completed and unknown tombstone kinds are ignored, so a client older than the server loses those silently.
7. **Store schema is at version 1**: the migration path has one step and has never been exercised on shipped data.
   A newer file is refused by an older build, so a downgrade after the upgrade means the old app will not open the store
   (`AppEnvironment.swift:130-131` then falls back to an **in-memory store** and records `storeOpenError`).
   **`storeOpenError` is read by no view** (grep: declared and assigned only; the failure goes to `NSLog`). The user would
   see an empty library, and anything typed would be lost at quit. This path needs a blocking error screen before any
   schema migration ships.
8. **Whole-document serialization on every autosave** and whole-block merge granularity: fine for prose, costly and
   conflict-prone for large structured blocks (a big table or a canvas is one block and one JSON value).
9. **No design system** (B.3): a redesign starts from literals in about 20 view files, plus a separate set of colours and
   metrics inside the editor package.

**Concurrency (Swift 6, strict)**

10. The app target compiles with `SWIFT_DEFAULT_ACTOR_ISOLATION: MainActor`; the editor package does not and is annotated
    by hand (`@MainActor` on `DocumentCodec`, `Styler`, `AtomRenderer`, …). Code moved between the two changes isolation
    silently. `Editor/` types reference `SPNotesDocument` value types only, which keeps this manageable.
11. Escape hatches, counted over App / Features / Components / Editor: `nonisolated(unsafe)` 15, `@unchecked Sendable` 6
    (`ParaStyle`, `MarkSet`, `ParaDecoration`, `NodeBox`, `AtomAttachment`, `KeyAllocator`), `MainActor.assumeIsolated` 9.
    They cluster where AppKit calls back from `nonisolated` requirements: the four `NSTextAttachment` overrides
    (`AtomAttachment.swift:54-86`), `textStorage(_:didProcessEditing:)` and `textLayoutManager(_:textLayoutFragmentFor:)`
    (`NoteTextView.swift:202, 224`), the Quick Look data source, the Carbon hot key. `assumeIsolated` traps if TextKit
    ever calls these off the main thread (background layout, printing, or a view provider on another queue). Moving to
    view-based attachments adds more of these callbacks.
12. `AppDelegate.environment` is a static mutable set from `SPNotesApp.init`; `MainWindowOpener.open` and
    `OpenNoteWindow.open` are static closures captured from whichever window appeared last; `ImageCache.shared` and
    `QuickLook.shared` are singletons holding an environment-dependent state. Fragile with several windows and in tests.
13. `GlobalHotKey.actions` is a `nonisolated(unsafe)` static dictionary mutated from `init` and from a
    `DispatchQueue.main.async` in `deinit`.
14. Unstructured tasks: 110 `Task {` occurrences, most fire-and-forget from button closures with no cancellation or
    ordering; `NoteSession.saveNow` handles re-entrancy with a 30 ms sleep-and-retry (`NoteSession.swift:83-85`).
15. `NoteSession.storeChanged()` runs on store change events while `saveNow` may be in flight; correctness rests on
    `lastSavedContent` comparisons and the `isApplying` flag rather than on a serial queue.

**Error handling and robustness**

16. 99 `try?` in the app code: store and network failures in the library, inspector, account and settings paths are
    dropped without a message (e.g. `loadSecurity()` shows empty lists on any error).
17. `AppEnvironment.init` uses `try! NotesStore.inMemory()` as the fallback when the on-disk store cannot be opened.
18. `ASPresentationAnchorFallback.window` creates a bare `NSWindow` as the passkey anchor when no window is visible.
19. `Scripts/run-dev.sh` uses `pkill -f` (it targets the local Debug app path on the laptop; still worth knowing given the
    standing rule against `pkill -f` on shared nodes).

**Code shape**

20. No file is large (the biggest are `NoteTextView.swift` 642 and `EditorCommands.swift` 341), but the code is
    **horizontally dense**: 208 lines longer than 200 characters, the longest 769; many functions are a single line
    with several statements separated by `;`. Worst files: `NoteDetailView.swift` (19 such lines), `AssistantPanel.swift`
    (17), `AccountSheet.swift` (15), `SyntaxHighlighter.swift` (15), `NoteTextView.swift` (13). Diffs and reviews on these
    are harder than the line counts suggest.
21. `NoteDetailView.swift` holds five views (pane, banner, format bar, status bar, plus an extension on `NoteTextView`);
    `AppDelegate.swift` holds six types; `SyncMonitor.swift` also holds `ToastCenter` and `ImageCache`.
22. Duplicates inside the app: `activateAtomBeforeCaret()` (`Completion.swift:38`) and `activateInsertedAtom()`
    (`NoteDetailView.swift:281`) are the same function; the "Untitled → Sans titre" rule is repeated in at least six
    places; the command list exists in three places (B.2).
23. `ParaDecoration.isEqual` (l.91) ignores `struck`, and `hash` uses only `markerX` and `quoteBars.count`.
24. Dead or odd code noticed: `insertBlockAtom` has `let path = style.isCode ? style.path : style.path`;
    `TableEditor` ends with `.disabled(!editable && false)`; `textStorage(_:didProcessEditing:)` contains an empty `if`
    body where the "last paragraph is terminated" invariant was meant to be enforced.
25. Tests do not cover the UI layer: 2 UI tests, never executed; no snapshot tests of the SwiftUI chrome (only the editor
    has an offscreen render).

**Product and ops**

26. Min OS macOS 15 while development and all testing happened on macOS 27 only; iOS 18 for Core.
27. One language, hard-coded.
28. No telemetry, crash reporting or structured logging: grep for Sentry, Crashlytics, MetricKit, `OSLog`, `Logger(`
    returns nothing; the only log call seen is one `NSLog`. Fine for privacy, but there is no field signal after a risky
    migration.
29. Documentation drift inside Core (A.4) and a stale hard-coded user agent in `Scripts/dev-session.sh`
    (`SPNotes/1.0.0`).

---

## Appendix — things I did not verify

- No build, no test run, no app launch. All performance numbers and "green" statements are the projects' own.
- Request / response shapes of the server routes that have no native client (only the route tree was listed).
- `HTMLExport.swift` default branch body; `MarkdownImport.swift` in full; `Commands.swift` in full (signatures only);
  `NotesStore+*.swift` bodies (schema and docs read, method bodies spot-checked); `SyncEngine.swift` l.179-560 and
  l.740-1014 (outlined, with `runQueue`, `pushReminders` and `pull` read in full).
- In the app: the tails of lines longer than 230 characters were cut in my reading (the three that mattered were re-read:
  `AppEnvironment.swift:119`, `AccountSheet.swift:60`, `InspectorPanel.swift:83`). `InspectorPanel`, `NoteListView`, `Exporter`, `SettingsView`,
  `HistoryAndConflicts`, `CommandPalette`, `AttachmentService`, `LibraryModel` were read as outlines (declarations and
  key lines), not line by line.
- `docs/AUDIT.md`, `SECURITY.md`, `INSTALL.md` of the macOS app were not read. `FEATURE_MATRIX.md` was skipped as you
  have it.
- The iOS project was only listed and grepped, to establish the editor duplication.
