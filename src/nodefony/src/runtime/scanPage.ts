import { Buffer } from "node:buffer";

/**
 * Pagination d'un balayage Redis `SCAN` — **règle unique** de tous les stores
 * Redis du framework (sessions, jetons d'accès, passkeys, idempotence).
 *
 * Pure et sans dépendance de paquet : le cœur la porte pour que des paquets qui ne se
 * connaissent pas (`@nodefony/redis`, `@nodefony/framework`) appellent la MÊME
 * implémentation. Chaque store en portait sa copie ; elles ont divergé — l'une
 * validait le curseur reçu, les autres non — puis partagé la même perte de clés.
 */

/**
 * Plafond de sécurité d'un balayage : emplacements examinés par appel de
 * {@link scanPage}, et plafond des dumps administratifs complets des stores. Au-delà, on
 * s'arrête et on le **signale** (page incomplète avec curseur, ou journal) —
 * jamais une troncature silencieuse.
 *
 * `SCAN` est O(keyspace) — un index secondaire (`SET` d'ids) serait
 * l'optimisation pour un très grand parc.
 */
export const MAX_SCAN = 10_000;

/** Octets par empreinte dans le curseur : 53 bits tiennent en 7 octets. */
const FINGERPRINT_BYTES = 7;

/** Alphabet base64url sans remplissage — le seul que {@link encodeCursor} produit. */
const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;

/** Un curseur `SCAN` Redis : une suite de chiffres. */
const SCAN_CURSOR_RE = /^\d+$/;

/**
 * Longueur au-delà de laquelle un curseur reçu est jeté sans être décodé :
 * {@link MAX_SCAN} empreintes en base64url, plus le curseur Redis. Rien de
 * légitime ne l'atteint.
 */
const MAX_CURSOR_LENGTH =
  Math.ceil((MAX_SCAN * FINGERPRINT_BYTES * 4) / 3) + 32;

/**
 * Empreinte 53 bits d'une clé (cyrb53) — identifie une clé déjà parcourue sans
 * la transporter.
 *
 * Non cryptographique, et ce n'est pas son rôle : une empreinte ne fait que
 * SAUTER une clé du lot rejoué. Une collision (≈ 2⁻⁵³ par paire) fait au pire
 * manquer une clé à une page ; une empreinte forgée ne masque que les clés de
 * celui qui la forge. Graine FIXE : deux pods doivent lire le curseur l'un de
 * l'autre.
 *
 * @param key - clé Redis complète
 * @returns entier positif < 2⁵³
 */
