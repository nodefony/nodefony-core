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
# Le banc hérite de l'environnement de qui le lance — dont, sous Claude Code, le retour
# à la racine que `.claude/settings.json` pose. La règle 2 en dépend : on part SANS.
unset CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR
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
  'git add -u' 'git commit -m "fix: x"' 'git diff --stat' 'git push origin main' \
  'echo "ne jamais git reset"' 'git stash list | head -1' 'git stash show -p | wc -l'; do t PASSE "$c"; done

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

echo "=== règle 6 — TOUTE tranche de code, sans tolérance : doit REFUSER ==="
# Chaque cas est une forme vécue : la tranche courte, celle qui ne coupait aucune
# déclaration, la cible en variable ($F), le cat seul ou passé à un découpeur, head/tail/awk.
for c in "sed -n '100,250p' src/x.ts" 'sed -n 1,200p a/b.tsx' "sed -n '5,10p' a.ts" \
  "sed -n 1,3p code.ts" "sed -n '12p' x.mjs" "sed -n '10,\$p' x.ts" "sed -n 10,+5p x.cjs" \
  "rg -n foo x.ts && sed -n '10,12p' src/y.mjs" 'F=src/a.ts; sed -n 1,80p $F' \
  'sed -n 1,34p "$F"' 'cat gros.ts' 'ls && cat petit.ts' 'cat -n x.ts | sed -n 20,40p' \
  'nl x.ts | head -30' 'head -40 x.ts' 'head -n 40 x.ts' 'tail -n 20 src/x.mts' \
  "awk 'NR>=10 && NR<=40' x.ts" 'echo $(sed -n 1,5p x.ts)'; do
  t deny "$c"
done
echo "=== règle 6 — non-code, recherche, fichier copié, écriture : doivent PASSER ==="
for c in 'sed -n 1,500p notes.md' 'tail -n 50 "$LOG"' 'tail -f tmp/runs/x.log' \
  'cat gros.ts | grep l1' 'rg -n foo x.ts | head -20' 'cat a.ts > b.ts' \
  "sed -i 's/a/b/' x.ts" "awk '{print \$1}' x.ts" 'head -c 100 data.bin' \
  'node -e "require(1) | sed -n 1,5p x.ts"' 'git log --oneline | head -5' \
  "cat > a.ts <<'EOF'
sed -n 1,80p x.ts
EOF"; do
  t PASSE "$c"
done

echo "=== règle 6 — outil Read (guard-read.sh) ==="
G="$(dirname "$H")/guard-read.sh"
r() { # r <attendu> <fichier> <offset> <limit>
  local d
  d=$(jq -n --arg f "$2" --arg o "$3" --arg l "$4" \
    '{tool_input:({file_path:$f} + (if $o=="" then {} else {offset:($o|tonumber)} end) + (if $l=="" then {} else {limit:($l|tonumber)} end))}' |
    bash "$G" | jq -r '.hookSpecificOutput.permissionDecision' 2>/dev/null)
  d=${d:-PASSE}
  if [ "$d" = "$1" ]; then printf '  ok   Read %-36s %s\n' "$2 $3/$4" "$d"
  else printf '  KO   Read %-36s %s (attendu %s)\n' "$2 $3/$4" "$d" "$1"; ko=$((ko + 1)); fi
}
r deny /r/x.ts 100 40
r deny /r/x.mjs "" 30
r PASSE /r/x.ts "" ""
r PASSE /r/notes.md 100 40

echo "=== règles 8 à 14 — gestes mesurés sur les transcripts : doivent REFUSER ==="
# Le trailer est ASSEMBLÉ ici : écrit en clair dans une commande Bash, il ferait mordre
# la règle 8 sur la commande qui édite ce banc (vécu en l'écrivant).
TR="Co-Authored-By"": Claude"
for c in "git commit -m \"feat: x

$TR Opus <noreply@anthropic.com>\"" \
  "git commit -F- <<'EOF'
fix: y

$TR <n@a.com>
EOF" \
  'npm test 2>&1 | tail -20' 'npx vitest run x.test.ts | head -50' \
  'npm run build 2>&1 | grep -i error | head' 'npx tsc --noEmit -p . | tail -5' \
  'npm run test:memory 2>&1 | tail -30' \
  'npx vitest run | grep FAIL; echo "exit $?"' 'node x.mjs | tee tmp/runs/a.log; echo $?' \
  'git add . && git commit -m x' 'git -C src add -A' 'git add --all' \
  'git commit --no-verify -m x' 'git push --no-verify' \
  'gh issue comment 618 --body x && git push' 'git push; gh pr comment 3 -b ok'; do
  t deny "$c"
