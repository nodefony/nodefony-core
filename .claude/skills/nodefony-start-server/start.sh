#!/usr/bin/env bash
# start.sh — démarre le serveur Nodefony de manière fiable.
# Consolide TOUT le workflow en 1 script → 1 seule approbation Bash au lieu de ~8.
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
# Sortie : marqueurs >>> sur stdout. Exit 0 = serveur UP, exit 1 = crash/timeout.
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
# .claude/skills/nodefony-start-server/start.sh → racine = 3 niveaux au-dessus.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
LOG="/tmp/nodefony-server.log"
PIDFILE="/tmp/srv.pid"
TEST_MODULE="$ROOT/src/modules/test"

# ── 1. KILL : arrêt PROPRE via `nodefony stop` (source de vérité) PUIS filet ──
# `nodefony stop` group-kill par `ps` TOUS les modes (dev/prod/cluster) : il découvre les
# process par leur titre réel et tue les arbres (superviseur→serveur→Vite, master→workers).
# C'est CORRECT là où l'ancienne rafale `pkill -f "nodefony development"` RATAIT le
# superviseur dev — dont le titre est `nodefony-dev-supervisor`, pas `nodefony development`
# (le `pkill` ne matchait pas → superviseur survivant, et le garde anti-collision du
# framework refusait alors le démarrage suivant). Filet ENSUITE : rolldown résiduel +
# sockets en ÉCOUTE sur les ports (process non-nodefony, ou secours si `ps` indispo).
echo ">>> KILL (nodefony stop + filet rolldown/ports 5151/5152)"
BIN="$ROOT/node_modules/nodefony/bin/nodefony"
(cd "$ROOT" && node "$BIN" stop >/dev/null 2>&1)
pkill -9 -f "rolldown" 2>/dev/null
# ⚠️ `-sTCP:LISTEN` OBLIGATOIRE : `lsof -ti:PORT` SEUL renvoie TOUS les détenteurs
# d'une socket sur le port — le serveur (LISTEN) MAIS AUSSI les CLIENTS connectés
# (le NAVIGATEUR sur Studio, en ESTABLISHED). Sans le filtre, `kill -9` tue le
# navigateur du user (vécu 2026-06-21 : helper réseau Brave tué). On ne vise QUE
# les sockets en écoute = le(s) serveur(s). (Réf saine : ViteProcessSupervisor.)
PIDS=$( { lsof -ti:5151 -sTCP:LISTEN; lsof -ti:5152 -sTCP:LISTEN; } 2>/dev/null | sort -u )
[ -n "$PIDS" ] && kill -9 $PIDS 2>/dev/null
sleep 1
REMAIN=$( { lsof -ti:5151 -sTCP:LISTEN; lsof -ti:5152 -sTCP:LISTEN; } 2>/dev/null | sort -u | wc -l | tr -d ' ')
echo ">>> ports libres ($REMAIN process restants)"

# ── 2. BUILD CONDITIONNEL du module test (mtime : source vs dist) ───────────
DIST="$TEST_MODULE/dist/index.js"
NEED_BUILD=$FORCE_BUILD
if [ "$NEED_BUILD" -eq 0 ]; then
  if [ ! -f "$DIST" ]; then
    NEED_BUILD=1
  else
    DIST_MTIME=$(stat -f %m "$DIST" 2>/dev/null || stat -c %Y "$DIST" 2>/dev/null)
    SRC_MTIME=$(find "$TEST_MODULE" -name "*.ts" -not -path "*/dist/*" -not -path "*/node_modules/*" \
      -exec stat -f %m {} \; 2>/dev/null | sort -n | tail -1)
    if [ -n "$SRC_MTIME" ] && [ "$SRC_MTIME" -gt "$DIST_MTIME" ]; then
      NEED_BUILD=1
    fi
  fi
fi
if [ "$NEED_BUILD" -eq 1 ]; then
  echo ">>> BUILD src/modules/test (source plus récent que dist)"
  (cd "$TEST_MODULE" && npm run build 2>&1 | tail -2)
  echo ">>> build OK"
else
  echo ">>> SKIP build (dist à jour — gain de temps)"
fi

