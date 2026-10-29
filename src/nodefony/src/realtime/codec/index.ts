/**
 * Codec CBOR de Nodefony (RFC 8949), aligné sur JSON — ADR-0022 §2.
 *
 * Barrel local au dossier : l'exposition dans la surface publique du paquet est une
 * décision séparée (`src/index.ts`, `src/client/index.ts`).
 */
export { encodeCbor } from "./encode";
export { decodeCbor, type ICborDecodeOptions } from "./decode";
export { CborError } from "./errors";

/**
 * Nom du sous-protocole WebSocket (RFC 6455 §1.9) sous lequel ce codec est offert par
 * le client et annoncé par le serveur dans l'accueil — ADR-0022 §2, « trois noms versionnés ».
 */
export const CBOR_PROTOCOL = "nodefony.jsonrpc.cbor.v1";
