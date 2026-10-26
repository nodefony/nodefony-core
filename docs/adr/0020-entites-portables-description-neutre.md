---
adr: 20
title: Entités portables — la description appartient au framework, l'ORM n'en est qu'un adaptateur
lang: fr
navTitle: Entités portables entre bases
date: 2026-10-26
status: proposed
deciders: [Christophe CAMENSULI]
tags: [orm, drizzle, portabilite, generateur, securite]
---

# ADR-0020 — Entités portables : la description appartient au framework, l'ORM n'en est qu'un adaptateur

📍 [Documentation](../index.md) › [Décisions d'architecture](README.md) › **ADR-0020**

## Statut

Proposé (2026-10-26), epic #680 (tickets #681 à #684). Passe à « accepté » quand le banc de
portabilité tourne en CI sur PostgreSQL, MySQL et MariaDB et que le schéma Dolibarr y tient (#684).

Complète l'[ADR-0003](0003-orm-core-abstraction-repository-multi-orm.md) (dépôt multi-ORM) et
l'[ADR-0008](0008-orm-drizzle-reference-sequelize-retire.md) (Drizzle référence SQL) sans les
remplacer : ils décident QUI exécute les requêtes, celui-ci décide QUI possède la forme d'une entité.

## Contexte

Drizzle décrit une table PAR dialecte (`sqliteTable`, `pgTable`, `mysqlTable`), avec des colonnes
typées par moteur. Une entité générée était donc écrite pour la base où l'application était née,
et la promesse « SQLite pour commencer, une vraie base ensuite » ne tenait pas : changer
`NF_DATABASE_URL` démarrait sur des tables d'un autre dialecte.

Le banc de portabilité (`.claude/skills/nodefony-devkit-bench/scripts/bench-portability.mjs`) a
montré que l'enfermement n'était pas le seul défaut. En faisant basculer UNE application née en
SQLite vers les trois autres moteurs, il a trouvé des défauts que SQLite masquait, plusieurs
présents même sans changer de base :

- une référence vers une clé `serial` typée en texte ; des tests générés qui semaient des valeurs
  invalides (un décimal `"seed-1"`) ;
- un schéma de validation qui laissait passer un entier sur 64 bits ou un caractère NUL — 201 sur
  SQLite, 500 sur PostgreSQL ;
- une suite e2e générée qui figeait son moteur au jour de la création ;
- l'empreinte du mot de passe rendue par `?include=owner`, sur les quatre moteurs.

## Décision

1. **La description d'une entité est un bien du FRAMEWORK, neutre vis-à-vis de tout ORM.**
   La grammaire des genres (`string(n)`, `char(n)`, `decimal(p,s)`, `uuid`, `enum`, `ref`…), les
   types de ligne (`RowOf`, `InsertOf`) et la validation des descriptions vivent dans
   `colKit.spec.ts`, sans import d'ORM — un test le refuse (`tests/unit/colkit-neutral.test.ts`).
   Drizzle en est l'adaptateur : `defineTable(spec).table(dialect)` fabrique la table du
   dialecte du connecteur, au démarrage (`orm-core/entityTable.ts#dialectTableOf`).
2. **Une valeur a UNE forme canonique, celle que la base la plus stricte rendrait.** Décimal à
   son échelle, uuid en minuscules, jour validé : `colKit.codecs.ts#canonicalDecimal`,
   `#canonicalUuid`, `#canonicalDay`. L'application lit la même valeur quel que soit le moteur.
3. **Ce qu'un moteur refuse est refusé à la frontière, partout.** Le schéma généré borne les
   entiers à 32 bits (`z.int32()`), refuse le NUL et le décimal hors précision
   (`entityFields.ts#ZOD_INT32`, `#ZOD_NO_NUL`) : un 422 identique sur les quatre moteurs plutôt
   qu'un 201 ici et un 500 là.
4. **Un écart qui tient à la SÉMANTIQUE d'un moteur se déclare, il ne se gomme pas.** La collation
   de MySQL et MariaDB (casse, accents, espaces finaux) et la place des `NULL` dans un tri restent
   celles du moteur, documentées et listées par le banc. Les émuler coûterait l'usage des index.
5. **Un champ privé ne sort jamais par une relation, et le défaut est fermé.** `IEntity.privateFields`
   déclare ce qu'un chargement de relation ne lit pas ; l'entité `User` tait d'office ce que le
   framework lit pour authentifier ou autoriser (`@nodefony/user#USER_PRIVATE_FIELDS`), qu'elle le
   déclare ou non. Règle unique : `userContract.ts#entityPrivateFields`, appelée par les deux
   adaptateurs. Le champ n'est pas retiré après coup : il n'est jamais LU.
   L'entité d'identité est **désignée, jamais devinée** : une seule fonction de `userContract.ts`
   dit laquelle elle est, et tous les lecteurs l'appellent — la règle des champs privés comme ceux
   qui écrivent du SQL sur la table. Son nom est figé à `User` aujourd'hui ; le jour où il deviendra
   libre, seule cette fonction changera, et le défaut fermé suivra l'entité quel que soit son nom.
   Les entités du framework qui portent un secret (`totp_secret.secretEnc`) le déclarent elles-mêmes
   en `privateFields`.
6. **Le générateur écrit cette forme.** `nodefony create entity` produit une description portable ;
   la suite e2e générée choisit son moteur à l'exécution (`runtime/e2eDatabase.ts#testDatabaseUrl`).

## Alternatives écartées

- **Une table Drizzle par dialecte, écrite par l'application** (l'état antérieur) : l'application
  reste enfermée dans son moteur de naissance, et chaque entité se maintient en trois copies.
- **Un langage de schéma externe et une étape de génération de code** : un langage de plus à
  apprendre, un build de plus à oublier, et la perte du typage direct que donne un objet TypeScript.
- **Placer la grammaire dans `@nodefony/orm-core` dès maintenant** : de l'abstraction sans second
  client. Le jour où un autre adaptateur la consomme, c'est un déplacement de fichier, pas une
  réécriture.
- **Émuler la collation et l'ordre des `NULL`** : un terme `col IS NULL` ou une collation forcée
  empêchent l'index de servir le tri — une perte de performance payée par toutes les requêtes, pour
  un écart que la documentation suffit à rendre prévisible.
- **Champs privés déclarés au cas par cas, sans défaut** : une application qui écrit sa propre
  entité `User` sans la déclaration exposerait l'empreinte, et rien ne le dirait.
- **Reconnaître un champ secret à son nom** (`password`, `roles`…) : une empreinte nommée
  `pwd_hash` passerait, un champ légitime serait tu à tort. Une règle qui devine n'est pas un
  contrat.
- **Comparer le décimal SQLite par une fonction SQL exacte enregistrée, ou par un encodage
  ordonnable du texte** : la fonction perd l'index elle aussi, paie un appel JavaScript par
  comparaison et lie la base à un pilote ; l'encodage rend la base illisible dans un outil SQLite
  et fait rendre `0` à un `SUM` sans un mot. La conversion `CAST … AS REAL`, exacte jusqu'à quinze
  chiffres significatifs, couvre tout montant d'argent sur tout pilote.

## Conséquences

- Changer de base se fait par la configuration et une migration initiale du nouveau dialecte ;
  les entités ne changent pas.
- Ajouter un dialecte = un fichier d'adaptateur (`colKit.<dialecte>.ts`), pas une retouche des
  entités.
- Monter l'ORM de référence vers sa majeure suivante se fait dans les seuls fichiers
  d'adaptateur ; la description neutre et les entités des applications ne bougent pas. Le jour
  où ce n'est plus vrai, c'est un défaut de l'adaptateur, pas un coût de la montée (#685).
- Aucun second adaptateur SQL n'est prévu. Son coût ne se résume pas au dépôt, que la suite de
  contrat partagée éprouve déjà : il faut aussi les huit briques du framework, les migrations,
  la matrice d'intégration continue multipliée par chaque moteur, et une maintenance sans fin.
  La porte reste ouverte sans dette : une application n'aurait aucune entité à réécrire. Une
  application peut, d'ici là, employer l'outil de son choix pour ses propres tables, à côté de
  celles du framework.
- Performance mesurée avant l'epic contre après, sur le chemin qu'une requête authentifiée paie
  (session, rechargement de l'utilisateur) : aucun écart séparable du bruit, en SQLite comme en
  PostgreSQL (`.claude/skills/nodefony-load-test/scripts/micro/micro-orm-hot-path-ab.mjs`).
  Les champs privés se résolvent une fois, à la connexion.
- La portabilité n'est tenue que si elle est éprouvée en continu : le banc tourne en CI sur les
  trois moteurs serveur, et un saut fait échouer la passe (`scripts/test/vitest/gates.ts`).
- Ce qui diverge entre moteurs est une liste FERMÉE et documentée ; tout autre écart est un défaut.
