---
adr: 29
title: Travailler en demandes de fusion — branches longues, maintenance et publication
lang: fr
navTitle: Demandes de fusion
date: 2026-11-21
status: accepted
deciders: [Christophe CAMENSULI]
tags: [git, pull-request, release, ci, maintenance, tooling]
---

# ADR-0029 — Travailler en demandes de fusion : branches longues, maintenance et publication

## Statut

Accepté (2026-11-21). Décisions D1 à D8 prises par l'auteur au fil du ticket #796, D9 tranchée
par délégation de l'auteur (« aucune galère »), D10 et D11 tranchées à la clôture du ticket. Cet
ADR les rassemble : le ticket les portait dans ses commentaires, où elles se seraient perdues.

## Contexte

Jusqu'à la 10.0.0, tout le travail se faisait directement sur une seule branche. Une fois une
version publiée, deux lignes coexistent : les correctifs de la version servie, et la mineure
suivante. Travailler en direct sur l'une ou l'autre fait partir un correctif dans la mauvaise
ligne sans que rien ne le signale, et une publication peut fermer la maintenance par accident.
Le dépôt a un seul auteur et une CI longue (~35 min, trois systèmes) : la méthode doit rester
légère, et chaque règle doit être tenue par un automate plutôt que par la mémoire.

## Normes et antériorités

