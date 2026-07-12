import { defineEnv, envEnum<% if (it.complete) { %>, envString<% } %> } from "nodefony";

/**
 * Catalogue typé des variables d'environnement — SEUL lecteur de `process.env`.
 * Validé au boot (fail-fast), exposé au descripteur de config via `ctx.env`.
<% if (it.complete) { %> *
 * 💾 PERSISTANCE (infra déclarée) : tu déclares une ou deux URLs, le framework
 * DÉRIVE les stores (users, sessions, jetons, idempotence…) — `store: "auto"`.
<% } %> */
export const env = defineEnv({
  NF_LOG_DRIVER: envEnum(["stdout", "file", "null"] as const, {
    default: "stdout",
  }),
<% if (it.complete) { %>
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

  /**
   * 🔐 Clés de chiffrement au repos (module security) — les VALEURS vivent dans
   * `.env.local` (gitignoré), générées à la création de l'app. Rotation ou
   * rattrapage : `npx nodefony security:secrets --write`. En production :
   * Secret k8s / vault — jamais en git. Absentes en prod = la brique concernée
   * se désactive fail-safe (2FA / webhooks) avec un log CRITIC explicite.
   */
  NF_TOTP_KEY: envString({
    optional: true,
    description: "Clé de chiffrement des secrets 2FA/TOTP au repos (32 octets base64).",
  }),
  NF_WEBHOOK_KEY: envString({
    optional: true,
    description: "Clé de chiffrement des secrets de signature webhook (32 octets base64).",
  }),
  NF_CSRF_SECRET: envString({
    optional: true,
    description: "Secret des jetons anti-CSRF (synchronizer) — partagé entre process en cluster.",
  }),

  /**
   * Mot de passe du compte admin seedé au premier boot (voir
   * `nodefony/security/users.ts`). DEV : défaut `admin` (compte admin/admin,
   * comme Grafana — pratique, LOCAL uniquement). PROD : OBLIGATOIRE — sans lui
   * le seed refuse (jamais de mot de passe par défaut en production).
   */
  NF_ADMIN_PASSWORD: envString({
    optional: true,
    description: "Mot de passe du compte admin seedé au 1er boot (obligatoire en production).",
  }),
<% } %>});
