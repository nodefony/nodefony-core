---
title: "Mesures versionnées — un chiffre attaché à sa version"
lang: fr
navTitle: Mesures versionnées
module: "global"
topic: perf-data
section: "Performance"
audience: [developer, devops]
tags: [performance, mesure, release, reproductibilite]
status: stable
updated: "2026-10-02"
source: "docs/performance/data/"
---

📍 [Documentation](../../index.md) › [Performance](../index.md) › **Mesures versionnées**

> Un fichier par version publiée : les mesures brutes **et leur décor**. C'est ce dossier que
> rend la page publiée — pas l'inverse.

## Pourquoi les données sont ici, et pas dans le générateur

Un chiffre de performance sans son décor n'est pas réfutable, et un chiffre qu'on ne peut pas
rejouer n'est pas une mesure — c'est une affirmation. Trois défauts vécus ont fixé cette forme :

- des mesures publiées **côte à côte** alors qu'elles venaient de fenêtres et de commits
  différents : les tableaux suggéraient une comparaison qu'aucun d'eux ne permettait ;
- un rapport daté du commit qu'on avait **sous la main en le lisant**, six commits après celui
  qui avait réellement été mesuré ;
- les échantillons d'un soak de vingt minutes rangés dans `tmp/`, **emportés au premier ménage**
  — avec eux, la seule façon de recalculer la pente.

D'où la règle : **la mesure se fait à la main, sur une machine nommée ; son résultat est commité
ici.** L'intégration continue ne mesure jamais — un exécuteur partagé rendrait des chiffres faux —
elle ne fait que **rendre** ce dossier (`scripts/build-perf-site.mjs`).

## Ce que contient un fichier

| Bloc              | Ce qu'il porte                                                                                                                                                                                                                                                                           |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `provenance`      | date, **commit** du code mesuré, machine, version de Node, protocole (outil, warmup, durée, connexions, nombre de runs, mode du serveur)                                                                                                                                                 |
| `comparison`      | un camp par framework (route triviale), avec ses runs bruts, sa médiane, ses percentiles, sa dispersion, le relevé thermique ; `pairs` porte le rapport et la séparation de **chaque paire alternée**, test nul compris                                                                  |
| `applicative`     | le cas applicatif face à Express équipé : 20 lignes lues puis l'`UPDATE` de la ligne lue, sur SQLite, à ORM et pilote égaux                                                                                                                                                              |
| `applicativeNest` | le même banc face à NestJS équipé — GET, POST validé, POST invalide (422) ; **chaque cas porte son commit**, une pièce réutilisée d'une autre séance garde sa provenance                                                                                                                 |
| `cpuThread`       | le CPU du fil principal par requête face à NestJS équipé (`wait-compare.sh`) — l'arbitre des écarts sous la résolution du débit                                                                                                                                                          |
| `soak`            | les **échantillons complets** d'une charge longue — jamais un résumé : la pente et le plateau se recalculent au rendu                                                                                                                                                                    |
| `capacity`        | les constantes d'un pod (`capacity.mjs --json`, en **production**) : RAM par socket WebSocket, débits d'écho et de diffusion, latence à vide — chaque constante porte son verdict `valid` (runs concordants, ELU relevé pendant la charge) ; une constante non valide n'est pas affichée |

`comparison.reference` désigne le camp qui sert d'étalon. C'est `express-fair` — un Express muni
des mêmes intergiciels — parce que comparer un pipeline complet à un serveur nu ne compare pas le
même travail. Le second étalon, `nest-fair`, est un NestJS sur Fastify muni des mêmes garanties.

## Ajouter la mesure d'une version

```bash
# 1. la campagne, sur une machine au repos — parité des témoins, paires, base de
#    données, CPU du fil, tenue : 'caffeinate' empêche la veille pendant la nuit
caffeinate -dims bash .claude/skills/nodefony-load-test/scripts/perf-campaign.sh --at 01:30
#    une pièce manquante se rejoue seule : --only "nest-fair applicatif"
# 2. composer le fichier depuis les séries BRUTES (aperçu, puis --write) — les
#    chiffres et la provenance ; le récit reste à écrire à la main
node .claude/skills/nodefony-load-test/scripts/perf-compose.mjs \
  --campaign tmp/perf-campaign-<date> --data docs/performance/data/<version>.json \
  --soak tmp/perf-campaign-<date>/soak.json --capacity tmp/capacity.json
#    les constantes d'un pod, sur un serveur de PRODUCTION (route de banc, comptes
#    seedés, modules de banc autorisés) : relevé à part, avec sa propre provenance
#    NF_BENCH_ROUTE=1 NF_ADMIN_PASSWORD=… NF_WITH_DEV_MODULES=1 NODE_OPTIONS=--expose-gc \
#      npx nodefony production --detach --wait
#    node .claude/skills/nodefony-load-test/scripts/capacity.mjs \
#      --http-path /nodefony/kernel/bench --seconds 8 --json tmp/capacity.json
# 3. rendre, et REGARDER la page avant de la publier
node scripts/build-perf-site.mjs --out dist-perf-site
```

### Les deux pages, et pourquoi une seule commande les fait

`build-perf-site.mjs` rend **deux objets distincts**, pour deux publics :

| Page                                    | Ce qu'elle répond                                       | Générateur                  | Ses données                                                                                |
| --------------------------------------- | ------------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------ |
| `/performance/<version>/` et `/latest/` | « peut-on partir en production ? » en trois minutes     | `prod-readiness-report.mjs` | **ce dossier**, entièrement                                                                |
| `/performance/dossier/`                 | « comment on l'a su » — méthode, lots, instruments faux | `perf-dossier-report.mjs`   | ce dossier pour le comparatif, ses propres constantes pour le reste (profilage, lots, ORM) |

**Le comparatif est LU ici par les deux.** Il a existé en double — en dur dans le
générateur du dossier ET dans ce dossier-ci — et les deux copies ont divergé au premier
rejeu : le dossier affichait encore 11 702 req/s quand la page de version publiait 12 226.
Une source, deux rendus ; ce que le jeu ne porte pas reste déclaré dans le générateur du
dossier **avec sa fenêtre**, et sa table de chronologie dit à quel état du code chaque
chapitre correspond.

Le rendu **échoue** si un jeu n'a pas de soak : la page répond « peut-on partir en production ? »,
et une réponse qui tait la tenue dans la durée n'en est pas une. Le sommaire du site nomme les
versions qu'il n'a pas pu rendre — un manque se voit, il ne se tait pas.
