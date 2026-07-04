import { z } from "zod";
import { resolveInfra } from "nodefony";
import { mongooseConfigSchema } from "./config";
import type {
  IMongooseConfig,
  IMongooseConfigInput,
} from "../interfaces/IMongooseConfig";

/**
 * Applique la surcharge par variables d'environnement APRÈS le parse Zod.
 *
 * Le schéma reste pur (déterministe, sérialisable en JSON Schema) ; l'env est une
 * couche explicite par-dessus. Précédence : env > config app > défauts.
 *
 * - `MONGODB_URI`, sinon infra database `NF_DATABASE_URL`/`DATABASE_URL` de
 *   famille mongo (`mongodb://`/`mongodb+srv://` — une URL SQL est IGNORÉE ici,
 *   elle appartient à `@nodefony/drizzle`) → `uri` du connecteur primaire
 *   (`nodefony`, sinon le premier). ⚠️ La place pour le secret de connexion
 *   (user:pass) — JAMAIS dans le dépôt.
 * - `MONGODB_DEBUG` (1/true) → `debug`.
 */
function applyEnvOverrides(config: IMongooseConfig): IMongooseConfig {
  const env = process.env;
  const database = resolveInfra(env).database;
  const uri =
    env.MONGODB_URI ??
    (database && database.family === "mongo" ? database.url : undefined);
  if (uri) {
    const target = config.connectors.nodefony
      ? "nodefony"
      : Object.keys(config.connectors)[0];
    if (target && config.connectors[target]) {
      config.connectors[target].uri = uri;
    }
  }
  if (env.MONGODB_DEBUG === "1" || env.MONGODB_DEBUG === "true") {
    config.debug = true;
  }
  return config;
}

/**
 * Builder type-safe de la configuration de `@nodefony/mongoose`.
 *
 * ⭐ TL;DR : MACHINERIE DE BOOT — on n'édite (presque) jamais ce fichier. Même
 * pattern que `nodefony.config.ts` ↔ `defineConfig()` du core : `config.ts` PORTE
 * la config (schéma + défauts), `define<X>Config()` la VALIDE au boot (parse +
 * env + freeze) et publie le JSON Schema Studio.
 *
 * Principes (alignés sur `defineRedisConfig` / `defineRealtimeConfig`) :
 * - **Source unique** : `./schema.ts` (Zod). Le builder VALIDE, applique l'ENV,
 *   puis GÈLE — il ne dévie jamais du schéma.
 * - **Auto-documenté** : chaque champ Zod porte un `.describe()` →
 *   {@link mongooseConfigJsonSchema} produit un JSON Schema qu'un formulaire Studio
 *   (futur) consommera pour générer son UI d'édition.
 *
 * @param config - configuration brute (sections omises = défauts sûrs).
 * @returns config validée, surchargée par l'env, et gelée.
 * @throws ZodError si la config est invalide.
 */
export function defineMongooseConfig(
  config: IMongooseConfigInput = {},
): IMongooseConfig {
  const parsed = mongooseConfigSchema.parse(config);
  return Object.freeze(applyEnvOverrides(parsed));
}

/**
 * JSON Schema introspectable de la config Mongoose — destiné au formulaire
 * d'édition Studio (futur) et à la documentation générée.
 */
export function mongooseConfigJsonSchema(): unknown {
  return z.toJSONSchema(mongooseConfigSchema);
}
