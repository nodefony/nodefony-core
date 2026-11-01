/**
 * IFrameCodec — sérialisation des frames de la socket temps réel, choisie une fois par
 * connexion (ADR-0022 §2). L'enveloppe reste JSON-RPC 2.0 quel que soit le codec : il
 * n'en est que la forme sur le fil.
 *
 * Code partagé : compile sous `tsconfig.shared.json` (ni `Buffer`, ni DOM).
 */

/**
 * Sous-protocole WebSocket (RFC 6455 §1.9) du codec texte — le format d'une connexion
 * qui n'en a négocié aucun (décision 1 de #630). Nom versionné : une enveloppe qui
 * change ajoute `v2`, jamais ne renomme `v1`.
 */
export const JSON_PROTOCOL = "nodefony.jsonrpc.v1";

/**
 * Codec de frame de la socket temps réel : remplace, par frame, le `JSON.stringify` à
 * l'envoi et le `JSON.parse` à la réception — aucun appel de plus.
 *
 * Tout codec rend ce que `JSON.stringify` puis `JSON.parse` rendraient (une `Date`
 * devient sa chaîne ISO, `NaN` devient `null`), à une exception près : un `Uint8Array`
 * revient en `Uint8Array` (ADR-0022 §2, ADR-0021 S8). Un client CBOR et un client JSON
 * abonnés au même canal reçoivent donc la même chose.
 */
export interface IFrameCodec {
  /** Nom du sous-protocole offert par le client et annoncé dans `realtime:welcome`. */
  readonly protocol: string;
  /**
   * Sérialise une frame JSON-RPC pour le fil.
   *
   * @param frame - la frame (requête, notification ou réponse).
   * @returns une chaîne (trame texte) ou des octets (trame binaire).
   * @throws Quand la frame n'est pas sérialisable (structure circulaire, `bigint`) —
   *   comme `JSON.stringify`.
   */
  encode(frame: unknown): string | Uint8Array<ArrayBuffer>;
  /**
   * Relit une trame reçue. Une trame TEXTE se lit toujours en JSON, quel que soit le
   * codec : l'accueil est une trame texte `v1` (ADR-0022 §2).
   *
   * @param data - la trame reçue, texte ou octets.
   * @returns la frame décodée, à confier au pair JSON-RPC.
   * @throws Quand la trame est illisible pour ce codec — l'appelant la compte comme
   *   malformée.
   */
  decode(data: string | Uint8Array): unknown;
  /**
   * Pour un codec BINAIRE : le codec texte qui l'accompagne quand une connexion
   * reste en `nodefony.jsonrpc.v1` — le JSON à convention d'octets (ADR-0022 §2).
   * Porté par le codec binaire, il ne pèse que sur la page qui active ce codec ;
   * absent, le texte reste le JSON natif.
   */
  readonly textCodec?: IFrameCodec;
}
