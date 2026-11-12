import type http from "node:http";

/**
 * Refus d'un appel gRPC au format de son protocole (ADR-0026 D5 point 2, D13
 * point 2). Sans Connect : une application sans service gRPC charge ce module
 * avec le noyau, et n'y paie rien tant qu'aucune erreur n'est rendue.
 *
 * Le protocole se reconnaît aux en-têtes de la requête et se code en petit
 * entier (`GRPC_WIRE_*`, 0 = aucun) : une valeur toujours du même type, lue
 * sur le chemin d'erreur seulement.
 */

/** Requête qui ne parle aucun protocole gRPC. */
export const GRPC_WIRE_NONE = 0;
/** gRPC natif (`application/grpc`, `application/grpc+proto`…). */
export const GRPC_WIRE_GRPC = 1;
/** gRPC-Web (`application/grpc-web`, `application/grpc-web-text`…). */
export const GRPC_WIRE_WEB = 2;
/** Connect unaire (`connect-protocol-version`, ou GET `?connect=v1`). */
export const GRPC_WIRE_CONNECT = 3;
/** Connect en flux (`application/connect+proto`, `application/connect+json`). */
export const GRPC_WIRE_CONNECT_STREAM = 4;

/** Le protocole gRPC d'une requête, `GRPC_WIRE_NONE` s'il n'y en a aucun. */
export type GrpcWire =
  | typeof GRPC_WIRE_NONE
  | typeof GRPC_WIRE_GRPC
  | typeof GRPC_WIRE_WEB
  | typeof GRPC_WIRE_CONNECT
  | typeof GRPC_WIRE_CONNECT_STREAM;

/** `"application/".length` : le sous-type commence là. */
const SUBTYPE = 12;
const PLUS = 43;
const SEMICOLON = 59;
const SPACE = 32;
const HYPHEN = 45;

/** Le sous-type s'arrête ici : fin, suffixe `+codec`, paramètre, espace. */
function endsSubtype(code: number): boolean {
  return (
    Number.isNaN(code) || code === PLUS || code === SEMICOLON || code === SPACE
  );
}

/**
 * Reconnaît le protocole gRPC d'une requête à ses en-têtes : `content-type`
 * d'abord, puis `connect-protocol-version`. Une API JSON ordinaire rend
 * `GRPC_WIRE_NONE`.
 *
 * @param headers - les en-têtes de la requête.
 * @param connectGet - `true` pour un GET qui porte `connect=v1` (Connect
 *   unaire en GET, sans en-tête propre).
 * @returns le protocole reconnu.
 */
export function grpcWireOf(
  headers: http.IncomingHttpHeaders,
  connectGet: boolean = false,
): GrpcWire {
  const type = headers["content-type"];
  if (type?.startsWith("application/") === true) {
    if (type.startsWith("grpc", SUBTYPE)) {
      const next = type.charCodeAt(SUBTYPE + 4);
      if (endsSubtype(next)) return GRPC_WIRE_GRPC;
      if (next === HYPHEN && type.startsWith("-web", SUBTYPE + 4)) {
        const after = type.charCodeAt(SUBTYPE + 8);
        // `-text` : `application/grpc-web-text`.
        if (endsSubtype(after) || after === HYPHEN) return GRPC_WIRE_WEB;
      }
      return GRPC_WIRE_NONE;
    }
    if (type.startsWith("connect+", SUBTYPE)) return GRPC_WIRE_CONNECT_STREAM;
  }
  if (headers["connect-protocol-version"] !== undefined || connectGet) {
    return GRPC_WIRE_CONNECT;
  }
  return GRPC_WIRE_NONE;
}

/**
 * Noms des codes gRPC (`google-rpc-code.proto`), en minuscules comme Connect
 * les écrit, indexés par le code : un accès direct, aucune table de hachage.
 */
const CODE_NAMES: readonly string[] = Object.freeze([
  "ok",
  "cancelled",
  "unknown",
  "invalid_argument",
  "deadline_exceeded",
  "not_found",
  "already_exists",
  "permission_denied",
  "resource_exhausted",
  "failed_precondition",
  "aborted",
  "out_of_range",
  "unimplemented",
  "internal",
  "unavailable",
  "data_loss",
  "unauthenticated",
]);

/** Les codes en texte décimal, pour l'en-tête `grpc-status` : aucune conversion par refus. */
const CODE_TEXTS: readonly string[] = Object.freeze(
  CODE_NAMES.map((_name, code) => String(code)),
);

/** 16 `UNAUTHENTICATED`. */
export const GRPC_UNAUTHENTICATED = 16;
/** 7 `PERMISSION_DENIED`. */
export const GRPC_PERMISSION_DENIED = 7;

