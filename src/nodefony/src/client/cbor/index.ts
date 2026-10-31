/**
 * `nodefony/cbor` — le codec CBOR (RFC 8949) du framework, **isomorphe** (navigateur et
 * serveur), sans dépendance, sans `eval`, sans `Buffer`.
 *
 * - {@link encodeCbor} rend exactement ce que `JSON.stringify` puis `JSON.parse` rendraient
 *   (une `Date` devient sa chaîne ISO, `NaN` devient `null`…) ; seule exception, un
 *   `Uint8Array` voyage en octets et revient en `Uint8Array`.
 * - {@link decodeCbor} n'accepte que ce modèle (JSON + octets) : étiquettes refusées, bornes
 *   contre un message hostile, octets rendus en vue sans copie.
 * - {@link CBOR_PROTOCOL} est le sous-protocole WebSocket de la socket temps réel en CBOR.
 * - {@link CBOR_FRAME_CODEC} est le codec de frame CBOR de la socket temps réel
 *   (`IFrameCodec`) : chaque frame en trame binaire, octets natifs.
 *
 * Sous-chemin à part pour ne rien ajouter au poids de `nodefony/client` : seule
 * l'application qui l'importe le télécharge.
 */
export {
  encodeCbor,
  decodeCbor,
  CborError,
  CBOR_PROTOCOL,
} from "../../realtime/codec/index";
export { CBOR_FRAME_CODEC } from "../../realtime/codec/frameCodec";
export type { ICborDecodeOptions } from "../../realtime/codec/index";
