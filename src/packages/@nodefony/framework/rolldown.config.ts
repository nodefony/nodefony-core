import { defineNodefonyRolldownConfig } from "../../../../rolldown.shared";

export default defineNodefonyRolldownConfig({
  external: [
    "nodefony",
    "@nodefony/http",
    "@nodefony/security",
    "eta",
    "graphql",
    "@graphql-tools/merge",
    "@graphql-tools/schema",
    "tslib",
    "zod",
  ],
});
