# Déléguer à des agents — pour décider, au bon modèle, au moindre coût

> Référence du skill `nodefony-decision-making`, commune à toutes les méthodes qui lancent des
> agents. Les règles GÉNÉRALES de délégation vivent dans le `CLAUDE.md` racine (« Hygiène de
> session », règles 5 et 6) et ne sont pas recopiées ici ; cette page dit comment les appliquer
> à une décision. **Maintenance** : vérité courante ; éditer en place.

## Sommaire

1. La question zéro : faut-il un agent ?
2. Quel agent pour quel geste d'une décision
3. Quel modèle
4. La consigne : ce qu'elle doit contenir, sans exception
5. Lancer
6. Au retour : rien ne passe sans vérification
7. Économiser à résultat identique

## 1. La question zéro : faut-il un agent ?

Dans l'ordre — la première réponse « oui » arrête la recherche :

1. **Un automate rend-il la réponse ?** `rg`, `jq` sur `.ai/symbols.json`, `git log -S`, un gate
   du dépôt (`ticket:lint`, `doc:anchors`, `check:lang`), `nodefony inspect`. Gratuit, exhaustif,
   reproductible : **pas d'agent**. L'automate produit, le modèle juge.
2. **Une commande dont je lis la sortie ?** Pas d'agent : l'écrire pour un autre coûte plus que la
   lancer.
3. **Le résultat conditionne-t-il mon geste suivant (chemin critique) ?** Pas d'agent : sa latence
   se paierait en attente pure.
4. **Moins de ~15 lectures, ou moins de ~6 affirmations à confronter ?** Pas d'agent : le plancher
   d'un agent (~33 k tokens mesurés) dépasse le gain.
5. **Éditer du code ?** Jamais délégué au milieu d'une décision. On délègue le DIAGNOSTIC et la
   MESURE, on applique soi-même.

Sinon, déléguer — et l'avantage n'est pas la vitesse : ce que l'agent lit n'entre jamais dans le
contexte principal, qui se relit à chaque tour.

## 2. Quel agent pour quel geste d'une décision

| Geste                                                                | Agent                                        | Pourquoi                                                                        |
| -------------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------- |
| Rassembler la matière avant de cadrer (corpus, plusieurs modules)    | **nodefony-repo-inventory** (lecture seule)  | lit beaucoup, rend un relevé ancré ; ne juge pas                                |
| Confronter une liste d'affirmations au code (ancres, « en place ? ») | **nodefony-check-claims** (lecture seule)    | verdict binaire par item, avec preuve : travail mécanique                       |
| Lire le journal entier d'un banc ou d'une suite (> ~2 000 lignes)    | **nodefony-run-log-report** (lecture seule)  | rend exit, rouges et sauts — ce que `tail` efface sans le dire                  |
| Un siège d'une table d'experts, un pré-mortem indépendant            | **Plan** (lecture, sans écriture de fichier) | ne recharge pas la hiérarchie `CLAUDE.md` : plancher plus bas                   |
| Lire une page publique (norme, documentation tierce)                 | **web-fetch**                                | rend la réponse, pas la page                                                    |
| Une recherche large sans besoin de voir le modèle                    | **Explore**                                  | lecture seule ; ⚠️ il peut masquer le modèle affiché — l'éviter quand il compte |

Le type le plus restreint qui fait le travail. Un agent complet (`general-purpose`) seulement s'il
doit exécuter quelque chose — jamais pour un siège.

## 3. Quel modèle

- **`haiku` par défaut.** Monter se justifie en UNE phrase qui nomme ce que le modèle léger
  échouerait à faire (« arbitrer deux formulations », « trouver un cas que personne n'a posé »).
  Si la phrase ne vient pas, `haiku` suffit.
- **Le test en une seconde** : la tâche a-t-elle une bonne réponse VÉRIFIABLE ? Oui → `haiku`.
  Juger, pondérer, attaquer, synthétiser → plus haut (`sonnet`, puis `fable`).
- **Pour un siège de table d'experts** : le modèle courant de `assets/sieges.json`, qui évolue par
  la preuve (`methode-table-d-experts.md`, §9) — jamais choisi de tête à chaque fois.
- Coût relatif mesuré par réponse : `haiku` 1, `sonnet` ~5, `fable` ~40. Trop faible coûte DEUX
  fois (le run raté, puis le travail refait) ; trop fort coûte plusieurs fois pour un résultat
  identique.

## 4. La consigne : ce qu'elle doit contenir, sans exception

1. **Le modèle en première ligne** (`MODÈLE : <m> — <pourquoi>`) ET entre crochets dans le champ
   `description` de l'appel (`"[sonnet] Siège exploitant"`).
2. **Le périmètre EXACT** : chemins absolus, ce qu'il ne faut PAS explorer et pourquoi. Aucun
   modèle ne compense un périmètre flou.
3. **Les skills à charger d'abord, NOMMÉS** (« charge d'abord le skill `nodefony-inspect` ») : un
   agent n'ouvre jamais un skill de lui-même, mesuré.
4. **L'interdit de l'index git**, en toutes lettres : ni checkout, stash, restore, reset, commit,
   push. Un agent a déjà emporté une heure de travail non commité en « rangeant » l'arbre.
5. **« Tu proposes, tu n'appliques rien »** : il ignore les décisions de la session.
6. **La forme de la réponse** : bornée en lignes, structurée, avec « ce que je n'ai pas pu
   vérifier » — c'est ce qui rend le retour vérifiable et la synthèse peu chère.
7. **Committer AVANT de déléguer** si l'arbre n'est pas propre, et ne jamais éditer les fichiers
   qu'un agent lit pendant qu'il tourne.

## 5. Lancer

- Pour une méthode qui lance plusieurs agents : **annoncer** à l'auteur le nombre, le modèle de
  chacun et le coût estimé, **attendre son go**.
- Les agents indépendants partent **dans le même message**, en parallèle.
- Une orchestration par l'outil `Workflow` (dizaines d'agents, vérification adverse de chaque
  constat) ne se lance que si l'auteur le demande en ces termes (« utilise un workflow »).
- Pendant qu'un agent tourne : avancer ailleurs, ne jamais prédire son résultat.

## 6. Au retour : rien ne passe sans vérification

- Un agent affirme avec le même aplomb ce qu'il a lu et ce qu'il suppose. **Chaque affirmation qui
  nourrit une décision est vérifiée** (`ls`, `rg`, `show-symbol`) — ou en lot par un agent `haiku`
  au-delà de ~6.
- Ce qui ne se vérifie pas s'écrit « non vérifié » dans ce qu'on montre à l'auteur.
- Le rapport d'un agent n'est pas montré à l'auteur : on en rend ce qui compte, vérifié.

## 7. Économiser à résultat identique

- La matière commune dans **un fichier**, dont on donne le chemin — jamais recopiée dans chaque
  consigne.
- Les **ancres déjà trouvées** données à l'agent : il ne refait pas l'exploration.
- Une **relance au même agent** (`SendMessage`, son contexte intact) plutôt qu'un agent neuf.
- La **réponse bornée** : on paie ce qu'on lit en synthèse.
- **Mesurer** ce que chaque délégation a rapporté (constats retenus, constats faux, coût quand
  l'outil le rend) : c'est ce qui permet de descendre un modèle sans perdre le résultat
  (`methode-table-d-experts.md`, §9).
