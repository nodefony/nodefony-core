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
#    Sans objet quand Claude Code RAMÈNE le shell à la racine du projet après chaque commande
#    (`CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR=1`, posé dans `.claude/settings.json`) : un
#    `cd` relatif part alors toujours de la racine, il n'y a plus de dérive à craindre. Cette
#    règle pesait les deux tiers des refus mesurés — autant de tours perdus.
if [ "${CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR:-}" != "1" ] &&
  printf '%s' "$cmd" | grep -qE '(^|[;&|][[:space:]]*)cd[[:space:]]+[^/~$"'"'"'-]'; then
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
# Les formes de LECTURE de stash ne peuvent rien perdre : on les RETIRE de la commande avant
# de chercher un geste destructif. `git stash list | head` passe alors ; `git stash list &&
# git reset --hard` garde son `reset` et mord. Les exiger seules refusait la première —
# un tour perdu pour une lecture.
STASH_LECTURE='git([[:space:]]+-[^[:space:]]+)*[[:space:]]+stash[[:space:]]+(list|show)[^;&|`]*'
sans_lecture=$(printf '%s' "$cmd" | sed -E "s/$STASH_LECTURE//g")

if printf '%s' "$sans_lecture" | grep -qE "$DESTRUCTIF"; then
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

# 4. Un agent n'ARRÊTE jamais une exécution de CI. Vécu à la release 10.0.0-beta.1 : l'agent
#    a annulé en boucle les runs `dev` du commit qu'il publiait (« ils doublent ceux de
#    `main` ») — sous le jeton de l'utilisateur, donc affiché « canceled by @<user> » : des
#    jobs qui s'arrêtent d'un coup, au pire moment, sans que personne ne l'ait demandé.
#    Une annulation n'économise rien (la CI est gratuite) et coûte un verdict : la garde de
#    publication compte un `cancelled` ROUGE. Supprimer un run ou couper un workflow efface
#    le verdict de la même façon. Lire, attendre et RELANCER restent libres ; l'arrêt, s'il
#    le faut vraiment (job figé), se fait à la main dans l'interface.
if printf '%s' "$cmd" | grep -qE '(^|[;&|(]|do)[[:space:]]*gh[[:space:]]+(run[[:space:]]+(cancel|delete)|workflow[[:space:]]+disable)([[:space:]]|$|;)' ||
  printf '%s' "$cmd" | grep -qE '(^|[;&|(]|do)[[:space:]]*gh[[:space:]]+api[[:space:]].*actions/runs/[^[:space:]]*/(force-)?cancel([[:space:]]|$)'; then
  deny "REFUS — un agent n'arrête, ne supprime ni ne désactive JAMAIS une exécution de CI. Elle tourne sous le jeton de l'utilisateur (« canceled by @… ») : des jobs qui s'arrêtent d'un coup, et un commit qui perd son verdict — la garde de publication compte un \`cancelled\` ROUGE. La CI est gratuite : laisser finir. Pour attendre : \`gh run watch\` ; pour rejouer : \`gh run rerun\`. Un job réellement figé s'arrête À LA MAIN, par l'utilisateur, dans l'interface GitHub."
fi

# 5. `timeout` (GNU coreutils) n'existe PAS sur macOS : la commande part, rend 127
#    (« command not found ») et le travail qu'elle encadrait n'a JAMAIS tourné — un `; echo
#    exit=$?` affiche alors 127 au milieu d'une sortie qu'on croit être celle du banc. Réflexe
#    récidivant malgré la règle écrite. La capacité se CONSTATE (`command -v`), elle ne se
#    déduit pas de la plateforme ; `NF_GUARD_HAS_TIMEOUT` injecte le verdict pour le banc.
if printf '%s' "$cmd" | grep -qE '(^|[;&|(`]|do|then|\$\()[[:space:]]*g?timeout[[:space:]]+[-0-9]'; then
  has_timeout=${NF_GUARD_HAS_TIMEOUT:-$(command -v timeout >/dev/null 2>&1 && echo 1 || echo 0)}
  if [ "$has_timeout" != "1" ]; then
    deny "\`timeout\` n'existe pas sur cette machine (GNU coreutils, absent de macOS) : la commande rendrait 127 sans avoir rien exécuté. Borner autrement : vitest a son propre délai (\`--testTimeout\`, et le délai par test) ; une attente longue passe en \`run_in_background\` ; sinon \`perl -e 'alarm shift; exec @ARGV' 300 <commande>\`, portable, présent partout."
  fi
