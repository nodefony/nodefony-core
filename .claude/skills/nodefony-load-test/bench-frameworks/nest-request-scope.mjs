// NestJS 12, adaptateur Express, un service `Scope.REQUEST` injecté dans le
// contrôleur — qui devient alors lui-même recréé à chaque requête (volet 3 de #489).
import { start } from "./nest-app.mjs";

start(undefined, "nest-request-scope", true).catch(
  (/** @type {unknown} */ e) => {
    console.error(e);
    process.exit(1);
  },
);
