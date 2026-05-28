import { TransportState, type IRealtimeTransport } from "nodefony";
import type { IRealtimeConnProbe } from "../../interfaces/IRealtimeProbe";

/**
 * Connexion ws brute, typée structurellement (évite d'importer le package `ws`).
 * `ctx.connection` (WebsocketContext) la fournit.
 */
export interface RawWsConnection {
  send(data: string, cb?: (err?: Error) => void): void;
  close(code?: number, reason?: string): void;
  readonly readyState: number;
  /**
   * Octets en file d'envoi non drainés (`ws.bufferedAmount`). Optionnel : absent
   * des connexions mockées en test → la sonde lit `0`. Sur une vraie socket `ws`,
   * c'est le signal du blocker mémoire #1 (slow-consumer).
   */
  readonly bufferedAmount?: number;
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
export class WsConnectionTransport
  implements IRealtimeTransport, IRealtimeConnProbe
{
  private _onMessage: ((raw: string) => void) | null = null;
  private _onClose: ((code: number, reason: string) => void) | null = null;
  // Compteurs d'auto-observabilité (sonde socket). Primitives → 0 alloc ; incrément
  // O(1) par `send` (pas de syscall, pas de stringify supplémentaire). Toujours-ON :
  // la backpressure est le blocker #1, elle doit être visible sans flag (≠ flux ORM
  // qui chronométrait CHAQUE requête → gaté). Lus par {@link RealtimeHub.probe}.
  private _bytesSent = 0;
  private _messagesSent = 0;

  constructor(private readonly conn: RawWsConnection) {}

  connect(): void {
    /* déjà ouverte par le serveur — no-op */
  }

  send(raw: string): void {
    if (this.conn.readyState === TransportState.OPEN) {
      // `raw.length` (≈ octets pour l'ASCII/JSON ; O(1) en V8) compté AVANT l'envoi :
      // un échec d'envoi reste rare et la file `ws` retient quand même la frame.
      this._bytesSent += raw.length;
      this._messagesSent += 1;
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

  /** Octets en file d'envoi non drainés (`ws.bufferedAmount`) — risque #1. `0` si mock. */
  get bufferedAmount(): number {
    return this.conn.bufferedAmount ?? 0;
  }

  /** Cumul d'octets envoyés sur cette connexion (monotone). */
  get bytesSent(): number {
    return this._bytesSent;
  }

  /** Cumul de frames envoyées sur cette connexion (monotone). */
  get messagesSent(): number {
    return this._messagesSent;
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
