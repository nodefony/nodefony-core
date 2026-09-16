---
title: "Performance — les chiffres, et ce qu'ils valent"
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

**Un framework ne coûte pas la même chose selon ce que l'application fait.** C'est la seule
manière lisible de présenter un écart, et c'est l'inverse de ce que fait un classement.

Sur une route qui ne fait **rien** — pas de base, pas de session, juste le trajet complet du
pipeline — le framework est **100 % du budget** de la requête. C'est le pire cas possible pour
Nodefony, et c'est celui que mesurent la plupart des comparatifs publiés :

| Camp               |   Débit médian | Écart inter-séries | Rapport / Express équipé |
| ------------------ | -------------: | -----------------: | -----------------------: |
| Express « équipé » | **16 098 rps** |              0,3 % |                    100 % |
| **Nodefony**       | **14 508 rps** |              1,3 % |               **90,1 %** |

> Séparation **nette** — les deux séries de chaque camp encadrent celles de l'autre, donc le
> classement tient. Sans cette séparation, un écart de médianes ne classerait rien.

Dès qu'une application fait le travail pour lequel elle existe — lire une base, l'écrire —, le
framework devient une **fraction** du budget : d'environ 61 µs sur ~970 µs, soit moins de 7 %.
C'est la mesure qui répond à « le framework sera-t-il mon goulot ? ».

**Le rapport entre camps, lui, ne bouge pas pour autant** — il reste autour de 90 % dans les deux
cas, et cette page l'énonce plus bas sans l'arrondir en sa faveur. Le framework pèse peu dans le
budget d'une requête réelle ; il n'en devient pas gratuit.

## Le décor, sans lequel ces chiffres ne valent rien

|                      |                                                                                |
| -------------------- | ------------------------------------------------------------------------------ |
| Processeur           | Intel Core i9-8950HK @ 2,90 GHz — 6 cœurs physiques, 12 logiques               |
| Mémoire              | 32 Go                                                                          |
| Système              | macOS 15.7.7 (Darwin 24.6)                                                     |
| **Node**             | **v26.8.1**                                                                    |
| Régime CPU           | secteur, mode basse consommation **désactivé** (`AC Power/lpm=0`)              |
| **Hyperviseur**      | **éteint** — aucune machine virtuelle ne réserve de cœur                       |
| Serveur              | mono-processus, `NODE_ENV=production`, boucle locale, journalisation coupée    |
| Générateur de charge | `wrk` 4.2.0, `-t4`, échauffement 15 s non compté, 3 runs, médiane              |
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

Deux repères utiles pour situer un absolu, mesurés dans la même fenêtre :

| Repère                     |      Débit | Ce qu'il dit                                         |
| -------------------------- | ---------: | ---------------------------------------------------- |
| `node:http` nu, 186 routes | 37 471 rps | le plafond de la machine pour ce payload             |
| Express « équipé »         | 16 456 rps | le prix du service rendu, quel que soit le framework |

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
| triviale (pipeline seul)   |         **~61 µs** | le framework, à 100 %       |
| lecture + écriture en base |      **~1 050 µs** | la **base**, à plus de 90 % |

**Un facteur 17.** C'est la mesure qui répond à la question « le framework est-il mon goulot ? » :
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
| runs de **30 s**                      | chaque requête écrit sur disque, et la journalisation de SQLite pose ses points de reprise à des instants imprévisibles. Un run court capte ce bruit ; on allonge la fenêtre plutôt que d'élargir le seuil de dispersion |

### Ce que le banc compare exactement

Les deux camps utilisent **le même ORM à la même version** et **le même pilote à la même
version** — la garde du banc refuse de mesurer si l'installé ne correspond pas au déclaré. Ils
rendent le **même résultat** (la ligne persistée). Ce qui diffère est la **couche d'accès** :

|                          | Camp témoin                       | Nodefony                                                                                       |
| ------------------------ | --------------------------------- | ---------------------------------------------------------------------------------------------- |
| ORM                      | drizzle, accédé **directement**   | drizzle, accédé **via le repository** d'`orm-core`                                             |
| Le `WHERE` de l'écriture | écrit par le développeur          | composé pour garantir « au plus une ligne » **portablement** entre SQLite, PostgreSQL et MySQL |
| SQL émis                 | `UPDATE … WHERE pk = ? RETURNING` | `UPDATE … WHERE pk IN (SELECT … LIMIT 1) RETURNING`                                            |

