import { z } from "zod";
import { httpConfigSchema } from "./schema";
import type { IHttpConfig, IHttpConfigInput } from "../interfaces/IHttpConfig";

/**
 * Sous-ensemble structurel du kernel nécessaire aux défauts dérivés — découple
 * le builder du type `Kernel`/`IKernel` (testable sans kernel complet). Tous les
 * champs sont optionnels : un kernel absent ou minimal retombe sur les fallbacks.
 */
export interface IKernelConfigDefaults {
  tmpDir?: { path?: unknown } | null;
  domain?: string;
  projectName?: string;
}

/**
 * Injecte les défauts dérivés du kernel APRÈS le parse (le schéma reste pur).
 *
 * - `upload.uploadDir` vide → répertoire temporaire du kernel (`kernel.tmpDir`).
 * - `certificates.openssl.attrs` vide → sujet du certificat dérivé du kernel
 *   (`commonName` ← `kernel.domain`, `organizationName` ← `kernel.projectName`).
 *   Sans ce remplissage, le certificat auto-signé n'aurait pas de commonName.
 *
 * Muté EN PLACE (pas de copie) : la config est ré-assignée à `module.options`
 * dans `onKernelRegister`, AVANT que les `@services` (qui lisent et mutent
 * `module.options` — ex. `uploadDir`, `serialNumber`) ne soient instanciés à
 * `onBoot`. C'est pourquoi la config N'EST PAS gelée (≠ `@nodefony/redis`).
 *
 * @param config - config déjà parsée (sortie du schéma).
 * @param kernel - kernel courant (présent à `onKernelRegister`).
 * @returns la même config, complétée.
 */
function applyKernelDefaults(
  config: IHttpConfig,
  kernel?: IKernelConfigDefaults | null,
): IHttpConfig {
  if (!config.upload.uploadDir) {
    const p = kernel?.tmpDir?.path;
    config.upload.uploadDir = typeof p === "string" ? p : "/tmp";
  }
  if (config.certificates.openssl.attrs.length === 0) {
    config.certificates.openssl.attrs = [
      { name: "commonName", value: kernel?.domain ?? "nodefony.com" },
      { name: "organizationName", value: kernel?.projectName ?? "" },
      { name: "organizationalUnitName", value: "Development" },
    ];
  }
  return config;
}

/**
 * Builder type-safe de la configuration de `@nodefony/http`.
 *
 * Aligné sur `defineRedisConfig` / `defineSecurityConfig` : source unique =
 * `./schema.ts` (Zod) ; le builder VALIDE puis complète les défauts kernel.
 *
 * @param config - configuration brute (sections omises = défauts sûrs).
 * @param kernel - kernel courant, pour les défauts dérivés (tmpDir, domain).
 * @returns config validée et complétée (NON gelée — les services la mutent).
 * @throws ZodError si la config est invalide.
 */
export function defineHttpConfig(
  config: IHttpConfigInput = {},
  kernel?: IKernelConfigDefaults | null,
): IHttpConfig {
  const parsed = httpConfigSchema.parse(config) as IHttpConfig;
  return applyKernelDefaults(parsed, kernel);
}

/**
 * JSON Schema introspectable de la config HTTP — destiné au formulaire
 * d'édition Studio (futur) et à la documentation générée.
 */
export function httpConfigJsonSchema(): unknown {
  return z.toJSONSchema(httpConfigSchema);
}
