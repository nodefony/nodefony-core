/**
 * Sonde de débit d'une socket — la charge d'octets qu'un serveur renvoie pour
 * mesurer ce qu'un codec coûte sur le fil (#618 D6).
 *
 * Isomorphe : le serveur fabrique la charge, le navigateur peut la refabriquer
 * pour vérifier qu'elle est arrivée intacte — même fichier des deux côtés.
 */

/**
 * Tailles admises, en octets : 1 Ko, 64 Ko, 1 Mo. Fermées : une taille libre
 * ferait de l'action un amplificateur que le client dimensionne. 1 Mo reste
 * sous `maxPayload` (1 MiB) une fois l'enveloppe ajoutée côté CBOR, et le
 * sens est serveur → client seulement.
 */
export const THROUGHPUT_PAYLOAD_SIZES = [1024, 65536, 1048576] as const;

/** Une des tailles de {@link THROUGHPUT_PAYLOAD_SIZES}. */
export type ThroughputPayloadSize = (typeof THROUGHPUT_PAYLOAD_SIZES)[number];

/** `true` si `value` est une taille admise par la sonde de débit. */
export function isThroughputPayloadSize(
  value: unknown,
): value is ThroughputPayloadSize {
  return (
    typeof value === "number" &&
    (THROUGHPUT_PAYLOAD_SIZES as readonly number[]).includes(value)
  );
}

/**
 * Fabrique la charge de la sonde : `size` octets pseudo-aléatoires, toujours
 * les mêmes pour une même graine.
 *
 * Pas de zéros : si la compression des trames (`perMessageDeflate`) est
 * active, une charge compressible mesurerait le compresseur, pas le codec.
 * Pas de générateur cryptographique non plus : il n'apporte rien ici et
 * coûte davantage sur la boucle. Xorshift32, quatre octets par pas.
 *
 * @param size - nombre d'octets (multiple de 4 pour les tailles admises).
 * @param seed - graine non nulle ; même graine → mêmes octets.
 * @returns un tampon neuf de `size` octets.
 */
export function createThroughputPayload(
  size: number,
  seed: number = 0x9e3779b9,
): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(size);
  const words = new Uint32Array(bytes.buffer, 0, size >>> 2);
  let x = seed >>> 0 || 1;
  for (let i = 0; i < words.length; i += 1) {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    words[i] = x;
  }
  for (let i = words.length << 2; i < size; i += 1) {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    bytes[i] = x & 0xff;
  }
  return bytes;
}
