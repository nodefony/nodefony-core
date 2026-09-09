/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │  nodefony.config.ts — CONFIGURATION DE L'APPLICATION (le point d'entrée)   │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Tout ce qui n'est PAS écrit ici prend le défaut du framework (`defaultAppConfig`,
 * deep-mergé au boot). Commencer minuscule, grandir par composition — jamais subir
 * le découpage. Forme fonction `(ctx) => …` pour différencier par environnement.
 *
 * `ctx` = { env, appEnv, runtimeEnv, isProd, isDev, isTest } — `ctx.env` est le
 * catalogue typé de `./env.ts`.
 *
 * ── 6 RECETTES (pour faire grandir cette config) ──────────────────────────────
 *  1. Ajouter un module        → ajouter son nom dans `modules`.
 *  2. Configurer un module      → `use("@nodefony/security", { firewalls: {…} })`.
 *  3. Module dev/conditionnel   → `{ name, policy: "dev" }` ou `use(n, c, { when })`.
 *  4. Réglage par-env           → tester `ctx.isProd` / `ctx.isDev` (déjà utilisé ci-dessous).
 *  5. Lire une var d'env        → la déclarer dans `./env.ts`, lire `ctx.env.X` (jamais `process.env`).
 *  6. Configurer un module      → un fichier `nodefony/config/<module>.ts` exportant
 *                                 `(ctx) => ({ … }) satisfies I<Module>ConfigInput`, importé ici.
 *                                 Le `satisfies` n'est PAS décoratif : sans lui, une clé inconnue
 *                                 compile puis est retirée EN SILENCE au boot — `nodefony doctor`
 *                                 refuse un fragment qui s'en passe. Ce fichier-ci reste l'INDEX :
 *                                 quels modules, dans quel ordre, sous quelle politique.
 *
 * Voir toutes les options + défauts : onglet Configuration de Studio (`/nodefony`).
 */
import { defineConfig, use } from "nodefony";
import type { env } from "./env";
// Les blocs de configuration, un fichier par module — l'emplacement d'extraction
// du framework (recette 6 ci-dessus). Ce fichier reste l'INDEX ordonné : ce qui
// est monté, dans quel ordre, sous quelle politique.
import { httpConfig } from "./nodefony/config/http";
import { frameworkConfig } from "./nodefony/config/framework";
import { realtimeConfig } from "./nodefony/config/realtime";
import { securityConfig } from "./nodefony/config/security";
import { studioConfig } from "./nodefony/config/studio";
import { devkitConfig } from "./nodefony/config/devkit";

// ── Registre de config des modules — À GARDER ────────────────────────────────
// Ces ré-exports n'existent QUE pour faire entrer dans ce programme TypeScript
// l'augmentation `declare module "nodefony"` que chaque module publie. Sans
// elles, `use("@nodefony/x", { … })` retombe sur `Record<string, unknown>` :
// une clé mal orthographiée COMPILE, puis Zod la retire EN SILENCE au boot et
// le module démarre sur son défaut — le défaut `trustProxi` en grand.
//
// Pourquoi un ré-export et pas autre chose :
//  - `import type { X }` seul → TS6133 ici (`noUnusedLocals`) ; un ré-export
//    EST une utilisation, donc il passe partout, avec ou sans ce réglage.
//  - `import type {}` → refusé par `oxlint --deny-warnings`.
//  - `/// <reference types="…" />` → TS2688 sur les modules dont les types
//    pointent une source (`http`, `framework`, `security` dans ce dépôt).
// Le ré-export est le seul mécanisme qui vaut pour les DEUX mondes : ce dépôt
// et une application qui installe les paquets depuis npm.
//
// Y AJOUTER une ligne en montant un module dont on configure les clés.
export type { IHttpConfigInput } from "@nodefony/http";
export type { IFrameworkConfigInput } from "@nodefony/framework";
export type { ISecurityConfigInput } from "@nodefony/security";
export type { IDrizzleConfigInput } from "@nodefony/drizzle";
export type { IRealtimeConfigInput } from "@nodefony/realtime";
export type { IRedisConfigInput } from "@nodefony/redis";
export type { IFrontendConfigInput } from "@nodefony/frontend";
export type { IDocumentationConfigInput } from "@nodefony/documentation";
export type { IStudioConfigInput } from "@nodefony/studio";
export type { IDevkitConfigInput } from "@nodefony/devkit";

