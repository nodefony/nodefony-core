/**
 * @nodefony/documentation — Builder de configuration validée (Zod) + ENV.
 *
 * ⭐ TL;DR : MACHINERIE DE BOOT — on n'édite (presque) jamais ce fichier. Même
 * pattern que `nodefony.config.ts` ↔ `defineConfig()` du core : `config.ts` PORTE
 * la config (schéma + défauts), `define<X>Config()` la VALIDE au boot (parse +
 * env + freeze) et publie le JSON Schema Studio.
 *
 * Ce builder ne lit AUCUNE variable d'environnement : `NF_DOCS_REPO_URL` et
 * `NF_DOCS_REPO_BRANCH` sont déclarées sur leur champ dans `config.ts`
 * (`.meta({ env })`) et posées par le Kernel AVANT la validation — le schéma
 * les valide comme une valeur de l'application.
 *
 * @see ./config.ts — source de vérité (types dérivés via z.infer)
 */
import { documentationConfigSchema, type IDocumentationConfig } from "./config";
import { configJsonSchema } from "./configSchema";
import { parseModuleConfig } from "nodefony";

/**
 * Valide une config partielle et applique les défauts du schéma.
 *
 * @param input - config partielle (depuis `module.options.documentation`),
 *   noms courts d'environnement déjà posés par le Kernel
 * @returns config validée, défauts appliqués
 * @throws BootConfigurationError si l'input viole le schéma
 */
export function defineDocumentationConfig(
  input: unknown = {},
): IDocumentationConfig {
  return parseModuleConfig(
    documentationConfigSchema,
    input ?? {},
    "@nodefony/documentation",
  );
}

/**
 * JSON Schema introspectable de la config documentation — destiné au panneau de
 * config Studio (`/nodefony/config`), noms courts d'environnement compris.
 */
export function documentationConfigJsonSchema(): unknown {
  return configJsonSchema();
}

export { documentationConfigSchema } from "./config";
