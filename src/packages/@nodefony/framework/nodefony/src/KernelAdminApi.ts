import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  GitService,
  getActiveLogDriver,
  Syslog,
  collectDevStatus,
  parseNfEnvOverrides,
  computeConfigProvenance,
  extractJsonSchemaDefaults,
  defaultAppConfig,
  applyResolvedPath,
} from "nodefony";
import type {
  IKernel,
  IAdminApi,
  IAdminEndpoint,
  IAdminDescriptor,
  IAdminRequest,
} from "nodefony";
import type { TestRunResult } from "./docsReader";
import {
  listModuleDocs,
  countModuleDocs,
  readModuleDoc,
  listModuleSymbols,
  readCoverage,
  readDependencies,
  checkOutdated,
  listTestFiles,
  listTestGroups,
  runModuleTests,
  resolveCorePath,
  readCoreInfo,
  CORE_PACKAGE,
} from "./docsReader";
import {
  navigateSchemaNode,
  nodeFlags,
  notEditableReason,
  validateLeafValue,
  recipeFor,
  getResolvedPath,
} from "./configMutation";

/** Clé du pseudo-module core dans Studio (cf carte "Core" / `resolveCorePath`). */
const CORE_KEY = "core";

/** Racine projet — pour ne PAS exposer de chemin absolu (sécu). */
const REPO_ROOT = process.cwd();
/** Relativise tout chemin absolu présent dans une string de config. */
function stripAbs(s: string): string {
  if (!s.includes(REPO_ROOT)) return s;
  return s.split(`${REPO_ROOT}/`).join("").split(REPO_ROOT).join(".");
}

/**
 * Clés dont la VALEUR est un secret (JWT, CSRF, OAuth client secret, clé privée).
 * Redactées dans la config exposée au data plane — Zero Trust : un secret n'est
 * JAMAIS renvoyé en clair, même à un admin (cf page Firewall qui redacte déjà).
 */
const SECRET_KEY =
  /secret|password|passwd|passphrase|privatekey|keysetjson|clientsecret|credential/i;

/**
 * Sérialisation défensive de config : borne la profondeur, neutralise les
 * fonctions, casse les cycles, et **relativise les chemins absolus** (sécu :
 * ne jamais exposer l'arborescence serveur). Les `options` d'un module peuvent
 * contenir des fonctions/refs circulaires (vers le kernel) → JSON.stringify
 * direct planterait.
 */
function safeConfig(
  value: unknown,
  depth = 0,
  seen = new WeakSet<object>(),
): unknown {
  if (typeof value === "function") return "[Function]";
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "string") return stripAbs(value);
  if (value === null || typeof value !== "object") return value;
  if (depth > 5) return "[depth limit]";
  if (seen.has(value)) return "[Circular]";
  seen.add(value);
  if (value instanceof Date) return value.toISOString();
  if (value instanceof RegExp) return value.toString();
  if (Array.isArray(value)) {
    return value.slice(0, 100).map((v) => safeConfig(v, depth + 1, seen));
  }
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(value as Record<string, unknown>).slice(0, 200)) {
    const raw = (value as Record<string, unknown>)[k];
    // Redaction des secrets AVANT sérialisation : la valeur ne quitte jamais le
    // serveur en clair. On ne redacte que les valeurs réellement posées (une clé
    // secrète vide en dev = pas un secret → laissée telle quelle).
    if (
      SECRET_KEY.test(k) &&
      raw != null &&
      raw !== "" &&
      typeof raw !== "boolean"
    ) {
      out[k] = "[redacted]";
      continue;
    }
    try {
      out[k] = safeConfig(raw, depth + 1, seen);
    } catch {
      out[k] = "[unreadable]";
    }
  }
  return out;
}

/** Forme minimale d'un module pour l'introspection de configuration. */
interface ConfigModuleLike {
  getModuleName?: () => string;
  options?: unknown;
  configSchema: () => unknown;
  isApp?: boolean;
}

/** Entrée config d'un module : valeurs redactées + schéma + provenance par champ. */
export interface IConfigEntry {
  /** Clé Studio (basename : `http`, `security`, `core`, ou la clé de l'app). */
  key: string;
  /** Nom de package (`@nodefony/http`, nom de l'app…). */
  name: string;
  /** Est-ce la config de l'APPLICATION (vs un module) ? */
  isApp: boolean;
  /** Segment d'adressage des overrides (`NF__<SEG>__…`) : `app` ou le basename. */
  seg: string;
  /** Config effective résolue, secrets REDACTÉS côté serveur. */
  config: Record<string, unknown>;
  /** JSON Schema du module (si migré Zod), sinon `null`. */
  configSchema: unknown;
  /** Origine par champ (`default`/`app`/`env`) — `null` si pas de schéma. */
  provenance: Record<string, string> | null;
  /**
   * « QUI surcharge, où » par champ env-surchargé : chemin pointé → **nom RÉEL**
   * de la variable d'environnement actuellement posée (`NF__SECURITY__JWT__ACCESSTTLS`).
   * Permet à Studio de nommer la source exacte (≠ recette générique).
   */
  envKeys: Record<string, string>;
  /**
   * « QUI surcharge, où » par champ **app**-surchargé : chemin pointé → SOURCE
   * réelle. Soit un MODULE qui reconfigure celui-ci via `module-<seg>` (cross-module,
   * ex. `@nodefony/test` qui surcharge `http.upload.maxFileSize`), soit
   * `nodefony.config.ts` (config app directe / `use()`). Rempli par
   * {@link attributeOverrideSources} (a besoin de TOUS les modules → côté agrégat).
   */
  overriddenBy: Record<string, string>;
}

/**
 * Aplatit un objet de config en chemins-feuilles pointés MINUSCULES (les arrays
 * sont des feuilles). Sert à savoir quels chemins un override `module-<X>` déclare.
 */
function flattenPaths(value: unknown, prefix: string, out: Set<string>): void {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    for (const k of Object.keys(value)) {
      flattenPaths(
        (value as Record<string, unknown>)[k],
        prefix ? `${prefix}.${k}` : k,
        out,
      );
    }
  } else if (prefix) {
    out.add(prefix.toLowerCase());
  }
}

