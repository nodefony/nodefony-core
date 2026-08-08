---
title: "Face aux autres — ce que l'écart mesure vraiment"
lang: fr
module: "global"
topic: perf-comparaisons
section: "Performance"
audience: [developer]
tags: [performance, express, fastify, benchmark, comparaison, equite]
status: draft
updated: "2026-08-07"
source: ".claude/skills/nodefony-load-test/bench-frameworks/"
tests: none
---

📍 [Documentation](../index.md) › [Performance](index.md) › **Face aux autres**

> Nodefony est plus lent qu'Express sur une route qui ne fait rien. L'écart est de 1,61. Il tombe
> à 1,29 quand Express rend le même service, et à **1,07** quand les deux interrogent la même base
> avec le même ORM. Cette page explique comment on passe de l'un à l'autre — et pourquoi le
> premier chiffre, le plus flatteur pour Express, est aussi le moins utile.

## La vision — un écart n'a de sens qu'à travail égal

Comparer deux frameworks sur une route qui renvoie un objet constant ne compare pas deux
frameworks : cela compare **ce qu'ils font**, et ils ne font pas la même chose.

Nodefony exécute sur **chaque** requête un contexte d'injection de dépendances, un identifiant de
requête, une corrélation de traçage au format W3C, la résolution des zones du pare-feu, les
contrôles d'origine et de méta-données de récupération, et la pose des en-têtes de sécurité.
Express ne fait rien de tout cela tant qu'on ne l'a pas installé, configuré et branché.

Le protocole retenu construit donc **trois niveaux de comparaison**, du plus flatteur pour la
concurrence au plus honnête :

1. **Pipeline nu contre pipeline nu** — ce que chacun coûte pour ne rien faire.
2. **À service égal** — Express équipé des middlewares qui rendent le même travail par requête.
3. **À service égal et à ORM égal** — les deux interrogent la même base, avec le même pilote.

Le décor est identique aux trois niveaux : même charge utile JSON, **mêmes 186 routes** avec la
cible en position 31, mode production, journalisation coupée des deux côtés, même générateur de
charge, même fenêtre de mesure.

## Niveau 1 — pipeline contre pipeline

| Cible          | RPS médian | Dispersion | Rapport vs Nodefony |
| -------------- | ---------: | ---------: | ------------------: |
| `node:http` nu |     37 770 |      0,7 % |               ×3,23 |
| Fastify        |     33 024 |      0,5 % |               ×2,82 |
| Express        |     18 845 |      2,0 % |               ×1,61 |
| **Nodefony**   | **11 702** |      0,8 % |                   — |

Aucun des points de comparaison ne fait quoi que ce soit de particulier — au sens littéral :

```js
// fastify.mjs — sans schéma de sérialisation rapide (JSON.stringify, comme les autres)
app.get(BENCH_PATH, async () => state);

// express.mjs
app.get(BENCH_PATH, (_req, res) => res.json(state));
```

> ⚠️ **Ces mesures datent d'une fenêtre antérieure aux derniers lots du pipeline.** Nodefony y
> valait 11 702 RPS ; l'état livré mesure ~13 400 dans une fenêtre ultérieure. Deux fenêtres ne se
> comparent pas — le comparatif reste donc **à rejouer sur l'état actuel**, et il l'est dans
> [Ce qui reste ouvert](ouvertures.md). Les rapports ci-dessus sont valides **entre eux**, à la
> date de leur mesure.

## Niveau 2 — à service égal

Le banc « équitable » ajoute à Express les middlewares qui rendent le travail que Nodefony rend
par requête : le stockage asynchrone local et l'identifiant de requête, la corrélation de traçage,
les partages d'origine, les en-têtes de sécurité, la protection contre la falsification de requête
par méta-données, et la mise en correspondance des zones.

| Cible                             | RPS médian |
| --------------------------------- | ---------: |
| `node:http` nu                    |     37 161 |
| Express nu                        |     18 497 |
| **Express équipé** (même travail) | **14 891** |
| Nodefony                          |     11 512 |

