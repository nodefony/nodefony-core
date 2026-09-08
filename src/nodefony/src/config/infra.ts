/**
 * Résolution de l'INFRA DÉCLARÉE depuis l'environnement (modèle « infra déclarée »).
 *
 * L'utilisateur ne configure pas chaque brique : il déclare son infra via des
 * URLs (pattern Rails/Django/Symfony) :
 * - `NF_DATABASE_URL` (alias plateforme `DATABASE_URL`) → infra `database` (durable)
 * - `NF_REDIS_URL` (alias plateforme `REDIS_URL`) → infra `cache` (éphémère partagé)
 * - `NF_LOKI_URL` / `NF_OPENSEARCH_URL` → infra `logs` (relecture backplane)
 *
 * Les briques dont le store vaut `"auto"` sont résolues par l'infra déclarée
 * ({@link resolveAutoStore}) ; une valeur explicite gagne toujours (moindre
 * surprise, 12-factor). Aucune cascade runtime implicite : charger un module
 * ne déplace jamais une brique — seule la déclaration d'infra le fait.
 */

/** Dialecte SQL déduit du scheme de l'URL du infra `database`. */
export type InfraSqlDialect = "sqlite" | "postgres" | "mysql";

/** Famille du infra `database` — pilote le choix de l'adapter (drizzle/mongoose). */
export type DatabaseFamily = "sql" | "mongo";

/** Infra `database` résolu depuis `NF_DATABASE_URL`/`DATABASE_URL`. */
export interface IInfraDatabase {
  /** URL déclarée telle quelle (peut porter des credentials — ne jamais logger brute). */
  url: string;
  /** Scheme normalisé en minuscules, sans `:` (ex. `postgres`, `sqlite`, `mongodb`). */
  scheme: string;
  family: DatabaseFamily;
  /** Dialecte SQL (famille `sql`) — `null` pour la famille `mongo`. */
  dialect: InfraSqlDialect | null;
}

/** Infra `cache` résolu depuis `NF_REDIS_URL`/`REDIS_URL`. */
export interface IInfraCache {
  /** URL redis déclarée (peut porter des credentials — ne jamais logger brute). */
  url: string;
}

/** Infra `logs` (relecture backplane) — les DEUX URLs peuvent être présentes. */
export interface IInfraLogs {
  lokiUrl?: string;
  opensearchUrl?: string;
}

/** L'infra déclarée — `null` = non déclarée. */
export interface IInfra {
  database: IInfraDatabase | null;
  cache: IInfraCache | null;
  logs: IInfraLogs | null;
  /**
   * Override GLOBAL de sélection de store (`NF_STORE`) — force TOUTE brique `auto`
   * vers ce backend, en amont de toute préférence d'infra. Cas d'usage : `memory`
   * pour un banc de CHARGE (mesurer le framework sans le goulot sqlite/disque), sans
   * toucher aux configs par brique. `undefined`/`null` = pas d'override. N'affecte
   * JAMAIS un store configuré EXPLICITEMENT (celui-ci ne passe pas par `auto`).
   */
  forceStore?: string | null;
}

/** Source d'environnement (forme de `process.env`) — injectable pour les tests. */
export type InfraEnvSource = Record<string, string | undefined>;

const SQL_SCHEMES: Record<string, InfraSqlDialect> = Object.assign(
  Object.create(null) as Record<string, InfraSqlDialect>,
  {
    sqlite: "sqlite",
    postgres: "postgres",
    postgresql: "postgres",
    mysql: "mysql",
    mariadb: "mysql",
  },
);

const MONGO_SCHEMES = new Set(["mongodb", "mongodb+srv"]);

/** Première valeur non vide parmi les clés candidates (préfixe `NF_` prioritaire). */
function pick(
  env: InfraEnvSource,
  keys: readonly string[],
): string | undefined {
  for (const key of keys) {
    const value = env[key];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }
  return undefined;
}

/**
 * Parse l'URL du infra `database` : scheme → famille + dialecte.
 *
 * @throws Error si le scheme n'est pas supporté — fail-loud au boot : une URL
 *   de base inconnue ne doit JAMAIS retomber silencieusement sur sqlite.
 */
