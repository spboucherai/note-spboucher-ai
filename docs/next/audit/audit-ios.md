# SP Notes iOS / iPadOS — code audit for "SP Note Next Generation"

Audited: `/Users/simon-pierreboucher/Desktop/Cluster/apple/SPNotes-iOS` (read-only, 2026-11-19). Git: 3 commits, HEAD `b9fadb5`
(`38d74a7` = 1.0.0 (1) code; the two later commits are docs only). Nothing was built or run for this audit: every statement about
test results / TestFlight state is **quoted from the project's docs, not re-verified**. Statements about code are from reading the
sources (line refs given). Items I did not open line by line are marked *(skimmed)*.

Legend: **[V]** verified in code · **[D]** documented by the project, not re-verified · **[U]** unverified / inferred.

---

## 0. Headline facts

- 98 Swift files, 18 667 lines **[V]** (`wc -l`). 5 targets in `project.yml`: `SPNotes` (app), `SPNotesWidgets`, `SPNotesShare`,
  `SPNotesTests`, `SPNotesUITests`.
- Dependencies: local package `../SPNotesCore` (umbrella product `SPNotesCore` = Document + Store + API + Sync; core HEAD `267a673`,
  code commit `b06b1ed`) and SwiftMath 1.7.3 (exact). Nothing else. No web view anywhere (grep `WKWebView|SFSafari` = 0 hits) **[V]**.
- The **`Design/` directory contains only 4 SVG files** (icon sources + mark). It is *not* a token system. Design tokens live in
  `Components/Theme.swift` (80 lines), the asset catalog colour sets, and `EditorTheme` in `Editor/EditorStyler.swift`. **[V]**
- The editor engine is **separate code from macOS** (UIKit here, AppKit there, different type names); only the document model
  (`SPNotesDocument`: `NoteDocument`/`Line`/`Container`/`PMNode`) is shared. See §3.8.
- Every atom (image, table, equation, file, rule, mention…) is drawn as a **static bitmap in an `NSTextAttachment`**; there are no live
  subviews in the text. Interactive editing of an atom always happens in a sheet/cover. See §3.5.

---

## 1. Structure (every directory, every file)

Line counts in brackets. Roles are the file's own header description, shortened, checked against content where I read the file.

### `App/` — entry point, application model, system entry points
| File | Role |
|---|---|
| `SPNotesApp.swift` [54] | `@main`; single `WindowGroup`; `Boot` holds `AppRuntime.result`; `.onOpenURL`, `.onContinueUserActivity` (NoteActivity, Spotlight item, Spotlight query continuation); schedules background tasks on `.background`. |
| `AppDelegate.swift` [46] | `AppRuntime.install()`, `BackgroundSync.register()`, `UNUserNotificationCenterDelegate` (banner in foreground; tap → `pendingRoute = .note`). |
| `AppModel.swift` [390] | The application model (see §2). Also defines `SessionState`, `AppError`, `AppRoute`. |
| `AppConfiguration.swift` [47] | Base URL from `Info.plist` `SPNotesBaseURL`; data dir = App Group container `/SPNotes`; DEBUG env overrides (`SPNOTES_BASE_URL`, `_TOKEN`, `_DATA_DIR`, `_STORE=memory`, `_SEED=1`). |
| `BackgroundSync.swift` [106] | `BGAppRefreshTask` (`…ios.refresh`, ≥30 min) + `BGProcessingTask` (`…ios.sync`, network required, only when `pending > 0`); `BackgroundRun` wraps one run with expiration. |
| `SampleData.swift` [305] | French seeded workspace for UI tests/screenshots. |
| `Intents/AppRuntime.swift` [58] | Process-wide singleton `Result<AppModel, Error>`; starts `SpotlightIndexer`; `rescheduleReminders()`. |
| `Intents/AppRouting.swift` [88] | `NoteActivity` (Handoff type `ai.spboucher.spnotes.ios.openNote`), `AppModel.open(url:)`, `continueActivity`. |
| `Intents/NoteIntents.swift` [125] | 6 App Intents (§6). |
| `Intents/NoteShortcuts.swift` [57] | `SPNotesShortcuts: AppShortcutsProvider` — 5 `AppShortcut`s (README says "four"; code has five: create, append, search, open note, open search). |
| `Intents/QuickNoteActions.swift` [62] | `quickCreate`, `appendText`, `searchNotes`, `noteEntity` on `AppModel`. |
| `Intents/SpotlightIndexer.swift` [142] | `actor SpotlightIndexer` + `SearchIndexing` protocol; capacity 400 notes, 1 000-char excerpt. |

### `Core/` — app-side services (not the shared package)
| File | Role |
|---|---|
| `AttachmentFiles.swift` [147] | Bytes of attachments in the App Group container; streaming SHA-256 import; downsampled images; `source(forAttachmentID:)` = `/api/files/<id>`. |
| `AppLock.swift` [119] | `@Observable` local biometric lock (LocalAuthentication), `UserDefaults` keys `lock.enabled`, `lock.grace` (default 60 s). |
| `NetworkMonitor.swift` [32] | `NWPathMonitor` → `isOnline`, `onReconnect`. |
| `ReminderScheduler.swift` [58] | Mirrors store reminders into `UNUserNotificationCenter`. |

### `Editor/` — the TextKit 2 engine (UIKit), 2 237 lines
| File | Role |
|---|---|
| `EditorController.swift` [798] | The engine: load/save, paragraph identity repair, marks, links, atoms, Enter/Backspace/Tab, undo. Also `UITextViewDelegate`, `NSTextStorageDelegate`, `NSTextLayoutManagerDelegate`. |
| `AttributedCodec.swift` [150] | `NoteDocument` ⇄ `NSAttributedString` (lossless). Holds `blockAtomTypes`. |
| `EditorAttributes.swift` [119] | `LineStyle`, `LineBox`, `MarksBox`, attribute keys, `AtomAttachment`, `EditorCharacter`, `EditorNodeTypes`. |
| `EditorStyler.swift` [232] | `EditorTheme`, `LineGeometry`, `EditorStyler` (fonts/colours/paragraph styles per paragraph, `renumber`). |
| `EditorLayoutFragment.swift` [114] | `NSTextLayoutFragment` subclass drawing list markers, checkboxes, quote bars, callout/code boxes. |
| `AtomRenderer.swift` [283] | Bitmaps for block/inline atoms; `TableGrid`; `MathSource.normalize`; `PMNode` attr helpers. |
| `EditorToolbar.swift` [221] | `UIInputView` formatting bar; `enum EditorAction`. |
| `NoteTextView.swift` [193] | `UITextView` subclass: key commands, paste, tap targets (checkbox / atom / link). |
| `StructureCommands.swift` [127] | List/quote/callout/indent commands computed on the Core document, applied as new `LineStyle`s; `EditorController.Context`. |

