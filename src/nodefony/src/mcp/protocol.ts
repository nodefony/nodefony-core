/**
 * Model Context Protocol — types et constantes du transport « Streamable HTTP ».
 *
 * Révision visée : **2026-07-28**, celle qui a supprimé les sessions de niveau
 * protocole et le flux `GET`. C'est ce qui rend cette porte possible sans
 * process dédié : chaque message est un `POST` autonome, donc un redémarrage du
 * serveur de développement ne casse rien — le client rejoue simplement sa
 * requête, et la réponse vient du code qui vient d'être rechargé.
 *
 * @see https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http
 */

import type { IJsonRpcSuccess, IJsonRpcFailure } from "../jsonrpc/index";

/** Révision PRÉFÉRÉE de ce serveur — celle qu'il met en tête de ce qu'il sait faire. */
export const MCP_PROTOCOL_VERSION = "2026-07-28";

/**
 * Révision supposée quand un client n'en déclare AUCUNE.
 *
 * Ce n'est pas un choix : la spec impose de traiter une requête sans
 * déclaration comme `2025-03-26`, et le SDK de référence en fait sa
 * `DEFAULT_NEGOTIATED_PROTOCOL_VERSION`. Répondre notre préférée à un client
 * muet reviendrait à lui imposer une révision qu'il n'a pas demandée.
 */
export const MCP_DEFAULT_NEGOTIATED_VERSION = "2025-03-26";

/**
 * Versions que ce serveur sait servir — publiées par `server/discover`, listées
 * dans l'erreur `UnsupportedProtocolVersion`, et candidates à l'écho
 * d'`initialize`. De la plus récente à la plus ancienne.
 *
 * 🔴 **N'en servir qu'une était un défaut, et il a coûté la connexion.** Le
 * serveur annonçait `2026-07-28` à TOUT client, y compris à ceux qui
 * demandaient autre chose — or aucun client déployé ne connaît cette révision :
 * le SDK de référence (`@modelcontextprotocol/sdk@1.30.0`) porte
 * `LATEST = 2025-11-25` et refuse net toute réponse hors de sa liste
 * (« Server's protocol version is not supported »). Une porte parfaitement
 * conforme à la dernière spec, et injoignable par tout le monde.
 *
 * Ces cinq révisions sont celles que la spec a publiées. Les servir toutes est
 * honnête ici, et vérifiable : les quatre méthodes de ce serveur — `initialize`,
 * `ping`, `tools/list`, `tools/call` — ont la même forme de REQUÊTE dans
 * chacune. La forme du RÉSULTAT, elle, dépend de l'ÈRE du client : depuis
 * `2026-07-28`, tout résultat porte `resultType` (MUST du schéma) et `_meta`
 * serverInfo — servis par `eraResult` (server.ts) à un client moderne, jamais
 * à un client legacy qui ne définit pas ces champs. Un test EXERCE chacune,
 * plutôt que de se fier à cette phrase.
 */
export const MCP_SUPPORTED_VERSIONS = [
  MCP_PROTOCOL_VERSION,
  "2025-11-25",
  "2025-06-18",
  MCP_DEFAULT_NEGOTIATED_VERSION,
  "2024-11-05",
] as const;

/**
 * Clé de métadonnée par laquelle un client MODERNE déclare sa révision.
 *
 * ⭐ **C'est la différence d'ÈRE, et elle commande tout le reste.** Jusqu'à
 * `2025-11-25` (ère « legacy »), un client ouvrait une session par un handshake
 * `initialize`. Depuis `2026-07-28` (ère « modern »), il n'y a plus de session :
 * chaque requête porte elle-même sa version et les capacités du client, dans
 * `params._meta`. Un serveur qui n'écouterait que `initialize` serait un
 * serveur *legacy* — quelle que soit la version qu'il prétend annoncer.
 */
export const META_PROTOCOL_VERSION = "io.modelcontextprotocol/protocolVersion";

