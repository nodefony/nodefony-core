---
title: "Stockage de session — où vivent les sessions, et comment en écrire un"
navTitle: Stockage de session
lang: fr
module: "@nodefony/http"
topic: session-storage-guide
audience: [human, ai]
tags: [session, storage, ioc, registry, drizzle, mongoose, redis, http, guide]
version: "doc"
status: stable
updated: 2026-09-01
source: "docs/guides/session-storage.md"
---

# Guide — Stockage de session (mécanisme IoC + backends)

> Comment Nodefony choisit où ranger les sessions HTTP/WS, quels backends existent,
> et comment en écrire un sur mesure. Le mécanisme est en **inversion de contrôle** :
> `@nodefony/http` ne dépend d'aucun ORM — chaque backend **s'enregistre lui-même**.

📍 [Documentation](../index.md) › [Guides](README.md) › **Stockage de session**

> ℹ️ **Modèle d'identité hybride** : le web et la console d'administration s'appuient sur une
> **session serveur** (cookie opaque, révocable) — c'est la fondation, pas une dette ; le **JWT**
> est réservé aux API et aux agents sans état (machine à machine). La session reste donc pleinement
> supportée. Vue d'ensemble de TOUTE la persistance : [`persistence.md`](./persistence.md).

## Le modèle — inversion de contrôle

`SessionsService` tient un **registre statique** de constructeurs de stockage, et n'importe aucun
ORM. Chaque module fournisseur s'y inscrit lui-même au moment où il est chargé.

```
@nodefony/http : SessionsService.storages : Map<name, StorageCtor>
   ▲ registerStorage("memory",   MemorySessionStorage)  ← http lui-même (intégré)
   ▲ registerStorage("drizzle",  SessionStorage)        ← @nodefony/drizzle au chargement
   ▲ registerStorage("mongoose", SessionStorage)        ← @nodefony/mongoose au chargement
   ▲ registerStorage("redis",    RedisSessionStorage)   ← @nodefony/redis au chargement

initializeStorage() → SessionsService.getStorage(nom) → new Storage(this)
```

Deux bénéfices, et c'est toute la raison d'être du mécanisme : **aucun cycle** `http ↔ ORM`, et
ajouter un pilote **ne touche pas** `@nodefony/http`. La résolution du nom est insensible à la casse.

Le registre et sa résolution vivent dans `SessionsService.registerStorage()`
(`sessions-service.ts:182`), `SessionsService.getStorage()` (`sessions-service.ts:191`) et
`SessionsService.storageHandlers()` (`sessions-service.ts:196`) ; le stockage intégré s'enregistre
en fin de fichier (`sessions-service.ts:886`).

## Choisir le backend — un seul réglage

La clé `session.store` du module http sélectionne le stockage par son **nom**
(`config.ts:774`) :

```typescript
// nodefony/config/modules/http-config.ts (surcharge applicative)
export default {
  session: {
    store: "auto", // "auto" | "memory" | "drizzle" | "mongoose" | "redis"
  },
};
```

| Nom        | Fourni par           | Ce que ça range                                           |
| ---------- | -------------------- | --------------------------------------------------------- |
| `auto`     | — (**défaut**)       | Ne choisit pas : **suit l'infrastructure déclarée**       |
| `memory`   | `@nodefony/http`     | En mémoire du process — **volatil** (développement, banc) |
| `drizzle`  | `@nodefony/drizzle`  | Table `session`, via orm-core                             |
| `mongoose` | `@nodefony/mongoose` | Collection MongoDB                                        |
| `redis`    | `@nodefony/redis`    | Clés Redis, avec expiration native                        |

> Un backend n'est disponible que si **le module qui le fournit est chargé** (`@modules()`).
> `store: "drizzle"` exige donc `@nodefony/drizzle` dans `@modules()`.

### Ce que fait `auto`, précisément

C'est le défaut, et il ne devine rien : il lit l'**infrastructure déclarée** de l'application et
prend le premier moyen réellement disponible — cache Redis, puis base de données, puis SQLite local
si drizzle est chargé, et à défaut `memory`. Le choix est **borné aux stockages réellement
enregistrés**, et il est **annoncé dans les journaux** au boot :

