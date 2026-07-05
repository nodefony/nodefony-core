import { z } from "zod";
import { resolveInfra } from "nodefony";
import { redisConfigSchema } from "./config";
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
 * - Infra cache `NF_REDIS_URL` (alias plateforme `REDIS_URL`) → `config.url`
 *   (gagne sur host/port/auth pour toutes les connexions). La résolution de
 *   l'URL de cache est déléguée à `resolveInfra` (core) — source UNIQUE des
 *   alias, partagée avec drizzle/mongoose ; pas de réimplémentation locale.
 * - `REDIS_HOST`  → `globalOptions.socket.host`
 * - `REDIS_PORT`  → `globalOptions.socket.port`
 * - `REDIS_PASSWORD` → `globalOptions.password` (secret JAMAIS dans la config)
 */
function applyEnvOverrides(config: IRedisConfig): IRedisConfig {
  const env = process.env;
  const cacheUrl = resolveInfra(env).cache?.url;
  if (cacheUrl) {
    config.url = cacheUrl;
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

/** Plafond de reconnexions appliqué hors production quand l'app n'en fixe pas. */
const DEV_DEFAULT_MAX_RETRIES = 5;

/**
 * Hors production, borne les reconnexions Redis à un nombre **fini** quand l'app
 * ne l'a PAS surchargé.
 *
 * Pourquoi : le défaut du schéma est `0` = illimité (résilience prod légitime,
 * un orchestrateur relèvera Redis). Mais en dev avec Redis absent, node-redis
 * retente sans fin et sa **file offline fait pendre** tout `await client.subscribe()`
 * au boot → le backplane realtime ne rend jamais la main → les serveurs ne montent
 * pas. Un plafond fini fait que `reconnectStrategy` finit par renvoyer une `Error`
 * → node-redis abandonne → la file offline **rejette** au lieu de pendre.
 *
 * Détection « non surchargé » : on inspecte l'**input brut** (le défaut `0` du
 * schéma est indistinguable d'un `0` explicite après le parse). Prod = inchangé.
 *
 * @param config - config déjà parsée (mutée en place avant le `freeze`).
 * @param input - config brute fournie par l'app, pour détecter une surcharge.
 * @returns la même config.
 */
function applyResilienceDefaults(
  config: IRedisConfig,
  input: IRedisConfigInput,
): IRedisConfig {
  if (process.env.NODE_ENV === "production") return config;
  const userMaxRetries =
    input.globalOptions?.socket?.reconnectStrategy?.maxRetries;
  if (userMaxRetries === undefined) {
    config.globalOptions.socket.reconnectStrategy.maxRetries =
      DEV_DEFAULT_MAX_RETRIES;
  }
  return config;
}

/**
 * Builder type-safe de la configuration de `@nodefony/redis`.
 *
 * ⭐ TL;DR : MACHINERIE DE BOOT — on n'édite (presque) jamais ce fichier. Même
 * pattern que `nodefony.config.ts` ↔ `defineConfig()` du core : `config.ts` PORTE
 * la config (schéma + défauts), `define<X>Config()` la VALIDE au boot (parse +
 * env + freeze) et publie le JSON Schema Studio.
 *
 * Principes (alignés sur `defineRealtimeConfig` / `defineSecurityConfig`) :
 * - **Source unique** : `./config.ts` (Zod). Le builder VALIDE, applique l'ENV,
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
  applyResilienceDefaults(parsed, config);
  return Object.freeze(applyEnvOverrides(parsed));
}

/**
 * JSON Schema introspectable de la config Redis — destiné au formulaire
 * d'édition Studio (futur) et à la documentation générée.
 */
export function redisConfigJsonSchema(): unknown {
  return z.toJSONSchema(redisConfigSchema);
}
