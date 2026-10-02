---
title: "Performance — les chiffres, et ce qu'ils valent"
navTitle: Performance
updated: 2026-10-02
lang: fr
module: "global"
topic: perf-index
section: "Performance"
audience: [developer, devops]
tags: [performance, benchmark, mesure, comparaison, dimensionnement]
status: stable
source: "docs/performance/"
---

📍 [Documentation](../index.md) › **Performance**

> 📊 **Les mesures de la version courante se lisent en ligne :**
> [peut-on partir en production ?](https://nodefony.github.io/nodefony-core/performance/latest/) —
> comparatif, tenue dans la durée, dimensionnement d'un pod, calculateur. Une page par version
> publiée ; les données qui la nourrissent sont versionnées dans [`data/`](data/README.md).

> Ce dossier tient en **trois pages**. Celle-ci porte les **chiffres** et ce qu'ils valent.
> [Méthode de mesure](methode.md) dit comment un nombre devient une mesure — et raconte les
> instruments qui ont menti. [Où part le temps](analyses.md) décompose le budget d'une requête,
> dans le pipeline, face aux autres frameworks, et dans les bases de données.
>
> Il est écrit pour être **contesté** : chaque chiffre porte son décor, son protocole et la
> commande qui le rejoue.

> ### ⚖️ Un chiffre n'est pas une vérité — c'est une mesure que personne n'a encore réfutée
>
> Aucune mesure de ce dossier ne **prouve** quoi que ce soit. Chacune dit : « dans ce décor, avec
> ce protocole, voilà ce qui a été observé » — et elle tient jusqu'à ce qu'une observation la
> contredise. C'est la seule posture tenable, et elle a déjà servi plus d'une fois ici : une
> référence entière a été invalidée parce qu'elle n'enregistrait pas sa version de Node, un lot de
> code a été annulé par sa propre mesure, une analyse de départ a été contredite par le profilage,
> et un rapport entre deux camps s'est déplacé quand on a éteint une machine virtuelle.
>
> Ce qui s'écrit ici doit donc rester **réfutable** : un chiffre sans son décor, sans son
> protocole et sans la commande qui le rejoue n'est pas un résultat, c'est une opinion. Si une
> affirmation de ce dossier ne peut pas être mise en défaut par une mesure, c'est qu'elle n'a rien
> à y faire.
>
> **Réfuter un chiffre d'ici est la contribution la plus utile qu'on puisse apporter à ce dossier.**
> La marche à suivre est dans [Où part le temps](analyses.md#ce-qui-reste-ouvert).

## Le chiffre qu'il faut regarder en premier

**À travail égal, Nodefony est dans la même zone que les serveurs qui rendent le même service.**
Ce dossier ne cherche pas de gagnant : il répond à la question « Nodefony tient-il la route ? », en
le comparant à Express et à NestJS **équipés pour rendre le même service** que lui par requête —
contexte asynchrone, identifiant de requête, traçage W3C, CORS, en-têtes de sécurité, contrôle
d'origine, zones du pare-feu.

Sur une route qui ne fait **rien** — pas de base, pas de session, juste le trajet complet du
pipeline —, le framework est 100 % du budget de la requête. C'est le cas le plus exigeant pour lui :

| Paire mesurée (A ↔ B)          | Nodefony / l'autre | Séparation             |
| ------------------------------ | -----------------: | ---------------------- |
| Express équipé ↔ Nodefony      |        **112,7 %** | nette                  |
| NestJS équipé ↔ Nodefony       |         **93,6 %** | nette                  |
| Nodefony ↔ Nodefony (test nul) |            103,0 % | **sous la résolution** |

> La dernière ligne est la garantie de sérieux du tableau : le même serveur mesuré contre lui-même
> s'écarte de 3 %. C'est la **résolution réelle** du banc. Les trois serveurs qui rendent le même
> service tiennent dans ±7 % — la même zone.

Dès qu'une application fait le travail pour lequel elle existe — lire une base, l'écrire —, le
framework devient une **fraction** du budget : ~46 µs sur ~895 µs par requête. Les écarts y passent
à la limite de la résolution : **96,7 %** d'Express équipé, **95,9 %** de NestJS équipé, au même ORM
et au même pilote. C'est la mesure qui répond à « le framework sera-t-il mon goulot ? ».

> 🔬 **La version précédente de cette page publiait 90,1 % face à Express équipé.** Le témoin Express
> faisait alors **plus** que Nodefony (`ETag`, HSTS sur une connexion en clair, zones inutilisées).
> Ramené au même travail, il est passé de ~16 100 à ~19 100 requêtes par seconde ; Nodefony, de
> ~14 500 à ~21 700 (lots du pipeline, Node 26.10). Le nouveau chiffre n'est donc pas d'abord une
> progression : c'est d'abord une mesure juste.

## Le décor, sans lequel ces chiffres ne valent rien

|                      |                                                                                |
| -------------------- | ------------------------------------------------------------------------------ |
| Processeur           | Intel Core i9-8950HK @ 2,90 GHz — 6 cœurs physiques, 12 logiques               |
| Mémoire              | 32 Go                                                                          |
| Système              | macOS 15.7.7 (Darwin 24.6)                                                     |
| **Node**             | **v26.10.0**                                                                   |
| Régime CPU           | secteur, mode basse consommation **désactivé** (`AC Power/lpm=0`)              |
| **Hyperviseur**      | **éteint** — aucune machine virtuelle ne réserve de cœur                       |
| Serveur              | mono-processus, `NODE_ENV=production`, boucle locale, journalisation coupée    |
| Générateur de charge | `wrk` 4.2.0, `-t4 -c64`, échauffement 40 s non compté, 3 runs de 10 s, médiane |
| Protocole            | **paires alternées** `A₁ B₁ A₂ B₂`, série refusée au-delà de 3 % de dispersion |

🔴 **La version de Node fait partie du décor, au même titre que la machine.** Entre Node 26.7.0 et
26.8.1, sur un code identique, le débit d'Express a progressé de **+62 %** et le nôtre de **+37 %**.
Un jeu de mesures qui n'enregistre pas sa version de Node ne se compare donc à rien — c'est le
défaut qui a fait invalider la référence précédente.

🔴 **L'hyperviseur aussi.** Arrêter les conteneurs ne suffit pas : la machine virtuelle qui les
héberge continue de réserver ses cœurs. La même paire mesurée machine virtuelle allumée rend
89,8 % au lieu de 88,3 % — un décor sale ne déplace pas seulement les absolus, il déplace le
**rapport**.

## Comment lire les chiffres absolus

Le générateur de charge tourne sur la **même machine** que le serveur. Les valeurs absolues sont
donc basses pour tout le monde, points de comparaison compris. **Seuls les rapports sont
exploitables**, à décor identique et dans la même fenêtre de mesure. Un chiffre de ce dossier ne
se cite pas hors de son contexte.

Les absolus de la campagne, pour situer un ordre de grandeur (médiane de deux séries de trois runs) :

| Camp                       |      Débit | p50 / p99 (64 connexions) | Ce qu'il dit                                  |
| -------------------------- | ---------: | ------------------------- | --------------------------------------------- |
| `node:http` nu, 186 routes | 43 217 rps | 1,5 / 2,1 ms              | le plafond de la machine pour ce payload      |
| NestJS « équipé »          | 23 511 rps | 2,6 / 4,2 ms              | le même service, sur Fastify                  |
| **Nodefony**               | 21 686 rps | 2,9 / 4,4 ms              | le service complet du framework               |
| Express nu                 | 20 088 rps | 3,1 / 4,3 ms              | Express sans aucun service                    |
| Express « équipé »         | 19 235 rps | 3,3 / 4,6 ms              | le même service : ~5 % de moins qu'Express nu |

> ⚠️ **Un camp plus rapide que le serveur nu est un signal d'alarme, pas un exploit.** Au-delà de
> ~35 000 rps sur cette machine, le générateur de charge entre en concurrence avec le serveur sur
> les mêmes cœurs : c'est lui qu'on mesure. Un camp mesuré au-dessus de ce seuil a rendu 41 082 puis
> 33 695 rps sur deux séries — 22 % d'écart, donc rien de publiable.

## Le cas applicatif — une lecture et une écriture par requête

Une route qui ne fait rien ne ressemble à aucun logiciel. Le banc applicatif exerce donc ce que
fait un vrai service : **lire un état, puis l'écrire** — 20 lignes lues avec leurs clés
étrangères, puis la mise à jour de la ligne lue, sur un corpus de 10 000 factures.

Le premier chiffre à regarder n'est pas un rapport entre camps, c'est le **budget d'une requête** :

| Route                      | Budget par requête | Ce qui domine               |
| -------------------------- | -----------------: | --------------------------- |
| triviale (pipeline seul)   |         **~46 µs** | le framework, à 100 %       |
| lecture + écriture en base |        **~895 µs** | la **base**, à plus de 90 % |

**Un facteur 19.** C'est la mesure qui répond à la question « le framework est-il mon goulot ? » :
dès qu'une application fait le travail pour lequel elle existe, le choix du framework devient une
fraction de son budget. Une comparaison faite sur une route triviale mesure donc ce qui compte le
moins.

### Le protocole de ce banc, et pourquoi il est plus exigeant

| Choix                                 | Raison                                                                                                                                                                                                                   |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **UPDATE**, jamais INSERT             | à quelques milliers de requêtes par seconde, un insert gonflerait la table d'un ordre de grandeur **pendant** la mesure : les derniers runs ne mesureraient plus la même base que les premiers                           |
| écriture **dépendante** de la lecture | sans ce lien, un moteur pourrait paralléliser les deux, et l'on ne mesurerait plus une séquence applicative                                                                                                              |
| **SQLite**, pas PostgreSQL            | une base en conteneur fait mesurer la virtualisation réseau — facteur 3,7 sur ce dépôt. SQLite vit dans le processus : plus de chemin virtualisé, et un chiffre qu'un tiers peut reproduire                              |
| **25 connexions**, pas 128            | un pilote synchrone sérialise : au-delà de la saturation, la concurrence produit une file d'attente, pas du débit                                                                                                        |
| bases **séparées**, même seed         | les deux camps écrivent ; partager un fichier ferait subir à l'un les écritures de l'autre, et l'ordre de passage déciderait du résultat                                                                                 |
| runs de **60 s**                      | chaque requête écrit sur disque, et la journalisation de SQLite pose ses points de reprise à des instants imprévisibles. Un run court capte ce bruit ; on allonge la fenêtre plutôt que d'élargir le seuil de dispersion |

### Ce que le banc compare exactement

Les deux camps utilisent **le même ORM à la même version** et **le même pilote à la même
version** — la garde du banc refuse de mesurer si l'installé ne correspond pas au déclaré. Ils
rendent le **même résultat** (la ligne persistée). Ce qui diffère est la **couche d'accès** :

|                          | Camp témoin                       | Nodefony                                                                                                           |
| ------------------------ | --------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| ORM                      | drizzle, accédé **directement**   | drizzle, accédé **via le repository** d'`orm-core`                                                                 |
| Le `WHERE` de l'écriture | écrit par le développeur          | composé pour garantir « au plus une ligne » **portablement** entre SQLite, PostgreSQL et MySQL                     |
| SQL émis                 | `UPDATE … WHERE pk = ? RETURNING` | `UPDATE … WHERE pk = ? RETURNING` quand le critère fixe la clé primaire — sinon `… WHERE pk IN (SELECT … LIMIT 1)` |

Ce que ce banc mesure n'est donc pas « un ORM contre du SQL écrit à la main », mais **le prix de
l'abstraction portable** : ce que coûte une API générique qui doit rendre le même contrat sur
trois dialectes. Sur ce banc, le critère fixe la clé primaire : les deux camps émettent le même
SQL.

Le rapport entre les camps, paires complètes et séparation nette :

| Camp                         | Débit médian | Écart inter-séries | Nodefony / l'autre |
| ---------------------------- | -----------: | -----------------: | -----------------: |
| Express « équipé » + drizzle |    1 154 rps |              0,5 % |         **96,7 %** |
| NestJS « équipé » + drizzle  |    1 166 rps |              0,1 % |         **95,9 %** |
| **Nodefony** + `orm-core`    |    1 117 rps |        0,1 à 1,2 % |                  — |

**La même zone, à la limite de la résolution du banc** (3 %) : sur un cycle applicatif, le coût du
framework se fond dans celui de la base. Le face-à-face avec NestJS a été mesuré la veille de la
campagne, sur un code produit identique ; sa provenance est gardée à part dans le fichier de
données.

> 🔬 **Une première campagne avait publié 145,9 %** — Nodefony devant. Ce renversement était un
> **défaut du banc**, pas un résultat : le camp témoin chargeait deux instances distinctes de
> `drizzle-orm`, ce qui privait son contrôle de type interne de son chemin rapide sur chaque
> colonne de chaque ligne. Corrigé, ce camp gagne **+58,8 %** ; le camp Nodefony, lui, n'a pas
> bougé. Le mécanisme, sa mesure et la garde qui l'empêche de revenir sont dans
> [`analyses`](analyses.md#le-banc-sqlite--et-ce-quun-banc-peut-mesurer-à-la-place-dun-framework).

> ⚠️ **Ce banc n'est pas encore reproductible par un tiers** : son corpus est généré localement et
> n'est pas versionné (schéma issu d'un logiciel sous licence GPLv3). C'est le défaut même que
> cette version corrige pour les autres chiffres, et il est ouvert pour celui-ci.

## La tenue dans la durée — rien ne s'accumule

Un banc de dix secondes ne voit pas une fuite lente. Celui-ci a tenu **88 minutes** sous trafic
continu (64 connexions, ~18 500 requêtes par seconde), pour **97,5 millions de requêtes** servies.
Le processus n'accumule rien.

Toutes les lignes du tableau viennent **d'un seul run**, le 2 octobre 2026, sur Node v26.10.0.

| Grandeur                          | Mesure                                       | Lecture                                                      |
| --------------------------------- | -------------------------------------------- | ------------------------------------------------------------ |
| Tas JS (`heapUsed`)               | 45,6 → 46,0 MB · pente +0,1 MB/h (R² 0,03)   | **plat** — aucune fuite JS                                   |
| **Empreinte système** (macOS)     | **160 → 162 MB** · pente +1,7 MB/h (R² 0,24) | **plate** — rien n'est retenu                                |
| dont pages **réutilisables**      | 7,9 → 8,2 MB                                 | stables                                                      |
| Mémoire résidente (`rss`)         | 214,8 → 216,8 MB · pente +2,0 MB/h (R² 0,31) | **plate** — 0,4 MB d'écart, sous le bruit du ramasse-miettes |
| Descripteurs (sockets, minuteurs) | 5 → 5, aucun type en hausse                  | rien ne s'accumule                                           |
| Débit                             | 18 494 → 18 454 rps (**−0,2 %**)             | aucune érosion                                               |

Rapportée à la charge, la consommation vaut **0,021 MB par million de requêtes**, sur l'empreinte
comme sur `rss`. C'est la grandeur qui se transpose d'une machine à l'autre, contrairement aux MB/h,
qui suivent le débit.

**Pourquoi l'empreinte système d'abord.** Sous macOS, `process.memoryUsage().rss` rend
`resident_size`, qui **compte les pages que l'allocateur a déjà rendues au noyau** : elles restent
physiquement présentes tant qu'aucune pression mémoire ne les réclame, mais n'appartiennent plus au
processus. `phys_footprint` — le compteur que le noyau utilise pour décider d'évincer — les exclut :
c'est lui qui dit la consommation réelle. Sur Node 26.8, ces pages réutilisables gonflaient `rss` de
plus de 2 MB par million de requêtes, et ce dossier a publié pendant trois semaines une « rampe »
qui n'en était pas une. Sur Node 26.10, leur stock ne bouge plus et `rss` reste plat lui aussi ; la
raison de ce changement n'est pas établie, et elle est sans conséquence sur la consommation.

> ⚠️ **Ce run a tourné machine virtuelle allumée** (8 cœurs réservés), contrairement à la campagne
> de débit. Cela peut abaisser le débit absolu, pas fabriquer une fuite. Et **90 minutes ne
> prouvent pas trois jours** : ce banc élimine les fuites grossières, pas les lentes.

## Ce que ce dossier établit

| Question                                                 | Réponse mesurée                                                                                                                                     |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Nodefony tient-il la route face à Express et NestJS ?    | **Oui, à travail égal** : 93,6 à 112,7 % sur une route vide, 95,9 à 96,7 % sur un cycle applicatif — la même zone                                   |
| Le framework est-il le goulot d'une application réelle ? | **Aucune mesure ne l'a montré** — ~46 µs sur ~895 µs par requête dès qu'une base entre dans le budget                                               |
| Combien coûte le service rendu par requête ?             | ~5 % de débit pour Express quand on le lui fait rendre aussi                                                                                        |
| Quelle est la résolution du banc ?                       | **~3 %** — le même serveur mesuré contre lui-même ; un écart plus petit ne se publie pas                                                            |
| Le ramasse-miettes est-il le problème ?                  | **Rien ne l'indique** — même coût par requête que NestJS sur le cycle applicatif, moins de 1 % du CPU sur une route vide                            |
| Qu'est-ce qui plafonne un processus ?                    | Le **blocage** de la boucle — la latence seule n'a jamais suffi à l'expliquer                                                                       |
| Qu'est-ce qui plafonnait les mesures PostgreSQL ?        | La **virtualisation réseau**, pas la base — facteur 3,7                                                                                             |
| Un décor sale déplace-t-il seulement les absolus ?       | **Non — il a déplacé le rapport.** Une double instance de module dans le camp adverse : **+58,8 % de son débit sur SQLite, +83,4 % sur PostgreSQL** |
| **Le processus tient-il dans la durée ?**                | **Oui** — 88 min et 97,5 M de requêtes : tas, empreinte système et `rss` plats, 0,021 MB par million de requêtes                                    |

## Les trois pages

### [`index`](index.md) — les chiffres et ce qu'ils valent

Cette page. Les mesures de référence, leur décor, et les réserves qui les bornent.

### [`methode`](methode.md) — comment un chiffre devient une mesure

Ce qu'on mesure et pourquoi, le décor exact, les contrôles de validité, le protocole des paires
alternées et ses trois issues, le lexique. Elle porte aussi **les instruments qui ont menti** —
quatre sur une seule question, deux explications réfutées — et **les deux grandeurs qu'on
confond**, latence et blocage. **À lire avant tout le reste** si vous comptez rejouer une mesure
ou contester un chiffre.

### [`analyses`](analyses.md) — où part le temps

Le pipeline HTTP (profilage, lots livrés, un lot **rejeté par sa propre mesure**), la comparaison
aux autres frameworks à trois niveaux d'équité, l'escalier ORM, l'analyse initiale et ce qu'elle
avait faux, et **ce qui reste ouvert** — trous de mesure, pistes écartées avec leur condition de
réouverture.

## Rejouer une mesure

Tout ce qui suit est versionné dans `.claude/skills/nodefony-load-test/`.

```bash
# 0. Le décor AVANT tout : l'hyperviseur doit être éteint (0 = éteint)
docker info --format '{{.NCPU}}'

# 1. Toute la campagne publiée : parité des témoins, paires, base, CPU du fil, tenue
caffeinate -dims bash .claude/skills/nodefony-load-test/scripts/perf-campaign.sh --at 01:30

# 2. Une seule paire, en PAIRES ALTERNÉES — le seul protocole qui sépare deux camps
BENCH_CONN=64 BENCH_WARMUP=15 \
  bash .claude/skills/nodefony-load-test/bench-frameworks/bench-pairs.sh express-fair nodefony

# 3. Le cas applicatif : une lecture ET une écriture par requête, à ORM et pilote égaux
BENCH_PATH=/nodefony/test/bench-orm/read-write BENCH_EXPECT=lus \
  NF_BENCH_SQLITE_DB=/tmp/bench-express.db BENCH_CONN=25 BENCH_WARMUP=15 \
  bash .claude/skills/nodefony-load-test/bench-frameworks/bench-pairs.sh \
    express-fair-sqlite nodefony-orm 5167

# 4. Tenue dans la durée — une PENTE, jamais un delta début/fin
node .claude/skills/nodefony-load-test/scripts/soak.mjs --minutes 90 --window 60 --skip 3
```

Le banc **refuse de conclure** plutôt que de rendre un chiffre douteux : série au-delà de 3 % de
dispersion rejetée, séries qui se chevauchent déclarées « dans le bruit », et refus de mesurer si
les versions installées ne correspondent pas à celles déclarées.

## Pour aller plus loin

- 🧭 [Par où commencer](../demarrer.md) — les parcours guidés de la documentation
- 📚 [Toute la documentation](../index.md)
- 📐 [Méthode de mesure](methode.md) — le protocole et les instruments qui ont menti
- 🔬 [Où part le temps](analyses.md) — le budget d'une requête, décomposé
- 🧰 Outillage de mesure : `.claude/skills/nodefony-load-test/`
