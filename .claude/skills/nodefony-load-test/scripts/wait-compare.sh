#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# « Où Nodefony ATTEND-il quand le témoin sert ? » — même décor que
# `profile-compare.sh`, mais sans profileur : la sonde `wait-probe.mjs`,
# préchargée dans les DEUX camps, encadre la fenêtre de charge et rend ce que le
# profil CPU ne voit pas (occupation de la boucle, CPU fil principal contre
# process, GC, tours libuv, écritures socket, changements de contexte).
#
# Paires ALTERNÉES (nodefony, témoin, nodefony, témoin…) : la dérive thermique
# porte également sur les deux camps.
#
# Usage : wait-compare.sh [témoin=nest-fair] [paires=3]
# NF_NATIVE_SAMPLE=1 : capture aussi la pile NATIVE (`sample`, macOS) pendant la
#   fenêtre, et la table `perf.map` qui nomme les fonctions JS → relire avec
#   `native-sample.mjs`, qui impute chaque coût natif à la fonction JS appelante.
# NF_WAIT_CUTS="entry context pipeline route action" : bissection par
#   COURT-CIRCUIT — chaque manche sert aussi Nodefony coupé à chaque étage
#   (`cut-probe.mjs`), et `cut-analyze.mjs` rend le coût de chaque étage.
# Sortie : tmp/wait/<camp>-<n>/{<pid>.json,wrk.txt} + le tableau (wait-analyze.mjs).
# ─────────────────────────────────────────────────────────────────────────────
set -u
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$DIR/../../../.." && pwd)"
WITNESS="${1:-nest-fair}"
PAIRS="${2:-3}"
BASE="${NF_WAIT_DIR:-$ROOT/tmp/wait}"
CONN="${BENCH_CONN:-128}"
DUR="${BENCH_DUR:-20}"
cd "$ROOT"
node src/nodefony/bin/nodefony stop >/dev/null 2>&1 || true
. "$DIR/kill-guard.sh"; kill_listeners 5151; kill_listeners 5161; sleep 1
. "$DIR/machine-regime.sh"

