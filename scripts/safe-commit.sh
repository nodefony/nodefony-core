#!/usr/bin/env bash
# safe-commit.sh — wrapper de `git commit` qui retire un .git/index.lock orphelin.
#
# Problème : 12 retex ont diagnostiqué le même `.git/index.lock` résiduel
# (lint-staged crashé, extension git de l'IDE, terminal fermé en plein commit) —
# bloque le commit suivant avec « another git process seems to be running ».
# Le hook pre-commit NE PEUT PAS se nettoyer (git détient déjà le lock quand le
# hook tourne) → traiter AVANT `git commit`.
#
# Sûreté :
#   - Le lock n'est retiré QUE si AUCUN process git/lint-staged/prettier
#     ne tourne actuellement.
#   - Le lock doit appartenir à CE repo (résolution `git rev-parse`).
#   - Aucun rm si lock < 5 s (un git légitime vient de démarrer).
#
# Usage : `bash scripts/safe-commit.sh -F /tmp/msg.txt`
#         `bash scripts/safe-commit.sh -m "message"`
# (tous les args sont passés tels quels à `git commit`)

set -eu

# 1. Racine du repo (sortie d'urgence si pas dans un repo git).
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "safe-commit: pas dans un repo git" >&2
  exit 1
}
LOCK="$REPO_ROOT/.git/index.lock"

# 2. Si pas de lock → commit direct.
if [ ! -e "$LOCK" ]; then
  exec git commit "$@"
fi

# 3. Lock présent — âge en secondes (portable macOS/Linux).
NOW=$(date +%s)
LOCK_MTIME=$(stat -f %m "$LOCK" 2>/dev/null || stat -c %Y "$LOCK" 2>/dev/null || echo "$NOW")
AGE=$((NOW - LOCK_MTIME))

# 4. Détecter un process git/lint-staged/prettier vivant (hors ce shell).
#    -f = match sur la cmdline complète. On exclut notre propre PID + le grep lui-même.
SELF_PID=$$
ACTIVE=$(pgrep -fl 'git (commit|add|rebase|merge|cherry-pick|am|stash|reset|checkout)|lint-staged|prettier --write' 2>/dev/null \
  | awk -v me="$SELF_PID" '$1 != me { print }' \
  | head -5 || true)

if [ -n "$ACTIVE" ]; then
  echo "safe-commit: lock présent ET process git actif — on ne touche pas." >&2
  echo "$ACTIVE" >&2
  exec git commit "$@"   # git affichera le vrai message d'erreur si vraiment bloqué
fi

# 5. Lock trop récent → attendre 2 s puis re-check (un git légitime vient de démarrer).
if [ "$AGE" -lt 5 ]; then
  sleep 2
  ACTIVE=$(pgrep -fl 'git (commit|add|rebase|merge|cherry-pick|am|stash|reset|checkout)|lint-staged|prettier --write' 2>/dev/null \
    | awk -v me="$SELF_PID" '$1 != me { print }' \
    | head -5 || true)
  if [ -n "$ACTIVE" ]; then
    echo "safe-commit: lock pris par un git légitime (apparu il y a < 5 s)." >&2
    exec git commit "$@"
  fi
fi

# 6. Lock orphelin confirmé → retirer + commit.
echo "safe-commit: .git/index.lock orphelin (âge ${AGE} s) → retrait" >&2
rm -f "$LOCK"
exec git commit "$@"
