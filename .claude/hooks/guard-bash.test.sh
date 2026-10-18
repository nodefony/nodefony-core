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

echo "=== CI — un agent n'arrête JAMAIS une exécution (refus inconditionnel) ==="
for c in 'gh run cancel 36459961370' 'gh run cancel' \
  'for id in 1 2; do gh run cancel $id >/dev/null 2>&1; done' \
  'cd /Users/cci/repository/nodefony-core && gh run cancel 1' \
  'gh api -X POST repos/nodefony/nodefony-core/actions/runs/1/cancel' \
  'gh api --method POST repos/o/r/actions/runs/1/force-cancel' \
  'gh run delete 1' 'gh workflow disable node.js.yml'; do t deny "$c"; done

echo "=== CI — lire, attendre, relancer : doivent PASSER ==="
for c in 'gh run list --branch dev' 'gh run view 1 --log-failed' 'gh run watch 1' \
  'gh run rerun 1 --failed' 'gh workflow run release-smoke.yml --ref dev' \
  'gh run list --status cancelled' 'gh api repos/o/r/actions/runs?head_sha=abc' \
  'gh workflow enable node.js.yml'; do t PASSE "$c"; done

echo "=== non-régression règles 1 et 2 ==="
t deny 'rg -rn toto src/'
t deny 'cd src/packages && ls'
t PASSE 'npm run build'
t PASSE 'rg --replace x toto src/'
t PASSE 'cd /Users/cci/repository/nodefony-core && ls'

echo "=== règle 5 — timeout ABSENT (verdict injecté) : refusé ==="
export NF_GUARD_HAS_TIMEOUT=0
for c in 'timeout 300 npm test' 'cd /tmp && timeout 5 ls' 'gtimeout 10s sleep 1' \
  '(timeout 300 npm run test:memory > x.log; echo $?)' 'for i in 1; do timeout 2 ls; done'; do
  t deny "$c"
done
echo "=== règle 5 — le MOT timeout ailleurs qu'en commande : doit PASSER ==="
for c in 'npx vitest run --testTimeout 60000' 'grep timeout file.ts' \
  'jq ".timeout" settings.json' 'echo "timeout 300 dans un texte"' 'node -e "setTimeout(()=>{},1)"'; do
  t PASSE "$c"
done
echo "=== règle 5 — timeout PRÉSENT (verdict injecté) : doit PASSER ==="
export NF_GUARD_HAS_TIMEOUT=1
t PASSE 'timeout 300 npm test'
unset NF_GUARD_HAS_TIMEOUT

echo "=== règle 6 — code lu par GROSSE tranche : doit REFUSER ==="
seq 200 | sed 's/^/\/\/ l/' >"$R/gros.ts"
seq 20 | sed 's/^/\/\/ l/' >"$R/petit.ts"
for c in "sed -n '100,250p' src/x.ts" 'sed -n 1,200p a/b.tsx' \
  "rg -n foo x.ts && sed -n '10,120p' src/y.mjs" 'cat gros.ts' 'ls && cat gros.ts'; do
  t deny "$c"
done
echo "=== règle 6 — tranche courte, fichier court, cat filtré, non-code : doivent PASSER ==="
for c in "sed -n '100,140p' src/x.ts" 'sed -n 1,500p notes.md' 'cat petit.ts' \
  'cat gros.ts | grep l1' "sed -n '5,10p' a.ts; sed -n '20,70p' b.ts" \
  "sed -i 's/a/b/' x.ts"; do
  t PASSE "$c"
done

echo
if [ "$ko" -eq 0 ]; then
  echo "BANC VERT — 0 écart"
else
  echo "BANC ROUGE — $ko écart(s)"
fi
exit "$ko"
