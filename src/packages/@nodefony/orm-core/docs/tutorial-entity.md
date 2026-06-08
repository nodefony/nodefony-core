---
module: "@nodefony/orm-core"
topic: tutorial-entity
audience: [human]
tags: [orm, entity, tutorial, debutant, repository, crud, queryAll]
status: stable
last-updated: 2026-05-23
---

# Créer une entité, de zéro à `queryAll` (guide débutant)

> Tutoriel pas-à-pas : déclarer une table, l'enregistrer, et lire/écrire des lignes.
> On part de rien et on finit par récupérer **toutes les lignes** (`find()`).

## 1. Les 3 mots à connaître

Avant de coder, retiens **trois objets** et comment ils s'emboîtent :

| Mot            | C'est quoi                                                  | Exemple                                 |
| -------------- | ----------------------------------------------------------- | --------------------------------------- |
| **Connecteur** | une connexion à une base, identifiée par un **nom**         | `"default"` (un fichier SQLite Drizzle) |
| **Entité**     | la description d'une **table** + le connecteur qu'elle vise | `User` sur `"default"`                  |
| **Repository** | l'objet avec lequel on **lit/écrit** dans la table          | `users.find()`, `users.create(...)`     |

La règle d'or : **l'entité ne connaît que le NOM du connecteur**, jamais le driver
(sqlite/mysql/…). Le driver est choisi dans la **config** (voir étape 2). Tu peux
donc passer de SQLite à MySQL sans toucher à l'entité.

```
  Entité  ──(nom du connecteur)──►  Config  ──►  Base physique
  "User" vise "default"            "default" = drizzle/sqlite   →  nodefony-drizzle.db
```

## 2. Choisir le moteur : le connecteur (config)

Le **driver** vit dans la config du module ORM. Exemple réel (`@nodefony/drizzle`) :

```ts
// nodefony.config.ts → use("@nodefony/drizzle", { connectors: { … } })
connectors: {
  default: {
    // ← le NOM du connecteur (= entity.orm)
    filename: "nodefony/databases/nodefony-drizzle.db", // ← un fichier SQLite
  },
  // pour Postgres/MySQL : changer le client Drizzle + les params de connexion
}
```

> Tu n'as **rien** à connecter à la main : le service du module (`DrizzleService`)
> ouvre chaque connecteur au démarrage du serveur (`onBoot`) et l'enregistre dans
> le `ormRegistry`.

## 3. Décrire la table : l'entité

Une entité = un objet `IEntity` : `{ orm, name, schema }`. Le **`schema`** dépend de
la famille d'ORM (c'est la seule chose qui change selon l'ORM).

### Schéma Drizzle (`sqliteTable`)

```ts
// nodefony/entity/post.ts
import { randomUUID } from "node:crypto";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { entityRegistry } from "@nodefony/orm-core";
import type { IEntity } from "@nodefony/orm-core";

// 1) le schéma = une table Drizzle
export const postTable = sqliteTable("Post", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  title: text("title").notNull(),
  body: text("body"),
  createdAt: integer("createdAt")
    .notNull()
    .$defaultFn(() => Date.now()),
});

// 2) l'entité = schéma + connecteur cible
const postEntity: IEntity = {
  orm: "default", // ← le NOM du connecteur (Drizzle)
  name: "Post", // ← le nom logique de la table
  schema: postTable,
};

// 3) on l'enregistre (voir étape 4)
entityRegistry.register(postEntity);
```

