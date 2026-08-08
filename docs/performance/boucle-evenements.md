---
title: "La boucle d'événements — latence et blocage sont deux grandeurs"
lang: fr
module: "global"
topic: perf-boucle-evenements
section: "Performance"
audience: [developer]
tags: [performance, event-loop, sqlite, postgresql, blocage, latence]
status: draft
updated: "2026-08-07"
source: ".claude/skills/nodefony-load-test/scripts/db-backend-cost.mjs"
tests: none
---

📍 [Documentation](../index.md) › [Performance](index.md) › **La boucle d'événements**

> Une base de données répond en 22 microsecondes, l'autre en 1 232. La première est pourtant
> celle qui bloque le serveur, et la seconde celle qui coûte huit fois plus cher. Cette page
> explique pourquoi, avec la mesure qui a fini par trancher après que **quatre instruments
> successifs eurent menti** et que **deux explications eurent été réfutées** — dont les nôtres.

## Le modèle — un fil, deux grandeurs

Node exécute le code applicatif sur **un seul fil**. Tout ce qui s'y passe est sérialisé : pendant
qu'une fonction s'exécute, aucune autre requête n'avance.

De là, deux grandeurs qu'on confond spontanément :

- La **latence** est le temps d'attente d'une réponse. Elle se mesure à la montre.
- Le **blocage** est le temps pendant lequel la boucle d'événements **ne peut rien faire d'autre**.

Elles n'ont pas les mêmes conséquences. La latence dégrade l'expérience d'**une** requête ; elle
se masque par la concurrence, puisque le serveur sert d'autres requêtes pendant l'attente. Le
blocage, lui, **plafonne le processus tout entier** : c'est du temps que personne d'autre ne peut
utiliser.

**C'est le blocage qui borne un débit, jamais la latence.** Cette phrase paraît évidente écrite
ainsi ; elle a coûté deux explications fausses avant d'être formulée.

## La preuve — un rappel armé avant la requête

L'expérience est simple et se lit sans instrument fin : on arme un rappel (`setImmediate`) **juste
avant** de lancer une requête, puis on regarde **quand il part**. Si la boucle est bloquée, il
attend ; si elle est libre, il part immédiatement.

| Pilote                       | Durée de la requête | Retard du rappel | Verdict              |
| ---------------------------- | ------------------: | ---------------: | -------------------- |
| SQLite (`better-sqlite3`)    |              133 ms |       **134 ms** | **bloque** la boucle |
| PostgreSQL (`pg_sleep(0.5)`) |              503 ms |      **0,22 ms** | ne bloque **pas**    |

L'effet est à l'échelle de la **centaine de millisecondes**. À cette échelle, aucune erreur
d'instrument fin n'intervient : c'est la seule pièce du dossier que deux audits successifs n'ont
pas entamée.

SQLite exécute la requête **sur le fil applicatif** : sa latence **est** son blocage. PostgreSQL
attend le réseau, et cette attente ne consomme rien.

> **La leçon d'instrument.** Quand quatre mesures fines se contredisent, il ne faut pas changer
> d'instrument — il faut **changer d'ordre de grandeur**. Une demi-seconde de sommeil provoqué
> côté serveur rend visible à l'œil nu ce que des sondes à la microseconde n'arrivaient pas à
> départager.

## Ce qu'un pilote coûte vraiment

La conséquence pratique est qu'il faut mesurer, pour chaque pilote, non pas sa latence mais le
**CPU de boucle** qu'il consomme par requête — le temps pendant lequel il occupe le fil unique
à écrire une requête, analyser un protocole, construire des objets de résultat.

Mesures sur trois séries de 400 lectures de 20 lignes, avec l'instrument versionné
`db-backend-cost.mjs` :

| Pilote                | Latence par requête | CPU de boucle par requête | Plafond théorique d'un processus |
| --------------------- | ------------------: | ------------------------: | -------------------------------: |
| SQLite synchrone      |               22 µs |                 **24 µs** |               ~41 700 requêtes/s |
| PostgreSQL asynchrone |            1 232 µs |                **194 µs** |                ~5 100 requêtes/s |

**C'est ce CPU huit fois supérieur qui explique l'écart de débit, pas le réseau.** Écrire puis
analyser le protocole d'un serveur de base de données coûte du travail sur le fil applicatif, et
ce travail-là ne se masque pas.

Le recoupement avec le banc réel tient : sur la route de lecture, PostgreSQL rend 1 647 requêtes
par seconde, soit 607 µs par requête, dont ~194 µs de pilote — **environ 32 % du budget**.

## Le renversement — un pilote synchrone peut être plus rapide, jusqu'à un certain point

Il en découle un résultat contre-intuitif, et important pour choisir un magasin de sessions :

**Un pilote synchrone court peut rendre plus de requêtes par seconde qu'un pilote asynchrone
coûteux.** Vingt-quatre microsecondes de blocage laissent passer 41 700 requêtes par seconde ;
194 µs de travail asynchrone n'en laissent passer que 5 100.

