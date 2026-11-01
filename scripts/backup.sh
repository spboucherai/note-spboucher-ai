#!/usr/bin/env bash
# Note SPBoucher AI — encrypted full backup.
#   pg_dump -Fc of $DATABASE_URL + tar of $DATA_DIR/uploads + drizzle/ meta  →  $BACKUP_DIR/note-<UTC>.tar
#   → openssl enc -aes-256-cbc -pbkdf2 -iter 200000 (passphrase: $BACKUP_PASSPHRASE)  →  .tar.enc + .tar.enc.sha256
#   → prune local archives older than $BACKUP_KEEP_DAYS (30)  →  rsync .enc + .sha256 to $BACKUP_OFFSITE (host:path) and verify remotely.
# Prints ONE JSON line on stdout ({"path","size","sha256","offsite","durationSec","warnings":[]}); everything else goes to stderr.
# Exit status is non-zero on any failure (the summary line is still printed when the archive was produced).
# Env: DATABASE_URL (required), BACKUP_PASSPHRASE (required — lives only in the node .env and ~/Desktop/Cluster/secrets/note-spboucher-ai/.env),
#      DATA_DIR (default <root>/data), BACKUP_DIR (default ~/backups/note-spboucher-ai), BACKUP_KEEP_DAYS (30), BACKUP_OFFSITE (optional, e.g. M3U96b:~/backups/note-spboucher-ai).
# Flags: --dry-run (check tools/env/connectivity, no archive), --no-offsite, --no-prune, -h.
set -euo pipefail

DRY_RUN=0; DO_OFFSITE=1; DO_PRUNE=1
for a in "$@"; do case "$a" in
  --dry-run) DRY_RUN=1 ;; --no-offsite) DO_OFFSITE=0 ;; --no-prune) DO_PRUNE=0 ;;
  -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
  *) echo "[backup] unknown argument: $a" >&2; exit 2 ;;
esac; done

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ -z "${DATABASE_URL:-}" && -f "$ROOT/.env" ]]; then set -a; # shellcheck disable=SC1091
  source "$ROOT/.env"; set +a; fi