done
echo "=== règle 11 — suppression récursive DESTRUCTRICE ou HORS du dépôt : doit REFUSER ==="
# Le dépôt est le dépôt JETABLE du banc ($R) : c'est lui la frontière.
# Zone jetable : son CONTENU se supprime, sa racine jamais (un glob vide la racine).
T=$(node -p 'require("node:os").tmpdir()')
for c in 'rm -rf /' 'rm -rf /*' 'rm -rf ~' 'rm -rf ~/projets' \
  'rm -rf ..' 'rm -rf .' 'rm -rf *' 'rm -rf ./*' 'rm -rf .git' 'rm -r ~/voisin' \
  'ls && rm --recursive --force /etc' 'rm -fr a /usr/local' \
  'rm -rf /tmp' 'rm -rf /tmp/' 'rm -rf /tmp/*' "rm -rf $T" "rm -rf $T/*" \
  'rm -rf ~/.claude' 'rm -rf ~/.claude/' 'rm -rf ~/.claude/*' 'rm -rf ~/.claude/../projets'; do
  t deny "$c"
done
echo "=== règle 11 — cible non résoluble ici : l'auteur confirme ==="
for c in 'rm -rf $B/x' 'rm -rf "$(pwd)/x"' 'cd $D && rm -rf x'; do t ask "$c"; done
echo "=== règle 11 — DANS le dépôt : doit PASSER ==="
for c in 'rm -rf tmp/bench/x' 'rm -fr a' 'rm -r -f b' 'rm -rf tmp/*' 'rm -rf ./dist' \
  'rm -rf a/../b' "rm -rf $R/tmp/x" "cd $R/sub && rm -rf x" \
  'rm -rf /tmp/x' 'cd /tmp && rm -rf x' "rm -rf $T/nf-banc-x" \
  'rm -rf ~/.claude/projects/x/scratchpad' 'rm -rf ~/.claude/plugins/cache/y'; do
  t PASSE "$c"
done
echo "=== règles 8 à 14 — voisins légitimes : doivent PASSER ==="
for c in 'git commit -m "docs: pas de trailer Co-Authored"' 'npm test > tmp/runs/t.log 2>&1; echo "exit $?"' \
  'set -o pipefail; node a.mjs | grep x; echo $?' 'ls 2>&1 | grep x' 'git log --oneline | head -5' \
  'rg -n foo src | head -20' 'npm run dev | tail -f' 'git add -- a.ts b.ts' 'git add -u' \
  'gh issue comment 618 --body "x && y"' 'rm -f a.txt' 'rm -r vide/' 'echo "rm -rf x"' \
  'node -e "a | tail; echo $?"'; do
  t PASSE "$c"
done

echo "=== règle 15 — message de commit refusé par commitlint AVANT le pre-commit : doit REFUSER ==="
LONG="chore(board): $(printf 'x%.0s' $(seq 100))"
for c in 'git commit -m "docs(adr): ADR-0022 fixe le codec"' "git commit -qm \"$LONG\"" \
  'git commit -m "Correction sans type"' 'git commit -m "fix(http): finir par un point."' \
  "git commit -q -F- <<'EOF'
feat(realtime): Majuscule en tête

Corps.
EOF" \
  "cat > tmp/scratch/nf-msg-absent.txt <<'EOF'
$LONG

Corps.
EOF
git add x && git commit -q -F tmp/scratch/nf-msg-absent.txt" \
  "cat <<'EOF' > tmp/scratch/nf-msg-absent.txt
$LONG
EOF
git commit -F tmp/scratch/nf-msg-absent.txt"; do
  # Les deux derniers : le fichier est écrit par la MÊME commande — absent au
  # contrôle. Vécu : le titre de 110 caractères n'a été refusé qu'après tout le
  # pre-commit, par commitlint.
  t deny "$c"
done
echo "=== règle 15 — messages conformes, commit sans message lisible : doivent PASSER ==="
for c in 'git commit -q -m "fix(http): corriger une chose" -m "Corps libre, Majuscules permises."' \
  'git commit --amend --no-edit' 'git commit' "git commit -q -F- <<'EOF'
feat(realtime): router les trames binaires

Corps.
EOF" "cat > tmp/scratch/nf-msg-absent.txt <<'EOF'
fix(scaffold): un titre conforme écrit par la même commande

Corps.
EOF
git commit -q -F tmp/scratch/nf-msg-absent.txt"; do
  t PASSE "$c"
done

echo "=== règle 2 — retour à la racine ACTIF (verdict injecté) : cd relatif doit PASSER ==="
export CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR=1
t PASSE 'cd src/packages && ls'
t PASSE 'rg -n "cd relatif\|cd ok" x.sh'
unset CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR

echo "=== règle 7 — Python : doit REFUSER ==="
for c in 'python3 x.py' 'python -c "print(1)"' 'ls && python3 -I a.py' '$(python3 -V)'; do
  t deny "$c"
done
echo "=== règle 7 — mention, recherche, Node : doivent PASSER ==="
for c in 'echo python3' 'rg -n python3 docs/' 'node -e 1' 'ls pythonic/'; do t PASSE "$c"; done

echo
if [ "$ko" -eq 0 ]; then
  echo "BANC VERT — 0 écart"
else
  echo "BANC ROUGE — $ko écart(s)"
fi
exit "$ko"
