import { defineEnv, envEnum, envString } from "nodefony";

/**
 * Catalogue typé des variables d'environnement — SEUL lecteur de `process.env`.
 * Validé au boot (fail-fast), exposé au descripteur de config via `ctx.env`.
 *
 * 💾 PERSISTANCE (infra déclarée) : tu déclares une ou deux URLs, le framework
 * DÉRIVE les stores (users, sessions, jetons, idempotence…) — `store: "auto"`.
 */
export const env = defineEnv({
  NF_LOG_DRIVER: envEnum(["stdout", "file", "null"] as const, {
    default: "stdout",
  }),

  /**
   * Infra `database` : URL unique, dialecte déduit du scheme
   * (`sqlite:./var/app.db` | `postgres://…` | `mysql://…` | `mongodb://…`).
   * ABSENTE = profil solo : sqlite local (l'app persiste quand même).
   * Alias plateforme accepté : `DATABASE_URL`. Secret → jamais loggée brute.
   */
  NF_DATABASE_URL: envString({
    optional: true,
    description:
      "Infra database : URL unique (sqlite:|postgres://|mysql://|mongodb://), dialecte déduit du scheme.",
  }),

  /**
   * Infra `cache` (éphémère partagé) : URL Redis. Sa présence CHARGE le module
   * `@nodefony/redis` et aiguille les briques éphémères (sessions, idempotence)
   * vers Redis. Alias plateforme accepté : `REDIS_URL`.
   */
  NF_REDIS_URL: envString({
    optional: true,
    description:
      "Infra cache : URL Redis (redis://…) — sa présence charge @nodefony/redis.",
  }),
});
