/**
 * Modèle de la console **Users** (administration des comptes, P6.15) — **types
 * miroir** du contrat back `@nodefony/user` (frontière isomorphe : on recopie la
 * shape JSON, `password`/hash exclus par construction côté serveur, jamais
 * d'import runtime serveur) + endpoints, mapping d'erreur, compteurs et formatage.
 *
 * Le data plane vit dans `@nodefony/user` (propriétaire de `UserService`/`IUser`),
 * enregistré par `@nodefony/security` sous le namespace `user` (broker admin) →
 * `/nodefony/user/api/users*`. RBAC `ROLE_NODEFONY_ADMIN` sur l'énumération et
 * les mutations (gating front = affichage ; enforcement réel = firewall serveur).
 *
 * Source de vérité serveur : `user/nodefony/src/admin/UserAdminApi.ts`
 * (`IUserSummary`, `IUsersStatus`).
 */

/**
 * Lien social redacté porté par un utilisateur — miroir de la projection back.
 * **Jamais** de jeton OAuth : seulement la référence du compte externe.
 */
export interface UserSocialProvider {
  /** Fournisseur (`google`, `github`, `keycloak`…). */
  provider: string;
  /** Identifiant du compte chez le fournisseur (opaque). */
  providerId: string;
  /** Liaison (epoch ms), ou `null` si inconnue. */
  createdAt: number | null;
}

/**
 * Vue publique d'un utilisateur — miroir de `IUserSummary`. Redaction PAR
 * CONSTRUCTION côté serveur (allowlist) : **jamais** `password` (hash), jamais
 * `metadata`. Les liens sociaux sont exposés sans jeton.
 */
export interface UserSummary {
  /** Identifiant technique (UUID). */
  id: string;
  /** Identifiant fonctionnel (email, login…) — la clé d'affichage. */
  identifier: string;
  /** Rôles plats du compte. */
  roles: string[];
  /** Compte actif (pilotable via PATCH `enabled`). */
  enabled: boolean;
  /** Compte verrouillé (pilotable via PATCH `locked`). */
  locked: boolean;
  /** Profil de rôle actif en session (P5.11), ou `null`. */
  currentRole: string | null;
  /** Comptes externes liés — jamais de jeton. */
  socialProviders: UserSocialProvider[];
  /** Création (epoch ms) si l'entité la porte (ORM), sinon `null`. */
  createdAt: number | null;
  /** Dernière mise à jour (epoch ms) si connue, sinon `null`. */
  updatedAt: number | null;
  /** Réserve multi-tenant (`null` = mono-tenant aujourd'hui — slot coût-0). */
  tenantId: string | null;
}

/** Réponse paginée de l'énumération — miroir du handler `users`. */
export interface UserListResponse {
  items: UserSummary[];
  total: number;
  limit: number;
  offset: number;
}

/**
 * Statut du sous-système utilisateur — miroir du handler `users/status`.
 * **« Où on écrit »** : la classe du `store` réel + le `driver` déduit
 * (`memory`/`drizzle`/`mongoose`) + le `count` si dénombrable.
 */
export interface UsersStatus {
  enabled: boolean;
  /** Classe du repository réel (ex. `DrizzleUserRepository`), `none` si absent. */
  store: string;
  /** Backend déduit (`memory`/`drizzle`/`mongoose`), `null` si indéterminable. */
  driver: "memory" | "drizzle" | "mongoose" | null;
  /** Nombre d'utilisateurs si dénombrable, sinon `null`. */
  count: number | null;
  /** Réserve multi-tenant (`null` = mono-tenant). */
  tenantId: string | null;
}

// ─── Endpoints du data plane (@nodefony/user, namespace « user ») ─────────────

/** GET — énumération paginée (`?role&enabled&q&limit&offset`), RBAC ADMIN. */
export const USERS_LIST_ENDPOINT = "/nodefony/user/api/users";

/** GET — statut du sous-système (driver de persistance, nb de comptes). */
export const USERS_STATUS_ENDPOINT = "/nodefony/user/api/users/status";

/**
 * Fenêtre de chargement par défaut = le **cap dur** du back (200). La liste est
 * exploitée côté client par le `DataGrid` (recherche/tri/filtre). Au-delà, la
 * fenêtre est tronquée → on le signale et on invite à filtrer.
 */
export const USERS_LIST_WINDOW = 200;

/**
 * Construit l'URL d'énumération. `?role&enabled&q` filtrent côté serveur ;
 * `?limit&offset` paginent (cap dur 200).
 */
