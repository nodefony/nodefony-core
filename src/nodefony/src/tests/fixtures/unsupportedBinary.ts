/**
 * Conteneurs d'octets que les codecs du temps réel ne portent PAS (#777) : seul un
 * `Uint8Array` (et ses sous-classes, `Buffer` compris) voyage en octets. Avant le
 * correctif, les tableaux typés partaient en `{"0":…}` et `ArrayBuffer`/`DataView`
 * en `{}` — contenu perdu, sans un mot.
 *
 * Chaque entrée : le nom que le message d'erreur doit citer, une fabrique (une
 * valeur neuve par appel : un test ne doit pas hériter de l'état d'un autre), puis
 * le geste que le message doit nommer — l'aide du framework quand elle existe.
 */
const HELPER = "toLittleEndianBytes(x)";
const VIEW = "new Uint8Array(x.buffer, x.byteOffset, x.byteLength)";

export const UNSUPPORTED_BINARY: readonly (readonly [
  string,
  () => object,
  string,
])[] = [
  ["Int8Array", () => new Int8Array([1, -2]), VIEW],
  ["Int16Array", () => new Int16Array([1, -2]), HELPER],
  ["Uint16Array", () => new Uint16Array(0), HELPER],
  ["Float32Array", () => new Float32Array([1.5]), HELPER],
  ["Float64Array", () => new Float64Array([0.5, 1e300]), HELPER],
  ["Uint8ClampedArray", () => new Uint8ClampedArray([3]), VIEW],
  ["BigInt64Array", () => new BigInt64Array([1n]), VIEW],
  ["DataView", () => new DataView(new ArrayBuffer(2)), VIEW],
  ["ArrayBuffer", () => new ArrayBuffer(2), "new Uint8Array(x)"],
];
