import type { IRealtimeTransport } from "../../realtime/IRealtimeTransport";
import { TransportState } from "../../realtime/IRealtimeTransport";

/**
 * BrowserWsTransport — transport {@link IRealtimeTransport} pour le navigateur :
 * wrap d'un `WebSocket` natif. Volontairement « bête » : il ouvre/envoie/ferme et
 * relaie les events. L'orchestration (reconnect, backoff, heartbeat, state machine)
 * vit AU-DESSUS dans `RealtimeClient` — qui crée un transport NEUF à chaque tentative.
 *
 * L'URL reçue est déjà normalisée (ws/wss, token) par l'appelant.
 */
export class BrowserWsTransport implements IRealtimeTransport {
  private ws: WebSocket | null = null;
  private _onOpen: (() => void) | null = null;
  private _onMessage: ((raw: string) => void) | null = null;
  private _onClose: ((code: number, reason: string) => void) | null = null;
  private _onError: ((err: unknown) => void) | null = null;

  constructor(private readonly url: string) {}

  connect(): void {
    this.ws = new WebSocket(this.url);
    this.ws.onopen = () => this._onOpen?.();
    this.ws.onmessage = (ev: MessageEvent) => {
      // On ne traite que le texte (frames JSON-RPC) ; le binaire est ignoré ici.
      if (typeof ev.data === "string") this._onMessage?.(ev.data);
    };
    this.ws.onclose = (ev: CloseEvent) => {
      this.ws = null;
      this._onClose?.(ev.code, ev.reason);
    };
    this.ws.onerror = () => this._onError?.(new Error("websocket error"));
  }

  send(raw: string): void {
    if (this.ws?.readyState === TransportState.OPEN) this.ws.send(raw);
  }

  close(code?: number, reason?: string): void {
    this.ws?.close(code, reason);
  }

  get readyState(): number {
    return this.ws?.readyState ?? TransportState.CLOSED;
  }

  onOpen(cb: () => void): void {
    this._onOpen = cb;
  }
  onMessage(cb: (raw: string) => void): void {
    this._onMessage = cb;
  }
  onClose(cb: (code: number, reason: string) => void): void {
    this._onClose = cb;
  }
  onError(cb: (err: unknown) => void): void {
    this._onError = cb;
  }
}

export default BrowserWsTransport;