```
session.store "auto" → "redis" (cache redis déclaré)
SESSION STORAGE active : redis
```

La résolution est portée par `resolveAutoStore()` (`infra.ts:241`), appelée depuis
`initializeStorage()` (`sessions-service.ts:239`) — la même fonction sert aux autres briques qui
déclarent un store, ce qui évite deux politiques divergentes.

### L'interface du registre

```typescript
import { SessionsService } from "@nodefony/http";

SessionsService.registerStorage("mybackend", MyStorage); // enregistrer
SessionsService.getStorage("drizzle"); // constructeur | undefined
SessionsService.storageHandlers(); // ["memory", "drizzle", …]
```

### Événements (observabilité)

Émis sur le kernel :

| Événement                  | Quand                           | Arguments            |
| -------------------------- | ------------------------------- | -------------------- |
| `onRegisterSessionStorage` | un backend s'enregistre         | `(name, ctor)`       |
| `onSessionStorageReady`    | le stockage actif est instancié | `(handler, storage)` |

```typescript
kernel.on("onSessionStorageReady", (handler) => {
  /* afficher le backend de session actif */
});
```

## Écrire un backend sur mesure

1. Implémenter le contrat `ISessionStorage` (`@nodefony/http`) :

```typescript
import type { ISessionStorage } from "@nodefony/http";

class S3SessionStorage implements ISessionStorage {
  read(id: string): Promise<unknown> {
    /* … */
  }
  write(id: string, data: unknown, ctx: string): Promise<unknown> {
    /* … */
  }
  start(id: string, ctx: string): Promise<unknown> {
    /* … */
  }
  open(ctx: string): Promise<number> {
    /* … */
  }
  close(): boolean {
    /* … */
  }
  destroy(id: string, ctx: string): Promise<boolean> {
    /* … */
  }
  gc(maxlifetime: number, ctx: string): Promise<void> {
    /* … */
  }
}
```

2. L'enregistrer **au chargement du module**, jamais dans le constructeur d'un service — le
   registre doit être peuplé avant que la session ne s'initialise :

```typescript
import { SessionsService } from "@nodefony/http";
SessionsService.registerStorage("s3", S3SessionStorage);
export default S3SessionStorage;
```

3. Activer : `session: { store: "s3" }`. Le module fournisseur doit être dans `@modules()`.

> **Piège de bundle** : appeler `SessionsService.registerStorage(...)` rend l'import de
> `@nodefony/http` **une valeur** et non plus un import de type — il faut donc ajouter
> `@nodefony/http` à la liste `external` du `rolldown.config.ts` du module fournisseur, sinon le
> paquet embarque une seconde copie de `SessionsService` et s'inscrit dans un registre que
> personne ne lit.

## Référence — backend ORM (exemple Drizzle)

`@nodefony/drizzle` montre le patron orm-core : entité `session` (`@entity`, table créée au boot),
stockage adossé au repository, purge par un opérateur portable
`{ updatedAt: { $lt: cutoff } }`. Voir [`@nodefony/drizzle`](../../src/packages/@nodefony/drizzle/docs/index.md).

> **Performance** : avec `better-sqlite3` (synchrone, connexion unique) le débit d'écriture de
> session plafonne — les écritures se sérialisent. Un pilote Drizzle PostgreSQL ou MySQL
> parallélise. La correction est le **backend**, pas le mécanisme.

## 📖 Lexique

| Terme                             | Ce que c'est                                                                                                                        |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **Stockage** (_storage_)          | L'objet qui sait lire, écrire, détruire et purger les sessions dans un support donné. Contrat : `ISessionStorage`.                  |
| **Registre**                      | La table `nom → constructeur` tenue par `SessionsService`. Un module fournisseur s'y inscrit ; `@nodefony/http` n'en connaît aucun. |
| **IoC** (_inversion de contrôle_) | Le consommateur ne va pas chercher son fournisseur : c'est le fournisseur qui vient s'annoncer. C'est ce qui casse le cycle.        |
| **`auto`**                        | La valeur par défaut de `session.store` : ne nomme pas un backend, mais délègue le choix à l'infrastructure déclarée.               |
| **Purge** (_gc_)                  | Le passage qui supprime les sessions expirées. Hors chemin critique, réglée par `session.gcIntervalS`.                              |

