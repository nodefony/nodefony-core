import { STATUS_CODES, type IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import type { WebSocket, WebSocketServer } from "ws";
import { refuseUpgrade } from "../proxy/forward";
import { websocketHandshakeProblem } from "../proxy/rules";

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
 * Le verdict d'un upgrade, rendu par le noyau APRÈS sa décision — qui peut
 * attendre (session, pare-feu, garde de l'action). Un seul verdict compte : le
 * premier appel l'emporte, les suivants sont ignorés.
 */
export interface IUpgradeAdmission {
  /**
   * Termine le handshake (`101`) et rend la socket ouverte.
   *
   * @returns la socket DIRECTEMENT quand `ws` la rend tout de suite (le cas
   *   nominal : aucune promesse, aucune micro-tâche), sinon sa promesse ;
   *   `null` si le client est parti pendant la décision (ou si `ws` a rejeté
   *   le handshake) — il n'y a alors rien à servir
   */
  accept(): WebSocket | null | Promise<WebSocket | null>;
  /**
   * Refuse par un statut HTTP, AVANT le `101` (RFC 6455 §4.2.2).
   *
   * @param status - statut du refus (`401`, `403`, `429`…)
   * @param headers - en-têtes du refus (`WWW-Authenticate`, `Retry-After`)
   */
  refuse(
    status: number,
    headers?: Readonly<Record<string, string | number>> | null,
  ): void;
}

/** Ce qui décide d'un upgrade : reçoit la requête et rend son verdict, plus tard s'il le faut. */
export type UpgradeAdmit = (
  req: IncomingMessage,
  admission: IUpgradeAdmission,
) => void;

/** Défaut sans noyau : tout upgrade conforme est accepté puis émis en `connection`. */
function acceptAll(wss: WebSocketServer): UpgradeAdmit {
  return (req, admission) => {
    const accepted = admission.accept();
    if (accepted instanceof Promise) {
      void accepted.then((ws) => {
        if (ws !== null) wss.emit("connection", ws, req);
      });
    } else if (accepted !== null) {
      wss.emit("connection", accepted, req);
    }
  };
}

/**
 * Le verdict d'UN upgrade. Pendant que le noyau décide, le socket n'a plus
 * d'écouteur `error` (`node:http` retire les siens à l'émission d'`upgrade`,
 * `ws` ne pose les siens qu'à `handleUpgrade`) : une coupure du client
 * (`ECONNRESET`) y deviendrait une erreur non gérée qui abat le process. D'où
 * l'écouteur de la fenêtre d'attente, retiré quand le verdict tombe.
 *
 * Une classe, pas un objet de fermetures : une allocation par handshake (plus
 * l'écouteur), méthodes partagées par le prototype.
 */
class UpgradeAdmission implements IUpgradeAdmission {
  // `undefined` tant que `accept()` n'a pas tranché ; sinon son verdict mémorisé.
  #accepted: WebSocket | null | Promise<WebSocket | null> | undefined =
    undefined;
  #settled = false;
  readonly #onPendingError: () => void;

  constructor(
    private readonly wss: WebSocketServer,
    private readonly req: IncomingMessage,
    private readonly socket: Duplex,
    private readonly head: Buffer,
  ) {
    this.#onPendingError = () => socket.destroy();
    socket.on("error", this.#onPendingError);
  }

  #settle(): boolean {
    if (this.#settled) return false;
    this.#settled = true;
    this.socket.removeListener("error", this.#onPendingError);
    return true;
  }

  accept(): WebSocket | null | Promise<WebSocket | null> {
    if (this.#accepted !== undefined) return this.#accepted;
    if (!this.#settle()) return (this.#accepted = null);
    const { socket } = this;
    if (socket.destroyed || !socket.writable) {
      socket.destroy();
      return (this.#accepted = null);
    }
    // `ws` rappelle de façon SYNCHRONE dans le cas nominal (pas de
    // `verifyClient`, socket vivante) : la socket est rendue telle quelle,
    // sans promesse ni micro-tâche — chemin de chaque connexion. La promesse
    // n'existe que pour un rappel différé ou un abandon (socket mort, en-tête
    // rejeté), où la fermeture du socket rend `null` au lieu d'une promesse
    // pendante qui retiendrait le scope de la requête à jamais.
    let ws: WebSocket | undefined;
    let late: ((value: WebSocket | null) => void) | null = null;
    const onClose = (): void => late?.(null);
    this.wss.handleUpgrade(this.req, socket, this.head, (accepted) => {
      if (late === null) {
        ws = accepted;
        return;
      }
      socket.removeListener("close", onClose);
      late(accepted);
    });
    if (ws !== undefined) return (this.#accepted = ws);
    socket.once("close", onClose);
    return (this.#accepted = new Promise((resolve) => {
      late = resolve;
    }));
  }

  refuse(
    status: number,
    headers?: Readonly<Record<string, string | number>> | null,
  ): void {
    if (!this.#settle()) return;
    refuseUpgrade(
      this.socket,
      status,
      STATUS_CODES[status] ?? "Refused",
      headers,
    );
  }
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
 * jamais une ouverture suivie d'une fermeture. Puis la FORME du handshake est
 * contrôlée (`websocketHandshakeProblem`, la règle du proxy inverse) : un
 * handshake malformé reçoit `400` sans jamais atteindre le noyau. Enfin
 * `admit` décide — pare-feu, garde de l'action — et seul son verdict ouvre.
 *
 * Sans montage, le coût par connexion est une lecture de champ.
 *
 * @param server - serveur HTTP(S) qui reçoit les upgrades
 * @param wss - serveur WebSocket de Nodefony (`noServer: true`)
 * @param relay - proxy inverse, lu à chaque upgrade (il peut naître après)
 * @param refusal - statut HTTP qui refuse l'upgrade, `null` pour l'admettre
 *   (cf `HttpKernel.websocketUpgradeRefusal`)
 * @param admit - décide d'un upgrade admis (cf `HttpKernel.onWebsocketUpgrade`) ;
 *   par défaut, tout upgrade conforme est accepté et émis en `connection`
 * @returns la fonction qui retire l'écouteur — à appeler à l'arrêt
 */
export function attachUpgradeDispatch(
  server: IUpgradeEmitter,
  wss: WebSocketServer,
  relay: () => IUpgradeRelay | null,
  refusal: (req: IncomingMessage) => number | null,
  admit: UpgradeAdmit = acceptAll(wss),
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
    if (websocketHandshakeProblem(req.method, req.headers) !== null) {
      refuseUpgrade(socket, 400, STATUS_CODES[400] ?? "Bad Request");
      return;
    }
    admit(req, new UpgradeAdmission(wss, req, socket, head));
  };
  server.on("upgrade", onUpgrade);
  return () => {
    server.removeListener("upgrade", onUpgrade);
  };
}
