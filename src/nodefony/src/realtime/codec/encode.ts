/**
 * Encodeur CBOR (RFC 8949) aligné sur `JSON.stringify` — ADR-0022 §2, ADR-0021 S8.
 *
 * Il suit pas à pas l'algorithme `SerializeJSONProperty` d'ECMA-262 : `toJSON`
 * appelé, enveloppes de primitifs déballées, `NaN`/`±Infinity` → `null`, `-0` → `0`,
 * `undefined`/fonction/symbole → `null` dans un tableau et clé omise dans un objet,
 * `Map`/`Set` → `{}`, clés dans l'ordre d'`Object.keys`, `bigint` et cycle refusés.
 * Une seule exception, les octets : un `Uint8Array` devient une chaîne d'octets
 * (type majeur 2) au lieu de l'objet `{"0":…}` que JSON en ferait.
 *
 * Sérialisation préférée (§4.1) : arguments les plus courts, flottants en 16, 32
 * puis 64 bits selon ce qui conserve la valeur ; un entier sûr part en entier, un
 * entier au-delà de 2^53 en flottant — comme JSON le représente. Les clés ne sont
 * jamais triées : l'ordre est celui de l'objet, la référence JSON l'exige.
 *
 * Code isomorphe (navigateur + Node) : rien de Node, pas de `Buffer`, pas d'`eval`.
 */
import { CborError } from "./errors";
import { float16Bits } from "./float16";

/**
 * Taille d'une ARÈNE. Les messages s'y écrivent à la suite ; un résultat court est une
 * VUE sur l'arène (aucune copie, aucun tampon hors tas — V8 alloue hors tas dès 64 octets),
 * et l'arène n'avance que dans un sens : des octets rendus ne sont jamais réécrits. C'est
 * ce qui la distingue d'un tampon réutilisé (cbor-x), que l'appel suivant écrase.
 */
const ARENA_BYTES = 32768;
/** Au-delà (moitié d'une arène), un résultat est copié à sa taille exacte et l'espace est repris. */
const VIEW_MAX_BYTES = ARENA_BYTES / 2;
/** Une arène qui a grossi au-delà de cette taille pour un message est rendue après lui : rien ne reste épinglé. */
const ARENA_RETAIN_MAX_BYTES = ARENA_BYTES * 4;
/**
 * Un `Uint8Array` au moins aussi long n'est pas copié dans l'arène : il est copié une
 * seule fois, dans un résultat à la taille exacte. En dessous, il est copié dans l'arène
 * et le résultat reste une vue — une copie, aucune allocation.
 */
const DIRECT_COPY_MIN_BYTES = VIEW_MAX_BYTES;
/** Au-delà de cette longueur (en caractères), une chaîne passe par `TextEncoder.encodeInto`. */
const INLINE_TEXT_MAX_CHARS = 64;
const MAX_SAFE_INTEGER = 9007199254740991;

const utf8 = new TextEncoder();

let scratch = new Uint8Array(ARENA_BYTES);
let view = new DataView(scratch.buffer);
/** Début du message en cours dans l'arène ; ce qui précède appartient à des résultats déjà rendus. */
let base = 0;
let pos = 0;
/** Conteneurs en cours de parcours (détection de cycle, comme `JSON.stringify`). */
let ancestors: unknown[] = [];
let depth = 0;
/** Grands `Uint8Array` dont la copie est différée vers le résultat. */
let deferred: IDeferredBytes[] | null = null;
let active = false;

interface IDeferredBytes {
  /** Décalage, depuis le début du message, où les octets s'insèrent. */
  readonly at: number;
  readonly bytes: Uint8Array;
}

/** Ce que `SerializeJSONProperty` lit sur une valeur objet : sa méthode `toJSON`, si elle existe. */
interface IJsonHooks {
  toJSON?: unknown;
}

/**
 * Affinement de type sans effet à l'exécution : tout objet se lit par clé textuelle en JavaScript.
 * TypeScript n'accepte pas `object` là où il attend un index, et le codec ne pose aucune conversion.
 */
function isKeyed(_v: object): _v is Record<string, unknown> {
  return true;
}