/** Type du catalogue d'env → `ctx.env` typé + auto-complété dans la fonction de config. */
type Env = typeof env;

export default defineConfig<Env>((ctx) => ({
  // ── Identité de l'application (affichée dans la CLI et les logs d'init) ──────
  App: {
    projectYear: "2024",
    authorName: "Camensuli Christophe",
    authorMail: "ccamensuli@gmail.com",
  },

  // ── Réseau ──────────────────────────────────────────────────────────────────
  // Domaine d'écoute (un seul, pas de vhost). Prod = toutes interfaces (0.0.0.0,
  // derrière l'ingress) ; dev = loopback. `NF_BIND_ALL=1` (dev) force 0.0.0.0 pour
  // exposer le serveur au banc reverse-proxy Docker (conteneurs).
  domain: ctx.isProd || ctx.env.NF_BIND_ALL ? "0.0.0.0" : "127.0.0.1",
  // Active la barrière Host kernel-level (anti Host-header injection) : un Host
  // entrant doit matcher la liste `trustedHosts` du module http. (`domainAlias`
  // legacy retiré — `trustedHosts` est l'unique allowlist consommée.)
  domainCheck: true,

  // ── Ports d'écoute ──────────────────────────────────────────────────────────
  // Les clés ne sont émises QUE si l'environnement les déclare : sans elles, les
  // défauts du framework s'appliquent (HTTP 5151, HTTPS 5152 en HTTP/2) — on ne
  // retape jamais un défaut, sinon il existe à deux endroits et diverge.
  //
  // POURQUOI passer par l'env plutôt que d'écrire un port en dur ici : le port est
  // une propriété du DÉPLOIEMENT, pas du code. En PaaS (Cloud Run, Heroku, Railway)
  // la plateforme IMPOSE son port via `PORT` — un port en dur = pod qui écoute là où
  // personne n'appelle. En dev on ne déclare rien : `portPolicy` vaut `auto` (défaut
  // hors prod/test) → deux apps Nodefony cohabitent, le décalage de port est ANNONCÉ
  // et publié pour `nodefony status`/`stop`. En prod/test, `portPolicy` vaut `strict` :
  // un port occupé est un échec franc (le port est un CONTRAT : service, ingress, sonde).
  // Forcer la politique : `servers: { portPolicy: "strict" }`.
  servers: {
    ...((ctx.env.NF_PORT ?? ctx.env.PORT)
      ? { http: { port: ctx.env.NF_PORT ?? ctx.env.PORT } }
      : {}),
    ...(ctx.env.NF_PORT_HTTPS
      ? { https: { port: ctx.env.NF_PORT_HTTPS } }
      : {}),
  },

  // ── Observabilité ─────────────────────────────────────────────────────────
  log: {
    // dev : tout en DEBUG ; prod : aucun DEBUG (INFO+ seulement).
    debug: ctx.isProd ? [] : "*",
    // Sink d'écriture + relecture du backplane — pilotés par l'environnement (./env).
    driver: ctx.env.NF_LOG_DRIVER,
    file: { sync: ctx.env.NF_LOG_FILE_SYNC },
    queryDriver: ctx.env.NF_LOG_QUERY_DRIVER,
    // Destinations PROD (LB.4) : montées seulement si l'URL est fournie ET que
    // `queryDriver` vaut leur nom (sinon fallback "memory" au boot, jamais de crash).
    ...(ctx.env.NF_LOKI_URL ? { loki: { url: ctx.env.NF_LOKI_URL } } : {}),
    ...(ctx.env.NF_OPENSEARCH_URL
      ? { opensearch: { url: ctx.env.NF_OPENSEARCH_URL } }
      : {}),
  },

  // ── Topologie / cluster (cloud-native, sans PM2) ────────────────────────────
  // La topologie (nombre de workers) vit dans `nodefony/config/cluster/cluster.config.ts`
  // (fichier kernel-free) : le process MASTER le lit STANDALONE, AVANT de booter le
  // moindre Kernel, pour décider du fork. Le Kernel booté ne lit pas ce champ → inutile
  // de le dupliquer ici. Override runtime : CLI `--workers` > `NF_WORKERS` > ce fichier.

  // ── Modules de l'application ────────────────────────────────────────────────
  // ⚠️ L'ORDRE = ordre (priorité) de chargement. Invariants réels — ne pas réordonner :
  //   - realtime APRÈS framework (se greffe via AdminBroker avant mountAll)
  //   - frontend AVANT ses consumers (mediasoup, test-frontend-*)
  //   - documentation AVANT studio (le front Studio consomme /nodefony/documentation/api/*)
  // Policies : `mandatory` (socle, jamais gaté) · `optional` (défaut, gaté par `when`)
  //          · `dev` (chargé hors production). `use(name, config, opts)` colocalise
  // la config d'un module avec son chargement (typage par module via le registre).
  modules: [
    // ── ORM — Drizzle (SQL) par défaut. Le gating par driver (when c.orm?.driver)
    //    arrivera avec la suite du virage ORM (Mongoose refait sur le modèle Service).
    "@nodefony/drizzle",

    // ── Socle serveur — toujours présent (web + routing + sécurité).
    use("@nodefony/http", httpConfig(ctx), { policy: "mandatory" }),
    // Routeur, contrôleurs, plan d'administration — socle, comme http.
    use("@nodefony/framework", frameworkConfig(ctx), { policy: "mandatory" }),

    // Realtime APRÈS framework : il se greffe via l'AdminBroker avant `mountAll`.
    use("@nodefony/realtime", realtimeConfig()),

    // Sécurité applicative (P6) — requise dès qu'on sert du trafic.
    use("@nodefony/security", securityConfig(ctx), { policy: "mandatory" }),

    // ── Démo / tests d'intégration — hors production.
    { name: "@nodefony/test", policy: "dev" },

    // Frontend AVANT ses consumers. Ce que Vite ÉCOUTE et ce que le NAVIGATEUR
    // appelle restent deux choses distinctes — mais la seconde se DÉRIVE
    // désormais du `Host` de chaque requête : le poste (`127.0.0.1`) et un
    // navigateur en conteneur (`host.docker.internal`) chargent la même page,
    // en même temps, sans rien à configurer. Codespaces/Gitpod se détectent
    // toujours seuls. `publicOrigin` reste disponible pour un tunnel ou un
    // proxy frontal — c'est alors un réglage durable, qui gagne sur la
    // dérivation, jamais un décor d'observation qu'on oublierait de retirer.
    { name: "@nodefony/frontend" },
    { name: "@nodefony/test-frontend-react", policy: "dev" },
    { name: "@nodefony/test-frontend-vue", policy: "dev" },
    { name: "@nodefony/test-frontend-angular", policy: "dev" },
    { name: "@nodefony/test-frontend-svelte", policy: "dev" },
    { name: "@nodefony/mediasoup", policy: "dev" },

    // ── Doc transverse AVANT Studio.
    "@nodefony/documentation",

    // Studio admin — console d'administration du framework.
    use("@nodefony/studio", studioConfig(ctx), { policy: "mandatory" }),

    // ── Accès Redis générique — chargé par la DÉCLARATION de l'infra cache :
    //    `NF_REDIS_URL` présente ⇔ module chargé (un seul signal, pas de magie
    //    localhost). Consommateurs cross-pod : backplane realtime `redis`,
    //    stores `redis` (idempotence, sessions, tokens). Demander un store
    //    `redis` SANS déclarer `NF_REDIS_URL` = échec franc à la résolution
    //    (fail-loud), jamais de connexion implicite.
    use("@nodefony/redis", undefined, {
      when: () => !!ctx.infra.cache,
    }),

    // ── Exemple : module NoSQL Mongoose (non chargé par défaut). Décommenter ICI
    //    pour l'activer, avec sa config colocalisée :
    // use("@nodefony/mongoose", {
    //   debug: true,
    //   connectors: {
    //     nodefony: {
    //       host: "localhost",
    //       port: 27017,
    //       dbname: "nodefony",
    //       options: { user: "nodefony", pass: "nodefony", maxPoolSize: 50 },
    //     },
    //   },
    // }),

    /**
     * Outillage de DÉVELOPPEMENT : carte de visite de l'application et portes de
     * découverte pour un agent.
     *
     * `policy: "dev"` — ce qu'il expose (modules chargés, chemins de doc, verbes
     * à lancer) aide pendant le développement et n'est, en production, qu'une
     * divulgation. Un module non chargé n'est même pas importé : coût nul.
     */
    use("@nodefony/devkit", devkitConfig(ctx), { policy: "dev" }),
  ],
}));
