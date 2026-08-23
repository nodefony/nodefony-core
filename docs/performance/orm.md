---
title: "ORM et bases de données — où partent réellement les microsecondes"
lang: fr
module: "global"
topic: perf-orm
coverageModule: drizzle
section: "Performance"
audience: [developer]
tags: [performance, orm, drizzle, sqlite, postgresql, mysql, prepared-statement]
status: stable
updated: "2026-08-24"
source: "src/packages/@nodefony/drizzle, src/packages/@nodefony/orm-core"
tests: none
---

📍 [Documentation](../index.md) › [Performance](index.md) › **ORM et bases de données**

> Le pipeline HTTP coûte 86 microsecondes. Une lecture de vingt lignes en coûte 936. Autrement
> dit : dans une vraie application, **le framework n'est pas le sujet**. Cette page décompose une
> requête complète marche par marche, désigne le goulot par le profilage, et raconte le lot qui a
> rendu entre 59 et 96 % de débit selon la route et le moteur — sans toucher une ligne du pipeline.

## Le modèle — un escalier, pas un chiffre

Comparer « une route ORM » à « une route nue » ne dit rien : trop de choses changent d'un coup.
La méthode retenue est un **escalier** — une suite de routes qui n'ajoutent qu'**une** chose
chacune, mesurées dans la même fenêtre, avec le même protocole. La différence entre deux marches
est le coût de ce qu'on vient d'ajouter.

Médianes de trois runs, dispersion inférieure à 3 %, magasin SQLite sauf mention contraire :

| Route                                | Ce que la marche ajoute           |    RPS | µs/req | Dispersion |
| ------------------------------------ | --------------------------------- | -----: | -----: | ---------: |
| Cible de banc (contrôle)             | pipeline nu                       | 11 580 |     86 |      1,9 % |
| Reprise de session — magasin mémoire | session en mémoire                |  9 664 |    103 |      1,7 % |
| Reprise de session — SQLite          | session via l'ORM                 |  2 350 |    426 |      1,5 % |
| Écriture d'une facture               | INSERT avec deux clés étrangères  |  1 329 |    752 |      1,4 % |
| Lecture allégée                      | `find()` 20 lignes, réponse `{n}` |  1 068 |    936 |      2,5 % |
| Lecture complète                     | `find()` 20 lignes + JSON complet |  1 022 |    978 |      3,0 % |
| Cycle utilisateur — magasin mémoire  | session mémoire + lecture         |    983 |  1 017 |      0,6 % |
| Cycle utilisateur — SQLite           | session ORM + lecture             |    719 |  1 391 |      1,3 % |

Par soustraction :

| Poste                              |   Coût | Calcul                             |
| ---------------------------------- | -----: | ---------------------------------- |
| Pipeline nu                        |  86 µs | contrôle                           |
| Cycle de session **hors** ORM      |  17 µs | session mémoire − contrôle         |
| Reprise de session — part ORM      | 322 µs | session SQLite − session mémoire   |
| `find()` de 20 lignes via le dépôt | 850 µs | lecture allégée − contrôle         |
| Sérialisation JSON des 20 lignes   |  43 µs | lecture complète − lecture allégée |
| INSERT via le dépôt                | 666 µs | écriture − contrôle                |

**L'additivité a été vérifiée** : 979 + 322 + ~90 de zone = 1 391 µs, ce que rend effectivement la
marche complète. Un escalier dont les marches ne s'additionnent pas mesure autre chose que ce
qu'il prétend.

## Le profilage — la couche Nodefony est innocente

Profil échantillonné fenêtré sur trente secondes de charge, attribution par couche :

<!-- prettier-ignore -->
| Couche | % du CPU |
| --- | ---: |
| `drizzle-orm` — construction de la requête | **39,0** |
| pilote `drizzle` → `better-sqlite3` (préparation 9,4 + exécution 17,2) | **27,0** |
| Node interne | 5,5 |
| V8 (anonyme / natif) | 5,1 |
| `@nodefony/framework` | 4,8 |
| repos | 4,6 |
| `@nodefony/http` | 3,6 |
| V8 (programme / natif) | 3,1 |
| cœur `nodefony` | 2,9 |
| divers | 1,5 |
| ramasse-miettes V8 | 1,1 |
| `@nodefony/orm-core` | **0,9** |
| `@nodefony/security` + module de test + adaptateur | **0,8** |

**La couche d'abstraction ORM de Nodefony pèse moins de 2,5 % du CPU.** Ce n'est pas une bonne
nouvelle qu'on s'accorde : c'est un résultat qui **ferme** une piste. Optimiser l'adaptateur
n'aurait rien rendu.

Le détail par fonction désigne le vrai coupable :

