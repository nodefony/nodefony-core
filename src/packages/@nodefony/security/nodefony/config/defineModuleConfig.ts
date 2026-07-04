import { z } from "zod";
import { securityConfigSchema } from "./config";
import type { ISecurityConfig, ISecurityConfigInput } from "./config";

/**
 * Builder type-safe de la configuration de sécurité Nodefony (PUR — ne retape
 * JAMAIS un défaut : source unique = `./config.ts`, le schéma Zod commenté).
 *
 * Valide + normalise + gèle ; conflits de patterns de zones détectés au boot.
 */

export type {
  ISecurityConfig,
  ISecurityConfigInput,
  ISecurityAreaConfig,
} from "./config";

/**
 * Valide + normalise + gèle la configuration de sécurité.
 *
 * @param config - configuration brute de l'app (sections omises = défauts sûrs).
 * @returns config gelée prête pour le firewall.
 * @throws ZodError si invalide ; Error si deux zones partagent un pattern.
 */
export function defineSecurityConfig(
  config: ISecurityConfigInput = {},
): ISecurityConfig {
  const validated = securityConfigSchema.parse(config);
  detectConflicts(validated.areas);
  return Object.freeze(validated);
}

/**
 * JSON Schema introspectable de la config sécurité — **Studio génère son
 * formulaire d'édition depuis ça** (labels/types/défauts/descriptions),
 * sans UI hardcodée. Surface du data plane `/nodefony/security/api/config/schema`.
 */
export function securityConfigJsonSchema(): unknown {
  return z.toJSONSchema(securityConfigSchema);
}

/** Refuse deux zones avec le même pattern (ambiguïté de match, détectée au boot). */
function detectConflicts(areas: Record<string, { pattern: string }>): void {
  const seen = new Map<string, string>();
  for (const [name, area] of Object.entries(areas)) {
    const prev = seen.get(area.pattern);
    if (prev) {
      throw new Error(
        `defineSecurityConfig: zones "${prev}" et "${name}" partagent le pattern "${area.pattern}".`,
      );
    }
    seen.set(area.pattern, name);
  }
}
