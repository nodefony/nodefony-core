#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# Bissection d'une RÉGRESSION de coût par requête — quel commit a fait monter
# le ratio Nodefony / témoin du profil comparé ?
#
# Chaque étape rebâtit le commit dans un WORKTREE séparé (l'arbre de travail
# n'est jamais touché), profile Nodefony ET le témoin dans la même fenêtre
# (`profile-cpu.sh`), puis classe le commit sur le RATIO — jamais sur un absolu :
# deux profils d'heures différentes ne se comparent pas (règle n°0, réf.
# `profil-compare.md`). Le témoin est servi depuis CE dépôt, identique à chaque
# étape ; seul Nodefony change.
#
# Usage : bisect-perf.sh <bon> <mauvais> [témoin=nest-fair] [seuil %=125]
#   bon     : commit dont le ratio est connu bas (ex. 102 %)
#   mauvais : commit dont le ratio est connu haut (ex. 149 %)
#   seuil   : ratio à partir duquel un commit est « mauvais » — le milieu des deux
# Sortie : tmp/runs/bisect-perf.log (une ligne par commit mesuré + `git bisect log`).
# Les deux bornes sont mesurées D'ABORD : si elles ne se classent pas comme
# annoncé, la bissection n'a pas lieu (code 2) — elle chercherait un saut
# inexistant.
# ⚠️ Le ratio d'un profil varie de ±11 points à décor identique (111-133 % mesurés) :
#   cette bissection ne tranche qu'un SAUT de plus de ~25 points. En deçà, les bornes
#   se rangent au hasard — chiffrer d'abord l'écart par `wait-compare.sh`.
# Une étape qui ne se bâtit pas ou ne démarre pas est SAUTÉE (code 125).
# Les hooks git sont coupés dans le worktree : une régénération de symboles en
# arrière-plan pendant un profil le fausserait.
# ─────────────────────────────────────────────────────────────────────────────
set -u
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$DIR/../../../.." && pwd)"
SELF="$DIR/bisect-perf.sh"
WT="${NF_BISECT_WT:-$ROOT/tmp/bench/bisect-perf-wt}"
LOG="$ROOT/tmp/runs/bisect-perf.log"
LOCKSUM="$ROOT/tmp/bench/bisect-perf.locksum"
export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=/dev/null

# ── Une étape : bâtir le commit courant du worktree, le mesurer, le classer ──
step() {
  local witness=$1 threshold=$2
  cd "$WT" || return 125
  local sha subject
  sha=$(git rev-parse --short HEAD); subject=$(git log -1 --format='%ad %s' --date=short)
  local sum; sum=$(shasum package-lock.json | cut -d' ' -f1)
  if [ "$sum" != "$(cat "$LOCKSUM" 2>/dev/null)" ]; then
    npm ci --no-audit --no-fund >"$ROOT/tmp/runs/bisect-perf-npm.log" 2>&1 \
      || { echo "$sha SKIP npm ci  $subject" >>"$LOG"; return 125; }
    echo "$sum" >"$LOCKSUM"
  fi
  npm run clean >/dev/null 2>&1
  npm run build >"$ROOT/tmp/runs/bisect-perf-build.log" 2>&1 \
    || { echo "$sha SKIP build  $subject" >>"$LOG"; return 125; }
  . "$DIR/kill-guard.sh"; kill_listeners 5151; kill_listeners 5161; sleep 1
  local pdir="$ROOT/tmp/profiles/bisect"
  NF_PROFILE_DIR=$pdir NF_PROFILE_APP_ROOT="$WT" \
    XENV="NF_WITH_DEV_MODULES=1 NF_WITH_DEV_MODULES_TTL_MIN=30" \
    bash "$DIR/profile-cpu.sh" nodefony 5151 src/nodefony/bin/nodefony production >/dev/null 2>&1 \
    || { echo "$sha SKIP profil nodefony  $subject" >>"$LOG"; return 125; }
  NF_PROFILE_DIR=$pdir XENV="" \
    bash "$DIR/profile-cpu.sh" "$witness" 5161 "$DIR/../bench-frameworks/$witness.mjs" >/dev/null 2>&1 \
    || { echo "$sha SKIP profil témoin  $subject" >>"$LOG"; return 125; }
  local total ratio
  total=$(node "$DIR/profile-compare.mjs" "$pdir/nodefony" "$pdir/$witness" | grep -m1 -E '^nodefony .* µs')
  ratio=$(sed -n 's/.*(\([0-9]*\) %).*/\1/p' <<<"$total")
  [ -n "$ratio" ] || { echo "$sha SKIP ratio illisible  $subject" >>"$LOG"; return 125; }
  echo "$sha ${ratio}%  $total  $subject" >>"$LOG"
  [ "$ratio" -lt "$threshold" ] && return 0 || return 1
}

if [ "${1:-}" = "--step" ]; then step "$2" "$3"; exit $?; fi

GOOD=${1:?bon commit}; BAD=${2:?mauvais commit}; WITNESS=${3:-nest-fair}; THRESHOLD=${4:-125}
mkdir -p "$ROOT/tmp/runs" "$ROOT/tmp/bench"
cd "$ROOT"
[ -d "$WT" ] || git worktree add --detach "$WT" "$BAD" >/dev/null || exit 1
echo "# bissection $(date '+%F %T') bon=$GOOD mauvais=$BAD témoin=$WITNESS seuil=${THRESHOLD}%" >>"$LOG"
cd "$WT"
git checkout -q --detach "$GOOD" && step "$WITNESS" "$THRESHOLD"
[ $? -eq 0 ] || { echo "❌ la borne BONNE n'est pas sous ${THRESHOLD}% — voir $LOG"; exit 2; }
cd "$WT" && git checkout -q --detach "$BAD" && step "$WITNESS" "$THRESHOLD"
[ $? -eq 1 ] || { echo "❌ la borne MAUVAISE n'est pas au-dessus de ${THRESHOLD}% — voir $LOG"; exit 2; }
cd "$WT"
git bisect start "$BAD" "$GOOD" -- src/nodefony src/packages/@nodefony/http \
  src/packages/@nodefony/framework src/packages/@nodefony/security src/modules/test
git bisect run "$SELF" --step "$WITNESS" "$THRESHOLD"
git bisect log >>"$LOG"
git bisect reset -q
kill_listeners 5151 2>/dev/null; kill_listeners 5161 2>/dev/null
echo "✅ fin — $LOG"
