/**
 * Types publics du moteur de configuration `defineConfig` (back-only, D1).
 *
 * Pilier #1 du chantier configuration : **typage impeccable**. Chaque clé de
 * {@link AppConfigInput} porte un bloc TSDoc auto-suffisant (1ʳᵉ phrase + `@default`
 * + `@reactivity`) → dans l'éditeur, taper `{` dans `defineConfig` propose toutes
 * les clés avec leur explication en hover.
 *
 * `@reactivity hot` : la valeur peut s'appliquer À CHAUD (sans redémarrer le
 * serveur — futur `Kernel.applyConfigPatch`). `@reactivity boot` : figée au boot
 * (un changement exige un redémarrage). La métadonnée structurée est dans
 * `./reactivity` (exploitable par Studio + le mécanisme hot-apply).
 *
 * Ces types ne dépendent PAS du Kernel (importables/testables sans serveur).
 */
import type { ModulePolicy } from "../types/IModuleManifest";
import type { IInfra } from "./infra";

/**
 * Noms de modules connus du framework — proposés à l'autocomplétion tout en
 * **acceptant n'importe quel module tiers** (astuce `string & {}` : conserve les
 * littéraux connus dans la complétion sans fermer le type aux strings arbitraires).
 */
export type KnownModule =
  | "@nodefony/http"
  | "@nodefony/framework"
  | "@nodefony/security"
  | "@nodefony/user"
  | "@nodefony/frontend"
  | "@nodefony/studio"
  | "@nodefony/documentation"
  | "@nodefony/realtime"
  | "@nodefony/redis"
  | "@nodefony/drizzle"
  | "@nodefony/mongoose"
  // Accepte tout module tiers en gardant l'autocomplétion des littéraux ci-dessus.
  | (string & {});

/**
 * Entrée détaillée du manifeste `modules` (forme objet). Une `string` nue
 * équivaut à `{ name, policy: "optional" }`.
 */
export interface ModuleEntryInput {
  /** Nom du module à charger (résolu par `import()` dynamique au boot). */
  name: KnownModule;
  /** Politique de chargement. Défaut `"optional"`. `"dev"` = hors production. */
  policy?: ModulePolicy;
  /** Garde évaluée sur la config résolue ; `false` → module ignoré (0 coût). */
  when?: (config: ResolvedAppConfig) => boolean;
  /**
   * Config colocalisée du module (deep-mergée sous sa config DEFAULT au boot par
   * le Kernel, avant la validation Zod du module). Remplace les clés legacy
   * `module-<nom>` à la racine. À écrire via {@link use} pour un typage par module
   * (les clés proposées sont celles du module ciblé).
   */
  config?: Record<string, unknown>;
}

/**
 * Manifeste ORDONNÉ des modules de l'application (position = ordre de chargement).
 * `policy`/`when` filtrent, ne réordonnent jamais.
 */
export type ModuleManifestInput = ReadonlyArray<KnownModule | ModuleEntryInput>;

/** Métadonnées d'identité de l'application (affichées dans la CLI et les logs d'init). */
export interface AppMeta {
  /** Année du projet (copyright, bannières). */
  projectYear?: string;
  /** Locale d'affichage des métadonnées. */
  locale?: string;
  /** Nom de l'auteur / mainteneur. */
  authorName?: string;
  /** E-mail de contact de l'auteur. */
  authorMail?: string;
}

/** Serveur HTTP plain. */
export interface HttpServerConfig {
  /**
   * Port d'écoute HTTP plain.
   * @default 5151
   * @reactivity boot
   */
  port?: number | undefined;
}

/** Serveur HTTPS (+ WSS hérité). */
export interface HttpsServerConfig {
  /**
   * Port d'écoute HTTPS.
   * @default 5152
   * @reactivity boot
   */
  port?: number;
  /**
   * Protocole TLS : `"2.0"` (HTTP/2 + ALPN fallback 1.1) ou `"1.1"` strict.
   * @default "2.0"
   * @reactivity boot
   */
  protocol?: "1.1" | "2.0";
}

