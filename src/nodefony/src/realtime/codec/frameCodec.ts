/**
 * Codec de frame CBOR de la socket temps réel (`nodefony.jsonrpc.cbor.v1`) — ADR-0022 §2.
 *
 * Exposé par le seul sous-chemin `nodefony/cbor` : une page qui ne l'importe pas ne le
 * télécharge pas.
 */
import type { IFrameCodec } from "../IFrameCodec";
import { JSON_BYTES_FRAME_CODEC } from "../jsonFrameCodec";
import { decodeCbor } from "./decode";
import { encodeCbor } from "./encode";
import { CBOR_PROTOCOL } from "./index";

/**
 * Le codec CBOR de la socket : chaque frame part en trame binaire, les octets en chaîne
 * d'octets native (type majeur 2), sans base64 ni parcours préalable.
 *
 * Une trame TEXTE reçue se lit en JSON, convention des octets comprise : l'accueil
 * `realtime:welcome` est toujours une trame texte `v1`, même sur une connexion CBOR.
 */
export const CBOR_FRAME_CODEC = {
  protocol: CBOR_PROTOCOL,
  // Une connexion restée en texte porte les octets sous la convention `$bytes`.
  textCodec: JSON_BYTES_FRAME_CODEC,
  encode(frame: unknown): Uint8Array<ArrayBuffer> {
    return encodeCbor(frame);
  },
  decode(data: string | Uint8Array): unknown {
    return typeof data === "string"
      ? JSON_BYTES_FRAME_CODEC.decode(data)
      : decodeCbor(data);
  },
} satisfies IFrameCodec;
