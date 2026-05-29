/**
 * NODEFONY FRAMEWORK — Configuration KERNEL de l'application.
 *
 * Ce fichier est la source de vérité pour TOUTE l'application Nodefony :
 *   - listen domain + alias (un seul domaine — pas de vhost)
 *   - ports HTTP / HTTPS / WS / WSS
 *   - config syslog (active, debug, format des logs par requête)
 *   - templating engine, ORM par défaut, package manager
 *   - surcharges des modules (`module-http`, `module-sequelize`, etc.)
 *
 * SURCHARGE PAR ENVIRONNEMENT :
 *   Les valeurs ci-dessous sont des DEFAULTS. Pour différencier
 *   `development` / `production` / autres, utiliser :
 *     switch (kernel?.environment) { ... }
 *   ou créer des fichiers `config.production.ts` / `config.development.ts`
 *   à côté de celui-ci (chargés automatiquement par le Kernel).
 *
 * EXEMPLE DOMAIN :
 *   "0.0.0.0"      → toutes interfaces réseau (production cluster)
 *   "[::1]"        → IPv6 only
 *   "192.168.1.1"  → IP fixe spécifique
 *   "mydomain.com" → résolution DNS
 *
 * EXEMPLE DOMAIN ALIAS (nécessite `domainCheck: true`) :
 *   domainAlias: [
 *     "^127.0.0.1$",
 *     "^localhost$",
 *     ".*\\.nodefony\\.com",
 *   ]
 */
//import path from "node:path";
import { Nodefony } from "nodefony";
const kernel = Nodefony.getKernel();
import http from "./modules/http-config";
import sequelize from "./modules/sequelize-config";
// import mongoose from "./modules/mongoose-config"; // décommenter avec @nodefony/mongoose (index.ts)
import pm2 from "./pm2/pm2.config";
import cluster from "./cluster/cluster.config";
import security from "./modules/security-config";

let statics = true;
//let monitoring = true;
//let documentation = true;
//let unitTest = true;
let domainCheck = false;

switch (kernel?.environment) {
  case "production":
  case "development":
  default:
    // Note : `CDN = null;` retiré 2026-05-17 — variable globale jamais
    // déclarée (ReferenceError au boot). Legacy mort du chantier `chore(dev): clean`.
    statics = true;
    //documentation = true;
    //monitoring = true;
    //unitTest = true;
    domainCheck = true;
}
//console.log(sequelize.connectors.nodefony.options);

