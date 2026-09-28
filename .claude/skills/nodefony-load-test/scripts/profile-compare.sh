#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# « Comparé à QUOI ? » — profile Nodefony ET le camp témoin équitable dans le
# MÊME décor, puis rend l'écart poste par poste en µs par requête.
#
# C'est la PREMIÈRE mesure de tout travail sur le coût d'une requête : un
# profil de Nodefony seul dit « 13 % dans les en-têtes », jamais « 37 µs de
# trop, dont 12 en Promises ». Le témoin par défaut est `nest-fair` (NestJS +
# Fastify faisant le MÊME travail de sécurité) : sa parité se prouve AVANT par
# `bench-frameworks/fair-parity.mjs` — un témoin qui travaille moins fabrique un
# écart qui n'existe pas.
#
# Usage : profile-compare.sh [témoin=nest-fair]
# Sortie : tmp/profiles/{nodefony,<témoin>}/ + le rapport à l'écran.
# ─────────────────────────────────────────────────────────────────────────────
set -eu
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$DIR/../../../.." && pwd)"
WITNESS="${1:-nest-fair}"
BASE="${NF_PROFILE_DIR:-$ROOT/tmp/profiles}"
cd "$ROOT"
# Décor : aucun serveur résiduel sur les ports profilés (un fantôme serait
# profilé à la place du nôtre, ou prendrait le port).
node src/nodefony/bin/nodefony stop >/dev/null 2>&1 || true
. "$DIR/kill-guard.sh"; kill_listeners 5151; kill_listeners 5161; sleep 1
XENV="NF_WITH_DEV_MODULES=1 NF_WITH_DEV_MODULES_TTL_MIN=30" \
  bash "$DIR/profile-cpu.sh" nodefony 5151 src/nodefony/bin/nodefony production
XENV="" bash "$DIR/profile-cpu.sh" "$WITNESS" 5161 \
  "$DIR/../bench-frameworks/$WITNESS.mjs"
node "$DIR/profile-compare.mjs" "$BASE/nodefony" "$BASE/$WITNESS"
