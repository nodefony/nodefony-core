import {
  TransportState,
  type IRealtimeTransport,
} from "../../../../../../nodefony/src/realtime/IRealtimeTransport.js";

/**
 * Câble loopback in-process entre un VRAI `NodefonySocket` (client du cœur) et
 * un VRAI `RealtimeController` — un seul exemplaire pour tous les bancs e2e du
 * paquet : trois copies avaient déjà divergé.
 *
 * Chaque livraison passe par une microtâche, comme une trame passe par la
 * boucle d'événements : aucun banc ne peut compter sur un aller-retour
 * synchrone qui n'existe pas en vrai.
 */
export class LoopbackWire {
  /** `controller.handleRealtime` (null = handshake). Branché par le banc. */
  feedServer: ((raw: string | null) => void) | null = null;
  /** Pompe entrante du transport client (`onMessage`). Branchée par le transport. */
  pumpClient: ((raw: string) => void) | null = null;
  /** `onClose` du transport client. Branché par le transport. */
  closeClient: ((code: number, reason: string) => void) | null = null;
  /** État de la connexion serveur (lu par sa fausse connexion). */
  serverConnOpen = true;

  /** Serveur → client (appelé par `conn.send`). */
  deliverToClient(raw: string): void {
    queueMicrotask(() => this.pumpClient?.(raw));
  }

  /** Client → serveur (appelé par `clientTransport.send`). */
  deliverToServer(raw: string): void {
    queueMicrotask(() => this.feedServer?.(raw));
  }
}

/** Transport client branché sur un {@link LoopbackWire}. */
export class LoopbackClientTransport implements IRealtimeTransport {
  readyState: number = TransportState.CONNECTING;
  /** Dernier code de fermeture, qu'il vienne du serveur ou du client. */
  lastCloseCode: number | null = null;
  /** Codes de fermeture émis par le SERVEUR, dans l'ordre. */
  readonly serverCloseCodes: number[] = [];
  private _onOpen: (() => void) | null = null;
  private _onClose: ((code: number, reason: string) => void) | null = null;
  constructor(private readonly wire: LoopbackWire) {}
  connect(): void {
    this.readyState = TransportState.OPEN;
    queueMicrotask(() => {
      this._onOpen?.();
      this.wire.feedServer?.(null); // handshake serveur
    });
  }
  send(raw: string): void {
    if (this.readyState !== TransportState.OPEN) return;
    this.wire.deliverToServer(raw);
  }
  close(code = 1000, reason = ""): void {
    this.readyState = TransportState.CLOSED;
    this.lastCloseCode = code;
    this._onClose?.(code, reason);
  }
  onOpen(cb: () => void): void {
    this._onOpen = cb;
  }
  onMessage(cb: (raw: string) => void): void {
    this.wire.pumpClient = cb;
  }
  onClose(cb: (code: number, reason: string) => void): void {
    this._onClose = cb;
    this.wire.closeClient = (code, reason) => {
      this.lastCloseCode = code;
      this.serverCloseCodes.push(code);
      cb(code, reason);
    };
  }
  onError(): void {
    /* erreurs surfacées par close */
  }
}
