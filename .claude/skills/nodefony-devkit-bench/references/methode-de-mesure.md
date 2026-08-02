# Méthode de mesure — ce que le banc devkit a appris sur lui-même

> Trois résultats mesurés sur le banc de découvrabilité, valables pour les trois bancs : la
> variance d'un run unique écrase tout écart qu'on voudrait lui attribuer, le modèle par
> défaut choisi conditionne si le banc peut seulement VOIR un trou, et un générateur livré
> abaisse le poids de modèle nécessaire pour développer avec le framework. Renvoyé depuis le
> `SKILL.md` § « Les deux buts ».
>
> **Maintenance** : édition en place. Les chiffres cités sont des mesures ; s'ils se périment,
> les remesurer et remplacer en place, pas les annoter d'une date.

## Table des matières

- [La variance ÉCRASE l'écart d'un run à l'autre](#-la-variance-écrase-lécart-dun-run-à-lautre--mesuré-pas-supposé)
- [Le modèle par défaut n'est pas un réglage](#-le-modèle-par-défaut-nest-pas-un-réglage--cest-ce-qui-rend-le-banc-capable-de-voir)
- [Ce que le banc mesure sans le dire : un générateur ABAISSE le modèle nécessaire](#-ce-que-le-banc-mesure-sans-le-dire--un-générateur-abaisse-le-modèle-nécessaire)

### 🔴 La variance ÉCRASE l'écart d'un run à l'autre — mesuré, pas supposé

Quatre runs de la tâche 14, **gabarit identique, même modèle, même décor** — seul
le hasard du modèle change :

| Run | Verdict  | Façade employée | Tours | Durée |   Coût |
| --- | -------- | --------------- | ----: | ----: | -----: |
| a   | PASS     | ✅              |    74 | 471 s | 0,72 $ |
| b   | **FAIL** | ✅              |    86 | 575 s | 0,94 $ |
| c   | **FAIL** | ✅              |    98 | 850 s | 1,27 $ |
| d   | PASS     | ✅              |    68 | 409 s | 0,64 $ |

Deux conclusions, et elles commandent toute lecture de ce banc :

- **Le verdict d'un run unique ne conclut pas.** Deux PASS et deux FAIL pour le
  même gabarit. Déclarer une correction « prouvée » sur un seul PASS est une
  erreur — elle a été commise ici.
- **Les tours varient de 68 à 98, soit ±20 % autour de ~80.** Un écart de l'ordre
  de 25 tours entre deux runs isolés est donc du BRUIT. Toute mesure d'effort qui
  prétend comparer deux états du devkit doit être une **médiane de ≥ 3 runs** ;
  celle qui répondra un jour à « un plus gros modèle tourne-t-il moins en rond ? »
  aussi.

**Ce qui reste lisible sur un seul run, c'est la sonde de CONTENU** — ici, « une
façade de flux est-elle employée ? » : verte 4 fois sur 4 après la remontée des
façades en tête de l'`AGENTS.md`, contre 0 sur 1 avant. Binaire, sans seuil, sans
dépendance à l'humeur du modèle. La leçon tient donc toujours — **une information
placée là où l'agent regarde déjà supprime les tours de recherche** — mais c'est
la sonde qui la prouve, pas le compteur de tours.

### 🔴 Le modèle par défaut n'est pas un réglage : c'est ce qui rend le banc capable de VOIR

Le banc tourne sur le modèle le plus **défavorable** de la famille. Longtemps un
principe raisonnable ; c'est désormais un résultat mesuré, et il commande le
réglage.

Deux séries de 3 runs, décor isolé identique, sur la tâche 14 :

| État du gabarit          | Modèle léger                   | Modèle fort                        |
| ------------------------ | ------------------------------ | ---------------------------------- |
| façades en **tête**      | 4/4 sonde façade, 2/4 PASS     | 3/3 PASS, toutes sondes vertes     |
| façades en **ligne 142** | **0/1 sonde façade** (le trou) | **3/3 PASS, toutes sondes vertes** |

Le modèle fort franchit **indifféremment** les deux états — parce qu'il **ouvre la
doc du controller** (6 runs sur 6) là où le léger ne l'ouvre jamais (0 sur 4). Il
ne dépend pas de l'`AGENTS.md` : il a un autre chemin vers la réponse.

**Conséquence directe : un banc joué en modèle fort aurait déclaré l'app saine, et
le trou n'aurait jamais été corrigé.** Monter le modèle par défaut, c'est éteindre
l'instrument.

### ⭐ Ce que le banc mesure sans le dire : un générateur ABAISSE le modèle nécessaire

En comparant une tâche **à générateur** (T1, « CRUD produit ») et une tâche de
**socle** (T14, sans générateur), sur les deux poids de modèle :

| Tâche               | Modèle léger                                      | Modèle fort                        | Écart                            |
| ------------------- | ------------------------------------------------- | ---------------------------------- | -------------------------------- |
| **T1** — générateur | **32** tours · **0,29 $** · 3/3 PASS · 6/6 sondes | 26 tours · 0,87 $ · 3/3 PASS · 6/6 | **nul** — coût ×3 pour rien      |
| **T14** — socle     | 80 tours · 0,83 $ · **2/4 PASS**                  | 71 tours · 2,98 $ · 3/3 PASS       | le léger échoue **1 fois sur 2** |

Les 80 tours de T14 ne mesuraient pas la faiblesse du petit modèle : ils mesuraient
**l'absence de générateur**. Chaque générateur livré déplace le travail du modèle
vers l'outil — et abaisse donc le poids de modèle nécessaire pour développer avec
le framework. C'est une propriété du produit, pas une statistique de banc, et elle
se re-mesure exactement de cette façon : même tâche, deux poids, médiane de 3.

Corollaire pour l'interprétation : un chiffre de tours qui monte est un signal à
**instruire**, jamais une conclusion à publier.