### `Features/` — 48 files, 17 folders
| Folder / file | Role |
|---|---|
| `Root/RootView.swift` [118] | Per-window root: welcome vs main, lock overlay, appearance, `pendingRoute` handling, banner. |
| `Root/MainInterface.swift` [178] | Adaptive shell: `CompactShell` (NavigationStack) / `RegularShell` (3-column NavigationSplitView); global sheets, toast, ⌘ shortcuts, `@SceneStorage`. |
| `Root/ShellState.swift` [256] | Per-scene navigation state; `NoteSource`, `NoteSection`, `Destination`, `SidebarItem`, `ShellSheet`, `Toast`. |
| `Root/SidebarView.swift` [158] | iPad sidebar + `NoteDropTarget`. |
| `Root/LockScreen.swift` [51] | Lock screen + `PrivacyCover`. |
| `Home/HomeScreen.swift` [156], `NewNoteButton.swift` [42] | iPhone home (search entry, pinned strip, 6 recents, list entries) + floating button. |
| `Notes/NoteListView.swift` [421] | One list: paging, sort, swipes, context menu, multi-select + bulk, drag/drop, inbox/archive/trash specifics. |
| `Notes/NoteListModel.swift` [169] | Paged summaries + pure arrangement rules. |
| `Notes/NoteActions.swift` [212] | `NoteCommands`, `NoteTransfer`, `NoteTextShare`, `NoteWindow`. |
| `Notes/NoteLinkPicker.swift` [80] | Pick a note → mention. |
| `Folders/FoldersScreen.swift` [142], `FolderTree.swift` [80] | Folder browsing + pure tree functions. |
| `Tags/TagsScreen.swift` [47] | Tag list. |
| `Organize/MoveNoteSheet.swift` [155], `TagEditorSheet.swift` [204] | Move / tag sheets. |
| `Search/SearchScreen.swift` [291], `SearchCriteria.swift` [84] | Local FTS search + filters. |
| `Editor/NoteEditorScreen.swift` [340] | Note screen, "…" menu, states (missing / trashed / database). |
| `Editor/NoteEditorModel.swift` [324] | One open note: load, debounce save, remote refresh, toolbar dispatch, insertions. |
| `Editor/NoteEditorPresentations.swift` [365] | All sheets/covers/dialogs of the note screen; atom tap menu. |
| `Editor/NoteEditorSupport.swift` [240] | Save/sync wording, statistics, export menu, `AppModel` extensions (versions, reminders, keep-offline, `webURL`). |
| `Editor/NoteEditorView.swift` [113] | `UIViewRepresentable` host; title field lives inside the text view's scroll area. |
| `Editor/NativeDocumentView.swift` [111] | Read-only rendering with the editor stack (assistant answers, history, conflicts). |
| `Editor/EditorDropHandler.swift` [115] | `UIDropInteraction` for files/pictures from other apps. |
| `Editor/EditorKeyboardAvoider.swift` [65] | Bottom content inset follows the keyboard. |
| `Editor/Sheets/LinkSheet.swift` [125], `MathEditorSheet.swift` [241], `TableEditorSheet.swift` [240] | Link / LaTeX / table editors. |
| `AI/AssistantProvider.swift` [203] | `AssistantProvider` protocol, `BackendAssistantProvider`, failures, action catalogue. |
| `AI/AssistantModels.swift` [352] | `AssistantActionModel`, `AssistantChatModel`, `AssistantSource`, `AssistantChatScope`. |
| `AI/AssistantSheet.swift` [356], `AssistantChatView.swift` [248] | Assistant UI ("Actions" / "Questions"). |
| `History/NoteHistoryView.swift` [300] | Local restore points + server versions. |
| `Conflicts/ConflictSheet.swift` [262] | Conflict resolution. |
| `Reminders/NoteRemindersView.swift` [200] | Per-note reminders. |
| `Attachments/NoteAttachmentsView.swift` [316], `AttachmentPreview.swift` [74], `MediaPickers.swift` [179], `DocumentScanner.swift` [125] | Files of a note, QuickLook, pickers, VisionKit scanner + Vision OCR. |
| `Drawing/DrawingScreen.swift` [310] | PencilKit full-screen editor. |
| `Export/NoteExporter.swift` [503], `ZipWriter.swift` [354], `ShareSheet.swift` [61] | Exports. |
| `Settings/SettingsScreen.swift` [275], `SecurityScreens.swift` [230] | Settings, passkeys, sessions. |
| `Account/WelcomeScreen.swift` [119], `SignInFailure.swift` [61] | Sign-in. |

There is **no** `Features/Inbox`, `Features/Tasks`, `Features/Databases`, `Features/Graph` folder: the inbox is a `SmartList` case
handled inside `NoteListView`.

### `Components/` — `Theme.swift` [80], `NoteRow.swift` [124], `FolderRow.swift` [41], `SyncIndicator.swift` [210]
### `Shared/` (app + both extensions) — `AppGroup.swift` [16], `DeepLink.swift` [84], `SharedInbox.swift` [83]
### `WidgetShared/` (app + widget ext.) — `NoteEntity.swift` [60], `WidgetDataProvider.swift` [132], `WidgetViews.swift` [294]
### `Widgets/` — `SPNotesWidgets.swift` [75] (bundle, 4 widgets), `WidgetProviders.swift` [88], `Info.plist`, entitlements, privacy manifest
### `ShareExtension/` — `ShareViewController.swift` [40], `ShareView.swift` [206], `ShareContentLoader.swift` [246], `Info.plist`, entitlements, privacy manifest
### `Design/` — `AppIcon.svg`, `AppIcon-Dark.svg`, `AppIcon-Tinted.svg`, `Mark.svg` (vector sources only)
### `Resources/` — `Info.plist`, `Info-Debug.plist` (generated, untracked), `SPNotes.entitlements`, `PrivacyInfo.xcprivacy`, `Assets.xcassets` (16 colour sets, AppIcon, Mark, LaunchMark), `Localizable.xcstrings` (65 keys, 64 with `en`), `AppShortcuts.xcstrings` (10 keys, all `en`)
### `Tests/` — 7 files, 128 `@Test` (§7) · `UITests/` — 3 files, 12 tests
### `Scripts/` — `build.sh`, `release.sh`, `test-live.sh`, `asc.py`, `ExportOptions.plist` (§7)
### `docs/` — `AUDIT.md`, `PARITY_MATRIX.md`, `IMPLEMENTATION_STATUS.md`, `UI_CONVENTIONS.md`, `DISTRIBUTION.md`, `brand/`
### Untracked build output present on disk: `build/`, `dist/export/SP Notes.ipa` (+ `Packaging.log`, `DistributionSummary.plist`)

---

## 2. AppModel / state architecture

### 2.1 Ownership (`App/AppModel.swift`)
`@MainActor @Observable final class AppModel` (l.27–29) owns: `store: NotesStore` (actor, SQLite), `api: NotesAPI`,
`auth: AuthService`, `engine: SyncEngine`, `files: AttachmentFiles`, `lock: AppLock`, `network: NetworkMonitor`,
`reminders: ReminderScheduler`. One instance per process via `AppRuntime.result` (so intents / BG tasks / notification taps and
the UI share it; a second DB connection in-process is never opened).

Observable state: `session` (`signedOut | signedIn | expired`), `syncStatus`, `revision: Int`, `lastChangedPages: Set<String>`,
`ownerName`, `banner: String?`, `pendingRoute: AppRoute?`.

### 2.2 Read path
Screens hold `@Environment(AppModel.self) private var app`, query the store actor directly (`try await app.store.summaries(...)`,
`counts()`, `folderTree()`, `tags()`, `search(...)`, `page(id:)`…), and **reload on `.task(id: app.revision)`**. `revision` is
bumped in `storeDidChange` (l.111–120) for every `StoreChange` from `store.changes()`. There is no per-query observation or diffing:
*any* DB change re-runs every visible screen's queries. Local `@State` holds the results.

