/**
 * Modèle de la page « Stores de persistance » (`/nodefony/stores`) — miroir PUR
 * (0 JSX) du data plane `/nodefony/kernel/api/stores`. Version RUNTIME de la matrice
 * brique×backend : pour chaque brique (user compris — enregistrée par `provisionUsers`),
 * le store réellement résolu au boot, sa provenance et les backends disponibles —
 * remplace la doc statique qui se périmait.
 */
/** Catégorie de provenance d'un store résolu (miroir back `StoreProvenance`). */
export type StoreProvenance = "infra" | "explicit";

/** Nature de la donnée d'une brique (miroir back `StoreKind`). */
export type StoreNature = "durable" | "ephemeral" | "session";

/** Source RÉELLE d'un champ store (d'où vient la valeur configurée). */
export interface StoreSource {
  /** `default` (schéma) · `app` (config app) · `env` (variable) · `runtime` (édition à chaud). */
  origin: string;
  /** Détail nommé : fichier (`nodefony.config.ts`), var d'env, ou module source. */
  detail: string;
}

/** Résolution effective d'une brique (miroir back `IStoreResolution` + source). */
export interface StoreResolution {
  brick: string;
  nature: StoreNature;
  configured: string;
  resolved: string;
  available: string[];
  provenance: StoreProvenance;
  reason: string;
  configPath?: string;
  /** D'où vient la valeur configurée (fichier/env) — `null` si indéterminable. */
  source?: StoreSource | null;
  /**
   * Emplacement PHYSIQUE où la donnée est écrite, lu de l'instance du store au boot
   * (miroir back `IStoreResolution.location`). Chemin de fichier pour un backend
   * `file` (`<var>/webauthn/credentials.json`) ; absent pour `memory` (volatil) ou
   * un backend réseau (dont la cible est portée par `endpoint`).
   */
  location?: string;
  /**
   * Cible RÉSEAU (URL redactée `host:port/db`, credentials masqués côté serveur) à
   * laquelle ce store est connecté — enrichissement de vue du data plane (dérivé de
   * l'infra déclarée par brique, comme `source`). Présent pour un backend réseau
   * (drizzle/mongoose → base, redis → cache) ; absent pour un store fichier (→ `location`)
   * ou `memory` (volatil). Répond à « à quelle base ce store est-il connecté ? ».
   */
  endpoint?: string;
}

export interface InfraDatabase {
  scheme: string;
  family: "sql" | "mongo";
  dialect: string | null;
  url: string;
}
export interface InfraCache {
  url: string;
}
export interface InfraLogs {
  lokiUrl: string | null;
  opensearchUrl: string | null;
}
/** Infra déclarée (URLs redactées côté serveur). */
export interface Infra {
  database: InfraDatabase | null;
  cache: InfraCache | null;
  logs: InfraLogs | null;
}

/**
 * Moteur de persistance officiel (adapter npm) et son état de disponibilité — pour la
 * DÉCOUVRABILITÉ : `installed` (package présent) × `loaded` (module branché + backend
 * enregistré au runtime). Combler « comment savoir que je PEUX utiliser mongoose ? ».
 */
export interface StoreEngine {
  /** Nom court du backend (`drizzle` · `mongoose` · `redis`). */
  engine: string;
  /** Package npm qui le fournit (`@nodefony/mongoose`). */
  package: string;
  /** Famille d'infra servie (`sql` · `mongo` · `cache`). */
  family: string;
  /**
   * Domaine : `durable` (SQL/Mongo — vocation toutes briques durables + session) ou
   * `cache` (Redis — vocation briques éphémères/session ; les durables sont hors
   * vocation, PAS des trous). Pilote la lecture de `provides`.
   */
  kind: "durable" | "cache";
  /** Package résolvable (installé), qu'il soit chargé ou non. */
  installed: boolean;
  /** Module branché au manifeste ET backend enregistré (utilisable maintenant). */
  loaded: boolean;
  /**
   * Briques de persistance que ce moteur SAIT gérer (couverture) — indépendant du
   * chargement. Ex. mongoose = 5/8 (manque audit/totp/idempotence). Une brique hors
   * liste retombe sur un autre backend.
   */
  provides: string[];
}

/** Payload de `/nodefony/kernel/api/stores`. */
export interface StoresPayload {
  infra: Infra;
  stores: StoreResolution[];
  /** Moteurs de persistance officiels détectés (installé × chargé). */
  engines: StoreEngine[];
}

/** Data plane. */
export const STORES_ENDPOINT = "/nodefony/kernel/api/stores";

// ── Flux & transport (le `driver`) — complément de la vue data (le `store`) ─────
export const KERNEL_INFO_ENDPOINT = "/nodefony/kernel/api/info";
export const REALTIME_HEALTH_ENDPOINT = "/nodefony/realtime/api/health";

/** Backplane des logs (relecture/agrégation ; le sink d'écriture reste stdout). */
export interface LogBackplane {
  driver: string;
  sink: string;
  /** Drivers de log enregistrés dans ce process (registre ouvert). */
  available?: { name: string; query: boolean; stream: boolean }[];
}
/** Forme partielle de `/kernel/api/info` (seul le backplane logs nous intéresse). */
export interface KernelInfoPartial {
  backplanes?: { log?: LogBackplane };
}