: "${DATABASE_URL:?DATABASE_URL is required}"
: "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE is required (node .env / secrets folder)}"
DATA_DIR="${DATA_DIR:-$ROOT/data}"; [[ "$DATA_DIR" = /* ]] || DATA_DIR="$ROOT/${DATA_DIR#./}"
BACKUP_DIR="${BACKUP_DIR:-$HOME/backups/note-spboucher-ai}"
BACKUP_KEEP_DAYS="${BACKUP_KEEP_DAYS:-30}"
BACKUP_OFFSITE="${BACKUP_OFFSITE:-}"
export PGCONNECT_TIMEOUT="${PGCONNECT_TIMEOUT:-20}"

log() { echo "[backup] $(date -u +%H:%M:%S) $*" >&2; }
die() { log "ERROR: $*"; exit 1; }
for d in /opt/homebrew/opt/postgresql@17/bin /usr/local/opt/postgresql@17/bin /usr/lib/postgresql/17/bin; do [[ -x "$d/pg_dump" ]] && { PATH="$d:$PATH"; break; }; done
command -v pg_dump >/dev/null || die "pg_dump not found (install postgresql@17 or add it to PATH)"
command -v openssl >/dev/null || die "openssl not found"
command -v tar >/dev/null || die "tar not found"
if command -v sha256sum >/dev/null; then sha256() { sha256sum "$1" | cut -d' ' -f1; }; else sha256() { shasum -a 256 "$1" | cut -d' ' -f1; }; fi
fsize() { if stat -f %z "$1" >/dev/null 2>&1; then stat -f %z "$1"; else stat -c %s "$1"; fi; }
json_escape() { local v; if [[ $# -gt 0 ]]; then v="$1"; else v="$(cat)"; fi; printf '%s' "$v" | sed 's/\\/\\\\/g; s/"/\\"/g'; }

START=$(date +%s); TS=$(date -u +%Y%m%dT%H%M%SZ); NAME="note-$TS"
WARNINGS=()
if [[ $DRY_RUN -eq 1 ]]; then
  log "dry run: pg_dump=$(command -v pg_dump) ($(pg_dump --version | head -1))"
  log "dry run: DATA_DIR=$DATA_DIR ($([[ -d "$DATA_DIR/uploads" ]] && echo "uploads present" || echo "no uploads dir"))"
  log "dry run: BACKUP_DIR=$BACKUP_DIR keep=${BACKUP_KEEP_DAYS}d offsite=${BACKUP_OFFSITE:-none}"
  if command -v psql >/dev/null; then psql "$DATABASE_URL" -tAc "select 'database reachable: ' || current_database() || ' ' || pg_size_pretty(pg_database_size(current_database()))" >&2 || die "database not reachable"; fi
  if [[ -n "$BACKUP_OFFSITE" && $DO_OFFSITE -eq 1 && "$BACKUP_OFFSITE" == *:* ]]; then ssh -o BatchMode=yes -o ConnectTimeout=15 "${BACKUP_OFFSITE%%:*}" true >&2 && log "dry run: offsite host reachable" || WARNINGS+=("offsite host ${BACKUP_OFFSITE%%:*} not reachable"); fi
  WJ=""; for w in "${WARNINGS[@]+"${WARNINGS[@]}"}"; do WJ="$WJ\"$(json_escape "$w")\","; done; WJ="${WJ%,}"
  printf '{"dryRun":true,"path":"%s/%s.tar.enc","size":0,"sha256":"","offsite":%s,"warnings":[%s]}\n' "$BACKUP_DIR" "$NAME" "$([[ -n "$BACKUP_OFFSITE" && $DO_OFFSITE -eq 1 ]] && echo true || echo false)" "$WJ"
  exit 0
fi

mkdir -p "$BACKUP_DIR"; chmod 700 "$BACKUP_DIR" 2>/dev/null || true
WORK=$(mktemp -d "${TMPDIR:-/tmp}/note-backup.XXXXXX"); trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/$NAME"

log "pg_dump → db.dump"
pg_dump -Fc --no-owner --no-privileges -N pgboss -f "$WORK/$NAME/db.dump" "$DATABASE_URL" || die "pg_dump failed"
if [[ -d "$DATA_DIR/uploads" ]]; then log "tar uploads ($(du -sh "$DATA_DIR/uploads" 2>/dev/null | cut -f1))"; tar -cf "$WORK/$NAME/uploads.tar" -C "$DATA_DIR" uploads || die "tar uploads failed"; else WARNINGS+=("no uploads directory at $DATA_DIR/uploads"); fi
if [[ -d "$ROOT/drizzle" ]]; then tar -cf "$WORK/$NAME/drizzle.tar" -C "$ROOT" drizzle || die "tar drizzle failed"; else WARNINGS+=("no drizzle/ directory"); fi
APP_VERSION=$(sed -n 's/^ *"version": *"\([^"]*\)".*/\1/p' "$ROOT/package.json" 2>/dev/null | head -1)
cat > "$WORK/$NAME/manifest.json" <<JSON
{"app":"note-spboucher-ai","version":"${APP_VERSION:-unknown}","name":"$NAME","createdAt":"$(date -u +%Y-%m-%dT%H:%M:%SZ)","host":"$(hostname)","pgDump":"$(pg_dump --version | head -1 | json_escape)","database":"$(json_escape "${DATABASE_URL##*/}")","dbDumpBytes":$(fsize "$WORK/$NAME/db.dump"),"uploadsTarBytes":$([[ -f "$WORK/$NAME/uploads.tar" ]] && fsize "$WORK/$NAME/uploads.tar" || echo 0),"cipher":"aes-256-cbc pbkdf2 iter=200000"}
JSON
tar -cf "$WORK/$NAME.tar" -C "$WORK" "$NAME" || die "tar bundle failed"
ENC="$BACKUP_DIR/$NAME.tar.enc"
log "encrypt → $ENC"
openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -in "$WORK/$NAME.tar" -out "$ENC" -pass env:BACKUP_PASSPHRASE || { rm -f "$ENC"; die "openssl enc failed"; }
chmod 600 "$ENC"
SHA=$(sha256 "$ENC"); printf '%s  %s\n' "$SHA" "$NAME.tar.enc" > "$ENC.sha256"
SIZE=$(fsize "$ENC")
log "archive $SIZE bytes sha256 $SHA"

if [[ $DO_PRUNE -eq 1 ]]; then
  PRUNED=$(find "$BACKUP_DIR" -maxdepth 1 -type f \( -name 'note-*.tar.enc' -o -name 'note-*.tar.enc.sha256' \) -mtime +"$BACKUP_KEEP_DAYS" -print -delete | wc -l | tr -d ' ')
  [[ "$PRUNED" != "0" ]] && log "pruned $PRUNED old file(s) (> ${BACKUP_KEEP_DAYS} days)"
fi

OFFSITE=false; STATUS=0
if [[ -n "$BACKUP_OFFSITE" && $DO_OFFSITE -eq 1 ]]; then
  if [[ "$BACKUP_OFFSITE" == *:* ]]; then
    RHOST="${BACKUP_OFFSITE%%:*}"; RPATH="${BACKUP_OFFSITE#*:}"; RPATH="${RPATH%/}"
    log "rsync → $RHOST:$RPATH"
    if rsync -a --partial -e "ssh -o BatchMode=yes -o ConnectTimeout=20" --rsync-path="mkdir -p $RPATH && rsync" "$ENC" "$ENC.sha256" "$RHOST:$RPATH/" 2>&2 \
       && ssh -o BatchMode=yes -o ConnectTimeout=20 "$RHOST" "cd $RPATH && if command -v sha256sum >/dev/null 2>&1; then sha256sum -c --quiet '$NAME.tar.enc.sha256'; else shasum -a 256 -c -s '$NAME.tar.enc.sha256'; fi" 2>&2; then
      OFFSITE=true; log "offsite copy verified"
      ssh -o BatchMode=yes -o ConnectTimeout=20 "$RHOST" "find $RPATH -maxdepth 1 -type f \( -name 'note-*.tar.enc' -o -name 'note-*.tar.enc.sha256' \) -mtime +$BACKUP_KEEP_DAYS -delete" 2>&2 || WARNINGS+=("offsite prune failed")
    else WARNINGS+=("offsite copy to $BACKUP_OFFSITE failed"); STATUS=1; fi
  else
    mkdir -p "$BACKUP_OFFSITE" && cp "$ENC" "$ENC.sha256" "$BACKUP_OFFSITE/" && OFFSITE=true || { WARNINGS+=("local offsite copy failed"); STATUS=1; }
  fi
else WARNINGS+=("BACKUP_OFFSITE not set — no off-node copy"); fi

WJ=""; for w in "${WARNINGS[@]+"${WARNINGS[@]}"}"; do WJ="$WJ\"$(json_escape "$w")\","; done; WJ="${WJ%,}"
printf '{"path":"%s","size":%s,"sha256":"%s","offsite":%s,"durationSec":%s,"warnings":[%s]}\n' "$(json_escape "$ENC")" "$SIZE" "$SHA" "$OFFSITE" "$(( $(date +%s) - START ))" "$WJ"
exit $STATUS
