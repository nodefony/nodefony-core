---
module: "@nodefony/mongoose"
topic: mongoose
audience: [human, ai]
tags:
  [orm, mongoose, mongodb, nosql, session, repository, document, transaction]
status: stable
last-updated: 2026-06-08
---

# @nodefony/mongoose — ORM NoSQL (MongoDB)

Driver **document** de Nodefony, branché sur `@nodefony/orm-core`. Expose le même contrat portable
(`IRepository`, `ITransaction`) que le driver SQL Drizzle, sur un store **hétérogène** : la même API
de repository fonctionne sur MongoDB et sur SQLite/Postgres.

> **Positionnement** : Drizzle est l'ORM **SQL par défaut** recommandé. Mongoose est l'option
> **NoSQL** — activez-le (`use("@nodefony/mongoose", …)`) quand votre domaine est documentaire.

## Concepts

| Brique               | Rôle                                                                                    |
| -------------------- | --------------------------------------------------------------------------------------- |
| `MongooseService`    | Service bootable : connecte un `MongooseOrm` par connecteur au boot, ferme à l'arrêt.   |
| `MongooseOrm`        | Adapter orm-core : connexion isolée, compile les entités, sondes (ping/probe/describe). |
| `MongooseRepository` | CRUD portable + relations (`populate`) + opérateurs riches (`$gt`/`$in`/`$like`→regex). |
| `SessionStorage`     | Store de session portable (handler `"mongoose"`, IoC).                                  |

## Modèle de connexions

La config déclare N **connecteurs** nommés (clé = nom dans l'`ormRegistry`). Chaque connecteur ouvre
une **connexion isolée** (`mongoose.createConnection`, pas le singleton global) → plusieurs bases /
ORM logiques coexistent. Le connecteur par défaut s'appelle **`nodefony`**.

> **Pourquoi `nodefony` et pas `default`** (comme Drizzle) : l'entité `session` est enregistrée dans
> le `entityRegistry` **process-wide** sous `(connector, nom)`. Un nom de connecteur distinct par ORM évite
> que les deux entités `session` (SQL et NoSQL) ne collisionnent si les deux modules cohabitent.

## Spécificités MongoDB

- **Clé primaire `_id`** (ObjectId) ↔ `id` (string hex) — le contrat `id: string` est respecté via le
  virtuel `id` exposé à la sérialisation.
- **Relations sans FK** : `one-to-many` = réf ObjectId sur l'enfant + _virtual populate_ sur le parent ;
  `many-to-one`/`one-to-one` = réf sur la source ; `many-to-many` → API native.
- **Transactions** : `session.withTransaction` (managée, retries) → **replica set requis**.

## Introspection (Studio)

Le module alimente le data plane ORM (`/nodefony/orm/api/*`) : `describeConnection` (driver/cible
sans credentials/version), `describeEntity` (colonnes depuis `schema.paths`), `ping` (round-trip réel),
`probe` (pool via `serverStatus`), et un **flux de requêtes** (débit/latence) via le moniteur de flux ORM.

## Voir aussi

- [Configuration](./configuration.md) — schéma Zod, défauts, surcharge env.
- `@nodefony/drizzle` — adapter SQL frère (référence du contrat).
- `@nodefony/orm-core` — contrats abstraits + registres.
