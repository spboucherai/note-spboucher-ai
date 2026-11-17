# Operations runbook — Note SPBoucher AI (v2)

Data ownership, import/export, backups and restore, background worker, search index, offline behaviour. Access (passkeys, sessions, recovery) is in `docs/security.md` §3; deployment and the v1 → v2 upgrade in `docs/deployment.md`. Node: **M4M64c** (`~/apps/note-spboucher-ai`, PostgreSQL 17 via Homebrew `/opt/homebrew/opt/postgresql@17/bin`, uploads in `$DATA_DIR/uploads`), cold copy on **M3U96b** (`~/backups/note-spboucher-ai`, reached through the `m3u96b-backup` SSH alias configured on M4M64c).

## 1. Backups

| What | Value |
|---|---|
| Schedule | pg-boss cron in the worker: `30 3 * * *` **America/Toronto** (registered in `src/worker/index.ts`, queue `backup`). The worker (PM2 `note-worker`) must be running. |
| Script | `scripts/backup.sh` — `pg_dump -Fc --no-owner --no-privileges -N pgboss` + `tar` of `$DATA_DIR/uploads` + `drizzle/` + `manifest.json` → `note-<UTC>.tar` → `openssl enc -aes-256-cbc -pbkdf2 -iter 200000` → `note-<UTC>.tar.enc` + `.tar.enc.sha256` (sha256 of the encrypted file). |
| Local dir | `$BACKUP_DIR` = `/Users/simon-pierreboucher/backups/note-spboucher-ai` on M4M64c (mode 700, archives mode 600). |
| Retention | `$BACKUP_KEEP_DAYS` (default **30**): `.enc` + `.sha256` older than that are deleted locally and on the off-site host after each successful run. |
| Off-site | `$BACKUP_OFFSITE` = `m3u96b-backup:~/backups/note-spboucher-ai/`: `rsync -a --partial` over SSH (BatchMode), then the sha256 is **re-checked on M3U96b**; `backup_jobs.offsite = true` only when that check passes. |
| Record | One `backup_jobs` row per run (`status` queued → running → ok/failed, `path`, `size_bytes`, `sha256`, `offsite`, `error` = script failure or warnings such as "BACKUP_OFFSITE not set"). Shown in Settings → Data → Backups. |
| Passphrase | `BACKUP_PASSPHRASE` lives **only** in the node `.env` (`M4M64c:~/apps/note-spboucher-ai/.env`, mode 600) and in the secrets folder on the laptop (`~/Desktop/Cluster/secrets/note-spboucher-ai/.env`). It is never written to the database, logs, or the archive. Losing it = losing every backup: keep the secrets folder in its usual encrypted place. |

### Manual backup

```bash
# on M4M64c (same environment the worker uses)
cd ~/apps/note-spboucher-ai && set -a && source .env && set +a
bash scripts/backup.sh                # full run: archive, sha256, prune, rsync to M3U96b, remote sha256 check
bash scripts/backup.sh --dry-run      # tools/env/database/offsite reachability only, no archive
bash scripts/backup.sh --no-offsite   # keep it local (e.g. M3U96b unreachable)
```

The script prints **one JSON line on stdout** (`{"path","size","sha256","offsite","durationSec","warnings":[]}`) and logs on stderr; exit status ≠ 0 on any failure (pg_dump, tar, openssl, rsync or remote checksum). From the app: Settings → Data → **Run backup now** (enqueues the same script through the worker). `POST /api/backups {"action":"verify","id":…}` re-hashes the local archive and compares it with the recorded sha256 and the `.sha256` sidecar.

From the laptop (tunnel `127.0.0.1:15432`, Homebrew `pg_dump` 17): `BACKUP_PASSPHRASE=… BACKUP_DIR=/tmp/note-backups DATA_DIR=./data bash scripts/backup.sh` — fine for a one-off copy of the database, but uploads are only complete on the node.

### Restore

`scripts/restore.sh` takes an `.enc` archive and the passphrase (`$BACKUP_PASSPHRASE`, or `--passphrase-env NAME`), checks the `.sha256` sidecar, decrypts, unpacks, then:

