/**
 * IRealtimeTransport — le SEUL maillon qui diffère client/serveur.
 *
 * Le protocole ({@link JsonRpcPeer}) et les « smarts » (stats, pub/sub) sont
 * isomorphes ; seule la façon dont les **octets** entrent et sortent change. On
 * isole donc le transport derrière cette interface : un même endpoint compose
 * N transports.
 *
 * Implémentations :
 *  - `BrowserWsTransport` (navigateur, `WebSocket` + reconnect géré au-dessus)
 *  - `WsConnectionTransport` (serveur, wrap d'une connexion `ws` — P… RealtimeController)
 *  - futurs P13 : `Tcp`/`Udp`/`Redis`/`SipTransport` (RealtimeService / IRealtimeHub)
 *
 * Les états suivent les constantes `WebSocket` (0..3) pour rester universels —
 * voir {@link TransportState}.
 *
 * ── Sens des flux ──
 *  Sortant : `send` (frame brute déjà sérialisée), `close`.
 *  Entrant : le owner branche `onMessage` (chaque frame reçue) ; `onOpen`/`onClose`/
 *  `onError` pilotent le cycle de vie (l'orchestration reconnect/heartbeat vit
 *  AU-DESSUS, dans l'endpoint — le transport reste « bête »).
 */

/** États d'un transport — alignés sur les constantes `WebSocket`. */
export const TransportState = {
  CONNECTING: 0,
  OPEN: 1,
  CLOSING: 2,
  CLOSED: 3,
} as const;
export type TransportStateValue =
  (typeof TransportState)[keyof typeof TransportState];

/**
 * Une frame brute telle que le transport la reçoit : du texte, ou des octets.
 *
 * Les octets sont un `Uint8Array` des deux côtés, navigateur comme serveur : un
 * code de traitement binaire s'écrit une fois. Chaque transport adapte à SA
 * frontière — le navigateur pose une vue sur l'`ArrayBuffer` reçu, sans copie ;
 * un `Buffer` de Node en est déjà un. Le tampon est un `ArrayBuffer`, jamais
 * partagé : c'est ce que `WebSocket.send` exige, et l'écho d'une trame reçue
 * compile donc sans conversion.
 *
 * Le transport relaie TOUT ce qui arrive, sans trier : c'est l'endpoint qui
 * décide de ce qu'il lit et qui rend visible ce qu'il écarte. Un transport qui
 * filtrait lui-même faisait disparaître une trame binaire sans que personne,
 * au-dessus, ne puisse le savoir (#451).
 */
export type RealtimeFrameData = string | Uint8Array<ArrayBuffer>;

/**
 * Ce qu'un transport accepte d'émettre : une frame texte déjà sérialisée, ou des
 * octets tels quels — le même type qu'en réception (cf {@link RealtimeFrameData}).
 */
export type RealtimeOutboundData = RealtimeFrameData;

export interface IRealtimeTransport {
  /** Ouvre le transport (asynchrone — l'ouverture effective est signalée par `onOpen`). */
  connect(): void;
  /** Envoie une frame brute (texte sérialisé ou octets). No-op si non ouvert. */
  send(raw: RealtimeOutboundData): void;
  /** Ferme le transport (déclenche `onClose`). */
  close(code?: number, reason?: string): void;
  /** État courant (0..3, cf {@link TransportState}). */
  readonly readyState: number;
  /** Branche le handler d'ouverture (le owner relance subscribe/heartbeat). */
  onOpen(cb: () => void): void;
  /**
   * Branche le pump entrant : appelé pour CHAQUE frame brute reçue, texte ou
   * binaire — jamais filtrée ici (cf {@link RealtimeFrameData}).
   */
  onMessage(cb: (raw: RealtimeFrameData) => void): void;
  /** Branche la fermeture (le owner relance le backoff ou nettoie). */
  onClose(cb: (code: number, reason: string) => void): void;
  /** Branche les erreurs transport (la fermeture qui suit gère le reconnect). */
  onError(cb: (err: unknown) => void): void;
}

/** Fabrique d'un transport pour une URL — injectable (tests, transports alternatifs). */
export type RealtimeTransportFactory = (url: string) => IRealtimeTransport;
