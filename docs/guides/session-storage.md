---
module: "@nodefony/http"
topic: session-storage-guide
audience: [human, ai]
tags: [session, storage, ioc, registry, drizzle, sequelize, mongoose, http, guide]
status: stable
last-updated: 2026-05-21
---

# Guide — Stockage de session (mécanisme IoC + backends)

> Comment Nodefony choisit où ranger les sessions HTTP/WS, quels backends existent,
> et comment en écrire un sur mesure. Le mécanisme est en **inversion de contrôle** :
> `@nodefony/http` ne dépend d'aucun ORM — chaque backend **s'enregistre lui-même**.

> ⚠️ **Cap stratégique** : à terme l'authent HTTP vise le **stateless (JWT cookie)**,
> les sessions RAM/serveur sont en voie de dépréciation (cf décision sécurité P6).
> Ce guide décrit le système de session **tel qu'il existe aujourd'hui**.

## Choisir le backend — un seul réglage

La config `session.handler` du module http sélectionne le storage par son **nom** :

```typescript
// nodefony/config/modules/http-config.ts (override applicatif)
export default {
  session: {
    handler: "drizzle", // "files" | "drizzle" | "sequelize" | "mongoose"
  },
};
```

| Handler     | Fourni par            | Backend                                  |
| ----------- | --------------------- | ---------------------------------------- |
| `files`     | `@nodefony/http`      | Fichiers JSON sur disque (built-in)      |
| `drizzle`   | `@nodefony/drizzle`   | Table `session` via orm-core (**défaut recommandé**) |
| `sequelize` | `@nodefony/sequelize` | Entité session legacy (maintenance)      |
| `mongoose`  | `@nodefony/mongoose`  | Collection MongoDB                       |

> Le backend n'est disponible que si **le module qui le fournit est chargé**
> (`@modules()`). Ex. `handler: "drizzle"` exige `@nodefony/drizzle` dans `@modules()`.

## Comment ça marche (inversion de contrôle)

`SessionsService` (http) tient un **registre statique** ; il n'importe aucun ORM.

```
@nodefony/http : SessionsService.#storages : Map<name, StorageCtor>
   ▲ registerStorage("files", FileSessionStorage)   ← http lui-même (built-in)
   ▲ registerStorage("drizzle", DrizzleStorage)     ← @nodefony/drizzle au chargement
   ▲ registerStorage("sequelize", SequelizeStorage) ← @nodefony/sequelize au chargement
   ▲ registerStorage("mongoose", MongooseStorage)   ← @nodefony/mongoose au chargement

initializeStorage() → SessionsService.getStorage(handler) → new Storage(this)
```

Bénéfices : **pas de cycle** `http ↔ ORM`, et ajouter un driver **ne touche plus**
`@nodefony/http`. La résolution du handler est insensible à la casse.

### API du registre

```typescript
import { SessionsService } from "@nodefony/http";

SessionsService.registerStorage("mybackend", MyStorage); // enregistrer
SessionsService.getStorage("drizzle");                    // ctor | undefined
SessionsService.storageHandlers();                        // ["files","drizzle",…]
```

### Événements (observabilité Studio)

Émis sur le kernel :

| Événement                   | Quand                                   | Args              |
| --------------------------- | --------------------------------------- | ----------------- |
| `onRegisterSessionStorage`  | un backend s'enregistre                 | `(name, ctor)`    |
| `onSessionStorageReady`     | le storage actif est instancié          | `(handler, storage)` |

```typescript
kernel.on("onSessionStorageReady", (handler) => {
  /* Studio : afficher le backend de session actif */
});
```

## Écrire un backend sur mesure

1. Implémenter le contrat `ISessionStorage` (`@nodefony/http`) :

```typescript
import type { ISessionStorage } from "@nodefony/http";

class RedisSessionStorage implements ISessionStorage {
  read(id: string): Promise<unknown> { /* … */ }
  write(id: string, data: unknown, ctx: string): Promise<unknown> { /* … */ }
  start(id: string, ctx: string): Promise<unknown> { /* … */ }
  open(ctx: string): Promise<number> { /* … */ }
  close(): boolean { /* … */ }
  destroy(id: string, ctx: string): Promise<boolean> { /* … */ }
  gc(maxlifetime: number, ctx: string): Promise<void> { /* … */ }
}
```

2. L'auto-enregistrer **au chargement du module** (pas dans un constructeur de service) :

```typescript
import { SessionsService } from "@nodefony/http";
SessionsService.registerStorage("redis", RedisSessionStorage);
export default RedisSessionStorage;
```

3. Activer : `session: { handler: "redis" }`. Le module fournisseur doit être dans `@modules()`.

> **Gotcha rollup** : appeler `SessionsService.registerStorage(...)` rend l'import
> `@nodefony/http` **valeur** (plus type-only) → ajouter `@nodefony/http` à la liste
> `external` du `rollup.config.ts` du module fournisseur (sinon bundling CJS casse).

## Référence — backend ORM (exemple Drizzle)

`@nodefony/drizzle` montre le pattern orm-core : entité `session` (`@entity`, table
créée au boot), storage backé par le repository, GC via opérateur riche portable
`{ updatedAt: { $lt: cutoff } }`. Voir [`@nodefony/drizzle`](../../src/packages/@nodefony/drizzle/docs/index.md).

> **Perf** : avec `better-sqlite3` (synchrone, mono-connexion) le débit d'écriture
> de session plafonne (~408 RPS mesuré) car les écritures se sérialisent ; un driver
> Drizzle Postgres/MySQL parallélise. La correction = backend, pas le mécanisme.
