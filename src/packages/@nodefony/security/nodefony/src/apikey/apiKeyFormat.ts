import { createHash, randomBytes } from "node:crypto";

/**
 * Encodage / décodage / hachage des clés API (PAT) — logique **pure** (aucun I/O,
 * aucun container) → testable sans serveur et partagée par l'émetteur
 * (`ApiKeyService`) et le vérificateur (`ApiKeyAuthenticator`).
 *
 * **Format émis** : `<prefix>_<pubid><secret><crc>` (un seul séparateur `_`, le
 * reste est **positionnel** — pas de `split` fragile, car le charset base64url
 * contient lui-même `-` et `_`). Exemple : `nf_a1b2c3d4XXXX…XXXXz9z9z9`.
 *
 *  - `prefix`  : marque applicative (`apiKeys.prefix`, ex. `nf`) — discrimine un
 *    PAT d'un JWT (qui, lui, a la structure compacte `a.b.c`) ;
 *  - `pubid`   : 6 octets aléatoires → 8 car. — identifiant **public** affichable
 *    (`record.prefix` = `nf_a1b2c3d4`), jamais secret, sert l'UI/console ;
 *  - `secret`  : 32 octets aléatoires → 43 car. = **256 bits d'entropie** ;
 *  - `crc`     : CRC32 (4 octets → 6 car.) du `prefix_pubid_secret`. Checksum
 *    **public** (jamais un secret) : permet (1) de **rejeter une clé malformée en
 *    O(1) sans toucher la base** (anti-DoS du store), (2) le **secret-scanning**
 *    (GitGuardian/GitHub détectent un `nf_…` au checksum valide qui aurait fuité).
 *
 * **Au repos** : seul `sha256(token entier)` est stocké (`secretHash`). `sha256`
 * suffit ici — contrairement à un mot de passe humain (faible → argon2), un secret
 * de 256 bits aléatoires n'est ni brute-forçable ni sujet aux rainbow tables ; un
 * pepper ne protègerait que des secrets faibles.
 */

// Longueurs dérivées des tailles d'octets (base64url sans padding).
const PUBID_BYTES = 6;
const SECRET_BYTES = 32;
const PUBID_LEN = 8; //  6 octets  → 8 car. base64url
const SECRET_LEN = 43; // 32 octets → 43 car. base64url
const CRC_LEN = 6; //     4 octets  → 6 car. base64url
const BODY_LEN = PUBID_LEN + SECRET_LEN + CRC_LEN; // 57
const BASE64URL = /^[A-Za-z0-9_-]+$/;

// Table CRC32 (IEEE 802.3) précalculée une fois au chargement du module — le
// checksum est PUBLIC (intégrité de forme), donc une impl locale déterministe
// (sans dépendance ni variation de version Node) est préférable à `zlib.crc32`.
const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC32 (IEEE) d'une chaîne ASCII — entier non signé 32 bits. */
function crc32(input: string): number {
  let crc = 0xffffffff;
  for (let i = 0; i < input.length; i++) {
    crc =
      (CRC_TABLE[(crc ^ input.charCodeAt(i)) & 0xff] as number) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Chunk de checksum (6 car. base64url) du payload `prefix_pubid_secret`. */
function crcChunk(payload: string): string {
  const buf = Buffer.allocUnsafe(4);
  buf.writeUInt32BE(crc32(payload));
  return buf.toString("base64url");
}

/** Hash au repos d'une clé présentée (token entier) — `sha256` hex. */
export function hashApiKey(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Résultat d'une génération de clé — le `token` n'est disponible qu'ICI (1×). */
export interface IGeneratedApiKey {
  /** Token complet EN CLAIR — à afficher une seule fois, jamais re-dérivable. */
  token: string;
  /** Identifiant public (8 car.) — composant de {@link IGeneratedApiKey.publicPrefix}. */
  pubid: string;
  /** Préfixe public affichable (`<prefix>_<pubid>`) → `record.prefix`. */
  publicPrefix: string;
  /** Hash au repos (`sha256` hex) → `record.secretHash`. */
  secretHash: string;
}

/**
 * Génère une nouvelle clé API cryptographiquement aléatoire.
 *
 * @param prefix - marque applicative (`apiKeys.prefix`).
 * @returns le token clair + ses dérivés publics/persistants.
 */
export function generateApiKey(prefix: string): IGeneratedApiKey {
  const pubid = randomBytes(PUBID_BYTES).toString("base64url");
  const secret = randomBytes(SECRET_BYTES).toString("base64url");
  const payload = `${prefix}_${pubid}${secret}`;
  const token = `${payload}${crcChunk(payload)}`;
  return {
    token,
    pubid,
    publicPrefix: `${prefix}_${pubid}`,
    secretHash: hashApiKey(token),
  };
}

/** Décomposition validée d'une clé présentée. */
export interface IParsedApiKey {
  pubid: string;
  publicPrefix: string;
  /** Hash de lookup (`findByHash`) — `sha256` du token entier présenté. */
  secretHash: string;
}

/**
 * Test **bon marché** (préfixe seul) — discrimine un PAT d'un JWT à l'`supports()`
 * de l'authenticator, sans calculer le checksum.
 */
export function looksLikeApiKey(token: string, prefix: string): boolean {
  return token.startsWith(`${prefix}_`);
}

/**
 * Valide la **forme** d'une clé présentée et en dérive le hash de lookup —
 * **sans aucun accès au store**. Rejette (→ `null`) un préfixe absent, une
 * longueur incorrecte, un charset non base64url ou un **CRC invalide** : autant
 * de requêtes qui n'atteignent jamais la base (anti-DoS).
 *
 * @param token - valeur brute présentée (after `Bearer `).
 * @param prefix - marque applicative attendue.
 * @returns la décomposition + le `secretHash` de lookup, ou `null` si malformée.
 */
export function parseApiKey(
  token: string,
  prefix: string,
): IParsedApiKey | null {
  const head = `${prefix}_`;
  if (!token.startsWith(head)) return null;
  const body = token.slice(head.length);
  if (body.length !== BODY_LEN || !BASE64URL.test(body)) return null;
  const pubid = body.slice(0, PUBID_LEN);
  const secret = body.slice(PUBID_LEN, PUBID_LEN + SECRET_LEN);
  const crc = body.slice(PUBID_LEN + SECRET_LEN);
  if (crcChunk(`${prefix}_${pubid}${secret}`) !== crc) return null;
  return {
    pubid,
    publicPrefix: `${prefix}_${pubid}`,
    secretHash: hashApiKey(token),
  };
}
