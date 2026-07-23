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
#   - Cible par défaut = `/nodefony/kernel/api/livez` (framework, publique, sans
#     session ni ORM) : disponible en PRODUCTION telle quelle, plus rien à rebasculer.
#     Ne PAS revenir sur une route de `@nodefony/test` (`policy:"dev"`) : absente en
#     prod, elle faisait bencher un 404 — plus rapide qu'une vraie réponse.
#   - Prérequis : `wrk` (brew install wrk) + build à jour (`npm run build`).
# ─────────────────────────────────────────────────────────────────────────────
set -u
ROOT="$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse --show-toplevel)"
LABEL="${1:-run}"; shift || true
EXTRA_ENV="$*"
# ⚠️ DEUX USAGES, DEUX CIBLES — ne pas les mélanger :
#   1. A/B du pipeline Nodefony CONTRE LUI-MÊME (l'usage de ce script) → `livez`,
#      ci-dessous. Toujours disponible, aucun module dev requis. Seul compte que les
#      deux côtés du A/B tapent LA MÊME route.
#   2. Comparaison INTER-FRAMEWORKS (bench-frameworks/) → surtout PAS `livez` : les
#      apps bare/express/fastify servent le payload d'`AlsController.state` et
#      répliquent le décor de routing (186 routes, cible en #31) pour comparer à
#      conditions égales. `livez` a un autre handler (il appelle `getBootReport()`),
#      un autre corps, un autre décor → mettre son RPS dans le même tableau serait
#      exactement le « chiffre sur du vent » que ce skill traque. Passer alors
#      `BENCH_URL` explicitement sur la route au payload équivalent.
#
# Cible par défaut = route du FRAMEWORK (`KernelAdminApi`), pas du module de test.
# `livez` est publique (`public: true`), sans session, sans ORM, corps JSON minimal :
# elle existe en PRODUCTION sans rien rebasculer. L'ancienne cible vivait dans
# `@nodefony/test` (`policy:"dev"`), donc absente en prod → on benchait un 404 sans
# le voir. Une cible de bench doit appartenir à ce qu'on mesure.
URL="${BENCH_URL:-http://127.0.0.1:5151/nodefony/kernel/api/livez}"
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

# 4. VÉRIFICATION DE LA CIBLE (avant toute mesure)
# 🚨 wrk compte les 404/500 dans son `Requests/sec`. Or une erreur répond PLUS VITE
# qu'une vraie route (ni resolver, ni controller, ni sérialisation) : un banc qui
# tape du 404 publie un chiffre FLATTEUR, et un A/B dont un côté est en 404 conclut
# à l'ENVERS. Le piège est réel ici — la route de bench vit dans un module `policy:"dev"`,
# donc absente en production tant qu'on ne l'a pas rebasculée (cf en-tête).
CODE=$(curl -s -o /dev/null -w '%{http_code}' "$URL")
if [ "$CODE" != "200" ]; then
  echo "❌ $LABEL: la cible répond $CODE (attendu 200) — AUCUNE mesure ne serait valide."
  echo "   URL: $URL"
  echo "   Si c'est un 404 : le module @nodefony/test est en policy:\"dev\" donc absent"
  echo "   en production → passer temporairement à policy:\"optional\" + npm run build."
  kill -INT "$(cat /tmp/nf-bench.pid)" 2>/dev/null
  exit 1
fi
curl -s -o /dev/null "$URL"   # 2ᵉ warmup, cible déjà validée

echo "=== $LABEL ($EXTRA_ENV) ==="
RPS=(); BAD=0
for i in 1 2 3; do
  OUT=$(wrk -t"$THREADS" -c"$CONN" -d"${DUR}s" "$URL" 2>/dev/null)
  R=$(printf '%s' "$OUT" | grep "Requests/sec" | awk '{print $2}')
  # wrk n'affiche cette ligne QUE s'il y a eu des réponses hors 2xx/3xx.
  NON2XX=$(printf '%s' "$OUT" | grep "Non-2xx or 3xx responses" | awk '{print $NF}')
  ERRS=$(printf '%s' "$OUT" | grep "Socket errors" || true)
  if [ -n "$NON2XX" ] || [ -n "$ERRS" ]; then
    echo "  run $i: $R RPS  ⚠ INVALIDE — ${NON2XX:-0} réponses hors 2xx/3xx ${ERRS:+· $ERRS}"
    BAD=1
  else
    echo "  run $i: $R RPS"
  fi
  RPS+=("$R")
done
if [ "$BAD" = "1" ]; then
  echo "  ✖ $LABEL: run(s) pollué(s) par des erreurs — médiane NON enregistrée."
  echo "    Un débit mesuré sous erreurs n'est comparable à rien."
  kill -INT "$(cat /tmp/nf-bench.pid)" 2>/dev/null
  exit 1
fi
MED=$(printf '%s\n' "${RPS[@]}" | sort -n | sed -n '2p')
echo "  MÉDIANE: $MED RPS  (cible vérifiée 200, 0 erreur)"
echo "$MED" > "/tmp/nf-bench-$LABEL.med"

# 5. arrêt gracieux (flush + libère les ports)
kill -INT "$(cat /tmp/nf-bench.pid)" 2>/dev/null
node -e "const t0=Date.now();(function p(){try{process.kill($(cat /tmp/nf-bench.pid),0);if(Date.now()-t0>10000)process.exit(0);setTimeout(p,400)}catch{process.exit(0)}})();" 2>/dev/null
