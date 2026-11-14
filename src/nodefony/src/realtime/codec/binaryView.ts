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
  const buffer = kind.endsWith("Buffer");
  const send = buffer
    ? "new Uint8Array(x)"
    : "new Uint8Array(x.buffer, x.byteOffset, x.byteLength)";
  // `slice()` recopie la vue reçue dans un tampon neuf et aligné : elle peut
  // commencer à un décalage que le constructeur d'un tableau typé refuserait.
  const rebuild = buffer
    ? "reçu.slice().buffer"
    : `new ${kind}(reçu.slice().buffer)`;
  return (
    `Impossible d'encoder un ${kind} : seul un Uint8Array voyage en octets — ` +
    `publier ${send}, puis reconstruire à l'arrivée : ${rebuild}`
  );
}
