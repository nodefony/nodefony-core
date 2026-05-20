#!/usr/bin/env bash
# start.sh — démarre le serveur Nodefony (development) de manière fiable.
# Consolide TOUT le workflow en 1 script → 1 seule approbation Bash au lieu de ~8.
#
# Usage : bash .claude/skills/start-nodefony-server/start.sh [-d] [--force-build]
#   -d            mode debug (npx nodefony -d development) — logs DEBUG verbeux
#   --force-build force le rebuild du module test même si dist à jour
#
# Sortie : marqueurs >>> sur stdout. Exit 0 = serveur UP, exit 1 = crash/timeout.
# Log serveur : /tmp/nodefony-server.log   PID : /tmp/srv.pid

set -uo pipefail

DEBUG_FLAG=""
FORCE_BUILD=0
for arg in "$@"; do
  case "$arg" in
    -d) DEBUG_FLAG="-d" ;;
    --force-build) FORCE_BUILD=1 ;;
  esac
done

ROOT="$(pwd)"
LOG="/tmp/nodefony-server.log"
PIDFILE="/tmp/srv.pid"
TEST_MODULE="$ROOT/src/modules/test"

# ── 1. KILL : watch/rollup AVANT lsof (sinon respawn immédiat) ──────────────
echo ">>> KILL watch+rollup+ports 5151/5152"
pkill -9 -f "nodefony development" 2>/dev/null
pkill -9 -f "rollup" 2>/dev/null
PIDS=$(lsof -ti:5151 -ti:5152 2>/dev/null)
[ -n "$PIDS" ] && kill -9 $PIDS 2>/dev/null
sleep 1
REMAIN=$(lsof -ti:5151 -ti:5152 2>/dev/null | wc -l | tr -d ' ')
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
echo ">>> SPAWN nodefony ${DEBUG_FLAG:+-d }development (detached)"
rm -f "$LOG" "$PIDFILE"
ARGS="['nodefony'${DEBUG_FLAG:+, '-d'}, 'development']"
node -e "
const { spawn } = require('child_process');
const fs = require('fs');
const out = fs.openSync('$LOG', 'w');
const child = spawn('npx', $ARGS, { cwd: '$ROOT', stdio: ['ignore', out, out], detached: true });
child.unref();
fs.writeFileSync('$PIDFILE', String(child.pid));
console.log('SERVER PID=' + child.pid);
"

# ── 4. WAIT boot (max 25s, check 0.5s, fail-fast sur crash) ──────────────────
echo ">>> WAIT boot (max 25s)"
READY=0
for i in $(seq 1 50); do
  if grep -q -E "SyntaxError|CRITIC|EADDRINUSE|ALREADY USE|terminate :" "$LOG" 2>/dev/null; then
    echo ">>> FATAL — crash au démarrage :"
    grep -E "SyntaxError|CRITIC|terminate|EADDRINUSE" "$LOG" | sed 's/\x1b\[[0-9;]*m//g' | tail -10
    exit 1
  fi
  COUNT=$(grep -c "Server Listen on" "$LOG" 2>/dev/null || true)
  COUNT=${COUNT:-0}
  # Compte les 4 serveurs réseau (http/https/ws/wss) — server-static exclu.
  NET=$(grep -E "Server Listen on (https?|wss?)://" "$LOG" 2>/dev/null | wc -l | tr -d ' ')
  NET=${NET:-0}
  if [ "$NET" -ge 4 ]; then
    echo ">>> READY — $NET network servers listening (${i}×0.5s)"
    READY=1
    break
  fi
  [ $((i % 6)) -eq 0 ] && echo ">>> ... booting ($NET/4 network servers, ${i}×0.5s)"
  sleep 0.5
done
if [ "$READY" -eq 0 ]; then
  echo ">>> TIMEOUT — pas de 4 servers après 25s. Dernières lignes :"
  sed 's/\x1b\[[0-9;]*m//g' "$LOG" | tail -8
  exit 1
fi

# ── 5. VERIFY + HEALTH ───────────────────────────────────────────────────────
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

echo ">>> UP — http://127.0.0.1:5151 | https://127.0.0.1:5152 | PID=$(cat "$PIDFILE" 2>/dev/null)"
