/**
 * Conteneurs d'octets que les codecs du temps réel ne portent PAS (#777) : seul un
 * `Uint8Array` (et ses sous-classes, `Buffer` compris) voyage en octets. Avant le
 * correctif, les tableaux typés partaient en `{"0":…}` et `ArrayBuffer`/`DataView`
 * en `{}` — contenu perdu, sans un mot.
 *
 * Chaque entrée : le nom que le message d'erreur doit citer, puis une fabrique (une
 * valeur neuve par appel : un test ne doit pas hériter de l'état d'un autre).
 */
export const UNSUPPORTED_BINARY: readonly (readonly [string, () => object])[] =
  [
    ["Int8Array", () => new Int8Array([1, -2])],
    ["Int16Array", () => new Int16Array([1, -2])],
    ["Uint16Array", () => new Uint16Array(0)],
    ["Float32Array", () => new Float32Array([1.5])],
    ["Float64Array", () => new Float64Array([0.5, 1e300])],
    ["Uint8ClampedArray", () => new Uint8ClampedArray([3])],
    ["BigInt64Array", () => new BigInt64Array([1n])],
    ["DataView", () => new DataView(new ArrayBuffer(2))],
    ["ArrayBuffer", () => new ArrayBuffer(2)],
  ];