/**
 * Encode une valeur en CBOR, exactement ce que `JSON.stringify` puis `JSON.parse` en rendraient.
 *
 * `decodeCbor(encodeCbor(v))` est profondément égal à `JSON.parse(JSON.stringify(v))`
 * pour toute valeur `v`, à une exception près : un `Uint8Array` voyage en octets et
 * revient en `Uint8Array`. Le résultat est un tampon neuf, que l'appelant garde
 * aussi longtemps qu'il veut.
 *
 * @param value - la valeur à encoder (une enveloppe JSON-RPC, le plus souvent)
 * @returns les octets CBOR, sérialisation préférée (RFC 8949 §4.1)
 * @throws {CborError} `bigint` (comme JSON), structure circulaire (comme JSON), ou
 *   racine `undefined`/fonction/symbole — `JSON.stringify` ne rendrait aucun texte,
 *   un codec doit rendre une trame.
 */
export function encodeCbor(value: unknown): Uint8Array<ArrayBuffer> {
  if (active) return encodeReentrant(value);
  active = true;
  try {
    writeValue(prepare(value, ""));
    return finish();
  } finally {
    active = false;
    pos = base;
    for (let i = 0; i < depth; i++) ancestors[i] = null;
    depth = 0;
    deferred = null;
    if (scratch.length > ARENA_RETAIN_MAX_BYTES) {
      scratch = new Uint8Array(ARENA_BYTES);
      view = new DataView(scratch.buffer);
      base = 0;
      pos = 0;
    }
  }
}

/**
 * Un `toJSON` qui rappelle `encodeCbor` : l'état de l'encodage en cours est mis de
 * côté, l'encodage imbriqué travaille sur un état neuf, puis tout est restauré.
 */
function encodeReentrant(value: unknown): Uint8Array<ArrayBuffer> {
  const savedScratch = scratch;
  const savedView = view;
  const savedBase = base;
  const savedPos = pos;
  const savedAncestors = ancestors;
  const savedDepth = depth;
  const savedDeferred = deferred;
  scratch = new Uint8Array(ARENA_BYTES);
  view = new DataView(scratch.buffer);
  base = 0;
  pos = 0;
  ancestors = [];
  depth = 0;
  deferred = null;
  try {
    writeValue(prepare(value, ""));
    return finish();
  } finally {
    scratch = savedScratch;
    view = savedView;
    base = savedBase;
    pos = savedPos;
    ancestors = savedAncestors;
    depth = savedDepth;
    deferred = savedDeferred;
  }
}

/**
 * Assemble le résultat. Petit : copie exacte du tampon de travail. S'il en remplit au
 * moins la moitié : le tampon LUI-MÊME est rendu (aucune copie) et un neuf est pris
 * pour la suite — moins cher qu'allouer-puis-copier. Avec de grands `Uint8Array`
 * différés : un tampon à la taille exacte, chaque octet copié une seule fois.
 */
function finish(): Uint8Array<ArrayBuffer> {
  const length = pos - base;
  if (deferred === null) {
    if (length <= VIEW_MAX_BYTES) {
      // Vue sur l'arène, qui avance : ces octets ne seront jamais réécrits.
      const out = scratch.subarray(base, pos);
      base = pos;
      return out;
    }
    return scratch.slice(base, pos);
  }
  let total = length;
  for (const d of deferred) total += d.bytes.byteLength;
  const out = new Uint8Array(total);
  let from = base;
  let to = 0;
  for (const d of deferred) {
    const at = base + d.at;
    out.set(scratch.subarray(from, at), to);
    to += at - from;
    out.set(d.bytes, to);
    to += d.bytes.byteLength;
    from = at;
  }
  out.set(scratch.subarray(from, pos), to);
  return out;
}

function ensure(n: number): void {
  if (pos + n > scratch.length) grow(n);
}

/**
 * Arène pleine : une neuve, où seul le message EN COURS est recopié. L'ancienne reste
 * vivante tant qu'un résultat rendu la regarde — c'est le ramasse-miettes qui la libère.
 */
function grow(n: number): void {
  const used = pos - base;
  // Au moins une arène, au moins le besoin, au moins le double du déjà-écrit (croissance géométrique).
  const fresh = new Uint8Array(Math.max(ARENA_BYTES, used + n, used * 2));
  fresh.set(scratch.subarray(base, pos));
  scratch = fresh;
  view = new DataView(fresh.buffer);
  base = 0;
  pos = used;
}

// ---------------------------------------------------------------------------
// SerializeJSONProperty — étapes 2 (toJSON) et 4 (enveloppes), puis dispatch
// ---------------------------------------------------------------------------

