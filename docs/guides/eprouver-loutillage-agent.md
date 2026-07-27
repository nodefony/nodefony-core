---
title: Éprouver un framework avec un agent — la méthode, et ce qu'elle a trouvé
lang: fr
audience: humain
date: 2026-07-27
related: docs/guides/generer-du-code.md, .claude/skills/nodefony-devkit-bench/, src/nodefony/src/cli/scaffold/engine.ts
---

# Éprouver un framework avec un agent

> Comment savoir si l'outillage d'un framework est réellement utilisable — non
> pas par nous qui l'avons écrit, mais par quelqu'un qui le découvre. Et
> pourquoi la réponse ne s'obtient pas en relisant sa propre documentation.

Ce guide décrit une méthode et les résultats qu'elle a produits sur Nodefony.
Elle est transposable à n'importe quel framework qui expose un générateur, une
CLI ou une convention à suivre.

## Le problème : on ne peut pas s'auto-évaluer

L'auteur d'un framework connaît ses raccourcis. Il sait qu'une option existe,
où elle est documentée, et quel nom elle porte. Cette connaissance rend toute
auto-évaluation caduque : on ne peut pas oublier ce qu'on sait.

Les tests du dépôt ne comblent pas ce trou, parce qu'ils posent une autre
question. Ils vérifient que le générateur, **appelé correctement**, produit les
bonnes chaînes de caractères. Ils ne peuvent pas dire :

- si quelqu'un l'aurait **appelé** plutôt que d'écrire le code à la main ;
- si ce qu'il produit **suffit** face à un besoin qu'on n'a pas choisi ;
- ce qu'il faut **corriger à la main** après coup, et pourquoi.

## L'idée : l'agent comme instrument de mesure

On confie une tâche réelle à un agent (ici le modèle **le plus faible**
disponible, délibérément), dans une application neuve, sans aide. Puis on
regarde ce qu'il a fait — pas ce qu'il a dit.

L'agent n'est pas le sujet de la mesure. **Le framework l'est.** L'agent joue le
rôle d'un utilisateur qui n'a aucune connaissance implicite, ne devine rien, et
prend systématiquement le chemin le moins coûteux. C'est un révélateur, au sens
photographique.

Le choix du modèle faible n'est pas une économie : un modèle fort **compense**
les trous de l'outillage en devinant juste, et rend donc un verdict flatteur qui
ne mesure plus rien.

## Trois questions, trois bancs

| Question                                          | Ce qu'elle ne voit pas seule       |
| ------------------------------------------------- | ---------------------------------- |
| Le code produit **tient-il debout** ?             | Si quelqu'un l'a trouvé            |
| Un agent **trouve-t-il** l'outillage ?            | Si ce qu'il trouve fonctionne      |
| Un **vrai** modèle de données est-il exprimable ? | Ce qu'aucun schéma réel ne demande |

La troisième est la plus dure à truquer. Les exemples d'un framework sont écrits
**pour** exercer ses propres capacités : ils ne peuvent, par construction, rien
demander qu'il ne sache faire. On donne donc à l'agent le schéma d'un logiciel
libre existant — écrit par des gens qui ne nous connaissent pas.

## La leçon la plus coûteuse : le décor décide du résultat

C'est le point à retenir si vous n'en retenez qu'un.

Le premier verdict a été rendu dans une application de test posée **à
l'intérieur du dépôt du framework**, avec les paquets liés en symlink. L'agent
pouvait donc ouvrir le code source du framework et le recopier.

Résultat : **zéro appel au générateur**, tout écrit à la main — et un schéma
parfait, 83 colonnes sur 83. On en aurait conclu que le générateur est ignoré,
ou que sa documentation est mauvaise.

Or **un utilisateur réel n'a jamais ce code**. `npm install` dépose du code
compilé, pas les sources. Le banc mesurait donc une situation qui n'existe chez
personne.

Après correction — application **hors du dépôt**, paquets installés depuis de
vraies archives npm, et **vérification** qu'aucune source n'est atteignable
avant de lancer l'agent :

|                       | Décor ouvert | Décor réel |
| --------------------- | ------------ | ---------- |
| appels au générateur  | **0**        | **11**     |
| corrections à la main | 10           | 29         |
| tables au bon nom     | 6/6          | 0/6        |

Le même agent, la même consigne, le même schéma. **Seul le décor a changé.**

Deux enseignements :

1. **On ne convainc pas un agent d'utiliser un outil — on retire le chemin plus
   court.** Aucune phrase n'a été ajoutée nulle part. Tant que recopier les
   sources était possible et facile, c'était le choix rationnel.
2. **Un banc dont le décor n'est pas celui de l'utilisateur mesure autre chose
   que ce qu'il annonce**, et le fait avec l'aplomb d'une vraie mesure.

## Ce qu'on mesure vraiment