Citées par la revue « normes et antériorités » du 2026-11-20 (#796).

| Source                                                   | Ce qu'elle dit                                                                  | Ce qu'on en retient                                                       |
| -------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| GitFlow, « A successful Git branching model » (nvie.com) | Branches longues distinctes pour ce qui est publié et pour le développement.    | `main` = publié, `dev` = prochaine mineure (D1).                          |
| `gitworkflows(7)`                                        | « commit your fixes to the oldest supported branch […] then merge upwards ».    | Corriger sur `release/x.y.x`, fusionner vers `dev` (D3), par fusion (D5). |
| Angular, branches `x.y.x`                                | Nommage de la ligne de maintenance par sa mineure.                              | `release/10.0.x` (D1).                                                    |
| GitHub, « Linking a pull request to an issue »           | Le mot-clé ne relie et ne ferme que vers la branche par défaut.                 | `Closes` vers `dev`, `Refs` + fermeture à la main vers `release/*` (D4).  |
| GitHub, « Troubleshooting required status checks »       | Un workflow sauté par un filtre de chemin laisse le check exigé « en attente ». | Un seul check exigé, `ci-ok`, jamais filtré au déclencheur (D11).         |

Écartés : file de fusion et « branche à jour exigée » (35 min de CI relancées à chaque fusion,
inutile à un seul auteur) ; PR empilées (incompatibles avec le squash) ; changesets et
release-please (doublon de `npm run release`) ; un worktree par ticket par défaut (second
`node_modules`, pollution de vitest constatée).

## Décisions

### D1 — Trois sortes de branches longues

- **`main`** porte ce qui est publié. Elle n'avance que par `npm run release -- --promouvoir`.
- **`dev`** porte la prochaine mineure. C'est la branche par défaut du dépôt.
- **`release/<majeure>.<mineure>.x`** porte la maintenance d'une version publiée
  (`release/10.0.x`).

### D2 — Une branche de travail par ticket

Nom : `<type>/<ticket>-<sujet>`. Le type vient du titre du ticket (Conventional Commits). Le
sujet est en anglais, en kebab-case ASCII, 40 caractères au plus : un nom de branche voyage dans
les URL, la CI et le terminal, comme un identifiant de code. Exemple : `fix/794-http2-head-scope`.
Le ticket « en cours » se déduit du nom de la branche, jamais des mentions d'un commit.

### D3 — La base suit le jalon

Jalon de correctif (`x.y.z`, z ≥ 1) → `release/x.y.x`. Tout autre jalon, backlog compris →
`dev`. **L'outillage de pilotage** (scripts et skills du dépôt, non publiés sur npm) part de la
plus ancienne `release/*` **existante** : sinon les tickets de maintenance seraient travaillés
sans l'outillage, précisément là où une erreur de base coûte le plus cher.

### D4 — La demande de fusion s'ouvre AVANT tout code

`ticket-start.mjs` crée la branche depuis `origin/<base>`, un commit d'ouverture vide, et la PR
en brouillon (titre et jalon du ticket). Corps : `Closes #N` vers `dev`, où le mot-clé mord ;
`Refs #N` vers `release/*`, où la fermeture reste un geste (`ticket-close.mjs`), et le lien
« Development » se pose à la main (aucune API ne le pose).

### D5 — Squash pour un ticket, commit de fusion pour un rapatriement

Un ticket entre en **squash** (`pr-finish.mjs`) : un ticket = un commit sur la branche longue,
message composé par le script, sans dépendre des réglages du dépôt. Le rapatriement
`release/x.y.x → dev` entre en **commit de fusion** (`release-sync.mjs`) : un squash laisserait
`release/x.y.x` hors des ancêtres de `dev`, et la publication suivante serait refusée.

### D6 — Aucun commit de travail sur une branche longue

Le crochet `commit-msg` refuse un commit de travail sur `main`, `dev` et `release/*`, sauf
l'estampille `chore(release):` et la fusion de rattrapage qui n'intègre que de l'historique
publié. Mettre un ticket de côté = un commit `wip` poussé sur SA branche (`[skip ci]`), jamais
`git stash`.

### D7 — L'empreinte du tableau n'est pas versionnée

`.ai/BOARD.md` et `.ai/board.json` sont générés et ignorés par git, comme `.ai/symbols.json`.
Versionnée, elle salissait l'arbre à chaque reprise, son commit était refusé sur une branche
longue, et deux PR entraient en conflit dessus.

### D8 — `release/x.y.x` meurt à la publication de la mineure suivante

À la sortie de `x.(y+1).0`, la branche de maintenance est supprimée ; un correctif ultérieur part
de `dev` et sort en `x.(y+1).z`. `release/x.y.x:main` n'est plus une avance rapide une fois la
mineure suivante publiée, et la politique de compatibilité ne promet de correctifs qu'à la
dernière version. Conséquence : la règle de D3 sur l'outillage vise toujours une branche vivante.

### D9 — Pas de publication depuis `dev` tant qu'une maintenance attend

Aucune publication depuis `dev` tant qu'une `release/x.y.x` porte un correctif publiable non
publié, ou n'est pas fusionnée dans `dev`. Une préversion de la mineure suivante publiée
par-dessus fermerait la maintenance pour de bon (plus d'avance rapide, et npm ≥ 11 refuse
d'étiqueter `latest` une version inférieure). Gardée par `release-core.mjs#refusDeMaintenance` :
ne comptent que les commits qui atteignent un installeur.

### D10 — Une seule CI par commit publié

`--promouvoir` pousse le même commit sur `main` et sur la branche d'où l'on publie, en une
poussée atomique. Aucun workflow de CI ne se déclenche sur un push vers `main` : la CI de ce
commit tourne une fois, sur la branche publiée, et c'est elle que `attendre-ci.mjs` juge. Deux CI
coûtaient ~35 min de plus, et un rouge de hasard d'un côté bloquait la publication alors que
l'autre était vert. Estampiller ou promouvoir depuis `main` est donc refusé
(`release-core.mjs#refusDepuisPublication`) : le commit y partirait sans aucune CI. Gardé par
`scripts/release/release-workflow.test.mjs`.

### D11 — Un seul check exigé : `ci-ok`

Les règles de protection de `dev` et `release/**` exigent le seul job `ci-ok` de `node.js.yml`,
qui attend tous les autres jobs du workflow (`if: always()`) et échoue sur un échec ou une
annulation. Le filtre de prose vit dans le job `changes`, pas au déclencheur : un workflow filtré
au déclencheur ne démarre pas, et le check exigé ne se rapporterait jamais sur une PR de prose.
`gh pr merge --auto` n'attend que les checks exigés ; sans protection, `pr-finish.mjs` le
constate et surveille la PR en arrière-plan au lieu de fusionner tout de suite.

Le ruleset vit sur la forge, pas dans git : sa définition est versionnée dans
`.github/rulesets/branches-longues.json` (réimportable depuis _Settings → Rules_), et
`release-workflow.test.mjs` vérifie que le check qu'il exige est bien rendu par un job.

## Compatibilité

Aucune surface publiée n'est touchée : scripts, skills, workflows et crochets ne partent pas sur
npm. Les contributeurs externes partent de `dev` (`CONTRIBUTING.md`).

## Coût

Par ticket : un commit d'ouverture vide (effacé par le squash), une CI sur la PR, puis une sur la
branche longue après fusion (le squash crée une empreinte neuve). Par publication : une seule CI
sur le commit d'estampille (D10).

## Fini quand

- `ticket-start.mjs` crée la branche et la PR sur la bonne base, `Refs` ou `Closes` selon elle.
- La reprise affiche la branche, sa PR et ses checks ; sur une branche longue, « aucune branche de
  travail ».
- Un commit de travail sur `dev` est refusé par le crochet.
- Aucun workflow de CI ne se déclenche sur `main`, et `ci-ok` attend tous les jobs de
  `node.js.yml` : `release-workflow.test.mjs` vert, vu rouge sur mutation.
- `npm run test:pilotage` et `npm run test:release` verts.
