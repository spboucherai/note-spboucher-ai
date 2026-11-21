#!/bin/bash
# =============================================================================
#                  SP BOUCHER | INFRASTRUCTURE & AUTOMATION
#             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
# =============================================================================
#
# Project          : Note SPBoucher AI
# File             : scripts/next-dev-server.sh
# Module           : scripts
# Repository       : https://git.spboucher.ai/note-spboucher-ai
# Project Website  : https://note.spboucher.ai
# Created          : 2026-11-19
# Last Modified    : 2026-11-19
#
# Author           : Simon-Pierre Boucher
# Position         : Professor of Finance
# Institution      : Université du Québec en Outaouais (UQO)
# Organization     : SP Boucher
# Website          : https://spboucher.ai
# Git              : https://git.spboucher.ai
#
# Preferred Contact: contact@spboucher.ai
# Technical Contact: dev@spboucher.ai
# Security/Admin   : admin@spboucher.ai
#
# Copyright (c) 2026
# Simon-Pierre Boucher
# All rights reserved where applicable. This file is governed by the
# applicable project license, copyright notices and relevant law.
# Existing third-party rights and notices remain unaffected.
#
# License          : None specified (no license file in this repository)
#
# Do not embed credentials, private keys, access tokens,
# certificates or confidential personal information.
#
# =============================================================================
# END OF SP BOUCHER SOURCE HEADER
# =============================================================================

# DEVELOPMENT ONLY — (re)start the built app of THIS worktree on its own port, detached, for the native teams to test against.
#   bash scripts/next-dev-server.sh start|stop|status|token
# Reads PORT / DATA_DIR from ./.env; pid file: $DATA_DIR/web.pid; log: $DATA_DIR/web.log. Stops only the PID it started (never pkill).
# `token` prints a session token for the owner of the scratch database (cookie value; see docs/next/API-NEXT.md §0.1).
set -euo pipefail
export PATH=/opt/homebrew/bin:$PATH
cd "$(dirname "$0")/.."
case "$(pwd)" in */apps/note-spboucher-ai*) echo "Refusing to run inside the production directory." >&2; exit 1;; esac
set -a; . ./.env; set +a
case "${DATABASE_URL##*/}" in *_dev|*_dev\?*|*_test|*_scratch) ;; *) echo "Refusing: DATABASE_URL is not a scratch database." >&2; exit 1;; esac
PIDFILE="$DATA_DIR/web.pid"; LOG="$DATA_DIR/web.log"
running() { [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; }
stop() { if running; then kill "$(cat "$PIDFILE")"; for _ in 1 2 3 4 5 6 7 8 9 10; do running || break; sleep 0.5; done; fi; rm -f "$PIDFILE"; }
case "${1:-status}" in
  start) stop; [ -d .next ] || { echo "No build: run pnpm build first." >&2; exit 1; }
    nohup node_modules/.bin/next start -p "$PORT" -H 127.0.0.1 >> "$LOG" 2>&1 & echo $! > "$PIDFILE"
    for _ in $(seq 1 40); do curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1 && break; sleep 0.5; done
    curl -fsS "http://127.0.0.1:$PORT/api/health"; echo; echo "pid $(cat "$PIDFILE") on 127.0.0.1:$PORT (log: $LOG)";;
  stop) stop; echo stopped;;
  status) if running; then echo "running, pid $(cat "$PIDFILE"), port $PORT"; else echo "not running"; fi;;
  token) node_modules/.bin/tsx scripts/dev-session.ts "${2:-SPNotes/2.0.0 (Macintosh; Mac OS X 27.0) native}";;
  *) echo "usage: $0 start|stop|status|token" >&2; exit 2;;
esac