/**
 * Applique à une valeur ce que `SerializeJSONProperty` fait AVANT de la typer :
 * `toJSON` (objets et `bigint`), puis déballage d'une enveloppe `Number`/`String`/
 * `Boolean`/`BigInt`. L'exception octets passe avant `toJSON` : un `Buffer` de Node
 * en a un, qui rendrait `{type:"Buffer",data:[…]}` — la déformation que S8 refuse.
 *
 * @param v - la valeur lue sur son conteneur
 * @param key - la clé (ou l'index) sous laquelle elle a été lue, passée à `toJSON`
 */
function prepare(v: unknown, key: string | number): unknown {
  if (typeof v === "object") {
    if (v === null) return null;
    const proto: unknown = Object.getPrototypeOf(v);
    const hooks: IJsonHooks = v;
    const toJSON = hooks.toJSON;
    if (
      proto === Object.prototype ||
      proto === Array.prototype ||
      proto === null
    ) {
      // Objet ou tableau ordinaire : ni octets, ni enveloppe — seul `toJSON` peut jouer.
      if (typeof toJSON !== "function") return v;
      v = toJSON.call(v, typeof key === "number" ? String(key) : key);
    } else {
      if (v instanceof Uint8Array) return v;
      if (typeof toJSON === "function") {
        v = toJSON.call(v, typeof key === "number" ? String(key) : key);
      }
    }
  } else if (typeof v === "bigint") {
    const toJSON: unknown = Reflect.get(BigInt.prototype, "toJSON", v);
    if (typeof toJSON === "function") {
      v = toJSON.call(v, typeof key === "number" ? String(key) : key);
    }
  } else {
    return v;
  }
  return typeof v === "object" && v !== null ? unwrapBoxed(v) : v;
}

/** Une enveloppe `Number`/`String`/`Boolean`/`BigInt` redevient sa primitive ; tout autre objet reste lui-même. */
function unwrapBoxed(v: object): unknown {
  const proto: unknown = Object.getPrototypeOf(v);
  if (
    proto === Object.prototype ||
    proto === null ||
    proto === Array.prototype
  ) {
    return v;
  }
  // Le test exact de la norme porte sur un emplacement interne ([[NumberData]]…) que JavaScript ne
  // lit pas. Les deux voies « sûres entre royaumes » sont pires : `Object.prototype.toString` se
  // falsifie par `Symbol.toStringTag`, et `Number.prototype.valueOf.call` lève une exception à
  // chaque instance de classe ordinaire. Une enveloppe venue d'un autre royaume (iframe, `vm`) est
  // un cas que JSON.stringify lui-même ne rencontre presque jamais.
  // oxlint-disable-next-line no-instanceof-builtins -- cf ci-dessus
  if (v instanceof Number) return Number(v);
  // oxlint-disable-next-line no-instanceof-builtins -- cf ci-dessus
  if (v instanceof String) return String(v);
  // oxlint-disable-next-line no-instanceof-builtins -- cf ci-dessus
  if (v instanceof Boolean) return Boolean.prototype.valueOf.call(v);
  // oxlint-disable-next-line no-instanceof-builtins -- cf ci-dessus
  if (v instanceof BigInt) return BigInt.prototype.valueOf.call(v);
  return v;
}

/** Ce que `SerializeJSONProperty` rend `undefined` : omis dans un objet, `null` dans un tableau. */
function isOmitted(v: unknown): boolean {
  return v === undefined || typeof v === "function" || typeof v === "symbol";
}

/** Écrit une valeur déjà passée par {@link prepare}. */
function writeValue(v: unknown): void {
  switch (typeof v) {
    case "string":
      writeText(v);
      return;
    case "number":
      writeNumber(v);
      return;
    case "boolean":
      ensure(1);
      scratch[pos++] = v ? 0xf5 : 0xf4;
      return;
    case "object":
      if (v === null) {
        ensure(1);
        scratch[pos++] = 0xf6;
        return;
      }
      if (Array.isArray(v)) {
        writeArray(v);
        return;
      }
      if (v instanceof Uint8Array) {
        writeBytes(v);
        return;
      }
      writeObject(v);
      return;
    case "bigint":
      throw new CborError(
        "Impossible d'encoder un BigInt — JSON.stringify le refuse aussi",
      );
    case "undefined":
    case "function":
    case "symbol":
      // undefined, fonction, symbole : n'arrivent ici qu'à la racine — les conteneurs les ont déjà écartés.
      throw new CborError(
        `Impossible d'encoder une racine de type ${typeof v} — JSON.stringify ne rendrait aucun texte`,
      );
  }
}

// ---------------------------------------------------------------------------
// Conteneurs
// ---------------------------------------------------------------------------

