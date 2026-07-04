import { z } from "zod";
import { httpConfigSchema } from "./config";
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
  /** Environnement courant — pilote les défauts secure-by-default (ex. `Server:`). */
  environment?: string;
}

/**
 * Injecte les défauts dérivés du kernel APRÈS le parse (le schéma reste pur).
 *
 * - `upload.uploadDir` vide → répertoire temporaire du kernel (`kernel.tmpDir`).
 * - `certificates.openssl.attrs` vide → sujet du certificat dérivé du kernel
 *   (`commonName` ← `kernel.domain`, `organizationName` ← `kernel.projectName`).
 *   Sans ce remplissage, le certificat auto-signé n'aurait pas de commonName.
 * - `certificates.san` vide → Subject Alternative Name dérivé du kernel
 *   (`localhost` + `kernel.domain` en DNS ; `127.0.0.1`/`::1` en IP). Le SAN fait
 *   foi pour la vérification d'hôte (RFC 6125) — Chrome ignore le commonName.
 *   `0.0.0.0` (bind toutes interfaces) n'est PAS un nom DNS valide → exclu.
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
  const san = config.certificates.san;
  if (san.dns.length === 0 && san.ip.length === 0) {
    const domain = kernel?.domain;
    const dns = ["localhost"];
    const ip = ["127.0.0.1", "::1"];
    // `0.0.0.0` = bind toutes interfaces, PAS un nom d'hôte → jamais en SAN.
    // Une IP littérale (ex. domain `127.0.0.1`) va en `ip`, pas en `dns` (RFC 6125).
    if (domain && domain !== "localhost" && domain !== "0.0.0.0") {
      if (/^\d{1,3}(\.\d{1,3}){3}$/.test(domain) || domain.includes(":")) {
        if (!ip.includes(domain)) {
          ip.unshift(domain);
        }
      } else {
        dns.unshift(domain);
      }
    }
    config.certificates.san = { dns, ip };
  }
  return config;
}

/**
 * Builder type-safe de la configuration de `@nodefony/http`.
 *
 * ⭐ TL;DR : MACHINERIE DE BOOT — on n'édite (presque) jamais ce fichier. Même
 * pattern que `nodefony.config.ts` ↔ `defineConfig()` du core : `config.ts` PORTE
 * la config (schéma + défauts), `define<X>Config()` la VALIDE au boot (parse +
 * env + freeze) et publie le JSON Schema Studio.
 *
 * Aligné sur `defineRedisConfig` / `defineSecurityConfig` : source unique =
 * `./config.ts` (Zod) ; le builder VALIDE puis complète les défauts kernel.
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
  // Secure-by-default en PRODUCTION : ne PAS exposer l'identité du framework dans
  // l'en-tête `Server:` (anti-fingerprint OWASP) SAUF si explicitement configuré.
  // En dev le défaut « nodefony » reste (confort/branding). Override possible par
  // env (`NF__HTTP__HEADERSERVER`) ou config app → respecté car `config.headerServer`
  // est alors défini.
  if (
    kernel?.environment === "production" &&
    config.headerServer === undefined
  ) {
    parsed.headerServer = null;
  }
  return applyKernelDefaults(parsed, kernel);
}

/**
 * JSON Schema introspectable de la config HTTP — destiné au formulaire
 * d'édition Studio (futur) et à la documentation générée.
 */
export function httpConfigJsonSchema(): unknown {
  return z.toJSONSchema(httpConfigSchema);
}
