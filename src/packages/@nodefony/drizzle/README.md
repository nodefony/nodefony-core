# @nodefony/drizzle

Adapter [Drizzle ORM](https://orm.drizzle.team/) pour Nodefony, branché sur
[`@nodefony/orm-core`](https://www.npmjs.com/package/@nodefony/orm-core). driver concret du socle multi-ORM (avec
`@nodefony/mongoose`), **type-safe-first**.

> Driver SQLite : `better-sqlite3` (dépendance de pair optionnelle, à installer avec le dialecte
> `sqlite`). Pour PostgreSQL/MySQL, changer `NF_DATABASE_URL` (et installer `pg` ou
> `mysql2`) : une entité décrite par `defineTable` — ce qu'écrit `create entity` — suit la
> base, et `orm:generate` écrit la migration du nouveau dialecte. Le contrat `IRepository`
> reste identique ; les données, elles, ne suivent pas.

## ⚡ Le geste — une entité ne s'écrit pas à la main

Dans une application, `create entity` pose la table Drizzle (`nodefony/entity/Post.ts`), ses
schémas de validation, un service CRUD, un contrôleur REST, un test unitaire et un test e2e, et
les inscrit dans `index.ts`. Si l'application versionne ses migrations, il écrit puis applique
celle de la table à la base de développement :

```bash
npx nodefony create entity Post title:string content:text views:int --route /api/posts
```

Le pas-à-pas qui construit la même entité à la main, pour comprendre ce que la commande écrit :
[Créer une entité](https://github.com/nodefony/nodefony-core/blob/main/src/packages/@nodefony/orm-core/docs/tutorial-entity.md).
La suite de ce README décrit l'adaptateur lui-même.

## Installation

```bash
npm install @nodefony/drizzle@beta drizzle-orm better-sqlite3
```

## Utilisation comme module Nodefony (bootable)

Ajouter `@nodefony/drizzle` au manifeste `modules` de `nodefony.config.ts` : le `DrizzleService`
connecte au boot un ORM par connecteur configuré (c'est l'ORM SQL par défaut recommandé).

```typescript
// nodefony.config.ts
import { defineConfig, use } from "nodefony";

export default defineConfig({
  modules: [
    "@nodefony/http",
    // connecte au boot, ferme au shutdown ; sans `filename`, la base vit sous var/databases/
    use("@nodefony/drizzle", {
      connectors: { default: { dialect: "sqlite" } },
    }),
  ],
});
```

Le schéma (`nodefony/config/config.ts`) porte les défauts ; l'application les surcharge par
`use("@nodefony/drizzle", { … })`, par `NF_DATABASE_URL` (dialecte déduit du schéma d'URL) ou par
l'override générique `NF__DRIZZLE__<CHEMIN>`. Sans `filename`, un connecteur SQLite écrit dans
`<app>/var/databases/nodefony-drizzle.db` (`nodefony-<connecteur>.db` pour les autres) ;
`filename: ":memory:"` donne une base éphémère, pour les tests.

Au runtime, l'ORM est récupérable via le registre :

```typescript
import { ormRegistry } from "@nodefony/orm-core";
const orm = ormRegistry.get("default");
const users = orm.getRepository("User");
```

## Démarrage (usage direct / banc-test)

Exemple NATIF, lié à SQLite. Pour une entité qui suit la base, écrire une description
`defineTable` : [`docs/index.md`](docs/index.md) § « Des entités qui suivent la base ».

```typescript
import { randomUUID } from "node:crypto";
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { entity } from "@nodefony/orm-core";
import { DrizzleOrm } from "@nodefony/drizzle";

// 1) Schema-as-code : la table EST le schéma de l'entité.
const usersTable = sqliteTable("User", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  email: text("email").notNull().unique(),
  age: integer("age").notNull(),
});

@entity({ connector: "db", name: "User", schema: usersTable })
class UserEntity {}

// 2) Connexion (auto-enregistrement dans ormRegistry).
const orm = new DrizzleOrm("db", { filename: ":memory:" });
await orm.connect();

const users = orm.getRepository<{ id: string; email: string; age: number }>(
  "User",
);
```

## CRUD portable

```typescript
const u = await users.create({ email: "a@b.c", age: 30 });
await users.findOne({ id: u.id });
await users.find(); // tous
await users.updateOne({ id: u.id }, { age: 31 });
await users.delete({ id: u.id });
await users.count();
```

## Critères riches (opérateurs `$`-préfixés, typés)

Forme **portable cross-ORM** (identique sur Mongoose) :

```typescript
await users.find({ age: { $gt: 25 } });
await users.find({ age: { $gte: 20, $lte: 40 } }); // AND
await users.find({ age: { $in: [20, 40] } });
await users.find({ age: { $nin: [20, 40] } });
await users.find({ age: { $ne: 30 } });
await users.find({ email: { $like: "u2%" } }); // sémantique SQL (`%`, `_`)
```

Opérateurs supportés : `$eq $ne $gt $gte $lt $lte $in $nin $like $null`, et `$or` pour une
disjonction. Une valeur nue
(`{ email: "a@b.c" }`) = égalité.

## Relations & eager-load

```typescript
const roomsTable = sqliteTable("Room", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  name: text("name").notNull(),
  userId: text("userId").notNull(),
});

@entity({
  connector: "db",
  name: "User",
  schema: usersTable,
  relations: [{ type: "one-to-many", target: "Room", field: "rooms" }],
})
class User {}

// Charge l'association déclarée (1 requête IN(...) + regroupement) :
const owner = await users.findOne({ email: "a@b.c" }, { relations: ["rooms"] });
owner.rooms; // Room[]
```

Pagination/tri : `{ limit, offset, order: [["age", "DESC"]] }`.

## Transactions

```typescript
await orm.transaction(async (tx) => {
  const owner = await users
    .withTransaction(tx)
    .create({ email: "x@y.z", age: 1 });
  await rooms.withTransaction(tx).create({ name: "general", userId: owner.id });
  // throw ⇒ rollback de TOUT ; sinon commit automatique
});
```

## Requêtes brutes (trappe native)

```typescript
import { sql } from "drizzle-orm";
const db = orm.getNativeConnection(); // db Drizzle
const rows = db.all(sql`SELECT ... JOIN ...`);
```

## Notes

- **Dev/test** : le schéma SQLite est créé automatiquement (DDL dérivé des tables).
  **Production** : `nodefony orm:generate` puis `nodefony orm:migrate` (voir `docs/migrations.md`).
- `better-sqlite3` est **synchrone** : les transactions sont pilotées manuellement
  (`BEGIN`/`COMMIT`/`ROLLBACK`) pour rester compatibles avec le contrat async.

## Licence

Apache 2.0 — Christophe CAMENSULI.
