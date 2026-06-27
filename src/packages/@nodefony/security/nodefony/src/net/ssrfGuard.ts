import { BlockList, isIP } from "node:net";
import { lookup as dnsLookup } from "node:dns/promises";
import { SsrfError } from "../../errors/SsrfError";

/**
 * Protection **SSRF** (Server-Side Request Forgery) générique pour les URL
 * sortantes — endpoints webhook, fetch applicatif, futurs agents/RAG.
 *
 * Le danger : une URL fournie par un utilisateur peut viser une ressource
 * **interne** non destinée à être exposée (loopback `127.0.0.1`, réseau privé
 * `10.x`/`192.168.x`, et surtout l'endpoint de **métadonnées cloud**
 * `169.254.169.254` qui livre les credentials IAM d'une VM). Le serveur, lui,
 * peut atteindre ces cibles → il devient un proxy de l'attaquant.
 *
 * La défense résout le nom DNS **avant** toute connexion et rejette si une seule
 * des IP résolues est non publique. Les adresses résolues sont retournées pour
 * permettre un **pinning** à la connexion (anti DNS-rebinding : se connecter à
 * l'IP validée, pas re-résoudre).
 */

/** Plages IPv4 non routables sur l'Internet public (à bloquer). */
const BLOCKED_V4: ReadonlyArray<readonly [string, number]> = [
  ["0.0.0.0", 8], // réseau courant / non spécifié
  ["10.0.0.0", 8], // privé (RFC 1918)
  ["100.64.0.0", 10], // CGNAT (RFC 6598)
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local + métadonnées cloud (169.254.169.254)
  ["172.16.0.0", 12], // privé (RFC 1918)
  ["192.0.0.0", 24], // protocoles IETF
  ["192.0.2.0", 24], // TEST-NET-1
  ["192.88.99.0", 24], // 6to4 relay anycast (RFC 7526, déprécié)
  ["192.168.0.0", 16], // privé (RFC 1918)
  ["198.18.0.0", 15], // benchmark
  ["198.51.100.0", 24], // TEST-NET-2
  ["203.0.113.0", 24], // TEST-NET-3
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // réservé
];

/** Plages IPv6 non routables sur l'Internet public (à bloquer). */
const BLOCKED_V6: ReadonlyArray<readonly [string, number]> = [
  ["::", 128], // non spécifié
  ["::1", 128], // loopback
  ["64:ff9b::", 96], // NAT64
  ["2002::", 16], // 6to4 (encapsule de l'IPv4 — peut viser du privé)
  ["100::", 64], // discard-only
  ["2001:db8::", 32], // documentation
  ["fc00::", 7], // ULA (privé)
  ["fe80::", 10], // link-local
  ["ff00::", 8], // multicast
];

let blockList: BlockList | null = null;

/** Construit (lazy, une fois) la liste de blocage des IP non publiques. */
function getBlockList(): BlockList {
  if (blockList === null) {
    const bl = new BlockList();
    for (const [net, prefix] of BLOCKED_V4) bl.addSubnet(net, prefix, "ipv4");
    for (const [net, prefix] of BLOCKED_V6) bl.addSubnet(net, prefix, "ipv6");
    blockList = bl;
  }
  return blockList;
}

/**
 * Indique si une IP (littérale) est **non publique** (donc interdite comme cible
 * sortante). Une IP syntaxiquement invalide est considérée bloquée (fail-closed).
 *
 * `node:net` `BlockList` rabat **nativement** les IPv6 **IPv4-mapped** — toutes
 * notations confondues (`::ffff:127.0.0.1`, `::ffff:7f00:1`,
 * `0:0:0:0:0:ffff:127.0.0.1`…) — sur les règles IPv4 : `::ffff:169.254.169.254`
 * est bloqué sans traitement spécial (vérifié red-team `webhookSsrf.attack`).
 * ⚠️ NE PAS ajouter `::ffff:0:0/96` à la liste : Node ferait alors matcher TOUTE
 * adresse IPv4 (faux positif massif → 100 % des webhooks rejetés).
 *
 * @param ip - adresse IPv4 ou IPv6 (sans crochets).
 */
export function isBlockedAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 0) return true; // pas une IP → fail-closed
  return getBlockList().check(ip, family === 4 ? "ipv4" : "ipv6");
}

/** Résolveur DNS injectable (testabilité) — renvoie toutes les IP d'un hôte. */
export type DnsResolver = (hostname: string) => Promise<string[]>;

const defaultResolver: DnsResolver = async (hostname) => {
  const records = await dnsLookup(hostname, { all: true });
  return records.map((r) => r.address);
};

/** Options de validation d'une URL sortante. */
export interface IAssertPublicUrlOptions {
  /** Autorise les cibles non publiques (dev/test only). Défaut : `false`. */
  readonly allowPrivate?: boolean;
  /** Autorise `http:` en plus de `https:`. Défaut : `false` (https only). */
  readonly allowHttp?: boolean;
  /** Résolveur DNS (injectable pour les tests). Défaut : `node:dns`. */
  readonly resolver?: DnsResolver;
}

/** Résultat d'une validation SSRF réussie. */
export interface IPublicUrlResult {
  /** URL validée (normalisée). */
  readonly url: URL;
  /** IP résolues, toutes publiques — à **pinner** à la connexion. */
  readonly addresses: string[];
}

/** Retire les crochets d'un hostname IPv6 littéral (`[::1]` → `::1`). */
function stripBrackets(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
}

/**
 * Valide qu'une URL sortante est sûre (anti-SSRF) : protocole autorisé, pas
 * d'identifiants embarqués, hôte résolvable, et **toutes** les IP résolues
 * publiques. Lève {@link SsrfError} (422) sinon.
 *
 * @param rawUrl - URL brute à valider.
 * @param options - politique (https-only, deny private, résolveur).
 * @returns l'URL normalisée + les IP résolues (pour pinning à la connexion).
 * @throws SsrfError si l'URL est malformée ou cible une ressource interdite.
 */
export async function assertPublicUrl(
  rawUrl: string,
  options: IAssertPublicUrlOptions = {},
): Promise<IPublicUrlResult> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SsrfError(`URL invalide : « ${rawUrl} »`);
  }

  const scheme = options.allowHttp ? ["https:", "http:"] : ["https:"];
  if (!scheme.includes(url.protocol)) {
    throw new SsrfError(
      `protocole « ${url.protocol} » interdit (attendu : ${scheme.join("/")})`,
    );
  }
  if (url.username !== "" || url.password !== "") {
    throw new SsrfError("identifiants embarqués dans l'URL interdits");
  }

  const host = stripBrackets(url.hostname);
  if (host === "") throw new SsrfError("hôte absent");

  // Politique relâchée (dev) : on saute la résolution/le contrôle d'IP.
  if (options.allowPrivate) return { url, addresses: [] };

  // IP littérale → pas de DNS, contrôle direct.
  let addresses: string[];
  if (isIP(host) !== 0) {
    addresses = [host];
  } else {
    const resolver = options.resolver ?? defaultResolver;
    try {
      addresses = await resolver(host);
    } catch {
      throw new SsrfError(`hôte non résolvable : « ${host} »`);
    }
    if (addresses.length === 0) {
      throw new SsrfError(`hôte sans adresse : « ${host} »`);
    }
  }

  for (const ip of addresses) {
    if (isBlockedAddress(ip)) {
      throw new SsrfError(`cible non publique interdite : ${host} → ${ip}`);
    }
  }

  return { url, addresses };
}