function enter(container: object): void {
  for (let i = 0; i < depth; i++) {
    if (ancestors[i] === container) {
      throw new CborError(
        "Impossible d'encoder une structure circulaire — JSON.stringify la refuse aussi",
      );
    }
  }
  ancestors[depth++] = container;
}

function leave(): void {
  ancestors[--depth] = null;
}

/** `SerializeJSONArray` : chaque index lu une fois ; un trou ou une valeur omise vaut `null`. */
function writeArray(a: readonly unknown[]): void {
  enter(a);
  const n = a.length;
  writeHead(4, n);
  for (let i = 0; i < n; i++) {
    const e = prepare(a[i], i);
    if (isOmitted(e)) {
      ensure(1);
      scratch[pos++] = 0xf6;
    } else {
      writeValue(e);
    }
  }
  leave();
}

/**
 * `SerializeJSONObject` : clés d'`Object.keys`, chaque propriété lue UNE fois (un
 * accesseur n'est pas rappelé). L'en-tête est réservé sur le nombre de clés
 * candidates, puis posé sur le nombre réel : compter sans relire, sans allouer.
 */
function writeObject(o: object): void {
  if (!isKeyed(o)) return;
  enter(o);
  const keys = Object.keys(o);
  const candidates = keys.length;
  const reserved = headSize(candidates);
  ensure(reserved);
  // Décalage RELATIF au message : l'arène peut être remplacée (et le message rebasé) pendant la boucle.
  const startOffset = pos - base;
  pos += reserved;
  let count = 0;
  for (const k of keys) {
    const e = prepare(o[k], k);
    if (isOmitted(e)) continue;
    writeText(k);
    writeValue(e);
    count++;
  }
  const start = base + startOffset;
  const actual = headSize(count);
  if (actual !== reserved) {
    scratch.copyWithin(start + actual, start + reserved, pos);
    pos -= reserved - actual;
  }
  putHead(start, 5, count);
  leave();
}

/** Chaîne d'octets (type majeur 2) : les grandes ne sont copiées qu'une fois, vers le résultat. */
function writeBytes(b: Uint8Array): void {
  const n = b.byteLength;
  writeHead(2, n);
  if (n >= DIRECT_COPY_MIN_BYTES) {
    deferred ??= [];
    deferred.push({ at: pos - base, bytes: b });
    return;
  }
  ensure(n);
  scratch.set(b, pos);
  pos += n;
}

// ---------------------------------------------------------------------------
// Scalaires
// ---------------------------------------------------------------------------

/** Taille de l'en-tête (octet initial + argument) pour un argument `n` (§3). */
function headSize(n: number): number {
  return n < 24 ? 1 : n < 0x100 ? 2 : n < 0x10000 ? 3 : 5;
}

/** Pose un en-tête à une position déjà réservée ; rend sa taille. */
function putHead(at: number, major: number, n: number): number {
  const m = major << 5;
  if (n < 24) {
    scratch[at] = m | n;
    return 1;
  }
  if (n < 0x100) {
    scratch[at] = m | 24;
    scratch[at + 1] = n;
    return 2;
  }
  if (n < 0x10000) {
    scratch[at] = m | 25;
    view.setUint16(at + 1, n);
    return 3;
  }
  if (n < 0x100000000) {
    scratch[at] = m | 26;
    view.setUint32(at + 1, n);
    return 5;
  }
  // Jusqu'à 2^53 - 1 : deux moitiés de 32 bits, sans BigInt.
  scratch[at] = m | 27;
  const lo = n >>> 0;
  view.setUint32(at + 1, (n - lo) / 0x100000000);
  view.setUint32(at + 5, lo);
  return 9;
}

/** Écrit un en-tête (type majeur + argument) sous sa forme la plus courte (§4.1). */
function writeHead(major: number, n: number): void {
  ensure(9);
  pos += putHead(pos, major, n);
}

/**
 * Nombre : entier sûr en type 0/1, `-0` compris (→ `0`, comme JSON) ; `NaN`/`±Infinity`
 * → `null` (comme JSON) ; sinon le flottant le plus court qui conserve la valeur.
 */
