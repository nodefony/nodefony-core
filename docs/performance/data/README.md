---
title: "Mesures versionnées — un chiffre attaché à sa version"
lang: fr
module: "global"
topic: perf-data
section: "Performance"
audience: [developer, devops]
tags: [performance, mesure, release, reproductibilite]
status: stable
updated: "2026-08-24"
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

| Bloc         | Ce qu'il porte                                                                                                                           |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `provenance` | date, **commit** du code mesuré, machine, version de Node, protocole (outil, warmup, durée, connexions, nombre de runs, mode du serveur) |
| `comparison` | un camp par framework, avec ses runs bruts, sa médiane, ses percentiles, sa dispersion, et le relevé thermique du poste                  |
| `soak`       | les **échantillons complets** d'une charge longue — jamais un résumé : la pente et le plateau se recalculent au rendu                    |

`comparison.reference` désigne le camp qui sert d'étalon. C'est `express-fair` — un Express muni
des mêmes intergiciels — parce que comparer un pipeline complet à un serveur nu ne compare pas le
même travail.

## Ajouter la mesure d'une version

```bash
# 1. le comparatif, sur une machine au repos (cf skill `nodefony-load-test`)
#    → dépose /tmp/nf-bench-<camp>.json pour les cinq camps
# 2. la charge longue — les échantillons, pas le résumé
node .claude/skills/nodefony-load-test/scripts/soak.mjs --minutes 20 --out tmp/soak.json
# 3. composer docs/performance/data/<version>.json (provenance + comparison + soak)
# 4. rendre, et REGARDER la page avant de la publier
node scripts/build-perf-site.mjs --out dist-perf-site
```

Le rendu **échoue** si un jeu n'a pas de soak : la page répond « peut-on partir en production ? »,
et une réponse qui tait la tenue dans la durée n'en est pas une. Le sommaire du site nomme les
versions qu'il n'a pas pu rendre — un manque se voit, il ne se tait pas.
