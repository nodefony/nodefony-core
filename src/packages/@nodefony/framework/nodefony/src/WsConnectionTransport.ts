import { TransportState, type IRealtimeTransport } from "nodefony";

/**
 * Connexion ws brute, typée structurellement (évite d'importer le package `ws`).
 * `ctx.connection` (WebsocketContext) la fournit.
 */
export interface RawWsConnection {
  send(data: string, cb?: (err?: Error) => void): void;
  close(code?: number, reason?: string): void;
  readonly readyState: number;
}

/**
 * WsConnectionTransport — transport {@link IRealtimeTransport} CÔTÉ SERVEUR :
 * wrap d'une connexion `ws` (1 par client connecté). Pendant serveur du
 * `BrowserWsTransport` → la connexion serveur compose le MÊME `JsonRpcPeer` que
 * le client (symétrie isomorphe).
 *
 * Particularité serveur : l'inbound n'est PAS piloté par un event socket mais par
 * le **pipeline framework** (la route WS appelle `feed(raw)` à chaque message) ;
 * la fermeture est signalée par `fireClose()` (hook `onFinish` du Context). Le
 * `connect`/`onOpen` sont des no-op (la connexion est déjà ouverte au handshake).
 */
export class WsConnectionTransport implements IRealtimeTransport {
  private _onMessage: ((raw: string) => void) | null = null;
  private _onClose: ((code: number, reason: string) => void) | null = null;

  constructor(private readonly conn: RawWsConnection) {}

  connect(): void {
    /* déjà ouverte par le serveur — no-op */
  }

  send(raw: string): void {
    if (this.conn.readyState === TransportState.OPEN) {
      this.conn.send(raw, () => {
        /* socket fermée pendant l'envoi — ignoré */
      });
    }
  }

  close(code?: number, reason?: string): void {
    this.conn.close(code, reason);
  }

  get readyState(): number {
    return this.conn.readyState;
  }

  onOpen(): void {
    /* déjà ouverte — no-op */
  }
  onMessage(cb: (raw: string) => void): void {
    this._onMessage = cb;
  }
  onClose(cb: (code: number, reason: string) => void): void {
    this._onClose = cb;
  }
  onError(): void {
    /* erreurs gérées par le pipeline framework */
  }

  /** Pump entrant : le pipeline framework pousse ici chaque message reçu. */
  feed(raw: string): void {
    this._onMessage?.(raw);
  }

  /** Fermeture : appelée par le owner sur `onFinish` (close WS). */
  fireClose(code = 1000, reason = ""): void {
    this._onClose?.(code, reason);
  }
}

export default WsConnectionTransport;