/** À quoi sert chaque brique (une phrase, affichée en hover). */
export const BRICK_PURPOSE: Record<string, string> = {
  session:
    "Sessions serveur (cookie BFF opaque) : garde l'utilisateur connecté, révocable côté serveur.",
  user: "Comptes utilisateurs : identité, rôles et credentials (dépôt ORM).",
  tokens:
    "Jetons durables : refresh JWT, denylist de révocation et clés API (PAT).",
  passkeys:
    "Credentials WebAuthn (passkeys) : clés publiques d'authentification sans mot de passe.",
  totp: "Secrets 2FA (TOTP) chiffrés au repos + codes de récupération.",
  audit:
    "Journal de conformité (audit de sécurité) : durable, rétention réglementaire.",
  webhooks:
    "Abonnements webhooks sortants : endpoints cibles et secrets de signature.",
  idempotency:
    "Clés d'idempotence : déduplique les requêtes rejouées (anti double-effet).",
};

/** Libellés lisibles par brique (terme explicite FR + tech en second). */
export const BRICK_LABEL: Record<string, string> = {
  session: "Sessions",
  user: "Utilisateurs",
  tokens: "Jetons (JWT / API)",
  passkeys: "Passkeys (WebAuthn)",
  totp: "2FA (TOTP)",
  audit: "Audit",
  webhooks: "Webhooks",
  idempotency: "Idempotence",
};

export const PROVENANCE_LABEL: Record<StoreProvenance, string> = {
  infra: "défaut-infra",
  explicit: "explicite",
};

export const NATURE_LABEL: Record<StoreNature, string> = {
  durable: "durable",
  ephemeral: "éphémère",
  session: "session",
};

export const SOURCE_ORIGIN_LABEL: Record<string, string> = {
  default: "défaut du schéma",
  app: "config app",
  env: "environnement",
  runtime: "édition à chaud",
  infra: "infra déclarée",
};

/** Libellé « origine — détail » d'une source (ex. « config app — nodefony.config.ts »). */
export function formatSource(source?: StoreSource | null): string | null {
  if (!source) return null;
  return `${SOURCE_ORIGIN_LABEL[source.origin] ?? source.origin} — ${source.detail}`;
}

/**
 * Emplacement lisible d'un store pour l'écran Stores, en 3 formes exclusives :
 * - `path` : chemin fichier local (store `file`, sqlite local) — « où sur disque ».
 * - `endpoint` : URL réseau redactée `host:port/db` (drizzle/mongoose/redis) — « à quelle
 *   base connecté ». Fourni par le back (dérivé de l'infra déclarée par brique).
 * - ni l'un ni l'autre : `memory` (volatil) ou réseau sans infra déclarée → `hint` seul.
 */
export function storeLocation(r: StoreResolution): {
  path: string | null;
  endpoint: string | null;
  hint: string;
} {
  if (r.location) {
    return { path: r.location, endpoint: null, hint: "fichier sur disque" };
  }
  if (r.endpoint) {
    return {
      path: null,
      endpoint: r.endpoint,
      hint: "backend réseau (endpoint)",
    };
  }
  if (r.resolved === "memory") {
    return {
      path: null,
      endpoint: null,
      hint: "en mémoire (process) — perdu au redémarrage",
    };
  }
  return {
    path: null,
    endpoint: null,
    hint: "backend réseau — infra non déclarée",
  };
}

/**
 * Base LOCALE active dérivée des stores quand aucune infra RÉSEAU n'est déclarée
 * (`infra.database === null`, mode `default`/mono-nœud). Un store persistant local
 * (drizzle sqlite) expose le chemin de son fichier via `location` → on l'affiche
 * comme base active plutôt que « — ». Renvoie le 1ᵉʳ store fichier trouvé (tous les
 * stores locaux partagent le même fichier `default`). `null` = aucune base locale
 * (tout en mémoire → persistance volatile).
 */
export function deriveLocalDatabase(
  rows: StoreResolution[],
): { dialect: string; location: string } | null {
  const row = rows.find(
    (r) =>
      (r.resolved === "drizzle" || r.resolved === "mongoose") && !!r.location,
  );
  // Un fichier local `.db` ⇒ sqlite (better-sqlite3, seul backend fichier).
  return row?.location ? { dialect: "sqlite", location: row.location } : null;
}

/** Nom de fichier (dernier segment) d'un chemin, pour l'emphase visuelle. */
export function baseName(pathStr: string): string {
  const parts = pathStr.split(/[/\\]/).filter(Boolean);
  return parts[parts.length - 1] ?? pathStr;
}

/** Ordre d'affichage canonique ; les briques hors liste passent en fin. */
const BRICK_ORDER = [
  "session",
  "user",
  "tokens",
  "passkeys",
  "totp",
  "audit",
  "webhooks",
  "idempotency",
];

/** Trie les briques dans l'ordre canonique (stable pour le reste). */
export function sortBricks(rows: StoreResolution[]): StoreResolution[] {
  const rank = (b: string): number => {
    const i = BRICK_ORDER.indexOf(b);
    return i < 0 ? BRICK_ORDER.length : i;
  };
  return [...rows].sort((a, b) => rank(a.brick) - rank(b.brick));
}

/**
 * Backend volatil (perdu au redémarrage) pour une brique **durable** → alerte :
 * une donnée durable en `memory` est per-pod et non persistée.
 */
export function isVolatileDurable(r: StoreResolution): boolean {
  return r.nature === "durable" && r.resolved === "memory";
}
