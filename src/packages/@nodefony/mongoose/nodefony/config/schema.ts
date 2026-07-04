import { z } from "zod";

/**
 * Schéma Zod de la configuration de `@nodefony/mongoose`.
 *
 * **Source de vérité du module** : le type TS est dérivé via `z.infer<>`
 * ({@link IMongooseConfig}), et la config est validée au boot du Module class
 * (hook `onKernelRegister`, via le builder {@link defineMongooseConfig}) → plante
 * propre avec messages clairs si la config est invalide, plutôt qu'un `undefined.x`
 * silencieux en runtime.
 *
 * Convention figée (cf `feedback_config_validation_zod`), alignée sur
 * `@nodefony/redis/.../schema.ts` et `@nodefony/realtime/.../schema.ts`.
 *
 * ⚠️ ENV : ce schéma reste **PUR** (aucune lecture `process.env` ici, sinon il
 * devient non déterministe et non sérialisable en JSON Schema). La surcharge par
 * variables d'environnement (`MONGODB_URI`, `MONGODB_DEBUG`) est appliquée dans
 * {@link defineMongooseConfig}, APRÈS le parse.
 */

const connectorSchema = z
  .object({
    uri: z
      .string()
      .min(1)
      .optional()
      .describe(
        "URI de connexion complète (`mongodb://…` ou `mongodb+srv://…`). Si " +
          "fournie, elle PRIME sur `host`/`port`/`dbname`. Pratique pour les " +
          "PaaS / Atlas. Surchargée par l'env `MONGODB_URI`. ⚠️ Zero Trust : un " +
          "secret (user:pass) NE doit JAMAIS être committé — passer par l'env.",
      ),
    host: z
      .string()
      .min(1)
      .default("localhost")
      .describe(
        "Hôte du serveur MongoDB. Défaut `localhost` (jamais d'hôte d'infra " +
          "hardcodé). Ignoré si `uri` est fournie. Reco prod : hôte managé + TLS.",
      ),
    port: z
      .number()
      .int()
      .min(1)
      .max(65_535)
      .default(27017)
      .describe("Port TCP du serveur. Défaut 27017. Ignoré si `uri` fournie."),
    dbname: z
      .string()
      .min(1)
      .default("nodefony")
      .describe("Nom de la base. Défaut `nodefony`. Ignoré si `uri` fournie."),
    options: z
      .record(z.string(), z.unknown())
      .optional()
      .describe(
        "Options de connexion Mongoose (`ConnectOptions` : `user`/`pass`/" +
          "`maxPoolSize`/`serverSelectionTimeoutMS`/`socketTimeoutMS`…). NON " +
          "re-modélisées ici (validées par Mongoose lui-même). ⚠️ Les " +
          "credentials (`user`/`pass`) doivent venir de l'env, jamais du dépôt.",
      ),
  })
  .describe("Définition d'une connexion Mongoose nommée.");

export const mongooseConfigSchema = z
  .object({
    debug: z
      .boolean()
      .default(false)
      .describe(
        "Active la trace Mongoose des requêtes (`mongoose.set('debug')`). " +
          "Défaut false. Mettre true en dev pour voir chaque opération. " +
          "Surchargé par l'env `MONGODB_DEBUG` (1/true). Reco prod : false.",
      ),
    connectors: z
      .record(z.string(), connectorSchema)
      .default(() => ({ nodefony: connectorSchema.parse({}) }))
      .describe(
        "Connexions indexées par nom (= clé dans le `ormRegistry`). Défaut : un " +
          "connecteur `nodefony` sur `localhost:27017/nodefony`. Le nom " +
          "`nodefony` (≠ `default` de Drizzle) évite toute collision d'entité " +
          "dans le `entityRegistry` (process-wide) si les deux ORM cohabitent.",
      ),
    frameworkEntities: z
      .boolean()
      .default(true)
      .describe(
        "Déclare le schéma framework sur le connecteur `nodefony` (tokens, " +
          "webauthn, webhooks — modèles compilés au connect) et rend les stores " +
          "correspondants sélectionnables par nom (`mongoose`). Couverture " +
          "partielle assumée : PAS d'audit ni d'idempotence mongoose. " +
          "`false` = module data-only.",
      ),
  })
  .describe("Configuration de @nodefony/mongoose.");

/** Type de sortie (config normalisée + défauts appliqués). */
export type MongooseConfig = z.infer<typeof mongooseConfigSchema>;
