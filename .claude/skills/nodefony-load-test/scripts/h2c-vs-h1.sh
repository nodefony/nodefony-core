#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# HTTP/1.1 contre HTTP/2 en clair (h2c) — « h2c est-il plus rapide derrière mon
# proxy ? », et surtout : le surcoût de h2c est-il celui de HTTP/2, ou le nôtre ?
#
# Deux camps, chacun en paires alternées (la dérive thermique porte sur toutes
# les formes à la fois), même instrument pour toutes (h2load, qui parle h1 et h2c) :
#   - nodefony : production mono, journaux coupés, route de banc, h2c ACTIVÉ par
#     variable (servers.h2c) — 5151 HTTP/1.1, 5153 h2c ;
#   - nu       : Node sans framework (h2c-vs-h1-bare.mjs) — le coût de HTTP/2.
# Trois formes : h1 64 connexions · h2c 64 × 1 flux (forme égale) · h2c 4 × 16
# flux (forme d'un proxy, qui multiplexe). Rend la médiane par forme et le
# surcoût en µs/req de chaque forme h2c face à h1 : un écart Nodefony ≫ écart nu
# désigne NOTRE chemin HTTP/2 — profil ensuite par
# `BENCH_PROTO=h2c profile-cpu.sh`.
#
# Usage : h2c-vs-h1.sh [nodefony|nu|both=both]
# Env   : DUR (10 s par run), PAIRS (3), ROUTE (/nodefony/kernel/bench)
# Sortie : tmp/bench/h2c-vs-h1.log (runs) + médianes sur la sortie standard.
# ─────────────────────────────────────────────────────────────────────────────
set -u
CAMPS=${1:-both}
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="$ROOT/tmp/bench"
mkdir -p "$OUT"
LOG="$OUT/h2c-vs-h1.log"
: > "$LOG"
ROUTE=${ROUTE:-/nodefony/kernel/bench}
DUR=${DUR:-10}
PAIRS=${PAIRS:-3}
command -v h2load >/dev/null || { echo "❌ h2load absent (nghttp2) — wrk ne parle pas h2c"; exit 1; }
. "$HERE/kill-guard.sh"

# run <camp> <forme> <args h2load…> → une ligne « camp forme rps » dans le journal
run() {
  local camp=$1 shape=$2; shift 2
  local res rps ok
  res=$(h2load -D "$DUR" "$@" 2>&1)
  rps=$(printf '%s\n' "$res" | sed -n 's/^finished in [^,]*, \([0-9.]*\) req\/s.*/\1/p')
  ok=$(printf '%s\n' "$res" | grep -cE "^status codes: [0-9]+ 2xx, 0 3xx, 0 4xx, 0 5xx")
  [ "$ok" = 1 ] || { echo "❌ $camp $shape : réponses non-2xx — mesure invalide"; printf '%s\n' "$res" | grep "^status codes"; return 1; }
  echo "$camp $shape $rps" | tee -a "$LOG"
}

# campaign <camp> <url h1> <url h2c>
campaign() {
  local camp=$1 h1=$2 h2c=$3
  h2load --h1 -D 5 -c 64 -t 4 "$h1" >/dev/null 2>&1 # chauffe JIT, non comptée
  h2load -D 5 -c 64 -m 1 -t 4 "$h2c" >/dev/null 2>&1
  for _ in $(seq 1 "$PAIRS"); do
    run "$camp" h1-c64 --h1 -c 64 -t 4 "$h1" || return 1; sleep 5
    run "$camp" h2c-c64-m1 -c 64 -m 1 -t 4 "$h2c" || return 1; sleep 5
    run "$camp" h2c-c4-m16 -c 4 -m 16 -t 4 "$h2c" || return 1; sleep 5
  done
}

stop_nodefony() {
  node "$ROOT/src/nodefony/bin/nodefony" stop >/dev/null 2>&1 || true
  kill_listeners 5151 5152 5153 5173 5177 5181
  kill_by_cmdline vite.js "bin/nodefony"
}

if [ "$CAMPS" != nu ]; then
  stop_nodefony; sleep 2
  cd "$ROOT" || exit 1
  NODE_ENV=production NF_LOG_DRIVER=null NF_BENCH_ROUTE=1 NF__APP__SERVERS__H2C__ENABLED=true \
    node src/nodefony/bin/nodefony production >"$OUT/h2c-vs-h1-server.log" 2>&1 &
  PID=$!
  for _ in $(seq 1 60); do
    a=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:5151$ROUTE")
    b=$(curl -s --http2-prior-knowledge -o /dev/null -w '%{http_code}' "http://127.0.0.1:5153$ROUTE")
    [ "$a" = 200 ] && [ "$b" = 200 ] && break
    sleep 1
  done
  if [ "$a" != 200 ] || [ "$b" != 200 ]; then
    echo "❌ cible : h1=$a h2c=$b — rien ne serait valide (journal : $OUT/h2c-vs-h1-server.log)"
    kill -INT "$PID" 2>/dev/null; exit 1
  fi
  campaign nodefony "http://127.0.0.1:5151$ROUTE" "http://127.0.0.1:5153$ROUTE"
  STATUS=$?
  kill -INT "$PID" 2>/dev/null; wait "$PID" 2>/dev/null
  [ $STATUS = 0 ] || exit 1
fi

if [ "$CAMPS" != nodefony ]; then
  kill_listeners 5161 5163
  node "$HERE/h2c-vs-h1-bare.mjs" 5161 5163 &
  BARE=$!
  sleep 1
  campaign nu http://127.0.0.1:5161/ http://127.0.0.1:5163/
  STATUS=$?
  kill "$BARE" 2>/dev/null
  [ $STATUS = 0 ] || exit 1
fi

# Médianes, puis surcoût par requête de chaque forme h2c face à h1 (1e6 / rps).
node -e '
const lines = require("node:fs").readFileSync(process.argv[1], "utf8").trim().split("\n");
const by = {};
for (const l of lines) { const [camp, shape, rps] = l.split(" "); ((by[camp] ??= {})[shape] ??= []).push(Number(rps)); }
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[(s.length - 1) >> 1]; };
for (const [camp, shapes] of Object.entries(by)) {
  const h1 = med(shapes["h1-c64"]);
  console.log(`${camp}`);
  for (const [shape, runs] of Object.entries(shapes)) {
    const m = med(runs);
    const spread = ((Math.max(...runs) - Math.min(...runs)) / m * 100).toFixed(1);
    const delta = shape === "h1-c64" ? "" : `  ${((m / h1 - 1) * 100).toFixed(0)} % · ${(1e6 / m - 1e6 / h1 >= 0 ? "+" : "")}${(1e6 / m - 1e6 / h1).toFixed(1)} µs/req`;
    console.log(`  ${shape.padEnd(11)} ${m.toFixed(0).padStart(7)} req/s (écart ${spread} %)${delta}`);
  }
}' "$LOG"
