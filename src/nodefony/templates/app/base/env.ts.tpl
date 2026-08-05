import { defineEnv, envEnum, envNumber<% if (it.complete || it.front) { %>, envString<% } %> } from "nodefony";

/**
 * Catalogue typé des variables d'environnement — SEUL lecteur de `process.env`.
 * Validé au boot (fail-fast), exposé au descripteur de config via `ctx.env`.
<% if (it.complete) { %> *
 * 💾 PERSISTANCE (infra déclarée) : tu déclares une ou deux URLs, le framework
 * DÉRIVE les stores (users, sessions, jetons, idempotence…) — `store: "auto"`.
<% } %> */
export const env = defineEnv({
  /**
   * Port d'écoute HTTP. Absent = défaut du framework (5151). Le déclarer est le
   * cas du DÉPLOIEMENT : le port y est un contrat (service k8s, ingress, sonde).
   * En dev, ne rien mettre : si 5151 est déjà pris (une autre app Nodefony),
   * le framework prend le port libre suivant et l'ANNONCE (`portPolicy: "auto"`,
   * défaut hors production) — en production il échoue franchement (`strict`),
   * car un pod qui écoute ailleurs en silence est un pod injoignable.
   */
  NF_PORT: envNumber({
    optional: true,
    description: "Port d'écoute HTTP (défaut framework 5151).",
  }),

  /**
   * Alias PLATEFORME : Cloud Run, Heroku, Railway et Fly injectent `PORT` et
   * exigent que le process écoute dessus. On l'accepte tel quel — zéro glue de
   * déploiement. `NF_PORT` l'emporte si les deux sont présents.
   */
  PORT: envNumber({
    optional: true,
    description: "Alias plateforme du port HTTP (Cloud Run/Heroku) — NF_PORT gagne.",
  }),

  /**
   * Port d'écoute HTTPS/HTTP2 (défaut framework 5152). Pas d'alias plateforme :
   * en cloud, le TLS est terminé à l'ingress et le pod sert en clair.
   */
  NF_PORT_HTTPS: envNumber({
    optional: true,
    description: "Port d'écoute HTTPS/HTTP2 (défaut framework 5152).",
  }),

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
<% } %><% if (it.complete || it.front) { %>
  /**
   * Origine PUBLIQUE du dev-server Vite — celle que le NAVIGATEUR utilise
   * quand elle diffère de l'adresse d'écoute : dev dans un conteneur
   * (`https://host.docker.internal:{port}` — `{port}` suit le port réel),
   * tunnel, machine distante. ABSENTE = dérivation locale (le cas nominal) ;
   * Codespaces/Gitpod se détectent automatiquement. Consommée par
   * `use("@nodefony/frontend", { publicOrigin })` dans `nodefony.config.ts`.
   */
  NF_FRONTEND_PUBLIC_ORIGIN: envString({
    optional: true,
    description:
      "Origine publique Vite (scheme://host[:port|:{port}]) — dev déporté/conteneur.",
  }),
<% } %>});
