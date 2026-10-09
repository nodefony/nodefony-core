import { STATUS_CODES, type IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import type { WebSocketServer } from "ws";
import { refuseUpgrade } from "../proxy/forward";

/** Serveur qui émet `upgrade` : HTTP/1.1, HTTPS ou HTTP/2 sécurisé (`allowHTTP1`). */
interface IUpgradeEmitter {
  on(
    event: "upgrade",
    listener: (req: IncomingMessage, socket: Duplex, head: Buffer) => void,
  ): unknown;
  removeListener(
    event: "upgrade",
    listener: (req: IncomingMessage, socket: Duplex, head: Buffer) => void,
  ): unknown;
}

/** Ce que le répartiteur lit du proxy inverse (cf `ReverseProxy`). */
interface IUpgradeRelay {
  readonly mounts: readonly unknown[] | null;
  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): boolean;
}

/**
 * Pose l'UNIQUE écouteur `upgrade` d'un serveur : le proxy inverse d'abord,
 * puis le serveur WebSocket de Nodefony.
 *
 * Pourquoi un seul écouteur : `ws` attaché par son option `server` prend TOUS
 * les upgrades et répond `400` à ceux qu'il ne reconnaît pas. Un second
 * écouteur, même posé avant, ne l'empêcherait pas de répondre sur un socket
 * déjà relayé. Le serveur `ws` est donc créé en `noServer`, et c'est ici que
 * l'upgrade lui est confié — avec ses propres contrôles intacts (`path`,
 * `verifyClient`, `maxPayload`…), que `handleUpgrade` applique.
 *
 * Entre les deux, `refusal` tranche ce qui doit être refusé AVANT le `101`
 * (RFC 6455 §4.2.2) : un chemin sans route WebSocket reçoit un statut HTTP,
 * jamais une ouverture suivie d'une fermeture.
 *
 * Sans montage, le coût par connexion est une lecture de champ.
 *
 * @param server - serveur HTTP(S) qui reçoit les upgrades
 * @param wss - serveur WebSocket de Nodefony (`noServer: true`)
 * @param relay - proxy inverse, lu à chaque upgrade (il peut naître après)
 * @param refusal - statut HTTP qui refuse l'upgrade, `null` pour l'admettre
 *   (cf `HttpKernel.websocketUpgradeRefusal`)
 * @returns la fonction qui retire l'écouteur — à appeler à l'arrêt
 */
export function attachUpgradeDispatch(
  server: IUpgradeEmitter,
  wss: WebSocketServer,
  relay: () => IUpgradeRelay | null,
  refusal: (req: IncomingMessage) => number | null,
): () => void {
  const onUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const proxy = relay();
    if (proxy !== null && proxy.mounts !== null) {
      if (proxy.handleUpgrade(req, socket, head)) return;
    }
    const status = refusal(req);
    if (status !== null) {
      refuseUpgrade(socket, status, STATUS_CODES[status] ?? "Refused");
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  };
  server.on("upgrade", onUpgrade);
  return () => {
    server.removeListener("upgrade", onUpgrade);
  };
}