# ── 3. SPAWN detached (rm log d'abord pour éviter faux positif READY) ────────
if [ "$MODE" = "cluster" ]; then
  # ⚠️ Le runtime cluster (prod) lit la config depuis le DIST root (`dist/index.js`,
  # `dist/nodefony.config.js`, `dist/env.js`), PAS la source → toute modif de
  # `nodefony.config.ts` / `env.ts` / `index.ts` DOIT être recompilée AVANT le boot,
  # sinon STALE (vécu douloureux : backplane redis fantôme bloquant le boot,
  # trustedHosts/localhost périmés, manifeste `modules` d'hier absent). `start.sh` ne
  # rebuildait QUE le module test → on rebuild le ROOT ici (turbo + `rolldown -c`).
  # cf [[feedback_root_dist_stale_modules]].
  echo ">>> BUILD root (turbo + rolldown -c) — config prod (nodefony.config.ts) lue depuis dist/"
  (cd "$ROOT" && npm run build 2>&1 | grep -iE "Tasks:" | tail -1)
  # Front PROD (P14.5) : en prod le front n'est PAS servi par Vite mais en STATIQUE
  # depuis les bundles Vite COMPILÉS — renderProdTags lit outDir/.vite/manifest.json.
  # SANS ce build → /nodefony rend un shell sans <script> et /_assets/* en 404
  # (= le "Studio 404 en prod"). Idempotent : skip les entries au manifest frais.
  echo ">>> BUILD front prod (vite build par entry, idempotent)"
  (cd "$ROOT" && npm run build:front 2>&1 | grep -iE "built:|skipped|failed" | tail -2)
  # Backplane realtime = IPC intra-pod (driver "cluster", DÉFAUT de la config app) →
  # ZÉRO dépendance Redis. Redis (fan-out CROSS-pod) = opt-in : décommenter
  # `@nodefony/redis` dans index.ts + `driver:"redis"` (config) + REDIS_PASSWORD.
  echo ">>> SPAWN nodefony ${DEBUG_FLAG:+-d }cluster --workers $WORKERS (detached, front prod compilé, backplane IPC)"
  ARGS="[${DEBUG_FLAG:+'-d', }'cluster', '--workers', '$WORKERS']"
else
  echo ">>> SPAWN nodefony ${DEBUG_FLAG:+-d }development (detached, 1 process, binaire direct)"
  ARGS="[${DEBUG_FLAG:+'-d', }'development']"
fi
# Binaire résolu lancé EN DIRECT (`node $BIN …`) au lieu de `npx nodefony …` : npx laisse
# un process wrapper `npm exec nodefony` PARASITE en parent du superviseur (« pourquoi
# 3 process ? », user 06-20). En direct : pas d'intermédiaire → $PIDFILE pointe le VRAI
# superviseur (et non le wrapper npm), et `ps`/`nodefony status` ne montrent que les 2
# process réels (superviseur + serveur enfant). Le respawn de l'enfant par le superviseur
# était DÉJÀ direct (process.execPath + argv) — seul le lancement initial passait par npx.
# ($BIN défini plus haut, section KILL.)
rm -f "$LOG" "$PIDFILE"
# --expose-gc : le serveur de test DOIT pouvoir forcer le GC pour que le gate
# mémoire (sonde /nodefony/test/memory → global.gc()) mesure le heap RETENU et non
# le garbage transitoire. Sans ça, 5000 frames WS laissent ~180 MB non collectés
# qui passent pour une fuite (faux positif chronique de ws-messages-load « sustained »).
# Coût nul en dev hors sonde ; hérité par le child DevSupervisor (env propagé au spawn).
node -e "
const { spawn } = require('child_process');
const fs = require('fs');
const out = fs.openSync('$LOG', 'w');
const env = Object.assign({}, process.env, { NODE_OPTIONS: ((process.env.NODE_OPTIONS || '') + ' --expose-gc').trim() });
const child = spawn(process.execPath, ['$BIN'].concat($ARGS), { cwd: '$ROOT', stdio: ['ignore', out, out], detached: true, env });
child.unref();
fs.writeFileSync('$PIDFILE', String(child.pid));
console.log('SERVER PID=' + child.pid);
"

