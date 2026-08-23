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
#               (+ détail min/méd/max/dispersion/thermal dans …-<label>.json)
#     KEY=VAL   env vars passées AU SERVEUR (toggles A/B ; ex NF_BENCH_NO_QP=1)
#   bash bench-ab-mono.sh purge
#     supprime TOUS les /tmp/nf-bench-*.{med,json} — À FAIRE entre deux lots :
#     un .med survivant d'un lot précédent entre dans une comparaison qui ne le
#     concerne pas (vécu : 7 survivants de 3 lots différents dans /tmp).
#   Variables d'ajustement (env du script) :
#     BENCH_URL (défaut http://127.0.0.1:5151/nodefony/kernel/bench)
#     BENCH_HEADER (header HTTP passé à wrk ET au check de cible — ex
#       BENCH_HEADER="Cookie: nodefony=abc" pour bencher une route AUTHENTIFIÉE ;
#       sans lui la cible répond 401/302 et le check refuse de mesurer)
#     BENCH_DUR (défaut 10 s par run wrk) · BENCH_CONN (128) · BENCH_THREADS (4)
#     BENCH_WARMUP (défaut 5 s de wrk NON compté — le run 1 d'une série froide
#     est presque toujours le plus bas, 10 séries sur 12 : deux `curl` ne
#     chauffent pas un JIT)
#
# VALIDITÉ (en plus de « cible 200 + 0 erreur ») :
#   - dispersion (max-min)/méd des 3 runs > 3 % → fenêtre instable, mesure
#     REFUSÉE (exit 1, .med supprimé). Le seuil de décision A/B est ±3 % : une
#     série plus dispersée que le seuil ne peut trancher personne.
#   - thermal level macOS noté AVANT/APRÈS (sysctl machdep.xcpm.cpu_thermal_level) :
#     l'ABSOLU d'un i9 mobile varie de 30 % selon l'état thermique — deux séries
#     à thermal très différents ne se comparent pas entre elles.
#
# A/B ATOMIQUE (annule la dérive thermique) : lancer en paires ALTERNÉES, ex.
#   bash bench-ab-mono.sh old1 NF_BENCH_X=0 ; bash bench-ab-mono.sh new1 NF_BENCH_X=1
#   bash bench-ab-mono.sh old2 NF_BENCH_X=0 ; bash bench-ab-mono.sh new2 NF_BENCH_X=1
# puis comparer les médianes old* vs new*. Ne garder un gain que s'il DÉPASSE le
# bruit (±~3 %) ET que les deux new > les deux old (séparation nette).
# 🔌 AVANT de comparer deux médianes : vérifier que leur `cpuRegime` (JSON
#    compagnon) est IDENTIQUE. Batterie ↔ secteur change les absolus de ~60 %
#    sans toucher ni au code ni à la dispersion — l'écart se lit alors comme un
#    gain spectaculaire. Une série qui change de régime en cours de route est à
#    JETER en entier, pas à rattraper.
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
# LC_ALL=C : en locale fr, printf awk rend « 4,1 » (virgule) → la comparaison
# numérique de la garde dispersion lit « 3 » et ne mord plus entre 3 et 4 %,
# et le JSON compagnon devient invalide. Vu mordre au test du 08-05.
export LC_ALL=C
ROOT="$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse --show-toplevel)"
LABEL="${1:-run}"; shift || true
EXTRA_ENV="$*"

# purge : à lancer ENTRE deux lots — aucun .med/.json d'un lot précédent ne doit
# survivre dans une comparaison qui ne le concerne pas.
if [ "$LABEL" = "purge" ]; then
  rm -f /tmp/nf-bench-*.med /tmp/nf-bench-*.json
  echo "purge: /tmp/nf-bench-*.{med,json} supprimés"
  exit 0
fi

# thermal level macOS (n/a ailleurs) — l'absolu d'un i9 mobile varie de 30 %
# selon l'état thermique ; noter AVANT/APRÈS rend la fenêtre comparable ou non.
therm() { sysctl -n machdep.xcpm.cpu_thermal_level 2>/dev/null || echo "n/a"; }

