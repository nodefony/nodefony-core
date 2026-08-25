#!/usr/bin/env bash
# Pic mémoire d'un pod pendant une rafale de publications.
#
# Pourquoi un script et pas un `ps` avant/après : le pic est DANS la boucle de
# publication. Une mesure prise après coup voit déjà le retour à la normale et
# rate l'accident — c'est exactement ce qu'on cherche à borner.
#
# Usage : mempeak.sh [port] [nb de publications]
# Contrôle : rejouer avec `maxQueueBytes: 0` dans la config du pod (= comportement
# non borné) et comparer les deux pics. Sans ce second tir, un chiffre seul ne dit
# pas si la borne sert à quelque chose.
set -euo pipefail

PORT="${1:-5171}"
N="${2:-1000000}"

# `-sTCP:LISTEN` OBLIGATOIRE : sans lui, `lsof -ti :PORT` rend aussi les CLIENTS
# connectés — et `head -1` en choisirait un au hasard. On mesurerait alors la RSS
# du navigateur ou du curl au lieu de celle du pod, sans que rien ne le signale.
PID=$(lsof -ti :"$PORT" -sTCP:LISTEN | head -1)
if [ -z "$PID" ]; then
  echo "Aucun pod sur le port $PORT — lancer run.sh d'abord." >&2
  exit 1
fi

BASE=$(ps -o rss= -p "$PID" | tr -d ' ')
MAX=$BASE

curl -s "http://127.0.0.1:${PORT}/api/chat/burst?n=${N}" > /tmp/mempeak-burst.json &
CURL=$!
# Échantillonnage serré : la rafale dure quelques secondes, le pic est bref.
while kill -0 $CURL 2>/dev/null; do
  R=$(ps -o rss= -p "$PID" 2>/dev/null | tr -d ' ') || true
  [ -n "${R:-}" ] && [ "$R" -gt "$MAX" ] && MAX=$R
done
wait $CURL || true
sleep 2
AFTER=$(ps -o rss= -p "$PID" | tr -d ' ')

echo "port=$PORT pid=$PID publications=$N"
echo "RSS  base=$((BASE / 1024)) MB   PIC=$((MAX / 1024)) MB   après=$((AFTER / 1024)) MB"
cat /tmp/mempeak-burst.json
echo
curl -s "http://127.0.0.1:${PORT}/api/chat/probe" \
  | python3 -c "import json,sys; print('file du bus :', json.load(sys.stdin)['backplane']['queue'])"
