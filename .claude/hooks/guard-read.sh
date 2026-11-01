#!/usr/bin/env bash
# Garde-fou PreToolUse sur Read — refuse la lecture BORNÉE (offset/limit) d'un fichier de
# code : c'est la même tranche devinée que `sed -n`, par un autre outil. Le fichier entier
# reste libre (lecture voulue). Règle et message : `code-slice.mjs`, seule implémentation.
#
# Coût : jq seul tant que la lecture n'est pas bornée ou ne vise pas du code.
# Entrée : le JSON du hook sur stdin. Sortie : rien (autorisé), ou un verdict "deny".
set -uo pipefail

payload=$(cat)
file=$(printf '%s' "$payload" | jq -r '.tool_input.file_path // ""')
offset=$(printf '%s' "$payload" | jq -r '.tool_input.offset // ""')
limit=$(printf '%s' "$payload" | jq -r '.tool_input.limit // ""')
[ -z "$offset$limit" ] && exit 0
[[ $file =~ \.(ts|tsx|mts|cts|mjs|cjs|js)$ ]] || exit 0

raison=$(node "$(dirname "${BASH_SOURCE[0]}")/code-slice.mjs" --read "$file" "$offset" "$limit" 2>/dev/null)
[ -z "$raison" ] && exit 0
jq -n --arg r "$raison" '{
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
    permissionDecisionReason: $r
  }
}'
