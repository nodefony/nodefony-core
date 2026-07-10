import { defineNodefonyRolldownConfig } from "../../../../rolldown.shared";

export default defineNodefonyRolldownConfig({
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
    "node-forge",
    "http-terminator",
    "mime-types",
    "xml2js",
    "tslib",
    "zod",
  ],
});
