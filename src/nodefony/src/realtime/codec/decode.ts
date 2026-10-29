/**
 * Décodeur CBOR (RFC 8949) restreint au modèle JSON + octets — ADR-0022 §2, ADR-0021 S8.
 *
 * Profil accepté : types majeurs 0, 1, 2, 3, 4, 5 et 7 ; `false`/`true`/`null`/
 * `undefined` ; flottants 16/32/64 bits ; longueurs indéfinies (§3.2, émises par des
 * encodeurs en flux). Refusé : étiquettes (type 6), autres valeurs simples, clés de
 * map non textuelles, clés en double, UTF-8 invalide (§5.3.1), octets en trop.
 *
 * Ce qui vient d'un pair étranger et n'existe pas en JSON est ramené à ce que
 * `JSON.parse` rendrait : `NaN`/`±Infinity` → `null` ; `undefined` → `null` dans un
 * tableau, clé omise dans un objet, `null` à la racine ; un entier au-delà de 2^53 →
 * le `Number` le plus proche. Une chaîne d'octets revient en `Uint8Array` — une VUE
 * sur l'entrée, sans copie.
 *
 * Bornes contre un message hostile (§10) : profondeur maximale ; toute longueur
 * annoncée confrontée aux octets restants AVANT la moindre allocation ; budget
 * global de préallocation des tableaux ; aucune boucle quadratique.
 *
 * Aucune `DataView` sur l'entrée : en créer une coûte ~250 ns, un quart du décodage
 * d'un petit message. Les octets se lisent à l'index, les entiers se composent par
 * décalages, les flottants passent par une sonde fixe de 8 octets.
 *
 * Code isomorphe (navigateur + Node) : rien de Node, pas de `Buffer`.
 */
import { CborError } from "./errors";
import { float16Value } from "./float16";

/** Options de {@link decodeCbor}. */
export interface ICborDecodeOptions {
  /**
   * Profondeur maximale d'imbrication des tableaux et objets (racine = 0). Au-delà,
   * le message est refusé — RFC 8949 §10. Défaut : 64.
   */
  readonly maxDepth?: number;
}

const DEFAULT_MAX_DEPTH = 64;
/** Jusqu'à cette longueur en octets, un texte ASCII se bâtit d'un seul `fromCharCode`. */
const INLINE_TEXT_MAX_BYTES = 16;
/** Jusqu'à cette longueur en octets, un texte se décode à la main ; au-delà, `TextDecoder`. */
const INLINE_UTF8_MAX_BYTES = 64;
const KEY_CACHE_SIZE = 4096;

/** Strict (§5.3.1) ; `ignoreBOM` GARDE un U+FEFF initial dans le texte, comme `JSON.parse`. */
const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const EMPTY = new Uint8Array(0);
const fromCharCode = String.fromCharCode;
/** Sonde de conversion bits → flottant, allouée une fois pour toutes. */
const probe = new DataView(new ArrayBuffer(8));

let src: Uint8Array = EMPTY;
let p = 0;
let end = 0;
/** Octets encore « disponibles » pour préallouer des tableaux : la somme des longueurs annoncées d'un message valide ne dépasse jamais sa taille. */
let budget = 0;
let maxDepth = DEFAULT_MAX_DEPTH;

/**
 * Cache des clés courtes (< 24 octets, ASCII) : une clé déjà vue revient comme la
 * MÊME chaîne, sans allocation ni ré-internement — c'est ce qui rend l'écriture des
 * propriétés rapide. Indexé par un hachage (longueur, deux premiers octets).
 */
const keyCache: (string | undefined)[] = new Array<string | undefined>(
  KEY_CACHE_SIZE,
);
/**
 * Estampille par case du cache : « cette case a déjà servi dans l'objet n° X ». Une
 * clé en double repasse forcément par sa case → vérification `Object.hasOwn`, sinon
 * rien. Les collisions ne font que déclencher une vérification de trop.
 */
const keySeen = new Int32Array(KEY_CACHE_SIZE);
let objectSerial = 0;
/** Case du cache par laquelle est passée la dernière clé lue (`-1` : clé hors cache). */
let lastKeySlot = -1;