/**
 * Le nom d'un code gRPC (`unimplemented`, `unauthenticated`…) — le libellé
 * générique d'un refus (ADR-0026 D5 point 4).
 *
 * @param code - le code gRPC, de 0 à 16.
 * @returns son nom ; `unknown` hors de la plage.
 */
export function grpcCodeName(code: number): string {
  return CODE_NAMES[code] ?? "unknown";
}

/**
 * Les mêmes noms tels que les écrivent `google/rpc/code.proto` et les
 * conventions OpenTelemetry (`rpc.status_code`) : `OK`, `UNAVAILABLE`… Tirés
 * une fois, au chargement, de {@link CODE_NAMES} — une seule liste.
 */
const STATUS_NAMES: readonly string[] = Object.freeze(
  CODE_NAMES.map((name) => name.toUpperCase()),
);

/**
 * Le nom d'un code gRPC tel que le publient la ligne d'accès et le canal de
 * traçage (`UNAVAILABLE`) — ADR-0026 D10 point 1.
 *
 * @param code - le code gRPC, de 0 à 16.
 * @returns son nom ; `UNKNOWN` hors de la plage.
 */
export function grpcStatusName(code: number): string {
  return STATUS_NAMES[code] ?? "UNKNOWN";
}

/**
 * Le code gRPC d'un refus de transport — rendu avant l'implémentation (chemin
 * inconnu, méthode refusée, limite de débit, pare-feu) — en gRPC natif et en
 * gRPC-Web (ADR-0026 D13 point 2). Distincte de la table des erreurs de
 * l'application (D7) ; seule la règle d'identité de 401/403 est commune (D5).
 *
 * @param status - le statut HTTP que le noyau aurait rendu.
 * @param identified - un appelant authentifié est connu.
 * @returns le code gRPC.
 */
export function transportRefusalCode(
  status: number,
  identified: boolean,
): number {
  switch (status) {
    case 400:
      return 13;
    case 401:
    case 403:
      return identified ? GRPC_PERMISSION_DENIED : GRPC_UNAUTHENTICATED;
    case 404:
    case 405:
      return 12;
    case 421:
    case 429:
    case 502:
    case 503:
    case 504:
      return 14;
    default:
      return 2;
  }
}

/**
 * Le code gRPC d'une erreur levée par l'APPLICATION pendant un appel — une
 * `HttpError` d'un service partagé avec des routes HTTP, une validation, un
 * conflit (ADR-0026 D7, table « HTTP Mapping » de `google/rpc/code.proto`).
 * Distincte de la table des refus de transport ({@link transportRefusalCode}) :
 * un 404 levé par un service dit « entité introuvable » (5), un chemin inconnu
 * dit « méthode absente » (12). Seule la règle d'identité de 401/403 est
 * commune (D5).
 *
 * `code.proto` associe 409 à `ABORTED` et à `ALREADY_EXISTS` : `ABORTED`, le
 * sens le plus large, est retenu ; `ALREADY_EXISTS` se lève en `ConnectError`.
 *
 * @param status - le statut HTTP que rendrait une route HTTP.
 * @param identified - un appelant authentifié est connu.
 * @returns le code gRPC.
 */
export function applicationErrorCode(
  status: number,
  identified: boolean,
): number {
  switch (status) {
    case 400:
    case 422:
      return 3;
    case 401:
    case 403:
      return identified ? GRPC_PERMISSION_DENIED : GRPC_UNAUTHENTICATED;
    case 404:
      return 5;
    case 409:
      return 10;
    case 412:
      return 9;
    case 413:
    case 429:
      return 8;
    case 499:
      return 1;
    case 501:
      return 12;
    case 502:
    case 503:
      return 14;
    case 408:
    case 504:
      return 4;
    default:
      return status >= 500 && status <= 599 ? 13 : 2;
  }
}

/**
 * Le code d'un refus en protocole Connect : celui qu'un client DÉDUIT du
 * statut HTTP (`connect-protocol.md`, « HTTP to Error Code »), puisque le
 * statut voyage avec la réponse et doit s'accorder au code. 405 et 421 y
 * valent donc `unknown` (ADR-0026 D13, précision du lot 3) ; 401/403 suivent
 * la règle d'identité (D5).
 *
 * @param status - le statut HTTP du refus.
 * @param identified - un appelant authentifié est connu.
 * @returns le code gRPC.
 */
export function connectRefusalCode(
  status: number,
  identified: boolean,
): number {
  switch (status) {
    case 400:
      return 13;
    case 401:
    case 403:
      return identified ? GRPC_PERMISSION_DENIED : GRPC_UNAUTHENTICATED;
    case 404:
      return 12;
    case 429:
    case 502:
    case 503:
    case 504:
      return 14;
    default:
      return 2;
  }
}

