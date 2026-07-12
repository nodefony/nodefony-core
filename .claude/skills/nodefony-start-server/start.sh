#!/usr/bin/env bash
# start.sh — démarre le serveur Nodefony de manière fiable.
# WRAPPER MINCE de la commande native `nodefony <runtime> --detach` (volet F DevSupervisor
# DX) : le spawn détaché, l'attente de readiness (sonde ports — plus AUCUNE heuristique
# « log figé » → fin des faux TIMEOUT pendant un rebuild turbo légitime), le health check
# et le code de sortie sémantique vivent DANS le framework (detachedStart.ts).
# Le script ne garde que le spécifique au banc de test du repo : kill préalable + filet,
# builds pré-boot (module test / dist root cluster), --expose-gc pour le gate mémoire.
#
# Modèle « 2 molettes » (2026-05-24) : front (dev/prod) × topologie (workers).
#   - défaut          = `development` → TOUJOURS 1 process (Vite/HMR).
#   - --cluster [-w N]= runtime prod cluster (`nodefony cluster --workers N`),
#                       front prod (pas de Vite) → exercer la vue pod / l'observabilité.
#
# Usage : bash .claude/skills/nodefony-start-server/start.sh [-d] [--force-build] [--cluster [-w N]]
#   -d            mode debug (logs DEBUG verbeux)
#   --force-build force le rebuild du module test même si dist à jour
#   --cluster     lance le runtime cluster (multi-process) au lieu de development
#   -w, --workers N  nb de workers en cluster (défaut 2 — un vrai cluster pour tester la vue pod)
#
# Sortie : marqueurs >>> sur stdout (script + détacheur natif). Exit 0 = serveur UP,
# exit ≠ 0 = crash/timeout (69 = EX_UNAVAILABLE du détacheur).
# Log serveur : /tmp/nodefony-server.log   PID : /tmp/srv.pid

set -uo pipefail

DEBUG_FLAG=""
FORCE_BUILD=0
MODE="development"   # "development" (défaut, 1 process) | "cluster" (multi-process)
WORKERS=2            # nb de workers en mode cluster (défaut : vrai cluster pour la vue pod)
while [ $# -gt 0 ]; do
  case "$1" in
    -d) DEBUG_FLAG="-d" ;;
    --force-build) FORCE_BUILD=1 ;;
    --cluster) MODE="cluster" ;;
    -w|--workers) shift; WORKERS="${1:-2}" ;;
    -w=*|--workers=*) WORKERS="${1#*=}" ;;
  esac
  shift
done

# Racine repo dérivée du chemin du script (BASH_SOURCE), PAS de $(pwd) : le cwd
# Bash persiste entre appels → après un `cd <subdir>`, un `$(pwd)` cassait le
# chemin (piège vu 3× malgré la mémoire `feedback_cd_startsh_relative_path`).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
# ⚠️ SE PLACER À LA RACINE : le runtime résout l'APP depuis process.cwd(). Lancé
# depuis un sous-dossier (ex. src/packages/@nodefony/http), le kernel bootait le
# PACKAGE comme app (1 module, bind ::1, config défauts) — vécu 2026-07-12.
cd "$ROOT"
LOG="/tmp/nodefony-server.log"
PIDFILE="/tmp/srv.pid"
TEST_MODULE="$ROOT/src/modules/test"
BIN="$ROOT/node_modules/nodefony/bin/nodefony"

