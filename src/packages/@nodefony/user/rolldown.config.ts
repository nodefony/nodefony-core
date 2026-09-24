import { defineNodefonyRolldownConfig } from "nodefony/bundler";

export default defineNodefonyRolldownConfig({
  cleanDir: true,
  external: [
    "nodefony",
    "tslib",
    "@nodefony/orm-core",
    "@node-rs/bcrypt",
    "@node-rs/argon2",
  ],
});