### 2.3 Write path
Only through `AppModel` methods (l.182–334) and `extension AppModel` blocks in feature files
(`NoteEditorSupport.swift` l.165–216, `QuickNoteActions.swift`, `AppRuntime.swift`): store call → `didWrite()` →
`engine.schedule()` (or `refreshCounts()` when not signed in). Methods: `createNote`, `save`, `rename`, `setPinned`, `setFavorite`,
`setArchived`, `setTags`, `move`, `trash`, `restore`, `purge`, `duplicate`, `fileInboxItem`, `markOpened`,
`confirmPendingDeletions` (passkey step-up), `attach(fileAt:)`, `attach(data:)`, `deleteAttachment`, `importSharedItems`,
`restoreLocalVersion`, `applyServerVersion`, `addReminder`, `setReminderDone`, `removeReminder`, `setKeepOffline`.

`createNote` (l.186) is the single creation path: it builds a `NewPage` with `section` (default `"notes"`), `properties`
`{"folder":true}` or `{}`, content = ProseMirror JSON. There is **no `type` parameter** — every page created here is a plain page.

### 2.4 Sync / session
`start()` (l.89) spawns three unstructured `Task`s consuming `store.changes()`, `engine.statusUpdates()`,
`api.client.sessionEvents()`. `syncNow()` is a no-op unless `session == .signedIn`. Every store change also calls
`WidgetCenter.shared.reloadAllTimelines()` (l.119).

### 2.5 Per-note state (`Features/Editor/NoteEditorModel.swift`)
`@MainActor @Observable` per open note; owns an `EditorController` and an `EditorToolbar` (`@ObservationIgnored`). Debounced save
600 ms (`markDirty`, l.124); `flush()` on disappear / `willResignActive` with `beginBackgroundTask`; snapshot `reason: "open"` at
load and `"autosave"` every 10 min. `storeChanged()` replaces the editor content only when the stored content differs **and**
nothing is dirty locally. The model communicates UI needs to the screen through a single `request: Request?` enum (l.19–27).

### 2.6 Navigation
- **Per scene**: `RootView` creates `@State private var shell = ShellState()` (one per window).
- **iPhone / compact** (`CompactShell`, `MainInterface.swift` l.121): `NavigationStack(path: $shell.path)` rooted at `HomeScreen`,
  `enum Destination { list(NoteSource), folders, tags, search(String), note(String, isNew:) }`. No tab bar.
- **iPad / regular** (`RegularShell`, l.143): a real **three-column `NavigationSplitView`** — `SidebarView` (260–360 pt) ·
  content column (`NoteListView` or `SearchScreen`, 300–460 pt) · detail (`NoteEditorScreen` or empty state);
  `.navigationSplitViewStyle(.balanced)`. Selection: `shell.sidebar: SidebarItem?`, `shell.selectedNote: String?`.
- Switch is driven by `horizontalSizeClass` (`MainInterface` l.41) with `ShellState.adapt(toCompact:)` (l.231) carrying state both
  ways (Split View / Slide Over / Stage Manager resize).
- State restoration: `@SceneStorage("shell.sidebar")`, `@SceneStorage("shell.note")`.
- External routes: `enum AppRoute { note(String), newNote, search(String) }` set on `app.pendingRoute`, consumed in
  `RootView` l.73–77. **`AppRoute.note` carries a page id only** — no block/heading anchor.

### 2.7 iPad specifics — what exists
- **Multi-window**: `UIApplicationSupportsMultipleScenes = true` (Info.plist); `NoteWindow.open(noteId:)`
  (`NoteActions.swift` l.201) uses `UISceneSessionActivationRequest` with an `NSUserActivity`; offered in the list context menu
  ("Ouvrir dans une nouvelle fenêtre", `NoteListView.swift` l.220). The new window is the *full* three-column shell with that note
  selected — there is no dedicated single-note scene / `WindowGroup(for:)`.
- **Keyboard shortcuts**: shell — ⌘N, ⇧⌘N, ⌘F, ⌘,, ⌘R (invisible buttons, `MainInterface.swift` l.61–73). Editor
  (`NoteTextView.keyCommands`, l.57–80) — Tab/⇧Tab, ⌘B/I/U, ⇧⌘X, ⌘E, ⌘K, ⌥⌘1/2/3/0, ⇧⌘7/8/9. No `.commands {}` menu-bar builder,
  no command palette.
- **Drag & drop**: note rows `.draggable(NoteTransfer)` (custom UTI `ai.spboucher.spnotes.note-reference`); sidebar rows and folder
  rows are `.dropDestination` (move / favourite / archive / trash); list accepts dropped `String`s (l.91: creates a note in that
  source from the text, as Markdown **[V]**); editor accepts files/pictures from other apps (`EditorDropHandler`, `UIDropInteraction`).
- **Pointer**: `UIApplicationSupportsIndirectInputEvents`, toolbar buttons `isPointerInteractionEnabled`.
- Readable column: editor capped at 760 pt (`NoteEditorContent.readableWidth`).
- Not present: inspector column, secondary detail panes, side-by-side notes inside one window, `.commands`, tab bar/`TabView`.

---

## 3. Editor

### 3.1 Architecture in one paragraph
`EditorController` (NSObject, `@MainActor`) owns a `NoteTextView` (UITextView created with `textContainer: nil`, i.e. TextKit 2), an
`AtomRenderer` and an `EditorStyler`. **The `NSTextStorage` is the working document.** Model data rides in custom attributes;
presentation attributes are derived and can always be recomputed. `load(_:)` (l.53) = `AttributedCodec.attributedString(from:)` →
`styler.restyleAll` → `storage.setAttributedString`. `document()` (l.72) = `AttributedCodec.document(from: storage)` +
`ensureBlockIds()`. Save reads the whole storage back each time (debounced 600 ms).

### 3.2 Storage ⇄ `NoteDocument` mapping (`EditorAttributes.swift`, `AttributedCodec.swift`)
The Core document is a **flat list of `Line`** (`path: [Container]`, `type`, `attrs`, `content: .inline([InlineRun]) | .blockAtom(PMNode)`).
- One `Line` = one storage paragraph, **always terminated by `\n`, the last one included**; the caret is clamped before the final
  terminator (`clampSelection`, l.281).
- `.spnLine` → `LineBox` (reference box around `LineStyle { path, type, attrs }`), uniform over the paragraph incl. its newline.
- `.spnMarks` → `MarksBox([PMMark])` on text runs (raw ProseMirror marks; unknown marks preserved, drawn as plain text).
- `.spnOrdinal`, `.spnItemHead` → presentation only (list numbering / which paragraph shows the marker), computed by `renumber`.
- Atoms → one U+FFFC with an `AtomAttachment(node: PMNode, isBlock:)`.
- Soft breaks (hardBreak node, newline inside a code block) → U+2028; a code block is therefore **one paragraph**.
- Paragraph created by Enter: detected in `fixParagraphs` (l.721) because two neighbouring paragraphs share the *same `LineBox`
  instance* (or equal style with an id) → `continuation(of:)` assigns a fresh block id / new sibling list item.
- Block ids: 10-char nanoid-style (`newBlockID`, l.115), assigned when paragraphs are created; `ensureBlockIds()` at save.
- Unknown block nodes: `AttributedCodec.style(forBlockAtom:)` (l.145) tags the storage-only style with `atomMarkerKey`
  (`"\u{1}spnAtom"`) so any node type not in `blockAtomTypes` still round-trips as an atom.
