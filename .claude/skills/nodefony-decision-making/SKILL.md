---
name: nodefony-decision-making
metadata:
  version: 3.2.0
description: >
  Référence de Nodefony pour TRANCHER un sujet sans revenir en arrière — architecture, API publique,
  sécurité, performance, version, documentation, tickets, nom public. Pose le socle commun (cadrer,
  relire ce qui fait foi, question fermée à l'auteur, chaque oui inscrit dans l'ADR et le ticket
  puis gardé par un test) et aiguille vers la méthode que le sujet demande : pas à pas, scénarios
  avant les options, table d'experts (agents indépendants aux métiers distincts), pré-mortem,
  mesure, essai jetable. Expert de la délégation : quand déléguer, à quel agent, sur quel modèle, en
  apprenant de l'usage à dépenser moins pour un résultat identique. Une méthode s'ajoute par un
  fichier. Déclencheurs : "aide-moi à décider", "comment trancher ça ?", "une décision à la fois",
  "on revient souvent en arrière", "plusieurs experts autour d'une table", "contradicteur",
  "décision par décision", "petit pas par petit pas", "il y a trop de choses", "j'ai du mal à
  suivre", "à quel agent déléguer ?", "quel modèle pour cet agent ?".
---

# nodefony-decision-making — trancher sans revenir en arrière

> **Maintenance** : vérité courante, jamais un journal. Éditer en place ; historique = `git log`.
> **Ce skill évolue par ajout** : une méthode neuve = un fichier `references/methode-<nom>.md` et
> une ligne de l'aiguillage (§3), rien à réécrire.

**Pourquoi ce skill.** Une décision prise sur UN exemple est juste sur cet exemple, et tombe au cas
suivant que personne n'avait posé. Vécu sur la socket temps réel : une recommandation renversée par
la reconnexion mobile, une autre élargie trois fois (Redis, un bus tiers, gRPC), quatre
contradictions entre ADR trouvées à la fin, cinq dépendances de tickets inversées — et le nom de ce
skill lui-même changé trois fois. Chaque fois, le cas manquant existait AVANT la décision ; il
n'était écrit nulle part. Aucune méthode ne rend l'erreur impossible ; la bonne méthode la fait
apparaître **avant** de trancher, et le socle garde ce qui a été tranché.

## 1. Quand m'utiliser / quand passer la main

| Besoin                                                   | Skill                      |
| -------------------------------------------------------- | -------------------------- |
| Trancher un sujet, avec la méthode qui lui convient      | **ce skill**               |
| Écrire, ordonner, fermer le ticket qui porte la décision | `nodefony-ticket`          |
| Écrire l'ADR ou la page, et passer leurs contrôles       | `nodefony-documentation`   |
| Coder la décision (règles perf, typage, tests)           | `nodefony-framework-dev`   |
| Attaquer une décision de sécurité                        | `nodefony-security-review` |
| Produire la mesure qui tranche                           | `nodefony-load-test`       |
| Lire le code pour une preuve (`<fichier>.ts#<Symbole>`)  | `nodefony-inspect`         |
| Reprendre ou clore la session                            | `nodefony-session`         |

**Désactivation** : « mode normal », « décide seul », « fais tout d'un coup » — l'agent tranche et
justifie, règle par défaut du `CLAUDE.md` racine.

## 2. Le socle — commun à toute décision, quelle que soit la méthode

1. **Cadrer** (en silence) : la question en une phrase, ce qu'elle ne couvre pas, et si elle est
   **réversible**. Une décision réversible et interne se tranche seule, sans méthode.
