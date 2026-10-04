#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# Chronométrage in situ d'un étage (`span-probe.mjs`) sur le serveur Nodefony
# COMPLET — même décor que `wait-compare.sh` (production, garde machine calme,
# cible prouvée 200, chauffe non comptée, fenêtre SIGUSR2), sans témoin : la
# sonde attribue, elle ne compare pas.
#
# Usage : span-run.sh [runs=3]
# Sortie : tmp/profiles/span/run-<n>/<pid>.spans.json, puis le tableau (span-analyze.mjs).
# ⚠️ Tue ce qui écoute sur 5151 — arrêter le serveur de dev avant.
# ─────────────────────────────────────────────────────────────────────────────
set -u
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$DIR/../../../.." && pwd)"
RUNS="${1:-3}"
BASE="${NF_SPAN_DIR:-$ROOT/tmp/profiles/span}"
CONN="${BENCH_CONN:-128}"
DUR="${BENCH_DUR:-20}"
cd "$ROOT"
node src/nodefony/bin/nodefony stop >/dev/null 2>&1 || true
. "$DIR/kill-guard.sh"; kill_listeners 5151; sleep 1
. "$DIR/machine-regime.sh"
url="http://127.0.0.1:5151${BENCH_PATH:-/nodefony/test/als-test/state}"
for i in $(seq 1 "$RUNS"); do
  out="$BASE/run-$i"; rm -rf "$out"; mkdir -p "$out"
  attendre_machine_calme
  env NODE_ENV=production NF_LOG_DRIVER=null NF_BENCH_ROUTE=1 \
    NF_WITH_DEV_MODULES=1 NF_WITH_DEV_MODULES_TTL_MIN=30 PORT=5151 \
    NF_SPAN_PROBE_OUT="$out" NODE_OPTIONS="--import=$DIR/span-probe.mjs" \
    node --import "$DIR/decor-probe.mjs" src/nodefony/bin/nodefony production >"$out/server.log" 2>&1 &
  pid=$!
  for _ in $(seq 1 150); do curl -s -o /dev/null "$url" && break; sleep 0.2; done
  code=$(curl -s -o /dev/null -w '%{http_code}' "$url")
  if [ "$code" != "200" ] || ! grep -q "span-probe:" "$out/server.log"; then
    echo "❌ run $i : cible $code ou sonde absente — $(grep -o 'decor-probe: REFUS.*' "$out/server.log" || echo "voir $out/server.log")"
    kill -INT $pid 2>/dev/null; exit 1
  fi
  for _ in $(seq 1 20); do grep -q "decor-probe:" "$out/server.log" && break; sleep 0.1; done
  if ! grep -q "decor-probe: ok" "$out/server.log"; then
    echo "❌ run $i : décor refusé — $(grep -o 'decor-probe:.*' "$out/server.log" || echo 'garde absente')"
    kill -INT $pid 2>/dev/null; exit 1
  fi
  wrk -t4 -c"$CONN" -d10s "$url" >/dev/null
  kill -USR2 $pid
  wrk -t4 -c"$CONN" -d"${DUR}s" "$url" > "$out/wrk.txt"
  kill -USR2 $pid
  for _ in $(seq 1 100); do ls "$out"/*.spans.json >/dev/null 2>&1 && break; sleep 0.1; done
  kill -INT $pid; for _ in $(seq 1 50); do kill -0 $pid 2>/dev/null || break; sleep 0.2; done
  kill -0 $pid 2>/dev/null && { kill -TERM $pid; sleep 2; }
  if grep -q "Non-2xx" "$out/wrk.txt"; then echo "❌ run $i : non-2xx sous charge"; exit 1; fi
  ls "$out"/*.spans.json >/dev/null 2>&1 || { echo "❌ run $i : la sonde n'a rien écrit"; exit 1; }
  echo "run $i : $(awk '/Requests\/sec/ {print $2}' "$out/wrk.txt") req/s"
done
node "$DIR/span-analyze.mjs" "$BASE"
