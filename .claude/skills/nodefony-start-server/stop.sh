#!/usr/bin/env bash
# stop.sh — arrête le serveur Nodefony proprement (one-shot, pas de respawn).
#
# Usage : bash .claude/skills/nodefony-start-server/stop.sh
#
# Tue watch+rolldown AVANT lsof+kill (sinon le watch respawn un process sur les ports).
# Cf mémoire IA feedback_server_kill_oneshot.

set -uo pipefail

# Racine repo dérivée de BASH_SOURCE (pas $(pwd) : le cwd Bash peut avoir dérivé).
# .claude/skills/nodefony-start-server/stop.sh → racine = 3 niveaux au-dessus.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
BIN="$ROOT/node_modules/nodefony/bin/nodefony"

echo ">>> KILL nodefony (nodefony stop multi-mode + filet)"
# Voie PRINCIPALE : `nodefony stop` (standalone, n'échoue pas hors trunk) group-kill par
# `ps` TOUS les modes — dev (superviseur → enfant + Vite `nodefony-vite[...]`), prod mono
# (`nodefony server`) ET cluster (master parké → workers). Depuis l'introspection
# multi-mode (1bd57a7d) il n'y a PLUS besoin d'une rafale pkill par mode : `stop` les couvre
# tous, master parké sans port inclus (prouvé live). Lancé via le BINAIRE EN DIRECT
# (cwd=ROOT pour résoudre le pidfile) — pas `npx` (wrapper + ~1,3s d'overhead).
( cd "$ROOT" && node "$BIN" stop >/dev/null 2>&1 ) || true
# FILET de secours, RÉDUIT. ⚠️ `process.title` ÉCRASE l'argv dans `ps` : un `pkill -f
# "nodefony development|master|worker|server"` est soit MORT (titre déjà posé → l'argv
# n'existe plus) soit REDONDANT (titre posé → `nodefony stop` le voit par ps). Ne restent
# utiles que les argv de la fenêtre de boot PRÉ-TITRE (avant que startClusterMaster /
# generate posent le titre), que `stop` ne voit pas encore — plus `rolldown`.
pkill -9 -f "nodefony cluster" 2>/dev/null     # fenêtre pré-titre du master cluster
pkill -9 -f "nodefony production" 2>/dev/null   # fenêtre pré-titre du prod mono
pkill -9 -f "rolldown" 2>/dev/null
# ⚠️ `-sTCP:LISTEN` OBLIGATOIRE : `lsof -ti:PORT` SEUL vise aussi les CLIENTS
# connectés (le NAVIGATEUR sur Studio) → `kill -9` tuerait le navigateur du user.
# On ne tue QUE les sockets en écoute = le(s) serveur(s). (cf start.sh, même fix.)
PIDS=$( { lsof -ti:5151 -sTCP:LISTEN; lsof -ti:5152 -sTCP:LISTEN; } 2>/dev/null | sort -u )
[ -n "$PIDS" ] && kill -9 $PIDS 2>/dev/null
sleep 1
REMAIN=$( { lsof -ti:5151 -sTCP:LISTEN; lsof -ti:5152 -sTCP:LISTEN; } 2>/dev/null | sort -u | wc -l | tr -d ' ')
echo ">>> ports libres ($REMAIN process restants)"
rm -f /tmp/srv.pid
