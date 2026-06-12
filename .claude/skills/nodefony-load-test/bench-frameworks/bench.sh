#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# Banc comparatif frameworks — bare / express / fastify (Nodefony = bench-ab-mono.sh).
# Même protocole : wrk -t4 -c128 -d10s ×3 → médiane. NODE_ENV=production.
# Usage : bash bench.sh <bare|express|fastify> [PORT] [ENV extra ex FASTIFY_SCHEMA=1]
# Médiane écrite dans /tmp/nf-bench-<app>[-env].med
# ─────────────────────────────────────────────────────────────────────────────
set -u
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP="${1:?bare|express|fastify}"; PORT="${2:-5161}"; shift 2 2>/dev/null || shift $#
EXTRA="$*"
URL="http://127.0.0.1:$PORT/nodefony/test/als-test/state"
DUR="${BENCH_DUR:-10}"; CONN="${BENCH_CONN:-128}"; THREADS="${BENCH_THREADS:-4}"
LABEL="$APP${EXTRA:+-$(echo "$EXTRA" | tr ' =' '--')}"

command -v wrk >/dev/null 2>&1 || { echo "❌ wrk absent"; exit 1; }

# port propre
lsof -ti tcp:"$PORT" 2>/dev/null | xargs kill -9 2>/dev/null
sleep 0.3

# spawn
ENVS="NODE_ENV=production PORT=$PORT $EXTRA"
PID=$(env $ENVS node "$DIR/$APP.mjs" >/tmp/nf-bench-fw.log 2>&1 & echo $!)

# wait boot
node -e "const net=require('net');const t0=Date.now();(function p(){const s=net.connect($PORT,'127.0.0.1');s.on('error',()=>{s.destroy();if(Date.now()-t0>10000){console.error('BOOT TIMEOUT');process.exit(1)}setTimeout(p,200)});s.on('connect',()=>{s.destroy();process.exit(0)})})();" || { echo "$LABEL: BOOT FAIL"; cat /tmp/nf-bench-fw.log; exit 1; }

# sanity : la route répond bien 200 + JSON attendu
BODY=$(curl -s "$URL")
echo "$BODY" | grep -q "wsHookFireCount" || { echo "❌ $LABEL: payload inattendu: $BODY"; kill -9 "$PID"; exit 1; }
curl -s -o /dev/null "$URL"

echo "=== $LABEL (port $PORT, wrk -t$THREADS -c$CONN -d${DUR}s) ==="
RPS=()
for i in 1 2 3; do
  R=$(wrk -t"$THREADS" -c"$CONN" -d"${DUR}s" "$URL" 2>/dev/null | grep "Requests/sec" | awk '{print $2}')
  echo "  run $i: $R RPS"; RPS+=("$R")
done
MED=$(printf '%s\n' "${RPS[@]}" | sort -n | sed -n '2p')
echo "  MÉDIANE: $MED RPS"
echo "$MED" > "/tmp/nf-bench-$LABEL.med"

kill -9 "$PID" 2>/dev/null