/**
 * Décode un message CBOR en la valeur que `JSON.parse` aurait rendue du même contenu.
 *
 * Le résultat ne contient que des objets ordinaires, tableaux, chaînes, nombres,
 * booléens, `null` — et des `Uint8Array` pour les chaînes d'octets. Ceux-ci sont des
 * VUES sur `bytes` (`subarray`, sans copie) : l'appelant ne doit pas réutiliser ni
 * modifier le tampon d'entrée tant qu'il garde le résultat (une chaîne d'octets de
 * longueur indéfinie, rare, est en revanche recopiée).
 *
 * @param bytes - exactement un élément CBOR, rien avant, rien après
 * @param options - bornes ({@link ICborDecodeOptions.maxDepth})
 * @returns la valeur décodée ; jamais `undefined`
 * @throws {CborError} message mal formé (Appendice F), hors du profil (étiquette,
 *   valeur simple, clé non textuelle, clé en double, UTF-8 invalide) ou hors bornes
 *   (profondeur, longueur annoncée supérieure aux octets restants) — avec la position
 *   de l'octet fautif
 */
export function decodeCbor(
  bytes: Uint8Array,
  options?: ICborDecodeOptions,
): unknown {
  const depthLimit = options?.maxDepth ?? DEFAULT_MAX_DEPTH;
  if (!Number.isInteger(depthLimit) || depthLimit < 1) {
    throw new CborError(
      `Option maxDepth invalide (${String(depthLimit)}) : entier ≥ 1 attendu`,
    );
  }
  src = bytes;
  p = 0;
  end = bytes.byteLength;
  budget = end;
  maxDepth = depthLimit;
  try {
    const v = readItem(0);
    if (p !== end)
      fail(p, `${end - p} octet(s) en trop après l'élément racine`);
    return v;
  } finally {
    src = EMPTY;
  }
}

function fail(at: number, what: string): never {
  throw new CborError(`CBOR refusé à l'octet ${at} : ${what}`, at);
}

function need(n: number, at: number): void {
  if (p + n > end) {
    fail(
      at,
      `fin prématurée (${n} octet(s) attendu(s), ${end - p} restant(s))`,
    );
  }
}

// ---------------------------------------------------------------------------
// Lecture brute
// ---------------------------------------------------------------------------

/** Octet à l'index `i` — l'appelant a vérifié qu'il existe ; le `?? 0` ne sert qu'au typage. */
function u8(i: number): number {
  return src[i] ?? 0;
}

function u16(i: number): number {
  return (u8(i) << 8) | u8(i + 1);
}

function u32(i: number): number {
  return (
    ((u8(i) << 24) | (u8(i + 1) << 16) | (u8(i + 2) << 8) | u8(i + 3)) >>> 0
  );
}

function f32(i: number): number {
  probe.setUint32(0, u32(i));
  return probe.getFloat32(0);
}

function f64(i: number): number {
  probe.setUint32(0, u32(i));
  probe.setUint32(4, u32(i + 4));
  return probe.getFloat64(0);
}

// ---------------------------------------------------------------------------
// Élément
// ---------------------------------------------------------------------------

/** Lit un élément ; le simple CBOR `undefined` vaut `null` ici (racine, tableau) — une map le lit avant, cf {@link readValueOrOmit}. */
function readItem(depth: number): unknown {
  if (p >= end) fail(p, "fin prématurée (élément attendu)");
  const at = p;
  const ib = u8(p++);
  const ai = ib & 0x1f;
  switch (ib >>> 5) {
    case 0:
      if (ai < 24) return ai;
      if (ai === 24) {
        need(1, at);
        return u8(p++);
      }
      return readUint(ai, at);
    case 1:
      return ai < 24 ? -1 - ai : readNegative(ai, at);
    case 2:
      return ai === 31
        ? readIndefiniteBytes(at)
        : readBytes(readLength(ai, at), at);
    case 3:
      return ai === 31
        ? readIndefiniteText(at)
        : readText(readLength(ai, at), at);
    case 4:
      if (depth >= maxDepth) fail(at, `profondeur supérieure à ${maxDepth}`);
      return ai === 31
        ? readIndefiniteArray(at, depth)
        : readArray(readLength(ai, at), at, depth);
    case 5:
      if (depth >= maxDepth) fail(at, `profondeur supérieure à ${maxDepth}`);
      return ai === 31
        ? readIndefiniteMap(at, depth)
        : readMap(readLength(ai, at), at, depth);
    case 6:
      return fail(
        at,
        "étiquette (type majeur 6) : hors du profil JSON + octets",
      );
    default:
      // Le fréquent en ligne : null/true/false/undefined et les trois flottants ; le rare (refus) à part.
      if (ai === 22 || ai === 23) return null;
      if (ai === 21) return true;
      if (ai === 20) return false;
      if (ai === 27) {
        need(8, at);
        const v = f64(p);
        p += 8;
        return Number.isFinite(v) ? v : null;
      }
      if (ai === 25) {
        need(2, at);
        const v = float16Value(u16(p));
        p += 2;
        return Number.isFinite(v) ? v : null;
      }
      if (ai === 26) {
        need(4, at);
        const v = f32(p);
        p += 4;
        return Number.isFinite(v) ? v : null;
      }
      return readSimple(ai, at);
  }
}

