/**
 * @nodefony/redis — Configuration par défaut du module Redis.
 *
 * Source de vérité = `./schema.ts` (Zod). Ce fichier expose les défauts dérivés
 * via `redisConfigSchema.parse({})` — toujours valides par construction, passés
 * au `super(..., config)` du Module class.
 *
 * SURCHARGE PAR L'APPLICATION (fusion récursive, clé `module-redis`) :
 *
 *   // src/modules/app/nodefony/config/config.ts
 *   export default {
 *     "module-redis": {
 *       globalOptions: { socket: { host: "redis.internal", tls: true } },
 *       connections: { cache: { name: "cache", database: 1 } },
 *     },
 *   };
 *
 * SURCHARGE PAR ENVIRONNEMENT (précédence max, appliquée dans le builder) :
 *   REDIS_URL · REDIS_HOST · REDIS_PORT · REDIS_PASSWORD
 *
 * ⚠️ NE PAS éditer les valeurs ici à la main : modifier les `.default(...)` du
 * schéma, pas ce fichier. La validation + le merge env finaux sont faits dans
 * `index.ts` au hook `onKernelRegister` via `defineRedisConfig`.
 */
import { redisConfigSchema, type RedisConfig } from "./schema";

const config: RedisConfig = redisConfigSchema.parse({});

export default config;
export type { RedisConfig };
