#!/usr/bin/env bash
# stop.sh — arrête le serveur Nodefony proprement (one-shot, pas de respawn).
#
# Usage : bash .claude/skills/start-nodefony-server/stop.sh
#
# Tue watch+rollup AVANT lsof+kill (sinon le watch respawn un process sur les ports).
# Cf mémoire IA feedback_server_kill_oneshot.

set -uo pipefail

echo ">>> KILL nodefony server (watch+rollup d'abord)"
pkill -9 -f "nodefony development" 2>/dev/null
pkill -9 -f "rollup" 2>/dev/null
PIDS=$(lsof -ti:5151 -ti:5152 2>/dev/null)
[ -n "$PIDS" ] && kill -9 $PIDS 2>/dev/null
sleep 1
REMAIN=$(lsof -ti:5151 -ti:5152 2>/dev/null | wc -l | tr -d ' ')
echo ">>> ports libres ($REMAIN process restants)"
rm -f /tmp/srv.pid
