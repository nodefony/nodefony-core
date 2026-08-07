---
title: "Méthode de mesure — comment un chiffre devient une mesure"
lang: fr
module: "global"
topic: perf-methode
section: "Performance"
audience: [developer]
tags: [performance, methode, benchmark, protocole, mesure]
status: stable
updated: "2026-08-07"
source: ".claude/skills/nodefony-load-test/"
tests: none
---

📍 [Documentation](../index.md) › [Performance](index.md) › **Méthode de mesure**

> Un banc rend toujours un nombre. Il le rend même quand le serveur est éteint, même quand la
> machine est bridée, même quand l'instrument mesure sa propre granularité. Cette page décrit ce
> qui sépare ce nombre d'une **mesure** : le décor, les contrôles de validité, les critères
> décidés **avant** de regarder le résultat, et le vocabulaire qui permet de lire les autres
> pages du dossier sans se tromper de grandeur.

## Le modèle — ce qu'on mesure, et pourquoi ce n'est pas « la vitesse de Nodefony »

Nodefony est un framework de **runtime**. Ce qui l'intéresse n'est pas un record, c'est le
**travail effectué par requête** : combien d'objets sont construits, combien d'appels système
sont payés, combien de microsecondes de CPU sont consommées pour rendre une réponse. Le débit
n'est qu'une façon commode de lire ce travail à l'envers.

D'où le dispositif retenu, et ses trois choix :