export function keyFingerprint(key: string): number {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < key.length; i += 1) {
    const ch = key.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/**
 * Curseur de page : `"<curseurRedis>"`, ou `"<curseurRedis>.<empreintes>"` quand
 * la page s'est remplie au milieu d'un lot — les empreintes à la suite, 7 octets
 * chacune (petit-boutiste), en base64url.
 *
 * Pourquoi des empreintes et pas une position : Redis ne garantit PAS qu'un
 * même curseur `SCAN` rende le même lot deux fois — une insertion, une
 * suppression ou un rehash le recompose. « Reprends ce lot en sautant les N
 * premières clés » perdait donc des clés, et un parcours qui SUPPRIME (« déconnecter
 * partout ») pouvait laisser vivre une session. Rejouer le curseur reste sûr
 * (un curseur `SCAN` est sans état) ; ce qu'on saute se désigne par NOM.
 *
 * Pourquoi pas les clés elles-mêmes : une clé de session EST l'identifiant de
 * session. Un curseur voyage en query string, donc dans les journaux d'accès —
 * et un curseur venu du client ne doit rien pouvoir faire lire que `SCAN`
 * n'ait rendu.
 *
 * Tout le curseur est en `[0-9A-Za-z._-]` : rien à échapper dans une URL.
 * Binaire plutôt que texte : mesuré sur 200 empreintes, encodage 3 µs contre
 * 104 µs en base 36, décodage 10 µs contre 35 µs, curseur 19 % plus court.
 *
 * @param scanCursor - curseur `SCAN` à rejouer (ou à poursuivre)
 * @param seen - empreintes des clés de CE lot déjà parcourues
 * @returns le curseur opaque
 */
export function encodeCursor(
  scanCursor: string,
  seen: readonly number[],
): string {
  if (seen.length === 0) return scanCursor;
  const bytes = new Uint8Array(seen.length * FINGERPRINT_BYTES);
  let o = 0;
  for (const fp of seen) {
    const lo = fp >>> 0;
    const hi = (fp - lo) / 4294967296;
    bytes[o++] = lo & 0xff;
    bytes[o++] = (lo >>> 8) & 0xff;
    bytes[o++] = (lo >>> 16) & 0xff;
    bytes[o++] = lo >>> 24;
    bytes[o++] = hi & 0xff;
    bytes[o++] = (hi >>> 8) & 0xff;
    bytes[o++] = hi >>> 16;
  }
  return `${scanCursor}.${Buffer.from(bytes.buffer, bytes.byteOffset, bytes.length).toString("base64url")}`;
}

/**
 * Inverse d'{@link encodeCursor} — tolère un curseur absent, vide ou malformé.
 *
 * Le curseur vient de l'extérieur (query string du data plane admin, client
 * qui rejoue une page) : il n'est PAS digne de confiance. Au moindre écart de
 * format, le curseur ENTIER est jeté et le balayage repart de `"0"` : des
 * empreintes appliquées à un autre lot que le leur sauteraient des clés au
 * hasard. Repartir du début est faux au pire d'une page (doublons) ; garder
 * une moitié serait faux sans le dire.
 *
 * @param cursor - curseur reçu (non fiable)
 * @returns le curseur `SCAN` à jouer et les empreintes à sauter (`null` = aucune)
 */
export function decodeCursor(cursor?: string): {
  scanCursor: string;
  seen: Set<number> | null;
} {
  const start = { scanCursor: "0", seen: null };
  if (!cursor || cursor.length > MAX_CURSOR_LENGTH) return start;
  const dot = cursor.indexOf(".");
  const scanCursor = dot === -1 ? cursor : cursor.slice(0, dot);
  if (!SCAN_CURSOR_RE.test(scanCursor)) return start;
  if (dot === -1) return { scanCursor, seen: null };
  const packed = cursor.slice(dot + 1);
  // Le décodeur base64url ignore EN SILENCE les caractères hors alphabet :
  // l'alphabet se vérifie avant, sinon « 0.a:b » passerait pour « 0.ab ».
  if (!BASE64URL_RE.test(packed)) return start;
  const bytes = Buffer.from(packed, "base64url");
  if (
    bytes.length === 0 ||
    bytes.length % FINGERPRINT_BYTES !== 0 ||
    bytes.length > MAX_SCAN * FINGERPRINT_BYTES
  ) {
    return start;
  }
  const seen = new Set<number>();
  for (let o = 0; o < bytes.length; o += FINGERPRINT_BYTES) {
    // Lecture EN PLACE (pas de vue par empreinte) ; `?? 0` ne sert qu'au typage,
    // la longueur est déjà un multiple de 7.
    const hi =
      (bytes[o + 4] ?? 0) |
      ((bytes[o + 5] ?? 0) << 8) |
      ((bytes[o + 6] ?? 0) << 16);
    // Au-delà de 21 bits de poids fort, ce n'est pas une empreinte (< 2⁵³).
    if (hi > 0x1fffff) return start;
    const lo =
      ((bytes[o] ?? 0) |
        ((bytes[o + 1] ?? 0) << 8) |
        ((bytes[o + 2] ?? 0) << 16)) +
      (bytes[o + 3] ?? 0) * 16777216;
    seen.add(hi * 4294967296 + lo);
  }
  return { scanCursor, seen };
}

/** Un curseur `SCAN` exploitable (chiffres) ou `"0"` — jamais du texte libre. */
export function scanOrZero(value: string): string {
  return SCAN_CURSOR_RE.test(value) ? value : "0";
}

/** Un lot `SCAN` tel que node-redis le rend : curseur suivant (string) + clés. */
export interface IScanBatch {
  cursor: string;
  keys: readonly string[];
}

/**
 * Empreintes à emporter quand la page se remplit au milieu d'un lot : les clés
 * parcourues ici, plus celles du lot déjà parcourues aux pages précédentes.
 * Bornées par la taille du lot — les empreintes d'un lot précédent qui n'y
 * figurent plus sont oubliées (au pire un doublon, jamais une perte).
 *
 * @returns `null` quand il ne reste aucune clé neuve dans le lot
 */
function walkedFingerprints(
  keys: readonly string[],
  walked: number,
  seen: Set<number> | null,
): number[] | null {
  const out: number[] = [];
  if (seen === null) {
    // Lot vu pour la première fois : tout ce qui suit `walked` est neuf, inutile
    // de le hacher.
    for (let i = 0; i < walked; i += 1) out.push(keyFingerprint(keys[i] ?? ""));
    return walked < keys.length ? out : null;
  }
  let fresh = 0;
  let index = 0;
  for (const key of keys) {
    const fp = keyFingerprint(key);
    if (index < walked || seen.has(fp)) out.push(fp);
    else fresh += 1;
    index += 1;
  }
  return fresh === 0 ? null : out;
}

/**
 * Rend UNE page d'un balayage `SCAN` filtré, sans perte de clé d'une page à
 * l'autre.
 *
 * Les lots s'enchaînent jusqu'à **remplir** la page, finir le balayage, ou
 * épuiser l'effort borné ({@link MAX_SCAN} emplacements examinés par appel).
 * 🔴 Un seul lot ne suffit pas : `SCAN COUNT` examine des emplacements de TOUT
 * le keyspace (autres applications, idempotence, jetons), et un lot peut ne
 * contenir aucune clé retenue par le filtre.
 *
 * Une page pleine au milieu d'un lot rend un curseur qui REJOUE ce lot en
 * sautant, par empreinte, les clés déjà parcourues ({@link encodeCursor}) : un
 * lot réordonné ou amputé entre deux pages ne fait rien perdre. Une clé peut en
 * revanche revenir deux fois sous rehash — la garantie de `SCAN` lui-même. Le
 * keyspace n'est jamais matérialisé — un lot à la fois.
 *
 * @param scan - lance un `SCAN` depuis ce curseur (MATCH et COUNT fixés par
 *   l'appelant)
 * @param cursor - curseur reçu du client (non fiable — décodé et validé)
 * @param limit - taille maximale de la page
 * @param accept - lit une clé et rend l'élément à publier, ou `null` s'il est
 *   écarté (filtre, clé expirée, valeur corrompue)
 * @returns les éléments de la page et le curseur suivant (`null` = fin)
 */
export async function scanPage<T>(
  scan: (cursor: string) => Promise<IScanBatch>,
  cursor: string | undefined,
  limit: number,
  accept: (key: string) => Promise<T | null>,
): Promise<{ items: T[]; nextCursor: string | null }> {
  const decoded = decodeCursor(cursor);
  let at = decoded.scanCursor;
  let seen = decoded.seen;
  const items: T[] = [];
  let budget = Math.max(1, Math.ceil(MAX_SCAN / limit));
  for (;;) {
    const res = await scan(at);
    budget -= 1;
    let walked = 0;
    for (const key of res.keys) {
      if (items.length >= limit) break; // page pleine → le reste pour après
      walked += 1;
      if (seen?.has(keyFingerprint(key))) continue;
      const item = await accept(key);
      if (item !== null) items.push(item);
    }
    if (walked < res.keys.length) {
      const fps = walkedFingerprints(res.keys, walked, seen);
      // Page pleine au milieu du lot : on le rejouera en sautant ce qui est vu.
      if (fps !== null) return { items, nextCursor: encodeCursor(at, fps) };
    }
    if (res.cursor === "0") {
      return { items, nextCursor: null }; // lot épuisé ET balayage terminé
    }
    at = scanOrZero(res.cursor);
    seen = null;
    if (items.length >= limit || budget <= 0) {
      // Page pleine, ou effort épuisé : la page part avec de quoi reprendre.
      return { items, nextCursor: encodeCursor(at, []) };
    }
  }
}
