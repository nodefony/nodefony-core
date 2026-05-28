import { z } from "zod";
import { redisConfigSchema } from "./schema";
import type {
  IRedisConfig,
  IRedisConfigInput,
} from "../interfaces/IRedisConfig";

/**
 * Applique la surcharge par variables d'environnement APRÈS le parse Zod.
 *
 * Le schéma reste pur (déterministe, sérialisable en JSON Schema) ; l'env est
 * une couche explicite par-dessus. Précédence : env > config app > défauts.
 *
 * - `REDIS_URL`   → `config.url` (gagne sur host/port/auth pour toutes les conn.)
 * - `REDIS_HOST`  → `globalOptions.socket.host`
 * - `REDIS_PORT`  → `globalOptions.socket.port`
 * - `REDIS_PASSWORD` → `globalOptions.password` (secret JAMAIS dans la config)
 */
function applyEnvOverrides(config: IRedisConfig): IRedisConfig {
  const env = process.env;
  if (env.REDIS_URL) {
    config.url = env.REDIS_URL;
  }
  if (env.REDIS_HOST) {
    config.globalOptions.socket.host = env.REDIS_HOST;
  }
  if (env.REDIS_PORT) {
    const port = Number.parseInt(env.REDIS_PORT, 10);
    if (Number.isInteger(port) && port > 0 && port <= 65_535) {
      config.globalOptions.socket.port = port;
    }
  }
  if (env.REDIS_PASSWORD) {
    config.globalOptions.password = env.REDIS_PASSWORD;
  }
  return config;
}

/**
 * Builder type-safe de la configuration de `@nodefony/redis`.
 *
 * Principes (alignés sur `defineRealtimeConfig` / `defineSecurityConfig`) :
 * - **Source unique** : `./schema.ts` (Zod). Le builder VALIDE, applique l'ENV,
 *   puis GÈLE — il ne dévie jamais du schéma.
 * - **Auto-documenté** : chaque champ Zod porte un `.describe()` →
 *   {@link redisConfigJsonSchema} produit un JSON Schema qu'un formulaire Studio
 *   (futur) consommera pour générer son UI d'édition.
 *
 * @param config - configuration brute (sections omises = défauts sûrs).
 * @returns config validée, surchargée par l'env, et gelée.
 * @throws ZodError si la config est invalide.
 */
export function defineRedisConfig(
  config: IRedisConfigInput = {},
): IRedisConfig {
  const parsed = redisConfigSchema.parse(config);
  return Object.freeze(applyEnvOverrides(parsed));
}

/**
 * JSON Schema introspectable de la config Redis — destiné au formulaire
 * d'édition Studio (futur) et à la documentation générée.
 */
export function redisConfigJsonSchema(): unknown {
  return z.toJSONSchema(redisConfigSchema);
}
