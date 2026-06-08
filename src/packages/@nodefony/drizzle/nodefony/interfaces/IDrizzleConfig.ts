import type { z } from "zod";
import type { drizzleConfigSchema } from "../config/schema";

/**
 * Configuration normalisée et gelée de `@nodefony/drizzle` (sortie du builder
 * {@link defineDrizzleConfig}, consommée par le `DrizzleService`).
 *
 * Type **dérivé du schéma Zod** — NE PAS redéclarer les champs à la main.
 */
export type IDrizzleConfig = z.infer<typeof drizzleConfigSchema>;

/**
 * Entrée du builder `defineDrizzleConfig` — tous les champs portant un défaut
 * sont optionnels (l'app ne fournit que ce qu'elle surcharge dans `use()`).
 */
export type IDrizzleConfigInput = z.input<typeof drizzleConfigSchema>;

/** Définition d'une connexion Drizzle nommée (sous-objet de `connectors`). */
export type IDrizzleConnectorConfig = IDrizzleConfig["connectors"][string];