/**
 * Serveur HTTP/2 en clair (h2c, connaissance préalable — RFC 9113 §3.3), pour un
 * proxy inverse qui parle HTTP/2 à ses amonts (Envoy/Istio, HAProxy, Traefik).
 * Port DÉDIÉ : un client HTTP/1.1 y est refusé, les WebSocket restent sur le port
 * HTTP. N'est pas « plus rapide » par principe : à activer pour gRPC, pour de
 * nombreux flux longs, ou après mesure.
 */
export interface H2cServerConfig {
  /**
   * Démarre le serveur h2c.
   * @default false
   * @reactivity boot
   */
  enabled?: boolean;
  /**
   * Port d'écoute h2c — distinct de `http.port` et de `https.port`.
   * @default 5153
   * @reactivity boot
   */
  port?: number;
}

/** Serveurs réseau HTTP/HTTPS/WS/WSS (un seul domaine, pas de vhost). */
export interface ServersConfig {
  /**
   * Active le serveur de fichiers statiques (assets, uploads).
   * @default true
   * @reactivity boot
   */
  statics?: boolean;
  /** Serveur HTTP plain. `false` = désactivé (déploiement TLS-only). */
  http?: HttpServerConfig | false;
  /**
   * Serveur HTTPS (le WSS en hérite). `false` = désactivé — cas NOMINAL
   * cloud-native : TLS terminé à l'ingress/LB, le pod sert en clair.
   */
  https?: HttpsServerConfig | false;
  /** Serveur HTTP/2 en clair (h2c) pour un proxy inverse — désactivé par défaut. */
  h2c?: H2cServerConfig;
  /** Serveur WebSocket (hérite du HTTP associé). */
  ws?: Record<string, unknown>;
  /** Serveur WebSocket Secure (hérite du HTTPS associé). */
  wss?: Record<string, unknown>;
  /**
   * Que faire quand le port désiré est DÉJÀ OCCUPÉ.
   *
   * - `auto` : prendre le prochain port libre. L'app boote au lieu de mourir, et
   *   le décalage est **annoncé** (jamais silencieux). Confort de dev : plusieurs
   *   apps Nodefony côte à côte.
   * - `strict` : échec fatal (EADDRINUSE).
   *
   * Le défaut dépend de l'environnement, et c'est délibéré :
   * - **production → `strict`.** Le port y est un CONTRAT (service k8s, ingress,
   *   sonde de santé). Écouter ailleurs en silence produirait un pod « sain »
   *   que personne n'atteint — une panne invisible.
   * - **test → `strict`.** Un port occupé signale un serveur resté debout ; le
   *   banc doit s'arrêter net, pas taper à côté.
   * - **développement → `auto`.** Là, un port pris est une nuisance, pas un contrat.
   *
   * @default "auto" en développement, "strict" en production et en test
   * @reactivity boot
   */
  portPolicy?: "auto" | "strict";
  /**
   * En `portPolicy: "auto"`, nombre de ports essayés après le port désiré.
   * @default 20
   * @reactivity boot
   */
  portRetryAttempts?: number;
}

/** Sortie fichier du Syslog. */
export interface LogFileConfig {
  /**
   * Chemin explicite du fichier de log (sink `file`). À défaut, le sink écrit
   * `<dir>/nodefony-<pid>.log` (un fichier par worker, 0 lock d'inode partagé).
   * @reactivity boot
   */
  path?: string;
  /**
   * Écriture synchrone (`writeSync`) par worker au lieu du buffer async.
   * @default false
   * @reactivity boot
   */
  sync?: boolean;
}

/** Options du driver de RELECTURE `file` du log backplane (query plane JSONL). */
export interface LogQueryFileConfig {
  /**
   * Chemin du fichier JSONL relu par le driver de query `file`. À défaut, dérivé
   * du répertoire de logs.
   * @reactivity boot
   */
  path?: string;
  /**
   * Plafond d'octets scannés en fin de fichier lors d'une query (garde-fou I/O).
   * @reactivity boot
   */
  maxScanBytes?: number;
}

