import { isIPv4 } from "node:net";
import type { TrustProxyChecker } from "./trustProxy";
import { resolveFromRight, extractClientIp } from "./trustProxy";

/**
 * Parsing et résolution **canonique** des en-têtes de transfert (forwarded),
 * conforme **RFC 7239** (« Forwarded HTTP Extension ») et compatible avec les
 * en-têtes `X-Forwarded-*` de-facto (non normalisés).
 *
 * Le header standard `Forwarded` est **prioritaire** ; les `X-Forwarded-*`
 * servent de repli. Une **seule** résolution produit le scheme, le host et l'IP
 * cliente effectifs (supprime la double source `x-forwarded-proto` /
 * `x-forwarded-scheme`).
 *
 * ⚠️ Toujours appelé en aval d'un contrôle `trustProxy` (RFC 7239 §8.1) : ces
 * en-têtes ne sont honorés que derrière un reverse-proxy de confiance, sinon ils
 * sont forgeables (IP/scheme spoofing).
 */

/** Sous-ensemble des en-têtes lus (compatible `http`/`http2` IncomingHttpHeaders). */
export type ForwardedHeaders = Record<string, string | string[] | undefined>;

/**
 * Un `forwarded-element` parsé (RFC 7239 §4) : un saut de la chaîne de proxy.
 * Les paramètres inconnus (extensibilité §5.4) sont ignorés silencieusement.
 */
export interface ForwardedElement {
  /** §5.1 — interface du proxy par laquelle la requête est entrée (node id). */
  by?: string;
  /** §5.2 — client à l'origine de la requête (node id, éventuellement obfusqué). */
  for?: string;
  /** §5.3 — Host original tel que reçu par le proxy. */
  host?: string;
  /** §5.4 — protocole employé par le client (`http` / `https`), normalisé en minuscules. */
  proto?: string;
}

/** Résolution canonique unifiée des en-têtes forwarded. */
export interface ResolvedProxy {
  /** Scheme effectif côté client (`http` / `https`), ou `undefined` si indéterminé. */
  proto?: string;
  /** Host effectif côté client (Host d'origine), ou `undefined` si non fourni. */
  host?: string;
  /** Chaîne `for` brute (node identifiers, gauche→droite) — pour log/metadata interne. */
  forwardedFor?: string;
  /** IP cliente réelle, résolue from-right (toujours fiable, jamais l'IP forgée). */
  clientIp: string | null;
  /** Le header standard `Forwarded` a-t-il été la source (sinon `X-Forwarded-*`) ? */
  fromStandard: boolean;
}

/**
 * Découpe une chaîne sur `sep` au **niveau supérieur uniquement**, en respectant
 * les `quoted-string` RFC 7230 (`value = token / quoted-string`, §4) : un
 * séparateur à l'intérieur de guillemets (ex. un host quoté, un IPv6) n'est PAS
 * un point de coupe. Les `\"` échappés à l'intérieur des guillemets sont préservés.
 */
function splitTopLevel(input: string, sep: string): string[] {
  // FAST PATH : sans `quoted-string`, aucun séparateur ne peut être protégé →
  // un `split` natif suffit (cas dominant : `Forwarded: for=ip;proto=https`).
  if (input.indexOf('"') === -1) {
    return input.split(sep);
  }
  const out: string[] = [];
  let buf = "";
  let inQuote = false;
  let escaped = false;
  for (let i = 0; i < input.length; i += 1) {
    const c = input[i];
    if (escaped) {
      buf += c;
      escaped = false;
      continue;
    }
    if (c === "\\" && inQuote) {
      buf += c;
      escaped = true;
      continue;
    }
    if (c === '"') {
      inQuote = !inQuote;
      buf += c;
      continue;
    }
    if (c === sep && !inQuote) {
      out.push(buf);
      buf = "";
      continue;
    }
    buf += c;
  }
  out.push(buf);
  return out;
}

