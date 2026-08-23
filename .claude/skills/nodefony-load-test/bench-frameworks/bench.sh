#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# Banc comparatif frameworks — bare / express / fastify (Nodefony = bench-ab-mono.sh).
# Même protocole que bench-ab-mono.sh — À GARDER ALIGNÉS (équité : un warmup
# donné à l'un et pas à l'autre inverse un classement serré) : cooldown thermique
# pré-série → warmup wrk NON compté (JIT) → 3× wrk enchaînés (pause fixe 10 s)
# → min/méd/max + REFUS si dispersion > 3 %. NODE_ENV=production.
# Usage : bash bench.sh <bare|express|fastify> [PORT] [ENV extra ex FASTIFY_SCHEMA=1]
# Médiane écrite dans /tmp/nf-bench-<app>[-env].med (+ .json détail)
# ─────────────────────────────────────────────────────────────────────────────
set -u
export LC_ALL=C   # locale fr : « 4,1 » casse la comparaison de dispersion et le JSON
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP="${1:?bare|express|fastify}"; PORT="${2:-5161}"; shift 2 2>/dev/null || shift $#
EXTRA="$*"
URL="http://127.0.0.1:$PORT/nodefony/test/als-test/state"
DUR="${BENCH_DUR:-10}"; CONN="${BENCH_CONN:-128}"; THREADS="${BENCH_THREADS:-4}"
LABEL="$APP${EXTRA:+-$(echo "$EXTRA" | tr ' =' '--')}"

command -v wrk >/dev/null 2>&1 || { echo "❌ wrk absent"; exit 1; }

# port propre — via la garde partagée : `lsof -ti tcp:PORT` NU vise aussi les
# CLIENTS du port et n'épargne pas le lanceur (cf `../scripts/kill-guard.sh`,
# écrit après qu'un banc a SIGKILLé l'agent qui l'exécutait).
. "$(dirname "${BASH_SOURCE[0]}")/../scripts/kill-guard.sh"
kill_listeners "$PORT"
sleep 0.3

# spawn
ENVS="NODE_ENV=production PORT=$PORT $EXTRA"
PID=$(env $ENVS node "$DIR/$APP.mjs" >/tmp/nf-bench-fw.log 2>&1 & echo $!)

# wait boot
node -e "const net=require('net');const t0=Date.now();(function p(){const s=net.connect($PORT,'127.0.0.1');s.on('error',()=>{s.destroy();if(Date.now()-t0>10000){console.error('BOOT TIMEOUT');process.exit(1)}setTimeout(p,200)});s.on('connect',()=>{s.destroy();process.exit(0)})})();" || { echo "$LABEL: BOOT FAIL"; cat /tmp/nf-bench-fw.log; exit 1; }

# sanity : la route répond bien 200 + JSON attendu
BODY=$(curl -s "$URL")
echo "$BODY" | grep -q "wsHookFireCount" || { echo "❌ $LABEL: payload inattendu: $BODY"; kill -9 "$PID"; exit 1; }

echo "=== $LABEL (port $PORT, wrk -t$THREADS -c$CONN -d${DUR}s) ==="

# mêmes gardes que bench-ab-mono.sh (équité inter-frameworks)
therm() { sysctl -n machdep.xcpm.cpu_thermal_level 2>/dev/null || echo "n/a"; }
THERM_TARGET="${BENCH_THERM_TARGET:-45}"
T=$(therm); WAITED=0
if [ "$T" != "n/a" ]; then
  while [ "$T" -gt "$THERM_TARGET" ] && [ "$WAITED" -lt 180 ]; do
    sleep 10; WAITED=$((WAITED+10)); T=$(therm)
  done
  [ "$WAITED" -gt 0 ] && echo "  (cooldown ${WAITED}s → thermal $T)"