**Un seul processus.** Un serveur mono-processus sous charge est **borné par le CPU**
(~119 % d'un cœur observé). Son débit reflète donc directement le coût par requête : diviser
une optimisation par le nombre de cœurs la rendrait invisible. Un banc en cluster mesure autre
chose — la co-location du générateur de charge et des workers sur la même machine — et ne sait
pas montrer un gain de CPU par requête.

**Une cible dédiée.** `GET /nodefony/kernel/bench` est un controller ordinaire qui rend un objet
**figé** (`Object.freeze`, donc zéro allocation par requête), sur un chemin **hors de l'aire
d'administration**. Elle emprunte le trajet complet d'une route applicative — routage, contexte,
sécurité, sérialisation, écriture — et **rien de plus**. Elle n'existe que sous `NF_BENCH_ROUTE=1` :
aucune surface n'est ajoutée en production par défaut.

Ce choix se paie d'une discipline : on ne lui substitue pas une route qui passerait pour
équivalente. `/nodefony/kernel/api/livez` ajoute une résolution de zone, un authentificateur, le
broker d'administration et un rapport de démarrage dans le handler. Une route d'un module de
développement, elle, **n'existe pas en production** — et un 404 répond plus vite qu'une vraie
réponse, donc il améliore le score.

**Des rapports, pas des absolus.** Le générateur de charge tourne sur la même machine que le
serveur. Les valeurs absolues sont donc basses pour **tous** les participants, y compris les
points de comparaison. Seuls les rapports entre eux sont exploitables, à décor identique et dans
la même fenêtre de mesure.

## Le décor

Commun à toutes les mesures du dossier :

|                      |                                                                  |
| -------------------- | ---------------------------------------------------------------- |
| Processeur           | Intel Core i9-8950HK @ 2,90 GHz — 6 cœurs physiques, 12 logiques |
| Mémoire              | 32 Go                                                            |
| Système              | macOS 15.7.7 (Darwin 24.6)                                       |
| Serveur              | mono-processus, `NODE_ENV=production`, boucle locale             |
| Journalisation       | `NF_LOG_DRIVER=null` pendant la mesure                           |
| Générateur de charge | `wrk` 4.2.0 `[kqueue]`, `-t4`                                    |

Et ce qui **change d'une famille de bancs à l'autre** — parce qu'une comparaison ne vit qu'à
l'intérieur d'une famille :

| Famille de bancs               | Node    | Charge        | Cible                                      | Table de routes |
| ------------------------------ | ------- | ------------- | ------------------------------------------ | --------------- |
| Pipeline HTTP (A/B et profils) | v26.5.0 | `-c128`, 10 s | cible de banc du framework                 | 136             |
| Comparatif de frameworks       | v26.5.0 | `-c128`, 10 s | route équivalente répliquée par chaque app | 186             |
| ORM et bases de données        | v26.7.0 | `-c25`, 7 s   | routes de banc ORM, corpus réaliste        | 186             |

> **Machine portable de 2018, sujette au bridage thermique.** C'est un défaut pour publier des
> absolus, et un avantage pour concevoir un protocole : tous les pièges de mesure s'y manifestent
> avec une amplitude qu'une machine de salle serveur masquerait. Plusieurs gardes décrites plus
> bas n'existent que parce que cette machine les a rendues nécessaires.

> **Pourquoi 25 connexions sur les bancs ORM et 128 sur le pipeline.** Au-delà de la saturation,
> la concurrence supplémentaire ne produit plus du débit mais de la file d'attente — et sur un
> magasin synchrone, elle produit des expirations. Mesurer une route ORM à 128 connexions revient
> à mesurer une file. Le détail est dans [la boucle d'événements](boucle-evenements.md).

## Les contrôles de validité

### La règle qui précède toutes les autres

> **Un banc qui ne vérifie pas que le travail a eu lieu mesure la vitesse à laquelle on échoue.**

Ce n'est pas une précaution théorique. Un banc de ce dépôt annonçait **1 626 requêtes par seconde
sur un port fermé** : les requêtes étaient comptées au lancement, pas au succès. Rien dans le
chiffre ne paraissait anormal — c'est exactement ce qui le rendait dangereux. Une erreur revient
plus vite qu'une vraie réponse : **échouer améliore le score**, sur le débit comme sur les
percentiles.

Tout banc du dépôt doit donc :

1. **prouver la cible avant de mesurer** — code HTTP attendu, corps attendu, ou volume attendu ;
2. **prouver le travail pendant la mesure** — réponses hors 2xx/3xx signalées par `wrk`, octets
   réellement écrits, messages réellement reçus ;
3. **ne compter que le succès**, dans le débit comme dans les percentiles ;
4. **refuser de conclure sous la variance** — deux mesures à 21 et 23 ms avec 27 % de dispersion
   ne se classent pas, et le banc doit l'écrire ;
5. **sortir en code d'erreur quand rien n'a été mesuré** — un banc muet ne doit pas ressembler à
   un banc réussi.

Un corollaire a coûté cher avant d'être formulé : **un contrôle de cible qui échoue doit arrêter
la série, pas l'imprimer**. Une campagne entière a mesuré ~5 500 réponses `401` par run parce que
la ligne « cible : 401 » s'affichait sans interrompre quoi que ce soit — le cookie de session
avait expiré pendant une campagne longue.

### Le protocole A/B

Une optimisation du pipeline se juge par **paires alternées** : `old1`, `new1`, `old2`, `new2`.
L'alternance annule la dérive de la machine sur la durée de la série ; deux paires permettent de
voir si la direction du gain est stable ou si elle change de signe.

Chaque run comprend un **échauffement non compté** (le compilateur à la volée de V8 a besoin de
quelques secondes), puis trois mesures dont on garde la **médiane**, avec publication du
minimum, du maximum et de la **dispersion**. Une série dont la dispersion dépasse 3 % est
**refusée** : un seuil de décision ne peut pas trancher dans une fenêtre plus bruyante que lui.

Le verdict a **trois issues, jamais deux** :

| Issue                             | Condition                                                            | Ce qu'on en fait                                         |
| --------------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------- |
| **Gain net**                      | les deux `new` au-dessus des deux `old`, sans chevauchement, > bruit | on garde et on publie le chiffre                         |
| **Structurel gardé en le disant** | médiane favorable mais chevauchement des séries                      | on garde pour l'argument mécanique, **sans revendiquer** |
| **Rejet**                         | directions opposées entre paires, ou moyenne dans le bruit           | on **annule** le lot                                     |

Le critère est **engagé avant la mesure**. C'est ce qui a permis de rejeter un lot entier
(`F-D`, décrit dans [le pipeline HTTP](pipeline-http.md)) après l'avoir écrit, testé et prouvé
correct : son A/B rendait des directions opposées entre deux paires, moyenne −0,4 %. Le code a
été annulé.

### Les gardes de décor

Elles ne sont pas des précautions de principe : chacune est née d'un verdict faux.

| Garde                            | Ce qu'elle empêche                                                                                       |
| -------------------------------- | -------------------------------------------------------------------------------------------------------- |
| **Régime CPU** (`cpuRegime`)     | Comparer une fenêtre bridée à une fenêtre libre — écart mesuré ×1,62 **à code identique**                |
| **Niveau thermique**             | Comparer un run à froid à un run après vingt minutes de charge — la chaleur peut **inverser** un verdict |
| **Indexation Spotlight** (`mds`) | Mesurer pendant qu'un processus système réindexe les fichiers reconstruits (11–22 % de CPU par vagues)   |
| **Docker arrêté**                | Mesurer pendant qu'un conteneur inactif consomme 64 % du CPU                                             |
| **Purge des résultats**          | Laisser un résultat d'un autre lot entrer dans une comparaison qui ne le concerne pas                    |
| **`LC_ALL=C`**                   | Une locale française rendant « 4,1 » là où le script attend « 4.1 » — garde numérique **muette**         |
| **Un seul serveur**              | Un superviseur résiduel qui tient le port et fait échouer le démarrage du serveur mesuré                 |

Le détail de ce que chacune a rattrapé est raconté dans
[Le décor ment plus souvent que le code](instruments.md).

## Lexique

| Terme                              | Ce qu'il désigne ici                                                                                                                               |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **RPS**                            | Requêtes servies par seconde, succès uniquement. Toujours accompagné de son décor.                                                                 |
| **µs/req**                         | Budget d'une requête, soit `1 000 000 / RPS`. C'est la grandeur qu'on additionne et qu'on décompose ; le RPS, non.                                 |
| **p50 / p99**                      | Latences médiane et au 99ᵉ centile. Le p99 dit ce que subit la requête malchanceuse — il révèle la sérialisation là où la moyenne la cache.        |
| **Dispersion**                     | `(max − min) / médiane` sur les runs d'une série. Au-delà de 3 %, la série ne tranche rien.                                                        |
| **Concordance inter-séries**       | Écart entre les médianes de deux séries indépendantes. Critère de repli quand la dispersion intra-série est structurellement impassable.           |
| **Niveau thermique**               | `machdep.xcpm.cpu_thermal_level` sur macOS — indicateur du bridage en cours.                                                                       |
| **Régime CPU**                     | Secteur, batterie, ou mode basse consommation. macOS l'active **seul** sur batterie et bride l'accélération du processeur.                         |
| **ELU** (_event loop utilization_) | Part du temps où la boucle d'événements travaille au lieu d'attendre. Un ELU à 1,00 dit « saturé » ; c'est la mesure de saturation, jamais `ps`.   |
| **Blocage**                        | Temps pendant lequel la boucle d'événements **ne peut rien faire d'autre**. C'est cette grandeur qui plafonne un processus.                        |
| **Latence**                        | Temps d'attente d'une réponse. Elle **ne plafonne rien** si elle se passe hors de la boucle — voir [la boucle d'événements](boucle-evenements.md). |
| **Structurel**                     | Coût qui découle du design (contexte unifié, injection de dépendances, sécurité par défaut). On l'assume ou l'on change d'architecture.            |
| **Accidentel**                     | Travail fait pour rien. C'est la cible légitime d'une optimisation.                                                                                |

## Pièges

- **Un pourcentage de profil n'est pas un pourcentage de budget.** Un profil échantillonné
  rapporte du CPU **occupé** ; quand une part du temps de requête part en attente, les deux
  échelles divergent. Trois fois de suite, un poste imputé à 18–31 µs par le profil s'est révélé
  valoir 0,6–1,3 µs au micro-banc — un écart de facteur 25 à 30. **Tout pourcentage de profil se
  convertit en nanosecondes par un micro-banc avant d'ouvrir un chantier.**
- **Un compte, lui, ne ment pas.** « 43 exécutions de motif de route par requête » est exact,
  déterministe, et ne dépend ni de la machine ni de l'instrument. Quand un diagnostic peut se
  poser en compte plutôt qu'en durée, le préférer.
- **Deux fenêtres de mesure ne se comparent pas.** Les mêmes binaires ont rendu 7 000 et 9 800 RPS
  à quelques jours d'écart, décor apparemment identique. Toute comparaison vit **à l'intérieur**
  d'une fenêtre.
- **Une pause longue endort le serveur.** Au-delà de deux minutes d'inactivité, macOS met le
  processus en veille douce et le run suivant paie −13 %, reproduit trois fois sur trois. Le
  refroidissement se fait **avant** la série, jamais entre les runs.
- **La fenêtre la plus stable peut être la plus fausse.** Un processeur bridé tient un plafond bas
  sans effort : la dispersion était parfaite des deux côtés (0,4 % et 1,6 %) et le résultat faux
  d'un facteur 1,62.
- **Un refus de garde n'est pas un chiffre faux, c'est un chiffre non prouvable.** Une série
  refusée cinq fois avait des médianes à ±1 % de celles finalement retenues. On ne négocie pas la
  garde, on attend une fenêtre propre.

## Pour aller plus loin

- ⬆️ **Retour au hub** : [Performance](index.md)
- 🔬 [Le pipeline HTTP](pipeline-http.md) — profilage, lots livrés, lot rejeté
- ⏱️ [La boucle d'événements](boucle-evenements.md) — blocage et latence sont deux grandeurs
- 🎭 [Le décor ment plus souvent que le code](instruments.md) — les instruments qui ont menti
- 📐 [Ce qui reste ouvert](ouvertures.md) — les limites assumées de ce dossier
- 🧰 Outillage : `.claude/skills/nodefony-load-test/` — bancs, protocoles, scripts rejouables
