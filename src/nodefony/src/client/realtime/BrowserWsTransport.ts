import type {
  IRealtimeTransport,
  RealtimeFrameData,
  RealtimeOutboundData,
} from "../../realtime/IRealtimeTransport";
import { TransportState } from "../../realtime/IRealtimeTransport";

/**
 * Un `WebSocket` dont la poignée de main porte des en-têtes. Le standard ne
 * prend que des sous-protocoles en second argument ; le `WebSocket` de Node
 * (undici) accepte aussi un objet `{ protocols, headers }` — extension
 * documentée, absente des navigateurs. Le type DOM l'ignore : la construction
 * passe par `Reflect.construct`, `instanceof` rend son type au résultat. Un
 * navigateur lit l'objet comme un sous-protocole invalide et lève : la
 * capacité se CONSTATE à la construction, elle ne se devine pas.
 *
 * @throws TypeError — ce `WebSocket` n'accepte pas d'en-têtes
 */
function withHeaders(
  url: string,
  protocols: readonly string[] | undefined,
  headers: Readonly<Record<string, string>>,
): WebSocket {
  let ws: unknown;
  try {
    ws = Reflect.construct(WebSocket, [
      url,
      { protocols: protocols === undefined ? [] : [...protocols], headers },
    ]);
  } catch (cause) {
    throw new TypeError(
      "[nodefony] en-têtes de poignée de main refusés par ce WebSocket : un navigateur joint lui-même ses cookies, `headers` ne sert que sous Node",
      { cause },
    );
  }
  if (!(ws instanceof WebSocket))
    throw new TypeError("[nodefony] WebSocket non construit");
  return ws;
}

/**
 * BrowserWsTransport — transport {@link IRealtimeTransport} pour le navigateur :
 * wrap d'un `WebSocket` natif. Volontairement « bête » : il ouvre/envoie/ferme et
 * relaie les events. L'orchestration (reconnect, backoff, heartbeat, state machine)
 * vit AU-DESSUS dans `NodefonySocket` — qui crée un transport NEUF à chaque tentative.
 *
 * L'URL reçue est déjà normalisée (ws/wss, token) par l'appelant ; l'offre de
 * sous-protocoles aussi (cf `RealtimeTransportFactory`).
 */
export class BrowserWsTransport implements IRealtimeTransport {
  private ws: WebSocket | null = null;
  private _onOpen: (() => void) | null = null;
  private _onMessage: ((raw: RealtimeFrameData) => void) | null = null;
  private _onClose: ((code: number, reason: string) => void) | null = null;
  private _onError: ((err: unknown) => void) | null = null;

  /**
   * @param url - adresse `ws:`/`wss:` déjà normalisée.
   * @param protocols - sous-protocoles offerts (RFC 6455 §1.9), par préférence ;
   *   absent = aucun en-tête `Sec-WebSocket-Protocol`, le handshake d'avant #618.
   * @param headers - en-têtes de la poignée de main, sous Node seulement
   *   (`NodefonySocketOptions.headers`)
   */
  constructor(
    private readonly url: string,
    private readonly protocols?: readonly string[],
    private readonly headers?: Readonly<Record<string, string>>,
  ) {}

  /**
   * Ouvre la socket.
   *
   * @throws TypeError — des en-têtes demandés à un `WebSocket` qui n'en prend
   *   pas (celui d'un navigateur)
   */
  connect(): void {
    // `addEventListener` plutôt qu'une affectation `onopen = …` : une affectation
    // REMPLACE le gestionnaire précédent, y compris celui qu'un code tiers aurait
    // posé sur la même socket. Ici la socket vient d'être créée, donc rien n'est
    // encore écrasé — mais la forme qui ne peut pas voler un gestionnaire est
    // celle qu'on veut voir recopiée.
    // La copie de l'offre : `WebSocket` exige un `string[]` mutable. Une par
    // tentative de connexion, jamais par trame.
    const ws =
      this.headers !== undefined
        ? withHeaders(this.url, this.protocols, this.headers)
        : this.protocols === undefined
          ? new WebSocket(this.url)
          : new WebSocket(this.url, [...this.protocols]);
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

  /** Octets que le navigateur n'a pas encore écoulés sur le réseau. */
  get bufferedAmount(): number {
    return this.ws?.bufferedAmount ?? 0;
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
