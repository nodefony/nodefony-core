#!/bin/sh
# Régénère le graphe symbolique (.ai/symbols.json) EN ARRIÈRE-PLAN si la zone
# parsée a bougé entre deux révisions — ou s'il manque (clone neuf).
#
# Seule implémentation, appelée par post-commit, post-merge et post-checkout.
# Le graphe n'est pas versionné : sans ces hooks, il vieillirait en silence et
# les agents (jq, `nodefony symbols`, Studio) liraient un code qui n'existe plus.
# Détaché et muet : un hook post-* ne doit ni ralentir ni faire échouer le geste
# git, qui a déjà eu lieu. Deux générations qui se croisent sont sans danger :
# le générateur écrit par renommage atomique.
#
# usage : _symbols.sh <de> <à>
[ -n "$NF_NO_SYMBOLS_REGEN" ] && exit 0
root="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0
(
  cd "$root" || exit 0
  # --check-range sort 1 quand il FAUT régénérer.
  npm run -s generate-symbols -- --check-range "$1" "$2" >/dev/null 2>&1 \
    || npm run -s generate-symbols >/dev/null 2>&1
) >/dev/null 2>&1 &
exit 0
