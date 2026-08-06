/**
 * Fast-path d'analyse du request-target — évite le `new URL` (parse WHATWG
 * complet) sur le chemin nominal, où le target est déjà sous sa forme
 * canonique et où pathname/search s'extraient par simple découpe.
 *
 * ⚠️ SÉCURITÉ — le contrat qui rend la découpe légale : la normalisation
 * WHATWG (dot-segments — y compris leurs formes percent-encodées `%2e` —,
 * conversion `\` → `/`, percent-encoding, punycode/lowercase du host,
 * normalisation des hosts « IPv4-like » type `127.1`/`0x7f.1`) PROTÈGE le
 * routing et le matching de zones du firewall. La découpe n'est donc admise
 * QUE si elle est prouvablement l'IDENTITÉ : tout caractère ou motif que le
 * parseur WHATWG transformerait — ou dont l'innocuité n'est pas certaine —
 * déclenche le bail-out (`null`) et le vrai `new URL` est construit, comme
 * avant. Whitelist stricte : le doute coûte un parse, jamais un contournement.
 *
 * La preuve est portée par `tests/unit/urlFastPath.test.ts` : balayage
 * exhaustif par caractère (0x00-0x7F, plus témoins > 0x7F) comparant chaque
 * target ACCEPTÉ au résultat du vrai `new URL` — pathname, search et href
 * doivent être STRICTEMENT identiques à la découpe.
 */

/**
 * Résultat d'une découpe acceptée : les deux composants, dans la même forme
 * que `URL.pathname` / `URL.search` (le `?` inclus, `""` si query absente ou
 * vide — `/x?` donne `search === ""` comme WHATWG).
 */
export interface ISplitTarget {
  pathname: string;
  search: string;
}

// Tables de caractères sûrs (index = code ASCII, 1 = le caractère traverse le
// parse WHATWG à l'identique dans ce composant). Construites UNE fois au
// chargement du module — lookup O(1) par caractère ensuite.
//
// PATH : pchar de la RFC 3986 SANS percent-encoding (`%` exclu → couvre
// `%2e%2e` et consorts) ; `\` exclu (WHATWG le convertit en `/` sur les
// schemes spéciaux) ; `?`/`#` structurels ; tout ce que le path
// percent-encode set de WHATWG encoderait (espace, `"`, `<`, `>`, `` ` ``,
// `{`, `}`) est exclu ; `[ ] ^ |` traversent en pratique mais restent exclus
// (whitelist : on n'admet que le prouvé utile).
const PATH_SAFE = new Uint8Array(128);
// SEARCH : plus large — la query WHATWG laisse `%` (même mal formé), `+`,
// `/`, `\`, `[`… intacts ; seuls espace, `"`, `#`, `<`, `>`, `'` (scheme
// spécial) seraient encodés → exclus, avec les contrôles.
const SEARCH_SAFE = new Uint8Array(128);
// HOST : minuscules STRICTES (WHATWG lowercase le host → une majuscule =
// bail-out), chiffres, `-`, `.`, `_`. Le `:` du port est traité à part.
const HOST_SAFE = new Uint8Array(128);

