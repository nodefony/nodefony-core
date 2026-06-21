#!/usr/bin/env bash
# stop.sh — arrête le serveur Nodefony proprement (one-shot, pas de respawn).
#
# Usage : bash .claude/skills/nodefony-start-server/stop.sh
#
# Tue watch+rollup AVANT lsof+kill (sinon le watch respawn un process sur les ports).
# Cf mémoire IA feedback_server_kill_oneshot.

set -uo pipefail

# Racine repo dérivée de BASH_SOURCE (pas $(pwd) : le cwd Bash peut avoir dérivé).
# .claude/skills/nodefony-start-server/stop.sh → racine = 3 niveaux au-dessus.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
BIN="$ROOT/node_modules/nodefony/bin/nodefony"

echo ">>> KILL nodefony server (watch+rollup d'abord)"
# Arrêt PROPRE du mode dev EN PREMIER : `nodefony stop` (standalone, n'échoue pas hors
# trunk) fait un group-kill du superviseur → emporte l'enfant serveur ET toutes les
# instances Vite, dont les titres `nodefony-vite[...]` qu'AUCUN pkill ci-dessous ne
# matche (trou couvert). Lancé via le BINAIRE EN DIRECT (cwd=ROOT pour résoudre le
# pidfile) — pas `npx` (qui ajoutait un wrapper + ~1,3s d'overhead). La rafale pkill qui
# suit reste le FILET pour les modes NON couverts par `nodefony stop` : cluster
# (master/worker) et server/production.
( cd "$ROOT" && node "$BIN" stop >/dev/null 2>&1 ) || true
# ⚠️ process.title COUPLÉ : master/workers/mono se renomment `nodefony master|worker|server`
# (cf clusterMaster.ts + runtimeLauncher.ts → lisibles dans Activity Monitor / ps). Donc
# `pkill -f "nodefony cluster"` ne les matche PLUS → il FAUT aussi ces 3 patterns, sinon
# un master immortel (parké) laisse des workers qui tiennent les ports (EADDRINUSE).
# Les patterns argv (cluster/production/...) couvrent la fenêtre AVANT que le titre soit posé.
pkill -9 -f "nodefony master" 2>/dev/null      # superviseur cluster (parké, immortel)
pkill -9 -f "nodefony worker" 2>/dev/null      # workers forkés (détiennent/partagent les ports)
pkill -9 -f "nodefony server" 2>/dev/null      # runtime mono-process
pkill -9 -f "nodefony development" 2>/dev/null
pkill -9 -f "nodefony cluster" 2>/dev/null     # fenêtre pré-titre (npm exec nodefony cluster)
pkill -9 -f "nodefony staging" 2>/dev/null
pkill -9 -f "nodefony preprod" 2>/dev/null
pkill -9 -f "nodefony production" 2>/dev/null
pkill -9 -f "rollup" 2>/dev/null
# ⚠️ `-sTCP:LISTEN` OBLIGATOIRE : `lsof -ti:PORT` SEUL vise aussi les CLIENTS
# connectés (le NAVIGATEUR sur Studio) → `kill -9` tuerait le navigateur du user.
# On ne tue QUE les sockets en écoute = le(s) serveur(s). (cf start.sh, même fix.)
PIDS=$( { lsof -ti:5151 -sTCP:LISTEN; lsof -ti:5152 -sTCP:LISTEN; } 2>/dev/null | sort -u )
[ -n "$PIDS" ] && kill -9 $PIDS 2>/dev/null
sleep 1
REMAIN=$( { lsof -ti:5151 -sTCP:LISTEN; lsof -ti:5152 -sTCP:LISTEN; } 2>/dev/null | sort -u | wc -l | tr -d ' ')
echo ">>> ports libres ($REMAIN process restants)"
rm -f /tmp/srv.pid
