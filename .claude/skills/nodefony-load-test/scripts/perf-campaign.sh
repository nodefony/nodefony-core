#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# Campagne de mesure PUBLIABLE, sans surveillance — la matière de
# `docs/performance/data/<version>.json`, rejouée au protocole de la dernière
# publication : trois paires de débit, le cas applicatif, et une tenue longue.
#
# Pourquoi un orchestrateur. La mesure publiée exige une machine au REPOS pendant
# deux heures et plus — c'est-à-dire la nuit. Mais `bench-pairs.sh` range ses
# séries sous des noms fixes (`/tmp/nf-bench-<camp>-p<rang>.*`) et `express-fair`
# joue dans trois paires : sans rangement entre deux paires, la troisième écrase
# la matière des deux premières. Et une paire refusée pour dispersion (code 2)
# doit être REJOUÉE, pas oubliée — ce qu'aucun humain endormi ne fait.
#
# Ce qu'il ne fait PAS : composer le fichier publié. Choisir les paires
# retenues, relire le décor et écrire la provenance reste un geste d'auteur.
#
# Usage :
#   bash perf-campaign.sh [--at HH:MM] [--out DIR] [--soak-min 90] [--tries 3]
#                         [--only "étape étape…"]
#   caffeinate -dims bash perf-campaign.sh --at 01:30     # la nuit, poste éveillé
#
# Étapes (dans l'ordre joué) : parite · paire1 paire2 paire3 nest-fair nul ·
#   applicatif applicatif-nest post-express post-nest err-express err-nest
#   nul-orm · cpu-fil · soak. `--only` en rejoue un sous-ensemble dans un
#   NOUVEAU dossier : une pièce manquante se refait sans payer cinq heures.
#   ⚠️ Une pièce rejouée seule porte SON commit — le noter dans la provenance.
#
# Garde d'ÉQUITÉ : l'étape `parite` (fair-parity.mjs sur les quatre témoins
# équitables) ABANDONNE la campagne si un camp ne rend plus le même travail —
# un écart mesuré contre un témoin non équivalent n'est pas publiable.
#
# Sortie : DIR/campaign.log (le déroulé), DIR/<paire>-try<N>.log (verdict de
# bench-pairs), DIR/<paire>-try<N>/ (les séries brutes), DIR/soak.json.
# ─────────────────────────────────────────────────────────────────────────────
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
PAIRS="$ROOT/.claude/skills/nodefony-load-test/bench-frameworks/bench-pairs.sh"
SOAK="$ROOT/.claude/skills/nodefony-load-test/scripts/soak.mjs"
cd "$ROOT" || exit 1

AT=""; OUT="$ROOT/tmp/perf-campaign-$(date +%F)"; SOAK_MIN=90; TRIES=3; ONLY=""
while [ $# -gt 0 ]; do
  case "$1" in
    --at) AT="$2"; shift 2 ;;
    --out) OUT="$2"; shift 2 ;;
    --soak-min) SOAK_MIN="$2"; shift 2 ;;
    --tries) TRIES="$2"; shift 2 ;;
    --only) ONLY="$2"; shift 2 ;;
    *) echo "option inconnue : $1" >&2; exit 64 ;;
  esac
done
mkdir -p "$OUT"
LOG="$OUT/campaign.log"
log() { echo "[$(date +%H:%M:%S)] $*" | tee -a "$LOG"; }

if [ -n "$AT" ]; then
  # `date -j` (BSD) d'abord, `date -d` (GNU) sinon : la campagne se joue sur le
  # poste de référence, mais la grammaire ne doit pas le supposer.
  target=$(date -j -f "%H:%M" "$AT" +%s 2>/dev/null || date -d "$AT" +%s)
  now=$(date +%s)
  [ "$target" -le "$now" ] && target=$((target + 86400))
  log "attente jusqu'à $AT ($(( (target - now) / 60 )) min)"
  sleep $((target - now))
fi

log "provenance — HEAD $(git rev-parse --short=8 HEAD) · node $(node -v) · $(sysctl -n machdep.cpu.brand_string 2>/dev/null || uname -m)"
git status --porcelain | grep -q . && log "⚠️ arbre NON propre — le commit noté ne décrit pas exactement le code mesuré"

# Le camp nodefony tourne sur le `dist` : un build périmé mesurerait un autre code.
log "build complet"
if ! npm run build >"$OUT/build.log" 2>&1; then
  log "❌ build en échec — campagne abandonnée (voir build.log)"; exit 1
fi

want() { [ -z "$ONLY" ] || [[ " $ONLY " == *" $1 "* ]]; }

