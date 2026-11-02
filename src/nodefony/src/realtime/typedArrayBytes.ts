/**
 * Tableaux typés ↔ octets petit-boutistes — la forme sous laquelle une série
 * numérique voyage dans une trame.
 *
 * Les codecs du temps réel ne portent qu'UN type d'octets : le `Uint8Array`
 * (ADR-0021 S8, ADR-0022 §2). Un `Float64Array` passé tel quel serait lu comme
 * un objet — `{"0":…,"1":…}` en JSON, une table en CBOR —, énorme et faux. Une
 * série se transmet donc par ses octets, et l'ordre des octets doit être
 * ÉCRIT, pas supposé : la mémoire d'un tableau typé suit celle de la machine.
 * Le contrat retenu est le petit-boutisme (celui de toutes les plateformes
 * courantes, et celui de RFC 8746 pour ses étiquettes `…le`).
 *
 * Isomorphe : le serveur emballe, le navigateur déballe, avec le même fichier.
 */

/** Tableaux typés numériques transportables (un élément = taille fixe). */
export type NumericArray =
  | Float64Array<ArrayBuffer>
  | Float32Array<ArrayBuffer>
  | Uint32Array<ArrayBuffer>
  | Int32Array<ArrayBuffer>
  | Uint16Array<ArrayBuffer>
  | Int16Array<ArrayBuffer>;

/** Constructeur d'un {@link NumericArray} — `Float64Array`, `Uint32Array`… */
export interface INumericArrayConstructor<T extends NumericArray> {
  /** Taille d'un élément, en octets. */
  readonly BYTES_PER_ELEMENT: number;
  new (buffer: ArrayBuffer, byteOffset?: number, length?: number): T;
}

/** `true` si la machine range ses nombres en petit-boutiste (constaté, pas déduit). */
export const PLATFORM_LITTLE_ENDIAN: boolean =
  new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

/** Inverse, en place, l'ordre des octets de chaque élément de `width` octets. */
function swapBytes(bytes: Uint8Array, width: number): void {
  if (width === 1) return;
  for (let i = 0; i < bytes.length; i += width) {
    for (let a = i, b = i + width - 1; a < b; a += 1, b -= 1) {
      const t = bytes[a] ?? 0;
      bytes[a] = bytes[b] ?? 0;
      bytes[b] = t;
    }
  }
}

/**
 * Rend les octets petit-boutistes d'un tableau typé, prêts à voyager.
 *
 * Sur une machine petit-boutiste (le cas courant), le résultat est une VUE
 * sur la mémoire du tableau : aucune copie — modifier l'un modifie l'autre.
 * Sur une machine gros-boutiste, c'est une copie retournée.
 *
 * @param view - la série à transmettre.
 * @param littleEndian - ordre de la machine ; injectable pour éprouver l'autre.
 * @returns les octets, ordre petit-boutiste.
 */
export function toLittleEndianBytes(
  view: NumericArray,
  littleEndian: boolean = PLATFORM_LITTLE_ENDIAN,
): Uint8Array<ArrayBuffer> {
  const raw = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  if (littleEndian) return raw;
  const copy = new Uint8Array(raw);
  swapBytes(copy, view.BYTES_PER_ELEMENT);
  return copy;
}

/**
 * Relit une série émise par {@link toLittleEndianBytes}.
 *
 * Les octets reçus d'un décodeur peuvent commencer à une adresse quelconque
 * du tampon de la trame ; un `Float64Array` exige, lui, un décalage multiple
 * de 8. Aligné et petit-boutiste : vue sans copie. Sinon : copie (retournée
 * sur une machine gros-boutiste).
 *
 * @param bytes - les octets reçus.
 * @param ctor - le type d'élément attendu (`Float64Array`, `Uint32Array`…).
 * @param littleEndian - ordre de la machine ; injectable pour éprouver l'autre.
 * @returns la série, dans le type demandé.
 * @throws RangeError si la longueur n'est pas un multiple de la taille d'un élément.
 */
export function fromLittleEndianBytes<T extends NumericArray>(
  bytes: Uint8Array<ArrayBuffer>,
  ctor: INumericArrayConstructor<T>,
  littleEndian: boolean = PLATFORM_LITTLE_ENDIAN,
): T {
  const width = ctor.BYTES_PER_ELEMENT;
  if (bytes.byteLength % width !== 0) {
    throw new RangeError(
      `${bytes.byteLength} octets ne forment pas une série d'éléments de ${width} octets`,
    );
  }
  const count = bytes.byteLength / width;
  if (littleEndian && bytes.byteOffset % width === 0) {
    return new ctor(bytes.buffer, bytes.byteOffset, count);
  }
  const copy = new Uint8Array(bytes);
  if (!littleEndian) swapBytes(copy, width);
  return new ctor(copy.buffer, 0, count);
}
