---
title: "Campagnes versionnées — ce qui a été éprouvé, et ce qui ne l'a pas été"
lang: fr
module: "global"
topic: qualite-data
section: "Qualité"
audience: [developer, devops]
tags: [tests, campagne, release, reproductibilite]
status: stable
source: "docs/qualite/data/"
---

📍 [Documentation](../../index.md) › **Campagnes versionnées**

> Un fichier par version publiée : le verdict d'une campagne de test **et son décor**. C'est ce
> dossier que rend la page publiée sous `/qualite/` — pas l'inverse.

## Pourquoi les données sont ici, et pas dans le générateur

Une campagne se joue à la main, en plusieurs heures, sur une machine nommée : elle enchaîne les
suites, ouvre les interrupteurs de coût, joue les bancs de charge, éprouve le code généré, monte un
banc multi-pods et finit par la chaîne de publication. Rien de cela ne peut tourner sur un exécuteur
d'intégration continue partagé sans rendre des chiffres faux.

Le générateur (`scripts/build-qualite-site.mjs`) ne teste donc **rien**. Il rend ce fichier, et son
résultat ne dépend pas de la machine qui l'exécute. Le protocole de la campagne, lui, vit dans le
skill `nodefony-test-campaign`.

## Ce qu'un fichier doit porter

| Clé          | Ce qu'elle garde                                                                     |
| ------------ | ------------------------------------------------------------------------------------ |
| `decor`      | machine, mémoire, système, Node, cibles d'infrastructure exercées, hyperviseur actif |
| `etages`     | ce qui a été joué, avec la commande exacte et le verdict de chacun                   |
| `rouges`     | chaque rouge avec sa **cause instruite** et ce qui l'établit                         |
| `memoire`    | les seuils du gate mémoire, mesure et marge                                          |
| `capacite`   | les constantes d'un pod — transport par transport                                    |
| `soak`       | les **séries** fenêtre par fenêtre, pas seulement la pente                           |
| `nonEprouve` | ce que la campagne n'a pas couvert — la moitié du verdict                            |
| `tickets`    | ce que la campagne a ouvert                                                          |

## Trois règles, chacune payée

- **Ne jamais SOMMER les étages.** Ils se recouvrent — un étage à interrupteurs ouverts rejoue le
  socle entier. Une somme compterait trois fois la même suite et publierait un total gonflé, qui est
  le mensonge le plus facile à mettre dans un rapport de qualité et le plus difficile à rattraper
  une fois cité. La page rend le passage le plus large, et le nomme.
- **Les séries, pas seulement les pentes.** Une pente moyenne cache un artefact : sur une campagne,
  un « plateau » s'est révélé n'être que l'arrêt du serveur moyenné dans la régression. La courbe le
  montrait d'un coup d'œil.
- **Un cas sauté compte comme vert.** Le compte des non-exécutés doit être aussi visible que celui
  des passés, et `nonEprouve` se remplit avec le même soin que le reste.

## Ajouter une campagne

1. La jouer — protocole du skill `nodefony-test-campaign`.
2. Écrire `docs/qualite/data/<version>.json` avec le décor de CETTE campagne.
3. `node scripts/build-qualite-site.mjs --out tmp/qualite` puis regarder la page.
4. Commiter les données. La publication est automatique (`.github/workflows/pages.yml`).