/** Retire les guillemets d'une `quoted-string` et déséchappe `\x` (RFC 7230 §3.2.6). */
function unquote(value: string): string {
  const v = value.trim();
  if (v.length >= 2 && v[0] === '"' && v[v.length - 1] === '"') {
    return v.slice(1, -1).replace(/\\(.)/gu, "$1");
  }
  return v;
}

/**
 * Parse le header `Forwarded` (RFC 7239 §4) en liste de `forwarded-element`,
 * dans l'ordre **gauche→droite** (le plus à gauche = le plus proche du client).
 *
 * Grammaire honorée : `Forwarded = 1#forwarded-element`,
 * `forwarded-element = [ forwarded-pair ] *( ";" [ forwarded-pair ] )`,
 * `forwarded-pair = token "=" value`, `value = token / quoted-string`.
 * Les noms de paramètres sont insensibles à la casse (§7.1) → normalisés.
 *
 * @param raw - valeur brute du header (string, ou string[] si répété), ou `undefined`.
 * @returns les éléments parsés, ou `null` si le header est absent/vide.
 */
export function parseForwarded(
  raw: string | string[] | undefined,
): ForwardedElement[] | null {
  if (!raw) {
    return null;
  }
  const header = Array.isArray(raw) ? raw.join(",") : raw;
  if (!header.trim()) {
    return null;
  }
  const elements: ForwardedElement[] = [];
  for (const part of splitTopLevel(header, ",")) {
    if (!part.trim()) {
      continue;
    }
    const element: ForwardedElement = {};
    for (const pair of splitTopLevel(part, ";")) {
      const eq = pair.indexOf("=");
      if (eq === -1) {
        continue;
      }
      const key = pair.slice(0, eq).trim().toLowerCase();
      const rawValue = pair.slice(eq + 1);
      switch (key) {
        case "by":
          element.by = unquote(rawValue);
          break;
        case "for":
          element.for = unquote(rawValue);
          break;
        case "host":
          element.host = unquote(rawValue);
          break;
        case "proto":
          element.proto = unquote(rawValue).toLowerCase();
          break;
        // Paramètres d'extension (§5.4) ignorés.
        default:
          break;
      }
    }
    elements.push(element);
  }
  return elements.length ? elements : null;
}

/**
 * Extrait l'**IP nue** d'un node identifier RFC 7239 §6
 * (`node = nodename [ ":" node-port ]`).
 *
 * - IPv6 entre crochets (`[2001:db8::1]`, éventuel `]:port`) → l'IPv6 sans crochets.
 * - IPv4 (`192.0.2.43`, éventuel `:port`) → l'IPv4 sans le port.
 * - `unknown` et identifiants obfusqués (`obfnode` commençant par `_`, §6.3) →
 *   `null` : non comparables à une politique de confiance (barrière from-right).
 *
 * @param node - valeur d'un paramètre `for`/`by`, déjà déquotée.
 * @returns l'IP exploitable, ou `null` si absente/obfusquée/illisible.
 */
export function forwardedNodeIp(node: string | undefined): string | null {
  if (!node) {
    return null;
  }
  const n = node.trim();
  if (!n) {
    return null;
  }
  // IPv6 littéral : "[2001:db8::1]" ou "[2001:db8::1]:4711".
  if (n[0] === "[") {
    const end = n.indexOf("]");
    return end > 1 ? n.slice(1, end) : null;
  }
  // unknown / obfnode (_xxx) : pas une IP comparable (§6.2/§6.3).
  if (n === "unknown" || n[0] === "_") {
    return null;
  }
  // IPv4 (ou nodename) éventuellement suivi de ":port" → on retire le port.
  const colon = n.indexOf(":");
  const host = colon === -1 ? n : n.slice(0, colon);
  return isIPv4(host) ? host : host || null;
}

