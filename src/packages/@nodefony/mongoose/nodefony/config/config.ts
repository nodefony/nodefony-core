/**
 * @nodefony/mongoose — Configuration par défaut du module.
 *
 * Source de vérité = `./schema.ts` (Zod). Ce fichier expose les défauts dérivés
 * via `mongooseConfigSchema.parse({})` — toujours valides par construction, passés
 * au `super(..., config)` du Module class.
 *
 * SURCHARGE PAR L'APPLICATION (manifeste `use()`, fusion récursive) :
 *
 *   // nodefony.config.ts
 *   use("@nodefony/mongoose", {
 *     debug: true,
 *     connectors: { nodefony: { host: "mongo.internal", dbname: "app" } },
 *   });
 *
 * SURCHARGE PAR ENVIRONNEMENT (précédence max, appliquée dans le builder) :
 *   MONGODB_URI · MONGODB_DEBUG
 *
 * ⚠️ NE PAS éditer les valeurs ici à la main : modifier les `.default(...)` du
 * schéma, pas ce fichier. La validation + le merge env finaux sont faits dans
 * `index.ts` au hook `onKernelRegister` via `defineMongooseConfig`.
 */
import { mongooseConfigSchema, type MongooseConfig } from "./schema";

const config: MongooseConfig = mongooseConfigSchema.parse({});

export default config;
export type { MongooseConfig };