fi

# 6. Lire du CODE par grosse tranche — `sed -n 100,250p f.ts`, `cat f.ts`. Mesuré sur les
#    415 sessions du dépôt : lire du code par tranches pèse ~65 % de ce que les sorties
#    d'outils coûtent en relecture (`sed` seul : 33 %, 8 102 appels). On imprime 150 lignes
#    pour en lire 20, et la sortie se repaie à CHAQUE tour suivant. Une règle écrite ne
#    change pas ce réflexe ; le refus, si — à condition de donner la commande qui remplace.
#    `show-symbol.mjs` borne la lecture par l'AST : la déclaration ENTIÈRE, rien autour —
#    il ne raccourcit pas, il remplace une borne devinée par une borne exacte. Le refus ne
#    doit jamais faire lire MOINS que nécessaire : l'outil Read reste libre pour le fichier
#    entier, et le message le dit. Tolérés : une tranche ≤ 60 lignes, un `cat` filtré
#    (`| grep`), un fichier court, tout ce qui n'est pas du code source.
SHOW=".claude/skills/nodefony-inspect/scripts/show-symbol.mjs"
lecture_refusee() {
  deny "REFUS — lire du code par tranche ($1) : on imprime tout pour en lire quelques lignes, et la sortie se repaie à CHAQUE tour suivant (premier poste de dépense mesuré). Plan du fichier : \`node $SHOW --outline $2\` ; puis une déclaration entière, TSDoc compris : \`node $SHOW '$2#Classe.methode'\` (ou \`#fonction\`), plusieurs d'un coup si besoin — rien n'est tronqué. Une tranche courte (≤ 60 lignes) reste permise ; s'il faut VRAIMENT le fichier entier (refactor global, code de haut niveau d'un script), l'outil Read le lit, sciemment."
}
re_sed="sed[[:space:]]+-n[[:space:]]+['\"]?([0-9]+),([0-9]+)p['\"]?[[:space:]]+['\"]?([^[:space:];|&'\"]+\.(ts|tsx|mts|mjs))"
reste=$cmd
while [[ $reste =~ $re_sed ]]; do
  if ((BASH_REMATCH[2] - BASH_REMATCH[1] + 1 > 60)); then
    lecture_refusee "$((BASH_REMATCH[2] - BASH_REMATCH[1] + 1)) lignes" "${BASH_REMATCH[3]}"
  fi
  reste=${reste#*"${BASH_REMATCH[0]}"}
done
re_cat="(^|[;&(])[[:space:]]*cat[[:space:]]+['\"]?([^[:space:];|&<>'\"]+\.(ts|tsx|mts|mjs))['\"]?[[:space:]]*(;|&&|$)"
if [[ $cmd =~ $re_cat ]]; then
  f=${BASH_REMATCH[2]}
  case $f in /*) p=$f ;; *) p="${cwd:-.}/$f" ;; esac
  n=$( [ -f "$p" ] && wc -l <"$p" | tr -d ' ' || echo 0)
  if [ "$n" -gt 150 ]; then lecture_refusee "fichier entier, $n lignes" "$f"; fi
fi

# 7. Pas de Python dans l'outillage : Node (`.mjs`/`.ts`) ou rien. La règle était écrite et
#    n'a pas tenu — 3 993 appels `python3` mesurés, dont 167 en échec. Un script Python ne
#    part dans aucun gate, n'est lu par aucun autotest, et se réécrit à chaque session.
if printf '%s' "$cmd" | grep -qE '(^|[;&|(`]|do|then|\$\()[[:space:]]*python3?([[:space:]]|$)'; then
  deny "REFUS — pas de Python dans l'outillage de ce dépôt : Node ou rien. Un calcul ponctuel : \`node -e '…'\` ; un script qui resservira : un \`.mjs\` dans les \`scripts/\` du skill concerné, avec son autotest. Une modification de texte : l'outil Edit."
fi

exit 0
