import { isLoopbackHostname } from "nodefony";

/**
 * Règles d'un montage du proxy inverse — UNIQUE source, lue par le schéma de
 * configuration (`proxy.mounts`) ET par `ReverseProxy.mount()` : un montage
 * écrit dans la config et un montage posé par un module obéissent aux mêmes
 * refus, avec les mêmes mots.
 *
 * Pur : n'importe que le cœur, importable depuis `config/config.ts` sans
 * cycle.
 */

/**
 * Préfixes que le framework se réserve : un montage n'y est JAMAIS accepté.
 * `/nodefony/` porte la console d'administration et les API de Studio — les
 * relayer ailleurs détournerait une surface protégée par le pare-feu.
 */
export const RESERVED_PROXY_PREFIXES: readonly string[] = ["/nodefony/"];

/**
 * Préfixes réservés aux montages POSÉS PAR UN MODULE : la configuration ne
 * peut pas les prendre. `/_vite/` appartient à `@nodefony/frontend`, qui y
 * relaie ses serveurs Vite de développement.
 */
export const MODULE_PROXY_PREFIXES: readonly string[] = ["/_vite/"];

/** Jeton de méthode HTTP (RFC 9110 §9.1 → `token`, §5.6.2). */
const METHOD_TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
/** Nom de champ d'en-tête (RFC 9110 §5.1 → `token`). */
const HEADER_TOKEN = METHOD_TOKEN;

/**
 * Normalise un préfixe d'URL : `/` en tête et en fin, sans `/` doublé. Règle
 * UNIQUE des montages statiques et du proxy inverse — deux écritures du même
 * préfixe doivent désigner la même entrée.
 *
 * @param prefix - préfixe tel qu'écrit (`"svc"`, `"/svc"`, `"/svc/"`)
 * @returns le préfixe normalisé (`"/svc/"`)
 */
export function normalizePrefix(prefix: string): string {
  let p = prefix.trim();
  if (!p.startsWith("/")) p = `/${p}`;
  if (!p.endsWith("/")) p = `${p}/`;
  return p.replace(/\/{2,}/g, "/");
}

/**
 * Analyse une origine d'amont. Seule une origine NUE est acceptée : un chemin,
 * une requête, un fragment ou des identifiants dans la cible déplaceraient en
 * silence toutes les URL relayées, ou feraient voyager un secret dans la
 * configuration.
 *
 * @param origin - `scheme://hôte[:port]`
 * @returns l'URL analysée, ou `null` si ce n'est pas une origine http(s) nue
 */
