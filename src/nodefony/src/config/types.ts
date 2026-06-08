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
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
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
  port?: number;
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

/** Serveurs réseau HTTP/HTTPS/WS/WSS (un seul domaine, pas de vhost). */
export interface ServersConfig {
  /**
   * Active le serveur de fichiers statiques (assets, uploads).
   * @default true
   * @reactivity boot
   */
  statics?: boolean;
  /** Serveur HTTP plain. */
  http?: HttpServerConfig;
  /** Serveur HTTPS (le WSS en hérite). */
  https?: HttpsServerConfig;
  /** Serveur WebSocket (hérite du HTTP associé). */
  ws?: Record<string, unknown>;
  /** Serveur WebSocket Secure (hérite du HTTPS associé). */
  wss?: Record<string, unknown>;
}

/** Sortie fichier du Syslog. */
export interface LogFileConfig {
  /**
   * Écriture synchrone (`writeSync`) par worker au lieu du buffer async.
   * @default false
   * @reactivity boot
   */
  sync?: boolean;
}

/** Destination prod queryable du log backplane (Loki / OpenSearch). */
export interface LogDestinationConfig {
  /** URL HTTP de la destination. */
  url: string;
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
  /** Options du sink fichier. */
  file?: LogFileConfig;
  /**
   * Driver de RELECTURE du log backplane (≠ sink d'écriture).
   * @default "memory"
   * @reactivity boot
   */
  queryDriver?: string;
  /** Destination Loki (active si `queryDriver === "loki"`). @reactivity boot */
  loki?: LogDestinationConfig;
  /** Destination OpenSearch (active si `queryDriver === "opensearch"`). @reactivity boot */
  opensearch?: LogDestinationConfig;
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
   * (override runtime : CLI `--workers` > `NODEFONY_WORKERS` > ce champ).
   * @reactivity boot
   */
  cluster?: Record<string, unknown>;
  /** Observabilité (Syslog + log backplane). */
  log?: LogConfig;
  /**
   * Surcharge de la config DEFAULT d'un module chargé (clé `module-<nom>`).
   * Exemple : `"module-http": { formidable: { uploadDir: "/var/upload" } }`.
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
  /** Environnement applicatif libre (`APP_ENV`/`NODEFONY_ENV`) — granularité métier. */
  readonly appEnv: string;
  /** Environnement runtime canonisé (`NODE_ENV`). */
  readonly runtimeEnv: string;
  /** Raccourci `runtimeEnv === "production"`. */
  readonly isProd: boolean;
  /** Raccourci `runtimeEnv === "development"`. */
  readonly isDev: boolean;
  /** Raccourci `runtimeEnv === "test"`. */
  readonly isTest: boolean;
}

/**
 * Entrée de `defineConfig` : soit un objet de config, soit une fonction
 * `(ctx) => objet` pour différencier par environnement (D3).
 *
 * @typeParam E - forme du catalogue d'env typé (Lot 2).
 */
export type ConfigInput<E = Record<string, unknown>> =
  | AppConfigInput
  | ((ctx: ConfigContext<E>) => AppConfigInput);