## ⚠️ Pièges

- **Un nom inconnu ne se comporte pas pareil selon l'environnement, et c'est voulu.** En
  production, un `store` explicite introuvable **avorte le boot** (`sessions-service.ts:269`) :
  des sessions silencieusement mortes cassent le pare-feu en cascade, un pod qui ne démarre pas se
  voit tout de suite. En développement, l'application se replie sur `memory` avec un
  avertissement — elle reste utilisable, les sessions sont volatiles. Le cas `auto` ne passe
  jamais par là : il ne choisit que parmi ce qui est enregistré.
- **`memory` n'est pas un backend de production.** Il ne survit pas au redémarrage du process, et
  deux exemplaires de l'application ne partagent rien : chaque requête peut tomber sur un pod qui
  ne connaît pas la session. C'est le repli, pas un choix.
- **Le module fournisseur doit être dans `@modules()`.** `store: "redis"` sans `@nodefony/redis`
  chargé ne donne pas une erreur de configuration : le registre ne contient tout simplement pas
  le nom, et on retombe sur la doctrine d'échec ci-dessus.
- **Enregistrer depuis un constructeur de service arrive trop tard.** L'inscription doit se faire
  à l'évaluation du module, sinon `initializeStorage()` a déjà résolu — et pris autre chose.
- **La purge n'est pas gratuite sur un store partagé.** `gcIntervalS: 0` désarme le minuteur quand
  la purge est déléguée (tâche planifiée, expiration native de Redis) ; sinon `gcJitter` étale les
  départs pour éviter que tous les pods balayent en même temps.

## 🧪 Tests & couverture

Les chiffres exacts vivent dans la carte de l'aperçu, régénérée depuis vitest — jamais figés ici.

<!-- prettier-ignore -->
| Type | Où | Ce qui est prouvé |
| --- | --- | --- |
| Unitaires | `@nodefony/http` `unit/session-facets.test.ts`, `unit/session-pagination.test.ts`, `unit/SessionsAdmin.test.ts` | facettes de session, pagination, surface d'administration |
| Unitaires (infra) | `nodefony` `tests/infra.test.ts` | la résolution `auto` suit bien l'infrastructure déclarée |
| Intégration | `@nodefony/drizzle` `session-storage.test.ts`, `session-store-sqlite.test.ts` · `@nodefony/mongoose` `session-storage.test.ts` · `@nodefony/redis` `session-store.test.ts`, `session-resilience.test.ts` | le comportement de CHAQUE backend, et sa tenue quand le support tombe |
| E2E (base réelle) | `@nodefony/drizzle` `session-store-postgres.e2e.test.ts`, `session-store-mysql.e2e.test.ts` | dialectes réels |

> [!CAUTION]
> Les suites E2E se **skippent** sans leurs variables d'infrastructure, et un skip compte comme
> vert. Avant de conclure « tout passe » sur PostgreSQL et MySQL, vérifier que `NF_PG_URL` et
> `NF_MYSQL_URL` étaient posées — source unique : `vitest.gates.ts` à la racine.

## 🔗 Pour aller plus loin

- ⬆️ **Retour au hub** : [Guides](README.md) · [Toute la documentation](../index.md)
- 🗄️ **Vue d'ensemble de la persistance** : [`persistence.md`](./persistence.md) — quelle brique
  range quoi, et dans quel support.
- 🔍 **La session elle-même** (cycle de vie, cookie, révocation) :
  [`@nodefony/http` — session](../../src/packages/@nodefony/http/docs/session.md)
- 🗃️ **Les backends en détail** :
  [`@nodefony/drizzle`](../../src/packages/@nodefony/drizzle/docs/index.md) ·
  [`@nodefony/redis`](../../src/packages/@nodefony/redis/docs/index.md) ·
  [`@nodefony/mongoose`](../../src/packages/@nodefony/mongoose/docs/index.md)
- 🔐 **Qui authentifie la session** :
  [Firewall](../../src/packages/@nodefony/security/docs/firewall.md)
- 📖 [Lexique général](../lexique.md) du framework.