export function parseProxyOrigin(origin: string): URL | null {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  // `new URL("http://h/")` et `new URL("http://h")` rendent tous deux `/` :
  // seul le texte dit si un chemin a été écrit.
  if (!/^https?:\/\/[^/?#]+\/?$/i.test(origin.trim())) return null;
  if (url.search !== "" || url.hash !== "") return null;
  if (url.username !== "" || url.password !== "") return null;
  return url;
}

/** Ce qu'une règle de montage examine — la forme commune config / code. */
export interface IProxyMountShape {
  target: unknown;
  methods?: readonly string[] | undefined;
  stripHeaders?: readonly string[] | undefined;
  timeoutMs?: number | undefined;
  secure?: boolean | undefined;
}

/** Un refus, nommé : le champ fautif et pourquoi. */
export interface IProxyMountProblem {
  field:
    "prefix" | "target" | "methods" | "stripHeaders" | "timeoutMs" | "secure";
  message: string;
}

/**
 * Examine un montage. Rend TOUS les refus, pas le premier : une configuration
 * se corrige en une passe.
 *
 * @param prefix - préfixe tel qu'écrit
 * @param mount - réglages du montage
 * @param source - `"config"` (déclaré dans `proxy.mounts`) ou `"module"`
 *   (posé par un module) — seuls les préfixes réservés aux modules diffèrent
 * @returns la liste des refus, vide si le montage est sain
 */
export function proxyMountProblems(
  prefix: string,
  mount: IProxyMountShape,
  source: "config" | "module",
): IProxyMountProblem[] {
  const problems: IProxyMountProblem[] = [];
  const raw = prefix.trim();
  const p = normalizePrefix(raw);
  if (p === "/") {
    problems.push({
      field: "prefix",
      message:
        "le préfixe « / » relaierait TOUTE l'application, routes et pare-feu " +
        "compris — monter un préfixe dédié (`/svc/`)",
    });
  } else if (
    /[?#\s\\%]/.test(raw) ||
    p.split("/").some((s) => s === "." || s === "..")
  ) {
    problems.push({
      field: "prefix",
      message:
        `préfixe « ${raw} » invalide — un chemin littéral, sans « ? », « # », ` +
        "« % », « \\ », espace ni segment « . » / « .. »",
    });
  } else if (RESERVED_PROXY_PREFIXES.some((r) => p.startsWith(r))) {
    problems.push({
      field: "prefix",
      message: `le préfixe « ${p} » est réservé au framework (console d'administration)`,
    });
  } else if (
    source === "config" &&
    MODULE_PROXY_PREFIXES.some((r) => p.startsWith(r))
  ) {
    problems.push({
      field: "prefix",
      message:
        `le préfixe « ${p} » est réservé à @nodefony/frontend (serveurs Vite de ` +
        "développement), qui le monte lui-même",
    });
  }
  let target: URL | null = null;
  if (typeof mount.target === "string") {
    target = parseProxyOrigin(mount.target);
    if (target === null) {
      problems.push({
        field: "target",
        message:
          `cible « ${mount.target} » invalide — attendu une origine http(s) nue ` +
          "(`scheme://hôte[:port]`), sans chemin, requête ni identifiants",
      });
    }
  } else if (typeof mount.target !== "function") {
    problems.push({
      field: "target",
      message: "cible absente — une origine `scheme://hôte[:port]`",
    });
  }
  if (mount.secure === false && target !== null) {
    if (target.protocol !== "https:") {
      problems.push({
        field: "secure",
        message: "`secure: false` ne concerne qu'une cible https: — le retirer",
      });
    } else if (!isLoopbackHostname(target.hostname)) {
      problems.push({
        field: "secure",
        message:
          `\`secure: false\` refusé vers « ${target.hostname} » : sans vérification ` +
          "de certificat, n'importe qui sur le chemin réseau se fait passer pour " +
          "l'amont. Réservé à la boucle locale — sinon, fournir l'autorité de " +
          "certification de l'amont au processus (NODE_EXTRA_CA_CERTS)",
      });
    }
  }
  if (mount.methods !== undefined) {
    if (mount.methods.length === 0) {
      problems.push({
        field: "methods",
        message:
          "liste de méthodes vide : rien ne serait relayé — retirer `methods` pour toutes",
      });
    }
    for (const m of mount.methods) {
      if (!METHOD_TOKEN.test(m)) {
        problems.push({
          field: "methods",
          message: `méthode « ${m} » invalide (RFC 9110 §9.1)`,
        });
      }
    }
  }
  for (const h of mount.stripHeaders ?? []) {
    if (!HEADER_TOKEN.test(h)) {
      problems.push({
        field: "stripHeaders",
        message: `nom d'en-tête « ${h} » invalide`,
      });
    } else if (h.toLowerCase() === "host") {
      problems.push({
        field: "stripHeaders",
        message:
          "« host » ne se retire pas : il est toujours posé — voir `preserveHost`",
      });
    }
  }
  if (
    mount.timeoutMs !== undefined &&
    (!Number.isInteger(mount.timeoutMs) || mount.timeoutMs <= 0)
  ) {
    problems.push({
      field: "timeoutMs",
      message: `délai « ${mount.timeoutMs} » invalide — un entier de millisecondes > 0`,
    });
  }
  return problems;
}

/** Encodages qui changent le SENS d'un chemin selon qui le décode. */
const AMBIGUOUS_ENCODING = /%(?:2e|2f|5c|00|25)/i;

/**
 * Le chemin d'une requête relayée est-il ambigu ? Un chemin que le proxy et
 * l'amont pourraient lire différemment — segment `.`/`..`, barre inverse,
 * octet nul, ou leur forme encodée (`%2e`, `%2f`, `%5c`, `%00`, `%25`) — est
 * REFUSÉ (400), jamais normalisé en silence : c'est le défaut de Traefik, et
 * la parade aux contournements de préfixe (`/svc/..%2fadmin`).
 *
 * @param url - cible brute de la requête (chemin + requête éventuelle)
 * @returns `true` si le chemin doit être refusé
 */
export function isAmbiguousPath(url: string): boolean {
  const q = url.indexOf("?");
  const path = q === -1 ? url : url.slice(0, q);
  if (path.includes("\\") || path.includes("\0")) return true;
  if (AMBIGUOUS_ENCODING.test(path)) return true;
  for (const segment of path.split("/")) {
    if (segment === "." || segment === "..") return true;
  }
  return false;
}

/** Clé de handshake : 16 octets en base64 (RFC 6455 §4.1, §4.2.1). */
const WS_KEY = /^[A-Za-z0-9+/]{22}==$/;

/**
 * Un upgrade est-il un handshake WebSocket conforme (RFC 6455 §4.2.1) ? Seul
 * un tel handshake est relayé : un `Upgrade` quelconque (`h2c`…) raccordé
 * octet pour octet ouvrirait un tunnel que rien n'inspecte.
 *
 * @param method - méthode de la requête
 * @param headers - en-têtes reçus
 * @returns la raison du refus, ou `null` si le handshake est conforme
 */
export function websocketHandshakeProblem(
  method: string | undefined,
  headers: Record<string, string | string[] | undefined>,
): string | null {
  if (method !== "GET") return "méthode autre que GET";
  const upgrade = headers.upgrade;
  if (
    typeof upgrade !== "string" ||
    upgrade.trim().toLowerCase() !== "websocket"
  ) {
    return "Upgrade autre que websocket";
  }
  const connection = headers.connection;
  const tokens = (
    Array.isArray(connection) ? connection.join(",") : (connection ?? "")
  )
    .toLowerCase()
    .split(",")
    .map((t) => t.trim());
  if (!tokens.includes("upgrade")) return "Connection sans upgrade";
  if (headers["sec-websocket-version"] !== "13")
    return "Sec-WebSocket-Version ≠ 13";
  const key = headers["sec-websocket-key"];
  if (typeof key !== "string" || !WS_KEY.test(key.trim())) {
    return "Sec-WebSocket-Key invalide";
  }
  return null;
}
