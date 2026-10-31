/**
 * base64url sans bourrage (RFC 4648 §5) — l'alphabet de la conversion CBOR → JSON
 * (RFC 8949 §6.1). Code partagé, sans `Buffer` ni `btoa` : le navigateur et Node
 * passent par la même implémentation.
 */

const ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** Codes ASCII de l'alphabet, lus par index de 6 bits. */
const ENCODE_TABLE = new Uint8Array(64);
/** Valeur de 6 bits d'un code ASCII, `-1` hors alphabet. */
const DECODE_TABLE = new Int8Array(128).fill(-1);
for (let i = 0; i < 64; i++) {
  const code = ALPHABET.charCodeAt(i);
  ENCODE_TABLE[i] = code;
  DECODE_TABLE[code] = i;
}

const ascii = new TextDecoder();

/** Code ASCII du caractère de 6 bits `v` (toujours dans la table). */
function sextet(v: number): number {
  return ENCODE_TABLE[v & 63] ?? 0;
}

/**
 * Encode des octets en base64url sans bourrage.
 *
 * @param bytes - les octets à encoder.
 * @returns la chaîne base64url, sans `=` final.
 */
export function toBase64Url(bytes: Uint8Array): string {
  const len = bytes.length;
  const out = new Uint8Array(Math.ceil((len * 4) / 3));
  let o = 0;
  let i = 0;
  for (; i + 2 < len; i += 3) {
    const n =
      ((bytes[i] ?? 0) << 16) |
      ((bytes[i + 1] ?? 0) << 8) |
      (bytes[i + 2] ?? 0);
    out[o++] = sextet(n >>> 18);
    out[o++] = sextet(n >>> 12);
    out[o++] = sextet(n >>> 6);
    out[o++] = sextet(n);
  }
  const rest = len - i;
  if (rest > 0) {
    const n =
      ((bytes[i] ?? 0) << 16) | (rest === 2 ? (bytes[i + 1] ?? 0) << 8 : 0);
    out[o++] = sextet(n >>> 18);
    out[o++] = sextet(n >>> 12);
    if (rest === 2) out[o] = sextet(n >>> 6);
  }
  return ascii.decode(out);
}

/**
 * Décode une chaîne base64url sans bourrage — stricte : tout caractère hors alphabet,
 * un `=` ou une longueur impossible est refusé (entrée réseau, non fiable).
 *
 * @param text - la chaîne base64url.
 * @returns des octets neufs.
 * @throws TypeError Quand la chaîne n'est pas du base64url sans bourrage valide.
 */
export function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const len = text.length;
  if (len % 4 === 1) throw invalid(len);
  const out = new Uint8Array(Math.floor((len * 3) / 4));
  let o = 0;
  let acc = 0;
  let bits = 0;
  for (let i = 0; i < len; i++) {
    const code = text.charCodeAt(i);
    const v = code < 128 ? (DECODE_TABLE[code] ?? -1) : -1;
    if (v < 0) throw invalid(i);
    acc = ((acc << 6) | v) & 0xffffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (acc >>> bits) & 0xff;
    }
  }
  // Les bits de remplissage du dernier groupe doivent être nuls (RFC 4648 §3.5) :
  // sinon deux chaînes différentes décoderaient les mêmes octets.
  if ((acc & ((1 << bits) - 1)) !== 0) throw invalid(len - 1);
  return out;
}

function invalid(at: number): TypeError {
  return new TypeError(`base64url invalide (position ${at})`);
}
