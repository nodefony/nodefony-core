#!/usr/bin/env bash
# Garde-fou PreToolUse sur Bash — refuse deux gestes qui ont récidivé 26 fois en 13 jours
# alors que les deux règles étaient déjà écrites en mémoire IA. Une phrase ne corrige pas
# un réflexe de frappe ; un refus, si.
#
# Contexte : docs/session-retros/CONSOLIDATION-2026-07-23.md
# Règles    : feedback_rg_no_replace_flag · feedback_bash_cwd_drift
#
# Entrée : le JSON du hook sur stdin. Sortie : rien (autorisé) ou un verdict "deny".
set -uo pipefail

cmd=$(jq -r '.tool_input.command // ""')

deny() {
  jq -n --arg r "$1" '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: $r
    }
  }'
  exit 0
}

# 1. `rg -r` = `--replace`, PAS « récursif ». ripgrep est récursif par défaut ; `-r` réécrit
#    la sortie et la rend mutilée SANS erreur — on lit alors un faux contenu de fichier.
#    Ne mord que sur l'option collée au nom (`rg -r`, `rg -rn`, `rg -rln`), qui est la forme
#    du réflexe. `rg --replace` reste autorisé : là, c'est voulu.
if printf '%s' "$cmd" | grep -qE '(^|[[:space:];&|(])rg[[:space:]]+-[a-zA-Z]*r[a-zA-Z]*([[:space:]]|$)'; then
  deny "\`rg -r\` = \`--replace\`, pas « récursif » — ripgrep l'est déjà par défaut. Cette option réécrit la sortie et la rend mutilée en silence : on croit lire le fichier, on lit une réécriture. Retirer le \`-r\` ; si le remplacement est voulu, écrire \`--replace\` en toutes lettres."
fi

# 2. `cd` relatif. Le cwd PERSISTE entre les appels Bash et dérive : la commande suivante
#    tombe dans un autre workspace. Le symptôme ne dit jamais son nom (« describe is not
#    defined », TS5058, « 0 test », les tests d'un autre module).
#    Formes tolérées : /absolu, ~, "$VAR", `cd -`. Seul le chemin relatif nu est refusé.
if printf '%s' "$cmd" | grep -qE '(^|[;&|][[:space:]]*)cd[[:space:]]+[^/~$"'"'"'-]'; then
  deny "\`cd\` relatif : le cwd persiste entre les appels Bash et dérive — la commande suivante s'exécutera peut-être ailleurs, et l'erreur ne le dira pas. Utiliser un chemin ABSOLU dans le MÊME appel : \`cd /Users/cci/repository/nodefony-core/<...> && <commande>\`."
fi

exit 0
