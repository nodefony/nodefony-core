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

export interface IRealtimeTransport {
  /** Ouvre le transport (asynchrone — l'ouverture effective est signalée par `onOpen`). */
  connect(): void;
  /** Envoie une frame brute (déjà sérialisée). No-op si non ouvert. */
  send(raw: string): void;
  /** Ferme le transport (déclenche `onClose`). */
  close(code?: number, reason?: string): void;
  /** État courant (0..3, cf {@link TransportState}). */
  readonly readyState: number;
  /** Branche le handler d'ouverture (le owner relance subscribe/heartbeat). */
  onOpen(cb: () => void): void;
  /** Branche le pump entrant : appelé pour chaque frame brute reçue. */
  onMessage(cb: (raw: string) => void): void;
  /** Branche la fermeture (le owner relance le backoff ou nettoie). */
  onClose(cb: (code: number, reason: string) => void): void;
  /** Branche les erreurs transport (la fermeture qui suit gère le reconnect). */
  onError(cb: (err: unknown) => void): void;
}

/** Fabrique d'un transport pour une URL — injectable (tests, transports alternatifs). */
export type RealtimeTransportFactory = (url: string) => IRealtimeTransport;
