import type {
  IRealtimeTransport,
  RealtimeFrameData,
  RealtimeOutboundData,
} from "../../realtime/IRealtimeTransport";
import { TransportState } from "../../realtime/IRealtimeTransport";

/**
 * BrowserWsTransport — transport {@link IRealtimeTransport} pour le navigateur :
 * wrap d'un `WebSocket` natif. Volontairement « bête » : il ouvre/envoie/ferme et
 * relaie les events. L'orchestration (reconnect, backoff, heartbeat, state machine)
 * vit AU-DESSUS dans `NodefonySocket` — qui crée un transport NEUF à chaque tentative.
 *
 * L'URL reçue est déjà normalisée (ws/wss, token) par l'appelant.
 */
export class BrowserWsTransport implements IRealtimeTransport {
  private ws: WebSocket | null = null;
  private _onOpen: (() => void) | null = null;
  private _onMessage: ((raw: RealtimeFrameData) => void) | null = null;
  private _onClose: ((code: number, reason: string) => void) | null = null;
  private _onError: ((err: unknown) => void) | null = null;

  constructor(private readonly url: string) {}

  connect(): void {
    // `addEventListener` plutôt qu'une affectation `onopen = …` : une affectation
    // REMPLACE le gestionnaire précédent, y compris celui qu'un code tiers aurait
    // posé sur la même socket. Ici la socket vient d'être créée, donc rien n'est
    // encore écrasé — mais la forme qui ne peut pas voler un gestionnaire est
    // celle qu'on veut voir recopiée.
    const ws = new WebSocket(this.url);
    // `arraybuffer` plutôt que le défaut `blob` : la taille se lit sans attendre,
    // et une trame binaire reste à sa place dans l'ordre des trames texte.
    ws.binaryType = "arraybuffer";
    this.ws = ws;
    ws.addEventListener("open", () => this._onOpen?.());
    // Tout est relayé, binaire compris : trier ici rendait l'écart invisible.
    // C'est l'endpoint qui écarte, et qui le dit (#451). Les octets sortent en
    // `Uint8Array`, le type du contrat des deux côtés : une vue sur l'`ArrayBuffer`
    // reçu, sans copie.
    ws.addEventListener("message", (ev: MessageEvent<string | ArrayBuffer>) => {
      const data = ev.data;
      this._onMessage?.(typeof data === "string" ? data : new Uint8Array(data));
    });
    ws.addEventListener("close", (ev: CloseEvent) => {
      this.ws = null;
      this._onClose?.(ev.code, ev.reason);
    });
    ws.addEventListener("error", () =>
      this._onError?.(new Error("websocket error")),
    );
  }

  send(raw: RealtimeOutboundData): void {
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
  onMessage(cb: (raw: RealtimeFrameData) => void): void {
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