# ⚡ RÉGIME CPU — le thermal ne dit RIEN du plafond de fréquence, et c'est le
# piège le plus coûteux du banc : macOS active `lowpowermode` TOUT SEUL sur
# batterie (`pmset -g custom`), ce qui bride le Turbo Boost. Mesuré le 08-06 sur
# un code IDENTIQUE : 7 800 RPS sur batterie contre 12 600 sur secteur, soit
# ×1,62 — avec des dispersions intra-série PARFAITES des deux côtés (0,4 % et
# 1,6 %). Un CPU bridé tient un plafond bas sans effort : la fenêtre la plus
# STABLE était la plus FAUSSE, et aucune garde existante ne la voyait.
#
# Le régime est donc noté dans le JSON compagnon, et un run lancé bridé
# l'ANNONCE — ses absolus ne se comparent à aucune fenêtre débridée. On lit
# `lowpowermode` et pas seulement la prise : il peut être forcé à la main SUR
# secteur, auquel cas la source d'alimentation seule mentirait.
power_source() {
  pmset -g ps 2>/dev/null | head -1 | grep -o "AC Power\|Battery Power" || echo "n/a"
}
low_power() { pmset -g 2>/dev/null | awk '/lowpowermode/{print $2}'; }
# Régime compact « AC Power/lpm=0 » — à comparer entre DEUX labels d'un même
# A/B : s'ils diffèrent, les médianes ne sont pas comparables (cf en-tête A/B).
cpu_regime() {
  local p l; p=$(power_source); l=$(low_power)
  [ "$p" = "n/a" ] && { echo "n/a"; return 0; }
  echo "$p/lpm=${l:-?}"
}
warn_if_throttled() {
  local p l; p=$(power_source); l=$(low_power)
  if [ "$p" = "Battery Power" ] || [ "$l" = "1" ]; then
    echo "  ⚠️  CPU BRIDÉ ($(cpu_regime)) — Turbo limité, absolus NON publiables."
    echo "      Un A/B dont les deux côtés ne partagent pas ce régime est FAUX (~60 %)."
  fi
}

# cooldown : attendre que le CPU repasse sous BENCH_THERM_TARGET — UNE fois,
# AVANT la série (chaque label part du même état thermique). ⚠️ JAMAIS entre les
# runs d'une série : une pause > ~2 min endort le serveur détaché idle (App Nap /
# idle states macOS) et le run suivant paie le réveil — reproduit 3/3 : −13 à
# −15 % sur le run d'après (8209/8302/8502 vs ~9800), température pourtant basse.
# Entre les runs : pause courte FIXE (10 s) — machine calme, la rampe thermique
# intra-série est faible (28→35 sur 2 runs). no-op si sysctl absent (Linux).
#
# ⚠️ Cible 45 = point de DÉPART, pas une garantie : sur SECTEUR (turbo débridé),
# la rampe intra-série atteint ~20 points en trois runs de 10 s — partie de 43,
# la série finit à 60 et le 3ᵉ run décroche (dispersion 4,6 puis 13,6 % le
# 08-06, mesures refusées). Repartir de 35 AVEC des runs plus courts a rendu
# 0,9 % et 0,4 % sur la même machine : `BENCH_THERM_TARGET=35 BENCH_DUR=7`.
THERM_TARGET="${BENCH_THERM_TARGET:-45}"
COOLED=0
cooldown() {
  local t; t=$(therm); [ "$t" = "n/a" ] && return 0
  local waited=0
  while [ "$t" -gt "$THERM_TARGET" ] && [ "$waited" -lt 180 ]; do
    sleep 10; waited=$((waited+10)); t=$(therm)
  done
  if [ "$waited" -gt 0 ]; then
    echo "  (cooldown ${waited}s → thermal $t)"
    COOLED=1   # la pause a endormi le serveur → le warmup devra absorber le réveil
  fi
  return 0
}
# 🎯 UNE SEULE CIBLE DE BANC APPLICATIF : `/nodefony/kernel/bench`
# (`BenchController`, module `@nodefony/framework`), qui n'existe que sous
# `NF_BENCH_ROUTE=1` — drapeau posé automatiquement au spawn, plus bas.
#
# C'est une route faite EXPRÈS pour ça : un controller ordinaire qui rend un corps
# FIGÉ (`Object.freeze`, aucune allocation par requête), monté HORS de l'aire admin
# (`/nodefony/kernel/bench` n'a pas de segment `/api/` → aucune zone firewall ne
# matche). Elle emprunte donc le chemin d'une route applicative normale — routing,
# contexte, sérialisation, réponse — et rien d'autre. C'est ce « rien d'autre » qui
# fait la mesure.
#
# Ne PAS lui substituer :
#   • `/nodefony/kernel/api/livez` — traverse EN PLUS la résolution de zone, un
#     authenticator et le broker d'administration, et son handler appelle
#     `getBootReport()`. On mesurerait l'étage admin en croyant mesurer le pipeline.
#   • une route de `@nodefony/test` (`policy:"dev"`) — ABSENTE en production : le
#     banc tapait un 404, plus rapide qu'une vraie réponse, sans que rien ne le dise.
#
# Seule exception : la comparaison INTER-FRAMEWORKS (`bench-frameworks/`), où les
# apps bare/express/fastify répliquent CE payload et le décor de routing (186 routes,
# cible en #31) — passer alors `BENCH_URL` explicitement.
URL="${BENCH_URL:-http://127.0.0.1:5151/nodefony/kernel/bench}"
DUR="${BENCH_DUR:-10}"; CONN="${BENCH_CONN:-128}"; THREADS="${BENCH_THREADS:-4}"
# Header optionnel (route authentifiée). Array vide + set -u : bash 3.2 (macOS)
# jette « unbound variable » sur "${a[@]}" vide → expansion conditionnelle.
WRK_HDR=()
[ -n "${BENCH_HEADER:-}" ] && WRK_HDR=(-H "$BENCH_HEADER")

