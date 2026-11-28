/**
 * Le pair JSON-RPC du SUPERVISEUR vers UN serveur enfant — la voie en direct
 * de l'invite (ADR-0013 §6). Le serveur est relancé à chaque rechargement :
 * un pair par enfant, disposé quand son canal se ferme, pour que les requêtes
 * en vol soient rejetées dans l'instant au lieu d'attendre leur délai.
 *
 * Il ne reçoit rien que le superviseur ne lui remette : l'aiguillage des
 * messages du serveur (`DevSupervisor.ts#routeServerMessages`) lui passe les
 * trames `rpc`, à un seul endroit.
 */
import { JsonRpcPeer } from "../../realtime/JsonRpcPeer";
import {
  DEV_READY,
  LIVE_COMMAND_TIMEOUT_MS,
  sendRpcToServer,
  type CommandExecuteResult,
  type DevActions,
  type ICommandExecuteParams,
  type IServerChannel,
} from "./devChannel";

/** Ce que le pair touche du processus serveur — `ChildProcess` le satisfait. */
export interface IServerPeerChild extends IServerChannel {
  once(event: "disconnect", listener: () => void): unknown;
}

/**
 * Le pair du superviseur vers un serveur enfant : `ready` dès `dev.ready`,
 * `execute` pour une commande en direct.
 *
 * Verrouillé par `tests/devLiveChannel.test.ts`.
 */
export class ServerPeer {
  /**
   * Contrat PERMISSIF côté écoute : le nom d'une notification vient du fil,
   * il se COMPARE (`dev.ready`), il ne se présume pas. Aucune action exposée.
   */
  readonly #peer: JsonRpcPeer;
  #ready = false;
  #disposed = false;

  /**
   * @param child - le processus serveur ; son `disconnect` dispose le pair.
   * @param onError - reçoit une erreur interne du pair (journal du superviseur).
   * @param onReady - appelé une fois, quand le serveur annonce `dev.ready`.
   */
  constructor(
    child: IServerPeerChild,
    onError: (context: string, err: unknown) => void,
    onReady?: () => void,
  ) {
    this.#peer = new JsonRpcPeer({
      send: (frame) => sendRpcToServer(child, frame),
      onNotification: (method) => {
        if (method !== DEV_READY || this.#ready || this.#disposed) return;
        this.#ready = true;
        onReady?.();
      },
      onError,
    });
    // `disconnect` suit toujours la mort du serveur, même tué net : un seul
    // point de fin, et l'écouteur meurt avec le processus qui le porte.
    child.once("disconnect", () => this.dispose());
  }

  /** `true` quand le serveur a annoncé servir `command.execute`, et tant qu'il vit. */
  get ready(): boolean {
    return this.#ready;
  }

  /**
   * Remet au pair une trame reçue du serveur.
   *
   * @param frame - le `frame` d'un message `rpc` du canal.
   */
  receive(frame: object): void {
    if (!this.#disposed) this.#peer.receive(frame);
  }

  /**
   * Demande au serveur d'exécuter une commande en direct, sous
   * {@link LIVE_COMMAND_TIMEOUT_MS}. Un délai expiré ou un `signal` abandonné
   * annule la requête chez le serveur (`$/cancelRequest`).
   *
   * @param params - la commande, ses arguments, la largeur de l'onglet.
   * @param signal - l'abandon de l'invite (Ctrl+C, onglet fermé).
   * @returns le résultat ; `{ live: false }` : la commande part en sous-processus.
   * @throws Quand le serveur répond une erreur, ne répond pas à temps, ou
   *   disparaît pendant la requête — le superviseur se replie alors sur le
   *   sous-processus.
   */
  execute(
    params: ICommandExecuteParams,
    signal?: AbortSignal,
  ): Promise<CommandExecuteResult> {
    // Fermé : la requête ne part pas — elle n'attendrait que son délai, ou la
    // réponse d'un serveur qui n'est plus celui à qui on parle.
    if (this.#disposed) return Promise.reject(new Error("server exited"));
    return this.#peer.requestAs<DevActions, "command.execute">(
      "command.execute",
      params,
      signal === undefined
        ? LIVE_COMMAND_TIMEOUT_MS
        : { timeoutMs: LIVE_COMMAND_TIMEOUT_MS, signal },
    );
  }

  /** Ferme le pair : les requêtes en vol sont rejetées dans l'instant. Idempotent. */
  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#ready = false;
    this.#peer.dispose("server exited");
  }
}