# ── 1. KILL : arrêt PROPRE via `nodefony stop` (source de vérité) PUIS filet ──
# `nodefony stop` group-kill par `ps` TOUS les modes — SCOPÉ à CE projet. Le
# filet ENSUITE (résidus si `ps` indispo) doit respecter la MÊME règle : on ne
# tue un process au port QUE si son cwd est CE repo. ⚠️ Vécu : le kill -9
# aveugle par port a SIGKILLé le serveur dev d'une AUTRE app du poste (le
# framework refuse ce kill trans-projet partout ailleurs). Occupant étranger →
# REFUS explicite, jamais de kill. `-sTCP:LISTEN` OBLIGATOIRE : sans le filtre,
# `lsof -ti:PORT` vise aussi les CLIENTS connectés (navigateur sur Studio).
echo ">>> KILL (nodefony stop + filet scopé projet, ports 5151/5152)"
(cd "$ROOT" && node "$BIN" stop >/dev/null 2>&1)
PIDS=$( { lsof -ti:5151 -sTCP:LISTEN; lsof -ti:5152 -sTCP:LISTEN; } 2>/dev/null | sort -u )
for PID in $PIDS; do
  PCWD=$(lsof -a -p "$PID" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -1)
  case "$PCWD" in
    "$ROOT"|"$ROOT"/*) kill -9 "$PID" 2>/dev/null ;;
    *)
      echo ">>> ⛔ port occupé par pid $PID (${PCWD:-cwd inconnu}) — un AUTRE projet."
      echo ">>>    Je ne tue JAMAIS le runtime d'un autre dossier : arrête-le depuis"
      echo ">>>    SON dossier (nodefony stop) ou avec \`nodefony stop --all\`."
      exit 73
      ;;
  esac
done
# rolldown résiduels de CE repo uniquement (même règle de scoping par cwd).
for PID in $(pgrep -f "rolldown" 2>/dev/null); do
  PCWD=$(lsof -a -p "$PID" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -1)
  case "$PCWD" in
    "$ROOT"|"$ROOT"/*) kill -9 "$PID" 2>/dev/null ;;
  esac
done
sleep 1
REMAIN=$( { lsof -ti:5151 -sTCP:LISTEN; lsof -ti:5152 -sTCP:LISTEN; } 2>/dev/null | sort -u | wc -l | tr -d ' ')
echo ">>> ports libres ($REMAIN process restants)"

# ── 2. BUILDS PRÉ-BOOT spécifiques au banc de test ───────────────────────────
if [ "$MODE" = "cluster" ]; then
  # ⚠️ Le runtime cluster (prod) lit la config depuis le DIST root (`dist/index.js`,
  # `dist/nodefony.config.js`, `dist/env.js`), PAS la source → rebuild ROOT obligatoire
  # (cf feedback_root_dist_stale_modules). Front PROD servi STATIQUE depuis les bundles
  # Vite compilés (manifest) → build:front sinon « Studio 404 en prod ».
  echo ">>> BUILD root (turbo + rolldown -c) — config prod lue depuis dist/"
  (cd "$ROOT" && npm run build 2>&1 | grep -iE "Tasks:" | tail -1)
  echo ">>> BUILD front prod (vite build par entry, idempotent)"
  (cd "$ROOT" && npm run build:front 2>&1 | grep -iE "built:|skipped|failed" | tail -2)
elif [ "$FORCE_BUILD" -eq 1 ]; then
  # En dev, la vérification turbo est NATIVE (DevSupervisor #ensureBuilt au boot) —
  # le build explicite ne sert qu'au forçage manuel.
  echo ">>> BUILD src/modules/test (--force-build)"
  (cd "$TEST_MODULE" && npm run build 2>&1 | tail -2)
  echo ">>> build OK"
else
  echo ">>> build délégué au DevSupervisor natif (#ensureBuilt, turbo cache)"
fi

# ── 3. LANCEMENT DÉTACHÉ NATIF (spawn + readiness + health + exit code) ───────
# --expose-gc : le serveur de test DOIT pouvoir forcer le GC pour que le gate
# mémoire (sonde /nodefony/test/memory → global.gc()) mesure le heap RETENU et non
# le garbage transitoire (faux positif chronique de ws-messages-load « sustained »).
# Hérité par toute la descendance (env propagé aux spawns).
rm -f "$LOG" "$PIDFILE"
if [ "$MODE" = "cluster" ]; then
  RUNTIME_ARGS=(${DEBUG_FLAG:+"$DEBUG_FLAG"} cluster --workers "$WORKERS")
else
  RUNTIME_ARGS=(${DEBUG_FLAG:+"$DEBUG_FLAG"} development)
fi
echo ">>> nodefony ${RUNTIME_ARGS[*]} --detach (natif : readiness + health + exit code)"
NODE_OPTIONS="$(echo "${NODE_OPTIONS:-} --expose-gc" | xargs)" \
  node "$BIN" "${RUNTIME_ARGS[@]}" --detach --wait 150 \
  --health /nodefony/test/index --log "$LOG" | tee /tmp/nodefony-detach-out.$$
RC=${PIPESTATUS[0]}

# ── 4. Compat : pidfile /tmp/srv.pid (extrait du rapport natif « UP — PID=n ») ─
PID=$(grep -oE "UP — PID=[0-9]+" /tmp/nodefony-detach-out.$$ 2>/dev/null | grep -oE "[0-9]+" | tail -1)
rm -f /tmp/nodefony-detach-out.$$
[ -n "${PID:-}" ] && echo "$PID" > "$PIDFILE"

if [ "$RC" -ne 0 ]; then
  exit "$RC"
fi
if [ "$MODE" = "cluster" ]; then
  echo ">>> Studio prod (front compilé) : https://127.0.0.1:5152/nodefony"
  echo ">>>   ⚠️ via 127.0.0.1 — PAS 'localhost' (→ 401 DOMAIN Unauthorized, trustedHosts strict en prod)"
  echo ">>> Vue pod : curl -k https://127.0.0.1:5152/nodefony/realtime/api/health  → cluster:true, instanceCount:$WORKERS"
fi
exit 0
