import { defineEnv, envEnum } from "nodefony";

/**
 * Catalogue typé des variables d'environnement — SEUL lecteur de `process.env`.
 * Validé au boot (fail-fast), exposé au descripteur de config via `ctx.env`.
 *
 * 💾 PERSISTANCE — déclarer l'INFRA (quand l'app doit stocker users/sessions/jetons…).
 * Tu déclares une ou deux URLs, le framework DÉRIVE les stores (cf
 * `docs/guides/persistence.md`). Ajoute `envString` à l'import ci-dessus et décommente :
 *   // NF_DATABASE_URL: envString({ optional: true }), // sqlite:./var/app.db | postgres:// | mysql:// | mongodb://
 *   // NF_REDIS_URL:    envString({ optional: true }), // redis://… → charge @nodefony/redis (sessions + cache partagés)
 * (alias plateforme `DATABASE_URL` / `REDIS_URL` acceptés out-of-the-box.)
 */
export const env = defineEnv({
  NF_LOG_DRIVER: envEnum(["stdout", "file", "null"] as const, {
    default: "stdout",
  }),
});
