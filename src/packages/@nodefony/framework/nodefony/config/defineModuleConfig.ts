import { z } from "zod";
import { frameworkConfigSchema } from "./config";
import type { FrameworkConfig, FrameworkConfigInput } from "./config";
import { parseModuleConfig } from "nodefony";

/**
 * Builder type-safe de la configuration de `@nodefony/framework` (PUR — ne
 * retape JAMAIS un défaut : source unique = `./config.ts`).
 *
 * ⭐ TL;DR : MACHINERIE DE BOOT — on n'édite (presque) jamais ce fichier. Même
 * pattern que `nodefony.config.ts` ↔ `defineConfig()` du core : `config.ts` PORTE
 * la config (schéma + défauts), `define<X>Config()` la VALIDE au boot (parse +
 * env + freeze) et publie le JSON Schema Studio.
 *
 * Valide la config brute contre le schéma Zod et matérialise les défauts.
 * Une config invalide échoue avec un message lisible par champ (fail-loud au
 * boot, plutôt qu'un `undefined.x` silencieux en runtime).
 *
 * @param config - configuration brute (sections omises = défauts sûrs).
 * @returns config validée (défauts matérialisés, `router`/`adminBroker`
 *   préservés tels quels — bags loose non strippés).
 * @throws BootConfigurationError si la config est invalide ou porte une clé
 *   inconnue — le boot s'interrompt, en dev comme en prod.
 */
export function defineFrameworkConfig(
  config: FrameworkConfigInput = {},
): FrameworkConfig {
  return parseModuleConfig(
    frameworkConfigSchema,
    config,
    "@nodefony/framework",
  );
}

/**
 * JSON Schema introspectable de la config framework — destiné au formulaire
 * d'édition Studio et à la documentation générée (les flags de champ posés via
 * `.meta()` sont recopiés par `z.toJSONSchema`).
 */
export function frameworkConfigJsonSchema(): unknown {
  return z.toJSONSchema(frameworkConfigSchema);
}
