#!/usr/bin/env bash
# Banc de guard-bash.sh — le hook est un GATE : on l'a vu mordre ET se taire, cas par cas.
#
# Lancer :  bash .claude/hooks/guard-bash.test.sh
#
# Deux précautions vécues, à ne pas retirer :
#  1. Les cas passent par CE FICHIER et jamais par une commande Bash directe : écrire
#     `git reset --hard` dans une commande la fait mordre par la garde elle-même dès que
#     l'arbre de travail est sale — c'est-à-dire pendant qu'on développe.
#  2. La règle 3 lit l'état RÉEL d'un dépôt (`git status --porcelain` sur le `cwd` du
#     payload). Le banc forge donc un dépôt JETABLE et lui fait jouer les deux états ;
#     il ne touche jamais au dépôt Nodefony.
set -uo pipefail

H="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/guard-bash.sh"
R=$(mktemp -d)
trap 'rm -rf "$R"' EXIT

git -C "$R" init -q
printf 'v1\n' >"$R/a.txt"
git -C "$R" add -A
git -C "$R" -c user.email=t@t -c user.name=t commit -qm init

ko=0
# t <attendu: deny|ask|PASSE> <commande>
t() {
  local attendu=$1 c=$2 r d
  r=$(jq -n --arg c "$c" --arg w "$R" '{cwd:$w,tool_input:{command:$c}}' | bash "$H")
  d=$(printf '%s' "$r" | jq -r '.hookSpecificOutput.permissionDecision' 2>/dev/null)
  d=${d:-PASSE}
  if [ "$d" = "$attendu" ]; then
    printf '  ok   %-42s %s\n' "$c" "$d"
  else
    printf '  KO   %-42s %s (attendu %s)\n' "$c" "$d" "$attendu"
    ko=$((ko + 1))
  fi
}

echo "=== ARBRE PROPRE — rien à perdre, la garde ne doit PAS mordre ==="
for c in 'git reset --hard' 'git clean -fd' 'git stash' 'git checkout -- .' \
  'git restore .' 'git rebase main'; do t PASSE "$c"; done

printf 'travail non commite\n' >"$R/wip.txt"

echo "=== ARBRE SALE — doit REFUSER ==="
for c in 'git reset --hard' 'git clean -fd' 'git stash' 'git stash push -m x' \
  'git checkout -- .' 'git restore src/' 'git -C /tmp/x reset --hard' \
  'npm test && git reset --hard' 'git stash list && git reset --hard'; do t deny "$c"; done

echo "=== ARBRE SALE — doivent PASSER (lecture seule, ou geste qui ne perd rien) ==="
for c in 'git stash list' 'git stash show -p' 'git status --short' 'git log -6' \
  'git add -A' 'git commit -m x' 'git diff --stat' 'git push origin main' \
  'echo "ne jamais git reset"'; do t PASSE "$c"; done

echo "=== push --force — refus inconditionnel (l'historique distant, lui, n'a pas d'état local) ==="
for c in 'git push --force origin main' 'git push -f' 'git push --force-with-lease'; do t deny "$c"; done

echo "=== non-régression règles 1 et 2 ==="
t deny 'rg -rn toto src/'
t deny 'cd src/packages && ls'
t PASSE 'npm run build'
t PASSE 'rg --replace x toto src/'
t PASSE 'cd /Users/cci/repository/nodefony-core && ls'

echo
if [ "$ko" -eq 0 ]; then
  echo "BANC VERT — 0 écart"
else
  echo "BANC ROUGE — $ko écart(s)"
fi
exit "$ko"