/** Ce que le refus touche de la réponse : son statut et ses en-têtes. */
export interface IGrpcRefusalTarget {
  setStatusCode(status: number, message?: string): void;
  setHeader(name: string, value: string): void;
}

/** Drapeau d'un message de fin de flux Connect (`connect-protocol.md`). */
const CONNECT_END_STREAM = 0x02;

/**
 * Pose le statut et les en-têtes d'un refus au format du protocole, et rend
 * le corps à envoyer — vide en gRPC et gRPC-Web, dont le statut voyage dans
 * les en-têtes (_Trailers-Only_ ; en HTTP/2, `Http2Response.writeHead` termine
 * alors le flux sur la trame d'en-têtes).
 *
 * | Protocole       | Statut HTTP                    | Corps                                  |
 * | --------------- | ------------------------------ | -------------------------------------- |
 * | gRPC, gRPC-Web  | 200                            | aucun                                  |
 * | Connect unaire  | celui du refus (401/403 : D5)  | `{"code":"<nom>"}`                     |
 * | Connect en flux | 200                            | message de fin `{"error":{…}}`         |
 *
 * Le message n'est jamais celui de l'erreur, qui nomme parfois la zone
 * refusée : seul le nom du code part (D5 point 4).
 *
 * @param response - la réponse du contexte, pas encore envoyée.
 * @param wire - le protocole de la requête, autre que `GRPC_WIRE_NONE`.
 * @param status - le statut HTTP que le noyau aurait rendu.
 * @param identified - un appelant authentifié est connu.
 * @param contentType - le `content-type` de la requête, recopié en gRPC,
 *   gRPC-Web et Connect en flux (déjà reconnu par {@link grpcWireOf}).
 * @returns le corps : texte vide, JSON, ou octets d'un message de fin.
 */
export function prepareGrpcRefusal(
  response: IGrpcRefusalTarget,
  wire: GrpcWire,
  status: number,
  identified: boolean,
  contentType: string | undefined,
): string | Uint8Array {
  if (wire === GRPC_WIRE_CONNECT) {
    const code = connectRefusalCode(status, identified);
    // L'identité peut changer le code d'un 401/403 : le statut le suit.
    const connectStatus =
      code === GRPC_UNAUTHENTICATED
        ? 401
        : code === GRPC_PERMISSION_DENIED
          ? 403
          : status;
    response.setStatusCode(connectStatus);
    response.setHeader("content-type", "application/json");
    return `{"code":"${grpcCodeName(code)}"}`;
  }
  response.setStatusCode(200, "OK");
  if (contentType !== undefined)
    response.setHeader("content-type", contentType);
  if (wire === GRPC_WIRE_CONNECT_STREAM) {
    const name = grpcCodeName(connectRefusalCode(status, identified));
    return connectEndStream(`{"error":{"code":"${name}"}}`);
  }
  const code = transportRefusalCode(status, identified);
  response.setHeader("grpc-status", CODE_TEXTS[code] ?? "2");
  response.setHeader("grpc-message", grpcCodeName(code));
  return "";
}

/**
 * Un message de fin de flux Connect : drapeau, longueur (4 octets, gros
 * boutiste), puis le JSON. Le JSON n'est fait que de noms de codes ASCII :
 * un octet par caractère, aucun encodeur.
 */
function connectEndStream(json: string): Uint8Array {
  const length = json.length;
  const frame = new Uint8Array(5 + length);
  frame[0] = CONNECT_END_STREAM;
  new DataView(frame.buffer).setUint32(1, length);
  for (let i = 0; i < length; i++) frame[5 + i] = json.charCodeAt(i);
  return frame;
}

/** Au moins une route gRPC est déclarée dans le processus. */
let grpcRoutesDeclared = false;

/**
 * Marque une route comme servie par un point d'entrée gRPC — au démarrage,
 * par `@nodefony/framework/grpc`. Allume la garde qui refuse en 12 une requête
 * gRPC native aboutie à une route qui n'est pas gRPC (ADR-0026 D13 point 3) :
 * tant qu'aucune route n'est marquée, la garde coûte une lecture de booléen.
 *
 * @param route - la route montée pour une méthode du contrat.
 * @experimental Surface gRPC, ADR-0026 D11.
 */
export function markGrpcRoute(route: { grpc?: boolean | undefined }): void {
  route.grpc = true;
  grpcRoutesDeclared = true;
}

/** `true` dès qu'une route gRPC est déclarée dans le processus. */
export function hasGrpcRoutes(): boolean {
  return grpcRoutesDeclared;
}
