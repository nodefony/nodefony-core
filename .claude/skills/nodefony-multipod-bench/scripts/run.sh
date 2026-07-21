#!/usr/bin/env bash
# Démarre les pods du banc : deux instances de la première application (même
# secret = pairs légitimes) et une instance de la seconde SANS secret (le témoin
# non protégé, indispensable au contrôle négatif).
#
#   bash scripts/run.sh [dossier] [namespace]
#   bash scripts/run.sh --stop     # arrête les pods du banc
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../../../.." && pwd)"
PORTS=(5171 5172 5183)

if [ "${1:-}" = "--stop" ]; then
  for P in "${PORTS[@]}"; do
    for PID in $(lsof -nP -iTCP:"$P" -sTCP:LISTEN -t 2>/dev/null || true); do
      kill -9 "$PID" 2>/dev/null || true
    done
  done
  echo ">>> pods du banc arrêtés (ports ${PORTS[*]})"
  exit 0
fi

BENCH_DIR="${1:-$ROOT/tmp/bench}"
SECRET="${NF_BENCH_SECRET:-bench-secret-0123456789abcdefghij}"
REDIS="${REDIS_URL:-redis://:nodefony-dev@127.0.0.1:6379}"
LOGS="${TMPDIR:-/tmp}"

# Un port occupé par autre chose (le serveur du dépôt, un Vite) doit être VU,
# pas écrasé : on refuse de démarrer plutôt que de tuer le travail de quelqu'un.
for P in "${PORTS[@]}"; do
  PID="$(lsof -nP -iTCP:"$P" -sTCP:LISTEN -t 2>/dev/null | head -1 || true)"
  if [ -n "$PID" ]; then
    echo "!!! port $P déjà pris par le pid $PID :"
    ps -p "$PID" -o command= | cut -c1-100 | sed 's/^/    /'
    echo "    (bash scripts/run.sh --stop pour libérer les pods du banc)"
    exit 1
  fi
done

# `production` et non `development` : le superviseur de développement est
# instance unique par racine d'application — un second pod évincerait le premier.
lancer() {
  local dir="$1" nom="$2" http="$3" https="$4" secret="$5"
  # Tous les descripteurs sont fermés côté enfant : un seul flux hérité suffit à
  # ce que le shell appelant attende indéfiniment, même après `disown`.
  ( cd "$dir" && \
    REDIS_URL="$REDIS" \
    NF_REALTIME_BACKPLANE_SECRET="$secret" \
    NF_POD_NAME="$nom" NF_PORT="$http" NF_PORT_HTTPS="$https" \
    nohup npx nodefony production > "$LOGS/bench-$nom.log" 2>&1 < /dev/null & disown ) \
    >/dev/null 2>&1
  echo "    $nom → http://127.0.0.1:$http  (journal : $LOGS/bench-$nom.log)"
}

echo ">>> démarrage des pods…"
lancer "$BENCH_DIR/appalpha" A1 5171 5271 "$SECRET"
lancer "$BENCH_DIR/appalpha" A2 5172 5272 "$SECRET"
lancer "$BENCH_DIR/appbeta"  BETA 5183 5283 ""   # témoin : bus NON scellé

for P in "${PORTS[@]}"; do
  until curl -s -o /dev/null "http://127.0.0.1:$P/api/chat/probe"; do sleep 1; done
done

echo ">>> les 3 pods répondent."
cat <<EOF

Vérifier le fan-out cross-pod :
  cd $BENCH_DIR
  (node listen.mjs 5172 8 &) ; sleep 3 ; curl -s -X POST http://127.0.0.1:5171/api/chat/say -d '{}'

Mesurer :
  node latency.mjs 5172 5171 60 50      # latence, hors saturation
  node soak.mjs    5172 5171 50,200 30  # charge par paliers

Arrêter :
  bash $HERE/run.sh --stop
EOF
