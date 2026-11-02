import {
  TransportState,
  type IRealtimeTransport,
  type RealtimeFrameData,
} from "../../../../../../nodefony/src/realtime/IRealtimeTransport.js";
import type { ContextType } from "@nodefony/http";

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
  feedServer: ((raw: RealtimeFrameData | null) => void) | null = null;
  /** Pompe entrante du transport client (`onMessage`). Branchée par le transport. */
  pumpClient: ((raw: RealtimeFrameData) => void) | null = null;
  /** `onClose` du transport client. Branché par le transport. */
  closeClient: ((code: number, reason: string) => void) | null = null;
  /** État de la connexion serveur (lu par sa fausse connexion). */
  serverConnOpen = true;

  /** Serveur → client (appelé par `conn.send`). */
  deliverToClient(raw: RealtimeFrameData): void {
    queueMicrotask(() => this.pumpClient?.(raw));
  }

  /** Client → serveur (appelé par `clientTransport.send`). */
  deliverToServer(raw: RealtimeFrameData): void {
    queueMicrotask(() => this.feedServer?.(raw));
  }
}

/** Ce que le handshake serveur lit de la requête d'upgrade. */
export interface ILoopbackHandshake {
  url?: string;
  origin?: string;
}

/**
 * Contexte WebSocket serveur factice relié au câble — ce que la route WS passe
 * au `RealtimeController`. `bufferedAmount` est pilotable (seule entrée de la
 * contre-pression), `fireFinish` joue la fin de connexion.
 */
export function loopbackServerContext(
  wire: LoopbackWire,
  hs: ILoopbackHandshake = {},
): {
  ctx: ContextType;
  conn: { bufferedAmount: number };
  fireFinish: () => void;
  closeServer: (code?: number, reason?: string) => void;
} {
  let onFinish: (() => void) | null = null;
  const conn = {
    get readyState() {
      return wire.serverConnOpen ? TransportState.OPEN : TransportState.CLOSED;
    },
    bufferedAmount: 0,
    send: (raw: string, cb?: (err?: Error) => void) => {
      wire.deliverToClient(raw);
      cb?.();
    },
    close: (code?: number, reason?: string) => {
      wire.serverConnOpen = false;
      queueMicrotask(() => wire.closeClient?.(code ?? 1000, reason ?? ""));
    },
  };
  const ctx = {
    type: "websocket",
    outboundTracer: () => null,
    connection: conn,
    once: (event: string, fn: () => void) => {
      if (event === "onFinish") onFinish = fn;
    },
    request: { headers: {}, url: hs.url ?? "/realtime" },
    cookies: {},
    url: hs.url ?? "/realtime",
    remoteAddress: "127.0.0.1",
    origin: hs.origin ?? "",
  };
  return {
    // Le controller ne lit que ces champs-là : le reste du contexte HTTP n'a
    // pas d'équivalent sur un câble en mémoire.
    ctx: ctx as unknown as ContextType,
    conn,
    fireFinish: () => onFinish?.(),
    closeServer: (code, reason) => conn.close(code, reason),
  };
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
  send(raw: RealtimeFrameData): void {
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
  onMessage(cb: (raw: RealtimeFrameData) => void): void {
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
