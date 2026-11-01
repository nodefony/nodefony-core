/**
 * Négociation du codec de frame — la règle UNIQUE des deux bouts de la socket temps
 * réel (ADR-0022 §2) : le client OFFRE des sous-protocoles au handshake, le serveur
 * CHOISIT et l'annonce dans `realtime:welcome`, le client ADOPTE l'annonce — jamais
 * l'écho du handshake.
 *
 * Code partagé (`tsconfig.shared.json`) : le client du navigateur et le contrôleur du
 * serveur appellent les mêmes fonctions, si bien que l'offre de l'un et le choix de
 * l'autre ne peuvent pas diverger. Tout s'y calcule une fois par pair ou par
 * connexion, jamais par trame.
 */
import { JSON_PROTOCOL, type IFrameCodec } from "./IFrameCodec";
import { JSON_FRAME_CODEC } from "./jsonFrameCodec";

/**
 * Les codecs d'un pair, fixés une fois pour sa durée de vie.
 *
 * La règle des octets en texte tient ici, des deux côtés : la convention `$bytes`
 * n'est armée que si un codec binaire est activé — sinon le texte reste les deux
 * appels natifs, sans parcours de la charge (ADR-0022 §2, mesure du §9). Le codec
 * à convention est apporté par le codec binaire lui-même (`IFrameCodec.textCodec`) :
 * une page qui n'active rien ne télécharge ni lui ni le base64url.
 */
export interface IFrameCodecSet {
  /** Le codec des connexions texte (`nodefony.jsonrpc.v1`) et de l'accueil. */
  readonly text: IFrameCodec;
  /** Le codec binaire activé, `null` sans activation. */
  readonly binary: IFrameCodec | null;
  /**
   * L'offre du client (RFC 6455 §1.9), par préférence : le codec binaire, puis
   * `nodefony.jsonrpc.v1`. `undefined` sans codec binaire — aucun en-tête
   * `Sec-WebSocket-Protocol`, le handshake d'avant les codecs.
   */
  readonly offer: readonly string[] | undefined;
}

/** Le jeu sans codec binaire : partagé, jamais réalloué. */
const TEXT_ONLY: IFrameCodecSet = {
  text: JSON_FRAME_CODEC,
  binary: null,
  offer: undefined,
};

/**
 * Fixe les codecs d'un pair à partir du codec que l'application active.
 *
 * - aucun : JSON natif seul ;
 * - un codec dont le sous-protocole est `nodefony.jsonrpc.v1` : il REMPLACE le
 *   codec texte (un JSON à convention, par exemple), rien n'est offert ;
 * - un codec binaire : il est offert, et le texte devient son compagnon
 *   (`textCodec`, le JSON à convention d'octets pour `CBOR_FRAME_CODEC`).
 *
 * @param codec - le codec activé par l'application (`CBOR_FRAME_CODEC` de `nodefony/cbor`).
 * @returns le jeu de codecs du pair.
 */
export function frameCodecSet(codec?: IFrameCodec): IFrameCodecSet {
  if (codec === undefined) return TEXT_ONLY;
  if (codec.protocol === JSON_PROTOCOL)
    return { text: codec, binary: null, offer: undefined };
  return {
    text: codec.textCodec ?? JSON_FRAME_CODEC,
    binary: codec,
    offer: [codec.protocol, JSON_PROTOCOL],
  };
}

/**
 * Côté SERVEUR : le codec d'une connexion, d'après l'offre lue au handshake.
 *
 * Le codec binaire activé s'il figure dans l'offre, sinon le texte : un client qui
 * n'offre rien — ou un autre codec — reste en JSON-RPC texte, rien ne casse.
 *
 * @param set - les codecs du serveur ({@link frameCodecSet}).
 * @param offered - les sous-protocoles offerts (`Sec-WebSocket-Protocol`, déjà découpés).
 * @returns le codec à annoncer dans l'accueil et à employer ensuite.
 */
export function negotiateFrameCodec(
  set: IFrameCodecSet,
  offered: readonly string[],
): IFrameCodec {
  const binary = set.binary;
  return binary !== null && offered.includes(binary.protocol)
    ? binary
    : set.text;
}

/**
 * Côté CLIENT : le codec que l'accueil annonce (champ `codec` de `realtime:welcome`).
 *
 * Absent ou `nodefony.jsonrpc.v1` : le texte — un serveur sans codec ne pose pas le
 * champ. Le codec binaire offert : lui. Tout autre valeur est une faute du serveur,
 * qui n'a le droit de choisir que dans l'offre : `null`, à signaler.
 *
 * @param set - les codecs du client ({@link frameCodecSet}).
 * @param announced - la valeur du champ `codec` de l'accueil, telle que reçue.
 * @returns le codec à employer, ou `null` si l'annonce sort de l'offre.
 */
export function adoptFrameCodec(
  set: IFrameCodecSet,
  announced: unknown,
): IFrameCodec | null {
  if (announced === undefined || announced === JSON_PROTOCOL) return set.text;
  // `announced` n'est plus `undefined` : sans codec binaire, la comparaison échoue.
  return announced === set.binary?.protocol ? set.binary : null;
}
