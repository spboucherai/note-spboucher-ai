# Deployment — Note SPBoucher AI on MacLustr (v2)

Target: **M4M64c** (`~/apps/note-spboucher-ai`, a git clone — the source of truth), public URL **https://note.spboucher.ai** through the MacLustr Tunnel (BHS64 Caddy → WireGuard → M4M64c:8480). Orchestrated by `mld` from the gateway M1M32; manifest `M1M32:~/dispatch/apps/note-spboucher-ai.json`.

## One-time preparation (done 2026-11-01)
1. `brew install postgresql@17 pgvector` on M4M64c, `brew services start postgresql@17`, `listen_addresses = 'localhost'`.
2. Role `note` + database `note_spboucher` with extensions `vector`, `pg_trgm`, `unaccent` (created as the Homebrew superuser; the app role cannot create extensions).
3. Secrets file `M4M64c:~/apps/note-spboucher-ai/.env` (mode 600; template `.env.example`; copy of record in `~/Desktop/Cluster/secrets/note-spboucher-ai/`). `mld` never overwrites it (`sync_excludes`).
4. Restricted backup key `~/.ssh/note-backup_ed25519` on M4M64c authorised on M3U96b (`restrict,from=…`), alias `m3u96b-backup`.
5. DNS: `note.spboucher.ai A 51.161.112.61` (GoDaddy).
6. Owner row + workspace: `pnpm run bootstrap` (no password is asked: access is by passkey).

## Environment (v2)
`APP_URL=https://note.spboucher.ai` is mandatory and security-relevant: it is the only origin accepted for passkey ceremonies and mutating requests, and its host is the passkey RP ID. Optional `AUTH_RP_ID` (a parent domain of that host — do not set it without a reason: changing the RP ID invalidates every passkey). `AUTH_EXTRA_ORIGINS` is read in development only. The variables of the old access modes are ignored and must be removed after the migration: `ACCESS_KEY`, `ACCESS_PASSWORD_HASH`, `SESSION_SECRET`, `WEBAUTHN_RP_ID`, `WEBAUTHN_ORIGIN`, `OWNER_INITIAL_PASSWORD`.

## Routine update (remote-first, on the node)
```bash
ssh M4M64c
cd ~/apps/note-spboucher-ai && set -a && . ./.env && set +a
git pull --ff-only origin main            # or edit in place
pnpm install --frozen-lockfile
bash scripts/backup.sh                    # before any release that carries a migration
pnpm db:migrate                           # no-op when nothing is pending
pnpm build
pm2 restart note-web note-worker
curl -s http://127.0.0.1:8480/api/health  # { ok, db, pgvector, worker, passkeys }
pnpm auth:status                          # enrollment window must read "closed"
git add -A && git commit -m "…" && git push origin main   # when edited in place
```
Never develop in this folder: use a separate worktree, port and `*_dev` database (docs/dev-conventions.md).

## Upgrading v1.1 → v2.0 (once)
v2 replaces the shared password and the `/unlock/<key>` link by passkeys. **Between step 5 and step 7 nobody can sign in** (data is untouched). Do it when the owner is available with the device that will hold the first passkey.

| # | Step | Command / check |
|---|---|---|
| 1 | Backup, verified | `bash scripts/backup.sh` → note the archive name; `bash scripts/restore.sh --latest --verify-only` → `"verified":true` |
| 2 | Keep the rollback point | `git rev-parse HEAD > ~/note-v1-commit` ; `cp -a .next ~/note-v1-next` (optional, speeds up a rollback) |
| 3 | Get the code | `git fetch origin && git merge --ff-only origin/main` (v2 merged on `main`) ; `pnpm install --frozen-lockfile` |
| 4 | Build while v1 still serves | `pnpm build` (writes `.next`; restart follows immediately) |
| 5 | Migrate + restart | `pm2 stop note-web note-worker && pnpm db:migrate && pm2 restart note-web note-worker` — migration `0001_v2_passkeys_inbox` is additive (new tables/columns), revokes the dead v1 sessions and blanks the unused password hash |
| 6 | Health | `curl -s http://127.0.0.1:8480/api/health` → `ok`, `worker`, `passkeys` all true; `curl -sI https://note.spboucher.ai/` → `303` to `/login`; `/unlock/x` → `404` |
| 7 | First passkey | `pnpm auth:open-enrollment` → open the one-time link on the owner's device → Face ID → signed in (docs/security.md §3.1) |
| 8 | Second passkey | Settings → Security → Add a passkey, on another device |
| 9 | Purge the old access | remove the six obsolete variables from `.env` (list above), `pm2 restart note-web`, delete `~/Desktop/Cluster/secrets/note-spboucher-ai/unlock-url` on the laptop; Settings → Security no longer shows the "old variables" banner |
| 10 | Smoke test | `bash scripts/smoke.sh` (public, no credential needed) |

### Rollback of the v2 upgrade
Code and schema are independent of the content tables, so rollback is safe at any point before or after step 7:
```bash
pm2 stop note-web note-worker
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f drizzle/0001_v2_passkeys_inbox.down.sql
psql "$DATABASE_URL" -c "delete from drizzle.__drizzle_migrations where created_at = 1794934314619"   # exactly the row of 0001 (value from the header of the down file)
git checkout "$(cat ~/note-v1-commit)" && pnpm install --frozen-lockfile && pnpm build   # or: rm -rf .next && cp -a ~/note-v1-next .next
pm2 restart note-web note-worker
```
The v1 gate works again with the `ACCESS_*` values still in `.env` (do **not** delete them — step 9 — until v2 is confirmed). Notes captured in the v2 inbox stay as ordinary notes; passkeys enrolled in v2 are dropped with their columns' table rows untouched (the `webauthn_credentials` table predates v2 and is kept). If anything looks wrong with the data itself, restore the archive of step 1 (`scripts/restore.sh <file> --yes`).

## Health and supervision
- `GET /api/health` (public): `{ ok, db, pgvector, worker, passkeys, version }` — booleans only. `worker:false` = no heartbeat for 2 minutes.
- `mld status --live`, `mld heal --dry-run`, `pm2 logs note-web|note-worker --nostream` (JSON lines: `rid` request id, `sid` session prefix, `job`).
- Settings → Jobs: queues, stuck jobs, failures with Retry. Settings → Indexing: pending / failed sources.

## Processes (PM2, via mld)
| Name | Command | Notes |
|---|---|---|
| `note-web` | `node node_modules/next/dist/bin/next start -p 8480 -H 0.0.0.0` | reads `.env`; max 3 GB; closes any open enrollment window at start |
| `note-worker` | `node node_modules/tsx/dist/cli.mjs src/worker/index.ts` | pg-boss queues; nightly backup 03:30 and hourly housekeeping (America/Toronto); heartbeat every 30 s |

`mld heal` (every 5 min on M1M32) restarts missing PM2 processes and repairs the Caddy route/wg1 peer.
