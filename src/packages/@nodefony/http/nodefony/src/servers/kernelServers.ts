import type { ServersConfig } from "nodefony";

/**
 * Rétrécit la section `servers` de la configuration du kernel (lue dans le sac
 * de config non typé du cœur) en {@link ServersConfig}, sans propager `any`.
 *
 * Seule lecture de `kernel.options.servers` dans `@nodefony/http` : les serveurs
 * et le `HttpKernel` passent tous par ici.
 *
 * @param servers - la valeur brute de `kernel.options.servers`.
 * @returns la section typée, ou `undefined` si elle est absente ou n'est pas un objet.
 */
export function asServersConfig(servers: unknown): ServersConfig | undefined {
  return servers !== null && typeof servers === "object" ? servers : undefined;
}

/**
 * Le serveur h2c démarre-t-il ? Seul un `enabled: true` EXPLICITE l'allume : la
 * section existe toujours (défauts), un port seul ne vaut pas activation.
 *
 * @param entry - `servers.h2c`.
 */
export function isH2cEnabled(
  entry: { enabled?: boolean | undefined } | undefined,
): boolean {
  return entry?.enabled === true;
}

/**
 * Port DEMANDÉ pour un serveur (`servers.<type>.port`), ou `undefined` si le
 * serveur est désactivé, absent, ou sans port numérique.
 *
 * @param servers - section `servers` déjà rétrécie ({@link asServersConfig}).
 * @param type - le serveur visé.
 */
export function configuredServerPort(
  servers: ServersConfig | undefined,
  type: "http" | "https" | "h2c",
): number | undefined {
  const entry = servers?.[type];
  if (!entry) return undefined;
  if (type === "h2c" && !isH2cEnabled(servers.h2c)) return undefined;
  const port: unknown = entry.port;
  return typeof port === "number" ? port : undefined;
}