| Fonction                              | Où                                      |    % |
| ------------------------------------- | --------------------------------------- | ---: |
| `is`                                  | `drizzle-orm/entity.js`                 | 17,8 |
| `values` (exécution + parcours natif) | `drizzle-orm/better-sqlite3/session.js` | 17,2 |
| `prepare`                             | `better-sqlite3/methods/wrappers.js`    |  9,4 |
| fonction anonyme                      | `drizzle-orm/utils.js`                  |  8,1 |
| `orderSelectedFields`                 | `drizzle-orm/utils.js`                  |  3,1 |
| rendu JSON du contrôleur              | `@nodefony/framework`                   |  2,8 |
| `writev` (écriture de la réponse)     | natif                                   |  2,0 |
| filtre `where` de l'adaptateur        | `@nodefony/drizzle`                     |  0,4 |

Le diagnostic tient en une phrase : **l'ORM refabrique et re-prépare la requête à chaque requête
HTTP**. La construction représente 39 % du CPU, la préparation 9,4 % — et l'exécution réelle, le
parcours de la base, seulement 17 %. On passe deux fois plus de temps à _décrire_ la requête qu'à
la _faire_.

## Le lot livré — mémoïser la requête préparée

### Le principe

Le dépôt calcule une **empreinte de forme** pour chaque requête : quels champs sont filtrés,
lesquels sont comparés à `null`, quel ordre de tri, y a-t-il une limite, un décalage. Cette forme
— et non les valeurs — sert de clé de cache. À la première occurrence, la requête est construite
puis **préparée une seule fois**. Ensuite, seules les valeurs sont re-liées à chaque exécution.

**Ce que ce cache ne fait pas**, et il faut le dire d'emblée parce que le mot « cache » inquiète à
raison : il ne mémorise **aucune donnée**. Il mémorise la **forme de la requête**. Les valeurs sont
re-liées à chaque appel, la base est interrogée à chaque appel, et les résultats sont toujours
lus depuis la base. Un test anti-obsolescence garde ce contrat et a été vu rouge en le débranchant.

Le chemin classique est conservé comme repli : disjonctions, opérateurs riches, valeurs
indéfinies, transactions. Le nombre de formes mémorisées est plafonné par dépôt.

### Le piège qui a coûté une session

`eq(colonne, sql.placeholder())` **nu court-circuite la conversion des valeurs vers le pilote** :
la fonction de liaison de drizzle exclut explicitement les emplacements réservés. Conséquence, un
tableau JSON était passé **brut** au pilote, qui levait une erreur de plage — vu rouge en test.

La forme correcte force la branche encodée. Ce contrat n'est écrit nulle part dans la
documentation officielle : il a été trouvé en lisant le **source de la bibliothèque** dans
`node_modules`, méthode par méthode, sur exigence explicite. La même lecture a rendu une seconde
découverte, qui change une conclusion (voir le tableau des dialectes ci-dessous).

### Ce que le lot rend, par moteur

Mesures A/B, paires alternées, protocole complet. **Ces chiffres valident le lot ; ils ne sont pas
une mesure de la performance actuelle du framework** — pour ça, voir l'état livré ci-dessous.

| Route                        | SQLite avant | SQLite après |  Gain | PostgreSQL avant | PostgreSQL après |  Gain |
| ---------------------------- | -----------: | -----------: | ----: | ---------------: | ---------------: | ----: |
| Lecture allégée              |        1 083 |        2 019 | +86 % |            1 017 |            1 640 | +61 % |
| Session + lecture (connecté) |          773 |        1 516 | +96 % |              642 |            1 021 | +59 % |

Détail des séries PostgreSQL, pour montrer la dispersion réelle :

| Route             | État  | Médianes de séries                                    | Retenu |
| ----------------- | ----- | ----------------------------------------------------- | -----: |
| Lecture allégée   | avant | 1 005,7 · 1 016,7 · 1 019,3 (étendue 1,3 %)           |  1 017 |
| Lecture allégée   | après | 1 655,0 · 1 639,0 · 1 625,6 · 1 640,6 (étendue 1,8 %) |  1 641 |
| Session + lecture | avant | 638,2 · 647,0 (étendue 1,4 %)                         |    647 |
| Session + lecture | après | 1 020,8 · 926,4 · 1 032,2 (étendue 10,4 %)            |  1 021 |

Aucun chevauchement entre avant et après, sur dix séries.

### Une attribution fausse, corrigée

Il était tentant d'expliquer le gain PostgreSQL par le **planificateur du serveur** : une requête
nommée est planifiée une fois, donc le serveur travaille moins. **C'est faux, et la mesure le
dit** : `pgbench` en mode simple contre le même en mode préparé ne rend que **+3,3 %**.

Le gain est **côté client**. Il était d'ailleurs déjà dans le profil, lu avant l'A/B :
construction 39 % + préparation 9,4 % du CPU JavaScript. L'explication par le planificateur a été
inventée en cours de session, puis retirée. Elle n'est pas republiée ici.

### Ce que « préparé » veut dire, dialecte par dialecte