// ---------------------------------------------------------------------------
// Arguments et entiers
// ---------------------------------------------------------------------------

/** Argument d'un entier positif (ai ≥ 24) ; au-delà de 2^53, le `Number` le plus proche — ce que `JSON.parse` ferait du même littéral. */
function readUint(ai: number, at: number): number {
  switch (ai) {
    case 24:
      need(1, at);
      return u8(p++);
    case 25: {
      need(2, at);
      const v = u16(p);
      p += 2;
      return v;
    }
    case 26: {
      need(4, at);
      const v = u32(p);
      p += 4;
      return v;
    }
    case 27: {
      need(8, at);
      const hi = u32(p);
      const lo = u32(p + 4);
      p += 8;
      return hi * 0x100000000 + lo;
    }
    default:
      return failAdditionalInfo(ai, at);
  }
}

/** Entier négatif `-1 - n` (ai ≥ 24) ; au-delà de 2^53, arrondi au plus proche en une seule opération inexacte. */
function readNegative(ai: number, at: number): number {
  if (ai !== 27) return -1 - readUint(ai, at);
  need(8, at);
  const hi = u32(p);
  const lo = u32(p + 4);
  p += 8;
  if (hi < 0x200000) return -1 - (hi * 0x100000000 + lo);
  return lo === 0xffffffff
    ? -((hi + 1) * 0x100000000)
    : -(hi * 0x100000000 + (lo + 1));
}

/** Longueur annoncée d'une chaîne, d'un tableau ou d'une map (ai < 31) ; une longueur ≥ 2^32 est refusée d'emblée. */
function readLength(ai: number, at: number): number {
  if (ai < 24) return ai;
  if (ai === 27) {
    need(8, at);
    if (u32(p) !== 0) {
      fail(at, "longueur annoncée hors de portée (≥ 2^32)");
    }
    const v = u32(p + 4);
    p += 8;
    return v;
  }
  return readUint(ai, at);
}

function failAdditionalInfo(ai: number, at: number): never {
  return ai === 31
    ? fail(at, "longueur indéfinie interdite pour ce type majeur (§3.2.4)")
    : fail(at, `information additionnelle réservée (${ai}, §3)`);
}

// ---------------------------------------------------------------------------
// Chaînes
// ---------------------------------------------------------------------------

/** Chaîne d'octets définie : une vue sur l'entrée, sans copie. */
function readBytes(n: number, at: number): Uint8Array {
  if (n > end - p) {
    fail(at, `chaîne d'octets de ${n} octets annoncée, ${end - p} restant(s)`);
  }
  const v = src.subarray(p, p + n);
  p += n;
  return v;
}

/** Chaîne d'octets indéfinie (§3.2.3) : des fragments définis du même type, concaténés — ici, une copie. */
function readIndefiniteBytes(at: number): Uint8Array {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    if (p >= end) fail(at, "fin prématurée : « break » attendu");
    const ib = u8(p);
    if (ib === 0xff) {
      p++;
      break;
    }
    if (ib >>> 5 !== 2 || (ib & 0x1f) === 31) {
      fail(
        p,
        "fragment d'une chaîne d'octets indéfinie qui n'est pas une chaîne d'octets définie (§3.2.3)",
      );
    }
    const chunkAt = p++;
    const n = readLength(ib & 0x1f, chunkAt);
    chunks.push(readBytes(n, chunkAt));
    total += n;
  }
  const out = new Uint8Array(total);
  let to = 0;
  for (const c of chunks) {
    out.set(c, to);
    to += c.byteLength;
  }
  return out;
}

/** Texte défini : court → à la main (ASCII d'un trait, sinon UTF-8 strict) ; long → `TextDecoder` strict. */
function readText(n: number, at: number): string {
  if (n > end - p) {
    fail(at, `texte de ${n} octets annoncé, ${end - p} restant(s)`);
  }
  if (n <= INLINE_TEXT_MAX_BYTES) {
    const s = readAscii(p, n);
    if (s !== null) {
      p += n;
      return s;
    }
  }
  if (n <= INLINE_UTF8_MAX_BYTES) {
    const s = readUtf8Inline(p, n);
    if (s === null) fail(at, "texte UTF-8 invalide (§5.3.1)");
    p += n;
    return s;
  }
  return readUtf8(n, at);
}