export function parseDatabaseUrl(url: string): IInfraDatabase {
  const sep = url.indexOf(":");
  const scheme = sep > 0 ? url.slice(0, sep).toLowerCase() : "";
  const dialect = scheme ? SQL_SCHEMES[scheme] : undefined;
  if (dialect) {
    return { url, scheme, family: "sql", dialect };
  }
  if (MONGO_SCHEMES.has(scheme)) {
    return { url, scheme, family: "mongo", dialect: null };
  }
  throw new Error(
    `NF_DATABASE_URL : scheme "${scheme || url}" non supporté — attendu ` +
      `sqlite:, postgres://, postgresql://, mysql://, mariadb://, mongodb:// ou mongodb+srv://`,
  );
}

/**
 * Fichier SQLite d'une URL `sqlite:` du infra `database`.
 * Formes acceptées : `sqlite::memory:`, `sqlite:./relatif.db`, `sqlite:/abs.db`,
 * `sqlite:///abs.db`. URL vide après le scheme → `:memory:`.
 */
export function sqliteFilenameFromUrl(url: string): string {
  let rest = url.slice(url.indexOf(":") + 1);
  if (rest.startsWith("//")) {
    rest = rest.slice(2);
  }
  return rest.length === 0 ? ":memory:" : rest;
}

/**
 * Résout les 3 infra déclarée depuis l'environnement. Fonction PURE
 * (aucun kernel) : consommée par le Kernel (1 fois, mémoïsé), par le contexte
 * `defineConfig` (`ctx.infra`) et par les builders de config des modules
 * adapters (drizzle/mongoose/redis) dans leur couche env.
 *
 * @param env - source d'environnement (défaut `process.env`).
 * @throws Error si l'URL du infra `database` a un scheme non supporté.
 */
export function resolveInfra(env: InfraEnvSource = process.env): IInfra {
  const databaseUrl = pick(env, ["NF_DATABASE_URL", "DATABASE_URL"]);
  const cacheUrl = pick(env, ["NF_REDIS_URL", "REDIS_URL"]);
  const lokiUrl = pick(env, ["NF_LOKI_URL"]);
  const opensearchUrl = pick(env, ["NF_OPENSEARCH_URL"]);
  let logs: IInfraLogs | null = null;
  if (lokiUrl || opensearchUrl) {
    logs = {};
    if (lokiUrl) {
      logs.lokiUrl = lokiUrl;
    }
    if (opensearchUrl) {
      logs.opensearchUrl = opensearchUrl;
    }
  }
  // Override global de store (`NF_STORE`) — force toute brique `auto` sur ce backend
  // (typiquement `memory` pour un banc de charge). Vide = pas d'override.
  const forceStore = pick(env, ["NF_STORE"]);
  return {
    database: databaseUrl ? parseDatabaseUrl(databaseUrl) : null,
    cache: cacheUrl ? { url: cacheUrl } : null,
    logs,
    forceStore: forceStore ?? null,
  };
}

/** Sentinelle des champs `store` : « laisser le framework choisir selon l'infra déclarée ». */
export const AUTO_STORE = "auto";

/** Infra vide (rien de déclaré) — fallback sûr quand le kernel est absent (tests). */
export const EMPTY_INFRA: IInfra = Object.freeze({
  database: null,
  cache: null,
  logs: null,
});

/**
 * Nature de la donnée d'une brique — pilote l'ordre de préférence des backends :
 * - `durable` (tokens, passkeys, audit, webhooks, user) → infra database.
 * - `ephemeral` (idempotence) → infra cache, sinon database.
 * - `session` → cache, sinon database, sinon fallback fichier.
 */
export type StoreKind = "durable" | "ephemeral" | "session";

/** Choix d'un backend pour `"auto"` + provenance lisible (log de boot, Studio). */
export interface IAutoStoreResolution {
  store: string;
  reason: string;
}

/** Catégorie de provenance d'un store résolu (dérivée de la valeur configurée). */
export type StoreProvenance = "infra" | "explicit";

/**
 * Résolution EFFECTIVE d'une brique de persistance, capturée au boot par le
 * consommateur (au moment exact où il pose son store au container) et retenue
 * dans le registre du Kernel ({@link IKernel.registerStoreResolution}). C'est la
 * VÉRITÉ vécue — y compris les replis annoncés du lot 4 (session → `"files"` en
 * dev) — pas une re-dérivation à la volée. Alimente l'écran Studio « Stores ».
 */