- `blockAtomTypes` (l.84): `image, fileBlock, table, blockMath, horizontalRule, youtube`.
- Container types understood by geometry/drawing: `blockquote`, `callout`, `aiBlock`, `details`, `listItem`, `taskItem`
  (+ list parents `bulletList`, `orderedList`, `taskList`).

### 3.3 How each block renders
| Block | Where | How |
|---|---|---|
| paragraph | `EditorStyler.baseAttributes` l.112 | `.body` Dynamic Type font, `TextPrimary`, line height ×1.12, spacing 7. |
| heading 1–3 | `EditorTheme.heading` l.15 | bold `.title1/.title2/.title3`. |
| code block | styler l.103 + fragment l.58 | scaled monospaced 15, `CodeBackground` rounded box joined across neighbours (`boxKey`), char wrapping, **no syntax colouring**. |
| bullet / ordered / task list | `EditorLayoutFragment.drawDecorations` l.75–104 | marker drawn in the left gutter (28 pt per level): dot (filled/hollow by depth), `n.` in monospaced digits, or a drawn checkbox; checked item text muted + strikethrough. Tap zone `checkboxHitRect()` → `toggleTask`. |
| blockquote | fragment l.70 | 3 pt `QuoteBar` bar per nesting level, secondary text colour. |
| callout / aiBlock / details | `LineGeometry` l.54 + fragment l.58 | `Surface2` rounded box, inset 12. **The callout icon is read but not drawn** (fragment l.65–67, `_ = icon`); `details` has no disclosure control; `detailsSummary` is bold and single-line. |
| footnote | styler l.118 | footnote font, secondary colour. |
| text alignment | styler l.105 | `textAlign` attr honoured (no UI to set it). |

### 3.4 Marks
`bold, italic, underline, strike, code, highlight, link, subscript, superscript` (`EditorStyler.apply(marks:)` l.163).
Order follows the web schema (`EditorController.markOrder`, l.312); `code` excludes other marks; sub/sup mutually exclusive.
Pending marks with an empty selection apply to the next typed characters.

### 3.5 Atoms (`AtomRenderer.swift`)
All rendered with `UIGraphicsImageRenderer` into `attachment.image`; block atoms re-rendered when width or appearance changes
(`relayout(force:)`).
| Atom | Render (`renderBlock` l.49 / `renderInline` l.185) | Tap (`NoteEditorModel.editor(_:didTapAtom:)` l.197) |
|---|---|---|
| `image` | downscaled picture, max height 520, rounded; placeholder + `onMissingImage` download | `atomMenu` dialog: preview, edit drawing (if `drawing-*.png`), recognise text, copy, delete |
| `fileBlock` | chip (icon by mime, name, size) | QuickLook cover |
| `table` | static grid bitmap (header fill, equal columns, scaled down if wider than screen; **plain text only**, via `TableGrid`) | `TableEditorSheet` |
| `blockMath` / `inlineMath` | SwiftMath `MathImage` (fallback chip / pill showing the LaTeX) | `MathEditorSheet` |
| `horizontalRule` | 1.5 pt line | atom menu |
| `youtube` | chip "Vidéo" + URL | atom menu |
| `mention` | accent pill `@label` | `pendingRoute = .note(id)` |
| `footnoteRef` | `[id]` pill | atom menu |
| unknown block | chip "Bloc « type » — Conservé tel quel — modifiable sur le web" | atom menu (copy / delete) |
| unknown inline | `⟨type⟩` pill | atom menu |

**Drawings** are not a node type: a PencilKit drawing = an `image` node (PNG) + a companion `.pkdrawing` attachment found by file
name convention `drawing-<uuid>.png` / `.pkdrawing` (`NoteEditorModel.insertDrawing` l.278, `drawingSource` l.288, `isDrawing` l.296).

### 3.6 Formatting bar (`EditorToolbar.swift`)
`UIInputView` (48 pt, `inputAccessoryView`), horizontally scrollable row: **Insert menu**, **Style menu**, **Assistant**, | B I U S
highlight code | task / bullet / ordered list, outdent, indent (only in lists), quote, link, open-link (only on a link) | undo, redo;
fixed keyboard-dismiss button at the right. State from `EditorController.Context` (`StructureCommands.swift` l.89).
- Style menu (l.157): Texte, Titre 1–3 · Bloc de code, Citation, Encadré · Indice, Exposant.
- Insert menu (l.174): Photo, Prendre une photo, Numériser, Fichier, Dessin · Tableau, Séparateur, Équation, Équation en ligne, Lien vers une note.
- No slash menu, no `@` completion while typing, no Markdown input shortcuts, no block drag handles, no block-level menu for text blocks.

### 3.7 Exactly where to add a new block / atom type
For a new **block atom** (e.g. `databaseView`, `audioNote`, `canvasEmbed`, `pdfBlock`):
1. `Editor/AttributedCodec.swift` l.84 — add the type to `blockAtomTypes` (optional: unknown types already round-trip through `atomMarkerKey`).
2. `Editor/AtomRenderer.swift` l.49 `renderBlock` — add a `case` + a drawing function (bitmap for a given width).
3. `Features/Editor/NoteEditorModel.swift` l.197 `editor(_:didTapAtom:at:)` — add a `case` producing a `Request`; add the case to `enum Request` l.19.
4. `Features/Editor/NoteEditorPresentations.swift` — `enum EditorSheet` l.13 / `EditorCover` l.43, `present(_:)` l.127, `sheetContent` l.181 / `coverContent` l.246; result goes back via `controller.insertBlockAtom(_:)` (l.383) or `controller.updateAtom(at:node:)` (l.415).
5. `Editor/EditorToolbar.swift` — `enum EditorAction` l.11 and the Insert menu l.174; dispatch in `NoteEditorModel.perform(_:)` l.229.
6. Node constructor: Core `PMNode` factory (`PMNode.table(...)`, `.blockMath`, `.image`, `.fileBlock` are Core API — other auditor).
7. Exports: `Features/Export/NoteExporter.swift` (`fallbackText(for:isBlock:)`, the per-format walkers — l.112, 197, 232, 389 reference node types) and `ZipWriter.swift`.
8. Tests: `Tests/EditorTests.swift`, `Tests/EditorRenderingTests.swift` (renders every block to PNG).

For a new **inline atom**: `AtomRenderer.renderInline` l.185, `controller.insertInlineAtom` l.406, tap in `didTapAtom`.

For a new **text block type** (e.g. toggle heading, column): `LineStyle` helpers (`EditorAttributes.swift`), `EditorStyler.baseAttributes`/`paragraphStyle`,
`LineGeometry` (l.49) for indents, `EditorLayoutFragment.drawDecorations` for chrome, `EditorController.setBlockType` l.530
(currently only paragraph/heading/codeBlock), `handleReturn` l.585 / `handleDeleteBackward` l.610, `boxKey` l.793.

For a new **container** (e.g. columns, toggle you can create): Core structure commands (`toggleCallout`-style, used via
`StructureCommands.run`), `LineGeometry`, `boxKey`, `StructureCommands.lift` l.45.

Hard limit to know: an atom is a bitmap. A block that must be **live inside the text** (inline-editable table, embedded
database view, audio player with scrubber, collapsible toggle) needs a new mechanism (`NSTextAttachmentViewProvider` or
overlay subviews); nothing of that kind exists today.

### 3.8 Shared with macOS?
**No — duplicated concept, separate code.** macOS: `../SPNotes/Editor` is a SwiftPM library `SPNotesEditor` (AppKit, macOS 15,
12 files, 2 482 lines) depending only on `SPNotesDocument` + SwiftMath. Same design (paragraph-identity attribute + raw marks +
attachment atoms + custom layout fragment) but different names and extras:

| | iOS (`SPNotes-iOS/Editor`) | macOS (`SPNotes/Editor`) |
|---|---|---|
| Packaging | app sources, internal types | standalone package, `public` API, own test target |
| Paragraph attr | `.spnLine` → `LineBox(LineStyle)` | `.spPara` → `ParaStyle` (keeps a `Line` template) |
| Marks attr | `.spnMarks` → `MarksBox` | `.spMarks` → `MarkSet` |
| Decorations | computed in the fragment from `LineStyle` | precomputed `.spDecoration` → `ParaDecoration` (marker / panel enums, incl. `disclosure`, callout kind+icon, `ai`) |
| Codec | `AttributedCodec` | `DocumentCodec` |
| Engine | `EditorController` + `NoteTextView` | `NoteTextView` (642 lines) + `EditorCommands` |
| Extras absent on iOS | — | `Completion.swift` (completion session/panel), `SyntaxHighlighter.swift`, `NoteFragment.swift` (rich pasteboard fragment), `ExportComposer`, `EditorTheme.FontDesign` (system/serif/rounded/mono) |

Consequence: every new block type must be implemented twice unless a shared rendering/codec layer is extracted. *(macOS side
only skimmed for this comparison.)*

### 3.9 Other editor behaviours worth knowing
- Paste is **plain text only** (`NoteTextView.paste`, l.113); images on the pasteboard become attachments. No rich/Markdown paste.
- Find: system find navigator (`presentFind`, `NoteEditorSupport.swift` l.155), no replace.
- Undo: `UndoManager` with whole-range attributed snapshots (`replace` l.228, `mutateAttributes` l.244).
- `lineIndex(at:)` (l.155) and `paragraphRanges()` are O(document); `renumber` is O(paragraphs) on structural edits;
  `StructureCommands.run` converts the **whole storage to a document** for each list/quote/indent command.
- Read-only reuse: `NativeDocumentView` instantiates the same stack for history / conflict / assistant previews.

---

## 4. Design system

**There is no token layer beyond colours.** What exists:

- **Colours** — asset catalog, light/dark pairs (`Components/Theme.swift` l.9–20 exposes `Color.spBackground`, `.spSurface`,
  `.spSurface2`, `.spBorder`, `.spText`, `.spTextSecondary`, `.spMuted`, `.spDanger`, `.spSuccess`, `.spWarning`; accent = `AccentColor`):

  | Token | Light | Dark |
  |---|---|---|
  | Background | #FBFAF7 | #0E0D0B |
  | Surface | #FFFFFF | #1A1815 |
  | Surface2 | #F3F1EC | #24211C |
  | Border | #E4E0D7 | #34302A |
  | TextPrimary | #1C1A17 | #F4F1EA |
  | TextSecondary | #5E584E | #B5AEA1 |
  | Muted | #8C8578 | #857E72 |
  | AccentColor (amber) | rgb(0.89, 0.52, 0.04) | rgb(1.00, 0.69, 0.20) |
  | Danger / Success / Warning | #C8321F / #2E7D4F / #B26A00 | #FF6B57 / #5CC98A / #FFB84D |
  | CodeBackground / Highlight / QuoteBar | #F3F1EC / #FFE9A8 / #E3A53A | #1F1C18 / #6B5210 / #B8801F |
  | WidgetBackground / LaunchBackground | #FFFDF8 / #FBFAF7 | #1A1815 / #0E0D0B |

  Widgets have their own `WidgetPalette` (`WidgetShared/WidgetViews.swift` l.13).
- **Typography** — system text styles only (no custom fonts, no type-scale constants). Editor fonts in `EditorTheme`
  (`EditorStyler.swift` l.12–37). A few fixed sizes: SF Symbol sizes 40/44 in empty states, widget `34`, PDF chrome `8.5`.
- **Spacing / radii** — literals scattered in views (corner radii 9, 10, 12, 14; paddings 12/16/18/20/28). Editor metrics in
  `EditorTheme`: `listIndent 28`, `quoteIndent 16`, `boxInset 12`, `paragraphSpacing 7`; text inset 12/18/28/18.
- **Materials** — `.regularMaterial` twice (app banner `RootView` l.105, busy overlay `NoteEditorPresentations` l.116);
  `UIBlurEffect(.systemChromeMaterial)` under the formatting bar (made ~opaque with a 0.92 `Surface` tint). The toast is a
  hard-coded dark capsule (`Color(white: 0.13)`). No glass / Liquid-Glass styling, no custom material tokens.
- **Shared components** — `EmptyStateView`, `PrimaryButtonStyle` (50 pt, radius 14), `BrandMark`, `NoteRow`, `FolderRow`,
  `SyncIndicator` / `SyncDetailsSheet`, `SessionExpiredBanner`, `ConflictBanner`.
- **Haptics** — `enum Haptics { tap, success, warning }` (`Theme.swift` l.23); ~12 call sites (move, conflict resolved, assistant
  insert, history restore, list actions, sign-in, reminders, copy atom) + a direct light impact on checkbox toggle.
- **Animations** — minimal: toast spring 0.3 s, banner `.animation(.default)`, lock `.opacity` transition, sync icon
  `.symbolEffect(.pulse)`, chat `withAnimation` scroll. No matched-geometry / zoom transitions, no custom motion tokens.
- **Reduce Motion** — read in exactly one place (`MainInterface.swift` l.15/27, toast). The banner animation and the chat scroll
  animation are not gated.
- **Dynamic Type** — text styles throughout; `adjustsFontForContentSizeCategory` on editor + title; `@ScaledMetric` in table and
  math sheets; editor re-renders atoms on content-size change (`NoteTextView.configure` l.40). Largest sizes: **[D] never checked**.
- **Dark mode** — colour-set pairs; user override `@AppStorage("appearance")` (system / light / dark) via `preferredColorScheme`;
  editor atoms re-rendered on `UITraitUserInterfaceStyle` change; exports forced to light.
- **Localization** — French source; English exists for 64 app strings + shortcuts strings only. Most screens are French-only **[D]+[V by key count]**.
- **Accessibility identifiers** — kebab-case ids on controls used by UI tests.

---

## 5. Features implemented (per `Features/` folder) and backend endpoints

App code never builds URLs itself except `/api/files/<id>` (attachment `src`) and `/p/<id>` (web page link). All HTTP goes through
Core `NotesAPI` / `AuthService` / `SyncEngine`. Endpoint paths below are those named in comments/docs; exact paths inside Core were
not audited here (other auditor) — marked **[U]** where I only have the Swift method name.

