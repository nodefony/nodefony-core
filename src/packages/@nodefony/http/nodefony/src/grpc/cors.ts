import { hasGrpcRoutes } from "./refusal";

/**
 * Ce que les protocoles RPC servis (gRPC, gRPC-Web, Connect) demandent à la
 * politique CORS de l'application (ADR-0026 D9).
 *
 * @experimental Surface gRPC, ADR-0026 D11.
 */
export interface IRpcCorsLists {
  /** Méthodes que le préflight doit autoriser. */
  readonly allowedMethods: readonly string[];
  /** En-têtes de requête que le préflight doit autoriser. */
  readonly allowedHeaders: readonly string[];
  /**
   * En-têtes qu'une réponse RPC doit exposer au script de la page — sans eux,
   * un client gRPC-Web ne lit ni le statut ni l'encodage de la réponse.
   */
  readonly exposedHeaders: readonly string[];
}

/**
 * Les listes de Connect (`cors` de `@connectrpc/connect`, `connect-cors.md`),
 * recopiées : `@nodefony/http` principal ne charge jamais Connect, pair
 * facultatif (ADR-0026 D12). La copie est COMPARÉE à l'original par un test
 * (`grpcCors.test.ts`) : une version de Connect qui change ses listes le fait
 * tomber.
 */
const GRPC_CORS: IRpcCorsLists = Object.freeze({
  allowedMethods: Object.freeze(["POST", "GET"]),
  allowedHeaders: Object.freeze([
    "Content-Type",
    "Connect-Protocol-Version",
    "Connect-Timeout-Ms",
    "Connect-Content-Encoding",
    "Connect-Accept-Encoding",
    "Content-Encoding",
    "Accept-Encoding",
    "Grpc-Message-Type",
    "X-Grpc-Web",
    "X-User-Agent",
    "Grpc-Timeout",
  ]),
  exposedHeaders: Object.freeze([
    "Grpc-Status",
    "Grpc-Message",
    "Grpc-Status-Details-Bin",
    "Content-Encoding",
    "Connect-Content-Encoding",
  ]),
});

/**
 * `Access-Control-Expose-Headers` d'une réponse RPC, composé une fois au
 * chargement.
 */
export const RPC_EXPOSED_HEADERS: string = GRPC_CORS.exposedHeaders.join(", ");

/**
 * Les listes CORS que demandent les protocoles RPC — dès qu'un service gRPC
 * est déclaré dans le processus, `null` sinon. Le pare-feu les ajoute à la
 * politique de l'application au démarrage (`onReady`) : le préflight ne
 * connaît pas la route, l'union est la seule voie (ADR-0026 D9 point 2).
 *
 * @returns les listes, ou `null` sans service gRPC déclaré.
 * @experimental Surface gRPC, ADR-0026 D11.
 */
export function rpcCorsLists(): IRpcCorsLists | null {
  return hasGrpcRoutes() ? GRPC_CORS : null;
}

/**
 * Les listes de Connect telles que recopiées, sans condition — réservé au test
 * qui les compare à l'original.
 *
 * @internal
 */
export function grpcCorsCopy(): IRpcCorsLists {
  return GRPC_CORS;
}
