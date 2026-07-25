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
# FILET de secours, RÉDUIT et SCOPÉ AU PROJET — règle IDENTIQUE à start.sh et à
# `splitByProject` (devProcess.ts) : cwd STRICTEMENT ÉGAL à la racine, jamais un
# préfixe. Un filet qui tue « ce qui écoute » tuerait le serveur d'une AUTRE app
# du poste (ou d'une app imbriquée tmp/<app>) que `nodefony stop` venait
# précisément d'épargner — deux règles de scoping = dérive garantie.
#
# `process.title` ÉCRASE l'argv dans `ps` : un `pkill -f "nodefony development|
# master|worker|server"` est soit MORT (titre déjà posé → l'argv n'existe plus)
# soit REDONDANT (`nodefony stop` le voit par ps). Ne restent utiles que les argv
# de la fenêtre de boot PRÉ-TITRE (avant que startClusterMaster / generate posent
# le titre), que `stop` ne voit pas encore — plus `rolldown`.

# Tue `pid` seulement si DEUX preuves concordent : (1) son cwd est EXACTEMENT ce
# repo, (2) c'est bien un runtime Nodefony — son titre de process le dit.
# Les runtimes posent tous un `process.title` préfixé `nodefony` (Cli.ts
# `setProcessTitle` ; titres exacts en constantes dans devProcess.ts, seule
# source pour `classify()`). Le filet ne teste ici que le PRÉFIXE, jamais la
# liste des titres : recopier la liste la ferait dériver du jour où un mode en
# ajoute un. Une seule preuve manquante → on n'y touche pas.
kill_if_mine() {
  local pid="$1" what="$2" pcwd pcmd
  pcwd=$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -1)
  pcmd=$(ps -p "$pid" -o command= 2>/dev/null)
  if [ "$pcwd" = "$ROOT" ] && [[ "$pcmd" == *nodefony* ]]; then
    kill -9 "$pid" 2>/dev/null
  elif [ "$pcwd" = "$ROOT" ]; then
    echo ">>> ⛔ $what pid $pid — pas un runtime Nodefony (${pcmd:0:60}), NON touché"
  else
    echo ">>> ⛔ $what pid $pid (${pcwd:-cwd inconnu}) — AUTRE projet, NON touché"
  fi
}

for PID in $(pgrep -f "nodefony cluster" 2>/dev/null; pgrep -f "nodefony production" 2>/dev/null); do
  kill_if_mine "$PID" "boot pré-titre"   # fenêtre pré-titre master cluster / prod mono
done
# rolldown : les workspaces de CE repo (src/*) comptent comme le repo ; une app
# imbriquée qui build garde le sien.
for PID in $(pgrep -f "rolldown" 2>/dev/null); do
  PCWD=$(lsof -a -p "$PID" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -1)
  case "$PCWD" in
    "$ROOT"|"$ROOT"/src/*) kill -9 "$PID" 2>/dev/null ;;
  esac
done
# ⚠️ `-sTCP:LISTEN` OBLIGATOIRE : `lsof -ti:PORT` SEUL vise aussi les CLIENTS
# connectés (le NAVIGATEUR sur Studio) → `kill -9` tuerait le navigateur du user.
# On ne tue QUE les sockets en écoute = le(s) serveur(s), et QUE les nôtres.
PIDS=$( { lsof -ti:5151 -sTCP:LISTEN; lsof -ti:5152 -sTCP:LISTEN; } 2>/dev/null | sort -u )
for PID in $PIDS; do
  kill_if_mine "$PID" "port occupé par"
done
sleep 1
REMAIN=$( { lsof -ti:5151 -sTCP:LISTEN; lsof -ti:5152 -sTCP:LISTEN; } 2>/dev/null | sort -u | wc -l | tr -d ' ')
echo ">>> ports libres ($REMAIN process restants)"
rm -f /tmp/srv.pid
