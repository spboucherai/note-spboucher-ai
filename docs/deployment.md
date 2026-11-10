# Deployment — Note SPBoucher AI on MacLustr

Target: **M4M64c** (`~/apps/note-spboucher-ai`), public URL **https://note.spboucher.ai** through the MacLustr Tunnel (BHS64 Caddy → WireGuard → M4M64c:8480). Orchestrated by `mld` from the gateway M1M32; manifest `M1M32:~/dispatch/apps/note-spboucher-ai.json`.

## One-time preparation (done 2026-11-01)
1. `brew install postgresql@17 pgvector` on M4M64c, `brew services start postgresql@17`, `listen_addresses = 'localhost'`.
2. Role `note` + database `note_spboucher` with extensions `vector`, `pg_trgm`, `unaccent` (created as the Homebrew superuser; the app role cannot create extensions).
3. Secrets file `M4M64c:~/apps/note-spboucher-ai/.env` (mode 600; template in `.env.example`; copy of record in `~/Desktop/Cluster/secrets/note-spboucher-ai/`). `mld` never overwrites it (`sync_excludes`).
4. Restricted backup key `~/.ssh/note-backup_ed25519` on M4M64c authorised on M3U96b with `restrict,from="192.168.2.103,10.67.0.33"` (exception to the "no private keys on nodes" rule, limited to the offsite rsync; alias `m3u96b-backup`).
5. DNS: `note.spboucher.ai A 51.161.112.61` (GoDaddy) — already present.

## Deploy / update
```bash
# first deployment (laptop)
~/Desktop/cluster-skill/mld stage ~/Desktop/Cluster/projets/note-spboucher-ai note-spboucher-ai
~/Desktop/cluster-skill/mld deploy note-spboucher-ai            # pinned to M4M64c; runs post_sync hooks: pnpm install, build, db:migrate, seed:ai
~/Desktop/cluster-skill/mld adopt note-spboucher-ai             # makes the node folder a git clone (origin spbgit note-spboucher-ai.git)
# then REMOTE-FIRST: edit on the node, pnpm build, pm2 restart note-web note-worker, git commit/push on the node
ssh M4M64c 'cd ~/apps/note-spboucher-ai && pnpm build && pm2 restart note-web note-worker'
```
Owner row + workspace (once): `ssh -t M4M64c 'cd ~/apps/note-spboucher-ai && set -a && . ./.env && set +a && pnpm bootstrap'`. Access gate secrets (since 2026-11-09): `pnpm access:password` (shared password → `ACCESS_PASSWORD_HASH`, also creates `ACCESS_KEY` if missing) and `pnpm access:rotate-key`; restart `note-web` afterwards. See `docs/security.md` → *Access model and rotation*.

## Health and rollback
- Local: `curl http://127.0.0.1:8480/api/health` on the node → `{ ok, db, pgvector }`; public: `curl https://note.spboucher.ai/api/health`.
- `mld status --live`, `mld heal --dry-run`, `mld logs note-spboucher-ai`, `pm2 logs note-web|note-worker`.
- Rollback code: on the node `git checkout <previous-commit> && pnpm build && pm2 restart note-web note-worker` (or `mld move`/`deploy --force` from a previous staging). Rollback schema: `psql $DATABASE_URL -f drizzle/<n>.down.sql` then delete the row from `drizzle.__drizzle_migrations` (see `docs/operations.md`). Data: restore a backup (`scripts/restore.sh`).
- Smoke test after deploy: `NOTE_UNLOCK_URL="$(cat ~/Desktop/Cluster/secrets/note-spboucher-ai/unlock-url)" bash scripts/smoke.sh` (from the laptop; the cookie is `Secure`, so test the public HTTPS URL).
- Public health stays open for `mld heal`: `curl https://note.spboucher.ai/api/health` → 200 without cookie; `/` without cookie → 200 gate page (password field only); `/api/*` without cookie → 401.

## Processes (PM2, via mld)
| Name | Command | Notes |
|---|---|---|
| `note-web` | `node node_modules/next/dist/bin/next start -p 8480 -H 0.0.0.0` | reads `.env`; max 3 GB |
| `note-worker` | `node node_modules/tsx/dist/cli.mjs src/worker/index.ts` | pg-boss queues; nightly backup 03:30 America/Toronto |

`mld heal` (every 5 min on M1M32) restarts missing PM2 processes and repairs the Caddy route/wg1 peer.
