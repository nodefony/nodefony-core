/**
 * Domaine de config : RÉSEAU — domaine d'écoute, filtrage Host, serveurs, devServer.
 *
 * Nodefony écoute UN SEUL domaine (pas de vhost). Valeurs de `domain` possibles :
 *   "0.0.0.0"      → toutes interfaces réseau (production cluster)
 *   "[::1]"        → IPv6 only
 *   "192.168.1.1"  → IP fixe spécifique
 *   "mydomain.com" → résolution DNS
 *
 * `domainAlias` (regexps stringifiées, actif si `domainCheck: true`) — exemple :
 *   ["^127.0.0.1$", "^localhost$", ".*\\.nodefony\\.com"]
 */

/**
 * Domaine d'écoute du serveur. Recommandation prod : "0.0.0.0" (toutes interfaces)
 * ou IP fixe.
 */
export const domain = "127.0.0.1";
//export const domain = "selectAuto";

/**
 * Alias de domaines acceptés (regexps stringifiées). Activé si `domainCheck: true`.
 * Recommandation prod : restreindre strictement aux domaines servis.
 */
export const domainAlias = ["^localhost$"];

/**
 * Vérifie le domaine entrant contre `domain` + `domainAlias` ; Host inconnu → rejet.
 * Recommandation prod : `true` (protection Host header injection).
 */
export const domainCheck = true;

/**
 * SERVEURS HTTP/HTTPS/WS/WSS.
 * - `statics` : active server-static (assets, files, etc.)
 * - `http.port` : port HTTP plain
 * - `https.port` + `protocol` : "2.0" (HTTP/2 + ALPN HTTP/1.1) ou "1.1"
 * - `ws` / `wss` : héritent automatiquement du HTTP/HTTPS associé
 * Recommandation prod : ports 80/443 derrière un reverse proxy (nginx, ingress).
 */
export const servers = {
  statics: true,
  http: {
    port: 5151,
  },
  https: {
    port: 5152,
    protocol: "2.0", // "2.0" (HTTP/2 + fallback 1.1) ou "1.1" strict
  },
  ws: {},
  wss: {},
};

/**
 * SERVEUR DE DÉVELOPPEMENT (Webpack/Vite legacy — sera remplacé Phase 14).
 * - `hot` : Hot Module Replacement (true | "only" | false)
 * - `overlay` : afficher les erreurs build en overlay browser
 * - `logging` : verbosité du dev server ("none" | "error" | "warning" | "info")
 * Recommandation prod : ignoré (devServer non utilisé en prod).
 */
export const devServer = {
  hot: false,
  overlay: true,
  logging: "info",
  progress: false,
  protocol: "https",
  websocket: true,
};
