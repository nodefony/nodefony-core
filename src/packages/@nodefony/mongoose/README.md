# @nodefony/mongoose

Driver **NoSQL Mongoose** pour Nodefony, branché sur `@nodefony/orm-core`. Adapter documentaire
hétérogène (même contrat `IRepository`/`ITransaction` que le driver SQL Drizzle), avec stockage de
session portable et sondes d'introspection pour Studio.

> Module **opt-in** : Nodefony recommande **Drizzle** comme ORM SQL par défaut. Activez Mongoose
> quand vous avez besoin d'un store documentaire (MongoDB).

## Installation / activation

Le module fait partie du monorepo. Pour l'activer dans une application, ajoutez-le au manifeste
`modules` de `nodefony.config.ts` :

```ts
import { defineConfig, use } from "nodefony";

export default defineConfig((ctx) => ({
  modules: [
    "@nodefony/http",
    "@nodefony/framework",
    use("@nodefony/mongoose", {
      debug: !ctx.isProd,
      connectors: {
        nodefony: { host: "localhost", port: 27017, dbname: "app" },
      },
    }),
  ],
}));
```

Grâce à l'augmentation du registre `NodefonyModuleConfig`, `use("@nodefony/mongoose", …)`
**autocomplète** les clés de config (hover TSDoc inclus).

## Configuration

| Clé          | Type                                | Défaut                                   | Rôle                                                 |
| ------------ | ----------------------------------- | ---------------------------------------- | ---------------------------------------------------- |
| `debug`      | `boolean`                           | `false`                                  | Trace Mongoose des requêtes (`mongoose.set`).        |
| `connectors` | `Record<string, MongooseConnector>` | `{ nodefony: localhost:27017/nodefony }` | Connexions nommées (clé = nom dans l'`ormRegistry`). |

**Connecteur** : `uri?` (prioritaire) **ou** `host`/`port`/`dbname`, + `options?` (`ConnectOptions`
Mongoose : `user`/`pass`/`maxPoolSize`/timeouts).

**Surcharge par environnement** (précédence max) : `MONGODB_URI` (uri du connecteur primaire) ·
`MONGODB_DEBUG` (1/true). ⚠️ Les secrets (`user:pass`) passent par l'env, **jamais** par le dépôt.

La config est validée par **Zod** au boot (`config.ts` = source de vérité). Une config invalide
plante proprement avec un message clair.

## Stockage de session

L'import du module enregistre automatiquement un `SessionStorage` sous le handler `"mongoose"`
(inversion de contrôle — `@nodefony/http` ne dépend d'aucun ORM). Sélectionnez-le via la config de
session (`store: "mongoose"`). Le store persiste dans la collection `sessions` du connecteur
`nodefony`, avec un GC des sessions expirées.

## Usage direct de l'adapter (banc-test)

```ts
import { MongooseOrm } from "@nodefony/mongoose";
import { entity, ormRegistry } from "@nodefony/orm-core";

@entity({
  orm: "mydb",
  name: "User",
  schema: { email: { type: String, required: true } },
})
class UserEntity {}

const orm = new MongooseOrm("mydb", "mongodb://localhost:27017/test");
await orm.connect(); // compile les entités ciblant "mydb"
const users = orm.getRepository<{ id: string; email: string }>("User");
await users.create({ email: "a@b.c" });
const found = await users.findOne({ email: "a@b.c" });
await orm.disconnect();
```

## Spécificités MongoDB (vs SQL)

- **Clé primaire `_id`** (ObjectId) exposée comme `id` (hex string) → contrat `id: string` respecté.
- **Relations** sans clé étrangère SQL : `one-to-many` = réf ObjectId + _virtual populate_ ;
  `many-to-one`/`one-to-one` = réf sur la source. `many-to-many` → API native (`getNativeConnection`).
- **Transactions** = `session.withTransaction` → **replica set obligatoire** (un MongoDB standalone n'en a pas).

## Tests

```bash
npm test   # vitest : config (Zod) + intégration (mongodb-memory-server)
```

Pour une CI / Docker, exportez `MONGO_TEST_URI=mongodb://localhost:27017` (conteneur de service Mongo)
→ aucun binaire téléchargé.

## Licence

CeCILL-B — Christophe CAMENSULI.
