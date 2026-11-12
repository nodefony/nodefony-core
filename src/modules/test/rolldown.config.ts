import { defineNodefonyRolldownConfig } from "nodefony/bundler";

export default defineNodefonyRolldownConfig({
  cleanDir: true,
  external: [
    "nodefony",
    "@nodefony/ai",
    "@nodefony/http",
    "@nodefony/orm-core",
    "drizzle-orm",
    "@nodefony/drizzle",
    "@nodefony/security",
    "@nodefony/framework",
    "@nodefony/realtime",
    "@nodefony/user",
    "tslib",
    "zod",
    // gRPC (#695, ADR-0026 D12) — importés au démarrage par les contrôleurs
    // gRPC, jamais embarqués. Le préfixe couvre `@bufbuild/protobuf/wkt` et
    // `/codegenv2` (code généré), comme `@nodefony/framework` couvre `/grpc`.
    "@connectrpc/connect",
    "@connectrpc/connect-node",
    "@bufbuild/protobuf",
  ],
});
