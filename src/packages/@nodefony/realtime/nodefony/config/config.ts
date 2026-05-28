/**
 * NODEFONY FRAMEWORK — Configuration DEFAULT de `@nodefony/realtime`.
 *
 * Source de vérité = `./schema.ts` (Zod). Ce fichier expose les défauts dérivés
 * via `realtimeConfigSchema.parse({})` — utile pour le `super(..., config)` du
 * Module class (toujours valide par construction).
 *
 * Surcharge côté app : clé `module-realtime` dans le `config.ts` racine, ou prop
 * `module.options` du module consumer. La fusion + validation finale est faite
 * dans `index.ts` au hook `onKernelRegister` (plante propre si invalide).
 *
 * ⚠️ NE PAS éditer les valeurs ici à la main : modifier les `.default(...)` du
 * schéma, pas ce fichier.
 */
import { realtimeConfigSchema, type RealtimeConfig } from "./schema";

const config: RealtimeConfig = realtimeConfigSchema.parse({});

export default config;
export type { RealtimeConfig };
