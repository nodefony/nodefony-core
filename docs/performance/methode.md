---
title: "Méthode de mesure — comment un chiffre devient une mesure"
navTitle: Méthode de mesure
updated: 2026-11-16
lang: fr
module: "global"
topic: perf-methode
section: "Performance"
audience: [developer]
tags: [performance, protocole, banc, décor, instruments, validité]
status: stable
source: ".claude/skills/nodefony-load-test/"
tests: none
---

📍 [Documentation](../index.md) › [Performance](index.md) › **Méthode de mesure**

> Cette page dit comment les chiffres du dossier ont été obtenus, et pourquoi on peut les
> opposer à Nodefony. Elle porte aussi la liste des instruments qui ont menti avant qu'on s'en
> aperçoive : sur ce dossier, les verdicts faux sont venus plus souvent du banc que du code.

## Ce qu'on mesure

Nodefony est un framework de **runtime**. Ce qui compte n'est pas un record, c'est le **travail
effectué par requête** : objets construits, appels système, microsecondes de CPU pour rendre une
réponse. Le débit n'est qu'une façon commode de lire ce travail à l'envers. Trois choix en
découlent.

**Un seul processus.** Un serveur mono-processus sous charge est borné par le CPU : sa boucle
d'événements est occupée en permanence, dans tous les camps. Son débit reflète donc directement
le coût par requête ; un cluster mesurerait la co-location du générateur de charge et des
workers.

**La même route chez tous.** La route triviale (`/nodefony/test/als-test/state`) est répliquée
par chaque camp ; la route applicative (`bench-orm`) aussi, sur le même schéma et le même ORM.
On ne substitue jamais une route « équivalente » : une route d'un module de développement
n'existe pas en production, et un 404 répond plus vite qu'une vraie réponse.

**Des rapports, pas des absolus.** Le générateur de charge tourne sur la même machine que le
serveur : les absolus sont bas pour tous. Seuls les rapports pris dans la même fenêtre valent.

## Le décor

| Élément              | Valeur                                                                  |
| -------------------- | ----------------------------------------------------------------------- |
| Machine              | MacBook Pro 2018 — Intel Core i9-8950HK, 6 cœurs physiques, 12 logiques |
| Mémoire, système     | 32 Go, macOS 15 (Darwin 24.6)                                           |
| Node                 | 26.13.1                                                                 |
| Serveur              | mono-processus, `NODE_ENV=production`, journalisation coupée            |
| Générateur de charge | `wrk` 4.2.0, 4 fils, sur la même machine                                |
| Route triviale       | 64 connexions, échauffement 20 s, 3 tirs de 10 s par série              |
| Route applicative    | 25 connexions, échauffement 40 s, 3 tirs de 60 s par série              |

> **Un portable de 2018, sujet au bridage thermique.** C'est un défaut pour publier des absolus,
> et un avantage pour concevoir un protocole : chaque piège de mesure s'y manifeste avec une
> amplitude qu'une machine de salle serveur masquerait. Plusieurs gardes décrites plus bas
> n'existent que parce que cette machine les a rendues nécessaires.

## La règle qui précède toutes les autres

> **Un banc qui ne vérifie pas que le travail a eu lieu mesure la vitesse à laquelle on échoue.**

Un banc de ce dépôt a annoncé 1 626 requêtes par seconde **sur un port fermé**. Une erreur revient
plus vite qu'une vraie réponse : échouer améliore le score. Tout banc doit donc prouver la cible
avant de mesurer (statut, corps attendu), prouver le travail pendant (réponses hors 2xx comptées),
ne compter que le succès, refuser de conclure sous la variance, et sortir en erreur quand rien n'a
été mesuré. Un contrôle de cible qui échoue **arrête** la série : une campagne a mesuré des
milliers de `401` par run parce qu'un cookie avait expiré et que la ligne « cible : 401 »
s'affichait sans rien interrompre.

## Comparer deux camps

**La parité d'abord.** `fair-parity.mjs` interroge Nodefony et chaque témoin avec la même matrice
de requêtes — sans en-tête, `traceparent` valide et invalide, origine connue et inconnue, pré-vol
CORS, POST inter-sites, zone protégée, route inconnue, `HEAD`, corps valide et invalide — et
compare statut, en-têtes, forme des valeurs dynamiques, type de média et forme du corps. Un
témoin qui renverrait une erreur plus courte sérialiserait moins ; la campagne s'arrête si un seul
témoin ne passe plus.

