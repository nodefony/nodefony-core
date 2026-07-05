/**
 * Modèle de la page « Stores de persistance » (`/nodefony/stores`) — miroir PUR
 * (0 JSX) du data plane `/nodefony/kernel/api/stores` (+ statut du sous-système
 * utilisateur, fusionné en brique). Version RUNTIME de la matrice brique×backend :
 * pour chaque brique, le store réellement résolu au boot, sa provenance et les
 * backends disponibles — remplace la doc statique qui se périmait.
 */
import type { UsersStatus } from "../users/usersModel";
import { USERS_STATUS_ENDPOINT } from "../users/usersModel";

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

/** Payload de `/nodefony/kernel/api/stores`. */
export interface StoresPayload {
  infra: Infra;
  stores: StoreResolution[];
}

/** Data plane. */
export const STORES_ENDPOINT = "/nodefony/kernel/api/stores";
export { USERS_STATUS_ENDPOINT };

// ── Flux & transport (le `driver`) — complément de la vue data (le `store`) ─────
export const KERNEL_INFO_ENDPOINT = "/nodefony/kernel/api/info";
export const REALTIME_HEALTH_ENDPOINT = "/nodefony/realtime/api/health";

/** Backplane des logs (relecture/agrégation ; le sink d'écriture reste stdout). */
export interface LogBackplane {
  driver: string;
  sink: string;
}
/** Backplane realtime (fond de panier cluster de la socket Nodefony). */
export interface RealtimeBackplane {
  driver: string;
  crossPod: boolean;
  kind?: string;
}
/** Forme partielle de `/kernel/api/info` (seul le backplane logs nous intéresse). */
export interface KernelInfoPartial {
  backplanes?: { log?: LogBackplane };
}
/** Forme partielle de `/realtime/api/health` (seul le backplane nous intéresse). */
export interface RealtimeHealthPartial {
  backplane?: RealtimeBackplane;
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
};

/** Libellé « origine — détail » d'une source (ex. « config app — nodefony.config.ts »). */
export function formatSource(source?: StoreSource | null): string | null {
  if (!source) return null;
  return `${SOURCE_ORIGIN_LABEL[source.origin] ?? source.origin} — ${source.detail}`;
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

/**
 * Fabrique la brique synthétique « Utilisateurs » depuis le statut du
 * sous-système user (persistance ORM directe — hors registre `resolveAutoStore`,
 * donc absente du payload `stores`). `null` si indisponible/désactivé.
 */
export function userBrick(status: UsersStatus | null): StoreResolution | null {
  if (!status || !status.enabled || !status.store) {
    return null;
  }
  return {
    brick: "user",
    nature: "durable",
    configured: status.store,
    resolved: status.store,
    available: [status.store],
    provenance: "explicit",
    reason: `dépôt ORM ${status.repository}`,
    configPath: "app · NF_USER_STORE / provisionUsers",
    source: { origin: "app", detail: "provisionUsers / NF_USER_STORE" },
  };
}