export function usersListEndpoint(
  opts: {
    role?: string;
    enabled?: boolean;
    q?: string;
    limit?: number;
    offset?: number;
  } = {},
): string {
  const p = new URLSearchParams();
  if (opts.role) p.set("role", opts.role);
  if (opts.enabled !== undefined) p.set("enabled", String(opts.enabled));
  if (opts.q) p.set("q", opts.q);
  if (opts.limit !== undefined) p.set("limit", String(opts.limit));
  if (opts.offset !== undefined) p.set("offset", String(opts.offset));
  const qs = p.toString();
  return qs ? `${USERS_LIST_ENDPOINT}?${qs}` : USERS_LIST_ENDPOINT;
}

/** GET — détail d'un utilisateur par id. 404 si introuvable. */
export function userEndpoint(id: string): string {
  return `${USERS_LIST_ENDPOINT}/${encodeURIComponent(id)}`;
}

/**
 * DELETE — supprime UN utilisateur par id. Audité. Garde-fous back :
 * pas d'auto-suppression, pas de suppression du dernier admin actif (→ 409).
 */
export function deleteUserEndpoint(id: string): string {
  return `${USERS_LIST_ENDPOINT}/${encodeURIComponent(id)}`;
}

/** Version de la doc de cette surface (badge des fiches `DocHint`). */
export const USERS_DOC = "v1.0";

/** Rôle requis pour l'administration des utilisateurs (gating front = affichage seul). */
export const ADMIN_ROLE = "ROLE_NODEFONY_ADMIN";

// ─── Compteurs (KPIs, dérivés de la fenêtre chargée) ─────────────────────────

export interface UserCounts {
  /** Utilisateurs dans la fenêtre. */
  total: number;
  /** Comptes actifs (`enabled`). */
  active: number;
  /** Comptes désactivés ou verrouillés. */
  inactive: number;
  /** Comptes portant `ROLE_NODEFONY_ADMIN`. */
  admins: number;
  /** Comptes ayant au moins un lien social (OAuth). */
  social: number;
}

export function countUsers(users: UserSummary[]): UserCounts {
  let active = 0;
  let admins = 0;
  let social = 0;
  for (const u of users) {
    if (u.enabled && !u.locked) active++;
    if (u.roles.includes(ADMIN_ROLE)) admins++;
    if (u.socialProviders.length > 0) social++;
  }
  return {
    total: users.length,
    active,
    inactive: users.length - active,
    admins,
    social,
  };
}

// ─── Formatage des dates ─────────────────────────────────────────────────────

/** Date absolue lisible (ou « — » si nulle). */
export function fmtDate(ms: number | null): string {
  if (ms === null) return "—";
  return new Date(ms).toLocaleString("fr-FR", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/**
 * Ancienneté en clair, en **paliers** (jamais de churn d'unité) — « à l'instant »
 * sous ~1,5 s, puis s / min / h / j entières. `—` si la date est inconnue.
 */
export function fmtSince(ms: number | null, now: number = Date.now()): string {
  if (ms === null) return "—";
  const diff = now - ms;
  if (diff < 1500) return "à l'instant";
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `il y a ${sec} s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `il y a ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `il y a ${h} h`;
  const d = Math.floor(h / 24);
  return `il y a ${d} j`;
}

// ─── Mapping d'erreur (vitrine honnête) ──────────────────────────────────────

/**
 * Traduit une erreur HTTP du data plane des utilisateurs en message FR explicite —
 * même classe que les autres consoles Sécurité. Le **409** est propre aux
 * utilisateurs : un garde-fou anti-lockout a refusé la mutation.
 */
export function describeUsersError(e: unknown): string {
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
      "Accès refusé — l'administration des utilisateurs est réservée aux " +
      "administrateurs (ROLE_NODEFONY_ADMIN)."
    );
  }
  if (status === 409) {
    // Le back renvoie un message précis (anti-lockout) dans le corps.
    const msg = (e as { message?: string } | null)?.message;
    return msg
      ? `Action refusée (garde-fou) : ${msg}`
      : "Action refusée par un garde-fou anti-verrouillage (dernier administrateur / votre propre compte).";
  }
  if (status === 404) {
    return "Utilisateur introuvable — il a peut-être déjà été supprimé.";
  }
  if (status === 503) {
    return "Service utilisateur indisponible — le sous-système n'est pas provisionné.";
  }
  const msg = (e as { message?: string } | null)?.message;
  return msg
    ? `Erreur de chargement des utilisateurs : ${msg}`
    : "Erreur de chargement des utilisateurs.";
}
