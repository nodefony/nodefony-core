/**
 * @nodefony/documentation — Configuration par défaut du module.
 *
 * Source de vérité = `./schema.ts` (Zod). Ce fichier expose les défauts dérivés
 * via `documentationConfigSchema.parse({})` — toujours valides par construction,
 * passés au `super(..., config)` du Module class.
 *
 * SURCHARGE PAR L'APPLICATION (fusion récursive, clé `module-documentation`) :
 *
 *   // src/modules/app/nodefony/config/config.ts
 *   export default {
 *     "module-documentation": {
 *       scan: { includeModules: false },
 *       repo: { url: "https://github.com/acme/app", editPathPrefix: "blob" },
 *       cache: { ttlMs: 0 },
 *     },
 *   };
 *
 * SURCHARGE PAR ENVIRONNEMENT (précédence max, appliquée dans le builder) :
 *   DOCS_REPO_URL · DOCS_REPO_BRANCH
 *
 * ⚠️ NE PAS éditer les valeurs ici à la main : modifier les `.default(...)` du
 * schéma, pas ce fichier. La validation + le merge env finaux sont faits dans
 * `index.ts` au hook `onKernelRegister` via `defineDocumentationConfig`.
 */
import { documentationConfigSchema, type DocumentationConfig } from "./schema";

const config: DocumentationConfig = documentationConfigSchema.parse({});

export default config;
export type { DocumentationConfig };
