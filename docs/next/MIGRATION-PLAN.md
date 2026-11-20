# SP Note Next Generation — migration plan

Principle: every step is additive, tested before it runs on real data, and reversible. Production stays up;
nothing is rebuilt from scratch; no existing document is rewritten by a migration.

## 1. Server database (PostgreSQL, `note_spboucher` on M4M64c)

| Migration | Adds | Destroys | Down file | Tested |
|---|---|---|---|---|
| `0003_next_foundation` | `rev` + triggers + tombstones on tasks, databases, properties, views, rows, edges, references, canvases, concepts; `knowledge_events`; graph 2.0 columns; `concepts`, `page_concepts`, `knowledge_insights`; `canvases`; `workspace_id` on database children | nothing | yes | up → down → up on a copy: schema dump after down identical to before (1 251 lines), rows intact |
| `0004_next_ai` | provider columns (`kind`, `base_url`, `key_env`, `label`), `ai_models.creator/route`, `ai_synopses`, `inbox_suggestions`, `audio_transcripts`, `ai_property_runs` | nothing | yes | unit suites on a migrated scratch database |
| `0005_next_productivity` | `database_row_templates`, `database_row_ops`, index `db_rows_db_pos_idx` | nothing | yes | unit suites on a migrated scratch database |

Back-fill done by 0003: one `page.created` event per existing page and one `page.version` per existing
version, all flagged `backfilled` (shown as "reconstructed" in the timeline). No other history is invented.

Behaviour changes on existing data (not schema):
- List items receive a block id the first time a page is indexed or saved (ids are stable across saves).
- Purging a page now also deletes its attachments (unless used elsewhere) and the sub-pages trashed with it;
  live or separately trashed children are kept and moved to the top level.
- Parent cycles are refused (409); malformed ids answer 400 instead of 500; soft-deleted files are no longer served.

### Deployment sequence (production)
1. `scripts/backup.sh` (encrypted, copied off-node) and record the current commit (`~/note-pre-next-commit`).
2. Restore drill of that backup into a throw-away database (`scripts/restore.sh --latest --verify-only`).
3. Rehearsal: restore the same backup into a scratch database, run migrations 0003–0005 on it, run the
   read-only checks (row counts per table before/after, a full `/api/sync` walk, health endpoint).
4. Build the release in a staging directory (never in `~/apps`), then fast-forward `main`, `pnpm db:migrate`,
   swap the build, `pm2 restart note-web note-worker`, `scripts/smoke.sh https://note.spboucher.ai`.
5. Rollback (if any check fails): `pm2 stop`, apply `0005`, `0004`, `0003` down files in that order, check out
   the recorded commit and its build, restart. Data written by 3.0-only features (events, canvases,
   typed relations) is lost by the down files; pages, attachments, tasks and databases are not touched.

Compatibility window: the shipped native apps 1.x keep working against the 3.0 server (the 2.x answer of
`/api/sync` is byte-compatible without `kinds`; they preserve unknown nodes). A voice capture made on the
web appears in a 1.x native app as an "unknown block" card until that app is updated.

## 2. Native local store (SQLite, SPNotesCore schema v1 → v2)

- First migration ever run on shipped data. Purely additive (7 new tables, no v1 table altered),
  transactional, preceded by a backup copy of the database file (`VACUUM INTO`, includes WAL content).
- Tested on a real v1 file written by the shipped 1.0 code: every row and the FTS index identical after
  migration; reopening is idempotent; a failure mid-way rolls back to an intact v1.
- A 1.x build refuses a v2 file: downgrade = restore the `.backup-v1` file (kept 30 days on macOS).
- If the store cannot be opened, the apps now show a blocking error instead of continuing on an in-memory
  store (1.x could silently lose what was typed in that state).
- First sync of a 2.0 app against a 3.0 server re-reads the whole feed once (the cursor is tied to the set
  of entity kinds).

## 3. Clients

- Web: one deployment; the editor now refuses to autosave a document it cannot fully parse (read-only mode),
  so an older cached client can no longer blank a page that contains newer blocks.
- Web offline replica: IndexedDB `note-local` v1 → v2 (adds the replica and the mutation journal; existing
  drafts and the capture outbox are kept). Wiped on lock/sign-out as before.
- macOS 1.0.2 → 2.0.0 and iOS 1.0.0 → 2.0.0: in-place update, same bundle ids, same passkeys and sessions.
  macOS moves the session token to the data-protection keychain when the signed build has the access group
  (read old → copy → verify → delete old, falling back to the old item).

## 4. Order

Server first (it serves both 1.x and 2.0 clients), then the native apps. Never the reverse: a 2.0 app against
a 2.x server behaves like 1.0 (features are gated on `/api/meta`), but nothing new is available.
