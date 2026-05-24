#!/usr/bin/env bash
# stop.sh — arrête le serveur Nodefony proprement (one-shot, pas de respawn).
#
# Usage : bash .claude/skills/nodefony-start-server/stop.sh
#
# Tue watch+rollup AVANT lsof+kill (sinon le watch respawn un process sur les ports).
# Cf mémoire IA feedback_server_kill_oneshot.

set -uo pipefail

echo ">>> KILL nodefony server (watch+rollup d'abord)"
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
PIDS=$(lsof -ti:5151 -ti:5152 2>/dev/null)
[ -n "$PIDS" ] && kill -9 $PIDS 2>/dev/null
sleep 1
REMAIN=$(lsof -ti:5151 -ti:5152 2>/dev/null | wc -l | tr -d ' ')
echo ">>> ports libres ($REMAIN process restants)"
rm -f /tmp/srv.pid