# ── 4. WAIT boot — plafond 120s, fail-fast INTELLIGENT ───────────────────────
# Le plafond fixe de 25s donnait des FAUX TIMEOUT (4× vécus) : la vérif turbo du
# DevSupervisor (rebuild froid ~34s même en rolldown) retarde le boot alors que
# tout va bien. Nouveau modèle : on attend LONGTEMPS tant qu'il y a de l'ACTIVITÉ
# (le log grossit = build/boot en cours), et on échoue VITE sur un vrai problème :
#   - crash reconnu dans le log (grep FATAL) ;
#   - process superviseur MORT (kill -0) ;
#   - log SILENCIEUX ≥ 20s sans serveurs up (hang réel).
echo ">>> WAIT boot (plafond 120s — fail-fast si crash/process mort/log figé 20s)"
READY=0
LAST_SIZE=0
STALL=0
SPID=$(cat "$PIDFILE" 2>/dev/null)
for i in $(seq 1 240); do
  if grep -q -E "SyntaxError|CRITIC|EADDRINUSE|ALREADY USE|terminate :" "$LOG" 2>/dev/null; then
    echo ">>> FATAL — crash au démarrage :"
    grep -E "SyntaxError|CRITIC|terminate|EADDRINUSE" "$LOG" | sed 's/\x1b\[[0-9;]*m//g' | tail -10
    exit 1
  fi
  # Compte les 4 serveurs réseau (http/https/ws/wss) — server-static exclu.
  NET=$(grep -E "Server Listen on (https?|wss?)://" "$LOG" 2>/dev/null | wc -l | tr -d ' ')
  NET=${NET:-0}
  if [ "$NET" -ge 4 ]; then
    echo ">>> READY — $NET network servers listening ($((i / 2))s)"
    READY=1
    break
  fi
  # Process superviseur mort sans crash-marker dans le log → FATAL immédiat.
  if [ -n "$SPID" ] && ! kill -0 "$SPID" 2>/dev/null; then
    echo ">>> FATAL — process $SPID mort avant l'écoute des serveurs. Dernières lignes :"
    sed 's/\x1b\[[0-9;]*m//g' "$LOG" | tail -10
    exit 1
  fi
  # Détection de hang : log figé (taille inchangée) 40 ticks = 20s → inutile d'attendre 120s.
  SIZE=$(stat -f %z "$LOG" 2>/dev/null || stat -c %s "$LOG" 2>/dev/null || echo 0)
  if [ "$SIZE" -eq "$LAST_SIZE" ]; then STALL=$((STALL + 1)); else STALL=0; LAST_SIZE=$SIZE; fi
  if [ "$STALL" -ge 40 ]; then
    echo ">>> TIMEOUT — log figé depuis 20s sans serveurs ($NET/4). Dernières lignes :"
    sed 's/\x1b\[[0-9;]*m//g' "$LOG" | tail -8
    exit 1
  fi
  # Progression toutes les ~5s, avec la phase courante du DevSupervisor si visible.
  if [ $((i % 10)) -eq 0 ]; then
    PHASE=$(sed 's/\x1b\[[0-9;]*m//g' "$LOG" 2>/dev/null | grep -E "^\[dev\]" | tail -1 | cut -c1-70)
    echo ">>> ... booting ($NET/4 servers, $((i / 2))s)${PHASE:+ — $PHASE}"
  fi
  sleep 0.5
done
if [ "$READY" -eq 0 ]; then
  echo ">>> TIMEOUT — pas de 4 servers après 120s (activité continue = build anormalement long). Dernières lignes :"
  sed 's/\x1b\[[0-9;]*m//g' "$LOG" | tail -8
  exit 1
fi

# ── 5. VERIFY + HEALTH ───────────────────────────────────────────────────────
if [ "$MODE" = "cluster" ]; then
  echo ">>> CLUSTER master :"
  grep -E "cluster master up|Cluster topology" "$LOG" | sed 's/\x1b\[[0-9;]*m//g' | tail -3
fi
echo ">>> SERVERS :"
grep "Server Listen" "$LOG" | sed 's/\x1b\[[0-9;]*m//g'
echo ">>> HEALTH /nodefony/test/index (2 tries — watch Rollup peut occuper l'event loop juste après boot) :"
node -e "
const https = require('https');
function probe(attempt) {
  const req = https.request({ hostname:'127.0.0.1', port:5152, path:'/nodefony/test/index', rejectUnauthorized:false, timeout:4000 },
    r => { console.log('HEALTH ' + r.statusCode); r.resume(); req.destroy(); });
  req.on('error', e => { if (e.code !== 'ECONNRESET') retry(attempt, 'ERR ' + e.code); });
  req.on('timeout', () => { req.destroy(); retry(attempt, 'TIMEOUT'); });
  req.end();
}
function retry(attempt, why) {
  if (attempt < 2) { setTimeout(() => probe(attempt + 1), 1500); }
  else { console.log('HEALTH skipped (' + why + ') — servers listen OK, échauffement watch en cours'); }
}
probe(1);
" 2>/dev/null

if [ "$MODE" = "cluster" ]; then
  echo ">>> UP (cluster $WORKERS workers) — https://127.0.0.1:5152 | master PID=$(cat "$PIDFILE" 2>/dev/null)"
  echo ">>> Studio prod (front compilé) : https://127.0.0.1:5152/nodefony"
  echo ">>>   ⚠️ via 127.0.0.1 — PAS 'localhost' (→ 401 DOMAIN Unauthorized, trustedHosts strict en prod)"
  echo ">>> Vue pod : curl -k https://127.0.0.1:5152/nodefony/realtime/api/health  → cluster:true, instanceCount:$WORKERS"
else
  echo ">>> UP — http://127.0.0.1:5151 | https://127.0.0.1:5152 | PID=$(cat "$PIDFILE" 2>/dev/null)"
fi