pair() { # nom campA campB [port] — rejoue jusqu'à TRIES fois une paire inconclusive
  local name="$1" a="$2" b="$3" port="${4:-}" try rc
  want "$name" || return 0
  for try in $(seq 1 "$TRIES"); do
    rm -f /tmp/nf-bench-*-p[12].* 2>/dev/null
    log "paire $name ($a ↔ $b) — essai $try/$TRIES"
    bash "$PAIRS" "$a" "$b" $port >"$OUT/$name-try$try.log" 2>&1
    rc=$?
    mkdir -p "$OUT/$name-try$try"
    mv /tmp/nf-bench-*-p[12].* "$OUT/$name-try$try/" 2>/dev/null
    log "  → code $rc · $(grep -aE 'SÉPARATION|DANS LE BRUIT|INCONCLUSIF|rapport' "$OUT/$name-try$try.log" | tail -2 | tr '\n' ' ')"
    # 0 = conclusif, 3 = DANS LE BRUIT : deux verdicts, qu'un nouvel essai ne
    # changerait pas. Seul 2 (une série refusée pour dispersion) se rejoue.
    [ "$rc" -eq 0 ] || [ "$rc" -eq 3 ] && return "$rc"
    [ "$rc" -ne 2 ] && { log "  ✗ échec du banc — pas de nouvel essai"; return "$rc"; }
    sleep 120   # laisser la machine redescendre avant de rejouer
  done
  log "  ✗ $name inconclusive après $TRIES essais"
  return 2
}

# ── équité : les quatre témoins rendent-ils le même travail que Nodefony ? ──
BF="$ROOT/.claude/skills/nodefony-load-test/bench-frameworks"
SEED="$ROOT/var/databases/nodefony-drizzle.db"
parite() {
  . "$ROOT/.claude/skills/nodefony-load-test/scripts/kill-guard.sh"
  node src/nodefony/bin/nodefony stop >/dev/null 2>&1; kill_listeners 5151; kill_listeners 5170
  NODE_ENV=production NF_LOG_DRIVER=null NF_BENCH_ROUTE=1 NF_BENCH_ORM=1 \
    NF_WITH_DEV_MODULES=1 NF_WITH_DEV_MODULES_TTL_MIN=30 \
    node src/nodefony/bin/nodefony production >"$OUT/parite-nodefony.log" 2>&1 &
  local nf=$! ok=0 camp
  for _ in $(seq 1 150); do curl -s -o /dev/null http://127.0.0.1:5151/nodefony/test/als-test/state && break; sleep 0.2; done
  # NF_PARITY_CAMPS : rejouer la garde sur d'autres camps (et la voir mordre).
  for camp in ${NF_PARITY_CAMPS:-express-fair nest-fair express-fair-sqlite nest-fair-sqlite}; do
    local routes="" db="/tmp/nf-parite-$camp.db"
    case "$camp" in *-sqlite) routes=orm; cp "$SEED" "$db" ;; esac
    NODE_ENV=production PORT=5170 NF_BENCH_SQLITE_DB="$db" node "$BF/$camp.mjs" >"$OUT/parite-$camp-serveur.log" 2>&1 &
    local cp=$!
    for _ in $(seq 1 100); do curl -s -o /dev/null http://127.0.0.1:5170/ && break; sleep 0.2; done
    if CAMP=$camp PARITY_ROUTES=$routes node "$BF/fair-parity.mjs" >"$OUT/parite-$camp.log" 2>&1; then
      log "  parité $camp ✅"
    else
      log "  parité $camp ❌ — voir parite-$camp.log"; ok=1
    fi
    kill $cp 2>/dev/null; wait $cp 2>/dev/null; rm -f "$db" "$db"-wal "$db"-shm
  done
  kill -INT $nf 2>/dev/null; wait $nf 2>/dev/null; kill_listeners 5151
  return $ok
}
if want parite; then
  log "parité des témoins équitables"
  parite || { log "❌ un témoin n'est plus équitable — campagne abandonnée"; exit 1; }
fi

# ── débit : le protocole publié (64 connexions, warmup 20 s, runs de 10 s) ──
export BENCH_CONN=64 BENCH_WARMUP=20 BENCH_DUR=10 BENCH_THREADS=4
pair paire1 express-fair nodefony
pair paire2 bare express-fair
pair paire3 express express-fair
# Le témoin NestJS équitable, face auquel #505 et #508 ont été jugés.
pair nest-fair nest-fair nodefony
# Test NUL : le banc ne voit-il pas d'écart entre un camp et lui-même ? Sans lui,
# aucune séparation de la nuit ne se distingue d'un biais de position.
pair nul nodefony nodefony