export interface IStoreResolution {
  /** Identifiant de la brique (ex. `"tokens"`, `"session"`, `"audit"`). */
  brick: string;
  /** Nature de la donnée — pilote la durabilité affichée ({@link StoreKind}). */
  nature: StoreKind;
  /** Valeur configurée telle quelle : `"auto"` (sentinelle) ou un backend explicite. */
  configured: string;
  /** Backend effectivement résolu et posé au runtime. */
  resolved: string;
  /**
   * Backends RÉELLEMENT enregistrés pour cette brique (`listXStores()`), capturés
   * par le consommateur — évite à l'endpoint d'importer les registres (le cœur
   * `@nodefony/framework` ne peut pas dépendre de `@nodefony/security`/`http`).
   */
  available: readonly string[];
  /**
   * Provenance : `"infra"` (résolu depuis l'infra déclarée, `configured === "auto"`)
   * ou `"explicit"` (backend nommé dans la config/env de l'app).
   */
  provenance: StoreProvenance;
  /** Raison lisible (FR) de la résolution — de `resolveAutoStore` ou construite. */
  reason: string;
  /** Chemin du champ de config (ex. `"security.tokenStore.store"`) — croise la provenance de champ Studio. */
  configPath?: string;
  /**
   * Emplacement PHYSIQUE lisible du store, lu depuis l'instance au boot
   * ({@link readStoreLocation}) — base SQLite pour `drizzle`. `undefined`
   * pour un store `memory` (volatil) ou un backend réseau (l'emplacement = l'infra
   * déclarée, déjà surfacée à part). Répond à « où sont écrites mes données ? » dans Studio.
   */
  location?: string;
}

/**
 * Le REMÈDE à nommer quand une brique durable se retrouve en mémoire.
 *
 * Une seule implémentation, parce qu'il y a deux causes et qu'en nommer une
 * seule envoie corriger la mauvaise chose : conseiller « déclare
 * `NF_DATABASE_URL` » à quelqu'un dont la base est parfaitement configurée le
 * fait chercher là où il n'y a rien. Vécu sur une commande en ligne dont le
 * seul tort était de ne pas déclarer son besoin de données.
 *
 * @param canOpenConnections - ce run ouvre-t-il des connexions externes ?
 *   (`runNeedsExternalServices(kernel)` chez l'appelant).
 * @returns la phrase de remède, à concaténer après la conséquence métier.
 */
export function durableStoreRemedy(canOpenConnections: boolean): string {
  return canOpenConnections
    ? `Déclarer une infra durable (NF_DATABASE_URL) ou un store persistant.`
    : `Ce run n'ouvre aucune connexion : il n'a pas déclaré \`externalServices\`. ` +
        `Une commande qui lit ou écrit des données le déclare via ` +
        `CONSOLE_DATA_RUN_PROFILE — la base configurée, elle, n'est pas en cause.`;
}

/**
 * Backends dont la fabrique de store OUVRE une connexion (ORM, serveur réseau).
 * Un run qui ne déclare pas `externalServices` ne peut en recevoir aucun par le
 * choix `auto` — sa fabrique exigerait une connexion qui n'existe pas, et le
 * démarrage échouerait au montage du store plutôt qu'à l'usage.
 * `memory` et les backends purement locaux n'y figurent pas.
 */
const CONNECTED_STORES: ReadonlySet<string> = new Set([
  "drizzle",
  "mongoose",
  "redis",
]);

