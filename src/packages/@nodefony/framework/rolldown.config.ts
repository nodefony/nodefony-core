import { defineNodefonyRolldownConfig } from "nodefony/bundler";

export default defineNodefonyRolldownConfig({
  cleanDir: true,
  external: [
    "nodefony",
    "@nodefony/http",
    "@nodefony/security",
    "eta",
    "reflect-metadata",
    "tslib",
    "zod",
    // Pairs FACULTATIFS de gRPC (ADR-0026 D12) : jamais recopiés dans `dist`.
    "@bufbuild/protobuf",
    "@connectrpc/connect",
  ],
});
