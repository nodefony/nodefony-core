/**
 * `@nodefony/http/grpc` — la primitive de transport gRPC (ADR-0026).
 *
 * Sous-chemin à part : le point d'entrée principal de `@nodefony/http` ne cite
 * ni Connect ni protobuf, même en type (D12). Seule une application qui
 * déclare un service l'importe — par `@nodefony/framework/grpc` — et charge
 * alors Connect au démarrage.
 *
 * @experimental Surface gRPC, ADR-0026 D11.
 */
export { GrpcCall, hasAbort } from "./GrpcCall";
export type { IAbortableHandlerContext } from "./GrpcCall";
export { GrpcEndpoint } from "./GrpcEndpoint";
export type {
  IGrpcEndpointOptions,
  IGrpcProtocols,
  IGrpcSettings,
} from "./GrpcEndpoint";
export { markGrpcRoute } from "../src/grpc/refusal";