```bash
cd ~/apps/note-spboucher-ai && set -a && source .env && set +a
pm2 stop note-web note-worker                     # nothing must write during the restore
bash scripts/restore.sh --latest --yes           # pg_restore --clean --if-exists into $DATABASE_URL + uploads into $DATA_DIR
bash scripts/restore.sh ~/backups/note-spboucher-ai/note-20261101T083000Z.tar.enc --yes --no-uploads   # database only
bash scripts/restore.sh <file.enc> --target-db postgres://note:…@127.0.0.1:5432/note_scratch            # into another database
pm2 start note-web note-worker
```

Flags: `--latest` (newest in `$BACKUP_DIR`), `--no-db`, `--no-uploads`, `--data-dir DIR`, `--dry-run` (integrity check only). Without `--yes` (and without `--target-db`) the script asks you to type `RESTORE`. `pg_restore` errors are counted and printed (`restoreErrors` in the JSON summary). After a restore, search chunks/embeddings are part of the dump; if the archive is older than the uploads on disk, nothing is deleted from `data/uploads` (files are content-addressed by sha256).

Recovering on a fresh Mac: install `postgresql@17` + pgvector (Homebrew), create role `note` + database `note_spboucher` (`CREATE EXTENSION vector, pg_trgm, unaccent`), clone the app, copy `.env` from the secrets folder, `pnpm install`, `scripts/restore.sh <file.enc> --yes`, `pnpm db:migrate` (no-op if the dump already carries the schema), `pm2 start`.

### Restore test (do this monthly and after any PostgreSQL upgrade)

```bash
bash scripts/restore.sh --latest --verify-only
# → {"verified":true,"file":"…","pages":N,"tables":35,"attachments":M,"uploadFiles":K,"restoreErrors":0}
```

`--verify-only` restores into a scratch database **`note_restore_test`**, counts pages/tables/attachment rows, lists the uploads in the tar, then drops the scratch database — production is never touched. The scratch database needs an admin connection: `$RESTORE_ADMIN_URL` if set, else `$DATABASE_URL` with database `postgres` (the `note` role has no CREATEDB, so this usually fails), else the local Unix socket (the Homebrew superuser = the macOS user; this is what works on M4M64c and on the laptop). Verified on 2026-11-01 on both the laptop (through the tunnel + local Homebrew PG) and M4M64c: 35 tables, 2 pages, 0 errors.

### Monitoring

- Settings → Data → Backups: last successful run, size, off-site badge, errors. A failed nightly run leaves a `failed` row with the script's last stderr lines.
- `psql "$DATABASE_URL" -c "select status, started_at, size_bytes, offsite, left(error,80) from backup_jobs order by started_at desc limit 7"`
- Off-site listing: `ssh M3U96b 'ls -la ~/backups/note-spboucher-ai | tail'`
- Worker log: `pm2 logs note-worker` (lines `backup <id> ok …` / `FAIL …`).

## 2. Export (Settings → Data, page menu, or `GET /api/export?format=…`)

| Format | URL | Contents | Lossy? |
|---|---|---|---|
| Workspace ZIP | `/api/export?format=zip` | One `.md` per page with YAML front-matter (`title, id, icon, type, section, tags, created, updated, properties`), folders mirror parents (`<slug>.md` + `<slug>/children…`), databases as `<slug>.csv` + one `.md` per row under `<slug>/`, `attachments/<id8>-<filename>`, `references.bib`, `workspace.json` (manifest with ids, paths, parents, database schemas/rows, attachments, tags, tasks). Mentions and `/p/<id>` links become relative `[Title](../title.md)` links; `/api/files/<id>` images/files become relative `attachments/…` paths. Streamed (jszip, attachments read from disk). | Editor-only nodes are flattened to Markdown (callouts → `> [!NOTE]`, details → `<details>`, AI blocks → `> [!AI]`, math → `$…$` / `$$…$$`), versions, views, relations and knowledge-graph edges are only in `workspace.json`/not included. Hard cap `EXPORT_MAX_BYTES` (default 500 MB, jszip has no zip64): export subtrees (`&pageId=`) or use JSON above that. |
| Subtree ZIP | `/api/export?format=zip&pageId=<id>` | Same layout for one page and its descendants (row pages of databases in the subtree included). | Same as above. |
| JSON backup | `/api/export?format=json[&versions=0]` | `{ format: "note-spboucher-ai/1", exportedAt, workspace, counts, pages, pageVersions, databases, databaseProperties, databaseRows, databaseViews, relations, attachments (metadata), tags, pageTags, tasks, links, knowledgeEdges, references, experiments }` — every content table, raw ProseMirror JSON. | Attachment **files** are not inside (they are in `data/uploads`, covered by `backup.sh`); chunks/embeddings and AI conversations are not included (rebuilt / not content). |
| Markdown (page) | `/api/export?format=md&pageId=<id>` | Front-matter + body; mentions → absolute `APP_URL/p/<id>` links, files → `APP_URL/api/files/<id>`. | Same flattening as the ZIP. |
| PDF (print view) | `/api/export?format=pdf&pageId=<id>[&print=1]` | Self-contained HTML (inline CSS, KaTeX CSS + woff2 fonts inlined only when the page has math, `@page` margins, no external requests → works under the CSP). The browser's Print → Save as PDF produces the PDF; `print=1` opens the dialog automatically. | Layout is the print stylesheet, not the editor's; interactive blocks (details) are expanded. |
| CSV (database) | `/api/export?format=csv&databaseId=<id>` or `&pageId=<database page id>` | `Title, <properties…>, Created, Updated`; select/status/relation values are rendered as labels (`displayValue`). UTF-8 BOM for Excel. | Row bodies, property types/options, views are not in the CSV (use ZIP/JSON). |
| BibTeX | `/api/export?format=bib[&pageId=]` | All references (or those attached to a page) — stored BibTeX when present, otherwise formatted from fields. | — |