# ── cas applicatif : lecture + écriture, chaque camp sur SA copie du même seed ──
# Décor du banc ORM (#507, #510) : 25 connexions (le pilote SQLite est synchrone,
# au-delà on mesure une file), runs de 60 s (les points de reprise du journal
# SQLite tombent au hasard d'une fenêtre courte : à 30 s, 7 séries sur 8
# refusées face à NestJS), garde thermique à 20 (à 45, 3 séries sur 4 refusées
# en chauffe). Le seed est recopié AVANT chaque paire : aucun témoin n'hérite
# des écritures de la paire précédente.
orm() { # nom témoin [VAR=val…] — paire ORM au décor ci-dessus
  local name="$1" camp="$2"; shift 2
  want "$name" || return 0
  WITNESS_DB="$ROOT/tmp/bench/orm-witness.db"; mkdir -p "$(dirname "$WITNESS_DB")"
  cp "$SEED" "$WITNESS_DB"; rm -f "$WITNESS_DB-wal" "$WITNESS_DB-shm"
  env BENCH_CONN=25 BENCH_DUR=60 BENCH_WARMUP=20 BENCH_THERM_TARGET=20 \
    NF_BENCH_SQLITE_DB="$WITNESS_DB" "$@" \
    bash -c "$(declare -f log want pair); OUT='$OUT' LOG='$LOG' TRIES='$TRIES' PAIRS='$PAIRS' ONLY='$ONLY'; pair '$name' '$camp' nodefony-orm 5167"
}
RW="BENCH_PATH=/nodefony/test/bench-orm/read-write BENCH_EXPECT=lus"
VALID=(BENCH_PATH=/nodefony/test/bench-orm/read-write-valid BENCH_METHOD=POST BENCH_EXPECT=lus
  "BENCH_HEADER=Sec-Fetch-Site: same-origin" 'BENCH_BODY={"total_ht":200,"total_ttc":240,"ref":"FA-1"}')
# Corps invalide : les QUATRE violations du jeu de parité, pour que le chemin
# d'erreur sérialise la liste complète dans les trois camps.
INVALID=(BENCH_PATH=/nodefony/test/bench-orm/read-write-valid BENCH_METHOD=POST BENCH_EXPECT_STATUS=422 BENCH_EXPECT=Unprocessable
  "BENCH_HEADER=Sec-Fetch-Site: same-origin" 'BENCH_BODY={"total_ht":-1,"total_ttc":"x","ref":"0123456789012345678901234567890"}')
orm applicatif express-fair-sqlite $RW
orm applicatif-nest nest-fair-sqlite $RW
orm post-express express-fair-sqlite "${VALID[@]}"
orm post-nest nest-fair-sqlite "${VALID[@]}"
orm err-express express-fair-sqlite "${INVALID[@]}"
orm err-nest nest-fair-sqlite "${INVALID[@]}"
if want nul-orm; then
  env BENCH_CONN=25 BENCH_DUR=60 BENCH_WARMUP=20 BENCH_THERM_TARGET=20 $RW \
    bash -c "$(declare -f log want pair); OUT='$OUT' LOG='$LOG' TRIES='$TRIES' PAIRS='$PAIRS' ONLY=''; pair nul-orm nodefony-orm nodefony-orm"
fi

# ── l'arbitre des écarts fins : CPU du fil principal par requête (#508) ──
# Le débit rend un rapport ; ce banc dit où il se joue, à ±1 %.
if want cpu-fil; then
  log "CPU du fil principal — wait-compare nest-fair 3"
  NF_WAIT_DIR="$OUT/cpu-fil" BENCH_CONN=64 bash "$ROOT/.claude/skills/nodefony-load-test/scripts/wait-compare.sh" nest-fair 3 \
    >"$OUT/cpu-fil.log" 2>&1
  log "  → code $?"
fi

# ── tenue dans la durée : les ÉCHANTILLONS, jamais un résumé ──
if want soak; then
  log "soak ${SOAK_MIN} min"
  node "$SOAK" --minutes "$SOAK_MIN" --window 60 --conn 64 --out "$OUT/soak.json" >"$OUT/soak.log" 2>&1
  log "  → soak code $? · $(grep -aE 'VERDICT|verdict' "$OUT/soak.log" | tail -1)"
fi

# Un commit pendant la nuit et le code mesuré n'est plus celui noté au départ.
log "HEAD en fin de campagne : $(git rev-parse --short=8 HEAD)"

log "campagne terminée — composer docs/performance/data/<version>.json depuis $OUT"
