---
title: "Performance — mesures et rapports"
lang: fr
module: "global"
topic: performance-index
section: "Performance"
audience: [developer]
tags: [performance, benchmark, mesure, methode]
status: stable
last-updated: 2026-08-07
---

# Performance — mesures et rapports

> **Vous cherchez à lire le dossier ? Commencez par [`index.md`](index.md)** — c'est le hub, avec
> trois parcours de lecture selon ce que vous cherchez. Cette page-ci est la pancarte du
> répertoire : elle dit ce qu'il contient et sous quelles règles un rapport y entre.

Ce dossier conserve les **mesures de performance** du framework : où part le temps, ce qu'une
optimisation a rendu, ce qu'un choix d'architecture coûte — et ce qui n'a pas pu être mesuré.

## Le dossier

| Page                                           | Sujet                                                                 |
| ---------------------------------------------- | --------------------------------------------------------------------- |
| [`index.md`](index.md)                         | **Hub** — parcours de lecture, synthèse, comment rejouer une mesure   |
| [`methode.md`](methode.md)                     | Protocole, décor, contrôles de validité, lexique                      |
| [`pipeline-http.md`](pipeline-http.md)         | Profilage, lots livrés, lot rejeté, routeur, non-régression WebSocket |
| [`boucle-evenements.md`](boucle-evenements.md) | Blocage et latence : ce qui plafonne réellement un processus          |
| [`orm.md`](orm.md)                             | Escalier ORM, profilage par couche, lot de requêtes préparées         |
| [`comparaisons.md`](comparaisons.md)           | Face à `node:http` nu, Fastify, Express — à trois niveaux d'équité    |
| [`dimensionnement.md`](dimensionnement.md)     | Constantes d'un pod, concurrence, plafonds WebSocket, saturation      |
| [`ouvertures.md`](ouvertures.md)               | Trous de mesure, pistes écartées, limites assumées                    |

Archive : [rapport du 23 juillet](2026-07-23-pipeline-http-vs-express-fastify.md) — **remplacé**,
conservé comme point de départ du chantier.

## Ce qu'un rapport doit porter

Un chiffre sans son décor n'est pas une mesure, c'est une rumeur. Chaque page publiée ici indique
donc, sans exception :

- **la machine** (processeur, cœurs, mémoire, système) et la **version de Node** ;
- **l'outil de charge** et ses paramètres exacts (durée, connexions, fils, nombre de runs) ;
- **ce qui était activé ou non** côté serveur (journalisation, mode, modules chargés) ;
- **ce à quoi on compare**, et ce que fait exactement le point de comparaison ;
- **la façon dont la validité a été contrôlée** — sans quoi le reste ne vaut rien.

## La règle qui précède toutes les autres

> **Un banc qui ne vérifie pas que le travail a eu lieu mesure la vitesse à laquelle on échoue.**

Ce n'est pas une précaution théorique. Un banc du dépôt annonçait **1 626 requêtes par seconde sur
un port fermé** : les requêtes étaient comptées au lancement, pas au succès. Le chiffre n'avait
rien d'anormal à l'œil — c'est précisément ce qui le rendait dangereux. Une erreur coûte moins
cher qu'une vraie réponse : **échouer améliore le score**.

Les bancs vérifient donc que la cible répond ce qu'elle doit **avant** de mesurer, et invalident
tout run pollué par des erreurs **pendant** la mesure. Le détail des contrôles et la marche à
suivre pour en écrire un nouveau vivent dans le kit d'outillage
(`.claude/skills/nodefony-load-test/`, section « Règle n°1 »).

## Markdown ici, HTML ailleurs

Les pages de ce dossier sont en **Markdown** : versionnées, relues en diff, réingérables. Les
rapports **HTML** produits par les bancs sont des **photos** — ils vivent dans `tmp/`, ne sont
jamais commités, et se régénèrent depuis leurs données sources.
