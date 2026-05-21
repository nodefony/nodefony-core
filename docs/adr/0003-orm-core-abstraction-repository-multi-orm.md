---
adr: 3
title: Architecture orm-core — abstraction Repository multi-ORM (risques & garde-fous)
date: 2026-05-21
status: accepted
deciders: [Christophe CAMENSULI]
tags: [orm, orm-core, repository, architecture, p5, risk]
---

# ADR-0003 — Architecture orm-core : abstraction Repository multi-ORM

## Statut

Accepté (2026-05-21). Acte l'architecture livrée en P5.1→P5.3 (interfaces +
registres + décorateurs) et **documente explicitement les 3 risques** de
l'abstraction, avec les garde-fous à appliquer en P5.4. N'est PAS remis en
cause : il fige la dette connue pour qu'elle soit tranchée sur un cas concret,
pas oubliée.

## Contexte

`@nodefony/orm-core` pose une couche **ports & adapters (hexagonale)** :

- `IOrm`/`IEntity`/`IRepository`/`ITransaction` = ports (contrats abstraits) ;
- les drivers (`@nodefony/sequelize`, `mongoose`, `drizzle`, `mikroorm`) = adapters.

Le choix de design central est **Repository** (collection-like interface, façade
portable) **plutôt qu'Active Record** (l'entité se persiste elle-même). Raison :
permettre de **changer d'ORM sans réécrire le métier** et, accessoirement, de
faire cohabiter plusieurs stores (SQL + Mongo + Redis) derrière la même API.
Inspiration : Doctrine/Symfony (liaison entity↔repository + DI), NestJS/TypeORM
(syntaxe décorateurs), Fowler/DDD (concept). Cf mémoires IA
`project_decisions_p5_p6_orm`, `project_p5_3_kit`.

État à la rédaction : le **squelette** est livré et testé (22 tests unit verts),
mais **aucun adapter réel ne tourne encore** → l'abstraction n'est pas validée
sur une vraie requête. Cet ADR existe parce que le squelette « passe les tests »
ne prouve QUE le cas facile.

## Décision

Conserver l'abstraction Repository multi-ORM, **mais traiter les 3 risques
ci-dessous comme des conditions de validation de P5.4**, pas comme des détails
d'implémentation. P5.4 doit prouver l'abstraction sur le **cas dur** (une
jointure/relation réelle), pas seulement sur du CRUD trivial.

### Risque 1 — Abstraction qui fuit (leaky abstraction)

`IRepository` = `find/findOne/create/update/delete/count` + `OrmCriteria =
Record<string, unknown>`. Couvre le CRUD simple (~20 %). Ne couvre PAS de façon
portable :

- jointures / eager-load : Sequelize `include` ≠ Mongoose `populate` ≠ Drizzle `with` ;
- WHERE riches (OR, ranges, `$in`, opérateurs), tri, pagination, projections, agrégats ;
- sémantiques de transaction divergentes (Mongo = replica set, SQL = natif).

Soupape déjà prévue : `IOrm.getNativeConnection<C>()`. **Conséquence assumée :**
plus on recourt à la trappe native, moins le code est portable. La promesse
« portable » plafonne au CRUD + lookups simples.

**Garde-fou P5.4 :** mesurer combien de la requête « dure » (User↔Room, jointure)
passe par l'abstraction vs par la trappe native. Si la jointure force déjà le
natif → faire évoluer `IRepository` (criteria typé, méthode `query`/`with`/
`paginate`) **AVANT** d'écrire 4 drivers sur un contrat insuffisant.

### Risque 2 — Multi-ORM *simultané* partiellement YAGNI

