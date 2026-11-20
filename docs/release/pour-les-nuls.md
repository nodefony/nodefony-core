---
title: Commiter et publier SANS agent — l'aide-mémoire pour les nuls
lang: fr
status: interne — jamais publié sur le site
publish: false
audience: [developer]
---

# Commiter et publier sans agent

> **Pour qui** : l'auteur, quand il n'y a plus de jetons, ou qu'on veut faire le geste soi-même.
> **Ce que la page couvre** : un correctif de bout en bout, une publication de correctif
> (`10.0.x`), la fusion arrière vers `dev`. Le **pourquoi** de chaque garde vit dans
> [`docs/guides/publier-une-release.md`](../guides/publier-une-release.md) — ici, seulement les
> commandes, dans l'ordre.

## 0. Les quatre branches, en quatre lignes

| Branche          | Ce qu'elle porte                                     | On y commite ?                    |
| ---------------- | ---------------------------------------------------- | --------------------------------- |
| `main`           | la dernière version PUBLIÉE                          | jamais (la publication la pousse) |
| `dev`            | la prochaine mineure (`10.1.0`) — branche par défaut | jamais : par PR                   |
| `release/10.0.x` | les correctifs de la `10.0` (`10.0.1`, `10.0.2`…)    | jamais : par PR                   |
| `fix/<N>-sujet`  | UN ticket (`N` = numéro de l'issue)                  | oui, c'est là qu'on travaille     |

Un commit direct sur `main`, `dev` ou `release/*` est **refusé** par le crochet de commit. En
cas de force majeure seulement : `NF_ALLOW_LONG_BRANCH_COMMIT=1 git commit …`.

## 1. TOUJOURS commencer par se resynchroniser

Toutes les fusions se font sur GitHub : le dépôt local est en retard sans le savoir.

```bash
git fetch origin --prune --tags
```

## 2. Corriger un ticket (ex. #794, correctif de la 10.0)

```bash
# 1. une branche partie de la maintenance À JOUR (origin/…, jamais la locale)
git switch -c fix/794-scope-head --no-track origin/release/10.0.x

# 2. coder, puis commiter — message Conventional Commits, en français, numéro du ticket
git add <fichiers>
git commit -m "fix(http): libérer à coup sûr le scope d'un HEAD en HTTP/2 (#794)"

# 3. pousser (le crochet pre-push bâtit et teste : compter quelques minutes)
git push -u origin fix/794-scope-head

# 4. ouvrir la PR vers la MAINTENANCE (pas vers dev)
gh pr create --base release/10.0.x --title "fix(http): libérer à coup sûr le scope d'un HEAD en HTTP/2" --body "Refs #794"

# 5. attendre la CI, puis fusionner en SQUASH (un ticket = un commit)
gh pr checks <PR> --watch --fail-fast
gh pr merge <PR> --squash --delete-branch

# 6. fermer le ticket soi-même (vers release/*, « Closes #N » ne ferme RIEN)
gh issue close 794 --comment "Livré par #<PR> : <ce qui a changé, en une phrase>"

# 7. revenir à l'état propre
git switch dev && git pull --ff-only && git branch -D fix/794-scope-head
```

Ticket de la **prochaine mineure** : même recette, avec `origin/dev` au point 1 et `--base dev`
au point 4. Vers `dev`, `Closes #N` dans le corps ferme le ticket à la fusion.

## 3. Publier une version de correctif (ex. 10.0.1)

Prérequis : tous les tickets du lot `10.0.1` sont fusionnés sur `release/10.0.x`.

```bash
git fetch origin --prune --tags
git switch release/10.0.x
git merge --ff-only origin/release/10.0.x     # la locale est souvent EN RETARD (l'étape 2 le rattrape seule)

npm ci && npm run build

# 1. RÉPÉTITION — ne touche rien, dit ce qui changerait et ce qui bloque
npm run release -- --version 10.0.1 --branch release/10.0.x

# 2. ESTAMPILLER — écrit les versions et un BROUILLON de CHANGELOG.md
#    Avant d'écrire, il rattrape SEUL (arbre propre) : le retard sur origin/release/10.0.x,
#    puis le commit d'accueil que la publication précédente a poussé sur main.
#    Il le dit d'une ligne « ✓ » ; un conflit est annulé et refusé, avec la commande.
npm run release -- --version 10.0.1 --branch release/10.0.x --write

# 3. RELIRE et RÉÉCRIRE CHANGELOG.md à la main (le seul geste que rien n'automatise)

# 4. PROMOUVOIR — commite l'estampille, pousse, fait avancer main, attend la CI
npm run release -- --version 10.0.1 --promouvoir
#    → il s'arrête AVANT le tag et affiche la commande exacte, avec le sha

# 5. LE TAG — c'est lui qui déclenche la publication npm (par la forge, pas par le poste)
git tag v10.0.1 <sha affiché> && git push origin v10.0.1

# 6. suivre la publication, puis vérifier les étiquettes npm
gh run watch $(gh run list --workflow release.yml --limit 1 --json databaseId -q '.[0].databaseId')   # le flux déclenché par le tag
npm run release -- --dist-tags            # constat : « latest » doit valoir 10.0.1
```

Une version publiée est **brûlée** : rien ne se « dépublie ». En cas de doute avant l'étape 5,
s'arrêter — tout ce qui précède le tag se reprend.

## 4. Rapatrier le correctif dans `dev` (fusion arrière)

À faire **juste après** chaque publication `10.0.x` — sans elle, la prochaine mineure est
refusée (la garde voit un correctif absent de `dev`).

```bash
git fetch origin --prune
git switch -c chore/merge-release-10.0.x --no-track origin/dev
git merge --no-ff --no-edit origin/main
git merge --no-ff --no-edit origin/release/10.0.x
git push -u origin chore/merge-release-10.0.x
gh pr create --base dev --title "chore(release): rapatrier release/10.0.x dans dev" --body "Fusion arrière"
gh pr checks <PR> --watch --fail-fast
gh pr merge <PR> --merge --delete-branch      # --merge, JAMAIS --squash
```

Le script `node .claude/skills/nodefony-ticket/scripts/release-sync.mjs` fait exactement ces
gestes ; la recette ci-dessus est sa version manuelle.

## 5. Quand ça casse

| Symptôme                                                           | Geste                                                                                                     |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| `git commit` refusé : « branche longue »                           | on est sur `dev`/`main`/`release/*` → `git switch -c fix/<N>-sujet` puis recommiter                       |
| un crochet refuse (prettier, lint, fiche de skill…)                | lire la dernière ligne : elle donne la commande (souvent `npm run skills:doc`), la lancer, recommiter     |
| `git push` refusé : « non fast-forward »                           | `git fetch origin && git merge origin/<branche>` puis repousser — jamais `--force` sur une branche longue |
| `npm run release` refuse                                           | lire le message : chaque refus nomme sa cause et son geste ; rien n'a été écrit                           |
| `--promouvoir` : « la forge n'est PAS verte »                      | ne PAS taguer ; corriger par une PR vers `release/10.0.x`, la fusionner, relancer `--promouvoir`          |
| `npm run release` : « la maintenance … est CLOSE (D8) »            | `main` porte déjà la mineure suivante : publier depuis `dev`, puis supprimer la branche `release/x.y.x`   |
| conflit à la fusion arrière sur `.ai/BOARD.md` ou `.ai/board.json` | ces fichiers ne sont plus versionnés : `git rm .ai/BOARD.md .ai/board.json && git commit --no-edit`       |
| autre conflit à la fusion arrière                                  | résoudre, `git add <fichiers>`, `git commit --no-edit`, puis reprendre au `git push`                      |
| tag posé mais pas poussé                                           | `git push origin v10.0.1` — sans le push, rien n'est publié                                               |
| dépôt cloné à neuf                                                 | `npm ci && npm run build` avant toute autre commande                                                      |

## 6. Où en suis-je ?

```bash
git status && git log --oneline -5      # branche courante, commits non poussés
gh pr list                              # PR ouvertes
npm run session:resume                  # le résumé complet : CI, PR, prochain ticket, publication due
```
