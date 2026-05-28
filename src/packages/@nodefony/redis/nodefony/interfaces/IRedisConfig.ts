import type { z } from "zod";
import type { redisConfigSchema } from "../config/schema";

/**
 * Configuration normalisée et gelée de `@nodefony/redis` (sortie du builder
 * {@link defineRedisConfig}, lue par le `RedisService`).
 *
 * Type dérivé du schéma Zod — NE PAS redéclarer les champs à la main (ils
 * divergeraient silencieusement de la source de vérité `config/schema.ts`).
 */
export type IRedisConfig = z.infer<typeof redisConfigSchema>;

/**
 * Entrée du builder `defineRedisConfig` — tous les champs portant un défaut
 * sont optionnels (l'app ne fournit que ce qu'elle surcharge).
 */
export type IRedisConfigInput = z.input<typeof redisConfigSchema>;

/** Définition d'une connexion Redis nommée (sous-objet de `connections`). */
export type IRedisConnectionConfig = IRedisConfig["connections"][string];