/** Premier élément (le plus à gauche = côté client) définissant `key`. */
function firstDefined(
  elements: ForwardedElement[],
  key: "proto" | "host" | "for",
): string | undefined {
  for (const element of elements) {
    const value = element[key];
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

/**
 * Premier token d'un en-tête `X-Forwarded-*` multi-valeurs (`"a, b"` → `"a"`).
 * `indexOf` + `slice` (pas de `split`) → 0 array alloué (hot path prod).
 */
function firstToken(
  value: string | string[] | undefined,
  lower = false,
): string | undefined {
  if (!value) {
    return undefined;
  }
  const s = Array.isArray(value) ? value[0] : value;
  if (!s) {
    return undefined;
  }
  const comma = s.indexOf(",");
  const first = (comma === -1 ? s : s.slice(0, comma)).trim();
  if (!first) {
    return undefined;
  }
  return lower ? first.toLowerCase() : first;
}

/**
 * Résout, en **une seule passe**, le scheme, le host et l'IP cliente effectifs à
 * partir des en-têtes forwarded — header standard `Forwarded` (RFC 7239)
 * **prioritaire**, repli sur les `X-Forwarded-*` de-facto.
 *
 * Le scheme/host effectifs sont pris sur l'élément le plus à GAUCHE (côté client) ;
 * l'IP cliente est résolue **from-right** ({@link resolveFromRight}) en partant du
 * socket réel, donc non spoofable. La priorité unique `Forwarded.proto` >
 * `x-forwarded-proto` > `x-forwarded-scheme` supprime l'ancienne double source.
 *
 * À n'appeler que derrière un proxy de confiance (RFC 7239 §8.1) : la décision
 * `isTrusted(socket)` est prise par l'appelant (lazy : pas d'allocation hors proxy).
 *
 * @param headers - en-têtes de la requête.
 * @param socketAddress - `socket.remoteAddress` (connexion TCP réelle).
 * @param checker - politique de confiance ({@link buildTrustProxy}).
 * @returns la résolution canonique unifiée.
 */
export function resolveForwarded(
  headers: ForwardedHeaders,
  socketAddress: string | undefined | null,
  checker: TrustProxyChecker,
): ResolvedProxy {
  const elements = parseForwarded(headers.forwarded);
  if (elements) {
    const chain = elements.map((element) => forwardedNodeIp(element.for));
    const forwardedFor =
      elements
        .map((element) => element.for)
        .filter((value): value is string => Boolean(value))
        .join(", ") || undefined;
    return {
      proto: firstDefined(elements, "proto"),
      host: firstDefined(elements, "host"),
      forwardedFor,
      clientIp: socketAddress
        ? resolveFromRight(chain, socketAddress, checker)
        : null,
      fromStandard: true,
    };
  }
  // Repli X-Forwarded-* de-facto (cas prod dominant : nginx / k8s ingress).
  // forwardedFor = valeur brute (0 re-split/join) ; clientIp via extractClientIp
  // (fast-path mono-proxy → 0 allocation).
  const xff = headers["x-forwarded-for"];
  return {
    proto:
      firstToken(headers["x-forwarded-proto"], true) ??
      firstToken(headers["x-forwarded-scheme"], true),
    host: firstToken(headers["x-forwarded-host"]),
    forwardedFor: typeof xff === "string" ? xff : xff?.join(", "),
    clientIp: extractClientIp(xff, socketAddress, checker),
    fromStandard: false,
  };
}

/**
 * Au moins un en-tête forwarded (standard ou de-facto) est-il présent ? Permet à
 * l'appelant de n'allouer la résolution que quand c'est utile (hot path : 0 alloc
 * sur une requête directe sans proxy).
 */
export function hasForwardingHeaders(headers: ForwardedHeaders): boolean {
  return Boolean(
    headers.forwarded ||
    headers["x-forwarded-for"] ||
    headers["x-forwarded-proto"] ||
    headers["x-forwarded-scheme"] ||
    headers["x-forwarded-host"],
  );
}
