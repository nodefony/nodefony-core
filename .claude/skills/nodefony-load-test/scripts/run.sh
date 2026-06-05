#!/usr/bin/env bash
# Wrapper unique du skill load-test. Route vers les suites vitest VERSIONNÉES
# (non-régression de charge) ou vers les scripts client standalone (exploration).
#
# Prérequis : serveur Nodefony dev UP (bash .claude/skills/nodefony-start-server/start.sh).
#
# Usage (depuis n'importe où — la racine repo est dérivée) :
#   run.sh load             # suites load WS versionnées (CI-stable) — alias: `mocha`
#   run.sh load --rupture   # + sondes plafond/rupture (RUN_WS_RUPTURE=1)
#   run.sh ws-conn          # script axe 1 — plafond connexions WS
#   run.sh ws-msg           # script axe 2 — débit echo (MODE=broadcast pour fan-out)
#   run.sh http             # script charge HTTP (RPS + percentiles)
#   run.sh stress           # STRESS COMBINÉ HTTP+WS+ORM en rampe (voir Supervision bouger)
#   run.sh hub              # charge du HUB realtime (panneau /nodefony/hub) — MODE=fanout|slow
#   run.sh cluster-ipc      # bench du FIL IPC backplane cluster (fork réel)
#   run.sh cluster-e2e      # preuve e2e realtime cross-process (fork réel — asserte, exit 0/1)
#   run.sh cluster-probe    # preuve e2e sonde agrégée pod (fork réel — asserte, exit 0/1)
# ⚠️ cluster-* ne dépendent PAS du serveur dev : ils forkent eux-mêmes (nécessitent `npm run build`).
# Les ENV des scripts (CAP, STEP, MODE, N, C, URL…) se passent inline :
#   CAP=4000 run.sh ws-conn        MODE=broadcast CLIENTS=30 run.sh ws-msg
#   run.sh hub                     MODE=slow run.sh hub   # backpressure (consommateurs lents)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# racine repo = 4 niveaux au-dessus de .claude/skills/load-test/scripts
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
HTTP_PKG="$REPO_ROOT/src/packages/@nodefony/http"

cmd="${1:-help}"; shift || true

case "$cmd" in
  load|mocha)   # `mocha` gardé comme alias (mocha SUPPRIMÉ 2026-06-05 → vitest)
    cd "$HTTP_PKG"
    PAT="LOAD — WS"
    if [[ "${1:-}" == "--rupture" ]]; then export RUN_WS_RUPTURE=1; PAT="LOAD — WS|RUPTURE"; fi
    echo ">>> suites load WS (vitest.load.config.ts) — pattern: $PAT"
    exec npx vitest run --config vitest.load.config.ts -t "$PAT"
    ;;
  ws-conn)  cd "$REPO_ROOT"; exec node "$SCRIPT_DIR/ws-connections.mjs" ;;
  ws-msg)   cd "$REPO_ROOT"; exec node "$SCRIPT_DIR/ws-messages.mjs" ;;
  http)     cd "$REPO_ROOT"; exec node "$SCRIPT_DIR/http-load.mjs" ;;
  stress)   cd "$REPO_ROOT"; exec node "$SCRIPT_DIR/supervision-stress.mjs" ;;
  hub)      cd "$REPO_ROOT"; exec node "$SCRIPT_DIR/hub-load.mjs" ;;
  aimd)     cd "$REPO_ROOT"; exec node "$SCRIPT_DIR/aimd-demo.mjs" ;;
  cluster-ipc) cd "$REPO_ROOT"; exec node "$SCRIPT_DIR/cluster-ipc.mjs" ;;
  cluster-e2e) cd "$REPO_ROOT"; exec node "$SCRIPT_DIR/cluster-realtime-e2e.mjs" ;;
  cluster-probe) cd "$REPO_ROOT"; exec node "$SCRIPT_DIR/cluster-probe-e2e.mjs" ;;
  help|*)
    sed -n '2,24p' "${BASH_SOURCE[0]}"
    ;;
esac