command -v wrk >/dev/null 2>&1 || { echo "❌ wrk absent (brew install wrk)"; exit 1; }

# 1. banc propre : tuer ports + résidus Vite/serveur, attendre la libération.
# ⚠️ PASSER PAR `kill-guard.sh`, jamais par un `lsof | xargs kill -9` nu : ce
# bloc a déjà SIGKILLé le `claude` qui lançait le banc (session perdue, aucune
# trace). Les deux gardes — `-sTCP:LISTEN` et la liste d'épargne — et le pourquoi
# de chacune sont documentés dans ce fichier.
. "$(dirname "${BASH_SOURCE[0]}")/kill-guard.sh"
kill_listeners 5151 5152 5173 5177
kill_by_cmdline vite.js "bin/nodefony"
node -e "const net=require('net');const t0=Date.now();(function p(){const s=net.connect(5151,'127.0.0.1');s.on('error',()=>{s.destroy();process.exit(0)});s.on('connect',()=>{s.destroy();if(Date.now()-t0>10000)process.exit(0);setTimeout(p,300)})})();" 2>/dev/null

# 2. spawn mono prod (detached), env forcé + toggles A/B
node -e "
const {spawn}=require('child_process');const fs=require('fs');
const out=fs.openSync('/tmp/nf-bench.log','w');
const extra={};('$EXTRA_ENV').split(' ').filter(Boolean).forEach(kv=>{const i=kv.indexOf('=');extra[kv.slice(0,i)]=kv.slice(i+1);});
// NF_BENCH_ROUTE=1 : monte la cible de banc (\`/nodefony/kernel/bench\`). Posé ici
// et pas laissé à l'appelant — l'oublier donne un 404, et un 404 répond PLUS VITE
// qu'une vraie route. Un toggle A/B explicite peut toujours l'écraser (…extra).
const c=spawn('node',['src/nodefony/bin/nodefony','production'],{cwd:'$ROOT',env:{...process.env,NODE_ENV:'production',NF_LOG_DRIVER:'null',NF_BENCH_ROUTE:'1',...extra},stdio:['ignore',out,out],detached:true});
c.unref();fs.writeFileSync('/tmp/nf-bench.pid',String(c.pid));process.exit(0);
"

# 3. attendre le boot (poll port 5151)
node -e "const net=require('net');const t0=Date.now();(function p(){const s=net.connect(5151,'127.0.0.1');s.on('error',()=>{s.destroy();if(Date.now()-t0>35000){console.log('BOOT TIMEOUT — voir /tmp/nf-bench.log');process.exit(1)}setTimeout(p,400)});s.on('connect',()=>{s.destroy();process.exit(0)})})();" || { echo "$LABEL: BOOT FAIL"; rm -f "/tmp/nf-bench-$LABEL.med" "/tmp/nf-bench-$LABEL.json"; exit 1; }

# 4. VÉRIFICATION DE LA CIBLE (avant toute mesure)
# 🚨 wrk compte les 404/500 dans son `Requests/sec`. Or une erreur répond PLUS VITE
# qu'une vraie route (ni resolver, ni controller, ni sérialisation) : un banc qui
# tape du 404 publie un chiffre FLATTEUR, et un A/B dont un côté est en 404 conclut
# à l'ENVERS. Le piège est réel ici — la route de bench vit dans un module `policy:"dev"`,
# donc absente en production tant qu'on ne l'a pas rebasculée (cf en-tête).
CODE=$(curl -s -o /dev/null -w '%{http_code}' ${WRK_HDR[@]+"${WRK_HDR[@]}"} "$URL")
if [ "$CODE" != "200" ]; then
  echo "❌ $LABEL: la cible répond $CODE (attendu 200) — AUCUNE mesure ne serait valide."
  echo "   URL: $URL"
  echo "   Si c'est un 404 : le module @nodefony/test est en policy:\"dev\" donc absent"
  echo "   en production → passer temporairement à policy:\"optional\" + npm run build."
  rm -f "/tmp/nf-bench-$LABEL.med" "/tmp/nf-bench-$LABEL.json"
  kill -INT "$(cat /tmp/nf-bench.pid)" 2>/dev/null
  exit 1