Ce que ce banc mesure n'est donc pas « un ORM contre du SQL écrit à la main », mais **le prix de
l'abstraction portable** : ce que coûte une API générique qui doit rendre le même contrat sur
trois dialectes.

Le rapport entre les deux camps, paire complète et séparation nette :

| Camp                         |  Débit médian | Écart inter-séries | Rapport / Express équipé |
| ---------------------------- | ------------: | -----------------: | -----------------------: |
| Express « équipé » + drizzle | **1 134 rps** |              3,3 % |                    100 % |
| **Nodefony** + `orm-core`    | **1 031 rps** |              0,2 % |               **90,9 %** |

**Quasiment le même rapport que sur une route qui ne fait rien** (90,1 %). Le coût du framework ne
se dilue donc pas dans le travail utile, contrairement à ce que ce dossier a d'abord annoncé : il
reste une part à peu près constante du budget.

> 🔬 **Une première campagne avait publié 145,9 %** — Nodefony devant. Ce renversement était un
> **défaut du banc**, pas un résultat : le camp témoin chargeait deux instances distinctes de
> `drizzle-orm`, ce qui privait son contrôle de type interne de son chemin rapide sur chaque
> colonne de chaque ligne. Corrigé, ce camp gagne **+58,8 %** ; le camp Nodefony, lui, n'a pas
> bougé. Le mécanisme, sa mesure et la garde qui l'empêche de revenir sont dans
> [`analyses`](analyses.md#le-banc-sqlite--et-ce-quun-banc-peut-mesurer-à-la-place-dun-framework).

> ⚠️ **Ce banc n'est pas encore reproductible par un tiers** : son corpus est généré localement et
> n'est pas versionné (schéma issu d'un logiciel sous licence GPLv3). C'est le défaut même que
> cette version corrige pour les autres chiffres, et il est ouvert pour celui-ci.

## La tenue dans la durée — et le compteur qu'il ne faut pas lire

Un banc de dix secondes ne voit pas une fuite lente. Celui-ci a tourné **90 minutes** sous trafic
continu, dans le décor de cette campagne (hyperviseur éteint, Node v26.8.1), pour 62,9 millions de
requêtes servies. Le processus n'accumule rien.

| Grandeur                          | Mesure                                         | Lecture                               |
| --------------------------------- | ---------------------------------------------- | ------------------------------------- |
| Tas JS (`heapUsed`)               | 44,2 → 45,7 MB · pente +0,6 MB/h (R² 0,39)     | **plat** — aucune fuite JS            |
| **Empreinte système** (macOS)     | **164 → 164 MB** · pente +5,1 MB/h (R² 0,49)   | **plate** — rien n'est retenu         |
| dont pages **réutilisables**      | 33 → 76 MB · +73,6 MB/h (R² 0,97)              | **93 % de ce que `rss` affiche**      |
| Mémoire résidente (`rss`)         | 242,1 → 407,1 MB · +108,6 MB/h                 | ⚠️ **compte les pages réutilisables** |
| Blocs natifs injoignables         | 37 blocs, **3 216 octets** sur 20,7 M requêtes | rien                                  |
| Descripteurs (sockets, minuteurs) | 5 → 5, aucun type en hausse                    | rien ne s'accumule                    |
| Empreinte système (Linux)         | 23,6 M requêtes → **+1,5 MB** (R² 0,28)        | **plate** — aucune tendance           |

**Pourquoi deux chiffres pour une seule mémoire.** Sous macOS, `process.memoryUsage().rss` rend
`resident_size`, qui **compte les pages que l'allocateur a déjà rendues au noyau** par
`MADV_FREE_REUSABLE` : elles restent physiquement présentes tant qu'aucune pression mémoire ne les
réclame, mais elles n'appartiennent plus au processus. `phys_footprint` — le compteur que le noyau
utilise pour décider d'évincer — les exclut. C'est lui qui dit la consommation réelle, et il ne
bouge pas.

La ventilation le nomme sans ambiguïté : la hausse tient entièrement dans la colonne
_Reclaimable_ de la zone `MALLOC_MEDIUM`, pendant que la mémoire sale de l'allocateur reste fixe à
40 MB et que toutes les autres zones sont plates.