/**
 * Attribue chaque champ **app**-surchargé à sa SOURCE réelle (mute `overriddenBy`).
 *
 * Construit l'index inversé des overrides `module-<cible>` déclarés par CHAQUE
 * module (y compris l'app), puis, pour chaque champ « app » d'une cible, retrouve
 * le module qui pose ce chemin → c'est le vrai « qui surcharge ». Aucun candidat
 * `module-<cible>` → la surcharge vient de la config app directe (`nodefony.config.ts`).
 *
 * @param entries - toutes les entrées config de l'agrégat (mutées en place).
 */
function attributeOverrideSources(entries: IConfigEntry[]): void {
  const byTarget = new Map<
    string,
    Array<{ source: string; paths: Set<string> }>
  >();
  for (const e of entries) {
    for (const key of Object.keys(e.config)) {
      const m = /^module-(.+)$/i.exec(key);
      if (!m) continue;
      const targetSeg = m[1].toLowerCase();
      const paths = new Set<string>();
      flattenPaths(e.config[key], "", paths);
      const arr = byTarget.get(targetSeg);
      if (arr) arr.push({ source: e.name, paths });
      else byTarget.set(targetSeg, [{ source: e.name, paths }]);
    }
  }
  for (const e of entries) {
    if (!e.provenance) continue;
    const candidates = byTarget.get(e.seg);
    for (const [path, origin] of Object.entries(e.provenance)) {
      if (origin !== "app") continue;
      const pl = path.toLowerCase();
      const hit = candidates?.find(
        (c) =>
          c.paths.has(pl) ||
          [...c.paths].some(
            (p) => pl.startsWith(`${p}.`) || p.startsWith(`${pl}.`),
          ),
      );
      e.overriddenBy[path] = hit ? hit.source : "nodefony.config.ts";
    }
  }
}

/** Segment d'adressage des overrides (`NF__<SEG>__…`) d'un module : `app` ou le basename. */
function computeSeg(pkg: string, isApp: boolean): string {
  if (isApp) return "app";
  return (
    pkg.includes("/") ? pkg.slice(pkg.lastIndexOf("/") + 1) : pkg
  ).toLowerCase();
}

/**
 * Calcule l'entrée CONFIG d'un module — partagée par `module/{name}` (détail) et
 * l'agrégat `config` (page globale). Une seule logique de provenance (ADR-0006 D7),
 * branche `isApp` (défauts = `defaultAppConfig`, env = segment réservé `app`) vs
 * module (défauts = `extractJsonSchemaDefaults(schema)`, env = basename). La map de
 * provenance ne porte que des ORIGINES (jamais de valeur → 0 fuite) ; les valeurs
 * restent redactées par `safeConfig`.
 *
 * @param key - clé Studio du module.
 * @param mod - module (forme minimale {@link ConfigModuleLike}).
 * @param runtimePaths - chemins (pointés minuscule) édités À CHAUD via PATCH →
 *   provenance forcée `runtime` (≠ `app` : la valeur ne vient pas de la config app).
 * @returns l'entrée config normalisée.
 */
function computeConfigEntry(
  key: string,
  mod: ConfigModuleLike,
  runtimePaths?: ReadonlySet<string>,
): IConfigEntry {
  const pkg = mod.getModuleName?.() ?? key;
  const opts = (mod.options ?? {}) as Record<string, unknown>;
  const schema = mod.configSchema();
  const isApp = mod.isApp ?? false;
  const seg = computeSeg(pkg, isApp);
  // « Qui surcharge, où » : la VRAIE variable d'env posée pour ce module/app,
  // indexée par chemin pointé (casse réelle de la valeur résolue côté provenance).
  const envKeys: Record<string, string> = {};
  for (const o of parseNfEnvOverrides(process.env)) {
    if (o.moduleSeg === seg) envKeys[o.path.join(".")] = o.envKey;
  }
  let provenance: Record<string, string> | null = null;
  if (isApp) {
    const envPaths = new Set(
      parseNfEnvOverrides(process.env)
        .filter((o) => o.moduleSeg === "app")
        .map((o) => o.path.join(".")),
    );
    provenance = computeConfigProvenance(
      opts,
      defaultAppConfig as unknown as Record<string, unknown>,
      envPaths,
    );
  } else if (schema) {
    const envPaths = new Set(
      parseNfEnvOverrides(process.env)
        .filter((o) => o.moduleSeg === seg)
        .map((o) => o.path.join(".")),
    );
    provenance = computeConfigProvenance(
      opts,
      extractJsonSchemaDefaults(schema),
      envPaths,
    );
  }
  // Un champ édité À CHAUD diffère du défaut → la provenance le classerait « app »
  // (trompeur : il ne vient pas de la config app). On force `runtime` pour dire la
  // vérité : « modifié à l'exécution » (éphémère, perdu au restart).
  if (provenance && runtimePaths && runtimePaths.size) {
    for (const k of Object.keys(provenance)) {
      if (runtimePaths.has(k.toLowerCase())) provenance[k] = "runtime";
    }
  }
  return {
    key,
    name: pkg,
    isApp,
    seg,
    config: safeConfig(opts) as Record<string, unknown>,
    configSchema: schema,
    provenance,
    envKeys,
    overriddenBy: {}, // rempli par attributeOverrideSources (besoin de tous les modules)
  };
}

/** Libellé d'identité de l'acteur d'une mutation (duck-type `IUser`, sans import). */
function actorLabel(user: unknown): string | null {
  if (!user || typeof user !== "object") return null;
  const u = user as {
    getUserIdentifier?: () => string;
    username?: string;
    email?: string;
    id?: unknown;
  };
  if (typeof u.getUserIdentifier === "function") {
    try {
      return u.getUserIdentifier();
    } catch {
      // identité illisible → retomber sur les champs simples ci-dessous.
    }
  }
  return u.username ?? u.email ?? (u.id != null ? String(u.id) : null);
}

