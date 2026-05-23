#!/usr/bin/env bash
# Wrapper unique du skill load-test. Route vers les suites mocha VERSIONNÉES
# (non-régression de charge) ou vers les scripts client standalone (exploration).
#
# Prérequis : serveur Nodefony dev UP (bash .claude/skills/nodefony-start-server/start.sh).
#
# Usage (depuis n'importe où — la racine repo est dérivée) :
#   run.sh mocha            # suites load WS versionnées (CI-stable)
#   run.sh mocha --rupture  # + sondes plafond/rupture (RUN_WS_RUPTURE=1)
#   run.sh ws-conn          # script axe 1 — plafond connexions WS
#   run.sh ws-msg           # script axe 2 — débit echo (MODE=broadcast pour fan-out)
#   run.sh http             # script charge HTTP (RPS + percentiles)
#   run.sh stress           # STRESS COMBINÉ HTTP+WS+ORM en rampe (voir Supervision bouger)
# Les ENV des scripts (CAP, STEP, MODE, N, C, URL…) se passent inline :
#   CAP=4000 run.sh ws-conn        MODE=broadcast CLIENTS=30 run.sh ws-msg
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# racine repo = 4 niveaux au-dessus de .claude/skills/load-test/scripts
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
HTTP_PKG="$REPO_ROOT/src/packages/@nodefony/http"

cmd="${1:-help}"; shift || true

case "$cmd" in
  mocha)
    cd "$HTTP_PKG"
    GREP="LOAD — WS"
    if [[ "${1:-}" == "--rupture" ]]; then export RUN_WS_RUPTURE=1; GREP="LOAD — WS|RUPTURE"; fi
    echo ">>> suites load WS (config .mocharc.load.json) — grep: $GREP"
    exec npx mocha --config .mocharc.load.json --grep "$GREP"
    ;;
  ws-conn)  cd "$REPO_ROOT"; exec node "$SCRIPT_DIR/ws-connections.mjs" ;;
  ws-msg)   cd "$REPO_ROOT"; exec node "$SCRIPT_DIR/ws-messages.mjs" ;;
  http)     cd "$REPO_ROOT"; exec node "$SCRIPT_DIR/http-load.mjs" ;;
  stress)   cd "$REPO_ROOT"; exec node "$SCRIPT_DIR/supervision-stress.mjs" ;;
  help|*)
    sed -n '2,20p' "${BASH_SOURCE[0]}"
    ;;
esac