## 3. Import (Settings → Data dropzone, or `POST /api/import` multipart `file`, optional `kind`, `parentId`, `sync=1`)

Kind is detected from the extension/MIME. Files ≤ 2 MB of kind markdown/csv/bibtex/docx/pdf are imported in the request (`201 { done:true, pageId, stats }`); everything else (ZIPs, JSON backups, big files) is written to `$DATA_DIR/imports/<jobId>-<name>` and queued (`202 { jobId }`) for the worker; `GET /api/import?jobId=` returns `{ status: queued|running|done|error, progress, message, pageId, stats, error }` (stored in `settings` under `import.<jobId>`). The UI polls every 1.5 s.

| Input | Result | Preserved | Lossy / notes |
|---|---|---|---|
| `.md` / `.markdown` / `.txt` | One page (title from front-matter `title`, else `# H1`, else file name). | Front-matter `icon`, `tags`, `properties` (+ any other scalar keys) → `pages.properties`; `created`/`updated` → timestamps; Notion-style `Key: value` lines under the H1 → properties; headings, lists, task lists, tables, code, quotes, `$…$`/`$$…$$` math; `[[Title]]` / `[[Title\|alias]]` → mention when a page with that title exists (existing or created by the same import), otherwise plain text; `![img](http…)` kept, `![img](relative)` → attachment when the file is in the ZIP. | HTML inside Markdown becomes text; images that cannot be resolved become `[image: alt]`. |
| ZIP of Markdown (Obsidian, our own export) | Page tree: `Foo.md` + `Foo/` → children of Foo; folders without a page get a 📁 page. Two passes: pages are created first, then bodies, so cross-links resolve in any order. `references.bib` inside → references. `workspace.json` is ignored (ids are not reused — re-importing our ZIP creates copies; use the JSON backup for an id-preserving restore). | Hierarchy, front-matter, wiki links and relative `[x](./other.md)` links (→ `/p/<id>`), relative images/attachments (stored once, deduplicated by sha256). | Unreferenced files are ignored (listed in `stats.skipped`); page versions, views, relations are not recreated. |
| Notion export (Markdown & CSV) | Same walker with Notion rules: ` <32-hex>` suffixes stripped from files/folders, the single top-level folder removed, `Name.csv` (or `Name_all.csv`, the filtered twin is skipped) → database, `Name/<Row title>.md` → the row's body, property lines under the H1 → properties/values. | Hierarchy, inline databases (text/number/date/checkbox/url/select inferred from the CSV values; `title` property = first column), row bodies, images. | Notion relations/rollups/formulas become text; comments, icons and covers are not in Notion's export. |
| `.csv` | A database page (section *databases*) + properties per header (types inferred: number, date, checkbox, url, select when few distinct values, else text) + one row page per line (title = first column). Values keyed by property id like the database engine (`parseValue`). | Headers, values, select options. | No row bodies; dates are kept as `YYYY-MM-DD` or ISO. |
| `.docx` | mammoth → HTML → turndown → Markdown → page (section *documents*); embedded images → attachments; the original `.docx` is attached to the page. | Headings, bold/italic/strike, lists, tables (converted to Markdown tables), images. | Fonts, colours, footnotes, comments, tracked changes, text boxes. |
| `.pdf` | Page with the original PDF as a file block, then the extracted text as paragraphs under a `Page N` heading per PDF page; the attachment is indexed for search. | Text layer. | Layout, images; scanned PDFs yield no text (a note is inserted). |
| `.bib` | References (dedupe by DOI then cite key, same rules as the research panel); `parentId` attaches them to that page. | All BibTeX fields (`fields`), raw entry (`bibtex`). | — |
| `.json` (our backup) | Idempotent merge **by id** into the current workspace (`insert … on conflict (id) do update`), for every table above; re-running is safe; nothing is deleted; search is rebuilt (`reindex-all`). | Everything in the JSON including ids, versions, databases, views, relations, links, tags, tasks, references. | Attachment rows are restored but their files must come from `data/uploads` (missing files are counted in `stats.skipped`). Only `note-spboucher-ai/1` is accepted. |

