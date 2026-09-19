---
adr: 8
title: ORM — Drizzle comme référence SQL, Mongoose pour NoSQL, Sequelize retiré
lang: fr
navTitle: ORM — Drizzle référence
date: 2026-06-02
status: accepted
deciders: [Christophe CAMENSULI]
tags: [orm, drizzle, mongoose, sql]
---

# ADR-0008 — ORM : Drizzle comme référence SQL, Mongoose pour NoSQL, Sequelize retiré

## Statut

Accepté (2026-06-02), clos (2026-06-08). Cette décision gouverne tout le code de persistance
de Nodefony 10.

## Contexte

Nodefony 7 (JavaScript) livrait Sequelize et Mongoose. La migration vers TypeScript posait
une question que l'abstraction `orm-core` ne tranche pas (voir [ADR-0003](0003-orm-core-abstraction-repository-multi-orm.md),
qui décrit le contrat `IRepository` mais reste neutre sur les drivers) : **quel ORM SQL le
framework recommande-t-il, et lesquels garde-t-il ?**

Trois candidats étaient en lice — Sequelize (l'existant), Drizzle, MikroORM. L'enjeu n'est pas
cosmétique : le driver recommandé décide de la forme de l'API publique. Un contrat validé
d'abord sur le legacy est rétro-adapté au driver moderne ; l'inverse produit une API pensée
pour lui.

Ce qui a fait pencher :

- **La type-safety est le cœur du sujet.** `OrmCriteria = Record<string, unknown>` annule
  l'inférence de Drizzle ([ADR-0003](0003-orm-core-abstraction-repository-multi-orm.md), risque 3).
  Un driver qui _peut_ exposer ses types mérite que le contrat lui laisse la place ; Sequelize,
  lui, n'a rien à exposer.
- **Sequelize traînait une dette de forme** : le module ne respectait ni la convention de
  configuration Zod des autres modules, ni le contrat CRUD durci.
- **MikroORM n'a jamais été commencé** — aucun module, aucune ligne. Le garder dans la carte
  entretenait l'illusion d'un chantier.

## Décision

1. **Drizzle est l'ORM SQL de référence.** Toute fonctionnalité qui se décline sur plusieurs
   ORM est **implémentée d'abord sur Drizzle**, puis portée. Jamais l'inverse.
2. **Mongoose est le chemin NoSQL**, et c'est un chemin **durable** : une application doit
   pouvoir tourner sans `@nodefony/drizzle`. Ce n'est pas un ORM de second rang.
3. **Sequelize est retiré**, sans période de dépréciation — la décision précède la première
   publication de la série 10, donc aucun utilisateur n'avait à migrer.
4. **MikroORM est abandonné** explicitement, plutôt que laissé « à faire ».
5. **Les migrations SQL ne sont pas déléguées à un CLI d'ORM.** L'applicateur est maison
   (`DrizzleMigrator`), parce que le migrator de Drizzle s'est révélé insuffisant au code :
   pas de verrou natif d'identité, pas de table d'historique en espace de noms ouvert, pas de
   refus gradué. Les commandes `orm:generate`, `orm:migrate`, `orm:status`, `orm:baseline`,
   `orm:repair` et `orm:reset` sont celles du framework.

## Conséquences

**Ce qui est devenu vrai.** Les trois dialectes SQL (SQLite, PostgreSQL, MySQL/MariaDB) sont
portés par un seul jeu de code : la spécification logique d'une colonne est traduite par
`colKit`, le SQL natif est routé par `queryKit` (`json_each` / `@>` jsonb / `JSON_CONTAINS`,
toujours bindé). Les huit briques de persistance du framework — session, jetons, passkeys,
utilisateurs, audit, idempotence, webhooks, TOTP — existent sur Drizzle.

**Le prix payé.** `@nodefony/mongoose` porte cinq briques sur huit : `totp`, `audit` et
`idempotency` s'y replient sur la mémoire, donc un secret de double authentification est perdu
au redémarrage et le journal d'audit est volatil. C'est un écart reconnu, pas un choix — un
utilisateur choisit sa base de données, il ne choisit pas de perdre le 2FA.

**Ce qui reste un vrai choix, en revanche** : `@nodefony/redis` n'offre ni `user`, ni `audit`,
ni `webhooks`. Non parce qu'il serait inférieur, mais parce que ces données croissent sans
borne, se conservent des mois et se consultent — la mémoire vive n'est pas leur support.

**Où se lit la décision dans le code** : `src/packages/@nodefony/orm-core/` (le contrat),
`src/packages/@nodefony/drizzle/` (la référence), `src/packages/@nodefony/mongoose/` (le chemin
NoSQL). Aucun code Sequelize ne subsiste ; la seule occurrence du nom est une fixture de test
qui vérifie qu'un module introuvable ne tue pas le démarrage.

## Alternatives écartées

| Alternative                                  | Pourquoi non                                                                                                                      |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Garder Sequelize en second driver            | Deux drivers SQL à maintenir, dont un qui n'apporte aucune type-safety, pour un projet mené sans équipe                           |
| Déprécier Sequelize sur une majeure          | La décision précède la première publication : personne à ménager, et un repli transitoire aurait fait deux chantiers au lieu d'un |
| Adopter MikroORM                             | Jamais commencé ; son modèle (Data Mapper, contexte d'identité) demandait une abstraction différente de `IRepository`             |
| Déléguer les migrations à `drizzle-kit` seul | Insuffisant au code : ni verrou d'identité, ni historique en espace de noms ouvert, ni refus gradué d'une migration destructrice  |

## Pour aller plus loin

- [ADR-0003 — abstraction Repository multi-ORM](0003-orm-core-abstraction-repository-multi-orm.md) : le contrat que cette décision instancie.
- [`src/packages/@nodefony/drizzle/docs/migrations.md`](../../src/packages/@nodefony/drizzle/docs/migrations.md) : le cycle de vie d'un schéma en production.