Rapportée à la charge, la consommation réelle vaut **0,12 MB par million de requêtes** sous macOS
et **0,06 sous Linux** — c'est la grandeur qui se transpose d'une machine à l'autre, contrairement
aux MB/h, qui suivent le débit.

> 🔬 **Ce dossier a publié l'inverse pendant trois semaines, et le dit.** Le banc ne relevait que
> `rss` : il a conclu à une rampe de +108,6 MB/h « sans plateau », un ticket P0 a été ouvert
> dessus, et la mesure qui tranche — l'empreinte du noyau — n'avait jamais été prise. Elle l'est
> désormais à chaque fenêtre, et c'est elle qui fonde le verdict ; `rss` reste publié à côté, parce
> que l'écart entre les deux est lui-même une information.
>
> Ce qui reste hors de portée de ce banc : le comportement au-delà de 90 minutes, et la raison pour
> laquelle le stock de pages réutilisables varie d'une version de Node à l'autre — sans effet sur
> la consommation, donc sans conséquence connue.

## Ce que ce dossier établit

| Question                                                 | Réponse mesurée                                                                                                                                                                                                                                                                      |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Le framework est-il le goulot d'une application réelle ? | **Aucune mesure ne l'a montré** — sa couche ORM est restée sous 2,5 % du CPU d'une route de lecture                                                                                                                                                                                  |
| Combien coûte le service rendu par requête ?             | −19,5 % de débit pour Express quand on le lui fait rendre aussi                                                                                                                                                                                                                      |
| L'écart avec Express sur une route qui ne fait rien ?    | **×1,11** — et il reste le même sur une route qui interroge une base                                                                                                                                                                                                                 |
| Le ramasse-miettes est-il le problème ?                  | **Rien ne l'indique** — 0,93 à 1,3 % selon l'instrument, sur trois mesures concordantes                                                                                                                                                                                              |
| Qu'est-ce qui plafonne un processus ?                    | Le **blocage** de la boucle — la latence seule n'a jamais suffi à l'expliquer                                                                                                                                                                                                        |
| Qu'est-ce qui plafonnait les mesures PostgreSQL ?        | La **virtualisation réseau**, pas la base — facteur 3,7                                                                                                                                                                                                                              |
| Un décor sale déplace-t-il seulement les absolus ?       | **Non — il a déplacé le rapport.** Un décor sale : 1,5 point. Une double instance de module dans le camp adverse : **+58,8 % de son débit sur SQLite, +83,4 % sur PostgreSQL**                                                                                                       |
| **Le processus tient-il dans la durée ?**                | **Oui** — 90 min de charge laissent le tas plat (44,2 → 45,7 MB) ET l'empreinte système plate (164 → 164 MB). Le `rss` monte, mais **93 % de sa hausse est du résident déjà rendu au noyau** ; `leaks` ne trouve que 3 Ko sur 20,7 M de requêtes, et Linux ne montre aucune tendance |

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

# 1. Comparatif en PAIRES ALTERNÉES — le seul protocole qui classe deux camps
BENCH_CONN=64 BENCH_WARMUP=15 \
  bash .claude/skills/nodefony-load-test/bench-frameworks/bench-pairs.sh express-fair nodefony

# 2. Le cas applicatif : une lecture ET une écriture par requête, à ORM et pilote égaux
BENCH_PATH=/nodefony/test/bench-orm/read-write BENCH_EXPECT=lus \
  NF_BENCH_SQLITE_DB=/tmp/bench-express.db BENCH_CONN=25 BENCH_WARMUP=15 \
  bash .claude/skills/nodefony-load-test/bench-frameworks/bench-pairs.sh \
    express-fair-sqlite nodefony-orm 5167

# 3. Tenue dans la durée — une PENTE, jamais un delta début/fin
node .claude/skills/nodefony-load-test/scripts/soak.mjs --minutes 90 --window 60 --skip 3
```

Le banc **refuse de conclure** plutôt que de rendre un chiffre douteux : série au-delà de 3 % de
dispersion rejetée, séries qui se chevauchent déclarées « dans le bruit », et refus de mesurer si
les versions installées ne correspondent pas à celles déclarées.

## Pour aller plus loin

- 📚 [Toute la documentation](../index.md)
- 📐 [Méthode de mesure](methode.md) — le protocole et les instruments qui ont menti
- 🔬 [Où part le temps](analyses.md) — le budget d'une requête, décomposé
- 🧰 Outillage de mesure : `.claude/skills/nodefony-load-test/`
