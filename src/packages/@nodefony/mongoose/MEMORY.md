# MEMORY.md — @nodefony/mongoose

## Purpose

Driver Mongoose (v8). Deux socles cohabitent :

- **Legacy** (`nodefony/service/orm.ts`) : ancien `Orm`/`Entity` du core `nodefony` + SessionStorage. Driver historique — refonte sur orm-core = phase ultérieure, NE PAS toucher hors de cette phase.
- **orm-core adapter** (`nodefony/src/orm-core/`, P5.4 ✅) : 2ᵉ adapter sur `@nodefony/orm-core`, **store documentaire hétérogène** → valide que le contrat enrichi (`relations`/`withTransaction`) est portable hors SQL.

## Core Components (adapter orm-core)

- `MongooseOrm extends Orm` : `onConnect()` = **`mongoose.createConnection(uri)`** (connexion isolée, PAS le singleton global → multi-ORM) + compile schémas/modèles depuis `entityRegistry`. `getRepository` (lazy), `transaction(work)` (session managée via `session.withTransaction`), `getNativeConnection<Connection>()`.
- `MongooseRepository<T>` : CRUD portable, **`id`→`_id`** dans le critère, sortie `toObject({virtuals:true})` (expose `id` string + populates). `options.relations` → `populate()`, `withTransaction(tx)` → `{session}`.
- `MongooseTransaction` : wrap `ClientSession`. **savepoint/rollbackTo = no-op** (MongoDB ne gère pas les savepoints).
- Exports : `index.ts` racine → `{ MongooseOrm, MongooseRepository, MongooseTransaction }`.

## Config / Build / Test

- peerDep P5.4 : `@nodefony/orm-core: "*"`. devDep test : `mongodb-memory-server` (11.x).
- Test : `npx mocha --config .mocharc.json` (mocha+tsx, `MongoMemoryReplSet`). **6 verts** (`tests/integration/orm-core-mongoose.test.ts`). timeout 120s (1er run télécharge le binaire mongod ~84 Mo).

## Gotchas / findings hétérogènes (vs SQL)

- **PK `_id` (ObjectId) ≠ `id`** : le contrat suppose `id`. L'adapter traduit `{id}`→`{_id}` en lecture et expose le virtuel `id` (hex string) en sortie → contrat `id: string` respecté malgré l'ObjectId. (SQL : `id` = vraie colonne.)
- **Relations sans FK SQL** : `one-to-many` = réf ObjectId injectée sur l'enfant + **virtual populate** sur le parent (`localField:_id`/`foreignField:fk`). `many-to-one`/`one-to-one` = champ réf sur la source. `many-to-many` → native. (SQL : FK auto.)
- **Transactions = replica set obligatoire** : un MongoDB standalone n'a PAS de transactions. Test via `MongoMemoryReplSet`. `transaction()` = `session.withTransaction` (managé, retries auto).
- **virtuals** : pour exposer `id` + relations populées dans le plain object, schéma créé avec `{toObject:{virtuals:true}, toJSON:{virtuals:true}}` + `toObject({virtuals:true})` à la sérialisation.
- `eager-load` même API que les adapters SQL : `findOne(criteria, {relations:["rooms"]})` → `populate` (Mongo) vs `include` (SQL). **Portabilité confirmée.**

## Liens

- ADR : `docs/adr/0003-...` (verdict P5.4 + portabilité 2 adapters).
- `@nodefony/orm-core` (contrats), `@nodefony/drizzle` (adapter SQL, parité du test).