| Folder | What it does | Network use |
|---|---|---|
| `Root` | Shell, lock overlay, routing, banner, toast | none |
| `Account` | Welcome + passkey sign-in (`app.signIn()` → `auth.signIn()`, system passkey sheet, RP `note.spboucher.ai`); `SignInFailure` wording; `SessionExpiredBanner` | WebAuthn auth endpoints via `AuthService` **[U paths]** |
| `Home` | iPhone home | local |
| `Notes` | Lists, paging, sort (`modified`/title), swipe, bulk, drag/drop, new window, inbox "Classer" | local; inbox filing enqueues op `triage` `{action:"keep", section}` (`AppModel.fileInboxItem` l.253) pushed by the sync engine |
| `Folders`, `Tags`, `Organize` | Folder tree (folder = page with `properties.folder`), tags, move, tag editor | local |
| `Search` | **Local FTS5 only** (`store.search(query:filters:limit:)`, 150 ms debounce, highlighted title/snippet, filters section/folder/tags/dates/favourite/pinned/archived, recent searches) | none — the server hybrid/semantic search is never called |
| `Editor` | Note screen, toolbar actions, sheets, statistics, find, drop | local; image download via `engine.download(attachmentId:)` |
| `AI` | "Actions": 15 kinds in 3 groups (summarize, explain, toList, actionItems · rewrite, fix, simplify, expand, shorten, formal, translate (6 languages) · outline, toTasks, table, continue) + `custom` instruction; streamed preview, stop, regenerate, expensive-request confirmation; result inserted as Markdown only on user choice. "Questions": chat with modes `notes` (grounded, sources), `summarise`, `actions` (need a synced page), `general`. | `api.aiAction` → `POST /api/ai/action` (SSE); `api.aiChat` → `POST /api/ai/chat` (SSE). Model/provider are **reported** by the server (`AIMeta` → `modelLine`), never chosen by the client. Chat lives for the life of the sheet only (no local persistence; `conversationId` kept in memory). |
| `History` | Local restore points (`store.localVersions`, `restoreVersion`) + server versions | `api.pageVersions(pageID:)`, `api.pageVersion(pageID:version:)` |
| `Conflicts` | Two copies side by side / tabs, 3 choices | `engine.resolveConflict(pageId:choice:)` (server `/resolve` per docs) |
| `Reminders` | Add / done / delete per note; local notifications | local `store.createReminder/updateReminder/deleteReminder`; synced device → server as **tasks** by the engine; no pull of server tasks **[D]** |
| `Attachments` | List per note with state (local / to download / pending upload / failed), QuickLook, share, keep-offline, download, delete, eviction; photo library (PhotosUI), camera, Files importer; VisionKit document scanner; Vision OCR (`VNRecognizeTextRequest`, accurate) | upload/download through the sync engine (`/api/attachments`, `/api/files/<id>` per docs) |
| `Drawing` | Full-screen `PKCanvasView` + `PKToolPicker`, finger toggle, growing canvas, undo; returns `PKDrawing` data + PNG + optional OCR text (4 s timeout) offered — never auto-inserted | none |
| `Export` | Markdown, text, HTML, RTF, paginated PDF, ZIP (own deflate/CRC writer, no ZIP64) | none |
| `Settings` | Account/sign-out (keep or erase local data), app lock + grace period, passkeys (list/add/rename/delete), sessions (list/revoke one/revoke others), sync details, storage, appearance, about/privacy | `api.passkeys()`, `auth.addPasskey(label:)`, `api.renamePasskey`, `api.deletePasskey`, `api.sessions()`, `api.revokeSession`, `api.revokeAllSessions(includeCurrent:false)`; destructive ones wrapped in `auth.withFreshSession` (step-up) |

Other server interactions: `engine.sync()` (change feed `GET /api/sync?since=` + pushes, per docs), `auth.stepUp()` before queued
purges (`confirmPendingDeletions`).

**Inbox today** = list + "Classer" (file to a section) + archive + delete. No AI triage, no suggestions.

---

## 6. System integration

- **Widgets** (`Widgets/SPNotesWidgets.swift`), 4 kinds:
  - `ai.spboucher.spnotes.widget.recent` — small, medium, large, accessoryRectangular (StaticConfiguration)
  - `ai.spboucher.spnotes.widget.pinned` — medium, large
  - `ai.spboucher.spnotes.widget.new` — small, medium, accessoryCircular (links `spnotes://new`, `?kind=tasks`)
  - `ai.spboucher.spnotes.widget.note` — small, medium, large; `AppIntentConfiguration` with `SelectNoteIntent`
  Data: read-only SQLite connection to the shared DB opened per query (`WidgetDataProvider`); single-entry timelines; app calls
  `reloadAllTimelines()` after every store change. No interactive widget buttons (no `Button(intent:)`), no Live Activities,
  no Control Center controls. *(WidgetViews/Providers skimmed.)*
- **App Intents / Siri** (`NoteIntents.swift`): `CreateNoteIntent`, `AppendToNoteIntent`, `SearchNotesIntent` (returns entities),
  `OpenSearchIntent`, `OpenNoteIntent: OpenIntent`, `NewNoteInAppIntent`; `NoteEntity` + query; 5 `AppShortcut`s with French
  phrases; tile colour orange. No "ask my notes" / AI intent, no task intents, no Focus filters.
- **Spotlight**: `SpotlightIndexer` actor, domain `ai.spboucher.spnotes.ios.notes`, ≤400 most recent notes, title + 1 000-char
  excerpt + tags; `CoreSpotlightContinuation = true` (search-in-app continuation → `.search(q)`).
- **Handoff**: `NoteActivity.type` declared in `NSUserActivityTypes`; `fill(...)` helper exists. **The note screen never advertises it**: the
  only `.userActivity(` in the repo is the doc comment at `AppRouting.swift` l.16, so outgoing Handoff is dead code; only the
  incoming continuation is wired **[V by grep]**.
- **Share extension**: `ShareViewController` hosts `ShareView`; `ShareContentLoader` copies file representations to staging;
  activation rule: text, 1 web URL, ≤10 images, ≤10 files. Writes one `SharedItem` folder (`item.json` last, atomic) into
  `<AppGroup>/SPNotes/SharedInbox`; the extension never opens the DB or the network. The app imports at `start()` and on every
  scene activation (`AppModel.importSharedItems`, l.340): link first, text as Markdown, files attached and appended as atoms.
  Shared items become **regular notes in `notes`**, not inbox captures (no `inboxAt` set) **[V]**.
- **Background tasks**: §1 `BackgroundSync`. Identifiers in `BGTaskSchedulerPermittedIdentifiers`; modes `fetch`, `processing`.
- **Notifications**: local only (reminders). No push / APNs entitlement, no remote-notification background mode → no
  server-triggered sync.
- **Deep links** (`Shared/DeepLink.swift`): `spnotes://note/<id>`, `spnotes://new[?kind=tasks][&text=…]`, `spnotes://search?q=…`;
  strict parsing. No universal links (`applinks:` not in entitlements — only `webcredentials:note.spboucher.ai`).
