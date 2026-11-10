#!/usr/bin/env bash
# Post-deploy smoke test: health, gate, unlock, page create/update, search, AI action (one cheap call), lock.
# Usage: NOTE_URL=https://note.spboucher.ai NOTE_UNLOCK_URL="$(cat ~/Desktop/Cluster/secrets/note-spboucher-ai/unlock-url)" bash scripts/smoke.sh
# (the access cookie is Secure: run against the public HTTPS URL)
set -euo pipefail
URL=${NOTE_URL:-https://note.spboucher.ai}; UNLOCK=${NOTE_UNLOCK_URL:?NOTE_UNLOCK_URL required}
J=$(mktemp); trap 'rm -f $J' EXIT
step() { printf '%-28s' "$1"; }
step "health"; curl -fsS "$URL/api/health" | grep -q '"ok":true' && echo OK
step "gate without cookie"; curl -fsS "$URL/" | grep -q 'name="password"' && echo OK
step "api without cookie → 401"; [ "$(curl -s -o /dev/null -w '%{http_code}' "$URL/api/tree")" = "401" ] && echo OK
step "bookmark unlock"; [ "$(curl -s -c "$J" -o /dev/null -w '%{http_code}' "$UNLOCK")" = "303" ] && echo OK
step "create page"; PID=$(curl -fsS -b "$J" -X POST "$URL/api/pages" -H 'content-type: application/json' -H "origin: $URL" -d '{"title":"Smoke test page","section":"notes"}' | python3 -c 'import sys,json; print(json.load(sys.stdin)["id"])'); echo "OK $PID"
step "update content"; curl -fsS -b "$J" -X PATCH "$URL/api/pages/$PID" -H 'content-type: application/json' -H "origin: $URL" -d '{"content":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Smoke test content about hedonic indices."}]}]}}' | grep -q '"version":2' && echo OK
step "quick search"; sleep 2; curl -fsS -b "$J" "$URL/api/search?mode=quick&q=smoke" | grep -q "Smoke test page" && echo OK
step "ai action (quick)"; curl -fsS -N -b "$J" -X POST "$URL/api/ai/action" -H 'content-type: application/json' -H "origin: $URL" -d '{"action":"fix","text":"Ths is a smoke tset.","model":"claude-haiku-5-5"}' | grep -q '"type":"done"' && echo OK
step "trash page"; curl -fsS -b "$J" -X DELETE "$URL/api/pages/$PID" -H "origin: $URL" | grep -q '"ok":true' && echo OK
step "purge page"; curl -fsS -b "$J" -X DELETE "$URL/api/pages/$PID?purge=1" -H "origin: $URL" | grep -q '"ok":true' && echo OK
step "lock"; curl -fsS -b "$J" -X POST "$URL/api/lock" -H "origin: $URL" | grep -q '"ok":true' && echo OK
echo "smoke test passed"
