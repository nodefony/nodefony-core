import type { IFrameCodec, JsonRpcPeer } from "nodefony";
import type { WsConnectionTransport } from "../src/transport/WsConnectionTransport";
import type { ChannelSink } from "../src/server/RealtimeHub";
import type { ConnectionAdmission } from "../src/server/connectionAdmission";
import type { RealtimeInboundHandler } from "./IRealtimeController";

/**
 * État du protocole temps réel d'UNE connexion WebSocket — posé au welcome, et
 * relu à chaque frame jusqu'à la fermeture.
 *
 * Il vit sur la CONNEXION (`WebsocketContext`), pas sur le contrôleur : un
 * `forward` fait construire une instance neuve qui sert la même socket, et
 * l'état doit lui survivre.
 *
 * Le pair y est rangé sous son contrat EFFACÉ, ce qu'il est d'ailleurs à sa
 * construction. Plusieurs contrôleurs peuvent servir la même connexion, et aucun
 * type ne relie cet état à l'un d'eux : chacun le relit sous son propre contrat
 * (`RealtimeController.requestClient` → `JsonRpcPeer.requestAs`).
 */
export interface IRealtimeConnectionState {
  /** `realtime:welcome` émis : la poignée de main ne se rejoue pas. */
  welcomed: boolean;
  /** Le pair JSON-RPC de la connexion, sous son contrat effacé. */
  peer: JsonRpcPeer;
  /** Le transport qui relie le pair à la socket (contre-pression, sonde). */
  transport: WsConnectionTransport;
  /**
   * Le codec BINAIRE accordé à cette connexion au handshake (ADR-0022 §2), `null`
   * pour une connexion restée en texte. Non nul, toute trame binaire reçue est une
   * frame du codec, et le flux brut (`onRealtimeBinary`, `sendBinaryToClient`) est
   * refusé : les octets passent par les canaux, et leurs portes.
   */
  binaryCodec: IFrameCodec | null;
  /** Canal → sink de CETTE connexion auprès du hub partagé, pour s'en désabonner. */
  channels: Map<string, ChannelSink>;
  /**
   * Canaux full-duplex qui acceptent une entrée client ; `null` s'il n'y en a aucun.
   * Objet ordinaire, de même forme pour toutes les connexions d'un contrôleur :
   * un nom hérité de son prototype (`__proto__`, `toString`) est refusé par le
   * verrou des trames avant d'atteindre la distribution.
   */
  inbound: Record<string, RealtimeInboundHandler> | null;
  /**
   * File d'admission aux canaux à `allow` — `null` tant que la connexion n'a
   * demandé aucun de ces canaux (la plupart ne le font jamais).
   */
  admission: ConnectionAdmission | null;
  /**
   * Canaux entrants dont les trames passent sans le verrou : ouverts par `allow`,
   * ou dont le verrou a déjà dit oui (ADR-0022 §6, décision 1 ter). Le coût d'une
   * trame chaude tient dans cette lecture (`admitted[method] === true`). Mêmes
   * clés que {@link inbound}, à `false` tant que non admises : une seule forme
   * d'objet pour toutes les connexions d'un contrôleur. `null` jusqu'à la
   * première admission.
   */
  admitted: Record<string, boolean> | null;
  /**
   * Ceux de {@link admitted} que le VERROU a admis — au plus 64, vidés quand une
   * politique arrive après coup. `null` s'il n'y en a aucun.
   */
  retained: string[] | null;
}

declare module "@nodefony/http" {
  interface IWebsocketConnectionState {
    /**
     * État du protocole temps réel de la connexion, posé par
     * `@nodefony/realtime` au welcome ; `undefined` avant, et sur toute socket
     * qu'aucun `RealtimeController` ne sert. Réservé au module : le lire,
     * jamais l'écrire.
     */
    __nfRealtime?: IRealtimeConnectionState;
  }
}