for (let c = 0; c < 128; c++) {
  const ch = String.fromCharCode(c);
  if (/[A-Za-z0-9\-._~!$&'()*+,;=:@/]/.test(ch)) {
    PATH_SAFE[c] = 1;
  }
  // Visible ASCII sauf " # < > ' (query percent-encode set des schemes
  // spéciaux) — l'espace (0x20) est hors plage.
  if (c > 0x20 && c < 0x7f && !"\"#<>'".includes(ch)) {
    SEARCH_SAFE[c] = 1;
  }
  if (/[a-z0-9\-._]/.test(ch)) {
    HOST_SAFE[c] = 1;
  }
}

const SLASH = 0x2f;
const DOT = 0x2e;
const QMARK = 0x3f;
const COLON = 0x3a;

/**
 * Découpe un request-target origin-form (`/path[?query]`) en
 * pathname/search SI — et seulement si — le parse WHATWG serait l'identité.
 *
 * @param target - le request-target brut (`IncomingMessage.url` en HTTP/1,
 *   pseudo-header `:path` en HTTP/2).
 * @returns les composants découpés, ou `null` (bail-out → vrai `new URL`).
 */
export function splitTarget(target: unknown): ISplitTarget | null {
  if (typeof target !== "string" || target.length === 0) {
    return null;
  }
  if (target.charCodeAt(0) !== SLASH) {
    // asterisk-form (`OPTIONS *`), absolute-form proxy, target vide…
    return null;
  }
  let prev = 0;
  for (let i = 0; i < target.length; i++) {
    const c = target.charCodeAt(i);
    if (c >= 128) {
      return null;
    }
    if (c === QMARK) {
      // Bascule en régime query : le reste doit traverser tel quel.
      for (let j = i + 1; j < target.length; j++) {
        const s = target.charCodeAt(j);
        if (s >= 128 || SEARCH_SAFE[s] === 0) {
          return null;
        }
      }
      return {
        pathname: target.slice(0, i),
        // `/x?` (query vide) → URL.search === "" — même contrat ici.
        search: i === target.length - 1 ? "" : target.slice(i),
      };
    }
    if (PATH_SAFE[c] === 0) {
      return null;
    }
    if (c === SLASH && prev === SLASH) {
      // `//` : segment vide — WHATWG le garde, mais un pathname à segments
      // vides est un classique de contournement de matchers → parse complet.
      return null;
    }
    if (c === DOT && prev === SLASH) {
      // `/.` ouvre un dot-segment potentiel (`/./`, `/../`, `/.` final) que
      // WHATWG RÉSOUT — jamais de découpe. (Refuse aussi `/.well-known` :
      // faux positif assumé, le bail-out n'est que le chemin d'avant.)
      return null;
    }
    prev = c;
  }
  return { pathname: target, search: "" };
}

/**
 * L'autorité (`host[:port]` brut de l'en-tête `Host` / `:authority`) est-elle
 * déjà sous la forme exacte que le parseur WHATWG rendrait ?
 *
 * Refusé (→ bail-out) : majuscules (lowercase WHATWG), IPv6 (`[`), toute
 * forme « IPv4-like » ambiguë (`127.1`, `0x7f.1`, `2130706433` — WHATWG les
 * NORMALISE en dotted-quad, un matcher les lisant brut serait contournable),
 * label vide (`a..b`, `.a`, `a.`), port par défaut du scheme (élidé par
 * WHATWG) ou avec zéro de tête, percent-encoding, non-ASCII (punycode).
 *
 * @param host - autorité brute (peut contenir `:port`).
 * @param scheme - scheme effectif (`http` | `https`) — décide du port par défaut.
 */
export function isCanonicalAuthority(
  host: unknown,
  scheme: string,
): host is string {
  if (typeof host !== "string" || host.length === 0) {
    return false;
  }
  let colon = -1;
  for (let i = 0; i < host.length; i++) {
    const c = host.charCodeAt(i);
    if (c === COLON) {
      if (colon !== -1) {
        return false; // second `:` — IPv6 sans crochets / forme invalide
      }
      colon = i;
      continue;
    }
    if (
      c >= 128 ||
      (colon === -1 ? HOST_SAFE[c] === 0 : c < 0x30 || c > 0x39)
    ) {
      // partie host : table stricte ; partie port : chiffres seuls
      return false;
    }
  }
  const name = colon === -1 ? host : host.slice(0, colon);
  if (name.length === 0) {
    return false;
  }
  if (colon !== -1) {
    const port = host.slice(colon + 1);
    if (port.length === 0 || port.charCodeAt(0) === 0x30) {
      return false; // `host:` nu, ou zéro de tête (`0443` → 443 → élision)
    }
    if (
      (scheme === "https" && port === "443") ||
      (scheme === "http" && port === "80")
    ) {
      return false; // port par défaut : WHATWG l'élide du href
    }
  }
  // Labels : jamais vides ; si le DERNIER est numérique, seule la
  // dotted-quad IPv4 canonique traverse WHATWG à l'identique.
  const labels = name.split(".");
  for (const label of labels) {
    if (label.length === 0) {
      return false;
    }
  }
  const last = labels[labels.length - 1];
  if (isDigits(last)) {
    if (labels.length !== 4) {
      return false; // `127.1`, `2130706433`, `1.2.3.4.5`…
    }
    for (const label of labels) {
      if (!isDigits(label) || label.length > 3) {
        return false; // `0x7f.0.0.1` et toute forme hex/octale
      }
      if (label.length > 1 && label.charCodeAt(0) === 0x30) {
        return false; // zéro de tête (`010.0.0.1` = forme octale WHATWG)
      }
      if (Number(label) > 255) {
        return false;
      }
    }
  }
  return true;
}

function isDigits(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x30 || c > 0x39) {
      return false;
    }
  }
  return true;
}