const config = {
  /**
   * Recharge automatique des fichiers sources en mode dev (watch Rollup).
   * Recommandation prod : `false` pour éviter l'overhead Rollup en runtime.
   */
  watch: true,

  /**
   * Domaine d'écoute du serveur. Nodefony écoute UN SEUL domaine (pas de vhost).
   * Voir le header de ce fichier pour les valeurs possibles.
   * Recommandation prod : "0.0.0.0" (toutes interfaces) ou IP fixe.
   */
  domain: "127.0.0.1",
  //domain: "selectAuto",

  /**
   * Liste des alias de domaines acceptés (regexps stringifiées).
   * Activé uniquement si `domainCheck: true`.
   * Recommandation prod : restreindre strictement aux domaines servis.
   */
  domainAlias: ["^localhost$"],

  /**
   * Active la vérification du domaine entrant contre `domain` + `domainAlias`.
   * Toute requête avec un Host inconnu → 404 / rejet.
   * Recommandation prod : `true` (protection Host header injection).
   */
  domainCheck,

  /**
   * Locale par défaut de l'application (fallback pour translation, dates, etc.).
   * Override par requête via headers Accept-Language.
   */
  locale: "en_en",

  /**
   * TOPOLOGIE / CLUSTER (cloud-native) — successeur de PM2 `instances`.
   * « Molette » DevOps : combien de process Node lancer.
   *   workers: 1      → mono-process (défaut : 1 process = 1 pod, scaling via l'orchestrateur)
   *   workers: "auto" → nb cgroup-aware (conteneur), workers: <N> → explicite
   * Override runtime : CLI `--workers` > env `NODEFONY_WORKERS` > ce fichier.
   * `development` est TOUJOURS mono-process (ignore ce réglage — Vite exige 1 maître).
   * Voir `./cluster/cluster.config.ts`.
   */
  cluster,

  /**
   * Configuration PM2 (production process manager).
   * @deprecated cloud-native — retrait Phase 16. Préférer `cluster.workers` ci-dessus.
   * Voir `./pm2/pm2.config.ts` pour la liste des options.
   */
  pm2,

  /**
   * Métadonnées de l'application — affichées dans les CLI et logs d'init.
   * Modifier pour personnaliser ton fork du framework.
   */
  App: {
    projectYear: "2024",
    locale: "en_en",
    authorName: "Camensuli Christophe",
    authorMail: "ccamensuli@gmail.com",
  },

  /**
   * SERVEURS HTTP/HTTPS/WS/WSS.
   * - `statics` : active server-static (assets, files, etc.)
   * - `http.port` : port HTTP plain
   * - `https.port` + `protocol` : "2.0" (HTTP/2 + ALPN HTTP/1.1) ou "1.1"
   * - `ws` / `wss` : héritent automatiquement du HTTP/HTTPS associé
   * Recommandation prod : ports 80/443 derrière un reverse proxy (nginx, ingress).
   */
  servers: {
    statics,
    http: {
      port: 5151,
    },
    https: {
      port: 5152,
      protocol: "2.0", // "2.0" (HTTP/2 + fallback 1.1) ou "1.1" strict
    },
    ws: {},
    wss: {},
  },

  /**
   * SERVEUR DE DÉVELOPPEMENT (Webpack/Vite legacy — sera remplacé Phase 14).
   * - `hot` : Hot Module Replacement (true | "only" | false)
   * - `overlay` : afficher les erreurs build en overlay browser
   * - `logging` : verbosité du dev server ("none" | "error" | "warning" | "info")
   * Recommandation prod : ignoré (devServer non utilisé en prod).
   */
  devServer: {
    hot: false,
    overlay: true,
    logging: "info",
    progress: false,
    protocol: "https",
    websocket: true,
  },

  /**
   * SYSLOG NODEFONY — config du logger central.
   *
   * - `active` : master switch. `false` = aucun log (test silencieux).
   * - `debug`  : filtre des sources DEBUG.
   *     "*"  → tous les logs DEBUG
   *     []   → aucun DEBUG (seulement INFO/WARNING/ERROR/CRITIC)
   *     ["router", "sequelize"] → seulement ces sources en DEBUG
   * - `requestFormat` : format de log émis par HttpKernel pour CHAQUE requête
   *   HTTP/WS finie. Lu par HttpKernel.initialize() au boot, swap automatique :
   *     "auto"    : sélection auto selon l'environnement (DEFAULT recommandé)
   *                 → dev/development = "pretty", production = "json", autre = "default"
   *     "default" : verbeux multi-info legacy (cli-color, plusieurs champs)
   *     "pretty"  : 1 ligne courte colorée — recommandé DEV (P3.2)
   *                 → "INFO req : GET 200 /url 12ms 127.0.0.1 [a1b2c3d4]"
   *     "json"    : 1 PDU JSON canonique — recommandé PROD (P3.1 + P3.4 redaction)
   *                 → '{"ts":...,"requestId":...,"userId":...,"status":...}'
   *
   * Pour forcer un format peu importe l'env, mettre la valeur explicite
   * ("default" | "pretty" | "json"). Sinon laisser "auto".
   *
   * Override programmatique possible (custom logger, RFC 7807, NCSA, etc.) :
   *   httpKernel.setRequestLogger(new MyLogger())
   */
  log: {
    active: true,
    debug: "*",
    requestFormat: "auto" as "auto" | "default" | "pretty" | "json",
  },

  /**
   * MOTEUR DE TEMPLATES des vues controllers (`renderView()`).
   * Moteur unique = **Eta** (https://eta.js.org) — TypeScript natif, ESM,
   * autoescape, délimiteurs `<% %>`/`<%= %>` sûrs pour HTML comme codegen.
   * Vues `.eta` (remplace l'historique Twig/EJS, retiré 2026-05-29).
   */
  templating: "eta",

  /**
   * ORM PAR DÉFAUT — utilisé par les commandes CLI (orm:migrate, etc.)
   * et par les modules qui n'en déclarent pas un explicitement.
   *   "sequelize" → SQL legacy (maintenance-only, voir migration P7.1)
   *   "mongoose"  → NoSQL standard (P7.2)
   *   futur :
   *     "drizzle"  → SQL moderne TS-first (choix #1 2026 — P7.4)
   *     "mikroorm" → Data Mapper SQL (apps complexes — P7.8)
   * Recommandation prod : "drizzle" dès que P7.4 stable.
   */
  orm: "sequelize",

  /**
   * GESTIONNAIRE DE PAQUETS Node.js — utilisé par les commandes CLI
   * (install, outdated, build, etc.).
   *   "npm"  → standard
   *   "yarn" → workspaces
   *   "pnpm" → store partagé, plus rapide en monorepo
   *   "bun"  → ultra-rapide, supporté pour @nodefony/llm/test
   * Recommandation : "npm" (le plus stable cross-platform).
   */
  packageManager: "npm",

  /*
   *   OVERRIDES MODULES — surcharge des configs DEFAULT de chaque module.
   *   Les fichiers `./modules/<module>-config.ts` portent les valeurs
   *   spécifiques à cette app. La fusion est récursive (deep merge).
   *
   *   Pour surcharger une option d'un module :
   *     1. Modifier directement `./modules/<module>-config.ts`
   *     2. OU étendre ici en spread :
   *        "module-http": { ...http, formidable: { uploadDir: "/var/upload" } }
   */
  "module-http": http,
  "module-sequelize": sequelize,
  // "module-mongoose" retiré : @nodefony/mongoose n'est pas chargé (cf @modules
  // dans index.ts). Décommenter ICI ET dans index.ts pour réactiver mongoose.
  // "module-mongoose": mongoose,
  "module-security": security,
  // Backplane realtime = driver `redis` (registre) → fan-out cross-pod via Redis
  // pub/sub en cluster. Connexion Redis depuis `@nodefony/redis` (défaut
  // localhost:6379 ; password/host par env REDIS_PASSWORD/REDIS_HOST au lancement).
  // ⚠️ Lever EFFECTIF aujourd'hui = env `NODEFONY_REALTIME_DRIVER=redis` : cet
  // override `module-realtime` est appliqué à onPreBoot, APRÈS la validation Zod
  // de realtime (onRegister) → ignoré (chantier ordering config à corriger).
  "module-realtime": { backplane: { driver: "redis" } },
};

export default config;