/** Destination prod queryable du log backplane (Loki / OpenSearch). */
export interface LogDestinationConfig {
  /** URL HTTP de la destination. */
  url: string;
  /**
   * `false` = relecture SEULE : l'application n'y envoie rien, un collecteur de
   * l'hébergeur s'en charge (avec `log.format: "json"`), et la console
   * d'administration relit ce qu'il a poussé. `true` force l'envoi, y compris
   * en production.
   * @default true en développement, false en production
   */
  write?: boolean;
  /**
   * Utilisateur de l'authentification basique. Peut aussi venir de l'URL
   * (`https://utilisateur:secret@hôte`) ; une valeur déclarée ici l'emporte.
   */
  username?: string;
  /** Mot de passe de l'authentification basique (secret : jamais commité). */
  password?: string;
  /** En-têtes HTTP ajoutés à l'envoi comme à la relecture (proxy d'authentification…). */
  headers?: Record<string, string>;
  /** Délai d'une requête vers la destination, en millisecondes. */
  timeoutMs?: number;
  /** Lignes regroupées par envoi. */
  batchSize?: number;
  /** Intervalle maximal entre deux envois, en millisecondes. */
  flushIntervalMs?: number;
  /** Lignes gardées en attente au plus ; au-delà, les plus anciennes sont écartées. */
  maxQueue?: number;
}

/** Destination Grafana Loki : une {@link LogDestinationConfig} plus son sélecteur. */
export interface LokiDestinationConfig extends LogDestinationConfig {
  /**
   * Étiquettes de flux : posées à l'envoi, et sélecteur de la relecture. En
   * relecture seule, ce sont celles que pose le COLLECTEUR.
   * @default { app: "<nom du paquet de l'application>" }
   */
  labels?: Record<string, string>;
  /** Locataire d'un Loki multi-tenant (en-tête `X-Scope-OrgID`). */
  tenantId?: string;
  /** Lignes rapatriées au plus par une relecture, avant filtrage. */
  maxScanLines?: number;
}

/** Destination OpenSearch : une {@link LogDestinationConfig} plus son index. */
export interface OpenSearchDestinationConfig extends LogDestinationConfig {
  /**
   * Index écrit à l'envoi et lu à la relecture. En relecture seule, celui où
   * le COLLECTEUR indexe.
   * Deux applications d'un même OpenSearch en déclarent chacune un.
   * @default "nodefony-logs"
   */
  index?: string;
  /** Documents rapatriés au plus par une relecture, avant filtrage. */
  maxHits?: number;
}

/** Observabilité — Syslog Nodefony + log backplane. */
export interface LogConfig {
  /**
   * Master switch des logs. `false` = silence total (tests).
   * @default true
   * @reactivity hot
   */
  active?: boolean;
  /**
   * Filtre des sources DEBUG : `"*"` (tout), `[]` (aucun), `["router"]` (ciblé).
   * @default []
   * @reactivity hot
   */
  debug?: string | string[];
  /**
   * Format de log émis par HttpKernel pour chaque requête finie.
   * `"auto"` choisit selon l'environnement (dev=pretty, prod=json).
   * @default "auto"
   * @reactivity hot
   */
  requestFormat?: "auto" | "default" | "pretty" | "json";
  /**
   * Bufférisation de la sortie console (`"auto"` = bufférise hors TTY).
   * @default "auto"
   * @reactivity boot
   */
  buffered?: boolean | "auto";
  /**
   * Sink d'écriture des logs : `"stdout"` (cloud-native), `"file"`, `"null"` (bench).
   * @default "stdout"
   * @reactivity boot
   */
  driver?: "stdout" | "file" | "null";
  /**
   * Forme des lignes écrites par le sink : `"text"` (lisible) ou `"json"` (un
   * enregistrement par ligne — ce qu'un collecteur transporte, et ce que la
   * relecture Loki/OpenSearch sait relire).
   * @default "text"
   * @reactivity boot
   */
  format?: "text" | "json";
  /**
   * Répertoire des logs (fichiers `.log` + JSONL queryable + viewer Studio),
   * résolu sous `process.cwd()`.
   * @default "logs"
   * @reactivity boot
   */
  dir?: string;
  /** Options du sink fichier. */
  file?: LogFileConfig;
  /**
   * Profondeur du ring de relecture du backplane de log (driver `memory`). Non
   * défini = 2000 en développement (trace d'une requête lisible), sinon repli
   * prod-safe interne.
   * @reactivity boot
   */
  maxStack?: number;
  /** Options du driver de relecture `file` (query plane JSONL). */
  queryFile?: LogQueryFileConfig;
  /**
   * Driver de RELECTURE du log backplane (≠ sink d'écriture). `auto` (défaut)
   * s'adapte au mode : mono → `memory`, worker de cluster → `cluster-file` (vue
   * unifiée). Toute valeur explicite (`memory`/`file`/`loki`/…) surcharge.
   * @default "auto"
   * @reactivity boot
   */
  queryDriver?: string;
  /** Destination Loki (active si `queryDriver === "loki"`). @reactivity boot */
  loki?: LokiDestinationConfig;
  /** Destination OpenSearch (active si `queryDriver === "opensearch"`). @reactivity boot */
  opensearch?: OpenSearchDestinationConfig;
}