**L'alternance ensuite.** Les deux camps se mesurent en paires alternées — A₁ B₁ A₂ B₂ — pour que
la dérive de la machine porte également sur les deux. Une série dont les trois tirs dispersent
au-delà de 3 % est **refusée**, et la paire avec elle : un seuil ne tranche pas dans une fenêtre
plus bruyante que lui.

**Trois verdicts, jamais deux.**

| Verdict          | Condition                                                      | Ce qu'on en fait                    |
| ---------------- | -------------------------------------------------------------- | ----------------------------------- |
| séparation nette | les deux séries d'un camp au-dessus des deux séries de l'autre | le rapport est publié               |
| dans le bruit    | les nuages se chevauchent                                      | publié comme tel, il ne classe rien |
| inconclusif      | une série refusée pour dispersion, après trois essais          | **rien n'est publié**               |

**Le test nul.** Le même camp contre lui-même, dans le même protocole, doit rendre « dans le
bruit ». Il a rendu 97,7 % sur la route triviale — séparé, mais sous la résolution que le banc
se donne, donc sans rien classer — et 100 % avec la base : un écart de 2 à 3 % entre deux camps
ne se lit pas sur cette machine.

**Les versions.** Le banc refuse de mesurer si les paquets installés ne sont pas ceux que le
dossier des témoins déclare : 29 % d'écart ont déjà été mesurés entre deux versions mineures de
Fastify, imputés à tort à la machine. Les versions publiées sont relevées dans ce qui est servi.

## Ce que voit chaque instrument

| Question                          | Instrument                          | Résolution, et ce qu'il ne voit pas                                                    |
| --------------------------------- | ----------------------------------- | -------------------------------------------------------------------------------------- |
| lequel rend le plus de requêtes ? | `bench-pairs.sh` (wrk, alterné)     | ~3 % ; agrège noyau, autres fils et machine                                            |
| quel écart fin, au fil qui sert ? | `wait-compare.sh` (CPU du fil)      | < 1 % ; ne garde que le travail imposé au fil principal                                |
| où, étage par étage ?             | `wait-compare.sh` + `cut-probe.mjs` | bornes solides ; une coupe intermédiaire change ce que V8 compile                      |
| quelles fonctions ?               | `profile-compare.sh` (profil V8)    | désigne, ne pèse pas : sur-attribue jusqu'à ×15 à ×30 face au coût réel                |
| est-ce que ça tient ?             | `soak.mjs` (pente sur 90 min)       | pente au tas, à l'empreinte système et aux ressources ouvertes ; pas les fuites lentes |
| combien de pods ?                 | `capacity.mjs` (production)         | constantes d'un pod ; son débit HTTP ne se compare pas aux paires (client Node)        |

Tout pourcentage de profil se convertit en microsecondes par une expérience **avant** d'ouvrir un
chantier : l'écart entre attribution et coût réel a déjà été mesuré à un facteur 25 à 30.

## La qualité des séries publiées

<!-- figure: qualite -->

Chaque case est la dispersion d'une série publiée, entre son tir le plus lent et le plus rapide.
Au-delà de 3 %, la série aurait été refusée et la paire avec elle.

## Le décor ment plus souvent que le code

Chaque garde du banc est née d'un verdict faux. Les principales :

| Ce qui a menti                          | Ce que ça a coûté                                                                    | Garde                                         |
| --------------------------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------- |
| mode économie d'énergie sur batterie    | **×1,62** à code identique, avec des dispersions parfaites des deux côtés            | régime CPU relevé à chaque série              |
| la chaleur                              | un verdict **inversé** entre un run froid et un run chaud                            | niveau thermique avant et après               |
| l'indexation système                    | 11 à 22 % de CPU par vagues, invisibles                                              | Spotlight constaté avant la série             |
| un hyperviseur qui garde ses cœurs      | le **rapport** entre deux camps déplacé (89,8 → 88,3 %), conteneurs pourtant arrêtés | hyperviseur constaté, pas déduit              |
| une locale française                    | « 4,1 » lu comme 41 par une garde numérique muette                                   | `LC_ALL=C`                                    |
| un processus tué, son générateur vivant | un `wrk` orphelin à 308 % de CPU                                                     | on tue un arbre et on constate sa mort        |
| deux instances de l'ORM dans le témoin  | le témoin ralenti de **58,8 %** : Nodefony publié à 146 % au lieu de 90,9 %          | garde d'identité de l'ORM dans chaque camp    |
| un témoin qui travaillait moins         | ETag haché, CSP sans nonce, CORS `*` : un écart qui ne comparait pas le même travail | parité observable avant chaque campagne       |
| un run préempté par un autre processus  | un écart gonflé, invisible aux gardes thermique et d'indexation                      | changements de contexte involontaires comptés |

