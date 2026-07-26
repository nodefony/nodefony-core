import { z } from "zod";
import { frameworkConfigSchema } from "./config";
import type { FrameworkConfig, FrameworkConfigInput } from "./config";

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
 * @throws Error si la config est invalide (issues Zod agrégées).
 */
export function defineFrameworkConfig(
  config: FrameworkConfigInput = {},
): FrameworkConfig {
  try {
    return frameworkConfigSchema.parse(config);
  } catch (e) {
    const issues =
      e instanceof Error && "issues" in e && Array.isArray(e.issues)
        ? (e.issues as Array<{ path: (string | number)[]; message: string }>)
            .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
            .join(" · ")
        : (e as Error).message;
    throw new Error(`[@nodefony/framework] Invalid config: ${issues}`, {
      cause: e,
    });
  }
}

/**
 * JSON Schema introspectable de la config framework — destiné au formulaire
 * d'édition Studio et à la documentation générée (les flags de champ posés via
 * `.meta()` sont recopiés par `z.toJSONSchema`).
 */
export function frameworkConfigJsonSchema(): unknown {
  return z.toJSONSchema(frameworkConfigSchema);
}
