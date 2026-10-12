import { resolveInfra, parseModuleConfig } from "nodefony";
import { redisConfigSchema } from "./config";
import { configJsonSchema } from "./configSchema";
import type {
  IRedisConfig,
  IRedisConfigInput,
} from "../interfaces/IRedisConfig";

/**
 * Applique l'URL d'infrastructure de cache APRÈS le parse Zod.
 *
 * `NF_REDIS_URL` (alias plateforme `REDIS_URL`) → `config.url`, qui gagne sur
 * host/port/auth pour toutes les connexions. La résolution est déléguée à
 * `resolveInfra` (cœur) — source UNIQUE des alias, partagée avec
 * drizzle/mongoose.
 *
 * Les autres variables (`NF_REDIS_HOST`, `NF_REDIS_PORT`, `NF_REDIS_PASSWORD`,
 * `NF_REDIS_KEY_NAMESPACE`) ne s'écrivent PAS ici : chacune est déclarée sur
 * son champ dans `config.ts` (`.meta({ env })`), et le Kernel l'applique avant
 * la validation — la même déclaration nourrit `nodefony env` et la notice
 * `.env.example`.
 */
function applyEnvOverrides(config: IRedisConfig): IRedisConfig {
  const cacheUrl = resolveInfra(process.env).cache?.url;
  if (cacheUrl) {
    config.url = cacheUrl;
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
  const parsed = parseModuleConfig(
    redisConfigSchema,
    config,
    "@nodefony/redis",
  );
  applyResilienceDefaults(parsed, config);
  return Object.freeze(applyEnvOverrides(parsed));
}

/**
 * JSON Schema introspectable de la config Redis — destiné au formulaire
 * d'édition Studio (futur) et à la documentation générée.
 */
export function redisConfigJsonSchema(): unknown {
  return configJsonSchema();
}
