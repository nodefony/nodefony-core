#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# Garde de mise à mort des bancs — À SOURCER, jamais à exécuter.
#
#   . "$(dirname "${BASH_SOURCE[0]}")/kill-guard.sh"
#   kill_listeners 5151 5152 5173 5177      # serveurs EN ÉCOUTE sur ces ports
#   kill_by_cmdline vite.js "bin/nodefony"  # résidus par motif de cmdline
#
# POURQUOI CE FICHIER EXISTE : un banc a SIGKILLé le `claude` qui le lançait.
# Session perdue, aucune trace — un process tué en -9 n'écrit rien, et macOS ne
# produit aucun rapport de crash : l'onglet se fige, sans stack ni message.
#
# DEUX GARDES, et elles sont indissociables :
#
#  (1) `-sTCP:LISTEN` est OBLIGATOIRE. Sans ce filtre, `lsof -ti tcp:PORT` rend
#      AUSSI les CLIENTS connectés à ce port — le navigateur ouvert sur Studio,
#      l'agent qui sonde l'app. On ne tue que des sockets en ÉCOUTE, c'est-à-dire
#      des serveurs. Même règle que `nodefony-start-server/{start,stop}.sh` ; la
#      recopier à moitié, c'est la perdre (elle l'a été ici).
#
#  (2) Une liste d'ÉPARGNE : ce shell, TOUTE sa chaîne d'ancêtres (donc l'agent
#      ou le terminal qui a lancé le banc) et tout process `claude` du poste.
#      Un banc ne tue JAMAIS son lanceur. Cette garde vaut d'autant plus pour
#      `pkill -f` : `-f` matche la LIGNE DE COMMANDE ENTIÈRE, donc un agent dont
#      la commande cite « bin/nodefony » est une victime parfaitement valide.
#
# Ce que ces gardes ne couvrent PAS, et qui reste à la charge de l'appelant :
# le scoping par projet (ne pas tuer le serveur d'une AUTRE application du
# poste). `nodefony-start-server/start.sh` le porte via le cwd du process ; un
# banc, lui, exige les ports pour lui seul et assume de les libérer.
# ─────────────────────────────────────────────────────────────────────────────

# PIDs intouchables : ce shell → ses ancêtres → tout `claude`.
_spare_pids() {
  local p="$$"
  while [ "$p" -gt 1 ] 2>/dev/null; do
    echo "$p"
    p="$(ps -o ppid= -p "$p" 2>/dev/null | tr -d ' ')"
    [ -n "$p" ] || break
  done
  pgrep -x claude 2>/dev/null || true
}

# Espaces en bordure : le test d'appartenance ci-dessous compare " $pid ".
KILL_GUARD_SPARE=" $(_spare_pids | sort -u | tr '\n' ' ')"

# kill_unless_spared <pid> <motif lisible>
kill_unless_spared() {
  case "$KILL_GUARD_SPARE" in
    *" $1 "*)
      echo "⚠️  pid $1 ÉPARGNÉ ($2) — un banc ne tue pas son lanceur"
      return 0
      ;;
  esac
  kill -9 "$1" 2>/dev/null || true
}

# kill_listeners <port> [port ...] — SERVEURS seulement (cf garde 1).
kill_listeners() {
  local ports pid
  ports="$(printf '%s,' "$@" | sed 's/,$//')"
  for pid in $(lsof -ti tcp:"$ports" -sTCP:LISTEN 2>/dev/null | sort -u); do
    kill_unless_spared "$pid" "en écoute sur $ports"
  done
}

# kill_by_cmdline <motif> [motif ...] — remplace `pkill -9 -f` (cf garde 2).
kill_by_cmdline() {
  local pat pid
  for pat in "$@"; do
    for pid in $(pgrep -f "$pat" 2>/dev/null | sort -u); do
      kill_unless_spared "$pid" "cmdline ~ $pat"
    done
  done
}
