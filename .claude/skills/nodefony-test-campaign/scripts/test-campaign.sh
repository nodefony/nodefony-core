#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# Campagne de test SANS SURVEILLANCE — la matière de
# `docs/qualite/data/<version>.json`, pour les étages qui se jouent sans
# jugement, dans l'ordre du protocole (SKILL.md § « La matrice ») :
#
#   A   socle + dialectes — SANS les micro-bancs (cf C1 plus bas)
#   B   charge + mémoire
#   C1c boot réel de la CLI           — serveur de dev ÉTEINT, après B
#   C1b cluster e2e (fork de vrais process) — la machine pour lui seul
#   C2  sondes de rupture WS          — épuisent les ports éphémères, isolées ; serveur de dev DÉMARRÉ
#   E   ce que le scaffold produit    — verify-generated --keep puis verify-runtime
#   G   ce qu'un installeur reçoit    — release:pack puis release:smoke
#
# Ce qu'il ne joue PAS, et pourquoi :
#   C1  micro-bancs (`NF_RUN_PERF`) : SEULS, machine au repos. Ouverts avec le
#       socle (campagne du 2026-11-16), ils l'ont saturé — les tests de durée
#       d'`Injector`/`Tools`, qui tournent TOUJOURS, sont tombés avec eux ;
#   C3  arrête et relance des conteneurs : s'annonce, puis se contrôle après ;
#   D   les bancs se jouent par LOTS, destructeurs en dernier, décor par banc ;
#   F   un banc multi-pods se monte et se lit.
# Ni ne compose le fichier publié : instruire chaque rouge reste un geste
# d'auteur (arbre de décision du SKILL.md).
#
# Un étage rouge n'arrête PAS la campagne : les étages sont indépendants, et un
# rouge de la nuit s'instruit le matin. Seul le build abandonne — un dist
# périmé ferait tester un autre code.
#
# Usage :
#   bash test-campaign.sh [--at HH:MM] [--out DIR] [--only "A B …"]
#   nohup caffeinate -dims bash test-campaign.sh --at 01:30 >/dev/null 2>&1 &
#
# Sortie : DIR/campaign.log (déroulé, un code de sortie par étage, lu SANS
# pipe), DIR/<étage>.log (la sortie ENTIÈRE). Défaut :
# tmp/runs/test-campaign-<date> (catégorie `runs` de scripts/repo/tmp-layout.mjs).
# ─────────────────────────────────────────────────────────────────────────────
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
cd "$ROOT" || exit 1

AT=""; OUT="$ROOT/tmp/runs/test-campaign-$(date +%F)"; ONLY=""
while [ $# -gt 0 ]; do
  case "$1" in
    --at) AT="$2"; shift 2 ;;
    --out) OUT="$2"; shift 2 ;;
    --only) ONLY="$2"; shift 2 ;;
    *) echo "option inconnue : $1" >&2; exit 64 ;;
  esac
done
mkdir -p "$OUT"
LOG="$OUT/campaign.log"
log() { echo "[$(date +%H:%M:%S)] $*" | tee -a "$LOG"; }
want() { [ -z "$ONLY" ] || [[ " $ONLY " == *" $1 "* ]]; }

if [ -n "$AT" ]; then
  # `date -j` (BSD) d'abord, `date -d` (GNU) sinon.
  target=$(date -j -f "%H:%M" "$AT" +%s 2>/dev/null || date -d "$AT" +%s)
  now=$(date +%s)
  [ "$target" -le "$now" ] && target=$((target + 86400))
  log "attente jusqu'à $AT ($(( (target - now) / 60 )) min)"
  sleep $((target - now))
fi

log "provenance — HEAD $(git rev-parse --short=8 HEAD) · node $(node -v) · $(sysctl -n machdep.cpu.brand_string 2>/dev/null || uname -m)"
git status --porcelain | grep -q . && log "⚠️ arbre NON propre — le commit noté ne décrit pas exactement le code testé"

