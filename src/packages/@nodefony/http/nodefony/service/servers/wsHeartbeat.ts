import Ws, { WebSocketServer } from "ws";

/**
 * Options keep-alive d'un serveur WebSocket.
 *
 * Héritées de l'ancienne lib `websocket` (theturtle32) qui les gérait nativement.
 * `ws@8` n'a AUCUN keep-alive natif (il n'expose que `ping()`/`pong()` manuels) :
 * on réimplémente donc la sémantique au-dessus de `ws` pour que ces knobs — déjà
 * déclarés dans le schéma Zod — ne soient plus une config qui ment.
 */
export interface IWsHeartbeatOptions {
  /** Intervalle (ms) entre deux pings. `0` ou absent → keep-alive désactivé. */
  keepaliveInterval?: number;
  /** Délai (ms) accordé pour recevoir le `pong` avant de couper la socket. */
  keepaliveGracePeriod?: number;
}

/**
 * Socket `ws` augmentée de deux horodatages keep-alive.
 *
 * Ce sont de simples `number` posés sur l'instance → 0 allocation par tick, pas de
 * `Map` externe (qui imposerait un lookup + un cleanup au close).
 */
interface IHeartbeatSocket extends Ws {
  /** Dernier signe de vie (date du dernier `pong`, ou de la connexion). */
  _nfLastPong?: number;
  /** Date du dernier `ping` émis ; `0` = aucun ping en attente de réponse. */
  _nfPingedAt?: number;
}

/**
 * Arme le suivi keep-alive d'UNE connexion : initialise l'horodatage de vie et
 * attache l'unique listener `pong` qui le rafraîchit.
 *
 * Le listener `pong` vit et meurt avec la socket (l'émetteur EST la socket `ws`,
 * détruite au `close`/`terminate`) → aucun `removeListener` explicite à prévoir.
 * Un seul listener par connexion, c'est le pair-event obligatoire du ping.
 *
 * @param ws - la socket fraîchement connectée
 */
export const trackPong = (ws: Ws): void => {
  const sock = ws as IHeartbeatSocket;
  sock._nfLastPong = performance.now();
  sock._nfPingedAt = 0;
  ws.on("pong", () => {
    (ws as IHeartbeatSocket)._nfLastPong = performance.now();
  });
};

/**
 * Démarre le heartbeat keep-alive du serveur : détecte les connexions zombies
 * (half-open — TCP encore ouvert mais le pair a disparu sans frame Close) et les
 * `terminate()` pour libérer slot mémoire + descripteur de fichier.
 *
 * Sémantique (fidèle à l'ancienne lib `websocket`) : un ping est émis tous les
 * `keepaliveInterval` ms ; si aucun `pong` n'arrive dans les `keepaliveGracePeriod`
 * ms qui suivent ce ping, la socket est détruite. Temps de réclamation borné par
 * `keepaliveInterval + keepaliveGracePeriod` (+ une granularité de tick).
 *
 * PERF (hot path WS) : **UN seul `setInterval` par serveur** — jamais un timer par
 * connexion. Chaque tick ne lit/écrit que des `number` sur la socket → 0 allocation
 * sur le chemin nominal. `unref()` pour ne pas retenir le process à l'arrêt. Le timer
 * DOIT être `clearInterval` au shutdown (cf appelant).
 *
 * @param server - le `WebSocketServer` dont on surveille `clients`
 * @param options - knobs keep-alive (depuis la config Zod du module)
 * @returns le timer à nettoyer au shutdown, ou `null` si le keep-alive est désactivé
 */
export const startHeartbeat = (
  server: WebSocketServer,
  options: IWsHeartbeatOptions,
): ReturnType<typeof setInterval> | null => {
  const interval = options.keepaliveInterval ?? 0;
  if (interval <= 0) {
    return null; // keep-alive désactivé explicitement
  }
  const grace = options.keepaliveGracePeriod ?? 0;
  // Granularité du timer = la plus fine des deux fenêtres, avec un plancher de
  // 250 ms : il borne le réveil sur une config pathologique (interval=1 ms) sans
  // jamais gêner la prod (10–20 s ne touchent jamais ce plancher).
  const tick = Math.max(250, grace > 0 ? Math.min(interval, grace) : interval);
  const timer = setInterval(() => {
    const now = performance.now();
    for (const client of server.clients) {
      if (client.readyState !== Ws.OPEN) {
        continue;
      }
      const sock = client as IHeartbeatSocket;
      if (sock._nfLastPong === undefined) {
        // Connexion non passée par trackPong (sécurité) → on l'amorce.
        sock._nfLastPong = now;
      }
      // Un ping est « en attente » si on a pingé APRÈS le dernier pong reçu.
      const pingPending = (sock._nfPingedAt ?? 0) > sock._nfLastPong;
      if (pingPending) {
        if (now - (sock._nfPingedAt as number) > grace) {
          // Ping resté sans réponse au-delà du délai de grâce → zombie.
          client.terminate();
        }
        continue; // ping déjà en vol → ne pas re-pinguer
      }
      if (now - sock._nfLastPong >= interval) {
        sock._nfPingedAt = now;
        client.ping(); // `ws` répondra par un pong → _nfLastPong rafraîchi
      }
    }
  }, tick);
  timer.unref?.();
  return timer;
};