Deux verdicts :

- **Le prix de ces fonctionnalités est de −19,5 % pour Express.** Ce n'est pas un coût de
  framework, c'est le coût du travail lui-même : quelqu'un doit le payer.
- **L'écart honnête tombe à ×1,29.**

### La preuve d'équité — ce que la cible ne fait pas

Une comparaison à service égal ne vaut que si la cible Nodefony ne traîne pas de travail dormant
que l'Express équipé n'aurait pas. Cela ne se suppose pas : c'est **prouvé par un instrument
versionné**, sur mille requêtes dans le décor exact du banc.

| Ce qui est vérifié                | Comment                                                                              | Résultat |
| --------------------------------- | ------------------------------------------------------------------------------------ | -------- |
| Aucune session démarrée           | Aucun en-tête `Set-Cookie` sur les 1 000 réponses                                    | 0        |
| Aucune écriture en base           | `PRAGMA data_version` depuis une connexion en lecture ouverte **pendant** la fenêtre | stable   |
| Aucune ligne ajoutée              | Écarts sur les six tables du framework                                               | 0        |
| Profileur non monté en production | Son plan de données répond 404                                                       | 404      |
| Chronométrage inactif             | Vérifié au code : désactivé hors développement                                       | inactif  |

Le choix de `PRAGMA data_version` est délibéré : il change dès qu'**une autre connexion** valide
une transaction, **toutes tables confondues** — là où un comptage par table ne couvre que ce
qu'on a pensé à compter. Une fenêtre de repos témoin de dix secondes discrimine un éventuel
écrivain périodique.

**Et l'instrument lui-même a été vérifié mordant** : une écriture témoin par une autre connexion
fait bien bouger la valeur. Le « 0 » n'a été cru qu'après ce rouge.

Ce qui reste **volontairement** dans l'écart de 1,29 : les effets de second ordre — pression sur
les caches d'instructions, débit d'allocation, ramasse-miettes. C'est le prix réel d'un contexte
riche, et il n'est pas soustrait.

## Niveau 3 — à service égal **et** à ORM égal

Le niveau le plus proche d'une application réelle : les deux interrogent la même base PostgreSQL,
avec le même ORM, la même version résolue depuis le même arbre de dépendances, le même schéma, le
même pool, la même requête.

Deux modes sont mesurés des deux côtés : **naïf** (la requête est construite à chaque appel — le
code idiomatique de l'ORM) et **préparé** (la requête est mémoïsée — ce que fait Nodefony depuis
[le lot ORM](orm.md)).

| Application                      | Mode ORM                 | RPS médian |
| -------------------------------- | ------------------------ | ---------: |
| Express nu + ORM naïf            | construction par requête |      1 089 |
| Nodefony avant le lot            | construction par requête |      1 017 |
| **Nodefony livré**               | **requête mémoïsée**     |  **1 640** |
| **Express équipé + ORM préparé** | parité totale            |  **1 758** |
| Express nu + ORM préparé         | zéro middleware          |      1 801 |

Les verdicts, dans l'ordre où ils comptent :

- **À parité de travail et d'ORM : ×1,07.** Nodefony rend ~93 % du débit d'un Express équipé du
  même service. C'est le chiffre le plus honnête du dossier.
- **À parité d'ORM mais sans aucun middleware Express : ~90 %** d'un Express nu — c'est-à-dire
  d'un serveur qui ne rend ni pare-feu, ni session, ni audit, ni corrélation.
- **Le prix des middlewares Express sur une route ORM n'est plus que de −2,4 %** (1 801 nu contre
  1 758 équipé), là où il valait −19,5 % sur une route sans base. **L'ORM dilue tout.**

### Le recoupement qui valide la mesure

