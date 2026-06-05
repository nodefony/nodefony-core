#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# Banc perf A/B — mono process PRODUCTION. Mesure le COÛT DU PIPELINE PAR REQUÊTE.
#
# Pourquoi mono prod : 1 process `production` sous wrk = CPU-bound (~119 % CPU) →
# le RPS reflète directement le travail par requête. Le cluster est co-location-
# bound (workers ~30 % CPU) → il ne montre PAS un gain CPU/req. Pour CHIFFRER une
# optim du pipeline, c'est ICI. (cf mémoire IA `reference_perf_profiling_method`.)
#
# Usage :
#   bash bench-ab-mono.sh <label> [KEY=VAL ...]
#     <label>   nom du run → médiane écrite dans /tmp/nf-bench-<label>.med
#     KEY=VAL   env vars passées AU SERVEUR (toggles A/B ; ex NF_BENCH_NO_QP=1)
#   Variables d'ajustement (env du script) :
#     BENCH_URL (défaut http://127.0.0.1:5151/nodefony/test/als-test/state)
#     BENCH_DUR (défaut 10 s par run wrk) · BENCH_CONN (128) · BENCH_THREADS (4)
#
# A/B ATOMIQUE (annule la dérive thermique) : lancer en paires ALTERNÉES, ex.
#   bash bench-ab-mono.sh old1 NF_BENCH_X=0 ; bash bench-ab-mono.sh new1 NF_BENCH_X=1
#   bash bench-ab-mono.sh old2 NF_BENCH_X=0 ; bash bench-ab-mono.sh new2 NF_BENCH_X=1
# puis comparer les médianes old* vs new*. Ne garder un gain que s'il DÉPASSE le
# bruit (±~3 %) ET que les deux new > les deux old (séparation nette).
#
# 🚨 BANC PROPRE (sinon mesures FAUSSES) :
#   - NODE_ENV=production est FORCÉ ici (sinon NODE_ENV ambient → dev+Vite+throttle
#     ~2000 RPS au lieu du vrai plafond). NF_LOG_DRIVER=null (pas d'I/O log).
#   - La route /als-test/state vit dans le module @nodefony/test, gaté `policy:"dev"`
#     → ABSENT en prod (404). Pour bencher : passer temporairement à
#     `{ name:"@nodefony/test", policy:"optional" }` dans nodefony.config.ts +
#     `npm run build`, puis REVERT en "dev" avant tout commit.
#   - Prérequis : `wrk` (brew install wrk) + build à jour (`npm run build`).
# ─────────────────────────────────────────────────────────────────────────────
set -u
ROOT="$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse --show-toplevel)"
LABEL="${1:-run}"; shift || true
EXTRA_ENV="$*"
URL="${BENCH_URL:-http://127.0.0.1:5151/nodefony/test/als-test/state}"
DUR="${BENCH_DUR:-10}"; CONN="${BENCH_CONN:-128}"; THREADS="${BENCH_THREADS:-4}"

command -v wrk >/dev/null 2>&1 || { echo "❌ wrk absent (brew install wrk)"; exit 1; }

# 1. banc propre : tuer ports + résidus Vite/serveur, attendre la libération
lsof -ti tcp:5151,5152,5173,5177 2>/dev/null | xargs kill -9 2>/dev/null
pkill -9 -f vite.js 2>/dev/null; pkill -9 -f "bin/nodefony" 2>/dev/null
node -e "const net=require('net');const t0=Date.now();(function p(){const s=net.connect(5151,'127.0.0.1');s.on('error',()=>{s.destroy();process.exit(0)});s.on('connect',()=>{s.destroy();if(Date.now()-t0>10000)process.exit(0);setTimeout(p,300)})})();" 2>/dev/null

# 2. spawn mono prod (detached), env forcé + toggles A/B
node -e "
const {spawn}=require('child_process');const fs=require('fs');
const out=fs.openSync('/tmp/nf-bench.log','w');
const extra={};('$EXTRA_ENV').split(' ').filter(Boolean).forEach(kv=>{const i=kv.indexOf('=');extra[kv.slice(0,i)]=kv.slice(i+1);});
const c=spawn('node',['src/nodefony/bin/nodefony','production'],{cwd:'$ROOT',env:{...process.env,NODE_ENV:'production',NF_LOG_DRIVER:'null',...extra},stdio:['ignore',out,out],detached:true});
c.unref();fs.writeFileSync('/tmp/nf-bench.pid',String(c.pid));process.exit(0);
"

# 3. attendre le boot (poll port 5151)
node -e "const net=require('net');const t0=Date.now();(function p(){const s=net.connect(5151,'127.0.0.1');s.on('error',()=>{s.destroy();if(Date.now()-t0>35000){console.log('BOOT TIMEOUT — voir /tmp/nf-bench.log');process.exit(1)}setTimeout(p,400)});s.on('connect',()=>{s.destroy();process.exit(0)})})();" || { echo "$LABEL: BOOT FAIL"; exit 1; }

# 4. warmup + 3× wrk → médiane
curl -s -o /dev/null "$URL"; curl -s -o /dev/null "$URL"
echo "=== $LABEL ($EXTRA_ENV) ==="
RPS=()
for i in 1 2 3; do
  R=$(wrk -t"$THREADS" -c"$CONN" -d"${DUR}s" "$URL" 2>/dev/null | grep "Requests/sec" | awk '{print $2}')
  echo "  run $i: $R RPS"; RPS+=("$R")
done
MED=$(printf '%s\n' "${RPS[@]}" | sort -n | sed -n '2p')
echo "  MÉDIANE: $MED RPS"
echo "$MED" > "/tmp/nf-bench-$LABEL.med"

# 5. arrêt gracieux (flush + libère les ports)
kill -INT "$(cat /tmp/nf-bench.pid)" 2>/dev/null
node -e "const t0=Date.now();(function p(){try{process.kill($(cat /tmp/nf-bench.pid),0);if(Date.now()-t0>10000)process.exit(0);setTimeout(p,400)}catch{process.exit(0)}})();" 2>/dev/null
