---
title: "Performance — mesures et rapports"
lang: fr
module: "global"
topic: performance-index
section: "Performance"
audience: [developer]
tags: [performance, benchmark, mesure, methode]
status: stable
last-updated: 2026-07-23
---

# Performance — mesures et rapports

Ce dossier conserve les **mesures de performance datées** du framework. Un rapport y entre
quand il éclaire une décision : où part le temps, ce qu'une optimisation a rendu, ce qu'un
choix d'architecture coûte.

## Ce qu'un rapport doit porter

Un chiffre sans son décor n'est pas une mesure, c'est une rumeur. Chaque rapport publié ici
indique donc, sans exception :

- **la machine** (processeur, cœurs, mémoire, système) et la **version de Node** ;
- **l'outil de charge** et ses paramètres exacts (durée, connexions, threads, nombre de runs) ;
- **ce qui était activé ou non** côté serveur (journalisation, mode, modules chargés) ;
- **ce à quoi on compare**, et ce que fait exactement le point de comparaison ;
- **la façon dont la validité a été contrôlée** — sans quoi le reste ne vaut rien.

## La règle qui précède toutes les autres

> **Un banc qui ne vérifie pas que le travail a eu lieu mesure la vitesse à laquelle on échoue.**

Ce n'est pas une précaution théorique. Un banc du dépôt annonçait **1626 requêtes par seconde
sur un port fermé** : les requêtes étaient comptées au lancement, pas au succès. Le chiffre
n'avait rien d'anormal à l'œil — c'est précisément ce qui le rendait dangereux. Une erreur
coûte moins cher qu'une vraie réponse : **échouer améliore le score**.

Les bancs vérifient donc désormais que la cible répond ce qu'elle doit **avant** de mesurer,
et invalident tout run pollué par des erreurs **pendant** la mesure. Le détail des contrôles
et la marche à suivre pour en écrire un nouveau vivent dans le kit d'outillage
(`.claude/skills/nodefony-load-test/`, section « Règle n°1 »).

## Comment lire les chiffres absolus

Les mesures sont produites sur une machine de développement, générateur de charge
**co-localisé** avec le serveur. Les valeurs absolues sont donc basses pour tout le monde, y
compris pour les points de comparaison. **Seuls les rapports entre eux sont exploitables**, et
seulement à décor identique. Un chiffre de ce dossier ne se cite pas hors de son rapport.

## Rapports

| Date       | Sujet                                                                                                                    |
| ---------- | ------------------------------------------------------------------------------------------------------------------------ |
| 2026-07-23 | [Pipeline HTTP — où part le temps](2026-07-23-pipeline-http-vs-express-fastify.md) (vs Express, Fastify, `node:http` nu) |

## Rejouer une mesure

```bash
# Nodefony, mono-process production, cible de banc du framework
BENCH_DUR=10 BENCH_URL=http://127.0.0.1:5151/nodefony/kernel/bench \
  bash .claude/skills/nodefony-load-test/scripts/bench-ab-mono.sh <label> NF_BENCH_ROUTE=1

# Points de comparaison (mêmes routes, même payload)
BENCH_DUR=10 bash .claude/skills/nodefony-load-test/bench-frameworks/bench.sh fastify 5163
```

La cible `/nodefony/kernel/bench` n'existe **que** sous `NF_BENCH_ROUTE=1` : aucune surface
ajoutée en production par défaut.
