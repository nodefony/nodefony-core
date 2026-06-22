/**
 * Modèle de la console **API Keys** (PAT, P6.12 + P6.15) — **types miroir** du
 * contrat back `@nodefony/security` (frontière isomorphe : on recopie la shape
 * JSON, secrets exclus par construction, jamais d'import runtime serveur) +
 * endpoints, statut dérivé, mapping d'erreur et formatage.
 *
 * Deux portées (modes) consommées par la page :
 *  - **Utilisateur** (« mes clés ») : data plane framework `/nodefony/security/api/keys`
 *    (GET liste / POST création / DELETE révocation), porteur = session BFF.
 *  - **Administration** : data plane `/nodefony/security/api/apikeys`
 *    (GET toutes / POST `/apikeys/{id}/revoke`), RBAC `ROLE_NODEFONY_ADMIN`.
 *
 * Source de vérité serveur : `security/nodefony/contracts/IApiKey.ts`.
 */

/** Vue publique d'une clé API — miroir de `IApiKeyView` (sans secret ni hash). */
export interface ApiKey {
  id: string;
  /** Préfixe public affichable (`nf_a1b2c3d4`) ou `null`. */
  prefix: string | null;
  name: string;
  scopes: string[];
  /** Porteur (id utilisateur / service account). */
  subjectId: string;
  subjectType: "user" | "service";
  /** Tenant (`null` = global) — axe multi-tenant (P17). */
  tenantId: string | null;
  createdAt: number;
  expiresAt: number | null;
  lastUsedAt: number | null;
  revokedAt: number | null;
}

/** Résultat de création — la vue publique **+ le token en clair** (affiché 1×). */
export interface ApiKeyCreated extends ApiKey {
  /** Secret EN CLAIR — disponible une seule fois, jamais re-dérivable. */
  token: string;
}

/**
 * Statut « où on écrit » du sous-système clés API — miroir du handler
 * `apikeys/status` (`SecurityAdminApi`). Le `store` est la classe RÉELLE du
 * `ITokenStore` (la table qui porte les clés) ; le `driver` est sa famille
 * logique (mémoire/SGBD/cache). Aucun secret, jamais d'id de clé.
 */
export interface ApiKeysStatus {
  /** Clés API activées en config (`apiKeys.enabled`). */
  enabled: boolean;
  /** Classe réelle du store de jetons (ex. `MemoryTokenStore`), `none` si absent. */
  store: string;
  /** Driver déduit (`memory`/`orm`/`redis`), `null` si indéterminable. */
  driver: "memory" | "orm" | "redis" | null;
}

/** Capacités/contraintes d'émission — miroir de `IApiKeyCapabilities`. */
export interface ApiKeyCapabilities {
  enabled: boolean;
  prefix: string;
  defaultExpiryDays: number | null;
  maxPerSubject: number;
  /** Catalogue de scopes (`null` = libre : tout scope non vide accepté). */
  allowedScopes: string[] | null;
}

// ─── Endpoints du data plane ─────────────────────────────────────────────────

/** Mode utilisateur (« mes clés ») — GET liste, POST création. */
export const KEYS_ENDPOINT = "/nodefony/security/api/keys";
/** Capacités d'émission (formulaire de création honnête). */
export const KEYS_CAPABILITIES_ENDPOINT =
  "/nodefony/security/api/keys/capabilities";
/**
 * Mode administration — GET toutes les clés (gouvernance cross-porteur). Monté
 * par `SecurityAdminApi` sous le namespace `security` (broker admin) → PAS de
 * sous-préfixe `admin` : `/nodefony/security/api/apikeys` (distinct de `…/keys`
 * du data plane self-service framework P6.12).
 */
export const ADMIN_KEYS_ENDPOINT = "/nodefony/security/api/apikeys";

/**
 * GET — statut du sous-système clés API (« où on écrit » : backend du token
 * store). Monté par `SecurityAdminApi`, RBAC `ROLE_NODEFONY_ADMIN`.
 */
export const API_KEYS_STATUS_ENDPOINT = "/nodefony/security/api/apikeys/status";

/** DELETE — révocation d'UNE clé du porteur courant (mode utilisateur). */
export function userRevokeEndpoint(id: string): string {
  return `${KEYS_ENDPOINT}/${encodeURIComponent(id)}`;
}
/** POST — révocation admin d'une clé par id (réponse à incident). */
export function adminRevokeEndpoint(id: string): string {
  return `${ADMIN_KEYS_ENDPOINT}/${encodeURIComponent(id)}/revoke`;
}

