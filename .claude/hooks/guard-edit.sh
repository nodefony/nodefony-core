#!/usr/bin/env bash
# Garde-fou PreToolUse sur Edit/Write — refuse d'éditer `src/` pendant qu'une
# passe `test:all` occupe l'arbre. Le pre-commit lit le même verrou, mais c'est
# l'ÉDITION qui invalide la passe, pas le commit qui la suit : deux campagnes
# perdues ainsi. Seule implémentation du verrou : scripts/long-run-lock.mjs
# (processus mort, verrou de plus de 4 h : ignorés ; sortie de secours `clear`).
#
# Coût hors passe : un test d'existence de fichier, sans lancer node.
# Entrée : le JSON du hook sur stdin. Sortie : rien (autorisé), ou un verdict "deny".
set -uo pipefail

root="${CLAUDE_PROJECT_DIR:-$(pwd)}"
[ -f "$root/tmp/long-run.lock" ] || exit 0

file=$(jq -r '.tool_input.file_path // ""')
case "$file" in
  "$root"/src/*) ;;
  *) exit 0 ;;
esac

if reason=$(node "$root/scripts/long-run-lock.mjs" check 2>&1); then
  exit 0
fi

jq -n --arg r "$reason" '{
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
    permissionDecisionReason: $r
  }
}'