/**
 * Journalise une mutation de config (catégorie `config`) **si** le service d'audit
 * est présent — résolution par nom dans le container du kernel, no-op sinon (même
 * découplage que `recordAudit` côté security : framework n'importe pas security).
 * Un secret n'arrive jamais ici (refusé en amont par {@link notEditableReason}).
 */
function auditConfigChange(
  kernel: IKernel,
  request: IAdminRequest,
  moduleKey: string,
  path: string,
  before: unknown,
  after: unknown,
): void {
  const container = (
    kernel as unknown as { container?: { get(name: string): unknown } }
  ).container;
  const sink = container?.get("auditService") as
    { record?: (e: unknown) => void } | undefined;
  sink?.record?.({
    category: "config",
    action: "config.update",
    outcome: "success",
    actor: actorLabel(request.user),
    resource: `${moduleKey}.${path}`,
    requestId: request.requestId ?? null,
    metadata: { before, after },
  });
}

/**
 * Journalise un changement de debug runtime (catégorie `log`). Même découplage
 * que {@link auditConfigChange} (résolution par nom, no-op si pas d'audit).
 */
function auditLogLevelChange(
  kernel: IKernel,
  request: IAdminRequest,
  module: string,
  action: "set" | "clear",
  level: number | null,
  ttlMs: number | null,
): void {
  const container = (
    kernel as unknown as { container?: { get(name: string): unknown } }
  ).container;
  const sink = container?.get("auditService") as
    { record?: (e: unknown) => void } | undefined;
  sink?.record?.({
    category: "log",
    action: `log.debug.${action}`,
    outcome: "success",
    actor: actorLabel(request.user),
    resource: module,
    requestId: request.requestId ?? null,
    metadata: { level, ttlMs },
  });
}

/** TTL par défaut d'un debug ciblé ouvert via l'endpoint (15 min). */
const DEFAULT_DEBUG_TTL_MS = 15 * 60 * 1000;
/** Plafond dur du TTL (60 min) — borne anti-« debug oublié allumé » en prod. */
const MAX_DEBUG_TTL_MS = 60 * 60 * 1000;

/**
 * Producteur `IAdminApi` du **kernel** — exposé sous `/nodefony/kernel/api/*`.
 *
 * Le kernel ne peut pas s'enregistrer lui-même : il vit dans `@nodefony/core`
 * et ne peut donc pas importer le broker (qui est dans `@nodefony/framework`).
 * C'est framework qui construit cet `IAdminApi` à partir du kernel et
 * l'enregistre auprès du broker (cf `Framework.onKernelReady`). Le kernel reste
 * passif : on ne lit que ses getters publics + `process`.
 *
 * Endpoints (tous `ROLE_NODEFONY_ADMIN` par défaut) :
 *  - `GET /nodefony/kernel/api/health`  → liveness léger (probe k8s-friendly)
 *  - `GET /nodefony/kernel/api/info`    → identité runtime
 *  - `GET /nodefony/kernel/api/modules` → modules chargés + versions
 *
 * @param kernel - kernel courant (`Nodefony.getKernel()`).
 * @returns le contrat admin du kernel, prêt à `broker.register()`.
 */