Limits: 500 MB per upload (`/api/import`), 200 MB per attachment elsewhere. Everything imported is audited (`import`, `import.queued`) and indexed asynchronously by the `index-source` queue.

### v2 changes to import and export (2026-11-17)

**Import is now two steps — preview, then confirm.**
1. `POST /api/import?preview=1` (multipart `file`) validates the file, stages it under `$DATA_DIR/imports/` and returns `{ jobId, preview }`: detected kind, what would be created (pages, databases, rows, references, attachments — for both duplicate modes), the page tree (first 400), warnings, and the **duplicates** found: pages by title + SHA-256 of their normalised text, databases by name + row count, DOCX/PDF by file hash, references by DOI then cite key, JSON backups by id.
2. `POST /api/import` `{ jobId, duplicates: "skip" | "import" }` starts it. **Default `skip`**: nothing already present is created again. For a JSON backup, `skip` adds only missing rows; `import` overwrites existing ids and needs a fresh passkey.
- Progress is real (items done / total). Every created item is recorded in a per-job ledger (`settings` keys `import.<jobId>.i.<hash>`), so a retry after a worker restart or a failure **resumes** without creating anything twice. `POST /api/import?retry=<jobId>` retries, `DELETE /api/import?jobId=` cancels or dismisses, `GET /api/import` lists recent jobs (a reload finds them again). A job without progress for 10 minutes is shown as stalled with Retry. The staged file is deleted only when the job is done, dismissed or purged (7 days; unconfirmed previews 24 hours).
- Validation (route, preview and worker): 500 MB per upload; per kind md 20, csv 100, bib 20, docx 100, pdf 200, json 500, zip 500 MB; real type by magic bytes for ZIP/PDF/DOCX; ZIP ≤ 20 000 entries, ≤ 2 GB uncompressed, ≤ 250 MB per entry, compression ratio ≤ 150× beyond 50 MB, no `..`/absolute paths, encrypted and ZIP64 archives refused, symlinks ignored.
- Known limits: the preview of a very large ZIP/JSON is computed in the web request, in memory; ZIP member names stored without the UTF-8 flag may not be matched by the size check (they fall back to the per-entry cap).

**Export says what it did.** The ZIP contains `export-report.json` and the JSON backup a top-level `report`: counts, `complete: true|false`, `notIncluded[]` with the reason (e.g. an attachment whose file is missing on disk), and `byDesign[]` (what the format never carries). Single-file formats return an `x-export-report` header. Whole-workspace ZIP and JSON require a fresh passkey. `workspace.json` now also carries references (with their extracts) and experiments. Every import and export is audited with counts only.

**References.** DOI lookup distinguishes an invalid DOI, an unknown DOI and Crossref being unreachable (retry). All BibTeX tags are kept as written in `references.fields` and the raw entry in `bibtex`; editing a reference rewrites only the tags that changed. Extracts (quote, page, note) live in `references.fields.extracts` and are never written to `.bib`. Optional `CROSSREF_MAILTO` in `.env` identifies the server to Crossref.