**Et il s'effondre dès que la concurrence dépasse ce qu'un fil sérialise.** Sur une vraie table,
via l'ORM, le blocage ne vaut plus 22 µs mais ~850 µs. À 128 connexions simultanées, la file
dépasse deux secondes et le générateur de charge enregistre 29 à 35 expirations par run. La
médiane reste correcte ; le 99ᵉ centile explose.

C'est pour cette raison que les bancs ORM de ce dossier sont mesurés à **25 connexions** et non à
128 : au-delà, on ne mesure plus un débit, on mesure une file d'attente.

| Situation                                          | Ce qui plafonne         | Ce qu'il faut regarder |
| -------------------------------------------------- | ----------------------- | ---------------------- |
| Pilote synchrone, requêtes courtes, peu de monde   | rien, c'est très rapide | le débit               |
| Pilote synchrone, vraie requête, forte concurrence | la sérialisation        | **le p99**             |
| Pilote asynchrone                                  | le CPU de protocole     | le débit               |

**Conséquence produit** : SQLite reste excellent pour un déploiement mono-nœud à charge modérée,
et c'est le défaut de développement du framework. Dès qu'il y a plusieurs nœuds — ou de la
concurrence réelle sur une table vivante — un magasin asynchrone est le bon choix, et l'argument
n'est pas « c'est plus rapide » mais « ça ne sérialise pas ».

## Lexique

Termes propres à ce chapitre. Le vocabulaire général est défini dans
[Méthode de mesure](methode.md#lexique).

| Terme                   | Ce qu'il désigne ici                                                                                          |
| ----------------------- | ------------------------------------------------------------------------------------------------------------- |
| **Boucle d'événements** | Le fil unique qui exécute le code applicatif. Tout ce qui s'y passe est sérialisé.                            |
| **CPU de boucle**       | Temps de calcul qu'une opération consomme **sur ce fil**. C'est lui qui plafonne un processus.                |
| **Pilote synchrone**    | Il exécute la requête sur le fil applicatif : sa latence **est** son blocage.                                 |
| **Pilote asynchrone**   | Il rend la main pendant l'attente : son attente ne coûte aucun débit tant qu'il reste du travail.             |
| **Rappel armé**         | Un `setImmediate` programmé avant l'opération à juger. Son **retard** mesure le blocage, sans instrument fin. |
| **Sérialisation**       | Mise en file de requêtes derrière une opération bloquante. Elle épargne la médiane et détruit le 99ᵉ centile. |
| **Plafond théorique**   | `1 s ÷ CPU de boucle par requête`. Une borne haute, jamais un débit observé.                                  |

## Pièges

Ces quatre-là ont produit des verdicts faux sur cette seule question. Ils sont détaillés dans
[Le décor ment plus souvent que le code](instruments.md) ; en voici la forme courte, parce qu'ils
sont faciles à reproduire.

- **Un minuteur ne mesure pas un blocage court.** Un délai de zéro est borné par Node à ~1 ms :
  on mesure la granularité du minuteur. Verdict produit : « SQLite bloque 0,43 ms » pour une
  requête de 33 µs — un facteur 13.
- **`monitorEventLoopDelay` a une résolution de l'ordre de la milliseconde.** Il rendait son
  propre plancher pour les **deux** pilotes, donc « aucune différence ».
- **`process.cpuUsage()` compte tous les fils**, ramasse-miettes compris. C'est un majorant, pas
  un plafond de débit : sur une réponse volumineuse, il a rendu 110 % du temps mural.
- **Une colonne « bloque la boucle ? non » qui n'a jamais mesuré.** C'est le pire des quatre,
  parce qu'il ne ressemble pas à une erreur. **Un banc qui n'a pas mesuré doit se taire, pas
  répondre « non ».**

Deux gardes ont été ajoutées à l'instrument pour que cela ne se reproduise pas : `--prove`, qui
démontre le blocage par le rappel armé au lieu de l'affirmer, et `--ceiling`, qui mesure un
plafond au lieu de le déduire. Une troisième correction a supprimé un défaut plus grossier :
avec zéro ligne demandée, le banc publiait « ~173 762 requêtes/s » sur une **table vide**, en
sortant avec un code de succès.

## Pour aller plus loin

- ⬆️ **Retour au hub** : [Performance](index.md)
- 🗄️ [ORM et bases de données](orm.md) — l'escalier complet, et où partent les microsecondes
- 🎭 [Le décor ment plus souvent que le code](instruments.md) — les instruments, et Docker Desktop
- 📏 [Méthode de mesure](methode.md) — le vocabulaire et les gardes
- 🧰 Instrument : `.claude/skills/nodefony-load-test/scripts/db-backend-cost.mjs` (`--prove`, `--ceiling`)
