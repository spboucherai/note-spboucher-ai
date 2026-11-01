#!/usr/bin/env bash
# Note SPBoucher AI — restore (or test-restore) an encrypted backup produced by scripts/backup.sh.
#   restore.sh <file.tar.enc> | --latest   [--verify-only] [--target-db URL] [--no-uploads] [--no-db] [--data-dir DIR] [--yes] [--dry-run]
#   --verify-only   decrypt + sha256 check + pg_restore into a scratch database `note_restore_test`, count pages, drop it. Never touches prod.
#   --target-db URL restore the database into URL instead of $DATABASE_URL (e.g. a scratch database you created yourself).
#   --yes           required for a real restore into $DATABASE_URL (stop the app + worker first: pm2 stop note-web note-worker).
# Passphrase: $BACKUP_PASSPHRASE (or $RESTORE_PASSPHRASE_ENV naming another variable). Admin connection for the scratch database:
#   $RESTORE_ADMIN_URL if set, else $DATABASE_URL with database `postgres`, else the local Unix socket (Homebrew superuser = current macOS user).
# Prints one JSON summary line on stdout; logs on stderr; exit non-zero on any failure.
set -euo pipefail

FILE=""; LATEST=0; VERIFY=0; TARGET=""; DO_UPLOADS=1; DO_DB=1; YES=0; DRY=0; PASS_ENV="${RESTORE_PASSPHRASE_ENV:-BACKUP_PASSPHRASE}"
while [[ $# -gt 0 ]]; do case "$1" in
  --latest) LATEST=1 ;; --verify-only) VERIFY=1 ;; --target-db) TARGET="$2"; shift ;; --no-uploads) DO_UPLOADS=0 ;; --no-db) DO_DB=0 ;;
  --data-dir) DATA_DIR="$2"; shift ;; --yes) YES=1 ;; --dry-run) DRY=1 ;; --passphrase-env) PASS_ENV="$2"; shift ;;
  -h|--help) sed -n '2,11p' "$0"; exit 0 ;;
  -*) echo "[restore] unknown flag $1" >&2; exit 2 ;;
  *) FILE="$1" ;;
esac; shift; done

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ -z "${DATABASE_URL:-}" && -f "$ROOT/.env" ]]; then set -a; # shellcheck disable=SC1091
  source "$ROOT/.env"; set +a; fi
