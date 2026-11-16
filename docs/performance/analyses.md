---
title: "Où part le temps — le budget d'une requête, mesuré"
navTitle: Où part le temps
updated: 2026-11-16
lang: fr
module: "global"
topic: perf-analyses
section: "Performance"
audience: [developer]
tags: [performance, pipeline, profilage, comparaison, orm, binaire, limites]
status: stable
source: ".claude/skills/nodefony-load-test/"
tests: none
---

📍 [Documentation](../index.md) › [Performance](index.md) › **Où part le temps**

> Cette page répond à une question : **où part le temps d'une requête Nodefony**, et qu'est-ce
> qui le distingue de celui d'un autre framework qui rend le même service. Tous les chiffres
> viennent de la campagne du 15 novembre 2026 (Node 26.13.1, commit `eae9060a`), les figures
> sont calculées depuis le [jeu publié](https://github.com/nodefony/nodefony-core/blob/main/docs/performance/data/10.0.0.json).
> Le protocole qui les rend opposables vit dans [Méthode de mesure](methode.md).

## À résultat observable égal

Les témoins de ce dossier — Express et NestJS, chacun **équipé** — rendent le même résultat
que Nodefony sur la route mesurée : même statut, mêmes en-têtes de sécurité, un identifiant de
requête, la corrélation `traceparent`, CORS par liste blanche, le contrôle anti-CSRF par
_Fetch Metadata_, les zones du pare-feu. Un contrôle de parité compare leurs réponses champ par
champ avant chaque campagne, et refuse de mesurer s'il trouve un écart.

Ce contrôle prouve le **résultat**, pas le **travail**. Ce qu'une réponse ne montre pas — une
portée d'injection ouverte par requête, un contexte commun à HTTP et WebSocket, des points
d'extension, un minuteur de réponse — reste invisible à la parité, et se paie quand même. C'est
précisément ce que cette page décompose : quel travail, combien, et pour quel service rendu.

## Le budget d'une requête triviale

La route mesurée ne fait rien : elle rend un petit objet JSON. Le framework y est 100 % du
budget — c'est le cas où il pèse le plus lourd, et aucune application réelle ne s'y tient.

Pour décomposer ce budget, on **coupe** le pipeline à un étage donné : le serveur est rechargé
avec un étage remplacé par une réponse immédiate (corps pré-sérialisé, écrit directement sur la
réponse Node), et l'on mesure le CPU du fil principal par requête. L'écart entre deux coupes
successives est le coût de l'étage. Trois manches alternées, le témoin mesuré dans chacune.

<!-- figure: budget-etages -->

| Étage                                         | µs/req cumulés | Ce qui s'y fait                                                   |
| --------------------------------------------- | -------------: | ----------------------------------------------------------------- |
| Node seul (`entry`)                           |           23,6 | analyse HTTP, socket, écriture — le plancher, avec le banc        |
| contexte (`context`)                          |           30,2 | `HttpContext`, requête et réponse enveloppées, portée d'injection |
| pipeline (`pipeline`)                         |           32,5 | stockage asynchrone, `traceparent`, CORS, gardes de sécurité      |
| routage (`route`)                             |           35,0 | résolution de la route, contrôle des zones                        |
| action (`action`)                             |           38,4 | résolution du contrôleur et de ses arguments                      |
| complet                                       |           45,9 | appel de l'action, rendu JSON, en-têtes, écriture                 |
| _NestJS équipé, adaptateur `node:http` natif_ |         _36,0_ | _le même résultat, mesuré dans les mêmes manches_                 |

L'écart avec le témoin est de **~10 µs par requête (×1,28)**. Il n'a pas de foyer unique : chaque
étage porte un à sept microsecondes, et tous gardent le même signe d'une manche à l'autre. Une
coupe (`action`) disperse à 4,1 % pour un seuil de 3 % : le tableau se lit en ordre de grandeur,
pas au dixième.

> Une coupe change ce que V8 compile : couper au milieu de la chaîne modifie les formes vues par
> le compilateur. Les bornes (Node seul, complet) sont solides ; le détail d'un étage est une
> indication qui se recoupe par le profil ci-dessous, jamais un verdict seul.

## Ce que Nodefony fait faire à Node

Le profil V8 comparé, fonction par fonction, montre où les deux frameworks **diffèrent** dans le
travail qu'ils demandent à Node lui-même.

<!-- figure: ecart-node -->

Deux familles ressortent, et seulement chez Nodefony :

- **les minuteurs (≈ 8 µs au profil)** — insertion dans la liste des minuteurs, lecture de l'horloge,
  délai de socket réarmé. Chaque requête Nodefony arme un délai de réponse (30 s par défaut,
  aligné sur `requestTimeout`) qui rend un 504 si une action ne répond jamais ;
- **la fin de flux (≈ 6 µs au profil)** — fermeture du flux entrant, nettoyage de la requête, destruction
  et rappels d'écriture.

Ces familles se chiffrent par une expérience, pas par ce profil : **le profil sur-attribue**. Il
compte ici ~17,6 µs pour le témoin, quand le fil principal en mesure 36 — ses pourcentages
désignent, ils ne pèsent pas. L'expérience a été faite pour les minuteurs : Nodefony contre
lui-même, en paires alternées, avec **tous** les délais HTTP mis à zéro (délai de socket, délai de
réponse, délai de repos). Le débit n'a pas bougé au-delà du bruit — 23 664 req/s contre 23 043 à
24 209 avec les délais par défaut —, quand 8 µs retirés sur ~43 l'auraient monté d'environ 19 %.
La piste est close : le coût réel des minuteurs est sous la résolution du banc (~1,3 µs).

<!-- figure: code-propre -->

Le code propre de Nodefony pèse **~12 µs par requête** au profil : le module HTTP (~8,2 µs —
constructeurs du contexte, conteneur de la portée, en-têtes), le cœur (~2,6 µs — conteneur
d'injection), le framework (~1,1 µs — routeur, métadonnées) et la sécurité (~0,3 µs).

## Le travail que la parité ne voit pas

Ce qu'un framework fait de plus qu'un autre, à réponse identique, se classe en deux colonnes :
le travail qui **rend un service** à l'application, et celui qui n'est consommé par personne. Seul
le second est une cible d'optimisation légitime — retirer le premier, ce serait retirer une
fonctionnalité pour gagner un banc.

| Travail par requête                    | Service rendu                                                    | Coût                          | Statut                           |
| -------------------------------------- | ---------------------------------------------------------------- | ----------------------------- | -------------------------------- |
| portée d'injection ouverte puis fermée | services `@Scope("request")`, isolation de l'état entre requêtes | dans les ~6,6 µs du contexte  | assumé                           |
| contexte unifié HTTP/WebSocket         | même contrôleur, même sécurité pour les deux protocoles          | dans les ~6,6 µs du contexte  | assumé                           |
| délai de réponse armé                  | 504 sur action bloquée, plutôt qu'une connexion pendue           | < 1,3 µs (A/B, délais à zéro) | assumé — le profil en comptait 8 |
| fin de flux                            | libération de la requête entrante                                | ≈ 6 µs au profil (famille)    | **à instruire**                  |
| zones du pare-feu, gardes              | sécurité par défaut, sur toutes les requêtes                     | ~2 µs                         | assumé                           |
| points d'extension, compteurs          | observabilité, Studio, barre de debug                            | non isolé                     | à mesurer                        |

Aller significativement plus bas que ce que permettent les deux pistes ouvertes ne serait plus de
l'optimisation : ce serait un choix d'architecture — un contexte allégé, des fonctionnalités en
option. Il n'est pas pris.

## Face à Express et à NestJS

Face à **Express équipé**, la paire alternée conclut « dans le bruit » : ~22 200 req/s de part et
d'autre, rapport 100,3 %. Il a fallu trois essais — un tir décroché a fait refuser une série de
chaque camp tour à tour — et aucune série survivante n'a été gardée.

### NestJS, sur deux adaptateurs

NestJS se mesure ici sur ses deux adaptateurs HTTP, chacun avec le même travail équipé :

| Témoin                        | req/s (séries)  | Nodefony (séries) | Nodefony / témoin |
| ----------------------------- | --------------- | ----------------- | ----------------: |
| NestJS équipé sur Fastify     | 23 424 · 23 052 | 22 515 · 22 228   |            96,2 % |
| NestJS équipé sur `node:http` | 27 145 · 27 857 | 23 059 · 22 453   |            82,8 % |

Le même NestJS va ~18 % plus vite sur `node:http` que sur Fastify : l'adaptateur Fastify ajoute
sa propre couche (routage, hooks, réponse) par-dessus le travail équipé. Face à lui, Nodefony est
dans la même zone (CPU du fil principal ×1,04, et un p99 de 3,8 ms contre 4,1). Face à
l'adaptateur natif — le même serveur HTTP que Nodefony —, l'écart est celui décomposé plus haut :
~10 µs par requête.

## Avec une base de données

Dès qu'une base entre dans la boucle, le framework devient une fraction du budget. Le banc
applicatif lit vingt lignes avec leurs clés étrangères puis met à jour la ligne lue, sur une base
SQLite de 10 000 factures — même ORM (Drizzle), même pilote, même schéma, chaque camp sa copie de
la base. 25 connexions (le pilote est synchrone : au-delà, on mesure une file), tirs de 60 s.

| Cas                    | Témoin         | Nodefony / témoin | Lecture                                                  |
| ---------------------- | -------------- | ----------------: | -------------------------------------------------------- |
| GET lecture + écriture | Express équipé |           105,7 % | même zone ; la requête préparée mémoïsée joue            |
| GET lecture + écriture | NestJS équipé  |           106,3 % | idem                                                     |
| POST validé            | Express équipé |           103,3 % | lecture du corps, validation, écriture                   |
| POST validé            | NestJS équipé  |           106,6 % | NestJS valide par `class-validator`                      |
| POST refusé (422)      | Express équipé |            79,2 % | **écart ouvert** : sans base, la réception du corps pèse |
| POST refusé (422)      | NestJS équipé  |           120,4 % | `ValidationPipe` et sa sérialisation d'erreur            |

Le cycle complet coûte près d'une milliseconde, dont ~800 µs pour Drizzle et `better-sqlite3`
dans tous les camps. Le chemin 422 ne touche aucune base, et c'est là que Nodefony rend 79 %
d'Express : ~81 µs par requête contre ~65, soit ~17 µs d'écart. Ce n'est pas un chemin d'erreur :
la route valide le corps par le même code que le témoin et rend son 422 par la même réponse JSON
que le cas valide, sans exception levée. Sans base pour diluer, ce qui reste est un POST nu ; or le
GET trivial, lui, est dans le bruit face à Express. L'hypothèse la plus probable est donc la
réception du corps (lecture du flux, analyse, injection par `@Body`) — une hypothèse, pas une
mesure : elle est nommée dans [ce qui reste ouvert](#ce-qui-reste-ouvert).

> SQLite est ici un pilote de démonstration, pas une cible de performance : il borne le débit par
> son exécution synchrone. Le duel sur PostgreSQL attend un camp Nodefony dédié (#403) ; aucun
> absolu PostgreSQL de ce dépôt n'est transposable (virtualisation réseau de Docker Desktop).

## Le binaire temps réel

Le même flux de messages binaires, servi par trois transports sur le même serveur de production :
la socket Nodefony (CBOR sur WebSocket), gRPC (Connect sur HTTP/2), et HTTP/2 nu comme plancher.

<!-- figure: binaire -->

Sur les petits messages, le coût fixe domine : la socket fait passer un message de 16 octets
**~4,5 fois** moins cher que gRPC, et ~2,2 fois à 1 Ko. À 16 Ko, les deux se rejoignent (le coût
de copie domine). À 64 Ko, l'écart revient (~2 fois). Mesuré machine froide, le matin suivant la
campagne ; la nuit précédente avait rendu les mêmes ordres de grandeur. L'écart avec HTTP/2 nu est le
plancher de l'adaptateur Connect, pas un travail de Nodefony.

## Ce qui a été corrigé en route

Le pipeline a été raboté par lots, chacun prouvé par A/B de Nodefony contre lui-même en paires
alternées, aucun ne retirant une fonctionnalité ni un défaut de sécurité :

| Lot | Geste                                                                  | Effet mesuré                                            |
| --- | ---------------------------------------------------------------------- | ------------------------------------------------------- |
| A   | en-têtes constants posés une fois, plus à chaque requête               | levier n°1 du premier profil (≈ 13 µs)                  |
| B   | nonce CSP et délais                                                    | poste découvert au profil, absent de l'analyse statique |
| C   | promesses attendues sans abonné retirées                               | —                                                       |
| D   | URL analysée une fois (et un défaut de disponibilité corrigé en route) | —                                                       |
| F-D | câblage figé des dépendances                                           | **annulé** : A/B en sens opposés, bruit                 |
| G   | envoi synchrone quand rien n'attend, contrôleurs en instance unique    | +6,3 % au minimum, p99 58 → 34-46 ms                    |
| H   | banc corrigé (deux écoutes parasites, runs préemptés refusés)          | écart face à NestJS-Fastify : ×1,26 → ×1,04             |
| ORM | requête préparée mémoïsée, `UPDATE` direct sur clé primaire            | +3,7 à 5,3 % ; 71,9 → 10,1 µs sur un SELECT             |

La règle qui a coûté le plus cher à apprendre : **une analyse sans exécution oriente, elle ne
prouve pas.** La première analyse statique du pipeline avait sous-estimé les en-têtes d'un
facteur 5 et accusé le ramasse-miettes, qui pèse moins de 1 %.

## Ce qui reste ouvert

- **La fin de flux** (~6 µs au profil) : à chiffrer par une expérience, comme les minuteurs, avant
  d'y voir un gain — ceux-ci, comptés 8 µs au profil, pèsent moins de 1,3 µs réels.
- **Le POST sans base face à Express** (79 %, ~17 µs) : la réception du corps est suspectée, pas
  prouvée. La preuve tient en une paire alternée sur un POST trivial des deux côtés, puis un
  profil comparé de ce POST.
- **La pente mémoire du soak** : 0,06 Mo d'empreinte par million de requêtes sur 90 min, sans
  fuite au tas ni accumulation de ressources, mais trois fois la valeur d'octobre. Un soak plus
  long dira si elle se stabilise.
- **La tenue au-delà de 90 minutes** : le banc écarte les fuites grossières, pas les lentes.
- **PostgreSQL** : duel à refaire avec un camp Nodefony dédié, sur Linux natif.
- **Fastify nu** : hors périmètre — il sature ce que cette machine mesure proprement, et n'informe
  pas la question « à service égal ».

## Comment contester un chiffre

Tous les bancs cités sont versionnés dans `.claude/skills/nodefony-load-test/`, avec leurs
gardes. Quand une mesure est remise en question, c'est la mesure qu'on rejoue, pas l'argument
qu'on renforce.

```bash
# toute la campagne
# (parité, paires, base, étages, profil, CPU du fil, capacité, binaire, tenue)
caffeinate -dims bash .claude/skills/nodefony-load-test/scripts/perf-campaign.sh --at 01:30
# une pièce seule, par exemple le budget par étage
bash .claude/skills/nodefony-load-test/scripts/perf-campaign.sh --only "etages"
# le fichier publié, recomposé depuis les séries brutes
node .claude/skills/nodefony-load-test/scripts/perf-compose.mjs \
  --campaign tmp/bench/perf-campaign-<date> --data docs/performance/data/10.0.0.json
```

## Lexique

| Terme                       | Sens ici                                                                                 |
| --------------------------- | ---------------------------------------------------------------------------------------- |
| **témoin équipé**           | un autre framework muni des mêmes garanties que Nodefony, contrôlé par la parité         |
| **paire alternée**          | deux camps mesurés A₁ B₁ A₂ B₂, pour que la dérive de la machine porte sur les deux      |
| **CPU du fil principal**    | le temps de processeur du fil qui sert les requêtes, ramené à la requête (µs/req)        |
| **coupe**                   | un étage du pipeline remplacé par une réponse immédiate, pour mesurer ce qui le précède  |
| **structurel / accidentel** | le prix d'un service rendu, contre du travail fait pour rien — seul le second s'optimise |

Le vocabulaire du protocole (dispersion, séparation, test nul) est défini dans
[Méthode de mesure](methode.md).

## Pièges

- **Un profil désigne, il ne pèse pas.** Les minuteurs comptaient 8 µs au profil ; l'expérience
  qui les retire tous ne bouge pas le débit. Convertir en microsecondes par un A/B avant d'ouvrir
  un chantier.
- **Un gain de micro-banc ne passe jamais entier au banc** : ~60 µs isolés sur le chemin ORM, 35 à
  45 µs retrouvés dans le cycle complet.
- **La médiane d'une somme n'est pas la somme des médianes** : un budget par étage se dessine sur
  les cumuls, sinon son total ne retombe pas sur le chiffre publié.
- **Une coupe change ce que V8 compile** : seules les bornes d'une bissection sont des verdicts.
- **Comparer deux fenêtres n'a pas de sens** : un rapport vient d'une paire alternée, jamais de
  deux médianes prises à des heures différentes.

## Pour aller plus loin

- ⬆️ **Retour au hub** : [Performance](index.md)
- 📐 [Méthode de mesure](methode.md) — le protocole qui rend ces chiffres opposables
- 📊 [La version courante, en figures](https://nodefony.net/performance/latest/) — comparatif, tenue, dimensionnement
- 🧰 Outillage : `.claude/skills/nodefony-load-test/` (`perf-campaign.sh`, `wait-compare.sh`, `profile-compare.sh`)
