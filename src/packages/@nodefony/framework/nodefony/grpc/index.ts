/**
 * `@nodefony/framework/grpc` — déclarer un service gRPC dans un module
 * (ADR-0026 D1).
 *
 * Sous-chemin à part : le point d'entrée principal de `@nodefony/framework`
 * ne cite ni Connect ni protobuf (D12). L'importer charge Connect au
 * démarrage — ce que fait tout contrôleur gRPC, et seulement lui.
 *
 * @experimental Surface gRPC, ADR-0026 D11.
 */
export { GrpcController } from "./GrpcController";
export { GrpcService } from "./GrpcService";
export type { GrpcServiceClass } from "./GrpcService";
