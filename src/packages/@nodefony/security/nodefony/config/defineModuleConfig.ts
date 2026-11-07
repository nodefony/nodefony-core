import { z } from "zod";
import { securityConfigSchema } from "./config";
import type { ISecurityConfig, ISecurityConfigInput } from "./config";
import { parseModuleConfig, BootConfigurationError } from "nodefony";

/**
 * Builder type-safe de la configuration de sécurité Nodefony (PUR — ne retape
 * JAMAIS un défaut : source unique = `./config.ts`, le schéma Zod commenté).
 *
 * ⭐ TL;DR : MACHINERIE DE BOOT — on n'édite (presque) jamais ce fichier. Même
 * pattern que `nodefony.config.ts` ↔ `defineConfig()` du core : `config.ts` PORTE
 * la config (schéma + défauts), `define<X>Config()` la VALIDE au boot (parse +
 * env + freeze) et publie le JSON Schema Studio.
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
  const validated = parseModuleConfig(
    securityConfigSchema,
    config,
    "@nodefony/security",
  );
  detectConflicts(validated.areas);
  resolveAreaResources(validated.areas, validated.jwt.issuer);
  return Object.freeze(validated);
}

/**
 * Rend absolue la `resource` d'une zone écrite comme un CHEMIN (`/api/partner`),
 * contre l'émetteur des jetons de l'application (`jwt.issuer`) — son URL
 * publique, celle que voient les clients.
 *
 * Pourquoi : un MODULE qui apporte sa zone à jeton (surcharge
 * `module-security`) ne connaît pas l'adresse publique de l'application — elle
 * vient de l'environnement, que seul `env.ts` lit. Le chemin est ce qu'il
 * connaît ; l'origine est ce que l'application a déjà ÉCRIT une fois. La valeur
 * reste donc écrite, jamais dérivée du `Host`.
 *
 * Concaténation, pas `new URL(chemin, base)` : un émetteur qui porte un chemin
 * (`https://exemple.com/auth`) le garde, comme le fait déjà l'adresse publique
 * des gabarits (`${publicBaseUrl}/api/…`).
 *
 * @param areas - zones validées (mutées sur place, avant le gel)
 * @param issuer - `jwt.issuer` validé
 * @throws BootConfigurationError si un chemin est relatif au protocole (`//…`),
 *   ou si l'émetteur n'est pas une URL http(s) — retirer la zone ouvrirait ses
 *   routes à la zone voisine, donc on refuse de démarrer en nommant le geste.
 */
function resolveAreaResources(
  areas: ISecurityConfig["areas"],
  issuer: string | undefined,
): void {
  for (const name in areas) {
    const area = areas[name];
    const resource = area?.resource;
    if (area === undefined || resource === undefined) continue;
    if (!resource.startsWith("/")) continue;
    if (resource.startsWith("//")) {
      throw new BootConfigurationError(
        `[@nodefony/security] areas.${name}.resource « ${resource} » : un chemin ` +
          `commence par UN seul « / » — « // » désigne un autre hôte.`,
      );
    }
    const base = publicIssuerBase(issuer);
    if (base === null) {
      throw new BootConfigurationError(
        `[@nodefony/security] areas.${name}.resource « ${resource} » est un chemin, ` +
          `rendu absolu contre jwt.issuer — qui n'est pas une URL http(s) ` +
          `(« ${issuer ?? "nodefony"} »). Pose jwt.issuer à l'adresse publique de ` +
          `l'application (une application générée la lit dans NF_JWT_ISSUER), ou ` +
          `écris la ressource en entier (https://…).`,
      );
    }
    area.resource = `${base}${resource}`;
  }
}

/**
 * L'émetteur, sans `/` final, s'il est une URL http(s) — sinon `null`.
 *
 * @param issuer - `jwt.issuer` validé
 * @returns la base contre laquelle résoudre un chemin, ou `null`
 */
function publicIssuerBase(issuer: string | undefined): string | null {
  if (issuer === undefined) return null;
  let url: URL;
  try {
    url = new URL(issuer);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  return issuer.replace(/\/+$/u, "");
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
      // Même famille que les refus du schéma : une ambiguïté de zone est une
      // faute de CONFIGURATION, et une `Error` ordinaire serait absorbée par le
      // fail-soft du kernel en développement.
      throw new BootConfigurationError(
        `[@nodefony/security] zones "${prev}" et "${name}" partagent le motif ` +
          `"${area.pattern}" — deux zones qui matchent la même route rendent la ` +
          `règle appliquée imprévisible. Renomme le motif de l'une des deux.`,
      );
    }
    seen.set(area.pattern, name);
  }
}
