#!/usr/bin/env bash
# Post-deploy smoke test — public surface only, no credential needed (v2: access is by passkey, which a script cannot hold).
#   bash scripts/smoke.sh [https://note.spboucher.ai]
# Checks: health, that nothing private answers without a session, that the old entry points are gone, and the PWA shell.
set -u
BASE="${1:-${APP_URL:-https://note.spboucher.ai}}"; fail=0
code() { curl -s -o /dev/null -m 15 -w '%{http_code}' "$@"; }
expect() { local want="$1" got="$2" what="$3"; if [ "$got" = "$want" ]; then echo "ok   $what ($got)"; else echo "FAIL $what: expected $want, got $got"; fail=1; fi; }
health="$(curl -s -m 15 "$BASE/api/health")"; echo "health: $health"
for k in '"ok":true' '"db":true' '"pgvector":true' '"worker":true' '"passkeys":true'; do case "$health" in *"$k"*) echo "ok   health $k";; *) echo "FAIL health lacks $k"; fail=1;; esac; done
expect 303 "$(code "$BASE/")" "home redirects to sign-in"
expect 200 "$(code "$BASE/login")" "sign-in page"
expect 401 "$(code "$BASE/api/tree")" "API refuses anonymous reads"
expect 401 "$(code "$BASE/api/export?format=json")" "export refuses anonymous"
expect 401 "$(code "$BASE/api/files/00000000-0000-0000-0000-000000000000")" "files refuse anonymous"
expect 403 "$(code -X POST -H 'Origin: https://evil.example' "$BASE/api/auth/login/options")" "ceremony refuses a foreign origin"
expect 403 "$(code -X POST -H "Origin: $BASE" -H 'content-type: application/json' -d '{"token":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"}' "$BASE/api/auth/enroll/options")" "enrollment is closed to unknown tokens"
for p in /gate /unlock/abcdefgh /api/gate /api/lock; do expect 404 "$(code "$BASE$p")" "old entry point $p is gone"; done
expect 200 "$(code "$BASE/manifest.webmanifest")" "manifest"; expect 200 "$(code "$BASE/sw.js")" "service worker"; expect 200 "$(code "$BASE/offline")" "offline page"
hdr="$(curl -s -D - -o /dev/null -m 15 "$BASE/login")"
for h in 'strict-transport-security' 'content-security-policy' 'x-content-type-options' 'x-robots-tag'; do echo "$hdr" | grep -qi "^$h:" && echo "ok   header $h" || { echo "FAIL header $h missing"; fail=1; }; done
[ "$fail" = 0 ] && echo "SMOKE OK" || { echo "SMOKE FAILED"; exit 1; }