**Backups from the app.** Settings → Data & backups → *Run backup now* (`POST /api/backups { action: "run" }`, fresh passkey, refused while one is queued or running) and *Verify* (`{ action: "verify", id }`: re-hashes the local archive against the recorded sha256, the sidecar and the size). Format, passphrase and off-site copy are unchanged from v1.

## 4. Where things live

| Item | Location |
|---|---|
| Backup/restore scripts | `scripts/backup.sh`, `scripts/restore.sh` (bash; BSD/GNU `tar`, `date`, `stat`, `shasum`/`sha256sum`; PostgreSQL tools from `/opt/homebrew/opt/postgresql@17/bin` or `$PATH`) |
| Worker handlers | `src/worker/handlers/backup.ts` (spawns the script, parses the JSON line, updates `backup_jobs`), `src/worker/handlers/import.ts` |
| Export library | `src/lib/export/` (`data.ts` loader + paths, `markdown.ts`, `html.ts`, `csv.ts`, `json.ts`, `zip.ts`) |
| Import library | `src/lib/import/` (`pages.ts` worker-safe writers, `markdown.ts`, `zip.ts`, `csv.ts`, `docx.ts`, `pdf.ts`, `bibtex.ts`, `restore.ts`, `index.ts`) |
| API | `src/app/api/export/route.ts`, `src/app/api/import/route.ts`, `src/app/api/backups/route.ts` |
| UI | `src/components/settings/DataSection.tsx` |
| Env (node `.env`) | `DATABASE_URL`, `DATA_DIR`, `BACKUP_DIR`, `BACKUP_PASSPHRASE`, `BACKUP_OFFSITE`, `BACKUP_KEEP_DAYS`, optional `RESTORE_ADMIN_URL`, `EXPORT_MAX_BYTES` |


## 5. Background worker (`note-worker`)

One process, pg-boss on the same PostgreSQL (`pgboss` schema). Policy per queue (`src/lib/jobs/queues.ts`):

| Queue | Work | Automatic retries | Time limit | Notes |
|---|---|---|---|---|
| `index-source` | chunk + embed one page/file | 4, exponential backoff from 15 s | 5 min | idempotent by content hash; at most one per source per 20 s, an edit inside that window is indexed in the next one (never dropped) |
| `reindex-all` | whole workspace | 1 | 60 min | unchanged content skipped; de-duplicated for 2 min |
| `import-file` | staged import | 1 | 60 min | progress in `settings` `import.<jobId>`; resumable (created items are recorded) |
| `backup` | `scripts/backup.sh` | **none** | 4 h | nightly 03:30 America/Toronto; a failure waits for a human |
| `agent-run` | one agent execution | **none** | 15 min | never re-billed behind your back; status `failed` + error |
| `suggest-links` | AI link suggestions | **none** | 10 min | explicit action only |
| `ai-property` | one AI database cell | 1 | 5 min | |
| `maintenance` | hourly housekeeping | none | 5 min | deletes expired technical rows only (idempotency keys > 48 h, used/expired challenges, login attempts > 30 d, dead sessions > 90 d, inbox journal > 90 d); marks a backup "running" for 6 h as failed/stalled |

A job that exhausts its retries is copied to the `dead-letter` queue (kept 30 days). Each attempt writes one JSON log line (`queue`, `job`, `attempt`, `ms`, outcome) — never payload content.

**Is it alive?** `curl -s https://note.spboucher.ai/api/health` → `"worker":true` (heartbeat younger than 2 minutes, written every 30 s to `settings.worker.heartbeat`). In the app: **Settings → Jobs** (queues, stuck jobs, failures with their error and a Retry button) and **Settings → Indexing**.

### Worker stuck or dead
1. `pm2 status note-worker` ; `pm2 logs note-worker --nostream --lines 50` (look for `"msg":"job failed"`, `timeout`, `pg-boss error`).
2. `pm2 restart note-worker`. Shutdown waits up to 20 s for the running job. A job that was active when the process died is released when its time limit passes, then retried if its queue retries (tested: `tests/unit/jobs.test.ts`); a backup or an agent run is **not** restarted by itself — start it again from the app.
3. Still stuck: Settings → Jobs → *running longer than allowed*; or
   `psql "$DATABASE_URL" -c "select name, state, count(*) from pgboss.job group by 1,2 order by 1,2"` and
   `psql "$DATABASE_URL" -c "select id, name, started_on, retry_count from pgboss.job where state='active' order by started_on"`.