fi

echo "=== $LABEL ($EXTRA_ENV) ==="
cooldown
THERM_BEFORE=$(therm)
REGIME=$(cpu_regime)
warn_if_throttled

# warmup wrk NON compté : chauffe le JIT (inlining, hidden classes, caches du
# resolver) — sans lui le run 1 est presque toujours le plus bas et tire la
# médiane de 3 vers le bas. Si un cooldown a eu lieu, la pause a endormi le
# serveur (App Nap/idle) : doubler le warmup pour absorber AUSSI le réveil
# (vécu : 5 s insuffisant après 130 s de pause → run 1 à −11 %).
WARMUP="${BENCH_WARMUP:-5}"
[ "$COOLED" = "1" ] && WARMUP=$((WARMUP * 2))
wrk -t"$THREADS" -c"$CONN" -d"${WARMUP}s" ${WRK_HDR[@]+"${WRK_HDR[@]}"} "$URL" >/dev/null 2>&1
echo "  warmup: ${WARMUP}s wrk non compté · thermal avant: $THERM_BEFORE · régime: $REGIME"

RPS=(); BAD=0
for i in 1 2 3; do
  [ "$i" -gt 1 ] && sleep 10
  OUT=$(wrk -t"$THREADS" -c"$CONN" -d"${DUR}s" ${WRK_HDR[@]+"${WRK_HDR[@]}"} "$URL" 2>/dev/null)
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
THERM_AFTER=$(therm)
if [ "$BAD" = "1" ]; then
  echo "  ✖ $LABEL: run(s) pollué(s) par des erreurs — médiane NON enregistrée."
  echo "    Un débit mesuré sous erreurs n'est comparable à rien."
  rm -f "/tmp/nf-bench-$LABEL.med" "/tmp/nf-bench-$LABEL.json"
  kill -INT "$(cat /tmp/nf-bench.pid)" 2>/dev/null
  exit 1
fi
MIN=$(printf '%s\n' "${RPS[@]}" | sort -n | sed -n '1p')
MED=$(printf '%s\n' "${RPS[@]}" | sort -n | sed -n '2p')
MAX=$(printf '%s\n' "${RPS[@]}" | sort -n | sed -n '3p')
DISP=$(awk -v min="$MIN" -v max="$MAX" -v med="$MED" 'BEGIN{printf "%.1f", (max-min)/med*100}')
echo "  min/méd/max: $MIN / $MED / $MAX RPS · dispersion ${DISP} % · thermal avant/après: $THERM_BEFORE/$THERM_AFTER"

# Dispersion > 3 % = la fenêtre est plus bruyante que le seuil de décision A/B :
# cette série ne peut trancher AUCUNE comparaison — la refuser, pas la publier.
if awk -v d="$DISP" 'BEGIN{exit !(d > 3)}'; then
  echo "  ✖ $LABEL: dispersion ${DISP} % > 3 % — fenêtre instable, mesure NON enregistrée."
  echo "    (autre process sur la machine ? throttling ? relancer sur fenêtre calme)"
  rm -f "/tmp/nf-bench-$LABEL.med" "/tmp/nf-bench-$LABEL.json"
  kill -INT "$(cat /tmp/nf-bench.pid)" 2>/dev/null
  exit 1
fi
echo "  MÉDIANE: $MED RPS  (cible vérifiée 200, 0 erreur, dispersion ≤ 3 %)"
echo "$MED" > "/tmp/nf-bench-$LABEL.med"
printf '{"label":"%s","env":"%s","rps":[%s],"min":%s,"med":%s,"max":%s,"dispersionPct":%s,"thermalBefore":"%s","thermalAfter":"%s","cpuRegime":"%s","warmupSec":%s,"durSec":%s,"conn":%s,"threads":%s,"url":"%s"}\n' \
  "$LABEL" "$EXTRA_ENV" "$(printf '%s,' "${RPS[@]}" | sed 's/,$//')" \
  "$MIN" "$MED" "$MAX" "$DISP" "$THERM_BEFORE" "$THERM_AFTER" "$REGIME" \
  "$WARMUP" "$DUR" "$CONN" "$THREADS" "$URL" > "/tmp/nf-bench-$LABEL.json"

# 5. arrêt gracieux (flush + libère les ports)
kill -INT "$(cat /tmp/nf-bench.pid)" 2>/dev/null
node -e "const t0=Date.now();(function p(){try{process.kill($(cat /tmp/nf-bench.pid),0);if(Date.now()-t0>10000)process.exit(0);setTimeout(p,400)}catch{process.exit(0)}})();" 2>/dev/null