/**
 * Forme de la configuration d'une application Nodefony, telle qu'écrite par
 * l'utilisateur dans `nodefony.config.ts`. Tous les champs sont optionnels : ce
 * que l'app n'écrit pas vient de {@link defaultAppConfig} (deep-merge au resolve).
 */
export interface AppConfigInput {
  /**
   * Manifeste ordonné des modules chargés (liste + policy + gating `when`).
   * Seule source de vérité du chargement (le Kernel l'orchestre à `onPreRegister`).
   * @reactivity boot
   */
  modules?: ModuleManifestInput;
  /**
   * Locale par défaut de l'app (fallback translation/dates), override par requête.
   * @default "en_en"
   * @reactivity boot
   */
  locale?: string;
  /** Métadonnées d'identité de l'app (auteur, année) — affichées CLI + logs. */
  App?: AppMeta;
  /**
   * Moteur de templates des vues controllers (`renderView`). Unique : Eta.
   * @default "eta"
   * @reactivity boot
   */
  templating?: string;
  /**
   * ORM par défaut (commandes CLI + modules sans ORM explicite). Multi-ORM :
   * la forme cible (`{ driver: "drizzle" }`) et le défaut sont définis par le
   * chantier ORM — pas de défaut framework figé ici.
   * @reactivity boot
   */
  orm?: string;
  /**
   * Gestionnaire de paquets Node.js (commandes install/outdated/build).
   * @default "npm"
   * @reactivity boot
   */
  packageManager?: "npm" | "yarn" | "pnpm" | "bun";
  /**
   * Domaine d'écoute (un seul, pas de vhost). Prod : `"0.0.0.0"` ou IP fixe.
   * @default "localhost"
   * @reactivity boot
   */
  domain?: string;
  /**
   * Alias de domaines acceptés (regexps stringifiées), actif si `domainCheck` —
   * validation Host kernel-level (compilée en RegExp). En cours de consolidation
   * avec `http.trustedHosts` (deux barrières Host concurrentes à unifier).
   * @reactivity boot
   */
  domainAlias?: string[];
  /**
   * Active la validation Host kernel-level (`domain` + `domainAlias`) avant le
   * routing. Off par défaut (opt-in) ; en cours de consolidation avec
   * `http.trustedHosts`.
   * @reactivity boot
   */
  domainCheck?: boolean;
  /** Serveurs HTTP/HTTPS/WS/WSS. */
  servers?: ServersConfig;
  /**
   * Topologie cluster (cloud-native, sans PM2). Résolue par `resolveTopology`
   * (override runtime : CLI `--workers` > `NF_WORKERS` > ce champ).
   * @reactivity boot
   */
  cluster?: Record<string, unknown>;
  /**
   * Deadline GLOBALE du shutdown (ms) — au-delà, `Kernel.terminate` force la
   * sortie `code 1` même si un listener `onTerminate` pend (SSE ouvert, store
   * bloqué, module tiers). Filet cloud-native : garder < grace period de
   * l'orchestrateur (30 s k8s, 10 s Docker). Distinct de
   * `http.servers.*.shutdownTimeout` (drain PAR SERVEUR, borne le nominal) :
   * ici c'est le filet de TOUT le terminate. `0` = désactivé. Défaut : `15000`.
   * @reactivity boot
   */
  shutdownDeadline?: number;
  /**
   * Instrumentation du pipeline — la sonde de phases qui alimente le waterfall
   * (Studio/Playground, debug bar, profiler).
   *
   * `enabled: null` (défaut) = pas d'avis → la règle d'environnement s'applique
   * (active hors production, éteinte en production). Un booléen explicite gagne :
   * `true` allume la sonde EN PRODUCTION (diagnostic à chaud, coût assumé),
   * `false` l'éteint partout. Override sans redéploiement :
   * `NF__APP__TIMING__ENABLED=true`.
   * @reactivity boot
   */
  timing?: {
    enabled?: boolean | null;
    /** Trace DEBUG d'une ligne par requête détaillant chaque phase. Implique `enabled`. */
    verbose?: boolean;
  };
  /** Observabilité (Syslog + log backplane). */
  log?: LogConfig;
  /**
   * Surcharge de la config DEFAULT d'un module chargé (clé `module-<nom>`).
   * Exemple : `"module-http": { upload: { uploadDir: "/var/upload" } }`.
   * Fusion récursive (deep merge) appliquée par le Kernel à `preRegister`.
   */
  [moduleOverride: `module-${string}`]: unknown;
}

