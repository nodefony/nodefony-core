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
    "http-terminator",
    "mime-types",
    "xml2js",
    "tslib",
    "zod",
  ],
});
