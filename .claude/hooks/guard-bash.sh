#!/usr/bin/env bash
# Garde-fou PreToolUse sur Bash — refuse deux gestes qui ont récidivé 26 fois en 13 jours
# alors que les deux règles étaient déjà écrites en mémoire IA. Une phrase ne corrige pas
# un réflexe de frappe ; un refus, si. Et arrête (règle 3) les gestes git qui EFFACENT du
# travail non commité.
#
# Contexte : docs/session-retros/CONSOLIDATION-2026-07-23.md
# Règles    : feedback_rg_no_replace_flag · feedback_bash_cwd_drift
#             feedback_destructive_needs_identity_scope
#
# Entrée : le JSON du hook sur stdin. Sortie : rien (autorisé), ou un verdict "deny"/"ask".
set -uo pipefail

payload=$(cat)
cmd=$(printf '%s' "$payload" | jq -r '.tool_input.command // ""')
cwd=$(printf '%s' "$payload" | jq -r '.cwd // ""')

verdict() {
  jq -n --arg d "$1" --arg r "$2" '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: $d,
      permissionDecisionReason: $r
    }
  }'
  exit 0
}

deny() { verdict deny "$1"; }
ask() { verdict ask "$1"; }

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

# 3. git qui EFFACE du travail non commité. Vécu : un sous-agent chargé de mesurer une
#    baseline a « nettoyé » l'arbre et emporté une heure de code de l'agent principal — il
#    ne voit pas le travail en cours, il ne voit qu'un arbre sale à ranger.
#
#    Pourquoi ICI et pas en `permissions.ask` : `allow: Bash(git *)` avale le prompt sans un
#    mot, et il l'avale AUSSI quand c'est le hook qui rend « ask » (constaté : `git stash
#    list` passait sans rien demander, en `permission_mode: default`). Seul `deny` mord quel
#    que soit l'état des listes de permissions. La garde vit donc ici, et NULLE PART ailleurs.
#
#    Pourquoi un refus CONDITIONNEL : le payload du hook n'identifie pas l'appelant (mêmes
#    `session_id`/`transcript_path` pour un sous-agent). Impossible de viser les sous-agents.
#    On regarde donc l'ENJEU, pas l'auteur : sur un arbre PROPRE ces gestes ne détruisent
#    rien et passent ; sur un arbre SALE ils emportent du travail, et le remède est une
#    action légitime — commiter — jamais une échappatoire à retenir.
DESTRUCTIF='(^|[;&|(])[[:space:]]*git([[:space:]]+(-C[[:space:]]+[^[:space:]]+|-c[[:space:]]+[^[:space:]]+|--no-pager|--git-dir=[^[:space:]]+|--work-tree=[^[:space:]]+))*[[:space:]]+(checkout|restore|reset|clean|rebase|stash)([[:space:]]|$)'
# Les formes de LECTURE de stash ne peuvent rien perdre — mais seules, sans rien enchaîner.
STASH_LECTURE='^[[:space:]]*git([[:space:]]+-[^[:space:]]+)*[[:space:]]+stash[[:space:]]+(list|show)[^;&|`]*$'

if printf '%s' "$cmd" | grep -qE "$DESTRUCTIF" &&
  ! printf '%s' "$cmd" | grep -qE "$STASH_LECTURE"; then
  sale=$(git -C "${cwd:-.}" status --porcelain 2>/dev/null | head -20)
  if [ -n "$sale" ]; then
    n=$(git -C "${cwd:-.}" status --porcelain 2>/dev/null | wc -l | tr -d ' ')
    deny "REFUS — ce geste git (checkout/restore/reset/clean/rebase/stash) efface du travail sur un arbre SALE : $n fichier(s) non commité(s). Un sous-agent ne voit pas le travail en cours de l'agent principal, il ne voit qu'un arbre à ranger — une heure de code a déjà disparu comme ça. Commiter d'abord (\`git add -A && git commit\`), le geste passera ensuite tout seul : sur un arbre propre cette garde ne mord pas. Premiers fichiers en jeu :
$sale"
  fi
fi

# 3bis. `push --force` ne détruit pas l'arbre local mais l'historique DISTANT, et aucun état
#       local ne dit si c'est légitime. Refus sec : le forçage se fait à la main.
if printf '%s' "$cmd" | grep -qE '(^|[;&|(])[[:space:]]*git([[:space:]]+[^[:space:]]+)*[[:space:]]+push([[:space:]]|$)' &&
  printf '%s' "$cmd" | grep -qE '([[:space:]]-f([[:space:]]|$)|--force([[:space:]]|$|-with-lease))'; then
  deny "REFUS — \`git push --force\` réécrit l'historique DISTANT ; rien dans l'état local ne dit si quelqu'un a déjà tiré les commits écrasés. Ce geste se fait à la main, par l'utilisateur, jamais par un agent."
fi

exit 0
