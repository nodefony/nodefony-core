/**
 * @nodefony/documentation — Builder de configuration validée (Zod) + ENV.
 *
 * ⭐ TL;DR : MACHINERIE DE BOOT — on n'édite (presque) jamais ce fichier. Même
 * pattern que `nodefony.config.ts` ↔ `defineConfig()` du core : `config.ts` PORTE
 * la config (schéma + défauts), `define<X>Config()` la VALIDE au boot (parse +
 * env + freeze) et publie le JSON Schema Studio.
 *
 * Sépare la VALIDATION (schéma pur de `config.ts`) de l'APPLICATION des variables
 * d'environnement : le schéma reste déterministe (sérialisable en JSON Schema
 * pour Studio), et l'env est appliqué APRÈS le parse, ici.
 *
 * @see ./config.ts — source de vérité (types dérivés via z.infer)
 */
import { z } from "zod";
import { documentationConfigSchema, type DocumentationConfig } from "./config";
import { parseModuleConfig } from "nodefony";

/** Lit une variable d'env non vide, ou `undefined` si absente/vide. */
function env(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() !== "" ? v.trim() : undefined;
}

/**
 * Valide une config partielle (défauts du schéma) PUIS applique la surcharge par
 * variables d'environnement (précédence max).
 *
 * @param input - config partielle (depuis `module.options.documentation`)
 * @returns config validée, défauts appliqués, env mergé
 * @throws ZodError si l'input viole le schéma
 */
export function defineDocumentationConfig(
  input: unknown = {},
): DocumentationConfig {
  const parsed = parseModuleConfig(
    documentationConfigSchema,
    input ?? {},
    "@nodefony/documentation",
  );

  // Surcharge ENV (précédence max) — appliquée APRÈS le parse pour garder le
  // schéma pur et déterministe. Utile en CI/prod détaché de git.
  const repoUrlEnv = env("DOCS_REPO_URL");
  if (repoUrlEnv) parsed.repo.url = repoUrlEnv;

  const branchEnv = env("DOCS_REPO_BRANCH");
  if (branchEnv) parsed.repo.branch = branchEnv;

  return parsed;
}

/**
 * JSON Schema introspectable de la config documentation — destiné au panneau de
 * config Studio (`/nodefony/config`). N'inclut PAS la surcharge ENV (appliquée
 * hors schéma, dans le builder).
 */
export function documentationConfigJsonSchema(): unknown {
  return z.toJSONSchema(documentationConfigSchema);
}

export { documentationConfigSchema } from "./config";