function readUtf8(n: number, at: number): string {
  try {
    const s = utf8.decode(src.subarray(p, p + n));
    p += n;
    return s;
  } catch {
    return fail(at, "texte UTF-8 invalide (§5.3.1)");
  }
}

/** Texte indéfini (§3.2.3) : chaque fragment est un texte défini, valide par lui-même. */
function readIndefiniteText(at: number): string {
  let s = "";
  for (;;) {
    if (p >= end) fail(at, "fin prématurée : « break » attendu");
    const ib = u8(p);
    if (ib === 0xff) {
      p++;
      return s;
    }
    if (ib >>> 5 !== 3 || (ib & 0x1f) === 31) {
      fail(
        p,
        "fragment d'un texte indéfini qui n'est pas un texte défini (§3.2.3)",
      );
    }
    const chunkAt = p++;
    s += readText(readLength(ib & 0x1f, chunkAt), chunkAt);
  }
}

/** Unités UTF-16 du texte court en cours de décodage — réutilisées, jamais réallouées. */
const units: number[] = [];

/**
 * Décodeur UTF-8 STRICT (WHATWG Encoding, tableau des octets valides) pour un texte de
 * 1 à 64 octets : refuse les formes trop longues, les substituts encodés, au-delà de
 * U+10FFFF et toute continuation manquante — exactement ce que `TextDecoder` en mode
 * `fatal` refuse — sans le coût de son appel et d'une vue. Rend `null` si invalide.
 */
function readUtf8Inline(q: number, n: number): string | null {
  const e = q + n;
  units.length = 0;
  while (q < e) {
    const b0 = u8(q++);
    if (b0 < 0x80) {
      units.push(b0);
      continue;
    }
    if (q >= e) return null;
    const b1 = u8(q++);
    if (b0 < 0xe0) {
      if (b0 < 0xc2 || (b1 & 0xc0) !== 0x80) return null;
      units.push(((b0 & 0x1f) << 6) | (b1 & 0x3f));
      continue;
    }
    if (q >= e) return null;
    const b2 = u8(q++);
    if ((b2 & 0xc0) !== 0x80) return null;
    if (b0 < 0xf0) {
      const lo = b0 === 0xe0 ? 0xa0 : 0x80;
      const hi = b0 === 0xed ? 0x9f : 0xbf;
      if (b1 < lo || b1 > hi) return null;
      units.push(((b0 & 0x0f) << 12) | ((b1 & 0x3f) << 6) | (b2 & 0x3f));
      continue;
    }
    if (b0 > 0xf4 || q >= e) return null;
    const b3 = u8(q++);
    if ((b3 & 0xc0) !== 0x80) return null;
    const lo = b0 === 0xf0 ? 0x90 : 0x80;
    const hi = b0 === 0xf4 ? 0x8f : 0xbf;
    if (b1 < lo || b1 > hi) return null;
    const cp =
      ((b0 & 0x07) << 18) |
      ((b1 & 0x3f) << 12) |
      ((b2 & 0x3f) << 6) |
      (b3 & 0x3f);
    const u = cp - 0x10000;
    units.push(0xd800 | (u >>> 10), 0xdc00 | (u & 0x3ff));
  }
  return fromCharCode.apply(null, units);
}

/**
 * Texte ASCII de 0 à 16 octets, bâti d'un seul `fromCharCode` (aucun tableau, aucune
 * vue). Rend `null` dès qu'un octet dépasse 0x7f — le texte passe alors par la voie UTF-8.
 */
