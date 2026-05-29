/**
 * @nodefony/http — Configuration par défaut du module HTTP.
 *
 * Source de vérité = `./schema.ts` (Zod). Ce fichier expose les défauts dérivés
 * via `httpConfigSchema.parse({})` — toujours valides par construction, passés
 * au `super(..., config)` du Module class.
 *
 * ⚠️ NE PAS éditer les valeurs ici à la main : modifier les `.default(...)` du
 * schéma. La validation + les défauts kernel (uploadDir, certificat) sont
 * appliqués dans `index.ts` au hook `onKernelRegister` via `defineHttpConfig`.
 *
 * SURCHARGE PAR L'APPLICATION (fusion récursive, clé `module-http`) :
 *
 *   // src/modules/app/nodefony/config/config.ts
 *   export default {
 *     "module-http": {
 *       session: { name: "myapp", handler: "drizzle" },
 *       statics: { assets: { path: "public/assets" } },
 *     }
 *   };
 *
 * NB : le format de log par requête (`pretty`/`json`/`default`) se configure au
 * niveau KERNEL (`log.requestFormat`), pas ici — voir
 * `HttpKernel.applyRequestLoggerFromConfig()`.
 */
import { httpConfigSchema, type HttpConfig } from "./schema";

const config: HttpConfig = httpConfigSchema.parse({});

export default config;
export type { HttpConfig };