Express passe de 1 089 à 1 801 en mémoïsant sa requête : **+65 %**. Nodefony passe de 1 017 à
1 640 : **+60 à 62 %**.

Même goulot, même remède, **deux frameworks indépendants**. Une prédiction avait d'ailleurs été
engagée **avant** la mesure — « naïf ≈ avant, préparé ≈ après, écart inférieur à 10 % » — et elle
s'est vérifiée. C'est ce recoupement croisé qui donne confiance dans l'A/B PostgreSQL : un gain
qui se reproduit à l'identique chez un tiers n'est pas un artefact de banc.

## Ce que ces trois niveaux disent

**L'écart fond à mesure que l'application grandit.**

| Ce que fait l'application                | Écart avec un Express à service comparable |
| ---------------------------------------- | -----------------------------------------: |
| Rien (objet constant)                    |                                      ×1,61 |
| Le même travail par requête              |                                      ×1,29 |
| Le même travail **et** une vraie requête |                                  **×1,07** |

La lecture est simple : le coût fixe du framework se dilue dans le travail utile. Sur une
application qui interroge une base — c'est-à-dire toutes — il devient marginal.

**Ce qui n'est pas revendiqué, et ne le sera pas** : Nodefony n'est pas « plus performant » en
absolu. Sur une route qui ne fait rien, il est plus lent, et le dossier le publie en première
ligne. Ce qui est démontré, c'est que **le prix du service rendu est comparable à celui que
n'importe qui paierait pour rendre le même service**, et qu'il cesse d'être discriminant dès
qu'une requête SQL entre dans le budget.

## Lexique

Termes propres à ce chapitre. Le vocabulaire général est défini dans
[Méthode de mesure](methode.md#lexique).

| Terme                        | Ce qu'il désigne ici                                                                                              |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| **Équité d'un banc**         | Les deux participants font le **même travail** par requête. Sans elle, on mesure une différence de périmètre.     |
| **Express « équipé »**       | Express plus les middlewares qui rendent le service que Nodefony rend par défaut.                                 |
| **Travail dormant**          | Traitement qu'une cible pourrait exécuter sans qu'on le sache (session, audit, chronométrage). Prouvé absent ici. |
| **Prix des fonctionnalités** | Écart entre un serveur nu et le même serveur rendant le service. Il est payé quel que soit le framework.          |
| **Recoupement croisé**       | Reproduire un résultat sur un système indépendant. Un gain qui se reproduit ailleurs n'est pas un artefact.       |
| **Prédiction engagée**       | Résultat attendu écrit **avant** de mesurer. Il rend la mesure réfutable.                                         |

## Pièges

- **Un banc de framework se fausse par le décor avant de se fausser par le code.** Les apps de
  comparaison vivent dans un bac à sable isolé, avec leur propre arbre de dépendances, pour ne pas
  emprunter au dépôt une version différente de celle qu'elles annoncent.
- **Un échauffement donné à l'un et pas à l'autre inverse un classement serré.** Les deux scripts
  de banc partagent le même protocole et doivent rester alignés.
- **Fastify est mesuré sans son sérialiseur rapide**, comme les autres, pour comparer la même
  opération. Avec, il irait plus vite — c'est une option, pas le défaut.
- **Une comparaison entre deux fenêtres n'existe pas.** Toutes les lignes d'un même tableau
  ci-dessus viennent de la même soirée de mesure ; aucune ne se compare à une ligne d'un autre
  tableau.

## Pour aller plus loin

- ⬆️ **Retour au hub** : [Performance](index.md)
- 🔬 [Le pipeline HTTP](pipeline-http.md) — ce que coûte chaque service rendu, et ce qui a été récupéré
- 🗄️ [ORM et bases de données](orm.md) — le lot qui a produit le niveau 3
- 📐 [Ce qui reste ouvert](ouvertures.md) — dont le comparatif à rejouer sur l'état actuel
- 🧰 Bancs : `.claude/skills/nodefony-load-test/bench-frameworks/`