4. Queue tables damaged (very unlikely): stop the worker, `drop schema pgboss cascade`, start the worker (pg-boss recreates it; only pending jobs are lost — content is not in that schema), then Settings → Indexing → *Rebuild everything*.

## 6. Search index

- A page is re-indexed by the worker ~20 s after an edit (passages → `chunks`, vectors → `embeddings`, state → `index_state`). Meaning-based search needs `OPENAI_API_KEY` (embeddings); without it exact-word search still works and the app says semantic search is not configured.
- **Pending / failed** sources are listed in Search → Index and Settings → Indexing. *Index pending* re-queues only those; *Rebuild everything* re-chunks the workspace (unchanged hashes are skipped, so it is cheap to repeat).
- From the shell: `psql "$DATABASE_URL" -c "select count(*) from pages p left join index_state s on s.source_type='page' and s.source_id=p.id where p.deleted_at is null and s.source_id is null"`.
- After a restore: chunks and embeddings are in the dump; nothing to rebuild unless the archive predates recent edits (then *Index pending*).
- Relevance floor: a passage matched by meaning only is shown when its cosine similarity is ≥ `SEARCH_MIN_SEMANTIC` (0.33, `src/lib/search/index.ts`); the assistant uses its own, stricter evidence threshold (`RETRIEVAL.minSemantic` 0.30, `src/lib/ai/chat.ts`). Both are first estimates for `text-embedding-3-small` — if obviously related notes are missing, lower them by 0.03 steps; if unrelated ones appear, raise them.
- Changing the embedding model: update the router constant, deploy, *Rebuild everything* (rows of the old model are counted as "Old model" until replaced; search never mixes models).

## 7. Saves, conflicts, offline, installed app

- **Autosave**: 800 ms after the last keystroke, one request at a time, with the version the edit was based on. States shown next to the title: *Saved · Saving · Offline (kept on this device) · Not saved (Retry) · Conflict*.
- **Conflict** (the same note changed in another session): the server refuses the stale save (`409`), nothing is overwritten, and the note shows *Compare / Keep mine / Keep theirs / Keep both*. Both copies always remain: the discarded one is a version-history entry ("conflict · …"), or a sibling page "… (conflict copy)". Copies that were never the live state appear in the history as *Unapplied copy*.
- **Offline**: the unsent text of a page and captures made offline are stored in the browser (IndexedDB `note-local`) and sent when the network returns — once: captures carry an idempotency key, page saves a base version. Reading notes offline is **not** supported: notes are never cached on the device (only the generic "You are offline" page is).
- **Retention on the device**: until confirmed by the server, 30 days at most; erased by *Lock this device* and by signing out everywhere. Not encrypted (docs/security.md §2).
- **History**: up to 200 entries per page (snapshot at the first change, every 20 saves, every 10 minutes, before a restore, and at each conflict).
- **Installed app (PWA)**: iOS — Safari → Share → *Add to Home Screen*; Android — Chrome's install prompt. The service worker caches only build assets, icons, the manifest and the offline page. After a deployment the app shows *A new version is ready → Reload* and never reloads in the middle of an edit.
- **Nothing is deleted automatically**: the trash keeps pages until *Delete forever* / *Empty trash* / *Delete items older than 30 days* is pressed (each asks for the passkey again).

## 8. Migrations
- Files: `drizzle/NNNN_name.sql` + `drizzle/NNNN_name.down.sql` + `drizzle/meta`. Apply: `pnpm db:migrate` (idempotent). Always `bash scripts/backup.sh` first.
- `0001_v2_passkeys_inbox` (2026-11-17): new tables `auth_enrollments`, `idempotency_keys`, `inbox_actions`; new nullable columns on `pages` (`inbox_at`, `capture_kind`), `sessions`, `webauthn_challenges`, `webauthn_credentials`; revokes the dead v1 sessions; blanks the unused password hash/TOTP of the owner row. No content column is altered. Verified on a copy of the production data (same row counts for pages, versions, attachments, chunks before and after; down + up round trip).
- Rollback: `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f drizzle/<file>.down.sql`, then delete the matching row of `drizzle.__drizzle_migrations` (the command is in the header of each down file).
