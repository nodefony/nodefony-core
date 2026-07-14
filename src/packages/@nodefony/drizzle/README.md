# @nodefony/drizzle

Adapter [Drizzle ORM](https://orm.drizzle.team/) pour Nodefony, branché sur
[`@nodefony/orm-core`](../orm-core). driver concret du socle multi-ORM (avec
`@nodefony/mongoose`), **type-safe-first**.

> Driver de référence : `better-sqlite3` (tests, embarqué). Pour Postgres/MySQL,
> changer le client et le constructeur de table (`pgTable`/`mysqlTable`) — le
> contrat `IRepository` reste identique.

## Installation

```bash
npm install @nodefony/drizzle drizzle-orm better-sqlite3
```

## Utilisation comme module Nodefony (bootable)

Ajouter `@nodefony/drizzle` à `@modules()` de l'app : le `DrizzleService` connecte
au boot un ORM par connecteur configuré (c'est l'ORM SQL par défaut recommandé).

```typescript
@modules([
  "@nodefony/drizzle", // connecte au boot, ferme au shutdown
  "@nodefony/http",
  // ...
])
class App extends Module {}
```

Config par défaut (`nodefony/config/config.ts`) — surchargeable côté app via
`nodefony/config/modules/drizzle-config.ts` :

```typescript
export default {
  connectors: {
    default: { filename: "<root>/var/databases/nodefony-drizzle.db" },
    // ":memory:" ou absent → base éphémère
  },
};
```

Au runtime, l'ORM est récupérable via le registre :

```typescript
import { OrmRegistry } from "@nodefony/orm-core";
const orm = OrmRegistry.get("default");
const users = orm.getRepository("User");
```

## Démarrage (usage direct / banc-test)

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
await users.update({ id: u.id }, { age: 31 });
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

Opérateurs supportés : `$eq $ne $gt $gte $lt $lte $in $nin $like`. Une valeur nue
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
  **Production** : utiliser `drizzle-kit` pour les migrations.
- `better-sqlite3` est **synchrone** : les transactions sont pilotées manuellement
  (`BEGIN`/`COMMIT`/`ROLLBACK`) pour rester compatibles avec le contrat async.

## Licence

CECILL-B — Christophe CAMENSULI.
