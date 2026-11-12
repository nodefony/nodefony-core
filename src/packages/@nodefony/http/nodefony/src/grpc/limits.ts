/**
 * Borne par défaut d'un message gRPC, reçu ou émis : 4 Mio (ADR-0026 D4,
 * points 1 et 2). C'est la borne de réception des implémentations de
 * référence (`grpc-js`, `grpc-go`) ; l'adaptateur Connect, lui, n'en pose
 * aucune (`limit-io.js` : `0xffffffff`). Seule source de cette valeur : le
 * schéma de la section `grpc` et le point d'entrée gRPC la lisent ici.
 */
export const GRPC_DEFAULT_MAX_MESSAGE_BYTES = 4 * 1024 * 1024;

/**
 * Plus grande borne qu'accepte l'adaptateur Connect pour `readMaxBytes` et
 * `writeMaxBytes` (`limit-io.js#validateReadWriteMaxBytes`) : la longueur
 * d'une enveloppe tient sur 32 bits.
 */
export const GRPC_MAX_MESSAGE_BYTES = 0xffffffff;
