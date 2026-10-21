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
# Env   : DUR (10 s par run), PAIRS (3), ROUTE (/nodefony/kernel/bench),
#         PROBE=1 — sonde in-situ (`NF_PERF_PROBE=1`) remise à zéro AVANT chaque
#         run Nodefony et relevée APRÈS : la fabrique du contexte décomposée PAR
#         FORME. Ses compteurs sont cumulés et le serveur sert les trois formes,
#         d'où le reset par run. Les horodatages de la sonde ralentissent le
#         serveur : les débits d'une passe PROBE=1 ne se comparent qu'entre eux.
#         BARE=headers — le témoin nu émet les dix en-têtes de la route de banc
#         (camp « nu-headers ») : ce que ces en-têtes coûtent à HTTP/2 sans framework.
# Sortie : tmp/bench/h2c-vs-h1.log (runs) + médianes sur la sortie standard ;
#          avec PROBE=1, tmp/bench/h2c-vs-h1-probe.log (un relevé JSON par run).
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
BARE=${BARE:-plain}
BARE_CAMP=$([ "$BARE" = headers ] && echo nu-headers || echo nu)
PROBE=${PROBE:-0}
PROBE_LOG="$OUT/h2c-vs-h1-probe.log"
PROBE_URL="http://127.0.0.1:5151${ROUTE%/}/probe"
[ "$PROBE" = 1 ] && : > "$PROBE_LOG"
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
  if [ "$PROBE" = 1 ] && [ "$camp" = nodefony ]; then
    local dump
    dump=$(curl -sf "$PROBE_URL?reset=1") || { echo "❌ sonde illisible ($PROBE_URL)"; return 1; }
    case "$dump" in *'"enabled":true'*) ;; *) echo "❌ sonde ÉTEINTE côté serveur"; return 1 ;; esac
    echo "$shape $dump" >> "$PROBE_LOG"
  fi
}

# Remet la sonde à zéro : la chauffe, ou la forme précédente, ne doit pas entrer
# dans le relevé du run suivant.
probe_reset() {
  [ "$PROBE" = 1 ] || return 0
  curl -sf -o /dev/null "$PROBE_URL?reset=1" || { echo "❌ sonde illisible ($PROBE_URL)"; return 1; }
}

# campaign <camp> <url h1> <url h2c>
campaign() {
  local camp=$1 h1=$2 h2c=$3
  h2load --h1 -D 5 -c 64 -t 4 "$h1" >/dev/null 2>&1 # chauffe JIT, non comptée
  h2load -D 5 -c 64 -m 1 -t 4 "$h2c" >/dev/null 2>&1
  [ "$camp" = nodefony ] && { probe_reset || return 1; }
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
    NF_PERF_PROBE=$([ "$PROBE" = 1 ] && echo 1 || echo 0) \
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
  node "$HERE/h2c-vs-h1-bare.mjs" 5161 5163 "$BARE" &
  BARE_PID=$!
  sleep 1
  campaign "$BARE_CAMP" http://127.0.0.1:5161/ http://127.0.0.1:5163/
  STATUS=$?
  kill "$BARE_PID" 2>/dev/null
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

# Sonde : médiane par forme de chaque tranche de la fabrique (µs/req). L'écart
# h2c − h1 d'une tranche dit ce que la fabrique HTTP/2 coûte EN PROPRE ; ce que
# l'écart de débit ne retrouve pas ici vit HORS de la fabrique.
[ "$PROBE" = 1 ] && node -e '
const by = {};
for (const l of require("node:fs").readFileSync(process.argv[1], "utf8").trim().split("\n")) {
  const i = l.indexOf(" "); (by[l.slice(0, i)] ??= []).push(JSON.parse(l.slice(i + 1)));
}
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[(s.length - 1) >> 1]; };
const pick = (p) => ({ ...p.avgUs, ...Object.fromEntries(Object.entries(p.ctxSlicesUs).map(([k, v]) => ["ctx." + k, v])),
  ...Object.fromEntries(Object.entries(p.svcSlicesUs).map(([k, v]) => ["svc." + k, v])),
  ...Object.fromEntries(Object.entries(p.reqSlicesUs).map(([k, v]) => ["req." + k, v])) });
const rows = {};
for (const [shape, dumps] of Object.entries(by)) {
  const picked = dumps.map(pick);
  for (const k of Object.keys(picked[0])) (rows[k] ??= {})[shape] = med(picked.map((p) => p[k]));
}
const shapes = Object.keys(by);
console.log("sonde (µs/req, médiane de " + by[shapes[0]].length + " runs) — " + shapes.join(" · ") + (shapes.includes("h1-c64") ? "  | Δ h2c-c4-m16 − h1" : ""));
for (const [k, v] of Object.entries(rows)) {
  const d = v["h2c-c4-m16"] !== undefined && v["h1-c64"] !== undefined ? (v["h2c-c4-m16"] - v["h1-c64"]).toFixed(3) : "";
  console.log("  " + k.padEnd(14) + shapes.map((s) => v[s].toFixed(3).padStart(8)).join(" ") + "  " + d);
}' "$PROBE_LOG"
exit 0
