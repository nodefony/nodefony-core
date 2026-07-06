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
  return {
    database: databaseUrl ? parseDatabaseUrl(databaseUrl) : null,
    cache: cacheUrl ? { url: cacheUrl } : null,
    logs,
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
   * ({@link readStoreLocation}) — chemin de fichier pour un store `file`
   * (ex. `<var>/webauthn/credentials.json`), base SQLite pour `drizzle`. `undefined`
   * pour un store `memory` (volatil) ou un backend réseau (l'emplacement = l'infra
   * déclarée, déjà surfacée à part). Répond à « où sont écrites mes données ? » dans Studio.
   */
  location?: string;
}

/**
 * Résout la sentinelle `"auto"` d'une brique en nom de backend, borné aux
 * backends RÉELLEMENT enregistrés (`available` = `listXStores()` du registre —
 * reflète l'auto-register des adapters chargés). Couverture partielle d'une infra
 * (ex. audit sans impl mongoose) → repli `fallback` avec raison ANNONCÉE,
 * jamais d'échec : le principe « fallback annoncé, pas de dégradation
 * silencieuse » vit dans la raison retournée, que l'appelant DOIT logger.
 *
 * @param kind - nature de la donnée ({@link StoreKind}).
 * @param infra - infra résolue ({@link resolveInfra}).
 * @param available - backends enregistrés dans le registre de la brique.
 * @param fallback - backend de repli (défaut `"memory"` ; `"files"` pour session).
 */
export function resolveAutoStore(
  kind: StoreKind,
  infra: IInfra,
  available: readonly string[],
  fallback = "memory",
): IAutoStoreResolution {
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
    if (available.includes(preference.store)) {
      return preference;
    }
  }
  if (preferences.length > 0) {
    const wanted = preferences.map((p) => p.store).join("/");
    return {
      store: fallback,
      reason:
        `backend d'infra ${wanted} indisponible sur cette brique ` +
        `(enregistrés : ${available.join(", ") || "aucun"}) — repli "${fallback}"`,
    };
  }
  // Aucune infra RÉSEAU déclarée : préférer un backend LOCAL PERSISTANT réellement
  // chargé (`drizzle` = sqlite local, puis `mongoose`) AVANT le repli volatil.
  // C'est la bascule « sqlite par défaut » : dev ET prod mono-nœud persistent sans
  // aucune config (`nodefony new` marche, tes données survivent au redémarrage) ; on
  // ne « sort » de sqlite qu'en déclarant une infra réseau (NF_DATABASE_URL) pour
  // scaler en multi-nœud. Ordre = même préférence que l'infra database (sql avant mongo).
  for (const local of ["drizzle", "mongoose"] as const) {
    if (available.includes(local)) {
      return {
        store: local,
        reason: `aucune infra déclarée — backend local persistant "${local}" (mono-nœud)`,
      };
    }
  }
  return {
    store: fallback,
    reason:
      `aucune infra déclarée, aucun backend persistant chargé — repli "${fallback}"` +
      (fallback === "memory" ? " (volatil)" : ""),
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