/** Version de la doc de cette surface (badge des fiches `DocHint`). */
export const API_KEYS_DOC = "v1.0";

/** Rôle requis pour la portée Administration — source unique `auth/roles`. */
export { ROLE_NODEFONY_ADMIN as ADMIN_ROLE } from "../../auth/roles";

// ─── Statut dérivé (le DTO ne le porte pas — calque exact de `#isActive`) ─────

export type ApiKeyStatus = "active" | "expired" | "revoked";

/**
 * Statut d'une clé, dérivé de `revokedAt`/`expiresAt` (le back ne renvoie pas de
 * champ « status ») : révoquée > expirée > active.
 */
export function keyStatus(key: ApiKey, now: number = Date.now()): ApiKeyStatus {
  if (key.revokedAt !== null) return "revoked";
  if (key.expiresAt !== null && key.expiresAt <= now) return "expired";
  return "active";
}

/** Compteurs par statut (KPIs). */
export interface ApiKeyCounts {
  total: number;
  active: number;
  expired: number;
  revoked: number;
}

export function countByStatus(
  keys: ApiKey[],
  now: number = Date.now(),
): ApiKeyCounts {
  const counts: ApiKeyCounts = {
    total: keys.length,
    active: 0,
    expired: 0,
    revoked: 0,
  };
  for (const key of keys) counts[keyStatus(key, now)]++;
  return counts;
}

// ─── Formatage ───────────────────────────────────────────────────────────────

const MS_PER_DAY = 86_400_000;

/** Date absolue lisible (ou « — » si nulle). */
export function fmtDate(ms: number | null): string {
  if (ms === null) return "—";
  return new Date(ms).toLocaleString("fr-FR", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/** Expiration en clair (paliers, jamais de churn) — sans expiration / dans X j / expirée. */
export function fmtExpiry(
  expiresAt: number | null,
  now: number = Date.now(),
): string {
  if (expiresAt === null) return "Sans expiration";
  const days = Math.ceil((expiresAt - now) / MS_PER_DAY);
  if (days < 0) return `Expirée il y a ${-days} j`;
  if (days === 0) return "Expire aujourd'hui";
  if (days === 1) return "Expire demain";
  return `Expire dans ${days} j`;
}

/** Dernier usage en clair (paliers) — « Jamais utilisée » / « il y a … ». */
export function fmtLastUsed(
  ms: number | null,
  now: number = Date.now(),
): string {
  if (ms === null) return "Jamais utilisée";
  const days = Math.floor((now - ms) / MS_PER_DAY);
  if (days <= 0) return "Utilisée aujourd'hui";
  if (days === 1) return "Hier";
  if (days < 30) return `Il y a ${days} j`;
  const months = Math.floor(days / 30);
  if (months < 12) return `Il y a ${months} mois`;
  return `Il y a ${Math.floor(months / 12)} an(s)`;
}

/**
 * Traduit une erreur HTTP du data plane des clés en message FR explicite
 * (vitrine honnête) — même classe que les autres consoles Sécurité.
 */
export function describeApiKeysError(e: unknown): string {
  const status = (e as { status?: number } | null)?.status;
  if (status === 401) {
    return (
      "Non authentifié — le firewall ne reconnaît pas la session Studio. " +
      "L'authentification de Studio est encore en mock : elle sera branchée " +
      "sur le vrai firewall lors de la sécurisation de Studio (P6.15)."
    );
  }
  if (status === 403) {
    return (
      "Accès refusé — la gestion des clés API en mode Administration est " +
      "réservée aux administrateurs (ROLE_NODEFONY_ADMIN)."
    );
  }
  if (status === 503) {
    return (
      "Clés API indisponibles — émission désactivée en config sécurité " +
      "(apiKeys.enabled = false) ou store de jetons non provisionné."
    );
  }
  if (status === 404) {
    return "Endpoint introuvable — le module @nodefony/security n'est peut-être pas chargé.";
  }
  if (status === 409) {
    return "Plafond de clés actives atteint pour ce porteur — révoquez-en une avant d'en créer une nouvelle.";
  }
  const msg = (e as { message?: string } | null)?.message;
  return msg
    ? `Erreur de chargement des clés API : ${msg}`
    : "Erreur de chargement des clés API.";
}