Trois moteurs, trois mécanismes réellement différents — et le troisième contredit ce que
l'intuition suggère :

| Moteur         | Ce qui se passe réellement                                                           | Nature du gain            |
| -------------- | ------------------------------------------------------------------------------------ | ------------------------- |
| **SQLite**     | Instruction native compilée une fois, réutilisée                                     | compilation + JavaScript  |
| **PostgreSQL** | Requête **nommée** ; le plan est mis en cache **par connexion** du pool              | JavaScript, surtout       |
| **MySQL**      | Le pilote passe par `client.query()` — **aucune préparation au niveau du protocole** | **JavaScript uniquement** |

La conséquence pratique pour PostgreSQL : les requêtes nommées se compilent **par connexion**.
Le premier run d'une série est donc toujours le plus bas, et un échauffement de trente secondes
est obligatoire avant de mesurer. Ne jamais lire le premier run seul.

### Ce qui garde le lot

| Gate                              | Résultat                                        |
| --------------------------------- | ----------------------------------------------- |
| Suite du module ORM               | 425 tests verts                                 |
| Test dédié aux requêtes préparées | 11 cas — dont **4 vus rouges** au débranchement |
| Test anti-obsolescence            | vu rouge au débranchement                       |
| Intégration HTTP                  | 619 verts                                       |
| Porte mémoire                     | 9/9                                             |
| Vérification de types             | 0 erreur                                        |

Le test dédié espionne la méthode de préparation du pilote et **compte les compilations** : c'est
la seule façon de prouver qu'un cache **opère**, plutôt que de constater qu'il ne casse rien.

## Ce qui plafonne une route ORM

En rapprochant cette page de [la boucle d'événements](boucle-evenements.md), le budget d'une
lecture PostgreSQL se décompose ainsi : 607 µs par requête, dont **~194 µs de pilote** — le coût
d'écrire et d'analyser le protocole sur le fil applicatif — et le reste en attente, qui ne coûte
rien tant qu'il y a d'autres requêtes à servir.

Autrement dit : après ce lot, **ce qui borne une route ORM n'est ni le framework ni la base, c'est
le pilote**.

## Lexique

Termes propres à ce chapitre. Le vocabulaire général est défini dans
[Méthode de mesure](methode.md#lexique).

| Terme                           | Ce qu'il désigne ici                                                                                                    |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **Escalier**                    | Suite de routes n'ajoutant **qu'une** chose chacune. La différence entre deux marches est le coût de ce qu'on a ajouté. |
| **Additivité**                  | Contrôle de validité d'un escalier : la somme des marches doit rendre la marche complète. Sinon on mesure autre chose.  |
| **Forme de requête**            | Ce qui identifie une requête indépendamment de ses **valeurs** : champs filtrés, comparaisons à `null`, tri, limite.    |
| **Requête préparée**            | Requête compilée une fois, exécutée ensuite avec des valeurs re-liées. Ce que le lot mémoïse.                           |
| **Requête nommée** (PostgreSQL) | Forme de requête préparée dont le plan est mis en cache **par connexion** du pool — d'où l'échauffement obligatoire.    |
| **Emplacement réservé**         | Marqueur de valeur dans une requête préparée. Il court-circuite la conversion de valeurs s'il est employé nu.           |
| **Repli**                       | Chemin de construction classique, conservé pour les cas que le cache de forme ne couvre pas.                            |

## Pièges

- **Le mot « cache » sans son périmètre déclenche à raison une inquiétude.** Dire d'emblée ce
  qu'un cache ne mémorise **pas**, et livrer le test anti-obsolescence avec le lot, pas après la
  question.
- **La documentation officielle d'une bibliothèque montre l'API, pas ses contrats.** Deux
  découvertes de ce chantier — l'exclusion des emplacements réservés par la fonction de liaison,
  et l'absence de préparation au niveau du protocole MySQL — ne sont écrites que dans le source.
- **Le premier run d'une série PostgreSQL est structurellement bas** (compilation par connexion du
  pool). Échauffement obligatoire, et ne jamais lire un run isolé.
- **À 128 connexions sur un magasin synchrone, on mesure une file d'attente**, pas un débit.
  Mesurer à 25.
- **Une table sans index sur ses clés étrangères** fausse la lecture du profil : une part du
  parcours natif est du travail que l'application aurait pu éviter. C'est une question de schéma
  d'application, pas de framework — voir [Ce qui reste ouvert](ouvertures.md).

## Pour aller plus loin

- ⬆️ **Retour au hub** : [Performance](index.md)
- ⏱️ [La boucle d'événements](boucle-evenements.md) — pourquoi un pilote coûte, même sans bloquer
- 🥊 [Face aux autres](comparaisons.md) — le même lot appliqué à Express : mêmes gains
- 📐 [Dimensionnement](dimensionnement.md) — ce que tient un pod sur une route ORM
- 📏 [Méthode de mesure](methode.md) — protocole A/B et gardes
