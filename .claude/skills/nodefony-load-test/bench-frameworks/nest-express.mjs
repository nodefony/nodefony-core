// NestJS 12, adaptateur Express (le défaut de Nest) — camp de #489.
import { start } from "./nest-app.mjs";

start(undefined, "nest-express").catch((/** @type {unknown} */ e) => {
  console.error(e);
  process.exit(1);
});
