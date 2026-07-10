import { defineNodefonyRolldownConfig } from "../../../../rolldown.shared.ts";

export default defineNodefonyRolldownConfig({
  external: [
    "nodefony",
    "tslib",
    "@nodefony/orm-core",
    "@node-rs/bcrypt",
    "@node-rs/argon2",
  ],
});