# Deux applications peuvent écouter le même port sur macOS sans erreur : un
# serveur de dev oublié recevrait le trafic des bancs. On l'arrête, et on le
# CONSTATE.
stop_dev() {
  node src/nodefony/bin/nodefony stop >/dev/null 2>&1
  if lsof -nP -iTCP:5151,5152 -sTCP:LISTEN >/dev/null 2>&1; then
    log "⚠️ 5151/5152 encore écoutés : $(lsof -nP -iTCP:5151,5152 -sTCP:LISTEN | tail -n +2 | awk '{print $1"/"$2}' | sort -u | tr '\n' ' ')"
    return 1
  fi
}

stage() { # id commande… — sortie entière dans DIR/<id>.log, code lu sans pipe
  local id="$1"; shift
  want "$id" || return 0
  stop_dev || { log "$id ✗ SAUTÉ — ports du serveur de dev occupés"; return 0; }
  log "$id — $*"
  local t0=$(date +%s)
  "$@" >"$OUT/$id.log" 2>&1
  local rc=$?
  echo "EXIT=$rc" >>"$OUT/$id.log"
  log "  → $id code $rc en $(( ($(date +%s) - t0) / 60 )) min"
}

# Les étages A, B, C1b et G parlent à des conteneurs : un démon absent les
# ferait tous tomber, et un étage qui tombe sur son décor n'a rien prouvé.
if ! docker info >/dev/null 2>&1; then
  log "démon Docker absent — démarrage de Docker Desktop"
  open -a Docker 2>/dev/null
  for _ in $(seq 1 60); do docker info >/dev/null 2>&1 && break; sleep 5; done
  docker info >/dev/null 2>&1 || { log "❌ démon Docker injoignable après 5 min — campagne abandonnée"; exit 1; }
  log "  démon Docker prêt"
fi

log "build complet"
if ! npm run build >"$OUT/build.log" 2>&1; then
  log "❌ build en échec — campagne abandonnée (voir build.log)"; exit 1
fi

stage A npm run test:all -- --dialects
stage B npm run test:all -- --load
stage C1c npm run test:boot

# Les URL Redis viennent de la SEULE source des variables d'infra.
REDIS_ENV=$(npx tsx -e 'import { REDIS_GATE } from "./scripts/test/vitest/gates.ts"; for (const [k, v] of Object.entries(REDIS_GATE.values())) console.log(`${k}=${v}`);' 2>/dev/null)
if [ -n "$REDIS_ENV" ]; then
  # shellcheck disable=SC2086 # une affectation par ligne, découpées exprès
  stage C1b env NF_RUN_CLUSTER_E2E=1 $REDIS_ENV npm run test:cluster
else
  want C1b && log "C1b ✗ SAUTÉ — variables Redis introuvables dans gates.ts"
fi

# C2 frappe le serveur de dev (`run.sh` : « Prérequis : serveur Nodefony dev
# UP ») — or `stage` vient de l'ÉTEINDRE. Sans ce démarrage, C2 tombait en
# 0 min sur ECONNREFUSED 127.0.0.1:5152 : un rouge de décor, pas du produit
# (campagne du 2026-11-16). Le serveur s'éteint après, quel que soit le verdict.
stage C2 bash -c 'bash .claude/skills/nodefony-start-server/start.sh || { echo "C2 : serveur de dev non démarré"; exit 69; }; bash .claude/skills/nodefony-load-test/scripts/run.sh load --rupture; rc=$?; node src/nodefony/bin/nodefony stop; exit $rc'

# E : l'application témoin est GARDÉE par la première commande pour la seconde.
stage E bash -c 'node .claude/skills/nodefony-devkit-bench/scripts/verify-generated.mjs --keep; g=$?; node .claude/skills/nodefony-devkit-bench/scripts/verify-runtime.mjs; r=$?; echo "verify-generated=$g verify-runtime=$r"; [ $g -eq 0 ] && [ $r -eq 0 ]'

stage G bash -c 'npm run release:pack && npm run release:smoke'

# Un commit pendant la nuit, et le code testé n'est plus celui noté au départ.
log "HEAD en fin de campagne : $(git rev-parse --short=8 HEAD)"
log "campagne terminée — restent C1, C3, D, F ; composer docs/qualite/data/<version>.json depuis $OUT"
