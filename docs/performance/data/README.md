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
elle ne fait que **rendre** ce dossier (`scripts/site/build-perf-site.mjs`).

## Ce que contient un fichier

| Bloc              | Ce qu'il porte                                                                                                                                                                                                                                                                           |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `provenance`      | date, **commit** du code mesuré, machine, version de Node, protocole (outil, warmup, durée, connexions, nombre de runs, mode du serveur)                                                                                                                                                 |
| `comparison`      | un camp par framework (route triviale), avec ses runs bruts, sa médiane, ses percentiles, sa dispersion, le relevé thermique ; `pairs` porte le rapport et la séparation de **chaque paire alternée**, test nul compris                                                                  |
| `applicative`     | le cas applicatif face à Express équipé : 20 lignes lues puis l'`UPDATE` de la ligne lue, sur SQLite, à ORM et pilote égaux ; `cases` ajoute le POST validé et le POST refusé (422), `nul` le test nul de ce banc                                                                        |
| `applicativeNest` | le même banc face à NestJS équipé — GET, POST validé, POST invalide (422) ; **chaque cas porte son commit**, une pièce réutilisée d'une autre séance garde sa provenance                                                                                                                 |
| `cpuThread`       | le CPU du fil principal par requête face à NestJS équipé (`wait-compare.sh`) — l'arbitre des écarts sous la résolution du débit                                                                                                                                                          |
| `soak`            | les **échantillons complets** d'une charge longue — jamais un résumé : la pente et le plateau se recalculent au rendu                                                                                                                                                                    |
| `stages`          | le budget d'une requête triviale, étage par étage (`cut-analyze.mjs --json`) : CPU du fil cumulé à chaque coupe, face au témoin `nest-fair-node`                                                                                                                                         |
| `profile`         | le profil V8 comparé (`profile-compare.mjs --json`) : ce que chaque framework fait faire à Node, fonction à fonction, et le code propre par module                                                                                                                                       |
| `binary`          | le coût d'un message binaire selon sa taille — socket CBOR, gRPC, HTTP/2 nu (`grpc-stream-throughput.mjs`)                                                                                                                                                                               |
| `capacity`        | les constantes d'un pod (`capacity.mjs --json`, en **production**) : RAM par socket WebSocket, débits d'écho et de diffusion, latence à vide — chaque constante porte son verdict `valid` (runs concordants, ELU relevé pendant la charge) ; une constante non valide n'est pas affichée |

`comparison.reference` désigne le camp qui sert d'étalon. C'est `express-fair` — un Express muni
des mêmes intergiciels — parce que comparer un pipeline complet à un serveur nu ne compare pas le
même travail. `nest-fair` et `nest-fair-node` sont un NestJS muni des mêmes garanties, sur Fastify
et sur l'adaptateur `node:http` natif. `provenance.witnesses` porte la version de chaque témoin.

## Ajouter la mesure d'une version

```bash
# 1. la campagne, sur une machine au repos — parité des témoins, paires, base de
#    données, CPU du fil, tenue : 'caffeinate' empêche la veille pendant la nuit
caffeinate -dims bash .claude/skills/nodefony-load-test/scripts/perf-campaign.sh --at 01:30
#    une pièce manquante se rejoue seule : --only "nest-fair applicatif"
# 2. composer le fichier depuis les séries BRUTES (aperçu, puis --write) — les
#    chiffres et la provenance ; le récit reste à écrire à la main
node .claude/skills/nodefony-load-test/scripts/perf-compose.mjs \
  --campaign tmp/bench/perf-campaign-<date> --data docs/performance/data/<version>.json \
  --soak tmp/bench/perf-campaign-<date>/soak.json --capacity tmp/bench/perf-campaign-<date>/capacity.json
#    une pièce rejouée dans une autre campagne : --from paire1=tmp/bench/perf-campaign-<autre>
#    les constantes d'un pod, sur un serveur de PRODUCTION (route de banc, comptes
#    seedés, modules de banc autorisés) : relevé à part, avec sa propre provenance
#    NF_BENCH_ROUTE=1 NF_ADMIN_PASSWORD=… NF_WITH_DEV_MODULES=1 NODE_OPTIONS=--expose-gc \
#      npx nodefony production --detach --wait
#    node .claude/skills/nodefony-load-test/scripts/capacity.mjs \
#      --http-path /nodefony/kernel/bench --seconds 8 --json tmp/capacity.json
# 3. rendre, et REGARDER la page avant de la publier
node scripts/site/build-perf-site.mjs --out tmp/sites/perf
```

### Les pages, et pourquoi une seule commande les fait

`build-perf-site.mjs` rend les pages de version et la prose, toutes depuis ce dossier :

| Page                                    | Ce qu'elle répond                     | Générateur                               |
| --------------------------------------- | ------------------------------------- | ---------------------------------------- |
| `/performance/<version>/` et `/latest/` | « peut-on partir en production ? »    | `prod-readiness-report.mjs`              |
| `/performance/analyses/`                | où part le temps d'une requête        | `docs/performance/analyses.md` + figures |
| `/performance/protocole/`               | comment un chiffre devient une mesure | `docs/performance/methode.md` + figures  |

**Les figures de la prose sont CALCULÉES, jamais recopiées.** Une page Markdown appelle une
figure par `<!-- figure: <id> -->` ; le registre `perf-figures.mjs` la dessine depuis le jeu
de la version courante, et le rendu échoue sur un identifiant inconnu ou sans données. Un ancien
générateur portait ses propres constantes à côté de ce dossier : les deux copies ont divergé au
premier rejeu (11 702 req/s d'un côté, 12 226 de l'autre).

Le rendu **échoue** si un jeu n'a pas de soak : la page répond « peut-on partir en production ? »,
et une réponse qui tait la tenue dans la durée n'en est pas une. Le sommaire du site nomme les
versions qu'il n'a pas pu rendre — un manque se voit, il ne se tait pas.