Faire tourner 2 ORM **SQL** en même temps est un cas quasi inexistant. Les cas
réels = stores **hétérogènes** (SQL + Mongo, ou DB + Redis cache), où un
`IRepository` unique est justement le plus discutable (Redis n'est pas un store
d'entités CRUD).

**Décision de cadrage :** la justification **officielle** de orm-core est la
**portabilité dans le temps** (« changer d'ORM sans réécrire le métier »), PAS la
**portabilité dans l'espace** (« lancer 4 ORM à la fois »). Le multi-ORM
simultané reste supporté (banc de test ADR-0002) mais n'est pas le cas d'usage
qui justifie l'API. Ne pas sur-dimensionner pour ce cas.

### Risque 3 — `OrmCriteria` faiblement typé vs Drizzle

`OrmCriteria = Record<string, unknown>` jette la type-safety. Or Drizzle (choix
SQL #1, P7.4) vaut **pour ses types inférés**. L'abstraction se bat donc contre
son meilleur driver : `find(Record<string, unknown>)` annule l'inférence Drizzle.

**Garde-fou P5.4/P7.4 :** explorer un `IRepository<T>` où le critère est dérivé
de `T` (ex. `Partial<T>` + opérateurs typés, ou criteria générique paramétré),
de sorte qu'un driver type-safe (Drizzle) puisse exposer ses types sans casser
le contrat des drivers non typés (Sequelize/Mongoose). À trancher quand le
driver Drizzle sera branché, sur un type d'entité concret.

## Alternatives écartées

- **Active Record** (entité = donnée + persistance, `user.save()`) : plus simple,
  mais couple l'entité à un ORM unique → incompatible avec l'objectif de
  portabilité. Conservé **en interne** dans les drivers Sequelize/Mongoose ;
  orm-core pose une **façade Repository** par-dessus.
- **Query builder / SQL brut généralisé** (Knex-like) : rejette toute portabilité
  d'objet métier ; reste accessible via la trappe `getNativeConnection()` pour
  les cas non couverts.
- **Repository sur-spécifié dès maintenant** (DSL de requête complet, criteria
  typé) : rejeté tant qu'aucun cas dur réel ne l'a justifié — on évite d'inventer
  une abstraction spéculative. C'est précisément le travail de P5.4.

## Conséquences

- **Positif** : design conventionnel et à faible risque sur le CRUD ; métier
  découplé du driver ; trappe native = anti-blocage explicite.
- **Négatif / dette assumée** : portabilité réelle limitée au CRUD + lookups
  simples ; criteria non typé en tension avec Drizzle ; valeur réelle = swap
  d'ORM, pas exécution concurrente de N ORM.
- **Condition de sortie de P5.4** : un adapter Sequelize exécute une **jointure
  User↔Room** ; on documente la part native nécessaire ; si elle est trop grande,
  `IRepository` évolue avant la multiplication des drivers.

## Verdict P5.4 (2026-05-21)

Premier adapter réel branché : `SequelizeOrm` (`@nodefony/sequelize/nodefony/src/orm-core/`,
distinct du service legacy), validé sur **sqlite `::memory:`** avec les entités
ADR-0002 (User *one-to-many* Room, UUID-first). **6 tests d'intégration verts.**

**Prouvé (chaîne P5.1→P5.4 de bout en bout) :**

- `@entity` (descripteur) → l'adapter **compile les modèles** depuis `entity.schema`
  + câble les associations → `getRepository(name)` sert un repository portable ;
- `Orm` s'auto-enregistre dans `ormRegistry`, template `connect()` émet `onOrmReady` ;
- **CRUD portable OK** : `create/findOne/find/count/update/delete` (UUID auto) ;
- relation one-to-many : lecture portable par critère simple (`find({ userId })`) OK ;
- transaction managée : commit persiste / rollback annule ; FK **appliquée** (sqlite).

**Fuites mesurées (confirment les risques + 1 nouveau) :**

1. **Jointure / eager-load** → impossible via `IRepository` → `getNativeConnection()`
   (`include`). Confirme le **risque #1**. Alternative portable = N+1.
2. **Repository non tx-aware (NOUVEAU, risque #4)** : dans `transaction(work)`, le
   `IRepository.create()` portable ne connaît pas la tx active → il a fallu écrire
   via `getNativeConnection()` + `{ transaction: tx.getNative() }`. Threader la tx
   au repo exigera soit `repo.withTransaction(tx)`, soit CLS/ALS (le legacy
   utilisait `cls-hooked`).
3. **Nommage FK** : Sequelize génère une FK PascalCase (`UserId`) par défaut ;
   l'adapter force le camelCase (`userId`) pour que le critère portable
   `{ userId }` matche. Toute abstraction de relation devra fixer cette convention.
4. Le **risque #3** (`OrmCriteria` non typé vs Drizzle) reste ouvert — non
   exercé ici (Sequelize n'est pas type-safe-first), à trancher au branchement Drizzle (P7.4).

**Décision de sortie :** le contrat suffit pour le CRUD + lookups simples.
**Avant de multiplier les drivers** (P7.x), trancher : (a) critère typé/opérateurs,
(b) repository tx-aware (`withTransaction` ou ALS), (c) API de relation/eager-load
OU acceptation explicite « jointures = native uniquement ». La migration du driver
Sequelize **de production** (refonte du legacy `service/orm.ts` sur orm-core) reste **P7.1**.

### Mise à jour — fuites traitées (2026-05-21, même session)

Contrat `IRepository` enrichi (additif, non-cassant) + adapter Sequelize mis à
jour. **orm-core 22 tests / Sequelize 7 tests verts.**

- **Risque #1 (jointure) — RÉSOLU pour le cas commun** : `find/findOne(criteria,
  { relations: [...] })` charge les **associations déclarées** (`include`/`populate`/
  `with` selon l'adapter). Les jointures **arbitraires** restent via
  `getNativeConnection()` (acceptation explicite). Ajout aussi `limit/offset/order`.
- **Risque #4 (repo non tx-aware) — RÉSOLU** : `repo.withTransaction(tx)` renvoie
  une vue liée à la tx (toutes les ops passent `{ transaction }`), **sans état
  global ni CLS**. Test : user + room créés dans la même tx, rollback annule les deux.
- **Risque #3 (criteria typé) — PARTIEL** : `Criteria<T> = Partial<T> & OrmCriteria`
  → égalité sur champs connus **type-checkée**, échappatoire conservée. Opérateurs
  riches (`$gt`/`$in`...) toujours différés au branchement **Drizzle (P7.4)**.
- **Nommage FK** : `IEntityRelation.foreignKey?` (override explicite) ; sinon
  l'adapter dérive un camelCase déterministe.

**Reste avant P7.x** : valider le contrat enrichi sur un **2ᵉ adapter
hétérogène** (Mongoose — eager-load = `populate`, tx = session/replica set) pour
confirmer que `relations`/`withTransaction` sont réellement portables.

## Liens

- ADR-0002 (schéma banc de test mediasoup) — fournit le cas dur (User↔Room).
- Mémoires IA : `project_decisions_p5_p6_orm`, `project_p5_3_kit`,
  `project_mediasoup_test_db`.
- Code : `src/packages/@nodefony/orm-core/` (interfaces, `nodefony/src/`,
  `nodefony/src/decorators/`).
