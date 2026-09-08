import { z } from "zod";
import { parseModuleConfig } from "nodefony";
import { studioConfigSchema } from "./config";
import type {
  IStudioConfig,
  IStudioConfigInput,
} from "../interfaces/IStudioConfig";

/**
 * Builder type-safe de la configuration de `@nodefony/studio`.
 *
 * ⭐ TL;DR : MACHINERIE DE BOOT — on n'édite (presque) jamais ce fichier. Même
 * pattern que `nodefony.config.ts` ↔ `defineConfig()` du core : `config.ts`
 * PORTE la config (schéma + défauts), `defineStudioConfig()` la VALIDE au boot
 * (parse + freeze) et publie le JSON Schema pour Studio.
 *
 * Aucun `try`/`catch` : `parseModuleConfig` lève une `BootConfigurationError`
 * nommant le module et la clé fautive — seule erreur fatale en développement.
 * La ré-emballer en `Error` ordinaire la ferait absorber par le fail-soft du
 * kernel, précisément là où la faute vient d'être écrite.
 *
 * @param config - configuration brute (sections omises = défauts sûrs).
 * @returns config validée et gelée.
 * @throws BootConfigurationError si la config est invalide.
 */
export function defineStudioConfig(
  config: IStudioConfigInput = {},
): IStudioConfig {
  return Object.freeze(
    parseModuleConfig(studioConfigSchema, config, "@nodefony/studio"),
  );
}

/**
 * JSON Schema introspectable de la config Studio — destiné au formulaire
 * d'édition Studio et à la documentation générée.
 */
export function studioConfigJsonSchema(): unknown {
  return z.toJSONSchema(studioConfigSchema);
}