function writeNumber(v: number): void {
  if (Number.isInteger(v) && v >= -MAX_SAFE_INTEGER && v <= MAX_SAFE_INTEGER) {
    if (v >= 0) writeHead(0, v);
    else writeHead(1, -1 - v);
    return;
  }
  ensure(9);
  if (!Number.isFinite(v)) {
    scratch[pos++] = 0xf6;
    return;
  }
  if (Math.fround(v) === v) {
    const half = float16Bits(v);
    if (half >= 0) {
      scratch[pos++] = 0xf9;
      view.setUint16(pos, half);
      pos += 2;
      return;
    }
    scratch[pos++] = 0xfa;
    view.setFloat32(pos, v);
    pos += 4;
    return;
  }
  scratch[pos++] = 0xfb;
  view.setFloat64(pos, v);
  pos += 8;
}

/**
 * Chaîne de caractères (type majeur 3), UTF-8. Jusqu'à 64 caractères : écrite à la
 * main (l'ASCII pur, le cas des clés, ne coûte qu'une boucle) ; au-delà, `encodeInto`.
 * Un substitut UTF-16 isolé devient U+FFFD — ce qu'en fait `TextEncoder`, et ce
 * qu'en ferait la trame texte d'une WebSocket pour le codec JSON (USVString).
 */
function writeText(s: string): void {
  const len = s.length;
  if (len > INLINE_TEXT_MAX_CHARS) {
    writeTextEncoded(s);
    return;
  }
  ensure(2 + len * 3);
  const start = pos;
  // En-tête réservé : 1 octet si < 24 caractères (le cas ASCII tient), 2 sinon (≤ 192 octets).
  const reserved = len < 24 ? 1 : 2;
  let out = start + reserved;
  for (let i = 0; i < len; i++) {
    let c = s.charCodeAt(i);
    if (c < 0x80) {
      scratch[out++] = c;
    } else if (c < 0x800) {
      scratch[out++] = 0xc0 | (c >> 6);
      scratch[out++] = 0x80 | (c & 0x3f);
    } else if (c >= 0xd800 && c <= 0xdfff) {
      if (c <= 0xdbff && i + 1 < len) {
        const d = s.charCodeAt(i + 1);
        if (d >= 0xdc00 && d <= 0xdfff) {
          c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00);
          i++;
          scratch[out++] = 0xf0 | (c >> 18);
          scratch[out++] = 0x80 | ((c >> 12) & 0x3f);
          scratch[out++] = 0x80 | ((c >> 6) & 0x3f);
          scratch[out++] = 0x80 | (c & 0x3f);
          continue;
        }
      }
      // Substitut isolé : U+FFFD (EF BF BD).
      scratch[out++] = 0xef;
      scratch[out++] = 0xbf;
      scratch[out++] = 0xbd;
    } else {
      scratch[out++] = 0xe0 | (c >> 12);
      scratch[out++] = 0x80 | ((c >> 6) & 0x3f);
      scratch[out++] = 0x80 | (c & 0x3f);
    }
  }
  const n = out - start - reserved;
  if (reserved === 1) {
    if (n < 24) {
      scratch[start] = 0x60 | n;
    } else {
      // Du non-ASCII a gonflé la chaîne au-delà de 23 octets : l'en-tête prend un octet de plus.
      scratch.copyWithin(start + 2, start + 1, out);
      out++;
      scratch[start] = 0x78;
      scratch[start + 1] = n;
    }
  } else {
    scratch[start] = 0x78;
    scratch[start + 1] = n;
  }
  pos = out;
}

/**
 * Chaîne longue : `encodeInto` directement dans la place qui RESTE à l'arène ; si elle ne
 * suffit pas, l'arène grossit du reste au pire (3 octets/caractère) et l'écriture reprend
 * où elle s'est arrêtée — `encodeInto` ne coupe jamais un code point. Ne jamais réserver
 * 3 octets/caractère d'avance : un texte de 8 Ko ferait grossir l'arène à chaque trame.
 * L'en-tête est posé après coup, à la taille réelle.
 */
function writeTextEncoded(s: string): void {
  const reserved = headSize(s.length * 3);
  ensure(reserved + 16);
  const startOffset = pos - base;
  pos += reserved;
  let read = 0;
  let written = 0;
  for (;;) {
    const r = utf8.encodeInto(
      read === 0 ? s : s.slice(read),
      scratch.subarray(pos),
    );
    read += r.read;
    written += r.written;
    pos += r.written;
    if (read >= s.length) break;
    grow((s.length - read) * 3);
  }
  const start = base + startOffset;
  const actual = headSize(written);
  if (actual !== reserved) {
    scratch.copyWithin(start + actual, start + reserved, pos);
    pos -= reserved - actual;
  }
  putHead(start, 3, written);
}
