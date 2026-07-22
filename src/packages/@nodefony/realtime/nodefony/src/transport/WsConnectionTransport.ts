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
 * Back-pressure WS — seuils de `bufferedAmount` (octets en file `ws` non drainée).
 * - **DROP** (1 MiB, = `SLOW_CONSUMER_BYTES` de la sonde) : au-delà, la frame est
 *   JETÉE (canaux d'ÉTAT latest-wins : le prochain snapshot la remplace) → borne la
 *   file sans couper la connexion.
 * - **CLOSE** (8 MiB) : file irrécupérable → `close(1013)` (RFC 6455 « Try Again
 *   Later ») ; le client se reconnecte et resync. Protège la mémoire process
 *   (file non bornée × M clients = OOM, blocker #1 du multiplexing N canaux / 1 WS).
 *
 * Overridables PAR CONNEXION via le 2ᵉ arg du constructeur (`{ dropBytes, closeBytes }`)
 * — seam TESTÉ (WsConnectionTransport.test.ts) mais **non câblé à la config** aujourd'hui :
 * le seul appelant de prod (`RealtimeController.ts:357`) construit SANS, donc en pratique
 * ce sont toujours ces constantes. ⚠️ NE PAS confondre avec `slowConsumer.bytes` (config) :
 * celle-ci ne règle QUE le seuil de COMPTAGE de la sonde (`RealtimeHub.#slowConsumerBytes`,
 * cf `RealtimeHub.ts:305` « l'ACTION de back-pressure a ses propres seuils ici »), PAS
 * l'action drop/close de ce transport.
 */
export const BACKPRESSURE_DROP_BYTES = 1 << 20; // 1 MiB
export const BACKPRESSURE_CLOSE_BYTES = 8 << 20; // 8 MiB

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
  // Frames jetées par back-pressure (drop latest-wins + close slow-consumer).
  private _dropped = 0;
  // Seuils résolus à la construction (2ᵉ arg = override par connexion, seam testé mais
  // NON câblé à la config ; défauts = constantes module, protection active sans câblage).
  private readonly _dropBytes: number;
  private readonly _closeBytes: number;

  constructor(
    private readonly conn: RawWsConnection,
    limits?: { dropBytes?: number; closeBytes?: number },
  ) {
    this._dropBytes = limits?.dropBytes ?? BACKPRESSURE_DROP_BYTES;
    this._closeBytes = limits?.closeBytes ?? BACKPRESSURE_CLOSE_BYTES;
  }

  connect(): void {
    /* déjà ouverte par le serveur — no-op */
  }

  send(raw: string): void {
    if (this.conn.readyState !== TransportState.OPEN) return;
    // Back-pressure (blocker mémoire #1) — la file `ws` non drainée (`bufferedAmount`)
    // grossit sans borne pour un slow-consumer (onglet throttlé, mobile, fenêtre TCP
    // pleine) ; × M clients = OOM, et le multiplexing concentre (1 WS lente bloque
    // TOUS ses canaux). Politique 2 seuils (cf BACKPRESSURE_*_BYTES) :
    //  - ≥ CLOSE : file irrécupérable → `close(1013)`, le client se reconnecte/resync.
    //  - ≥ DROP  : on JETTE la frame (canaux d'ÉTAT = latest-wins) → borne la file.
    // Mock de test sans `bufferedAmount` → `?? 0` → jamais de drop (0 régression).
    const buffered = this.conn.bufferedAmount ?? 0;
    if (buffered >= this._closeBytes) {
      this._dropped += 1;
      this.conn.close(1013, "slow consumer");
      return;
    }
    if (buffered >= this._dropBytes) {
      this._dropped += 1;
      return;
    }
    // `raw.length` (≈ octets pour l'ASCII/JSON ; O(1) en V8) compté AVANT l'envoi :
    // un échec d'envoi reste rare et la file `ws` retient quand même la frame.
    this._bytesSent += raw.length;
    this._messagesSent += 1;
    this.conn.send(raw, () => {
      /* socket fermée pendant l'envoi — ignoré */
    });
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

  /** Cumul de frames jetées par back-pressure (drop + close slow-consumer) — monotone. */
  get dropped(): number {
    return this._dropped;
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
