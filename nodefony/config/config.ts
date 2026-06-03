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
 *   `development` / `production` / un environnement de déploiement (`staging`…),
 *   créer des fichiers `config.production.ts` / `config.staging.ts` à côté de
 *   celui-ci, ou utiliser des getters lazy. NE JAMAIS déréférencer le kernel
 *   (`Nodefony.getKernel()`) au top-level de ce fichier (crash à l'import).
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
import http from "./modules/http-config";
import sequelize from "./modules/sequelize-config";
// import mongoose from "./modules/mongoose-config"; // décommenter avec @nodefony/mongoose (index.ts)
import cluster from "./cluster/cluster.config";
import security from "./modules/security-config";
import modules from "./modules";

// Différenciation par environnement : passer par des fichiers `config.<appEnv>.ts`
// (chargés APRÈS résolution du kernel) ou des getters lazy. JAMAIS un deref kernel
// (`Nodefony.getKernel()`) au top-level : le kernel n'existe pas encore au moment de
// l'import du module → crash `Cannot read properties of null` + module non testable.
const statics = true;
const domainCheck = true;

const config = {
  /**
   * Manifeste des modules de l'app (liste ordonnée + policy + gating). Résolu et
   * chargé par le Kernel à `onPreRegister`. Défini dans `./modules.ts` — seule
   * source de vérité du chargement de modules (remplace le décorateur `@modules`
   * d'`index.ts`). Cf mémoire IA `project_module_loading_architecture`.
   */
  modules,

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
   *
   * - `buffered` : bufférisation de la sortie console (perf débit sous forte
   *   concurrence — coalesce les écritures d'un même tick en 1 seul syscall).
   *     "auto" (DÉFAUT) : bufférise si stdout N'EST PAS un TTY (pipe/fichier =
   *                       prod/container/collecteur → débit) ; immédiat sur un
   *                       terminal (dev interactif → feedback ligne à ligne + spinner).
   *     true            : toujours bufférisé (ex. bench dans un terminal).
   *     false           : jamais (ex. `tail -f` non bufférisé en debug prod).
   *   stderr (ERROR+) reste TOUJOURS immédiat (durable même crash imminent).
   */
  log: {
    active: true,
    debug: "*",
    requestFormat: "auto" as "auto" | "default" | "pretty" | "json",
    buffered: "auto" as boolean | "auto",
    // Driver de sink (LB.W) : où partent les lignes après coalescing.
    //   "stdout" (DÉFAUT, cloud-native pipe non-bloquant) | "file" (fd async PAR
    //   worker → 0 lock d'inode partagé en cluster, anti-goulet +28%) | "null" (bench).
    // Piloté par env NF_LOG_DRIVER (A/B perf) ; sans `file.path`, le Kernel ouvre
    // `logs/nodefony-<pid>.log` (1 fd par worker).
    driver: (process.env.NF_LOG_DRIVER ?? "stdout") as
      | "stdout"
      | "file"
      | "null",
    // `file.sync` (env NF_LOG_FILE_SYNC=1) : writeSync direct par worker au lieu
    // du buffer async — recommandé pour fichier local rapide (cf insight A/B LB.W,
    // axe W2 fd/worker). Défaut async (ne bloque jamais l'event loop, disque lent).
    file: { sync: process.env.NF_LOG_FILE_SYNC === "1" },
    // Driver du LOG BACKPLANE (LB.0+) — le « fond de panier » de RELECTURE des logs
    // (≠ `driver` ci-dessus = sink d'ÉCRITURE). Où l'on REQUÊTE les logs (CLI / endpoint
    // Studio / panneau) :
    //   "memory" (DÉFAUT, ring volatile ; dev) | "file" / "cluster-file" (JSONL persistant,
    //   vue worker / vue cluster) | "loki" / "opensearch" (destinations PROD, LB.4).
    // Piloté par env (12-factor) → en prod l'orchestrateur fige la destination sans
    // toucher au code. En dev, file/cluster-file restent montés en plus (switch à chaud Studio).
    queryDriver: process.env.NF_LOG_QUERY_DRIVER ?? "memory",
    // Destinations PROD (LB.4) — actives seulement si `queryDriver` vaut leur nom ET l'URL
    // est fournie (sinon fallback "memory" au boot, jamais de crash). On POUSSE (transport
    // batché, 1 POST/lot) ET on RELIT (driver query) la MÊME destination → cohérence
    // write↔read. URLs par défaut = celles du `docker/docker-compose.yml` (--profile loki /
    // --profile opensearch). Activer : `NF_LOG_QUERY_DRIVER=loki LOKI_URL=http://127.0.0.1:3100`.
    ...(process.env.LOKI_URL ? { loki: { url: process.env.LOKI_URL } } : {}),
    ...(process.env.OPENSEARCH_URL
      ? { opensearch: { url: process.env.OPENSEARCH_URL } }
      : {}),
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
  // Backplane realtime = driver `cluster` (IPC intra-pod, master relay) par DÉFAUT :
  // ZÉRO dépendance externe. Mono-process → hub local (factory → null) ; cluster
  // (`--workers N`) → fan-out IPC entre workers du même pod. Redis (`driver:"redis"`
  // + REDIS_PASSWORD) = OPT-IN pour le fan-out CROSS-pod multi-host (Phase 16).
  // Pourquoi pas redis par défaut : exiger Redis faisait planter le boot cluster en
  // storm NOAUTH (RedisService lazy → 0 connexion tant que personne ne demande un
  // client ; avec driver redis, le backplane en demandait un → storm si Redis KO).
  "module-realtime": { backplane: { driver: "cluster" } },
};

export default config;