# run <label> <port> <xenv> <cmd…>
run() {
  local label=$1 port=$2 xenv=$3; shift 3
  local sampler=""
  # Sous NF_NATIVE_SAMPLE : la table adresse → fonction JS (`/tmp/perf-<pid>.map`)
  # qui NOMME les frames JIT anonymes de `sample` ; les frames interprétées
  # reçoivent chacune leur trampoline, donc leur nom aussi.
  local perf_flags=""
  [ -n "${NF_NATIVE_SAMPLE:-}" ] && perf_flags="--perf-basic-prof --interpreted-frames-native-stack"
  local out="$BASE/$label" url="http://127.0.0.1:$port${BENCH_PATH:-/nodefony/test/als-test/state}"
  rm -rf "$out"; mkdir -p "$out"
  attendre_machine_calme
  env NODE_ENV=production NF_LOG_DRIVER=null NF_BENCH_ROUTE=1 $xenv PORT=$port \
    NF_WAIT_PROBE_OUT="$out" \
    node --import "$DIR/wait-probe.mjs" $perf_flags "$@" >"$out/server.log" 2>&1 &
  local pid=$!
  for _ in $(seq 1 150); do curl -s -o /dev/null "$url" && break; sleep 0.2; done
  local code; code=$(curl -s -D "$out/headers.txt" -o /dev/null -w '%{http_code}' "$url")
  if [ "$code" != "200" ]; then
    echo "❌ $label : $url répond $code — rien ne serait valide"
    grep -o 'decor-probe: REFUS.*' "$out/server.log"
    kill -INT $pid 2>/dev/null; return 1
  fi
  # Serveur Nodefony : la garde de décor a rendu son verdict à la 1re requête.
  if [[ "$label" != "$WITNESS"-* ]]; then
    for _ in $(seq 1 20); do grep -q "decor-probe:" "$out/server.log" && break; sleep 0.1; done
    if ! grep -q "decor-probe: ok" "$out/server.log"; then
      echo "❌ $label : décor refusé — $(grep -o 'decor-probe:.*' "$out/server.log" || echo 'garde absente')"
      kill -INT $pid 2>/dev/null; return 1
    fi
  fi
  wrk -t4 -c"$CONN" -d10s "$url" >/dev/null
  kill -USR2 $pid
  if [ -n "${NF_NATIVE_SAMPLE:-}" ]; then
    # `sample` (macOS) suspend le fil à chaque relevé : le débit de CE run baisse,
    # mais également pour les deux camps — il sert à ATTRIBUER, pas à chiffrer.
    ( sleep 2; sample $pid 10 -file "$out/native.sample.txt" >/dev/null 2>&1 ) &
    sampler=$!
  fi
  wrk -t4 -c"$CONN" -d"${DUR}s" "$url" > "$out/wrk.txt"
  kill -USR2 $pid
  # attendre `sample` SEUL — un `wait` nu attendrait aussi le serveur (job `&`)
  [ -n "${sampler:-}" ] && wait "$sampler"
  for _ in $(seq 1 50); do ls "$out"/*.json >/dev/null 2>&1 && break; sleep 0.1; done
  kill -INT $pid; for _ in $(seq 1 50); do kill -0 $pid 2>/dev/null || break; sleep 0.2; done
  kill -0 $pid 2>/dev/null && { kill -TERM $pid; sleep 2; }
  # Toujours déplacer la table (même run refusé plus bas) : /tmp ne garde rien.
  if [ -n "$perf_flags" ] && [ -f "/tmp/perf-$pid.map" ]; then
    mv "/tmp/perf-$pid.map" "$out/perf.map"
  fi
  # Une coupe qui n'a pas pris mesurerait la requête complète sous un faux nom.
  if [ -n "${cut:-}" ] && ! grep -q "cut-probe: $cut" "$out/server.log"; then
    echo "❌ $label : la coupe « $cut » n'a pas été posée — voir $out/server.log"; return 1
  fi
  if grep -q "Non-2xx" "$out/wrk.txt"; then echo "❌ $label : non-2xx sous charge — invalide"; return 1; fi
  ls "$out"/*.json >/dev/null 2>&1 || { echo "❌ $label : la sonde n'a rien écrit"; return 1; }
  echo "$label : $(awk '/Requests\/sec/ {print $2}' "$out/wrk.txt") req/s"
}

NF_ENV="NF_WITH_DEV_MODULES=1 NF_WITH_DEV_MODULES_TTL_MIN=30"
for i in $(seq 1 "$PAIRS"); do
  cut=""
  run "nodefony-$i" 5151 "$NF_ENV" --import "$DIR/decor-probe.mjs" \
    src/nodefony/bin/nodefony production || exit 1
  for cut in ${NF_WAIT_CUTS:-}; do
    run "cut-$cut-$i" 5151 "$NF_ENV NF_BENCH_CUT=$cut NODE_OPTIONS=--import=$DIR/cut-probe.mjs" \
      --import "$DIR/decor-probe.mjs" src/nodefony/bin/nodefony production || exit 1
  done
  cut=""
  run "$WITNESS-$i" 5161 "" "$DIR/../bench-frameworks/$WITNESS.mjs" || exit 1
done
node "$DIR/wait-analyze.mjs" "$BASE" nodefony "$WITNESS"
# Le verdict de la bissection EST celui du script : un tableau refusé (code 3,
# dispersion) ne doit pas sortir en 0 derrière la ligne suivante.
status=0
if [ -n "${NF_WAIT_CUTS:-}" ]; then
  node "$DIR/cut-analyze.mjs" "$BASE" "$WITNESS" $NF_WAIT_CUTS || status=$?
fi
if [ -n "${NF_NATIVE_SAMPLE:-}" ]; then
  echo ""
  node "$DIR/native-sample.mjs" --dir "$BASE" nodefony "$WITNESS" "${NF_NATIVE_TOP:-40}"
fi
exit $status
