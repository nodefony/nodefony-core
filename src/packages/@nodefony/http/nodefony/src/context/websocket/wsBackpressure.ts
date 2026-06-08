import Ws, { WebSocketServer, ServerOptions } from "ws";

/** Politique appliquée quand le buffer d'envoi d'un client dépasse le seuil. */
export type WsBackpressurePolicy = "drop" | "close";

/**
 * Options de backpressure SORTANTE (serveur → client).
 *
 * Knobs Nodefony (pas des options `ws`) ; `ws` les conserve quand même dans
 * `wss.options` car son constructeur fait `{ ...defaults, ...options }` → on les
 * relit ici via {@link readBackpressureOptions}.
 */
export interface IWsBackpressureOptions {
  /** Seuil (octets) de `ws.bufferedAmount` ; `0`/absent = désactivé. */
  maxBackpressure?: number;
  /** Action au dépassement du seuil. Défaut `"drop"`. */
  backpressurePolicy?: WsBackpressurePolicy;
}

/** Socket augmentée d'un compteur de drops (number lazy — lu par la sonde socket). */
export interface IBackpressureSocket extends Ws {
  /** Nombre cumulé de frames droppées/refusées pour backpressure sur cette socket. */
  _nfDrops?: number;
}

/** Décision pour une frame : l'émettre, la sauter, ou (socket fermée) ne rien faire. */
export type WsSendDecision = "send" | "drop" | "close";

/**
 * Relit le seuil + la politique depuis les options du `WebSocketServer`.
 *
 * `ws` préserve nos clés custom (`maxBackpressure`/`backpressurePolicy`) dans
 * `wss.options` via le spread de son constructeur. Appelé UNE fois hors de la boucle
 * `broadcast()` (pas par frame).
 *
 * @param wss - le serveur WebSocket (ou null/undefined → backpressure désactivée)
 * @returns seuil résolu (`max`, 0 = off) + politique (`policy`, défaut `"drop"`)
 */
export const readBackpressureOptions = (
  wss: WebSocketServer | null | undefined,
): { max: number; policy: WsBackpressurePolicy } => {
  const opts = (wss?.options ?? {}) as ServerOptions & IWsBackpressureOptions;
  return {
    max: opts.maxBackpressure ?? 0,
    policy: opts.backpressurePolicy ?? "drop",
  };
};

/**
 * Décide si une frame doit partir vers `ws` selon la backpressure SORTANTE
 * (serveur → client). Protège la RAM d'envoi du serveur quand le client est lent à
 * RECEVOIR (ne lit pas assez vite → `ws.bufferedAmount` gonfle → OOM). `broadcast()`
 * amplifie : un seul client lent peut, sans borne, faire tomber la diffusion entière.
 *
 * PERF (hot path WS) : lecture O(1) de `ws.bufferedAmount`, **0 allocation sous le
 * seuil** (chemin nominal = comportement inchangé). Au-delà : incrémente `_nfDrops`
 * (lazy) et, si la politique est `close`, ferme la socket (RFC 6455 close 1013
 * « Try Again Later » → le client peut back-off + reconnecter). NE FAIT PAS le `send()`
 * — le caller émet uniquement si le retour vaut `"send"`.
 *
 * @param ws - la socket destinataire
 * @param max - seuil d'octets (`<= 0` → désactivé)
 * @param policy - action au dépassement
 * @returns `"send"` (émettre) · `"drop"` (sauter cette frame) · `"close"` (socket fermée)
 */
export const decideSend = (
  ws: Ws,
  max: number,
  policy: WsBackpressurePolicy,
): WsSendDecision => {
  if (max <= 0 || ws.bufferedAmount <= max) {
    return "send"; // désactivé ou sous le seuil → chemin nominal, 0 alloc
  }
  const sock = ws as IBackpressureSocket;
  sock._nfDrops = (sock._nfDrops ?? 0) + 1;
  if (policy === "close") {
    ws.close(1013, "backpressure");
    return "close";
  }
  return "drop";
};
