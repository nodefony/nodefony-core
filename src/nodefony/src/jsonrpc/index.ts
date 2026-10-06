/**
 * JSON-RPC 2.0 — les BRIQUES du protocole, partagées par toutes ses portes.
 *
 * Le framework parle JSON-RPC par deux portes qui ne se ressemblent pas : le
 * pair temps réel (`JsonRpcPeer`, machine à état duplex sur WebSocket, des deux
 * côtés du fil) et le serveur MCP (`handleMcpMessage`, sans état, qui rend un
 * verdict HTTP). On partage ici les briques — codes, formes de message,
 * fabriques, classification d'une frame —, jamais les machines : chaque porte
 * garde sa RÉACTION à une frame invalide (le pair la jette et l'audite, le MCP
 * répond `400`).
 *
 * ⚠️ **ISOMORPHE et sans dépendance** : ce module entre dans le bundle
 * navigateur (`nodefony/client`, via `JsonRpcPeer`). Aucun import `node:`,
 * aucun conteneur, aucun journal — et il n'importe RIEN de `mcp/` ni de
 * `realtime/` : le sens des dépendances est unique, sinon le MCP entrerait dans
 * le bundle client.
 *
 * ⚠️ **Chemin chaud** : {@link classifyJsonRpcFrame} et les fabriques sont
 * appelés pour CHAQUE frame du temps réel. Zéro allocation hors la frame
 * elle-même, zéro fermeture, formes d'objet constantes (un seul littéral par
 * fabrique).
 *
 * @see https://www.jsonrpc.org/specification
 */

/** Valeur exacte du membre `jsonrpc` (JSON-RPC 2.0 §4 : « MUST be exactly "2.0" »). */
export const JSON_RPC_VERSION = "2.0";

/** Les cinq codes d'erreur que JSON-RPC 2.0 §5.1 définit. */
export const JsonRpcError = {
  /** JSON illisible — le texte reçu ne se parse pas. */
  PARSE_ERROR: -32700,
  /** JSON lisible, mais qui n'est pas un objet requête JSON-RPC 2.0 valide. */
  INVALID_REQUEST: -32600,
  /** Méthode inconnue (le MCP exige alors un `404` HTTP). */
  METHOD_NOT_FOUND: -32601,
  /** Paramètres absents ou mal typés. */
  INVALID_PARAMS: -32602,
  /** Échec interne du serveur. */
  INTERNAL_ERROR: -32603,
} as const;

/**
 * La plage `-32000…-32099` que JSON-RPC 2.0 §5.1 réserve aux erreurs serveur
 * définies par l'implémentation.
 *
 * ⚠️ Le MCP la PARTITIONNE (révision 2026-07-28, `basic/index.mdx`) :
 * `-32000…-32019` est héritée (aucun nouveau code ne doit y être alloué, et un
 * récepteur n'y présume aucun sens hormis `-32002`), `-32020…-32099` est
 * réservée à la spécification MCP — une implémentation n'y émet QUE les codes
 * qu'elle définit. Un code applicatif destiné à une porte MCP ne se choisit
 * donc pas librement dans cette plage. Le temps réel n'est pas soumis au MCP.
 */
export const JsonRpcServerError = {
  /** Erreur serveur générique — la première de la plage, défaut de `RpcError`. */
  DEFAULT: -32000,
  /** Borne basse de la plage. */
  MIN: -32099,
  /** Borne haute de la plage. */
  MAX: -32000,
} as const;

/**
 * Identifiant d'une requête : chaîne ou nombre (JSON-RPC 2.0 §4).
 *
 * `null` est permis par JSON-RPC mais « découragé », et INTERDIT par le MCP ;
 * il est réservé ici aux réponses d'erreur dont l'`id` n'a pas pu être lu.
 */
export type JsonRpcId = string | number;

