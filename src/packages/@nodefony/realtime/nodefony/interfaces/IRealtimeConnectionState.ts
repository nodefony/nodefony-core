import type { JsonRpcPeer } from "nodefony";
import type { WsConnectionTransport } from "../src/transport/WsConnectionTransport";
import type { ChannelSink } from "../src/server/RealtimeHub";
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
  /** Canal → sink de CETTE connexion auprès du hub partagé, pour s'en désabonner. */
  channels: Map<string, ChannelSink>;
  /** Canaux full-duplex qui acceptent une entrée client ; `null` s'il n'y en a aucun. */
  inbound: Record<string, RealtimeInboundHandler> | null;
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
