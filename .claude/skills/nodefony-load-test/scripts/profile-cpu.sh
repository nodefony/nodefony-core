#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# Profil CPU d'un serveur SOUS CHARGE — où part le temps d'une requête.
# Lance le serveur sous `node --cpu-prof`, le chauffe (wrk non compté), le charge
# 20 s, puis l'arrête GRACIEUSEMENT (SIGINT : V8 n'écrit le profil qu'à la sortie).
# Relire ensuite avec `profile-analyze.mjs`, qui fenêtre sur la charge.
#
# Usage : profile-cpu.sh <label> <port> <cmd…>   (écrit <dossier>/rps : débit servi)
#   profile-cpu.sh nodefony 5151 src/nodefony/bin/nodefony production
#   profile-cpu.sh nest-fair 5161 .claude/skills/nodefony-load-test/bench-frameworks/nest-fair.mjs
# Env : NF_PROFILE_DIR (défaut tmp/profiles), BENCH_CONN (128 ; 25 sur un banc ORM
#   synchrone, au-delà on profile une file), BENCH_DUR (20 s), XENV (variables passées au serveur,
#   ex. « NF_WITH_DEV_MODULES=1 NF_WITH_DEV_MODULES_TTL_MIN=30 » pour la route de
#   banc de @nodefony/test, absente en production sinon — un 404 se profile aussi),
#   BENCH_LOGIN (« identifiant:mot de passe » — requête AUTHENTIFIÉE : une
#   connexion après le boot, puis le cookie de session porté par CHAQUE requête,
#   contrôle et wrk compris. C'est le seul moyen de profiler la session, le
#   pare-feu et le rechargement de l'utilisateur ; sans lui, une route protégée
#   répond 401 et le contrôle refuse de mesurer).
# ⚠️ Toujours en production : `phaseStart/phaseEnd` ne sont actifs qu'ailleurs,
#   et un profil pris en développement surestime le coût du pipeline.
# ─────────────────────────────────────────────────────────────────────────────
set -u
LABEL=$1; PORT=$2; shift 2
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
OUT="${NF_PROFILE_DIR:-$ROOT/tmp/profiles}/$LABEL"
URL="http://127.0.0.1:$PORT${BENCH_PATH:-/nodefony/test/als-test/state}"
rm -rf "$OUT"; mkdir -p "$OUT"
cd "$ROOT"
env NODE_ENV=production NF_LOG_DRIVER=null NF_BENCH_ROUTE=1 ${XENV:-} PORT=$PORT \
  node --cpu-prof --cpu-prof-dir="$OUT" --cpu-prof-interval 200 "$@" >"$OUT/server.log" 2>&1 &
PID=$!
for _ in $(seq 1 150); do curl -s -o /dev/null "$URL" && break; sleep 0.2; done
HDR=()
if [ -n "${BENCH_LOGIN:-}" ]; then
  # Un seul cookie par nom, attributs retirés : ce que le navigateur renverrait.
  COOKIE=$(curl -s -D - -o /dev/null -H 'content-type: application/json' \
    -d "{\"username\":\"${BENCH_LOGIN%%:*}\",\"password\":\"${BENCH_LOGIN#*:}\"}" \
    "http://127.0.0.1:$PORT/nodefony/security/api/auth/login" |
    awk 'tolower($1)=="set-cookie:" { split($2, a, ";"); printf "%s; ", a[1] }')
  [ -n "$COOKIE" ] || { echo "❌ connexion ${BENCH_LOGIN%%:*} refusée — aucun cookie de session"; kill -INT $PID; exit 1; }
  HDR=(-H "Cookie: $COOKIE")
fi
CODE=$(curl -s -o /dev/null -w '%{http_code}' ${HDR[@]+"${HDR[@]}"} "$URL")
[ "$CODE" = "200" ] || { echo "❌ $URL répond $CODE — rien ne serait valide"; kill -INT $PID; exit 1; }
wrk -t4 -c"${BENCH_CONN:-128}" -d10s ${HDR[@]+"${HDR[@]}"} "$URL" >/dev/null
wrk -t4 -c"${BENCH_CONN:-128}" -d"${BENCH_DUR:-20}"s ${HDR[@]+"${HDR[@]}"} "$URL" > "$OUT/wrk.txt"
grep -E "Requests/sec|Latency|Non-2xx" "$OUT/wrk.txt"
# Le débit SERVI fixe le dénominateur de profile-analyze (µs par requête).
# Une réponse non-2xx coûte moins qu'une vraie : le profil serait faux.
if grep -q "Non-2xx" "$OUT/wrk.txt"; then
  echo "❌ réponses non-2xx sous charge — profil invalide"; kill -INT $PID; exit 1
fi
awk '/Requests\/sec/ {print $2}' "$OUT/wrk.txt" > "$OUT/rps"
kill -INT $PID; for _ in $(seq 1 50); do kill -0 $PID 2>/dev/null || break; sleep 0.2; done
kill -0 $PID 2>/dev/null && { echo "pas arrêté, SIGTERM"; kill -TERM $PID; sleep 2; }
ls "$OUT"/*.cpuprofile
