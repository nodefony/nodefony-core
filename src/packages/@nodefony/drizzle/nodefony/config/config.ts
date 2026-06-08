/**
 * @nodefony/drizzle — Configuration par défaut du module.
 *
 * Source de vérité = `./schema.ts` (Zod). Ce fichier expose les défauts dérivés
 * via `drizzleConfigSchema.parse({})` — toujours valides par construction, passés
 * au `super(..., config)` du Module class.
 *
 * SURCHARGE PAR L'APPLICATION (manifeste `use()`, fusion récursive) :
 *
 *   // nodefony.config.ts
 *   use("@nodefony/drizzle", {
 *     connectors: { default: { filename: ":memory:" } },
 *   });
 *
 * SURCHARGE PAR ENVIRONNEMENT (précédence max, appliquée dans le builder) :
 *   DRIZZLE_DB_FILE
 *
 * ⚠️ Le chemin SQLite par défaut du connecteur (kernel-dépendant) n'est PAS posé
 * ici (schéma pur, `filename` optionnel) : il est résolu au boot par
 * `DrizzleService.connectAll()` quand le kernel existe. Plus de deref kernel au
 * top-level (cf CLAUDE.md racine + audit config ORM 2026-06).
 */
import { drizzleConfigSchema, type DrizzleConfig } from "./schema";

const config: DrizzleConfig = drizzleConfigSchema.parse({});

export default config;
export type { DrizzleConfig };
