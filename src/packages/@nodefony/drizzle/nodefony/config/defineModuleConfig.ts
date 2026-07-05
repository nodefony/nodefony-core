import { z } from "zod";
import { resolveInfra, sqliteFilenameFromUrl } from "nodefony";
import { drizzleConfigSchema } from "./config";
import type {
  IDrizzleConfig,
  IDrizzleConfigInput,
} from "../interfaces/IDrizzleConfig";

/**
 * Applique la surcharge par variables d'environnement APRÈS le parse Zod.
 *
 * Le schéma reste pur ; l'env est une couche explicite par-dessus. Précédence :
 * env > config app > défauts.
 *
 * - Infra `database` (`NF_DATABASE_URL`, alias `DATABASE_URL`) de famille SQL →
 *   dialecte + cible du connecteur primaire (`default`, sinon le premier) :
 *   `sqlite:…` → `filename` ; `postgres://…`/`mysql://…` → `url`. Une URL
 *   `mongodb://` est IGNORÉE ici (l'infra appartient alors à `@nodefony/mongoose`).
 */
function applyEnvOverrides(config: IDrizzleConfig): IDrizzleConfig {
  const database = resolveInfra(process.env).database;
  if (database && database.family === "sql" && database.dialect) {
    const target = config.connectors.default
      ? "default"
      : Object.keys(config.connectors)[0];
    const connector = target ? config.connectors[target] : undefined;
    if (connector) {
      connector.dialect = database.dialect;
      if (database.dialect === "sqlite") {
        connector.filename = sqliteFilenameFromUrl(database.url);
        delete connector.url;
      } else {
        connector.url = database.url;
        delete connector.filename;
      }
    }
  }
  return config;
}

/**
 * Builder type-safe de la configuration de `@nodefony/drizzle`.
 *
 * ⭐ TL;DR : MACHINERIE DE BOOT — on n'édite (presque) jamais ce fichier. Même
 * pattern que `nodefony.config.ts` ↔ `defineConfig()` du core : `config.ts` PORTE
 * la config (schéma + défauts), `define<X>Config()` la VALIDE au boot (parse +
 * env + freeze) et publie le JSON Schema Studio.
 *
 * Aligné sur `defineMongooseConfig` (l'autre driver ORM) : source unique
 * (`./config.ts`), VALIDE + applique l'ENV + GÈLE. Le **chemin SQLite par défaut**
 * (kernel-dépendant) n'est PAS résolu ici (schéma pur) mais dans `DrizzleService`
 * au boot — cf audit config ORM 2026-06 §3.2.
 *
 * @param config - configuration brute (sections omises = défauts sûrs).
 * @returns config validée, surchargée par l'env, et gelée.
 * @throws ZodError si la config est invalide.
 */
export function defineDrizzleConfig(
  config: IDrizzleConfigInput = {},
): IDrizzleConfig {
  const parsed = drizzleConfigSchema.parse(config);
  return Object.freeze(applyEnvOverrides(parsed));
}

/**
 * JSON Schema introspectable de la config Drizzle — destiné au formulaire
 * d'édition Studio (futur) et à la documentation générée.
 */
export function drizzleConfigJsonSchema(): unknown {
  return z.toJSONSchema(drizzleConfigSchema);
}
