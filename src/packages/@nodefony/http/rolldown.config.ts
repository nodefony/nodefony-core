import { defineNodefonyRolldownConfig } from "nodefony/bundler";

export default defineNodefonyRolldownConfig({
  cleanDir: true,
  external: [
    "nodefony",
    "@nodefony/framework",
    "cookie",
    "@fastify/busboy",
    "mime",
    "ms",
    "qs",
    "serve-static",
    "ws",
    "mime-types",
    "xml2js",
    "tslib",
    "zod",
    // Pairs FACULTATIFS de gRPC (ADR-0026 D12) : jamais recopiés dans `dist`.
    "@bufbuild/protobuf",
    "@connectrpc/connect",
    "@connectrpc/connect-node",
  ],
});
