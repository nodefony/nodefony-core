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
import { ROLE_NODEFONY_ADMIN } from "../../auth/roles";

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
 * **« Où on écrit »** : le `store` (backend `memory`/`drizzle`/`mongoose`, aligné
 * sur le vocabulaire config 0.8) + la classe `repository` réelle + le `count`.
 */
export interface UsersStatus {
  enabled: boolean;
  /** Backend de persistance (`memory`/`drizzle`/`mongoose`), `null` si indéterminable. */
  store: "memory" | "drizzle" | "mongoose" | null;
  /** Backends de persistance disponibles (le résolu `store` en fait partie). */
  available: string[];
  /** Classe du repository réel (ex. `DrizzleUserRepository`), `none` si absent. */
  repository: string;
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
 * GET — **compteurs de tête**, posés par le serveur sur l'annuaire ENTIER.
 *
 * Endpoint distinct de la liste : ces nombres ne dépendent ni de la fenêtre ni
 * de l'ordre, on ne les recharge donc qu'au montage et après une mutation.
 * Réservé aux administrateurs — un autre appelant reçoit 403.
 */
export const USERS_STATS_ENDPOINT = "/nodefony/user/api/users/stats";

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

/**
 * POST — change le mot de passe d'un compte (`{ plainPassword }`). Audité (sans
 * la valeur). Le hash n'est jamais renvoyé.
 */
export function userPasswordEndpoint(id: string): string {
  return `${USERS_LIST_ENDPOINT}/${encodeURIComponent(id)}/password`;
}

/**
 * Corps de création d'un compte (POST sur {@link USERS_LIST_ENDPOINT}).
 * `plainPassword` absent = compte sans mot de passe (connexion sociale / passkey
 * ou à définir plus tard) ; `roles` absent = aucun rôle (compte de base).
 */
export interface CreateUserInput {
  identifier: string;
  plainPassword?: string;
  roles?: string[];
}

/**
 * Corps de mise à jour d'un compte (PATCH sur {@link userEndpoint}). Champs
 * optionnels — n'envoyer que ce qui change. Les garde-fous anti-lockout sont
 * appliqués côté serveur (409 si auto-déchéance / dernier admin actif).
 */
export interface UpdateUserInput {
  roles?: string[];
  enabled?: boolean;
  locked?: boolean;
}

/** Version de la doc de cette surface (badge des fiches `DocHint`). */
export const USERS_DOC = "v1.0";

/** Rôle requis pour l'administration des utilisateurs — source unique `auth/roles`. */
export const ADMIN_ROLE = ROLE_NODEFONY_ADMIN;

// ─── Compteurs (KPIs) ────────────────────────────────────────────────────────

/**
 * Compteurs de tête — miroir de ce que rend `users/stats`.
 *
 * `null` = l'annuaire branché ne sait pas compter ; se rend « — » à l'écran.
 * Les populations se **recoupent** : un compte peut être désactivé ET
 * verrouillé, un administrateur peut avoir un lien social. Aucune n'est donc
 * déduite d'une autre.
 */
export interface UserCounts {
  /** Tous les comptes de l'annuaire. */
  total: number | null;
  /** Comptes utilisables : activés et non verrouillés. */
  active: number | null;
  /** Comptes désactivés par décision d'administration. */
  disabled: number | null;
  /** Comptes verrouillés par la défense anti-force brute. */
  locked: number | null;
  /** Comptes portant `ROLE_NODEFONY_ADMIN`. */
  admins: number | null;
  /** Comptes ayant au moins un lien social (OAuth). */
  social: number | null;
}

/**
 * Compte sur les comptes REÇUS — repli tant que les compteurs serveur ne sont
 * pas disponibles (non-administrateur). La vue consomme `users/stats`.
 */
export function countUsers(users: UserSummary[]): UserCounts {
  let active = 0;
  let disabled = 0;
  let locked = 0;
  let admins = 0;
  let social = 0;
  for (const u of users) {
    if (u.enabled && !u.locked) active++;
    if (!u.enabled) disabled++;
    if (u.locked) locked++;
    if (u.roles.includes(ADMIN_ROLE)) admins++;
    if (u.socialProviders.length > 0) social++;
  }
  return { total: users.length, active, disabled, locked, admins, social };
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
 * Extrait le message PRÉCIS renvoyé par le back dans le corps d'erreur (les
 * handlers admin renvoient `{ error: "…" }`) — `ApiError.message` ne porte que
 * la ligne générique « VERB url → HTTP n ». Tolère aussi `{ message }` et
 * `{ error: { message } }`. `undefined` si rien d'exploitable.
 */
function errBodyMessage(e: unknown): string | undefined {
  const body = (e as { body?: unknown } | null)?.body;
  if (!body || typeof body !== "object") return undefined;
  const rec = body as Record<string, unknown>;
  if (typeof rec.error === "string") return rec.error;
  if (typeof rec.message === "string") return rec.message;
  const err = rec.error;
  if (
    err &&
    typeof err === "object" &&
    typeof (err as Record<string, unknown>).message === "string"
  ) {
    return (err as Record<string, string>).message;
  }
  return undefined;
}

/**
 * Traduit une erreur HTTP du data plane des utilisateurs en message FR explicite —
 * même classe que les autres consoles Sécurité. Le **409** est propre aux
 * utilisateurs : soit un garde-fou anti-lockout, soit un identifiant déjà pris —
 * le back précise lequel dans le corps (surfacé tel quel).
 */
export function describeUsersError(e: unknown): string {
  const status = (e as { status?: number } | null)?.status;
  const detail = errBodyMessage(e);
  if (status === 401) {
    return (
      "Non authentifié — votre session Studio a expiré ou n'est plus reconnue " +
      "par le firewall. Reconnectez-vous."
    );
  }
  if (status === 403) {
    return (
      "Accès refusé — l'administration des utilisateurs est réservée aux " +
      "administrateurs (ROLE_NODEFONY_ADMIN)."
    );
  }
  if (status === 409) {
    return detail
      ? `Action refusée : ${detail}`
      : "Action refusée par un garde-fou anti-verrouillage (dernier administrateur / votre propre compte).";
  }
  if (status === 404) {
    return "Utilisateur introuvable — il a peut-être déjà été supprimé.";
  }
  if (status === 503) {
    return "Service utilisateur indisponible — le sous-système n'est pas provisionné.";
  }
  const msg = detail ?? (e as { message?: string } | null)?.message;
  return msg
    ? `Erreur de chargement des utilisateurs : ${msg}`
    : "Erreur de chargement des utilisateurs.";
}