2. **Relire ce qui fait déjà foi** AVANT de proposer : ADR **acceptés** du domaine (`docs/adr/`),
   décisions des sessions passées (`rg` sur les `_state` et le ticket du sujet — une décision
   d'auteur se perd au RESUME), normes (`nodefony-rfc`), politique de compatibilité
   (`docs/guides/compatibilite.md`). Une recommandation qui contredit une décision acceptée est
   fausse, même meilleure : on rouvre explicitement, ou on s'y plie.
3. **Le coût de l'attente** : qu'est-ce qui casse si on tranche APRÈS la prochaine version ? Ce qui
   casserait passe en premier ; le reste se reporte.
4. **Choisir la méthode** par l'aiguillage (§3), et l'annoncer à l'auteur en une ligne, avec son
   coût quand elle lance des agents.
5. **Faire trancher l'auteur par une question fermée** : « … ? (oui / non / explique) », une
   seule par message, avec son contexte dans la prose (jamais `AskUserQuestion`). Sur « explique »
   ou une question de côté : **vérifier au code avant de répondre**, ne pas défendre la
   recommandation ; un cas que la question révèle et que la méthode n'avait pas posé est un
   **scénario oublié** — l'ajouter, repasser l'analyse, reposer la question.
   **« explique » est un OUTIL de l'auteur, pas un signe de confusion** : il le dit exprès pour
   obtenir une passe plus précise. Y répondre en reformulant plus simplement gaspille le geste.
   Chaque « explique » est une **nouvelle passe au code** : relire ce que la réponse précédente
   SUPPOSAIT, vérifier les champs, les valeurs, les chemins qu'elle citait, et montrer ce qui en
   sort de neuf — puis reposer la question, corrigée. Vécu (#702, trois « explique » sur T1) :
   chaque passe a trouvé un fait que la précédente avait supposé — trois formes d'identité qui ne
   s'accordent pas, `userIdentifier` qui est un login réattribuable, un jeton externe déjà
   traduit en compte local. La table a ensuite trouvé d'autres faits, que ces passes n'avaient
   pas vus : la passe d'auteur et la table se complètent, elles ne se remplacent pas.
6. **Après un oui — inscrire et rendre vérifiable** : la ligne
   `**Décision (validée par l'auteur le <date>) :**` dans l'ADR, le cahier des charges précis dans
   le ticket (chemins, tests exigés, pièges — ce qu'il porte n'est plus à repayer), et le **test ou
   contrôle** qui gardera la décision une fois codée (vu rouge une fois). Un petit correctif part
   dans son propre commit.
7. **Clore un ensemble** (un ADR entier, plusieurs ADR d'un domaine, un lot de tickets) : relire
   les documents **côte à côte** avant de les dire acceptés — une contradiction entre deux ADR ne
   se voit qu'ainsi ; après tout réordonnancement de tickets, `npm run ticket:lint`.

## 3. L'aiguillage — quelle méthode pour quel sujet

Les méthodes se combinent ; la ligne la plus haute qui s'applique fixe le minimum.

| Le sujet                                                                                         | Méthode(s)                                                                       |
| ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| Interne, réversible, un fichier                                                                  | aucune — l'agent tranche et justifie                                             |
| La réponse est un chiffre (coût, mémoire, débit)                                                 | [mesure](references/methode-mesure.md)                                           |
| La faisabilité est inconnue (technologie neuve, intégration jamais faite)                        | [essai jetable](references/methode-poc.md), puis on revient ici                  |
| Plusieurs décisions, que l'auteur doit pouvoir suivre                                            | [pas à pas](references/methode-pas-a-pas.md)                                     |
| Elle doit tenir beaucoup de cas : API publique, protocole, contrat, nom public, ordre de tickets | [scénarios](references/methode-scenarios.md) + pas à pas                         |
| Tout le monde est d'accord trop vite, ou le risque d'échec est mal cerné                         | [pré-mortem](references/methode-pre-mortem.md)                                   |
| **Structurante** : rupture si différée, transverse à plusieurs modules, sécurité                 | scénarios + [table d'experts](references/methode-table-d-experts.md) + pas à pas |

**Toute méthode qui lance des agents** suit [la délégation](references/delegation.md) : faut-il
un agent (souvent non : un automate répond), lequel, sur quel modèle, avec quelle consigne, et
comment le vérifier au retour. Le modèle de chaque siège d'une table d'experts n'est pas choisi de
tête : il vit dans `assets/sieges.json` et descend ou monte sur preuve, à résultat identique
(`references/methode-table-d-experts.md`, §9).

**Ajouter une méthode** (une que l'on découvre, ou qu'on invente) : un fichier
`references/methode-<nom>.md` au gabarit ci-dessous, une ligne dans cette table, un cas dans le
banc de déclenchement (`nodefony-skill`, `scripts/trigger-bench.mjs`).

```markdown
# Méthode — <nom>

> Référence du skill `nodefony-decision-making`. D'où elle vient, en une ligne.

## Quand

## La procédure

## Ce qu'elle coûte

## Pièges

## Exemple vécu
```

## 4. Pièges communs à toutes les méthodes

- **Recommander sur un seul exemple** : c'est le retour en arrière garanti.
- **Relire les documents voisins trop tard** : socle, point 2 — pas après.
- **Montrer sa préférence à qui doit la juger** (un siège d'experts, un pré-mortem) : on obtient sa
  confirmation, pas un regard.
- **Croire un agent** : il affirme avec le même aplomb ce qu'il a lu et ce qu'il suppose ; tout
  désaccord se vérifie au code avant d'être montré.
- **La méthode lourde sur un détail** : une table d'experts coûte des centaines de milliers de
  tokens. L'aiguillage décide, pas l'enthousiasme.
- **L'exemple d'un seul consommateur** : un socle générique se cadre par trois usages hétérogènes.
- **Le oui qui en couvre deux** : le dire, sinon l'auteur découvre plus tard une décision qu'il ne
  croyait pas avoir prise.
- **Le rapport de quatorze décisions d'un bloc** : refusé en bloc. Une suite de « oui » ne vaut pas
  acceptation d'un ADR entier.

## 5. Gate

Une décision est **prise** quand la méthode que l'aiguillage désignait a été jouée, que l'auteur a
dit oui, et qu'elle est inscrite (ADR, ticket) avec le test qui la gardera. Un ensemble est
**accepté** après sa relecture côte à côte — et sa revue finale s'il est structurant
(`references/methode-table-d-experts.md`, §8).
