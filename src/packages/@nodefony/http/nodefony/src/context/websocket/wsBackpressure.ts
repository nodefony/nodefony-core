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
  /** Refus consécutifs au-delà desquels on ferme (1013) ; `0`/absent = jamais. */
  backpressureCloseAfterDrops?: number;
}

/**
 * Ce dont la règle a besoin, et rien de plus : la taille de la file d'envoi et
 * de quoi fermer. Typé STRUCTURELLEMENT pour que `@nodefony/realtime` applique
 * la même règle sans importer `ws` (son transport type déjà sa connexion ainsi).
 */
export interface IBackpressureTarget {
  readonly bufferedAmount?: number;
  close(code?: number, reason?: string): void;
}

/** Socket augmentée d'un compteur de drops (number lazy — lu par la sonde socket). */
export interface IBackpressureSocket extends Ws {
  /** Nombre cumulé de frames droppées/refusées pour backpressure sur cette socket. */
  _nfDrops?: number;
  /**
   * Frames refusées **d'affilée**, remis à zéro dès qu'une frame repart. C'est
   * le signal d'une file qui ne se draine plus — le seul qui distingue un pic
   * passager d'un client mort. Cf le palier 2 de {@link decideSend}.
   */
  _nfDropStreak?: number;
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
): {
  max: number;
  policy: WsBackpressurePolicy;
  closeAfterDrops: number;
} => {
  const opts = (wss?.options ?? {}) as ServerOptions & IWsBackpressureOptions;
  return {
    max: opts.maxBackpressure ?? 0,
    policy: opts.backpressurePolicy ?? "drop",
    closeAfterDrops: opts.backpressureCloseAfterDrops ?? 0,
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
  ws: IBackpressureTarget,
  max: number,
  policy: WsBackpressurePolicy,
  closeAfterDrops = 0,
): WsSendDecision => {
  const sock = ws as unknown as IBackpressureSocket;
  // Connexion mockée sans `bufferedAmount` → 0 : jamais de refus (0 régression).
  if (max <= 0 || (ws.bufferedAmount ?? 0) <= max) {
    // Chemin nominal. Le compteur DÉCROÎT au lieu d'être remis à zéro : mesuré
    // sur socket réelle, la file d'un client bloqué OSCILLE autour du seuil
    // (refus, drainage partiel, envoi, refus…), si bien qu'une remise à zéro
    // empêchait toute fermeture — un client qui accepte une frame de temps en
    // temps serait resté connecté pour toujours. En décroissant, un client sain
    // revient vite à 0 tandis qu'un client qui refuse plus qu'il n'accepte monte
    // jusqu'au seuil. Aucune écriture quand le compteur est déjà à zéro.
    if (sock._nfDropStreak) sock._nfDropStreak -= 1;
    return "send";
  }
  sock._nfDrops = (sock._nfDrops ?? 0) + 1;
  const streak = (sock._nfDropStreak = (sock._nfDropStreak ?? 0) + 1);
  if (policy === "close") {
    ws.close(1013, "backpressure");
    return "close";
  }
  // Palier 2 — la file NE PEUT PAS croître au-delà du seuil une fois qu'on
  // jette : un second seuil d'octets serait donc INATTEIGNABLE (mesuré : 4000
  // frames poussées à un client qui ne lit pas → 3 servies, aucune fermeture).
  // La condition retenue est un SOLDE de refus (+1 par refus, −1 par envoi) :
  // il distingue le pic passager, qui redescend, du client qui n'absorbe plus
  // ce qu'on lui pousse. `0` = ne jamais fermer (comportement d'avant).
  if (closeAfterDrops > 0 && streak >= closeAfterDrops) {
    ws.close(1013, "backpressure");
    return "close";
  }
  return "drop";
};