/** Objet `error` d'une réponse (JSON-RPC 2.0 §5.1). */
export interface IJsonRpcErrorObject {
  /** Entier — standard (§5.1) ou applicatif. */
  code: number;
  /** Description courte, une phrase. */
  message: string;
  /** Détail libre ; ABSENT du fil quand il n'est pas donné. */
  data?: unknown;
}

/** Requête : attend une réponse portant le même `id`. */
export interface IJsonRpcRequest {
  jsonrpc: "2.0";
  id: JsonRpcId;
  method: string;
  params?: unknown;
}

/** Notification : aucune réponse n'est due (pas d'`id`). */
export interface IJsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

/** Réponse de succès. */
export interface IJsonRpcSuccess {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result: unknown;
}

/** Réponse d'erreur. */
export interface IJsonRpcFailure {
  jsonrpc: "2.0";
  /** `null` quand l'erreur survient avant d'avoir pu lire un `id`. */
  id: JsonRpcId | null;
  error: IJsonRpcErrorObject;
}

/**
 * Message ENTRANT, tel qu'il arrive du réseau : rien n'y est garanti.
 *
 * C'est le type d'entrée d'une porte, avant {@link classifyJsonRpcFrame} — d'où
 * des membres tous `unknown`.
 */
export interface IJsonRpcMessage {
  jsonrpc?: unknown;
  id?: unknown;
  method?: unknown;
  params?: unknown;
  /** Présent sur une réponse — qu'une porte serveur doit pouvoir refuser. */
  result?: unknown;
  /** Présent sur une réponse d'erreur. */
  error?: unknown;
}

/**
 * Nature d'une frame entrante, telle que JSON-RPC 2.0 la définit.
 *
 * - `request` — `method` chaîne et `id` chaîne ou nombre ;
 * - `notification` — `method` chaîne, sans membre `id` ;
 * - `response` — sans `method`, `id` chaîne ou nombre, et EXACTEMENT un des
 *   membres `result` / `error` (`error` bien formé) ;
 * - `invalid` — tout le reste, dont un lot (tableau), un `jsonrpc` absent ou
 *   différent de `"2.0"`, un `id` `null`, objet ou booléen.
 */
export type JsonRpcFrameKind =
  "request" | "notification" | "response" | "invalid";

/**
 * La valeur est-elle un identifiant de requête valide (chaîne ou nombre) ?
 *
 * @param value - membre `id` lu sur une frame
 * @returns `true` pour une chaîne ou un nombre — jamais pour `null`
 */
export function isJsonRpcId(value: unknown): value is JsonRpcId {
  return typeof value === "string" || typeof value === "number";
}

/**
 * La valeur est-elle un objet `error` bien formé (code ENTIER, message chaîne) ?
 *
 * @param value - membre `error` lu sur une frame
 * @returns `true` si la forme est conforme à JSON-RPC 2.0 §5.1
 */
export function isJsonRpcErrorObject(
  value: unknown,
): value is IJsonRpcErrorObject {
  if (value === null || typeof value !== "object") return false;
  const error = value as { code?: unknown; message?: unknown };
  return Number.isInteger(error.code) && typeof error.message === "string";
}

/**
 * Classe une frame entrante DÉJÀ PARSÉE — le prédicat que partagent toutes les
 * portes JSON-RPC du framework.
 *
 * Il ne dit que ce que JSON-RPC 2.0 permet ; la RÉACTION à une frame `invalid`
 * reste à chaque porte. Il ne juge pas `params` : le temps réel transporte des
 * charges arbitraires, une porte plus stricte le vérifie elle-même.
 *
 * Coût : lectures de propriétés seules — aucune allocation.
 *
 * @param frame - valeur issue de `JSON.parse`, ou toute autre valeur
 * @returns la nature de la frame (cf {@link JsonRpcFrameKind})
 */
