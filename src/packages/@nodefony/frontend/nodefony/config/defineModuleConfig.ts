import { z } from "zod";
import { frontendConfigSchema, type FrontendConfig } from "./config";

/**
 * Builder type-safe de la configuration de `@nodefony/frontend`.
 *
 * ⭐ TL;DR : MACHINERIE DE BOOT — on n'édite (presque) jamais ce fichier. Même
 * pattern que `nodefony.config.ts` ↔ `defineConfig()` du core : `config.ts` PORTE
 * la config (schéma + défauts), `define<X>Config()` la VALIDE au boot (parse +
 * env + freeze) et publie le JSON Schema Studio.
 *
 * Principes (alignés sur `defineRealtimeConfig` / famille ORM) :
 * - **Source unique** : `./config.ts` (Zod). Le builder VALIDE + GÈLE, ne dévie pas.
 * - **Auto-documenté + introspectable** : chaque champ Zod porte `.describe()` →
 *   {@link frontendConfigJsonSchema} produit un JSON Schema que le panneau de
 *   config Studio consomme.
 *
 * @param config - configuration brute (sections omises = défauts sûrs).
 * @returns config gelée prête pour `FrontendService`.
 * @throws ZodError si invalide.
 */
export function defineFrontendConfig(
  config: IFrontendConfigInput = {},
): FrontendConfig {
  return Object.freeze(frontendConfigSchema.parse(config));
}

/**
 * JSON Schema introspectable de la config frontend — destiné au panneau de config
 * Studio (`/nodefony/config`).
 */
export function frontendConfigJsonSchema(): unknown {
  return z.toJSONSchema(frontendConfigSchema);
}

/** Entrée du builder (champs avec défaut optionnels). */
export type IFrontendConfigInput = z.input<typeof frontendConfigSchema>;

export type { FrontendConfig };