Et cinq instruments faux sur une seule question — « un pilote de base de données bloque-t-il la
boucle ? » : un minuteur qui mesurait sa propre granularité (×13), `monitorEventLoopDelay` aveugle
sous la milliseconde, une colonne qui répondait sans avoir mesuré, `process.cpuUsage()` qui
compte tous les fils, et le profil V8 pris pour un arbitre. Ce qui a tranché : armer un rappel
**juste avant** la requête et regarder quand il part. SQLite (synchrone) le retarde de toute la
durée de la requête ; PostgreSQL ne le retarde pas.

> Une paire refusée ne se rattrape pas. Sur la route triviale face à Express équipé, machine
> froide, trois essais ont été nécessaires : un tir isolé décroché a fait refuser une série
> d'Express au premier, une série de Nodefony au deuxième ; le troisième a conclu « dans le
> bruit » (100,3 %). Garder les séries survivantes aurait publié un écart de quelques pourcents
> dans un sens ou dans l'autre — selon l'essai.

## Rejouer

```bash
# la campagne complète, de nuit
# (parité, paires, base, étages, profil, CPU du fil, capacité, binaire, tenue)
caffeinate -dims bash .claude/skills/nodefony-load-test/scripts/perf-campaign.sh --at 01:30
# une paire à la main
BENCH_CONN=64 BENCH_WARMUP=20 \
  bash .claude/skills/nodefony-load-test/bench-frameworks/bench-pairs.sh nest-fair-node nodefony
# la parité d'un témoin face au serveur de production
CAMP=nest-fair-node CAMP_URL=http://127.0.0.1:5170 \
  node .claude/skills/nodefony-load-test/bench-frameworks/fair-parity.mjs
```

## Lexique

| Terme                 | Sens ici                                                                                |
| --------------------- | --------------------------------------------------------------------------------------- |
| **dispersion**        | écart entre le tir le plus lent et le plus rapide d'une série ; au-delà de 3 %, refusée |
| **séparation nette**  | les deux séries d'un camp au-dessus des deux séries de l'autre                          |
| **dans le bruit**     | les nuages se chevauchent : le rapport s'affiche, il ne classe rien                     |
| **test nul**          | un camp contre lui-même, dans le même protocole — il mesure la résolution du banc       |
| **parité observable** | même statut, mêmes en-têtes, même forme de corps, vérifiés avant de mesurer             |
| **ELU**               | part du temps où la boucle d'événements travaille ; ~1 = processeur saturé              |
| **empreinte système** | la mémoire que le noyau compte pour évincer un processus (`phys_footprint`, `VmRSS`)    |

## Pièges

- **Un échec répond plus vite qu'un succès** : sans contrôle de cible, un port fermé « fait »
  1 626 req/s.
- **Une série parfaite peut être fausse** : en mode économie d'énergie, les dispersions étaient
  sous 2 % — à 62 % de la vitesse réelle.
- **Garder les séries survivantes d'une paire refusée** publie un écart choisi par le hasard.
- **Deux instances d'une même bibliothèque** dans un camp le ralentissent sans erreur : contrôler
  une identité, pas seulement une version.
- **`rss` sous macOS compte les pages déjà rendues au noyau** : juger une fuite sur l'empreinte
  système, jamais sur `rss` seul.

## Pour aller plus loin

- ⬆️ **Retour au hub** : [Performance](index.md)
- 🔬 [Où part le temps](analyses.md) — ce que ce protocole a permis d'établir
- 🗂️ [Les données versionnées](data/README.md) — composer le fichier publié depuis une campagne
- 🧰 Le protocole complet des bancs : skill `nodefony-load-test`
