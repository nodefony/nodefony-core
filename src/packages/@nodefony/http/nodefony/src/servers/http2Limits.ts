import type { ServerOptions } from "node:http2";
import type { IHttpConfig } from "../../config/config";

/**
 * Limites anti-DoS d'un serveur HTTP/2, lues dans la section `http2` du module :
 * `maxSessionMemory` (amplification mémoire) et `maxConcurrentStreams` dans les
 * SETTINGS (CVE-2023-44487, Rapid Reset). Règle UNIQUE des serveurs HTTP/2 — TLS
 * (5152) comme h2c — : une limite oubliée sur l'un d'eux en ferait la porte de
 * l'attaque.
 *
 * Une limite absente garde le défaut de Node (aucune régression).
 *
 * @param limits - `module.options.http2`.
 * @returns les options à fusionner dans celles de `createServer`/`createSecureServer`.
 */
export function http2ServerLimits(
  limits: Partial<IHttpConfig["http2"]> | undefined,
): Pick<ServerOptions, "maxSessionMemory" | "settings"> {
  const options: Pick<ServerOptions, "maxSessionMemory" | "settings"> = {};
  if (limits?.maxSessionMemory) {
    options.maxSessionMemory = limits.maxSessionMemory;
  }
  if (limits?.maxConcurrentStreams) {
    options.settings = { maxConcurrentStreams: limits.maxConcurrentStreams };
  }
  return options;
}