/**
 * Résout la sentinelle `"auto"` d'une brique en nom de backend, borné aux
 * backends RÉELLEMENT enregistrés (`available` = `listXStores()` du registre —
 * reflète l'auto-register des adapters chargés). Couverture partielle d'une infra
 * (ex. audit sans impl mongoose) → repli `fallback` avec raison ANNONCÉE,
 * jamais d'échec : le principe « fallback annoncé, pas de dégradation
 * silencieuse » vit dans la raison retournée, que l'appelant DOIT logger.
 *
 * 🔴 **Un backend qui ouvre une CONNEXION ne peut être choisi que si le run en
 * ouvre.** `infra` dit quelle infrastructure est DÉCLARÉE ; elle ne dit pas si
 * CE run s'y connecte — deux questions distinctes depuis que le profil de run
 * porte `externalServices` (le run le déclare, cf `runNeedsExternalServices`).
 * Les confondre choisissait `drizzle` pour une commande en ligne qui ne
 * connecte aucun ORM : la fabrique du store exigeait ensuite un ORM connecté et
 * le démarrage mourait, y compris pour `nodefony inspect routes`. Le verdict
 * s'INJECTE (`canOpenConnections`), il ne se déduit pas ici : ce module est pur
 * et ne connaît aucun kernel.
 *
 * @param kind - nature de la donnée ({@link StoreKind}).
 * @param infra - infra résolue ({@link resolveInfra}).
 * @param available - backends enregistrés dans le registre de la brique.
 * @param fallback - backend de repli (défaut `"memory"` — c'est aussi ce que passe
 *   le service de session : aucun appelant ne demande un autre repli).
 * @param canOpenConnections - ce run ouvre-t-il des connexions externes ?
 *   `runNeedsExternalServices(kernel)` chez l'appelant. `false` écarte tout
 *   backend connecté du choix `auto` — un store explicitement configuré, lui,
 *   ne passe pas par ici et échoue franchement, comme il doit.
 */
export function resolveAutoStore(
  kind: StoreKind,
  infra: IInfra,
  available: readonly string[],
  fallback = "memory",
  canOpenConnections = true,
): IAutoStoreResolution {
  // 🔴 Un run qui n'ouvre AUCUNE connexion ne reçoit AUCUN backend connecté —
  // et le filtre s'applique PARTOUT, infra déclarée comprise.
  //
  // La tentation est de préserver l'infra que l'utilisateur a écrite, pour que
  // sa base injoignable « se voie ». C'est un piège : ce qu'on obtient alors
  // n'est pas un signal, c'est un store qui LÈVE au montage (fabrique) ou, pire,
  // qui DÉGRADE EN SILENCE à l'usage (`DrizzleAuditStore.append` rend la main
  // sans un mot quand l'ORM n'est pas connecté). Un store connecté « gardé » est
  // fail-OPEN : une denylist qui ne lit rien accepte un jeton révoqué, un audit
  // qui n'écrit rien ne laisse aucune trace — pendant que le registre affiche
  // `resolved: "drizzle"` et un emplacement de fichier. `memory` est fail-CLOSED,
  // véridique, et annoncé une fois avec sa raison.
  //
  // Le signal « base déclarée injoignable » n'est pas perdu pour autant : il
  // appartient au run qui DÉCLARE en avoir besoin, où l'échec de connexion est
  // fatal en développement comme en production (`DrizzleService`). Un run qui ne
  // déclare rien n'a pas d'opinion sur la base — ce n'est pas un silence, c'est
  // une non-question.
  const usable = canOpenConnections
    ? available
    : available.filter((s) => !CONNECTED_STORES.has(s));
  /** Un backend a-t-il été écarté par le profil du run ? Sert la VÉRACITÉ des raisons. */
  const discarded = canOpenConnections
    ? []
    : available.filter((s) => CONNECTED_STORES.has(s));
  const profileNote =
    discarded.length > 0
      ? ` ; ${discarded.join("/")} écarté(s) : ce run n'a pas déclaré ` +
        `\`externalServices\` (une commande qui lit ou écrit des données le ` +
        `déclare via CONSOLE_DATA_RUN_PROFILE)`
      : "";

  // Override GLOBAL (`NF_STORE`) — PRIORITÉ MAX sur toute préférence d'infra : force
  // ce backend pour toute brique `auto` s'il est enregistré (banc de charge « tout en
  // memory » en 1 variable). Backend demandé mais absent de CETTE brique → on l'ignore
  // (jamais de crash) et on retombe sur la résolution normale.
  if (infra.forceStore && usable.includes(infra.forceStore)) {
    return {
      store: infra.forceStore,
      reason: `NF_STORE=${infra.forceStore} (override global — banc de charge)`,
    };
  }
  const preferences: IAutoStoreResolution[] = [];
  if (kind !== "durable" && infra.cache) {
    preferences.push({ store: "redis", reason: "infra cache (NF_REDIS_URL)" });
  }
  if (infra.database) {
    const store = infra.database.family === "mongo" ? "mongoose" : "drizzle";
    preferences.push({
      store,
      reason: `infra database (${infra.database.scheme})`,
    });
  }
  for (const preference of preferences) {
    if (usable.includes(preference.store)) {
      return preference;
    }
  }
  if (preferences.length > 0) {
    const wanted = preferences.map((p) => p.store).join("/");
    const fallbackStore =
      CONNECTED_STORES.has(fallback) && !canOpenConnections
        ? "memory"
        : fallback;
    return {
      store: fallbackStore,
      reason:
        `backend d'infra ${wanted} indisponible sur cette brique ` +
        `(enregistrés : ${available.join(", ") || "aucun"}) — repli "${fallbackStore}"` +
        profileNote,
    };
  }
  // Aucune infra RÉSEAU déclarée : préférer un backend LOCAL PERSISTANT réellement
  // chargé (`drizzle` = sqlite local, puis `mongoose`) AVANT le repli volatil.
  // C'est la bascule « sqlite par défaut » : dev ET prod mono-nœud persistent sans
  // aucune config (`nodefony new` marche, tes données survivent au redémarrage) ; on
  // ne « sort » de sqlite qu'en déclarant une infra réseau (NF_DATABASE_URL) pour
  // scaler en multi-nœud. Ordre = même préférence que l'infra database (sql avant mongo).
  for (const local of ["drizzle", "mongoose"] as const) {
    if (usable.includes(local)) {
      return {
        store: local,
        reason: `aucune infra déclarée — backend local persistant "${local}" (mono-nœud)`,
      };
    }
  }
  // Le repli lui-même peut être connecté (`provisionUsers` demande `"drizzle"`) :
  // sans cette borne, la porte de derrière rouvrirait ce que le filtre a fermé.
  const finalFallback =
    !canOpenConnections && CONNECTED_STORES.has(fallback) ? "memory" : fallback;
  return {
    store: finalFallback,
    reason:
      `aucune infra déclarée, aucun backend persistant chargé — repli ` +
      `"${finalFallback}"` +
      (finalFallback === "memory" ? " (volatil)" : "") +
      profileNote,
  };
}