> Autre famille d'ORM (ex. Mongoose) : même `IEntity`, seul le `schema` change
> (schéma Mongoose au lieu d'une table Drizzle) — l'`orm` reste le **nom du
> connecteur** déclaré dans la config.

> **Différence à retenir** : `orm: "sqlite"/"mysql"` n'existe PAS — on met le **nom
> du connecteur** (`"default"`). Le moteur, lui, est dans la config.

## 4. Enregistrer l'entité (le `import` qui compte)

`entityRegistry.register(...)` doit s'exécuter **avant** le démarrage des connexions.
Le plus simple : un **import au top-level** dans le `index.ts` de ton app ou module.

```ts
// index.ts (app) ou index.ts du module
import "./nodefony/entity/post"; // ← exécute le register() à l'import
```

> ⚠️ **Piège singleton** : si ton entité est dans un _module_ (pas l'app racine),
> le `rollup.config.ts` du module **doit** lister `@nodefony/orm-core` dans ses
> `external`. Sinon le module embarque sa propre copie du registre et ton entité
> reste invisible pour l'ORM. (Les modules `@nodefony/drizzle` et `test`
> le font déjà.)

Au démarrage, le service de l'ORM lit le registre et **crée la table** automatiquement
(dev/test). Tu verras dans les logs : `Drizzle ORM "default" connected`.

## 5. Lire et écrire : le repository

On récupère le repository depuis le connecteur, puis on l'utilise. Deux façons :

```ts
// A) direct, via le registre (simple, pour un script ou un service)
import { ormRegistry } from "@nodefony/orm-core";

const orm = ormRegistry.get("default"); // le connecteur
const posts = orm.getRepository<Post>("Post"); // le repository de la table "Post"

// B) dans un controller : par injection de dépendances (recommandé)
//    @Inject("repository.post.default") private posts!: IRepository<Post>;
```

Avec `posts`, voici le **CRUD complet** (toutes les méthodes renvoient des `Promise`) :

```ts
// CREATE — insère une ligne, renvoie la ligne créée
const p = await posts.create({ title: "Hello", body: "world" });

// READ ONE — première ligne qui matche le critère
const one = await posts.findOne({ id: p.id });

// READ ALL (queryAll) — TOUTES les lignes : find() sans critère
const all = await posts.find();

// READ filtré — find() avec un critère
const recent = await posts.find({ title: "Hello" });

// COUNT — nombre de lignes
const n = await posts.count();

// UPDATE — modifie les lignes qui matchent, renvoie la ligne mise à jour
await posts.update({ id: p.id }, { title: "Hi" });

// DELETE — supprime, renvoie le nombre de lignes supprimées
const removed = await posts.delete({ id: p.id });
```

### `queryAll`, c'est juste `find()`

```ts
const all = await posts.find(); // tout
const page = await posts.find(undefined, {
  limit: 20,
  offset: 0,
  order: [["createdAt", "DESC"]],
});
```

## 6. Filtrer avec des opérateurs

Un critère est `{ champ: valeur }` (égalité) ou `{ champ: { $opérateur: ... } }` :

```ts
await posts.find({ title: "Hello" }); // égalité
await posts.find({ createdAt: { $gte: 0 } }); // ≥
await posts.find({ id: { $in: ["a", "b"] } }); // dans une liste
await posts.find({ title: { $like: "Hel%" } }); // LIKE SQL
```

Opérateurs disponibles : `$eq $ne $gt $gte $lt $lte $in $nin $like`.
Plusieurs opérateurs sur un même champ = **ET** (`{ age: { $gte: 18, $lt: 65 } }`).

## 7. Récap (cheat-sheet)

```ts
// 1. config : connecteur "default" → driver  (sqlite/mysql…)
// 2. entité : { orm: "default", name: "Post", schema }   → entityRegistry.register
// 3. import "./entity/post"  dans index.ts                → register au boot
// 4. const posts = ormRegistry.get("default").getRepository<Post>("Post");
// 5. await posts.create({...}) / findOne({...}) / find() / count() / update() / delete()
```

## 8. Pièges qui font perdre du temps

- **`orm:` = nom de connecteur, pas le driver.** `"default"` — jamais `"sqlite"`.
- **Schéma lié à la famille d'ORM.** Drizzle = `sqliteTable` (schema-as-code).
  On peut changer sqlite↔mysql (même famille) sans toucher l'entité ; changer
  de famille d'ORM = réécrire le `schema`.
- **L'`import` de l'entité doit s'exécuter** (side-effect) avant le boot, sinon la
  table n'existe pas.
- **Dans un module : externaliser `@nodefony/orm-core`** (rollup) sinon registre
  dédoublé → entité invisible.
- **Une transaction = un seul ORM.** Pas de jointure/transaction entre deux
  connecteurs différents.

## Pour aller plus loin

- [`index.md`](./index.md) — référence complète (contrats, transactions, eager-load).
- Exemple réel du repo : `nodefony/entity/user.ts` (Drizzle).