export function createKernelAdminApi(kernel: IKernel): IAdminApi {
  const descriptor: IAdminDescriptor = {
    label: "Kernel",
    icon: "server",
    order: 0,
  };

  // Résout chemin disque + nom de package d'une cible : module chargé OU le
  // pseudo-module `core` (socle, absent de `getModules()`). `null` = inconnue.
  const resolveTarget = (key: string): { path: string; pkg: string } | null => {
    if (key === CORE_KEY) return { path: resolveCorePath(), pkg: CORE_PACKAGE };
    const mod = kernel.getModules()[key];
    if (!mod) return null;
    return { path: mod.path, pkg: mod.getModuleName?.() ?? key };
  };

  // Jobs de tests ASYNCHRONES : le run (6-30 s) ne tient PAS la connexion HTTP
  // (sinon le navigateur "Failed to fetch" pendant l'écriture du coverage). POST
  // démarre + rend un jobId ; le front poll GET ?jobId. Borné (16 derniers).
  const testJobs = new Map<
    string,
    { status: "running" | "done"; startedAt: number; result?: TestRunResult }
  >();
  // Chemins (pointés minuscule) édités À CHAUD via PATCH config, par clé module →
  // provenance affichée « runtime » (dev only, éphémère ; reset au restart process).
  const runtimeEdited = new Map<string, Set<string>>();
  const devGuard = () =>
    kernel.environment === "development" || Boolean(kernel.debug);

  // SÉCU : ne JAMAIS exposer de chemin absolu (fuite de l'arborescence serveur).
  // On renvoie les `path` relatifs à la racine projet (`process.cwd()`).
  const repoRoot = process.cwd();
  const relPath = (p: string | null | undefined): string | null =>
    p && p.startsWith(repoRoot)
      ? p.slice(repoRoot.length).replace(/^[/\\]+/, "") || "."
      : (p ?? null);

  // Masque les credentials (`user:pass@`) d'une URL d'infra avant de la renvoyer :
  // une URL de base/cache peut porter un mot de passe — jamais exposé au client.
  const redactInfraUrl = (url: string): string =>
    url.replace(/\/\/[^/@]*@/, "//***@");

  // Entrées config agrégées (valeurs redactées + provenance par champ) — partagé
  // par l'endpoint `config` (page globale) et `stores` (source d'un store explicite).
  const buildConfigEntries = (): IConfigEntry[] => {
    const modules = kernel.getModules();
    const entries: IConfigEntry[] = [];
    for (const k of Object.keys(modules)) {
      const mod = modules[k] as unknown as ConfigModuleLike;
      const opts = (mod.options ?? {}) as Record<string, unknown>;
      // N'inclure que les modules PORTEURS de config (réglages OU schéma).
      if (Object.keys(opts).length === 0 && !mod.configSchema()) continue;
      entries.push(computeConfigEntry(k, mod, runtimeEdited.get(k)));
    }
    // « Qui surcharge vraiment » : attribue chaque champ app au module SOURCE.
    attributeOverrideSources(entries);
    return entries;
  };

  // Source RÉELLE d'un champ `store` : croise le `configPath` d'une brique (ex.
  // `security.tokenStore.store`) avec la provenance par champ (default/app/env) pour
  // NOMMER d'où vient la valeur — comble « je ne sais pas quel fichier la déclare ».
  // `seg` = basename du module (`http`/`security`/`framework`) ; `field` = chemin
  // pointé minuscule relatif au module (`tokenstore.store`).
  // Résout le nom d'une source app (`overriddenBy`) en CHEMIN de fichier :
  // `nodefony.config.ts` tel quel, sinon le `config.ts` conventionnel du module
  // qui déclare la surcharge (`<mod.path>/nodefony/config/config.ts`, vérifié
  // sur disque) — pointe le fichier RÉEL, pas seulement le nom du module.
  const resolveSourceFile = (src: string): string => {
    if (src === "nodefony.config.ts") return src;
    for (const [k, m] of Object.entries(kernel.getModules())) {
      const mm = m as {
        getModuleName?: () => string;
        path?: string;
        isApp?: boolean;
      };
      if ((mm.getModuleName?.() ?? k) !== src) continue;
      if (mm.isApp) return "nodefony.config.ts";
      if (!mm.path) return src;
      const cfg = join(mm.path, "nodefony", "config", "config.ts");
      return existsSync(cfg)
        ? (relPath(cfg) ?? src)
        : (relPath(mm.path) ?? src);
    }
    return src;
  };

  const resolveStoreSource = (
    configPath: string | undefined,
    entriesBySeg: Map<string, IConfigEntry>,
  ): { origin: string; detail: string } | null => {
    if (!configPath) return null;
    const dot = configPath.indexOf(".");
    if (dot < 0) return null;
    const seg = configPath.slice(0, dot).toLowerCase();
    const field = configPath.slice(dot + 1).toLowerCase();
    const entry = entriesBySeg.get(seg);
    if (!entry?.provenance) return null;
    // Les clés de provenance gardent la CASSE D'ORIGINE (ex. `tokenStore.store`) →
    // retrouver la clé réelle par comparaison insensible à la casse.
    const key = Object.keys(entry.provenance).find(
      (k) => k.toLowerCase() === field,
    );
    const origin = key ? entry.provenance[key] : undefined;
    if (!origin || !key) return null;
    if (origin === "env") {
      return {
        origin,
        detail: entry.envKeys[key] ?? "variable d'environnement",
      };
    }
    if (origin === "app") {
      return {
        origin,
        detail: resolveSourceFile(
          entry.overriddenBy[key] ?? "nodefony.config.ts",
        ),
      };
    }
    if (origin === "runtime") {
      return { origin, detail: "édition à chaud (Studio)" };
    }
    return { origin, detail: "défaut du schéma" };
  };

  const endpoints: IAdminEndpoint[] = [
    {
      path: "health",
      summary: "Liveness probe — process up + boot status",
      handler: () => ({
        status: kernel.booted ? "ok" : "booting",
        booted: kernel.booted,
        uptime: process.uptime(),
        pid: process.pid,
      }),
    },
    {
      // PUBLIC + GRADUÉ. La zone `nodefony-liveness` (framework config,
      // `module-security`) place CETTE route hors `nodefony-admin` avec
      // `["session","anonymous"]` : un appelant ANONYME (sonde k8s/Docker/
      // monitoring, NON authentifiée) reçoit le minimum vital (liveness +
      // readiness) ; un appelant AUTHENTIFIÉ (cookie session BFF) reçoit les
      // détails runtime (≡ `info`). Pattern Spring Actuator
      // `show-details: when-authorized`. `environment` est public par dessein
      // (trivialement déductible côté client → pas une fuite). Readiness : 503
      // tant que le boot n'est pas fini → k8s retire le pod du load-balancer.
      // PAS de `role` : la route est atteignable par tous ; la gradation se fait
      // dans le handler selon `request.roles` (fail-closed = minimum vital).
      path: "livez",
      public: true,
      summary:
        "Liveness/readiness probe (PUBLIC) — détails runtime gradués par authentification",
      handler: (request: IAdminRequest) => {
        const report = kernel.getBootReport();
        const minimal = {
          status: kernel.booted ? "ok" : "booting",
          booted: kernel.booted,
          ready: kernel.booted,
          // Boot DÉGRADÉ = des modules ont été ignorés (fail-soft) OU aucun serveur
          // n'écoute alors qu'attendu. Booléen volontairement EXPOSÉ à l'anonyme
          // (sonde monitoring / superviseur dev) : signal de santé, AUCUNE fuite (pas
          // de noms). Les détails (`modulesSkipped`) restent réservés au privilégié.
          degraded: report.modulesSkipped.length > 0 || !report.healthy,
          uptime: process.uptime(),
          environment: kernel.environment,
        };
        const httpStatus = kernel.booted ? 200 : 503;
        // Anonyme = aucun rôle ou uniquement ROLE_ANONYMOUS → minimum vital.
        const privileged = request.roles.some((r) => r !== "ROLE_ANONYMOUS");
        if (!privileged) return { status: httpStatus, body: minimal };
        return {
          status: httpStatus,
          body: {
            ...minimal,
            version: kernel.version,
            debug: kernel.debug,
            pid: process.pid,
            node: process.version,
            platform: process.platform,
            memory: process.memoryUsage(),
            modules: Object.keys(kernel.getModules()).length,
            // Détail du « dégradé » réservé au privilégié : quels modules ignorés +
            // comment remédier (cf IBootReport / BootReport « vert mais cassé »).
            modulesSkipped: report.modulesSkipped,
            remediation: report.remediation,
            cluster: { isCluster: process.env.NODEFONY_CLUSTER === "1" },
            backplanes: {
              log: {
                driver: getActiveLogDriver()?.name ?? null,
                sink: Syslog.logSinkName,
              },
            },
            git: GitService.read(),
          },
        };
      },
    },
    {
      path: "info",
      summary: "Runtime identity — version, environment, host",
      handler: () => ({
        version: kernel.version,
        environment: kernel.environment,
        debug: kernel.debug,
        domain: kernel.domain,
        pid: process.pid,
        node: process.version,
        platform: process.platform,
        uptime: process.uptime(),
        modules: Object.keys(kernel.getModules()).length,
        // Topologie process (cloud-native, per-instance). `NODEFONY_CLUSTER=1`
        // posé par le master, hérité au fork → `true` dans chaque worker. Le
        // décompte des workers est agrégé ailleurs (master → realtime:health) :
        // ici on ne rapporte QUE ce process (pas d'agrégation dans le data plane).
        cluster: { isCluster: process.env.NODEFONY_CLUSTER === "1" },
        // Fonds de panier (« backplanes ») — info rapide pour la topbar Studio.
        // LOG Backplane : driver de relecture actif (axe DESTINATION queryable)
        // + sink d'écriture (axe WRITE). Le Realtime Backplane vit dans son
        // module (cycle interdit framework→realtime) → lu côté Studio depuis
        // `/nodefony/realtime/api/health`.
        backplanes: {
          log: {
            driver: getActiveLogDriver()?.name ?? null,
            sink: Syslog.logSinkName,
          },
        },
        // Identité git (branche + commit court) — lecture `.git`, sans spawn.
        git: GitService.read(),
      }),
    },
    {
      path: "processes",
      summary:
        "Dev process topology (supervisor → server → Vite) + server ports — `nodefony status` over the data plane",
      handler: async () => {
        // La topologie supervisor → serveur → Vite n'existe qu'en DÉVELOPPEMENT
        // (portée par le DevSupervisor). Hors dev (prod/cluster cloud-native = 1
        // process par pod), on n'engage PAS de scan `ps` (coût + sur une machine
        // partagée il observerait des process étrangers) → rapport vide explicite.
        // RBAC ADMIN (défaut du broker). cf devProcess / collectDevStatus (core).
        if (!devGuard())
          return {
            devMode: false,
            supported: true,
            running: false,
            processes: [],
            ports: [],
            summary: {
              supervisors: 0,
              servers: 0,
              vites: 0,
              portsUp: 0,
              portsTotal: 0,
            },
            warnings: [],
            pidfile: { path: "", pid: null, alive: false },
          };
        // includeSelf : ce handler tourne DANS le serveur enfant (`nodefony-dev-server`)
        // → il doit SE compter, sinon le rôle « server » manquerait à la topologie.
        const report = await collectDevStatus(REPO_ROOT, { includeSelf: true });
        return { devMode: true, ...report };
      },
    },
    {
      path: "modules",
      summary: "Loaded modules with their versions (+ core pseudo-module)",
      handler: async () => {
        const modules = kernel.getModules();
        // Le core (`@nodefony/core`) n'est pas un module chargé : on l'injecte
        // en tête comme pseudo-module pour qu'il ait sa carte dans Studio.
        const core = await readCoreInfo();
        const list: Array<Record<string, unknown>> = [
          {
            key: CORE_KEY,
            name: core.name,
            version: core.version,
            isApp: false,
            path: relPath(core.path),
          },
        ];
        for (const name of Object.keys(modules)) {
          const mod = modules[name];
          list.push({
            key: name,
            name: mod.getModuleName?.() ?? name,
            version: mod.getModuleVersion?.() ?? null,
            isApp: mod.isApp ?? false,
            path: relPath(mod.path),
          });
        }
        return list;
      },
    },
    {
      path: "config",
      summary:
        "Aggregated config of all modules (effective values redacted + JSON Schema + per-field provenance) for the global config page",
      handler: async () => ({ modules: buildConfigEntries() }),
    },
    {
      // Écran Studio « Stores » : état RUNTIME de la persistance (Phase 0.8 lot 6).
      // Pour chaque brique : store effectivement résolu au boot (replis inclus),
      // provenance (infra déclarée vs explicite), backends réellement enregistrés.
      // La donnée vient du registre `kernel.storeResolutions` (alimenté par chaque
      // consommateur au boot) → ce cœur `framework` n'importe AUCUN registre de
      // `security`/`http` (cycle interdit). L'infra déclarée est renvoyée avec ses
      // URLs REDACTÉES (credentials masqués). Réservé admin (route non `public`).
      path: "stores",
      summary:
        "Runtime persistence stores per brick (resolved store, provenance, available backends) + declared infra",
      handler: () => {
        const infra = kernel.infra;
        // Provenance par champ (default/app/env + source) pour NOMMER d'où vient
        // chaque store explicite — indexée par basename de module.
        const entriesBySeg = new Map(
          buildConfigEntries().map((e) => [e.seg, e]),
        );
        return {
          infra: {
            database: infra.database
              ? {
                  scheme: infra.database.scheme,
                  family: infra.database.family,
                  dialect: infra.database.dialect,
                  url: redactInfraUrl(infra.database.url),
                }
              : null,
            cache: infra.cache
              ? { url: redactInfraUrl(infra.cache.url) }
              : null,
            logs: infra.logs
              ? {
                  lokiUrl: infra.logs.lokiUrl
                    ? redactInfraUrl(infra.logs.lokiUrl)
                    : null,
                  opensearchUrl: infra.logs.opensearchUrl
                    ? redactInfraUrl(infra.logs.opensearchUrl)
                    : null,
                }
              : null,
          },
          stores: kernel.storeResolutions.map((res) => ({
            ...res,
            source: resolveStoreSource(res.configPath, entriesBySeg),
          })),
        };
      },
    },
    {
      // ÉDITION LIVE d'UN champ de config — surface SENSIBLE, fail-closed à chaque
      // étape : (1) dev-only (prod = immuable, 12-factor) ; (2) module + schéma Zod
      // requis ; (3) champ `runtimeMutable` SEUL (jamais secret/réservé/dérivé) ;
      // (4) valeur validée contre le JSON Schema du module (≡ overrides `NF__*`) ;
      // (5) appliquée en RAM (`mod.options`, relue par requête) — ÉPHÉMÈRE (perdue
      // au restart, par dessein) ; (6) auditée. Le reste = recette d'override.
      path: "config/{module}",
      method: "PATCH",
      summary:
        "Live-edit one runtimeMutable config field of a module (dev only) — validated + audited",
      handler: (request: IAdminRequest) => {
        // 1. Prod immuable : la config se change par redéploiement, pas en RAM.
        if (!devGuard()) {
          return {
            status: 409,
            body: {
              error: "Config live-edit disabled outside development",
              reason: "prod_immutable",
            },
          };
        }
        const key = request.params.module;
        const mod = kernel.getModules()[key] as unknown as
          ConfigModuleLike | undefined;
        if (!mod) {
          return { status: 404, body: { error: "Module not found", key } };
        }
        // 2. Corps { path, value }.
        const body = (request.body ?? {}) as {
          path?: unknown;
          value?: unknown;
        };
        if (typeof body.path !== "string" || body.path.length === 0) {
          return { status: 400, body: { error: "Missing 'path'" } };
        }
        const segments = body.path.split(".").filter((s) => s.length > 0);
        if (segments.length === 0) {
          return {
            status: 400,
            body: { error: "Invalid 'path'", path: body.path },
          };
        }
        const value = body.value;
        // 3. Schéma Zod requis (édition typée + validation).
        const schema = mod.configSchema();
        if (!schema) {
          return {
            status: 409,
            body: {
              error: "Module has no Zod schema — live-edit unavailable",
              reason: "no_schema",
            },
          };
        }
        // 4. Nœud du champ.
        const node = navigateSchemaNode(schema, segments);
        if (!node) {
          return {
            status: 404,
            body: { error: "Unknown config path", path: body.path },
          };
        }
        // 5. Éditabilité (secret > réservé > dérivé > boot) → sinon recette.
        const flags = nodeFlags(node);
        const seg = computeSeg(
          mod.getModuleName?.() ?? key,
          mod.isApp ?? false,
        );
        const reason = notEditableReason(flags);
        if (reason) {
          return {
            status: 409,
            body: {
              error: "Field is not live-editable",
              reason,
              recipe: recipeFor(seg, segments, flags.secret),
            },
          };
        }
        // 6. Validation de la valeur (type / enum / bornes / longueur).
        const verdict = validateLeafValue(node, value);
        if (!verdict.ok) {
          return {
            status: 422,
            body: { error: "Invalid value", message: verdict.message },
          };
        }
        // 7. Application en mémoire (mute `mod.options`). `before` pour l'audit.
        const opts = (mod.options ?? {}) as Record<string, unknown>;
        const before = getResolvedPath(opts, segments);
        if (!applyResolvedPath(opts, segments, value)) {
          return {
            status: 422,
            body: {
              error: "Path not present in module config",
              path: body.path,
            },
          };
        }
        // 7b. Propager aux SERVICES du module. `Service` SHALLOW-clone `options` à
        // la construction (`{ ...options }`) → un scalaire top-level (ex. http
        // `headerServer`, lu par requête sur `HttpKernel.options`) ne se propage PAS
        // par la référence (≠ nested, partagé). On applique le même chemin à chaque
        // service porteur (`applyResolvedPath` = no-op si la clé n'existe pas).
        const svcMod = mod as unknown as {
          getServiceNames?: () => string[];
          get?: (name: string) => unknown;
        };
        for (const sname of svcMod.getServiceNames?.() ?? []) {
          const svc = svcMod.get?.(sname) as {
            options?: Record<string, unknown>;
            onConfigChanged?: (path?: string[]) => void;
          } | null;
          if (svc?.options && svc.options !== opts) {
            applyResolvedPath(svc.options, segments, value);
          }
          // Seam optionnel : un service qui MET EN CACHE des valeurs dérivées de
          // la config (ex. HttpKernel : en-têtes sécurité, trust-proxy) recompute
          // ici → l'édition d'un champ `runtimeMutable` porté par un cache prend effet.
          svc?.onConfigChanged?.(segments);
        }
        // Marque le chemin « édité à chaud » → provenance `runtime` au re-render.
        let edited = runtimeEdited.get(key);
        if (!edited) {
          edited = new Set();
          runtimeEdited.set(key, edited);
        }
        edited.add(body.path.toLowerCase());
        // 8. Audit (catégorie `config`) — secret jamais ici (refusé en 5).
        auditConfigChange(kernel, request, key, body.path, before, value);
        return {
          status: 200,
          body: {
            ok: true,
            key,
            path: body.path,
            value,
            provenance: "runtime",
          },
        };
      },
    },
    {
      // État courant du debug runtime (lecture) : DEBUG global actif ? + overrides
      // par-module (module → seuil numérique). Alimente le toggle/bandeau Studio.
      path: "log/level",
      summary:
        "Current runtime debug state — global DEBUG flag + active per-module overrides",
      handler: () => {
        const syslog = (kernel as unknown as { syslog?: Syslog | null }).syslog;
        if (!syslog) {
          return { status: 503, body: { error: "Syslog unavailable" } };
        }
        return {
          globalDebug: syslog.severityEnabled("DEBUG"),
          overrides: syslog.getDebugOverrides(),
          // Échéances (epoch ms) des overrides temporisés → countdown Studio.
          expiresAt: syslog.getDebugOverrideExpiry(),
        };
      },
    },
    {
      // DEBUG RUNTIME CIBLÉ (à chaud, sans reboot) — surface SENSIBLE mais, à la
      // différence de `config/{module}`, ACTIVE EN PROD (son but : débugger un
      // incident sans redéploiement). Garde-fous : (1) RBAC ROLE_NODEFONY_ADMIN
      // (défaut du producteur) ; (2) PAR MODULE uniquement (la bascule globale
      // reste l'env `NF__DEBUG`, décidée au boot) ; (3) niveau validé STRICT (422
      // sinon) ; (4) AUTO-EXTINCTION imposée (ttl défaut + plafonné → un debug
      // ouvert ici ne reste JAMAIS allumé) ; (5) audité (catégorie `log`).
      path: "log/level",
      method: "PATCH",
      summary:
        "Turn targeted per-module debug on/off at runtime (prod-safe, auto-expiring, audited)",
      handler: (request: IAdminRequest) => {
        const syslog = (kernel as unknown as { syslog?: Syslog | null }).syslog;
        if (!syslog) {
          return { status: 503, body: { error: "Syslog unavailable" } };
        }
        const body = (request.body ?? {}) as {
          module?: unknown;
          level?: unknown;
          ttlMs?: unknown;
        };
        if (typeof body.module !== "string" || body.module.length === 0) {
          return {
            status: 400,
            body: { error: "Missing 'module' (per-module debug only)" },
          };
        }
        const module = body.module;
        // Clear : level "off" / null / "" → éteindre ce module.
        if (body.level === "off" || body.level === null || body.level === "") {
          const cleared = syslog.clearDebugOverride(module);
          auditLogLevelChange(kernel, request, module, "clear", null, null);
          return {
            ok: true,
            module,
            cleared,
            overrides: syslog.getDebugOverrides(),
          };
        }
        // Set : niveau validé STRICT (nom ou numérique 0-7).
        if (typeof body.level !== "string" && typeof body.level !== "number") {
          return { status: 400, body: { error: "Missing 'level'" } };
        }
        const level = Syslog.severityFromInput(body.level);
        if (level === null) {
          return {
            status: 422,
            body: { error: "Invalid 'level'", level: body.level },
          };
        }
        // Auto-extinction IMPOSÉE par l'endpoint (≠ core, qui tolère le permanent) :
        // défaut 15 min, plafond 60 min → jamais de debug oublié allumé en prod.
        const reqTtl =
          typeof body.ttlMs === "number" && body.ttlMs > 0
            ? body.ttlMs
            : DEFAULT_DEBUG_TTL_MS;
        const ttlMs = Math.min(reqTtl, MAX_DEBUG_TTL_MS);
        syslog.setDebugOverride(module, level, ttlMs);
        auditLogLevelChange(kernel, request, module, "set", level, ttlMs);
        return {
          ok: true,
          module,
          level,
          ttlMs,
          overrides: syslog.getDebugOverrides(),
        };
      },
    },
    {
      // Endpoint PARAMÉTRÉ — exerce la regexp de routage `{name}` + l'extraction
      // de params (`request.params.name`). `{name}` = mono-segment → utiliser la
      // clé courte du module (`http`, `framework`), pas `@nodefony/http` (slash).
      path: "module/{name}",
      summary: "Detail of one module by key (http, framework, … or core)",
      handler: async (request) => {
        const key = request.params.name;
        // Pseudo-module core : socle sans services/config/routes propres.
        if (key === CORE_KEY) {
          const core = await readCoreInfo();
          return {
            key: CORE_KEY,
            name: core.name,
            version: core.version,
            isApp: false,
            path: relPath(core.path),
            dependencies: core.dependencies,
            services: [],
            config: {},
            configSchema: null,
            docsCount: await countModuleDocs(core.path),
            symbolsCount: (await listModuleSymbols(CORE_PACKAGE)).length,
            coverageLines: (await readCoverage(core.path)).total?.lines ?? null,
          };
        }
        const mod = kernel.getModules()[key];
        if (!mod) {
          // Enveloppe IAdminResponse : `status` présent → reconnue par le broker.
          return { status: 404, body: { error: "Module not found", key } };
        }
        // Services enregistrés par le module + classe d'implémentation (le nom
        // de registration vient de Module.getServiceNames, la classe du
        // container partagé).
        const services = mod.getServiceNames().map((sname) => ({
          name: sname,
          class:
            (mod.get(sname) as { constructor?: { name?: string } } | null)
              ?.constructor?.name ?? null,
        }));
        // Succès = donnée brute (le broker assume 200). NE PAS wrapper dans
        // `{ body }` sans `status`/`headers` → normalize ne le reconnaît pas
        // comme enveloppe et double-wrappe.
        // Sous-ensemble CONFIG (valeurs redactées + schéma + provenance par champ
        // + segment d'override). Logique partagée avec l'agrégat `config` (DRY).
        const cfg = computeConfigEntry(
          key,
          mod as unknown as ConfigModuleLike,
          runtimeEdited.get(key),
        );
        return {
          key,
          name: cfg.name,
          version: mod.getModuleVersion?.() ?? null,
          isApp: cfg.isApp,
          path: relPath(mod.path),
          dependencies: mod.getDependencies?.() ?? [],
          services,
          config: cfg.config,
          // JSON Schema de la config (réglages documentés + flags meta) si le
          // module est migré Zod — sinon null (Studio retombe sur le dump brut).
          configSchema: cfg.configSchema,
          // Origine de chaque valeur résolue (default | app | env) — badge Studio.
          provenance: cfg.provenance,
          // Segment d'adressage des overrides `NF__<SEG>__…` + var d'env réelle
          // posée par champ (« qui surcharge, où ») — page config + onglet module.
          seg: cfg.seg,
          envKeys: cfg.envKeys,
          docsCount: await countModuleDocs(mod.path),
          symbolsCount: (await listModuleSymbols(cfg.name)).length,
          coverageLines: (await readCoverage(mod.path)).total?.lines ?? null,
        };
      },
    },
    {
      // Dépendances du module + version installée (range déclarée vs installée).
      path: "module/{name}/dependencies",
      summary: "Module dependencies with installed versions",
      handler: async (request) => {
        const target = resolveTarget(request.params.name);
        if (!target) {
          return {
            status: 404,
            body: { error: "Module not found", key: request.params.name },
          };
        }
        return {
          key: request.params.name,
          deps: await readDependencies(target.path),
        };
      },
    },
    {
      // Check MAJ des deps externes (registry npm) — réseau, on-demand.
      path: "module/{name}/dependencies/outdated",
      summary: "Check external dependencies for updates (npm registry)",
      handler: async (request) => {
        const target = resolveTarget(request.params.name);
        if (!target) {
          return {
            status: 404,
            body: { error: "Module not found", key: request.params.name },
          };
        }
        const deps = await readDependencies(target.path);
        return {
          key: request.params.name,
          outdated: await checkOutdated(deps),
        };
      },
    },
    {
      // Sommaire des docs colocalisées au module (`<modulePath>/docs/*.md`).
      // Emplacement HYBRIDE (cf ADR-0001) : la prose vit dans le module ; ce
      // producteur kernel l'expose de façon cross-module pour Studio.
      path: "module/{name}/docs",
      summary: "Documentation index of one module (markdown in <module>/docs)",
      handler: async (request) => {
        const key = request.params.name;
        const target = resolveTarget(key);
        if (!target) {
          return { status: 404, body: { error: "Module not found", key } };
        }
        return { key, docs: await listModuleDocs(target.path) };
      },
    },
    {
      // Markdown brut d'une doc + frontmatter + fraîcheur git (dérive doc↔code).
      path: "module/{name}/docs/{slug}",
      summary: "Raw markdown of one module doc by slug",
      handler: async (request) => {
        const key = request.params.name;
        const target = resolveTarget(key);
        if (!target) {
          return { status: 404, body: { error: "Module not found", key } };
        }
        const doc = await readModuleDoc(target.path, request.params.slug);
        if (!doc) {
          return {
            status: 404,
            body: { error: "Doc not found", key, slug: request.params.slug },
          };
        }
        return doc;
      },
    },
    {
      // Référence API auto depuis `.ai/symbols.json` (jamais de .d.ts manuel).
      path: "module/{name}/symbols",
      summary: "Exported TS symbols + TSDoc descriptions (.ai/symbols.json)",
      handler: async (request) => {
        const key = request.params.name;
        const target = resolveTarget(key);
        if (!target) {
          return { status: 404, body: { error: "Module not found", key } };
        }
        return {
          key,
          package: target.pkg,
          symbols: await listModuleSymbols(target.pkg),
        };
      },
    },
    {
      // Dernier rapport de couverture (vitest+v8, json-summary). Studio AFFICHE,
      // ne lance pas les tests. `available:false` si pas encore généré.
      path: "module/{name}/coverage",
      summary: "Latest test coverage report (vitest json-summary)",
      handler: async (request) => {
        const key = request.params.name;
        const target = resolveTarget(key);
        if (!target) {
          return { status: 404, body: { error: "Module not found", key } };
        }
        return { key, ...(await readCoverage(target.path)) };
      },
    },
    {
      // Liste des fichiers de test du module (onglet Tests Studio).
      path: "module/{name}/tests",
      summary: "List test files of one module",
      handler: async (request) => {
        const key = request.params.name;
        const target = resolveTarget(key);
        if (!target) {
          return { status: 404, body: { error: "Module not found", key } };
        }
        return {
          key,
          devMode:
            kernel.environment === "development" || Boolean(kernel.debug),
          files: await listTestFiles(target.path),
          // Toutes les suites groupées par catégorie (intégration/e2e/charge/
          // mémoire…) — lecture seule (seul `unit` est lançable depuis Studio).
          groups: await listTestGroups(target.path),
        };
      },
    },
    {
      // DÉMARRE un run de tests en arrière-plan → rend un jobId immédiatement
      // (run async, cf testJobs). ⚠️ EXÉCUTE un process → garde DEV-ONLY strict.
      path: "module/{name}/test/run",
      method: "POST",
      summary: "Start a test run (dev only) — 1 file or whole suite → jobId",
      handler: (request) => {
        if (!devGuard()) {
          return {
            status: 403,
            body: { error: "Test runner disabled outside development" },
          };
        }
        const key = request.params.name;
        const target = resolveTarget(key);
        if (!target) {
          return { status: 404, body: { error: "Module not found", key } };
        }
        const body = (request.body ?? {}) as { file?: unknown };
        let file: string | undefined;
        if (typeof body.file === "string" && body.file) {
          // Allowlist stricte : pas de traversée (`..`), pas de flag CLI injecté
          // (préfixe `-` → traité comme option par vitest même avec `--`), suffixe
          // `.test.ts` obligatoire. L'exécution ajoute aussi `--` (cf runModuleTests).
          if (
            body.file.includes("..") ||
            body.file.startsWith("-") ||
            !body.file.endsWith(".test.ts")
          ) {
            return {
              status: 400,
              body: { error: "Invalid test file", file: body.file },
            };
          }
          file = body.file;
        }
        const jobId = randomUUID();
        testJobs.set(jobId, { status: "running", startedAt: Date.now() });
        // borne la map (16 derniers jobs)
        if (testJobs.size > 16) {
          const oldest = [...testJobs.entries()].sort(
            (a, b) => a[1].startedAt - b[1].startedAt,
          )[0];
          if (oldest) testJobs.delete(oldest[0]);
        }
        // fire-and-forget : ne PAS await (le client poll via GET ?jobId)
        runModuleTests(target.path, file).then(
          (result) =>
            testJobs.set(jobId, {
              status: "done",
              startedAt: Date.now(),
              result,
            }),
          (e) =>
            testJobs.set(jobId, {
              status: "done",
              startedAt: Date.now(),
              result: {
                ok: false,
                code: null,
                passed: 0,
                failed: 0,
                durationMs: 0,
                output: String(e),
                mode: "",
              },
            }),
        );
        return { key, jobId, running: true };
      },
    },
    {
      // Statut/résultat d'un run async (poll). `done:false` tant qu'il tourne.
      path: "module/{name}/test/run",
      method: "GET",
      summary: "Poll a test run by ?jobId",
      handler: (request) => {
        const jobId = String(request.query.jobId ?? "");
        const job = jobId ? testJobs.get(jobId) : undefined;
        if (!job)
          return { status: 404, body: { error: "Unknown jobId", jobId } };
        return { jobId, done: job.status === "done", ...(job.result ?? {}) };
      },
    },
  ];

  return {
    adminNamespace: "kernel",
    adminDescriptor: () => descriptor,
    adminEndpoints: () => endpoints,
  };
}