/**
 * Configuration résolue : {@link AppConfigInput} après deep-merge avec les
 * défauts framework et validation Zod. Même forme structurelle (le merge remplit
 * les valeurs ; le Kernel lit défensivement avec ses propres fallbacks résiduels).
 */
export type ResolvedAppConfig = AppConfigInput;

/**
 * Contexte passé à la forme fonction de `defineConfig` — permet de différencier
 * la config par environnement SANS fichier `config.<env>.ts` parallèle (D3).
 *
 * @typeParam E - forme du catalogue d'env typé (inféré de `defineEnv`, Lot 2).
 *
 * @example
 * ```ts
 * defineConfig((ctx) => ({
 *   domain: ctx.isProd ? "0.0.0.0" : "127.0.0.1",
 * }));
 * ```
 */
export interface ConfigContext<E = Record<string, unknown>> {
  /** Catalogue des variables d'environnement typées (`defineEnv`, Lot 2). */
  readonly env: E;
  /**
   * Infra déclarée résolus depuis l'environnement (modèle « infra déclarée »,
   * Phase 0.8) — `database`/`cache`/`logs`. Sert au gating de modules
   * (ex. `when: () => !!ctx.infra.cache` pour redis) sans relire `process.env`.
   */
  readonly infra: IInfra;
  /** Environnement applicatif libre (`APP_ENV`/`NF_ENV`) — granularité métier. */
  readonly appEnv: string;
  /** Environnement runtime canonisé (`NODE_ENV`). */
  readonly runtimeEnv: string;
  /** Raccourci `runtimeEnv === "production"`. */
  readonly isProd: boolean;
  /** Raccourci `runtimeEnv === "development"`. */
  readonly isDev: boolean;
  /** Raccourci `runtimeEnv === "test"`. */
  readonly isTest: boolean;
  /**
   * Les modules `policy: "dev"` sont-ils chargés ? — le verdict MÊME du gating
   * (hors production, ou dérogation `NF_WITH_DEV_MODULES=1`). Ce qui accompagne
   * un module de développement (connecteur, zone) se conditionne à CECI, jamais
   * à `isProd` : ce dernier ignore la dérogation.
   *
   * Toujours posé par le Kernel. Optionnel pour qu'un contexte construit à la
   * main (les tests d'une application) reste valide ; absent, il vaut « non ».
   */
  readonly devModules?: boolean;
}

/**
 * Entrée de `defineConfig` : soit un objet de config, soit une fonction
 * `(ctx) => objet` pour différencier par environnement (D3).
 *
 * @typeParam E - forme du catalogue d'env typé (Lot 2).
 */
export type ConfigInput<E = Record<string, unknown>> =
  AppConfigInput | ((ctx: ConfigContext<E>) => AppConfigInput);