Pas la justesse du résultat. **Le coût du contournement.**

Un agent finit toujours par obtenir le bon schéma s'il écrit assez de code à la
main — et il aura alors prouvé que le générateur ne servait à rien. La grandeur
utile est donc : _combien a-t-il fallu écrire hors de l'outil ?_ Chaque
correction manuelle désigne, une par une, ce que l'outil n'a pas su porter.

## La boucle

```
mesurer → diagnostiquer la cause → corriger L'OUTIL → remesurer
```

Trois règles qui la rendent honnête :

- **On ne change qu'une chose à la fois.** Modifier le décor _et_ la
  documentation dans le même tour rend le résultat ininterprétable.
- **On ne corrige jamais la consigne pour faire passer le banc.** Ce serait
  ajuster la cible à la réponse.
- **On corrige l'outil, pas le discours.** Mesuré ici comme ailleurs : durcir la
  prose d'un fichier lu par l'agent n'a eu aucun effet ; déplacer la même règle
  dans le fichier chargé automatiquement l'a fait appliquer. Et aucune phrase ne
  fera produire à un générateur une colonne qu'il ne sait pas écrire.

Ce que la mesure a effectivement produit, sur un seul schéma réel :

| Constat mesuré                                                         | Ce qu'il faut corriger                                                |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `username:string(255)` → `text("username")` — **32 longueurs perdues** | le générateur voyait le mauvais moteur                                |
| `id:uuid` → `text(...)` — **18 identifiants dégradés**                 | idem — et PostgreSQL refuse `text = uuid`, donc toute jointure échoue |
| `create entity Account` → table `accounts` — **6 tables sur 6**        | aucune option n'impose le nom de table                                |
| 29 corrections à la main                                               | l'essentiel : nommer les colonnes SQL                                 |

Le premier point s'est révélé être un **bug produit**, pas un manque : le
générateur déduisait le dialecte SQL en lisant le fichier de configuration,
alors qu'une application déclare sa base par URL (`NF_DATABASE_URL` — le cas
normal en conteneur, en CI, en production). Il générait donc du code SQLite pour
une application tournant sur PostgreSQL, **en l'annonçant dans une ligne que
personne ne relit**. Corrigé en branchant le générateur sur la même résolution
d'infra que le noyau (`resolveInfra`), l'environnement d'abord, le fichier
ensuite.

Aucune relecture de code ne l'avait vu. Il a fallu qu'un tiers ignorant demande
au framework quelque chose de banal.

## Les pièges du banc lui-même

Un juge non éprouvé rend des verdicts faux avec l'aplomb des verdicts justes.
Ceux-ci ont tous été rencontrés :

- **Le juge n'est pas contrôlé.** Un lecteur de schéma perdait les définitions
  écrites sur plusieurs lignes : il annonçait 130 colonnes, ce qui avait
  exactement l'allure d'un compte juste. Remède : recompter par un chemin
  **indépendant**, et **amputer volontairement** le juge pour vérifier que le
  contrôle tombe. Un contrôle qu'on n'a jamais vu échouer ne garde rien.
- **Le contrôle lui-même est faux.** Le tout premier défaut n'était pas dans le
  lecteur mais dans son contrôle — une recherche de texte trop lâche tombait sur
  la mauvaise table.
- **Un vert par omission.** Une base absente faisait sauter tout un pan de
  vérification, en silence. Un contrôle sauté doit être **annoncé** et changer le
  code de sortie, sinon on lit un succès complet.
- **Juger ce qu'on n'a pas demandé.** Le juge d'API reprochait à un ancien run
  une route non protégée, alors que rien ne l'exigeait dans sa consigne. La
  consigne s'écrit donc **avec** le run.
- **Le rapport qui ment par omission.** Il affichait « 0 colonne sur 83 » quand
  les 83 existaient sous des noms de table différents. On accusait l'agent au
  lieu de l'outil. Un rapport doit chercher le travail **là où il est** avant de
  conclure à son absence.
- **Comparer deux runs de décors différents.** Ils ne sont pas comparables. Le
  rapport doit énoncer son décor.

## Ce que ça change pour qui utilise le framework

- Le générateur produit du code pour **la base réellement déclarée**, y compris
  quand elle vient d'une variable d'environnement.
- Ce que le générateur **ne sait pas encore faire** est connu, chiffré, et
  publié plutôt que découvert en cours de route.
- Les bancs tournent sur une application installée **comme la vôtre** — pas sur
  une copie privilégiée du dépôt.

## Pour aller plus loin

- [`generer-du-code.md`](./generer-du-code.md) — ce que `nodefony create` sait
  faire, et comment le piloter depuis un agent.
- `.claude/skills/nodefony-devkit-bench/` — les trois bancs, leur protocole et
  l'interprétation de leurs échecs.
