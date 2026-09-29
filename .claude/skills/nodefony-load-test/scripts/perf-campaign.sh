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
#   caffeinate -dims bash perf-campaign.sh --at 01:30     # la nuit, poste éveillé
#
# Sortie : DIR/campaign.log (le déroulé), DIR/<paire>-try<N>.log (verdict de
# bench-pairs), DIR/<paire>-try<N>/ (les séries brutes), DIR/soak.json.
# ─────────────────────────────────────────────────────────────────────────────
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
PAIRS="$ROOT/.claude/skills/nodefony-load-test/bench-frameworks/bench-pairs.sh"
SOAK="$ROOT/.claude/skills/nodefony-load-test/scripts/soak.mjs"
cd "$ROOT" || exit 1

AT=""; OUT="$ROOT/tmp/perf-campaign-$(date +%F)"; SOAK_MIN=90; TRIES=3
while [ $# -gt 0 ]; do
  case "$1" in
    --at) AT="$2"; shift 2 ;;
    --out) OUT="$2"; shift 2 ;;
    --soak-min) SOAK_MIN="$2"; shift 2 ;;
    --tries) TRIES="$2"; shift 2 ;;
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

pair() { # nom campA campB [port] — rejoue jusqu'à TRIES fois une paire inconclusive
  local name="$1" a="$2" b="$3" port="${4:-}" try rc
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

# ── débit : le protocole publié (64 connexions, warmup 20 s, runs de 10 s) ──
export BENCH_CONN=64 BENCH_WARMUP=20 BENCH_DUR=10 BENCH_THREADS=4
pair paire1 express-fair nodefony
pair paire2 bare express-fair
pair paire3 express express-fair
# Hors du fichier publié jusqu'ici : le témoin NestJS équitable, face auquel
# #505 a été jugé. Mesuré dans la même nuit, il se compare aux trois autres.
pair nest-fair nest-fair nodefony

# ── cas applicatif : lecture + écriture, chaque camp sur SA copie du même seed ──
cp var/databases/nodefony-drizzle.db /tmp/bench-express.db
BENCH_PATH=/nodefony/test/bench-orm/read-write BENCH_EXPECT=lus \
  NF_BENCH_SQLITE_DB=/tmp/bench-express.db BENCH_CONN=25 BENCH_DUR=30 BENCH_WARMUP=20 \
  pair applicatif express-fair-sqlite nodefony-orm 5167

# ── tenue dans la durée : les ÉCHANTILLONS, jamais un résumé ──
log "soak ${SOAK_MIN} min"
node "$SOAK" --minutes "$SOAK_MIN" --window 60 --conn 64 --out "$OUT/soak.json" >"$OUT/soak.log" 2>&1
log "  → soak code $? · $(grep -aE 'VERDICT|verdict' "$OUT/soak.log" | tail -1)"

log "campagne terminée — composer docs/performance/data/<version>.json depuis $OUT"
