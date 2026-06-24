/**
 * NODEFONY FRAMEWORK — Configuration DEFAULT de `@nodefony/frontend`.
 *
 * Ce module pilote Vite (builder + dev server) pour transpiler les frontends
 * déclarés par chaque module Nodefony :
 *
 *   { frontend: { type: "react19", entry: "./frontend/src/main.tsx" } }
 *
 * **Source de vérité = `./schema.ts` (Zod).** Ce fichier expose les défauts
 * dérivés via `frontendConfigSchema.parse({})` — utile pour le `super(..., config)`
 * du Module class (toujours valide par construction). La fusion + validation
 * finale (`défauts + module.options`) est faite dans `index.ts` au hook
 * `onKernelRegister` via `defineFrontendConfig` (plante propre si invalide).
 *
 * ⚠️ NE PAS éditer les valeurs ici à la main : modifier les `.default(...)` du
 * schéma, pas ce fichier. La doc complète de chaque champ vit dans `./schema.ts`
 * (`.describe(...)`), surfacée dans le panneau de config Studio.
 *
 * Surcharge côté app : clé `module-frontend` dans le `config.ts` racine, ou prop
 * `module.options` du module consumer.
 */
import { frontendConfigSchema, type FrontendConfig } from "./schema";

const config: FrontendConfig = frontendConfigSchema.parse({});

export default config;
export type { FrontendConfig };
