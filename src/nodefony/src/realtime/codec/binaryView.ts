/**
 * La règle des conteneurs d'octets que les codecs du temps réel ne portent PAS (#777).
 *
 * Seul un `Uint8Array` (et ses sous-classes, `Buffer` de Node compris) voyage en
 * octets — chaîne d'octets CBOR, marqueur `$bytes` du codec JSON (ADR-0022 §2). Tout
 * autre tableau typé partirait en `{"0":…}`, un `ArrayBuffer` ou une `DataView` en
 * `{}` : contenu déformé ou perdu, sans un mot. Les deux codecs refusent donc ces
 * valeurs à l'émission, avec le même message — une seule implémentation, ici.
 *
 * Code isomorphe (navigateur + Node), sans dépendance : importé par le codec CBOR
 * comme par le codec JSON, il ne charge ni l'un ni l'autre.
 */

/**
 * Dit si une valeur est un conteneur d'octets que les codecs refusent : un tableau
 * typé autre que `Uint8Array`, une `DataView`, un `ArrayBuffer` ou un `SharedArrayBuffer`.
 *
 * @param value - un objet NON ordinaire (l'appelant a déjà écarté objets et tableaux simples).
 * @returns `true` si la valeur doit être refusée par {@link unsupportedBinaryMessage}.
 */
export function isUnsupportedBinary(value: object): boolean {
  if (ArrayBuffer.isView(value)) return !(value instanceof Uint8Array);
  return (
    value instanceof ArrayBuffer ||
    (typeof SharedArrayBuffer === "function" &&
      value instanceof SharedArrayBuffer)
  );
}

/**
 * Message du refus : il nomme le type reçu et le geste qui fait voyager les mêmes
 * octets, puis reconstruit le type à l'arrivée.
 *
 * Le nom vient de l'étiquette interne (`Object.prototype.toString`), jamais d'un
 * `constructor.name` que l'objet pourrait redéfinir.
 *
 * @param value - la valeur refusée par {@link isUnsupportedBinary}.
 * @returns le message de l'erreur à lever.
 */
export function unsupportedBinaryMessage(value: object): string {
  const kind = Object.prototype.toString.call(value).slice(8, -1);
  return (
    `Impossible d'encoder un ${kind} : seul un Uint8Array voyage en octets — ` +
    gestureFor(kind)
  );
}

/**
 * Le geste qui fait voyager les octets d'un `kind`, puis le reconstruit. Les séries
 * de 16 à 64 bits passent par les aides du framework, qui ÉCRIVENT le boutisme et
 * réalignent la vue reçue (`typedArrayBytes.ts`) ; le reste n'a ni boutisme ni
 * alignement à tenir (8 bits, `DataView`, tampon), ou n'a pas d'aide (`BigInt64Array`).
 */
function gestureFor(kind: string): string {
  switch (kind) {
    case "Float64Array":
    case "Float32Array":
    case "Uint32Array":
    case "Int32Array":
    case "Uint16Array":
    case "Int16Array":
      return (
        "publier toLittleEndianBytes(x), relire fromLittleEndianBytes(reçu, " +
        `${kind}) — exportées par « nodefony » et « nodefony/client »`
      );
    case "ArrayBuffer":
    case "SharedArrayBuffer":
      return "publier new Uint8Array(x), relire reçu.slice().buffer";
    case "DataView":
    case "Int8Array":
    case "Uint8ClampedArray":
      return (
        "publier new Uint8Array(x.buffer, x.byteOffset, x.byteLength), relire " +
        `new ${kind}(reçu.buffer, reçu.byteOffset, reçu.byteLength)`
      );
    default:
      // 64 bits entiers : pas d'aide — `slice()` recopie la vue reçue dans un
      // tampon neuf et ALIGNÉ, que le constructeur exige.
      return (
        "publier new Uint8Array(x.buffer, x.byteOffset, x.byteLength), relire " +
        `new ${kind}(reçu.slice().buffer)`
      );
  }
}
