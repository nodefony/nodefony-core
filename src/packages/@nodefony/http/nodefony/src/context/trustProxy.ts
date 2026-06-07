import { BlockList, isIPv4, isIPv6 } from "node:net";

/**
 * Politique de confiance envers les en-têtes `X-Forwarded-*` (et le scheme
 * proxifié), pour décider si la connexion entrante provient d'un reverse-proxy
 * légitime.
 *
 * Sans cette barrière, n'importe quel client peut envoyer
 * `X-Forwarded-For: 1.2.3.4` → IP spoofée (contournement de rate-limit /
 * d'allow-list IP, falsification des logs d'audit) et `X-Forwarded-Proto: https`
 * → faux scheme. Cf RFC 7239 / OWASP « Host header & forwarded headers ».
 */

/**
 * Valeur de configuration `trustProxy` :
 * - `false` (défaut sûr) : ne JAMAIS faire confiance aux `X-Forwarded-*`.
 * - `true` : confiance totale (déploiement où le LB est l'unique point d'entrée).
 * - `string` / `string[]` : IP, CIDR (`10.0.0.0/8`, `::1/128`) ou presets
 *   `"loopback"`, `"linklocal"`, `"uniquelocal"`.
 */
export type TrustProxyConfig = boolean | string | string[];

/** Décide si l'adresse distante (socket réel) est un proxy de confiance. */
export interface TrustProxyChecker {
  isTrusted(remoteAddress: string | undefined | null): boolean;
}

// Plages des presets (RFC 1918 / 4193 / 3927 / 4291 / loopback).
const PRESETS: Record<
  string,
  ReadonlyArray<[string, number, "ipv4" | "ipv6"]>
> = {
  loopback: [
    ["127.0.0.0", 8, "ipv4"],
    ["::1", 128, "ipv6"],
  ],
  linklocal: [
    ["169.254.0.0", 16, "ipv4"],
    ["fe80::", 10, "ipv6"],
  ],
  uniquelocal: [
    ["10.0.0.0", 8, "ipv4"],
    ["172.16.0.0", 12, "ipv4"],
    ["192.168.0.0", 16, "ipv4"],
    ["fc00::", 7, "ipv6"],
  ],
};

/** Normalise une adresse IPv4-mapped IPv6 (`::ffff:127.0.0.1`) en IPv4. */
const normalize = (addr: string): string =>
  addr.startsWith("::ffff:") && isIPv4(addr.slice(7)) ? addr.slice(7) : addr;

const TRUST_ALL: TrustProxyChecker = { isTrusted: () => true };
const TRUST_NONE: TrustProxyChecker = { isTrusted: () => false };

/**
 * Ajoute une entrée (IP, CIDR ou preset) à la `BlockList`.
 *
 * @throws {Error} si l'entrée n'est ni une IP, ni un CIDR, ni un preset connu.
 */
function addEntry(list: BlockList, raw: string): void {
  const entry = raw.trim();
  if (!entry) {
    return;
  }
  const preset = PRESETS[entry.toLowerCase()];
  if (preset) {
    for (const [net, prefix, family] of preset) {
      list.addSubnet(net, prefix, family);
    }
    return;
  }
  const slash = entry.indexOf("/");
  if (slash !== -1) {
    const net = entry.slice(0, slash);
    const prefix = Number(entry.slice(slash + 1));
    const family = isIPv6(net) ? "ipv6" : "ipv4";
    list.addSubnet(net, prefix, family);
    return;
  }
  if (isIPv4(entry)) {
    list.addAddress(entry, "ipv4");
    return;
  }
  if (isIPv6(entry)) {
    list.addAddress(entry, "ipv6");
    return;
  }
  throw new Error(`trustProxy: invalid IP/CIDR/preset "${raw}"`);
}