function readAscii(q: number, n: number): string | null {
  let acc = 0;
  for (let i = 0; i < n; i++) acc |= u8(q + i);
  if ((acc & 0x80) !== 0) return null;
  switch (n) {
    case 0:
      return "";
    case 1:
      return fromCharCode(u8(q));
    case 2:
      return fromCharCode(u8(q), u8(q + 1));
    case 3:
      return fromCharCode(u8(q), u8(q + 1), u8(q + 2));
    case 4:
      return fromCharCode(u8(q), u8(q + 1), u8(q + 2), u8(q + 3));
    case 5:
      return fromCharCode(u8(q), u8(q + 1), u8(q + 2), u8(q + 3), u8(q + 4));
    case 6:
      return fromCharCode(
        u8(q),
        u8(q + 1),
        u8(q + 2),
        u8(q + 3),
        u8(q + 4),
        u8(q + 5),
      );
    case 7:
      return fromCharCode(
        u8(q),
        u8(q + 1),
        u8(q + 2),
        u8(q + 3),
        u8(q + 4),
        u8(q + 5),
        u8(q + 6),
      );
    case 8:
      return fromCharCode(
        u8(q),
        u8(q + 1),
        u8(q + 2),
        u8(q + 3),
        u8(q + 4),
        u8(q + 5),
        u8(q + 6),
        u8(q + 7),
      );
    default: {
      // 9 à 16 octets : deux appels, l'un de 8, l'autre du reste.
      const head = fromCharCode(
        u8(q),
        u8(q + 1),
        u8(q + 2),
        u8(q + 3),
        u8(q + 4),
        u8(q + 5),
        u8(q + 6),
        u8(q + 7),
      );
      return head + readAsciiTail(q + 8, n - 8);
    }
  }
}

/** Les 1 à 8 derniers octets d'un texte ASCII de 9 à 16 octets (déjà vérifiés ASCII). */
function readAsciiTail(q: number, n: number): string {
  switch (n) {
    case 1:
      return fromCharCode(u8(q));
    case 2:
      return fromCharCode(u8(q), u8(q + 1));
    case 3:
      return fromCharCode(u8(q), u8(q + 1), u8(q + 2));
    case 4:
      return fromCharCode(u8(q), u8(q + 1), u8(q + 2), u8(q + 3));
    case 5:
      return fromCharCode(u8(q), u8(q + 1), u8(q + 2), u8(q + 3), u8(q + 4));
    case 6:
      return fromCharCode(
        u8(q),
        u8(q + 1),
        u8(q + 2),
        u8(q + 3),
        u8(q + 4),
        u8(q + 5),
      );
    case 7:
      return fromCharCode(
        u8(q),
        u8(q + 1),
        u8(q + 2),
        u8(q + 3),
        u8(q + 4),
        u8(q + 5),
        u8(q + 6),
      );
    default:
      return fromCharCode(
        u8(q),
        u8(q + 1),
        u8(q + 2),
        u8(q + 3),
        u8(q + 4),
        u8(q + 5),
        u8(q + 6),
        u8(q + 7),
      );
  }
}

// ---------------------------------------------------------------------------
// Tableaux
// ---------------------------------------------------------------------------

/** Tableau défini : longueur confrontée aux octets restants ET au budget global avant `new Array`. */
function readArray(n: number, at: number, depth: number): unknown[] {
  if (n > end - p) {
    fail(
      at,
      `tableau de ${n} éléments annoncé, ${end - p} octet(s) restant(s)`,
    );
  }
  if (n > budget) {
    fail(
      at,
      "tableaux annoncés plus nombreux, au total, que les octets du message",
    );
  }
  budget -= n;
  const a = new Array<unknown>(n);
  for (let i = 0; i < n; i++) a[i] = readItem(depth + 1);
  return a;
}

/** Tableau indéfini (§3.2.2) : éléments jusqu'au « break ». */
function readIndefiniteArray(at: number, depth: number): unknown[] {
  const a: unknown[] = [];
  for (;;) {
    if (p >= end) fail(at, "fin prématurée : « break » attendu");
    if (u8(p) === 0xff) {
      p++;
      return a;
    }
    a.push(readItem(depth + 1));
  }
}

// ---------------------------------------------------------------------------
// Maps → objets ordinaires
// ---------------------------------------------------------------------------

/** Map définie : chaque entrée occupe au moins deux octets. */
function readMap(
  n: number,
  at: number,
  depth: number,
): Record<string, unknown> {
  if (n > (end - p) >>> 1) {
    fail(at, `objet de ${n} entrées annoncé, ${end - p} octet(s) restant(s)`);
  }
  const serial = ++objectSerial;
  const o: Record<string, unknown> = {};
  for (let i = 0; i < n; i++) {
    const keyAt = p;
    const k = readKey(depth);
    const slot = lastKeySlot;
    setEntry(o, k, readValueOrOmit(depth), slot, serial, keyAt);
  }
  return o;
}

/** Map indéfinie (§3.2.2) : paires jusqu'au « break » ; un « break » en position de valeur est mal formé. */
function readIndefiniteMap(at: number, depth: number): Record<string, unknown> {
  const serial = ++objectSerial;
  const o: Record<string, unknown> = {};
  for (;;) {
    if (p >= end) fail(at, "fin prématurée : « break » attendu");
    if (u8(p) === 0xff) {
      p++;
      return o;
    }
    const keyAt = p;
    const k = readKey(depth);
    const slot = lastKeySlot;
    setEntry(o, k, readValueOrOmit(depth), slot, serial, keyAt);
  }
}

