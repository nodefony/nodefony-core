import { z } from "zod";
import { drizzleConfigSchema } from "./config";
import type {
  IDrizzleConfig,
  IDrizzleConfigInput,
} from "../interfaces/IDrizzleConfig";

/**
 * Applique la surcharge par variables d'environnement APRÈS le parse Zod.
 *
 * Le schéma reste pur ; l'env est une couche explicite par-dessus. Précédence :
 * env > config app > défauts.
 *
 * - `DRIZZLE_DB_FILE` → `filename` du connecteur primaire (`default`, sinon le
 *   premier). Pratique pour pointer un fichier hors arborescence app (volume monté).
 */
function applyEnvOverrides(config: IDrizzleConfig): IDrizzleConfig {
  const env = process.env;
  if (env.DRIZZLE_DB_FILE) {
    const target = config.connectors.default
      ? "default"
      : Object.keys(config.connectors)[0];
    if (target && config.connectors[target]) {
      config.connectors[target].filename = env.DRIZZLE_DB_FILE;
    }
  }
  return config;
}

/**
 * Builder type-safe de la configuration de `@nodefony/drizzle`.
 *
 * Aligné sur `defineMongooseConfig` (l'autre driver ORM) : source unique
 * (`./schema.ts`), VALIDE + applique l'ENV + GÈLE. Le **chemin SQLite par défaut**
 * (kernel-dépendant) n'est PAS résolu ici (schéma pur) mais dans `DrizzleService`
 * au boot — cf audit config ORM 2026-06 §3.2.
 *
 * @param config - configuration brute (sections omises = défauts sûrs).
 * @returns config validée, surchargée par l'env, et gelée.
 * @throws ZodError si la config est invalide.
 */
export function defineDrizzleConfig(
  config: IDrizzleConfigInput = {},
): IDrizzleConfig {
  const parsed = drizzleConfigSchema.parse(config);
  return Object.freeze(applyEnvOverrides(parsed));
}

/**
 * JSON Schema introspectable de la config Drizzle — destiné au formulaire
 * d'édition Studio (futur) et à la documentation générée.
 */
export function drizzleConfigJsonSchema(): unknown {
  return z.toJSONSchema(drizzleConfigSchema);
}