/**
 * Compile une config `trustProxy` en un {@link TrustProxyChecker} (une fois, au
 * boot — pas par requête). Les entrées invalides lèvent à la compilation (fail
 * fast) plutôt que silencieusement par requête.
 *
 * @param config - voir {@link TrustProxyConfig}. `undefined` → aucune confiance.
 * @returns un checker `isTrusted(remoteAddress)`.
 */
export function buildTrustProxy(
  config: TrustProxyConfig | undefined,
): TrustProxyChecker {
  if (config === true) {
    return TRUST_ALL;
  }
  if (!config) {
    return TRUST_NONE;
  }
  const entries = Array.isArray(config) ? config : [config];
  const list = new BlockList();
  for (const entry of entries) {
    addEntry(list, entry);
  }
  return {
    isTrusted(remoteAddress) {
      if (!remoteAddress) {
        return false;
      }
      const addr = normalize(remoteAddress);
      const family = isIPv6(addr) ? "ipv6" : isIPv4(addr) ? "ipv4" : null;
      return family ? list.check(addr, family) : false;
    },
  };
}

/**
 * Résout l'adresse IP cliente RÉELLE à partir de la connexion socket et de la
 * chaîne `X-Forwarded-For`, en dépouillant les proxies de confiance **de droite
 * à gauche** (algorithme OWASP).
 *
 * `X-Forwarded-For` (de-facto) est construit par **append de gauche à droite** :
 * `XFF: client, proxy1, proxy2`. Chaque proxy ajoute À DROITE l'adresse qu'il a
 * vue. La partie **gauche** est donc entièrement **forgeable** par le client
 * (il peut envoyer `X-Forwarded-For: 1.2.3.4` ; le 1ᵉʳ proxy ne fait qu'append
 * l'IP réelle après). Lire `XFF[0]` revient à lire la valeur du client →
 * **IP spoofing** (contournement de ban / rate-limit / allow-list / audit).
 *
 * La résolution sûre part de la **connexion réelle** (le socket, non forgeable)
 * et remonte la chaîne de DROITE à GAUCHE : tant que le maillon courant est un
 * proxy de confiance, on passe au précédent ; le **premier maillon non fiable**
 * rencontré est l'IP cliente réelle. Si toute la chaîne est de confiance (cas
 * LB interne maîtrisé), on retourne l'élément le plus à gauche.
 *
 * Hot path préservé : sans `X-Forwarded-For` (cas direct usuel) la fonction
 * retourne immédiatement le socket — 0 allocation (pas de split).
 *
 * @param xff - valeur brute de l'en-tête `X-Forwarded-For` (string, ou string[]
 *   si l'en-tête est répété), ou `undefined`.
 * @param socketAddress - `socket.remoteAddress` (la connexion TCP réelle).
 * @param checker - politique de confiance ({@link buildTrustProxy}).
 * @returns l'IP cliente réelle, ou `null` si aucune connexion socket fiable.
 */
export function extractClientIp(
  xff: string | string[] | undefined,
  socketAddress: string | undefined | null,
  checker: TrustProxyChecker,
): string | null {
  // Pas de socket réel → rien de fiable. Ne JAMAIS retomber sur un XFF, qui est
  // intégralement contrôlé par le client tant qu'aucun proxy fiable ne l'a réécrit.
  if (!socketAddress) {
    return null;
  }
  // Cas direct usuel : aucun forwarded → la connexion EST le client.
  if (!xff) {
    return socketAddress;
  }
  const list = (Array.isArray(xff) ? xff.join(",") : xff)
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  // On part du socket (connexion réelle) et on remonte XFF de droite à gauche.
  let candidate = socketAddress;
  for (let i = list.length - 1; i >= 0; i -= 1) {
    if (!checker.isTrusted(candidate)) {
      return candidate; // 1ᵉʳ maillon non fiable = IP cliente réelle
    }
    candidate = list[i];
  }
  // Toute la chaîne est de confiance → l'élément le plus à gauche est la
  // meilleure approximation de l'origine.
  return candidate;
}
