---
module: "@nodefony/drizzle"
topic: drizzle
audience: [human, ai]
tags:
  [
    orm,
    drizzle,
    better-sqlite3,
    session,
    repository,
    schema-as-code,
    transaction,
  ]
status: stable
last-updated: 2026-05-21
---

# @nodefony/drizzle — ORM SQL type-safe (Drizzle)

> driver concret de [`@nodefony/orm-core`](../../orm-core/docs/index.md), avec
> Mongoose. **Type-safe-first**, choix SQL #1 moderne. Driver de
> référence : `better-sqlite3` (Postgres/MySQL = changer le client + le constructeur
> de table). À la fois **module bootable** et **lib adapter**.

## Module bootable (ORM par défaut)

Ajouté à `@modules()`, le `DrizzleService` connecte au boot un `DrizzleOrm` par
connecteur configuré et ferme à `onTerminate` :

```typescript
@modules([
  "@nodefony/drizzle", // connecte au boot, ferme au shutdown
  "@nodefony/http",
])
class App extends Module {}
```

Config (`nodefony/config/config.ts`, surchargeable côté app via
`config/modules/drizzle-config.ts`) :

```typescript
export default {
  connectors: {
    default: { filename: "<root>/nodefony/databases/nodefony-drizzle.db" },
    // ":memory:" ou absent → base éphémère
  },
};
```

Récupération au runtime : `OrmRegistry.get("default").getRepository("User")`.

## Repository (CRUD + opérateurs riches)

```typescript
const u = await users.create({ email: "a@b.c", age: 30 });
await users.findOne({ id: u.id });
await users.find({ age: { $gte: 18, $lt: 65 } }); // opérateurs portables (orm-core)
await users.update({ id: u.id }, { age: 31 });
await users.delete({ id: u.id });
```

Opérateurs : `$eq $ne $gt $gte $lt $lte $in $nin $like` (cf
[orm-core](../../orm-core/docs/index.md)). Eager-load : `find(criteria, { relations })`.
Trappe brute : `orm.getNativeConnection()` → `db.all(sql\`… JOIN … CTE … window …\`)`.

## Spécificités Drizzle (vs Mongoose)

- **Schema-as-code** : `entity.schema` _est_ une table Drizzle (`sqliteTable(...)`),
  pas de `define()`. L'adapter dérive le DDL via `getTableConfig()` (dev/test ;
  prod = `drizzle-kit`).
- **Eager-load manuel** : une requête `IN (...)` par relation déclarée + regroupement
  mémoire (pas de couche `relations()` imposée).
- **Transaction manuelle** `BEGIN`/`COMMIT`/`ROLLBACK` : `better-sqlite3` est
  **synchrone**, son helper `db.transaction()` committe au `return` _avant_ les
  `await` du contrat async ; la connexion étant unique, encadrer le travail garantit
  l'atomicité. `withTransaction(tx)` réutilise le même db.

## Stockage de session

Fournit un `SessionStorage` (contrat `ISessionStorage` de `@nodefony/http`) backé
par le repository orm-core. **Inversion de contrôle** : le storage s'auto-enregistre
dans le registre de `SessionsService` (`registerStorage("drizzle", …)`) → http ne
dépend d'aucun ORM. Activation via la config : `session: { store: "drizzle" }`.

- Entité `session` (`nodefony/entity/sessionEntity.ts`) : table créée au boot,
  colonnes JSON (`Attributes`/`flashBag`/`metaBag`).
- GC = opérateur riche portable `{ updatedAt: { $lt: cutoff } }`.
- Events kernel : `onRegisterSessionStorage` / `onSessionStorageReady` (observabilité Studio).

## Gotchas

- `better-sqlite3` = driver natif (node-gyp) ; OK Node 26 (prebuild 12.x), en `dependencies`.
- `OFFSET` SQLite exige un `LIMIT` → `limit(-1)` si seul l'offset est posé.
- db typé `BetterSQLite3Database<Record<string, never>>` (eager-load manuel, pas `db.query`).
- Après changement d'`index.ts`, rebuild **direct** du module (cache turbo peut resservir un dist périmé).

## Tests

- `npm test` : banc orm-core (8) + jointure très complexe (CTE/window/sous-requêtes
  corrélées via trappe native, + LEFT JOIN typé) + session storage IoC/CRUD/GC (8) = **18**.
- `npm run test:load` : charge/limites/mémoire (8) — insert 20k ≈ 15k ops/s, scan ≈ 1M/s,
  30k cycles heapΔ 0.3MB, 300 connexions heapΔ 0.1MB (0 fuite).