/** Clé de métadonnée portant l'identité du serveur dans `server/discover`. */
export const META_SERVER_INFO = "io.modelcontextprotocol/serverInfo";

/**
 * Chemin de l'endpoint MCP.
 *
 * ## Pourquoi `/nodefony/mcp`, et pas `/nodefony/devkit/api/mcp`
 *
 * Cette URL est un **contrat public** : elle est écrite dans le `.mcp.json` de
 * chaque utilisateur. Y faire figurer le module qui l'implémente la rendrait
 * caduque au premier déménagement — or ce serveur a vocation à bouger le jour
 * où une application voudra s'exposer en production (le devkit, lui, est
 * `policy: "dev"`). Le nom d'un module est un détail d'implémentation ; une URL
 * ne l'est pas.
 *
 * Le segment `api` est écarté pour une autre raison : il désigne le plan
 * d'administration JSON de Studio, avec son contrôle d'accès par rôle. Le MCP
 * n'est ni REST ni destiné à Studio — ranger deux protocoles sous le même
 * segment promettrait une parenté qui n'existe pas.
 *
 * Et `/mcp` à la racine, qui est la convention de fait ailleurs, prendrait un
 * chemin qui **appartient à l'application** : `/nodefony` est le préfixe
 * réservé du framework, donc sans collision possible.
 *
 * Constante et **non configurable** : une route décorée est statique, et un
 * réglage qui n'agirait pas serait pire qu'aucun réglage.
 */
export const MCP_ENDPOINT_PATH = "/nodefony/mcp";

// Les briques JSON-RPC 2.0 (codes, formes de message, fabriques) vivent dans
// `jsonrpc/`, partagées avec le pair temps réel : une seule définition, deux
// portes. Réexportées ici pour les appelants du protocole MCP.
export {
  JsonRpcError,
  jsonRpcSuccess,
  jsonRpcFailure,
  isNotification,
} from "../jsonrpc/index";
export type {
  JsonRpcId,
  IJsonRpcMessage,
  IJsonRpcSuccess,
  IJsonRpcFailure,
} from "../jsonrpc/index";
/**
 * Codes réservés par la spec MCP, hors plage JSON-RPC standard.
 *
 * Ils ne sont pas décoratifs : un client s'en sert pour se rattraper seul —
 * renégocier une version sur `-32022`, relire `tools/list` puis réessayer sur
 * `-32020`. Rendre un `-32600` générique à leur place le priverait de cette
 * reprise et transformerait un désaccord réparable en échec définitif.
 */
export const McpProtocolError = {
  /**
   * Les en-têtes HTTP contredisent le corps, ou un en-tête requis manque.
   * La spec impose `400` **et** ce code (`streamable-http` §Server Validation).
   */
  HEADER_MISMATCH: -32020,
  /**
   * La révision demandée n'est pas servie. La réponse **doit** lister celles
   * qu'on sert, sans quoi le client n'a rien pour choisir.
   */
  UNSUPPORTED_PROTOCOL_VERSION: -32022,
} as const;

/** Ce que le serveur MCP rend, avant traduction en réponse HTTP. */
export interface IMcpHttpReply {
  /** Statut HTTP à poser. */
  status: number;
  /**
   * Corps JSON, ou `null` pour un `202 Accepted` sans corps — la spec l'exige
   * pour une notification acceptée.
   */
  body: IJsonRpcSuccess | IJsonRpcFailure | null;
  /**
   * L'exception levée par un outil, rendue À CÔTÉ de la réponse — jamais
   * sérialisée.
   *
   * Le client ne reçoit qu'un message générique : le message d'une exception
   * peut porter un chemin de disque, une chaîne de connexion ou un secret, et
   * l'outil qui la lève est du code d'application arbitraire. Le détail reste
   * donc au serveur, et c'est au TRANSPORT de le journaliser : le protocole est
   * une fonction pure, qui n'a pas de journal.
   */
  failure?: { tool: string; error: unknown } | undefined;
}