- **App Group** `group.ai.spboucher.spnotes.ios`: `SPNotes/notes.sqlite`, `SPNotes/Attachments/`, `SPNotes/SharedInbox/`.
  Session token is in the Keychain (app only; extensions don't authenticate).
- **App lock** (`Core/AppLock.swift`): `.deviceOwnerAuthentication`, grace period, `LockScreen` overlay + `PrivacyCover` when
  inactive; content `.disabled` + `accessibilityHidden` while locked. Local only; not applied to widgets (widgets show note titles/previews
  regardless of the lock: no lock check in `Widgets/` or `WidgetShared/` **[V by grep]**).
- **Home-screen Quick Actions**: none (`UIApplicationShortcutItems` absent from Info.plist; no `performActionFor` handler).
- **Exported UTI**: `ai.spboucher.spnotes.note-reference`.
- **Orientations**: iPhone portrait + landscape; iPad all four. `SUPPORTS_MACCATALYST = NO`, no "Designed for iPad" on Mac/visionOS.

---

## 7. Build / release

- **Identity**: team `3YM54G49SN`; bundle ids `ai.spboucher.spnotes.ios`, `.ios.widgets`, `.ios.share`, tests `.ios.tests`,
  `.ios.uitests`; `MARKETING_VERSION 1.0.0`, `CURRENT_PROJECT_VERSION 1`; deployment target **iOS 18.0**; devices 1,2;
  Swift 6.0, `SWIFT_STRICT_CONCURRENCY: complete`; `CODE_SIGN_STYLE: Automatic`; `defaultConfig: Release`.
- **App Store Connect** **[D]**: app `6836504456` "SP Notes", SKU `spnotes-ios-001`, fr-CA; build 1.0.0 (1) uploaded 2026-11-18
  (Delivery UUID `aef1245f-7ffe-4912-9cd6-fd45a47d5b35`), `VALID`, `IN_BETA_TESTING`, internal group « Test ». API key
  `L379BDKR69`, issuer `013e761f-e05c-4d93-a50b-f3d960adae4a` (key id + issuer are **hard-coded defaults in `release.sh` and
  `asc.py`**; the `.p8` is outside the repo).
- **Scripts**:
  - `Scripts/build.sh generate|debug|release|test|uitest|core` — `generate` copies `Info.plist` → `Info-Debug.plist`
    (+`NSAllowsLocalNetworking`) then `xcodegen`; `test` = `-only-testing:SPNotesTests`; `uitest` = `-only-testing:SPNotesUITests`
    with result bundle + screenshot export to `build/shots/<sim>`; `core` = `swift test` in `../SPNotesCore`. `SPNOTES_SIM`
    selects the simulator (default `iPhone 17 Pro`). Output is grep-filtered; full logs in `build/logs`.
  - `Scripts/release.sh archive|export|upload|all` — archive Release `generic/platform=iOS` with **`-allowProvisioningUpdates` only
    (Xcode account)** because App Groups cannot be provisioned with the API key; `export` with `ExportOptions.plist`
    (`app-store-connect`, automatic signing) + API key; `upload` = `xcrun altool --upload-app`. Note: `all` does **not** upload.
  - `Scripts/test-live.sh` — SSH tunnel `8482` to M4M64c, mints a dev session token on the node (`~/dev/note-native`,
    `scripts/dev-session.ts`), runs `SPNotesTests/OfflineScenarioTests` with `TEST_RUNNER_SPNOTES_LIVE_URL/_TOKEN`. Dev DB
    `note_native_dev`, never production.
  - `Scripts/asc.py METHOD /v1/...` — minimal ES256 JWT client (openssl).
- **Tests** (counts by `grep '@Test'` / `func test` **[V]**; pass status **[D]**):
  | Target | File | Tests |
  |---|---|---|
  | SPNotesTests (Swift Testing) | `NoteFeatureTests` 33 · `MediaExportTests` 27 · `ShellTests` 24 · `SystemIntegrationTests` 23 · `EditorTests` 19 · `EditorRenderingTests` 1 · `OfflineScenarioTests` 1 (live only) | **128** |
  | SPNotesUITests (XCUITest) | `ShellUITests` 5 · `SystemUITests` 4 · `EditorUITests` 3 | **12** |
  Simulators used: **iPhone 17 Pro** and **iPad Pro 13-inch (M5)**, iOS 26.5 sims, Xcode 27.2 **[D]**. Device-specific UI tests
  `XCTSkip` on the other idiom; some `SystemUITests` use `XCTSkipUnless` on screen content (so "0 failures" can include skips).
  Core: 283 tests on the host **[D]**.
- **Documented as never verified on a physical device** (`docs/IMPLEMENTATION_STATUS.md`): passkey sign-in / step-up / adding a
  passkey; airplane-mode + restart offline scenario; software keyboard + formatting bar on a phone, hardware shortcuts on iPad,
  rotation while editing; camera, scanner, Apple Pencil (tool picker, zoom), cross-app drag & drop; widgets (Home/Lock),
  Siri phrases, Shortcuts, Spotlight results, share sheet; background refresh/processing, reminder notifications; app lock after
  grace period + privacy cover; VoiceOver, largest Dynamic Type; Instruments profiling; assistant streaming and server history
  against production (only fake provider + Core error-path live tests). **In short: build 1.0.0 (1) has not been validated on
  any device.**
- App Store submission material (screenshots, privacy questionnaire, review account) not prepared **[D]**.

---

## 8. Absent vs the web and vs the upgrade brief (confirmed against code)

Grep was run over all non-test sources for each item; "none" = zero relevant hits.

| Capability | State in this app | Evidence |
|---|---|---|
| Databases: table / board / calendar / timeline / gallery / list views | **Absent.** A page with `type == "database"` shows an empty state + "Ouvrir sur le web" (`NoteEditorScreen.swift` l.109–115); excluded from Spotlight, widgets, link picker. No property/row model in app code. | grep `kanban|board|calendar|timeline|gallery` → only `Calendar.current` |
| Knowledge graph / backlinks | **Absent.** Mentions exist as atoms; no backlinks list, no graph view. | grep `graph|backlink` = 0 |
| Global tasks list | **Absent.** Per-note reminders only; task-list checkboxes live inside documents and are not aggregated. | no Tasks feature folder |
| Inbox AI triage | **Absent.** Manual "Classer" only (`triage` op with `action:"keep"`). | `AppModel.swift` l.253 |
| Research workspace (references, BibTeX, experiments) | **Absent.** `research` is just a section name; research pages edit as notes. | `ShellState.swift` l.51 |
| Semantic search | **Absent.** Local FTS5 only; server hybrid search never called. | `SearchScreen.swift` l.150 |
| Ask-my-knowledge with citations linking to **blocks** | **Partial.** Grounded chat with sources exists, but `AssistantSource` = `{n, pageId, title, heading, excerpt}` — **no block id**; sources are de-duplicated per page and a tap only opens the note (`AppRoute.note(id)`); no scroll-to-heading/block, no inline `[n]` citation links. Chat is not persisted. | `AssistantModels.swift` l.166–188; `AssistantChatView.swift` l.221–246 |
| Infinite canvas | **Absent.** Only a bounded, growing PencilKit drawing stored as PNG + `.pkdrawing`. | grep `canvas` → PencilKit only |
| Voice notes + transcription | **Absent.** No `Speech`, `AVAudioRecorder`, `AVAudioEngine`; no microphone usage description in Info.plist. Audio files can only be attached/previewed via QuickLook. | grep = 0 |
| PDF annotation | **Absent.** PDFKit is imported only for thumbnails; preview is read-only QuickLook. | `AttachmentPreview.swift` |
| Handwriting → text | **Partial.** Vision OCR on the *rendered bitmap* of a drawing / image / scan, offered as text to insert. No PencilKit stroke recognition, no Scribble-specific handling, no searchable handwriting index. | `DrawingScreen.swift` l.143–156, `DocumentScanner.swift` l.61–95 |
| Model picker | **Absent.** Server picks; app only displays `model · provider` from the `meta` event. | `AssistantProvider.swift` l.130–135 |
| Agents | **Absent.** | grep `agent` = 0 |
| Knowledge health / daily brief / timeline | **Absent.** | none |
| Command palette | **Absent.** | grep `palette` → `WidgetPalette` only |
| Home-screen Quick Actions | **Absent.** | Info.plist has no `UIApplicationShortcutItems` |
| Stage Manager / multi-window | **Present (basic).** Multiple scenes enabled; "open in new window" opens a second full shell; per-scene `ShellState` + `@SceneStorage`. No dedicated note-only window scene, no `.commands`. Never tested on device. | §2.7 |
| Markdown shortcuts while typing, slash menu, `@` completion | **Absent** (macOS has a completion panel). | §3.6 |
| Syntax highlighting in code blocks | **Absent** on iOS (present in the macOS editor package). | §3.8 |
| In-place table editing | **Absent** (sheet, plain text cells). | `TableEditorSheet.swift` |
| Creating toggles/details, footnotes, YouTube embeds, AI blocks | **Absent** (preserved + displayed only). | §3.3/3.5 |
| Push-triggered sync, universal links, Live Activities, interactive widgets, Focus filters | **Absent.** | §6 |
| Collaboration / sharing / comments | **Absent** (single-owner product). | none |
| End-to-end encryption | **Absent** **[D]**. | status doc |
| Bulk import (Markdown/ZIP/Notion/DOCX) | **Absent** (share extension + attachments only). | parity doc |

---

## 9. Code smells / risks for a large upgrade

**Assumes "everything is a page with a ProseMirror document"**
- `AppModel.createNote` has no page `type`; `NoteEditorScreen` hard-codes three states (missing / trashed / `database`) and treats
  every other type as an editable note. Lists, widgets, Spotlight, link picker each re-implement "is this a note" with string
  compares (`type != "database"`, `isFolder`) in 4 different places (`SpotlightIndexer.isSearchable`,
  `WidgetDataProvider.isNote`, `NoteLinkPicker` l.24, `HomeScreen.load`). New page kinds (canvas, database, voice note, PDF,
  research) will leak into all of them unless a typed page-kind abstraction is introduced first.
- `Destination` / `SidebarItem` / `AppRoute` / `DeepLink` enumerate only list / folders / tags / search / note. Adding
  first-class destinations (tasks, graph, databases, daily brief, a block anchor) touches `ShellState.adapt`, the storage keys,
  `RootView.handle`, `CompactShell`, `RegularShell`, and the widgets' links.
- Sections are a hard-coded string array (`NoteSection.editable`) with string switch for titles/icons.
- Stringly-typed node/mark/container names everywhere in `Editor/` (`"paragraph"`, `"taskItem"`, `"callout"`…) rather than Core
  constants (only `NodeType.paragraph` is used once, in `QuickNoteActions`).

**Editor**
- `EditorController.swift` is the one large file (798 lines) and mixes engine, three delegates, link normalisation and keyboard
  handling. Not unmanageable, but it is the file every new block touches.
- Atoms are bitmaps (see §3.7 hard limit). Tables render plain text at reduced scale when wide; nothing is interactive in place.
- Whole-document conversions on the main actor: every save (`document()`), every structural command (`StructureCommands.run`),
  statistics, assistant context, export. Fine at note size ("3 000 paragraphs load in ~0.1 s" **[D]**), unproven for very long
  documents; no profiling was ever run **[D]**.
- iOS and macOS editors are parallel implementations (§3.8); feature drift already exists (completion, syntax highlighting,
  decorations model). Every new block = two implementations + two export paths.
- Drawings are identified by a **file-name convention** (`drawing-*.png` ↔ `.pkdrawing`) via `alt`/`title` — fragile if the web
  or another client rewrites those attributes.
- Callout icon/kind not drawn on iOS; `toggleCallout` always creates `kind:"info", icon:"💡"`.

**State / observation**
- One global `revision` counter invalidates **all** screens on **any** store change (including the open editor's own 600 ms
  autosave): sidebar counts, folder tree, tags, lists, home all re-query. Cheap today (4 pages in production per the audit doc);
  will need scoped invalidation with real data volumes and with more panes (graph, tasks, databases).
- `WidgetCenter.shared.reloadAllTimelines()` on every store change — i.e. potentially every autosave while typing; WidgetKit
  reload budgets may throttle this **[U — not measured]**.
- `pendingRoute` is a single app-global value observed by every scene's `RootView`; with several windows, which window consumes a
  route is not deterministic **[U — inferred from code, not tested]**. `NoteWindow.activityType` is the same string as
  `NoteActivity.type`, so a "new window" activation is also seen by the `WindowGroup`-level `.onContinueUserActivity` handler in
  `SPNotesApp` (sets `pendingRoute`) *and* by `RootView` (opens in its shell) — possible double handling **[U]**.
- `NoteEditorModel` and `EditorController` are per scene: the same note open in two windows = two independent text storages; the
  second only refreshes when not dirty (`storeChanged`), so concurrent typing in two windows on one device relies on the store's
  last-writer behaviour **[U]**.
- Unstructured `Task {}` everywhere for writes (fire-and-forget; errors surfaced through `banner` / `notice` / `app.attempt`).

**Concurrency escape hatches** (Swift 6 strict): 16 sites — `nonisolated(unsafe)` (3), `MainActor.assumeIsolated` (7),
`@unchecked Sendable` (3: `LineBox`, `MarksBox`, `ImageCache`), `@preconcurrency` delegate conformances (2). Concentrated in
`EditorController` (text storage delegate, undo closures), `BackgroundSync`, `NoteEditorModel`, `DrawingScreen`. Each new UIKit
delegate (audio, PDF, canvas) will need the same pattern.

**AI layer**
- Thin and server-shaped: `AssistantRequest` = `.action | .chat` only; no tool calls, no agent/run concept, no model parameter,
  no persistence of conversations, sources without block anchors. The `AssistantProvider` protocol is a good seam for extension.
- `selectedPlainText()` sends plain text (atoms stripped) — tables/equations/images are invisible to actions on a selection.

**Product / release**
- Nothing has run on a real device; passkey sign-in — the only way into the app — is in that unverified set.
- No push channel: sync happens on activation, on reconnect, on pull-to-refresh/⌘R and in opportunistic BG tasks.
- Reminders/tasks are one-way (device → server).
- Localization debt: ~65 English strings vs a French-only remainder.
- `README` drift: says 4 app shortcuts (code: 5).
- Hard-coded ASC key id / issuer id defaults in scripts (not secrets by themselves, but identifiers in the repo).
- Min iOS 18 while the toolchain is Xcode 27 / iOS 27 SDK: any iOS 26/27-only API (new glass materials, etc.) needs availability
  gates or a deployment-target decision.
- Core API coupling: the app imports the umbrella `SPNotesCore` in 57 files and calls ~48 distinct `store.*` methods directly from
  views; a Core schema change (new entity kinds) ripples widely. `SearchHit` / `Tombstone` name clash between Store and API
  modules already requires qualification.

---

## 10. Not covered / unverified in this audit

- `SPNotesCore` internals (by instruction): exact endpoint paths, sync protocol, store schema, `AIActionRequest`/`AIChatRequest` fields.
- Skimmed only (headers + targeted greps, not line by line): `WidgetViews`, `WidgetProviders`, `WidgetDataProvider`, `ShareView`,
  `ShareContentLoader`, `NoteExporter`, `ZipWriter`, `ConflictSheet`, `NoteHistoryView`, `NoteAttachmentsView`, `MediaPickers`,
  `SettingsScreen`, `SecurityScreens`, `TagEditorSheet`, `MoveNoteSheet`, `FoldersScreen`, `NoteListModel`, `SearchScreen`,
  `AssistantSheet`, `NoteEditorView`, `NativeDocumentView`, `EditorKeyboardAvoider`, sheets, all test bodies, `SampleData`.
- No build, no test run, no simulator: all pass/fail and TestFlight facts are the project's own claims.
- macOS editor compared at the level of file list, package manifest and type declarations only.