fi
THERM_BEFORE=$(therm)
WARMUP="${BENCH_WARMUP:-5}"
[ "$WAITED" -gt 0 ] && WARMUP=$((WARMUP * 2))   # la pause endort le process idle
wrk -t"$THREADS" -c"$CONN" -d"${WARMUP}s" "$URL" >/dev/null 2>&1
echo "  warmup: ${WARMUP}s wrk non compté · thermal avant: $THERM_BEFORE"
# Le sanity ci-dessus prouve la cible AVANT la charge ; il ne dit rien de ce qui se
# passe PENDANT. Un serveur peut répondre 200 à froid puis partir en 500 sous 128
# connexions (pool épuisé, OOM) — et wrk compte ces 500 dans `Requests/sec`, alors
# qu'une erreur coûte moins cher qu'une vraie réponse. Comparer deux frameworks
# dont l'un erre sous charge donnerait l'avantage… à celui qui échoue.
RPS=(); BAD=0
for i in 1 2 3; do
  [ "$i" -gt 1 ] && sleep 10
  OUT=$(wrk -t"$THREADS" -c"$CONN" -d"${DUR}s" "$URL" 2>/dev/null)
  R=$(printf '%s' "$OUT" | grep "Requests/sec" | awk '{print $2}')
  NON2XX=$(printf '%s' "$OUT" | grep "Non-2xx or 3xx responses" | awk '{print $NF}')
  ERRS=$(printf '%s' "$OUT" | grep "Socket errors" || true)
  if [ -n "$NON2XX" ] || [ -n "$ERRS" ]; then
    echo "  run $i: $R RPS  ⚠ INVALIDE — ${NON2XX:-0} hors 2xx/3xx ${ERRS:+· $ERRS}"
    BAD=1
  else
    echo "  run $i: $R RPS"
  fi
  RPS+=("$R")
done
THERM_AFTER=$(therm)
if [ "$BAD" = "1" ]; then
  echo "  ✖ $LABEL: erreurs sous charge — médiane NON enregistrée (comparaison impossible)."
  rm -f "/tmp/nf-bench-$LABEL.med" "/tmp/nf-bench-$LABEL.json"
  kill -9 "$PID" 2>/dev/null
  exit 1
fi
MIN=$(printf '%s\n' "${RPS[@]}" | sort -n | sed -n '1p')
MED=$(printf '%s\n' "${RPS[@]}" | sort -n | sed -n '2p')
MAX=$(printf '%s\n' "${RPS[@]}" | sort -n | sed -n '3p')
DISP=$(awk -v min="$MIN" -v max="$MAX" -v med="$MED" 'BEGIN{printf "%.1f", (max-min)/med*100}')
echo "  min/méd/max: $MIN / $MED / $MAX RPS · dispersion ${DISP} % · thermal avant/après: $THERM_BEFORE/$THERM_AFTER"
if awk -v d="$DISP" 'BEGIN{exit !(d > 3)}'; then
  echo "  ✖ $LABEL: dispersion ${DISP} % > 3 % — fenêtre instable, mesure NON enregistrée."
  rm -f "/tmp/nf-bench-$LABEL.med" "/tmp/nf-bench-$LABEL.json"
  kill -9 "$PID" 2>/dev/null
  exit 1
fi
echo "  MÉDIANE: $MED RPS  (payload vérifié, 0 erreur sous charge, dispersion ≤ 3 %)"
echo "$MED" > "/tmp/nf-bench-$LABEL.med"
printf '{"label":"%s","rps":[%s],"min":%s,"med":%s,"max":%s,"dispersionPct":%s,"thermalBefore":"%s","thermalAfter":"%s","warmupSec":%s,"durSec":%s,"conn":%s,"threads":%s,"url":"%s"}\n' \
  "$LABEL" "$(printf '%s,' "${RPS[@]}" | sed 's/,$//')" \
  "$MIN" "$MED" "$MAX" "$DISP" "$THERM_BEFORE" "$THERM_AFTER" \
  "$WARMUP" "$DUR" "$CONN" "$THREADS" "$URL" > "/tmp/nf-bench-$LABEL.json"

kill -9 "$PID" 2>/dev/null