/**
 * Déduit le nom court du backend d'un store à partir de la classe concrète de
 * son instance (convention de nommage `<Backend>XxxStore` → `drizzle`, `mongoose`,
 * `redis`, `memory`, `file`). Sert à retrouver le backend RÉEL d'un adapter posé
 * au container quand la brique a été résolue en `"auto"` (l'adapter court-circuite
 * la fabrique nommée). Classe non reconnue → nom de classe brut (honnête).
 *
 * @param store - instance de store (lue défensivement — seul `constructor.name`).
 * @returns nom court du backend, ou `"inconnu"` si l'instance n'expose pas de classe.
 */
export function deriveStoreBackend(store: unknown): string {
  const name = (store as { constructor?: { name?: string } } | null)
    ?.constructor?.name;
  if (!name) {
    return "inconnu";
  }
  const match = /^(Drizzle|Mongoose|Redis|Memory|File)/.exec(name);
  return match ? match[1].toLowerCase() : name;
}

/**
 * Lit l'emplacement PHYSIQUE d'un store depuis son instance (getter public
 * `location`), pour l'écran Studio « Stores » — répond à « où mes données sont-elles
 * écrites ? ». Un store fichier (passkeys, TOTP, sessions) expose le chemin de son
 * fichier/dossier ; un store `memory` ou un backend réseau (drizzle/redis/mongoose)
 * n'expose rien → `undefined` (l'UI dérive « en mémoire » ou renvoie à l'infra).
 *
 * @param store - instance de store (lue défensivement — seul un getter `location` string).
 * @returns chemin lisible, ou `undefined` si le store n'expose pas d'emplacement.
 */
export function readStoreLocation(store: unknown): string | undefined {
  const location = (store as { location?: unknown } | null)?.location;
  return typeof location === "string" && location.length > 0
    ? location
    : undefined;
}
