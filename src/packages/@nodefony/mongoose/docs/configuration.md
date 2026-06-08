---
module: "@nodefony/mongoose"
topic: mongoose-configuration
audience: [human, ai]
tags: [config, zod, connectors, env, session]
status: stable
last-updated: 2026-06-08
---

# Configuration de @nodefony/mongoose

La configuration est validée par **Zod** au boot. La **source de vérité** est
`nodefony/config/schema.ts` — le type TS est dérivé du schéma (`z.infer`), et chaque champ porte une
description (auto-documentation + JSON Schema pour un futur éditeur Studio).

## Forme

```ts
use("@nodefony/mongoose", {
  debug: false, // trace Mongoose des requêtes
  connectors: {
    nodefony: {
      // Soit une URI complète…
      uri: "mongodb+srv://cluster.example.com/app",
      // …soit les composants (ignorés si `uri` est fournie) :
      host: "localhost",
      port: 27017,
      dbname: "nodefony",
      // Options Mongoose (ConnectOptions) — validées par Mongoose, pas re-modélisées :
      options: { maxPoolSize: 50, serverSelectionTimeoutMS: 5000 },
    },
  },
});
```

## Champs

| Champ                  | Type                | Défaut         | Description                                                      |
| ---------------------- | ------------------- | -------------- | ---------------------------------------------------------------- |
| `debug`                | `boolean`           | `false`        | Active `mongoose.set("debug")` (trace des opérations). Dev only. |
| `connectors`           | `Record<string, …>` | `{ nodefony }` | Connexions nommées (clé = nom dans l'`ormRegistry`).             |
| `connectors.*.uri`     | `string?`           | —              | URI complète. **Prioritaire** sur host/port/dbname.              |
| `connectors.*.host`    | `string`            | `localhost`    | Hôte (ignoré si `uri`).                                          |
| `connectors.*.port`    | `number`            | `27017`        | Port (ignoré si `uri`).                                          |
| `connectors.*.dbname`  | `string`            | `nodefony`     | Base (ignoré si `uri`).                                          |
| `connectors.*.options` | `ConnectOptions?`   | —              | Auth/pool/timeouts. **Secrets via env, jamais committés.**       |

## Surcharge par environnement

Appliquée **après** le parse Zod (le schéma reste pur). Précédence : **env > config app > défauts**.

| Variable        | Effet                                                                                                                |
| --------------- | -------------------------------------------------------------------------------------------------------------------- |
| `MONGODB_URI`   | `uri` du connecteur primaire (`nodefony`, sinon le premier). C'est ici que vit le secret de connexion (`user:pass`). |
| `MONGODB_DEBUG` | `1`/`true` → `debug = true`.                                                                                         |

## Sécurité

- **Aucun secret dans le dépôt** : `options.user`/`options.pass` ou `uri` avec credentials → via l'env.
- `describeConnection()` nettoie l'URI (strip `user:pass@`) avant de l'exposer au data plane / aux logs.

## Validation

Une config invalide (port hors plage, type incorrect…) **plante au boot** avec un message clair
(`[@nodefony/mongoose] Invalid config: connectors.x.port: …`) plutôt qu'un `undefined` silencieux en
runtime. Couvert par `tests/unit/config.test.ts`.
