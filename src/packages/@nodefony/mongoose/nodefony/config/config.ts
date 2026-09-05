import { z } from "zod";

/**
 * @nodefony/mongoose — CONFIGURATION DU MODULE (schéma Zod = source unique).
 *
 * ⭐ TL;DR : CE SCHÉMA EST LA CONFIG. Chaque `.default(...)` = la valeur d'usine ;
 * changer un défaut du module = ÉDITER ICI (et nulle part ailleurs). L'app, elle,
 * surcharge via `use("@nodefony/...", { … })` dans SON `nodefony.config.ts`.
 *
 * RÈGLE D'OR (ADR-0006) : ce fichier porte le **schéma Zod commenté** (type +
 * validation + défaut + doc) ET matérialise les défauts via `parse({})`. Aucune
 * valeur n'est re-tapée ailleurs. Le builder (`defineMongooseConfig`) et les types
 * (`interfaces/IMongooseConfig.ts`) importent le schéma D'ICI (nœud bas : ce fichier
 * n'importe que `zod` → pas de cycle).
 *
 * Le type TS est dérivé via `z.infer<>` ({@link MongooseConfig}), et la config est
 * validée au boot du Module class (hook `onKernelRegister`, via le builder
 * {@link defineMongooseConfig}) → plante propre avec messages clairs si la config
 * est invalide, plutôt qu'un `undefined.x` silencieux en runtime.
 *
 * Convention figée (cf `feedback_config_validation_zod` + audit config ORM
 * 2026-06), alignée sur `@nodefony/drizzle` (adapter SQL frère, référence).
 *
 * ⚠️ ENV : ce schéma reste **PUR** (aucune lecture `process.env` ici, sinon il
 * devient non déterministe et non sérialisable en JSON Schema). La surcharge par
 * variables d'environnement (`MONGODB_URI`, `NF_MONGODB_DEBUG`) est appliquée dans
 * {@link defineMongooseConfig}, APRÈS le parse.
 *
 * SURCHARGE (précédence croissante — cf ADR-0006) :
 *   • App (typé)         : `use("@nodefony/mongoose", { debug: true, connectors: { … } })` ;
 *   • Par environnement  : `MONGODB_URI` · `NF_MONGODB_DEBUG` (appliqués dans
 *     `defineMongooseConfig`).
 *
 * ⚠️ NE PAS éditer les défauts matérialisés en bas de fichier : modifier les
 * `.default(...)` du schéma. La validation + le merge env finaux sont faits dans
 * `index.ts` au hook `onKernelRegister` via `defineMongooseConfig`.
 */

const connectorSchema = z
  .strictObject({
    uri: z
      .string()
      .min(1)
      .optional()
      .describe(
        "URI de connexion complète (`mongodb://…` ou `mongodb+srv://…`). Si " +
          "fournie, elle PRIME sur `host`/`port`/`dbname`. Pratique pour les " +
          "PaaS / Atlas. ⚠️ Zero Trust : un secret (user:pass) NE doit JAMAIS " +
          "être committé — passer par l'env. Pour la poser par variable : " +
          "`MONGODB_URI` (ou l'infra `NF_DATABASE_URL` de famille mongo). " +
          "`NF__MONGOOSE__CONNECTORS__<NOM>__URI` ne marche QUE si la clé `uri` " +
          "existe déjà dans la config de l'application : la surcharge par " +
          "chemin remplace une valeur, elle n'en crée pas (elle avertit sinon).",
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
    autoIndex: z
      .boolean()
      .optional()
      .describe(
        "Construire les index déclarés au démarrage (défaut mongoose : true). " +
          "Mongoose recommande `false` en production : la construction bloque " +
          "les opérations sur une grosse collection. ⚠️ À `false`, un index " +
          "manquant N'EST PAS créé — il est seulement CONSTATÉ et journalisé " +
          "en CRITIC ; le poser devient un geste d'exploitation. Prime sur une " +
          "clé `autoIndex` écrite dans `options` (canal typé > fourre-tout).",
      ),
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
  .strictObject({
    debug: z
      .boolean()
      .default(false)
      .describe(
        "Active la trace Mongoose des requêtes (`mongoose.set('debug')`). " +
          "Défaut false. Mettre true en dev pour voir chaque opération. " +
          "Surchargé par l'env `NF_MONGODB_DEBUG` (1/true). Reco prod : false.",
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

/**
 * Défauts du module, matérialisés depuis le schéma (source unique). Toujours
 * valides par construction ; passés au `super(..., config)` du Module class.
 */
const config: MongooseConfig = mongooseConfigSchema.parse({});

export default config;