DATA_DIR="${DATA_DIR:-$ROOT/data}"; [[ "$DATA_DIR" = /* ]] || DATA_DIR="$ROOT/${DATA_DIR#./}"
BACKUP_DIR="${BACKUP_DIR:-$HOME/backups/note-spboucher-ai}"
PASSPHRASE="${!PASS_ENV:-}"
log() { echo "[restore] $(date -u +%H:%M:%S) $*" >&2; }
die() { log "ERROR: $*"; exit 1; }
for d in /opt/homebrew/opt/postgresql@17/bin /usr/local/opt/postgresql@17/bin /usr/lib/postgresql/17/bin; do [[ -x "$d/pg_restore" ]] && { PATH="$d:$PATH"; break; }; done
command -v pg_restore >/dev/null || die "pg_restore not found"; command -v psql >/dev/null || die "psql not found"; command -v openssl >/dev/null || die "openssl not found"
if command -v sha256sum >/dev/null; then sha256() { sha256sum "$1" | cut -d' ' -f1; }; else sha256() { shasum -a 256 "$1" | cut -d' ' -f1; }; fi
export PGCONNECT_TIMEOUT="${PGCONNECT_TIMEOUT:-20}"

if [[ $LATEST -eq 1 ]]; then FILE=$(ls -1t "$BACKUP_DIR"/note-*.tar.enc 2>/dev/null | head -1); [[ -n "$FILE" ]] || die "no note-*.tar.enc in $BACKUP_DIR"; fi
[[ -n "$FILE" ]] || { sed -n '2,11p' "$0" >&2; exit 2; }
[[ -f "$FILE" ]] || die "file not found: $FILE"
[[ -n "$PASSPHRASE" ]] || die "passphrase missing: set $PASS_ENV"
NAME=$(basename "$FILE" .tar.enc)

# 1. integrity of the encrypted archive
if [[ -f "$FILE.sha256" ]]; then
  EXPECTED=$(cut -d' ' -f1 "$FILE.sha256"); ACTUAL=$(sha256 "$FILE")
  [[ "$EXPECTED" == "$ACTUAL" ]] || die "sha256 mismatch: expected $EXPECTED got $ACTUAL"; log "sha256 OK ($ACTUAL)"
else log "no .sha256 sidecar next to the archive — skipping integrity check"; fi

if [[ $DRY -eq 1 ]]; then printf '{"dryRun":true,"file":"%s","verifyOnly":%s,"target":"%s"}\n' "$FILE" "$([[ $VERIFY -eq 1 ]] && echo true || echo false)" "${TARGET:-${DATABASE_URL:-}}"; exit 0; fi

# 2. decrypt + unpack
WORK=$(mktemp -d "${TMPDIR:-/tmp}/note-restore.XXXXXX"); trap 'rm -rf "$WORK"' EXIT
log "decrypt"
PASS_VALUE="$PASSPHRASE" openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in "$FILE" -out "$WORK/$NAME.tar" -pass env:PASS_VALUE || die "decryption failed (wrong passphrase?)"
tar -xf "$WORK/$NAME.tar" -C "$WORK" || die "tar extraction failed"
SRC="$WORK/$NAME"; [[ -f "$SRC/db.dump" ]] || die "db.dump missing inside the archive"
UPLOAD_FILES=0; [[ -f "$SRC/uploads.tar" ]] && UPLOAD_FILES=$(tar -tf "$SRC/uploads.tar" | grep -vc '/$' || true)
log "archive $NAME: db.dump $(wc -c < "$SRC/db.dump" | tr -d ' ') bytes, uploads files: $UPLOAD_FILES, manifest: $(cat "$SRC/manifest.json" 2>/dev/null | head -c 300)"

db_name_of() { local u="${1%%\?*}"; echo "${u##*/}"; }
with_db() { local u="$1" name="$2"; local base="${u%%\?*}" q=""; [[ "$u" == *\?* ]] && q="?${u#*\?}"; echo "${base%/*}/$name$q"; }

# 3a. verify-only: scratch database, count pages, drop
if [[ $VERIFY -eq 1 ]]; then
  TEST_DB="note_restore_test"
  ADMIN=""; TEST_URL=""
  try_admin() { local cand="$1" label="$2"; if [[ -z "$cand" ]]; then [[ "$label" == "unix socket" ]] || return 1; psql -d postgres -tAc "select 1" >/dev/null 2>&1 && { ADMIN="socket"; TEST_URL="$TEST_DB"; log "admin via local unix socket"; return 0; }; return 1; fi
    psql "$cand" -tAc "select 1" >/dev/null 2>&1 && { ADMIN="$cand"; TEST_URL="$(with_db "$cand" "$TEST_DB")"; log "admin via $label"; return 0; }; return 1; }
  try_admin "${RESTORE_ADMIN_URL:-}" "RESTORE_ADMIN_URL" || { [[ -n "${DATABASE_URL:-}" ]] && try_admin "$(with_db "$DATABASE_URL" postgres)" "DATABASE_URL (db postgres)"; } || try_admin "" "unix socket" || die "no admin connection for the scratch database (set RESTORE_ADMIN_URL)"
  adm() { if [[ "$ADMIN" == "socket" ]]; then psql -d postgres -v ON_ERROR_STOP=1 -tAc "$1"; else psql "$ADMIN" -v ON_ERROR_STOP=1 -tAc "$1"; fi; }
  adm "drop database if exists $TEST_DB" >/dev/null || die "cannot drop $TEST_DB"
  adm "create database $TEST_DB" >/dev/null || die "cannot create $TEST_DB (role needs CREATEDB; set RESTORE_ADMIN_URL to a role that has it)"
  cleanup_test() { adm "drop database if exists $TEST_DB" >/dev/null 2>&1 || true; }
  trap 'cleanup_test; rm -rf "$WORK"' EXIT
  log "pg_restore → $TEST_DB"
  RESTORE_LOG="$WORK/restore.log"
  if [[ "$ADMIN" == "socket" ]]; then pg_restore --no-owner --no-privileges -d "$TEST_DB" "$SRC/db.dump" 2>"$RESTORE_LOG" || true; else pg_restore --no-owner --no-privileges -d "$TEST_URL" "$SRC/db.dump" 2>"$RESTORE_LOG" || true; fi
  ERRS=$(grep -c '^pg_restore: error' "$RESTORE_LOG" || true)
  if [[ "$ADMIN" == "socket" ]]; then q() { psql -d "$TEST_DB" -tAc "$1"; }; else q() { psql "$TEST_URL" -tAc "$1"; }; fi
  PAGES=$(q "select count(*) from pages" 2>/dev/null || echo "ERR")
  TABLES=$(q "select count(*) from information_schema.tables where table_schema='public'" 2>/dev/null || echo 0)
  ATT=$(q "select count(*) from attachments" 2>/dev/null || echo 0)
  [[ "$PAGES" != "ERR" ]] || { sed -n '1,20p' "$RESTORE_LOG" >&2; die "restored database has no pages table"; }
  [[ "$ERRS" == "0" ]] || { log "pg_restore reported $ERRS error line(s):"; grep '^pg_restore: error' "$RESTORE_LOG" | head -10 >&2; }
  log "verify OK: $TABLES tables, $PAGES pages, $ATT attachment rows, uploads files in archive: $UPLOAD_FILES"
  printf '{"verified":%s,"file":"%s","pages":%s,"tables":%s,"attachments":%s,"uploadFiles":%s,"restoreErrors":%s}\n' "$([[ "$ERRS" == "0" ]] && echo true || echo false)" "$FILE" "$PAGES" "$TABLES" "$ATT" "$UPLOAD_FILES" "$ERRS"
  [[ "$ERRS" == "0" ]]
  exit $?
fi

# 3b. real restore
TARGET_URL="${TARGET:-${DATABASE_URL:-}}"; [[ -n "$TARGET_URL" ]] || die "no target database (--target-db or DATABASE_URL)"
if [[ -z "$TARGET" && $YES -ne 1 ]]; then
  echo "[restore] This will OVERWRITE database $(db_name_of "$TARGET_URL") and $DATA_DIR/uploads from $NAME. Stop the app first (pm2 stop note-web note-worker)." >&2
  read -r -p "[restore] type RESTORE to continue: " ans; [[ "$ans" == "RESTORE" ]] || die "aborted"
fi
RESTORED_DB=false; RESTORED_UPLOADS=false
if [[ $DO_DB -eq 1 ]]; then
  log "pg_restore --clean --if-exists → $(db_name_of "$TARGET_URL")"
  RESTORE_LOG="$WORK/restore.log"
  pg_restore --clean --if-exists --no-owner --no-privileges -d "$TARGET_URL" "$SRC/db.dump" 2>"$RESTORE_LOG" || true
  ERRS=$(grep -c '^pg_restore: error' "$RESTORE_LOG" || true)
  [[ "$ERRS" == "0" ]] || { log "pg_restore reported $ERRS error line(s):"; grep '^pg_restore: error' "$RESTORE_LOG" | head -20 >&2; }
  PAGES=$(psql "$TARGET_URL" -tAc "select count(*) from pages" 2>/dev/null || echo "ERR"); [[ "$PAGES" != "ERR" ]] || die "database restore failed"
  RESTORED_DB=true; log "database restored: $PAGES pages"
fi
if [[ $DO_UPLOADS -eq 1 && -f "$SRC/uploads.tar" ]]; then
  mkdir -p "$DATA_DIR"; log "uploads → $DATA_DIR/uploads"
  tar -xf "$SRC/uploads.tar" -C "$DATA_DIR" || die "uploads extraction failed"; RESTORED_UPLOADS=true
fi
printf '{"restored":true,"file":"%s","database":%s,"uploads":%s,"pages":%s,"restoreErrors":%s}\n' "$FILE" "$RESTORED_DB" "$RESTORED_UPLOADS" "${PAGES:-null}" "${ERRS:-0}"
log "done. Restart the app (pm2 restart note-web note-worker); the worker re-indexes on demand (search → reindex)."