export function classifyJsonRpcFrame(frame: unknown): JsonRpcFrameKind {
  if (frame === null || typeof frame !== "object") return "invalid";
  // Un tableau (un lot, §6) n'a pas de membre `jsonrpc` : il tombe ici.
  const f = frame as {
    jsonrpc?: unknown;
    id?: unknown;
    method?: unknown;
    error?: unknown;
  };
  if (f.jsonrpc !== JSON_RPC_VERSION) return "invalid";
  const id = f.id;
  const method = f.method;
  if (method !== undefined) {
    if (typeof method !== "string") return "invalid";
    if (id === undefined) return "notification";
    return isJsonRpcId(id) ? "request" : "invalid";
  }
  if (!isJsonRpcId(id)) return "invalid";
  // `result: null` est un succès légitime : la présence se lit sur la CLÉ.
  const hasResult = "result" in f;
  const error = f.error;
  if (error === undefined) return hasResult ? "response" : "invalid";
  // §5 : « Either the result member or error member MUST be included, but
  // both members MUST NOT be included. »
  if (hasResult) return "invalid";
  return isJsonRpcErrorObject(error) ? "response" : "invalid";
}

/**
 * Fabrique une requête.
 *
 * `params` reste une clé de l'objet même quand il vaut `undefined` : la forme
 * est constante, et `JSON.stringify` l'omet du fil.
 *
 * @param id - identifiant de corrélation
 * @param method - nom de la méthode
 * @param params - charge ; absente du fil si `undefined`
 * @returns la frame, prête à sérialiser
 */
export function jsonRpcRequest(
  id: JsonRpcId,
  method: string,
  params?: unknown,
): IJsonRpcRequest {
  return { jsonrpc: JSON_RPC_VERSION, id, method, params };
}

/**
 * Fabrique une notification (aucune réponse attendue).
 *
 * @param method - nom de la méthode (pour un canal temps réel : son nom)
 * @param params - charge ; absente du fil si `undefined`
 * @returns la frame, prête à sérialiser
 */
export function jsonRpcNotification(
  method: string,
  params?: unknown,
): IJsonRpcNotification {
  return { jsonrpc: JSON_RPC_VERSION, method, params };
}

/**
 * Fabrique une réponse de succès.
 *
 * Une action qui ne rend RIEN répond `result: null` : `result` est REQUIS sur
 * un succès (§5), et `undefined` disparaîtrait à la sérialisation — la frame
 * reçue ne serait plus une réponse, et l'appelant attendrait son délai.
 *
 * @param id - l'`id` de la requête, à l'identique (§5)
 * @param result - valeur rendue ; `undefined` devient `null`
 * @returns la frame, prête à sérialiser
 */
export function jsonRpcSuccess(
  id: JsonRpcId,
  result: unknown,
): IJsonRpcSuccess {
  return {
    jsonrpc: JSON_RPC_VERSION,
    id,
    result: result === undefined ? null : result,
  };
}

/**
 * Fabrique une réponse d'erreur — `data` n'apparaît que s'il est donné.
 *
 * @param id - l'`id` de la requête, ou `null` s'il n'a pas pu être lu (§5)
 * @param code - entier, standard ({@link JsonRpcError}) ou applicatif
 * @param message - description courte
 * @param data - détail libre
 * @returns la frame, prête à sérialiser
 */
export function jsonRpcFailure(
  id: JsonRpcId | null,
  code: number,
  message: string,
  data?: unknown,
): IJsonRpcFailure {
  return {
    jsonrpc: JSON_RPC_VERSION,
    id,
    error: data === undefined ? { code, message } : { code, message, data },
  };
}

/**
 * Un message est-il une NOTIFICATION — un appel SANS membre `id` ?
 *
 * Un `id` présent, même `null`, n'en fait pas une notification : JSON-RPC 2.0
 * lit `id: null` comme une requête (découragée), le MCP l'interdit. Pour savoir
 * si le message est VALIDE, c'est {@link classifyJsonRpcFrame} qui tranche.
 *
 * @param message - message entrant
 * @returns `true` si le message n'a pas d'`id`
 */
export function isNotification(message: IJsonRpcMessage): boolean {
  return message.id === undefined;
}
