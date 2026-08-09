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

/** Révision du protocole que ce serveur annonce. */
export const MCP_PROTOCOL_VERSION = "2026-07-28";

/**
 * Versions que ce serveur sait servir — publiées par `server/discover` et
 * listées dans l'erreur `UnsupportedProtocolVersion`.
 *
 * Une seule pour l'instant, et c'est délibéré : annoncer une révision qu'on
 * n'a pas éprouvée reviendrait à promettre une sémantique qu'on ne tient pas.
 */
export const MCP_SUPPORTED_VERSIONS = [MCP_PROTOCOL_VERSION] as const;

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

/** Codes d'erreur JSON-RPC 2.0 employés par ce serveur. */
export const JsonRpcError = {
  /** Corps illisible. */
  PARSE_ERROR: -32700,
  /** Message qui n'est pas une requête JSON-RPC valide. */
  INVALID_REQUEST: -32600,
  /** Méthode inconnue — la spec exige alors un `404` HTTP. */
  METHOD_NOT_FOUND: -32601,
  /** Paramètres absents ou mal typés. */
  INVALID_PARAMS: -32602,
  /** Échec côté serveur. */
  INTERNAL_ERROR: -32603,
} as const;

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

/** Identifiant d'une requête JSON-RPC (jamais `null` pour une requête). */
export type JsonRpcId = string | number;

/** Message entrant : requête (avec `id`) ou notification (sans `id`). */
export interface IJsonRpcMessage {
  jsonrpc?: unknown;
  id?: unknown;
  method?: unknown;
  params?: unknown;
}

/** Réponse JSON-RPC de succès. */
export interface IJsonRpcSuccess {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result: unknown;
}

/** Réponse JSON-RPC d'erreur. */
export interface IJsonRpcFailure {
  jsonrpc: "2.0";
  /** `null` quand l'erreur survient avant d'avoir pu lire un `id`. */
  id: JsonRpcId | null;
  error: { code: number; message: string; data?: unknown };
}

/** Ce que le serveur MCP rend, avant traduction en réponse HTTP. */
export interface IMcpHttpReply {
  /** Statut HTTP à poser. */
  status: number;
  /**
   * Corps JSON, ou `null` pour un `202 Accepted` sans corps — la spec l'exige
   * pour une notification acceptée.
   */
  body: IJsonRpcSuccess | IJsonRpcFailure | null;
}

/** Fabrique une réponse de succès. */
export function jsonRpcSuccess(
  id: JsonRpcId,
  result: unknown,
): IJsonRpcSuccess {
  return { jsonrpc: "2.0", id, result };
}

/** Fabrique une réponse d'erreur. */
export function jsonRpcFailure(
  id: JsonRpcId | null,
  code: number,
  message: string,
  data?: unknown,
): IJsonRpcFailure {
  return {
    jsonrpc: "2.0",
    id,
    error: data === undefined ? { code, message } : { code, message, data },
  };
}

/**
 * Un message est-il une NOTIFICATION (pas d'`id`) plutôt qu'une requête ?
 *
 * La distinction commande le statut HTTP : une notification acceptée rend
 * `202` **sans corps**, une requête rend son objet JSON.
 */
export function isNotification(message: IJsonRpcMessage): boolean {
  return message.id === undefined || message.id === null;
}