/**
 * Valeur d'une entrée de map : le simple CBOR `undefined` (0xf7) est lu ICI comme
 * « clé omise » (`undefined`), là où partout ailleurs il vaut `null` — c'est ce que
 * `JSON.stringify` fait d'une propriété `undefined`.
 */
function readValueOrOmit(depth: number): unknown {
  if (p < end && u8(p) === 0xf7) {
    p++;
    return undefined;
  }
  return readItem(depth + 1);
}

/**
 * Pose une entrée : `undefined` → clé omise ; `__proto__` → propriété PROPRE, comme
 * `JSON.parse` (jamais le prototype) ; une clé déjà posée → refus.
 */
function setEntry(
  o: Record<string, unknown>,
  k: string,
  v: unknown,
  slot: number,
  serial: number,
  at: number,
): void {
  // Clé déjà passée par cette case dans CET objet (ou hors cache) → vérification réelle.
  if (slot < 0 || keySeen[slot] === serial) {
    if (Object.hasOwn(o, k)) fail(at, `clé « ${k} » en double`);
  } else {
    keySeen[slot] = serial;
  }
  if (v === undefined) return;
  if (k === "__proto__") {
    Object.defineProperty(o, k, {
      value: v,
      writable: true,
      enumerable: true,
      configurable: true,
    });
    return;
  }
  o[k] = v;
}

/** Clé de map : texte obligatoire. Les clés courtes passent par le cache. */
function readKey(depth: number): string {
  if (p >= end) fail(p, "fin prématurée (clé attendue)");
  const at = p;
  const ib = u8(p);
  if (ib >= 0x60 && ib < 0x78) {
    const n = ib - 0x60;
    p++;
    if (n > end - p) {
      fail(at, `clé de ${n} octets annoncée, ${end - p} restant(s)`);
    }
    if (n === 0) {
      lastKeySlot = -1;
      return "";
    }
    const b1 = n > 1 ? u8(p + 1) : 0;
    const slot = ((n << 5) ^ (u8(p) << 8) ^ b1) & (KEY_CACHE_SIZE - 1);
    lastKeySlot = slot;
    const hit = keyCache[slot];
    if (hit?.length === n && keyMatches(hit, n)) {
      p += n;
      return hit;
    }
    const s = n <= INLINE_TEXT_MAX_BYTES ? readAscii(p, n) : null;
    if (s !== null) {
      p += n;
      keyCache[slot] = s;
      return s;
    }
    const decoded = readUtf8(n, at);
    // Une clé non ASCII (plus d'octets que de caractères) ne se compare pas octet à caractère : hors cache.
    if (decoded.length === n) keyCache[slot] = decoded;
    return decoded;
  }
  lastKeySlot = -1;
  const k = readItem(depth);
  if (typeof k !== "string") {
    fail(at, "clé de map non textuelle : hors du profil JSON + octets");
  }
  return k;
}

/** Les `n` octets courants sont-ils, un à un, les caractères (ASCII) de `s` ? */
function keyMatches(s: string, n: number): boolean {
  for (let i = 0; i < n; i++) {
    if (s.charCodeAt(i) !== u8(p + i)) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Type majeur 7 — le reste
// ---------------------------------------------------------------------------

/**
 * Le reste du type majeur 7 (§3.3), tout refusé : valeurs simples hors `false`/`true`/
 * `null`/`undefined` (0..19, et 32..255 sur deux octets), formes mal formées (24 suivi
 * de < 32 ; 28..30 réservés) et « break » hors d'un élément indéfini.
 */
function readSimple(ai: number, at: number): never {
  if (ai === 24) {
    need(1, at);
    const v = u8(p++);
    if (v < 32) {
      fail(at, `valeur simple ${v} sur deux octets : mal formée (§3.3)`);
    }
    return fail(at, `valeur simple ${v} : hors du profil JSON + octets`);
  }
  if (ai === 31) {
    return fail(
      at,
      "« break » hors d'un élément de longueur indéfinie (§3.2.1)",
    );
  }
  return ai < 20
    ? fail(at, `valeur simple ${ai} : hors du profil JSON + octets`)
    : fail(at, `information additionnelle réservée (${ai}, §3.3)`);
}
