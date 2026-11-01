import { defineNodefonyRolldownConfig } from "nodefony/bundler";

export default defineNodefonyRolldownConfig({
  cleanDir: true,
  external: [
    "nodefony",
    // Sous-chemin du codec CBOR, chargé à la demande (`codec: "cbor"`) : `nodefony`
    // n'est externe qu'en correspondance exacte, il serait sinon recopié ici.
    "nodefony/cbor",
    "@nodefony/framework",
    "@nodefony/http",
    "zod",
    "reflect-metadata",
    "tslib",
  ],
});
