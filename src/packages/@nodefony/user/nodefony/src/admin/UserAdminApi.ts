import { parsePageQuery } from "nodefony";
import type { Container } from "nodefony";
import type {
  IAdminApi,
  IAdminDescriptor,
  IAdminEndpoint,
  IAdminRegistry,
  IAdminRequest,
  IAdminResponse,
} from "nodefony";
import type { IUser, ISocialProvider } from "../../contracts/IUser";
import type { IUserProfile } from "../../contracts/IUserProfile";
import type { UserService } from "../../service/UserService";
import { WeakPasswordError } from "../../errors/WeakPasswordError";
import { listUserStores } from "../userStoreRegistry";
import {
  validateProfilePatch,
  projectProfile,
  mergeProfileIntoMetadata,
} from "../userProfile";

/**
 * Rôle critique : porteur de l'accès au data plane d'administration (Studio).
 * Les garde-fous anti-lockout protègent **ce** rôle (jamais déchoir le dernier).
 */
const ADMIN_ROLE = "ROLE_NODEFONY_ADMIN";
/** Longueur minimale d'un mot de passe self-service (OWASP ASVS V2.1.1 — plancher). */
const MIN_PASSWORD_LENGTH = 8;

/**
 * Projection **publique** d'un utilisateur pour l'ADMINISTRATION (Studio, P6.15).
 * Redaction PAR CONSTRUCTION (allowlist) — ne porte **jamais** `password`, jamais
 * `metadata` (peut contenir du sensible), et les liens sociaux sont exposés **sans
 * jeton** (`provider`/`providerId`/`createdAt` seulement).
 */
export interface IUserSummary {
  id: string;
  identifier: string;
  roles: string[];
  /** Compte actif (`isActive()`), pilotable via PATCH `enabled`. */
  enabled: boolean;
  /** Compte verrouillé (`isLocked()`), pilotable via PATCH `locked`. */
  locked: boolean;
  /**
   * `true` si le compte a un mot de passe LOCAL (par opposition à OAuth-only).
   * Présence seulement — **jamais** le hash. Permet au self-service de proposer
   * « changer » (re-auth possible) vs « pas de mot de passe » (compte externe).
   */
  hasPassword: boolean;
  /** Profil de rôle actif en session (P5.11), ou `null`. */
  currentRole: string | null;
  /** Comptes externes liés — jamais de jeton, seulement la référence. */
  socialProviders: {
    provider: string;
    providerId: string;
    createdAt: number | null;
  }[];
  /**
   * Profil d'affichage (claims OIDC : prénom/nom/email/locale/avatar), lu par
   * allowlist depuis `metadata.profile` — jamais les autres clés de `metadata`.
   */
  profile: IUserProfile;
  /** Création (epoch ms) si l'entité la porte (ORM), sinon `null`. */
  createdAt: number | null;
  /** Dernière mise à jour (epoch ms) si connue, sinon `null`. */
  updatedAt: number | null;
  /** Réserve multi-tenant (toujours `null` en mono-tenant — slot coût-0). */
  tenantId: string | null;
}

/** Convertit un timestamp (`Date`/string ISO/number) en epoch ms — `null` si invalide. */
function toEpoch(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  const t = new Date(value as string | number | Date).getTime();
  return Number.isNaN(t) ? null : t;
}

/**
 * Projette un {@link IUser} en {@link IUserSummary} redacté. Fonction **pure**
 * (cœur de la garantie anti-fuite, testée isolément) : `currentRole`/
 * `socialProviders`/timestamps sont lus **défensivement** (présents sur l'entité
 * ORM, absents du contrat strict `IUser`) — `password`/`metadata` jamais lus.
 */
export function toUserSummary(user: IUser): IUserSummary {
  const ext = user as IUser & {
    password?: unknown;
    currentRole?: unknown;
    socialProviders?: unknown;
    metadata?: unknown;
    createdAt?: unknown;
    updatedAt?: unknown;
  };
  const social = Array.isArray(ext.socialProviders)
    ? (ext.socialProviders as ISocialProvider[])
    : [];
  return {
    id: user.id,
    identifier: user.identifier,
    roles: [...user.roles],
    enabled: user.isActive(),
    locked: user.isLocked(),
    hasPassword: typeof ext.password === "string" && ext.password.length > 0,
    currentRole: typeof ext.currentRole === "string" ? ext.currentRole : null,
    socialProviders: social.map((p) => ({
      provider: p.provider,
      providerId: p.providerId,
      createdAt: toEpoch(p.createdAt),
    })),
    profile: projectProfile(ext.metadata),
    createdAt: toEpoch(ext.createdAt),
    updatedAt: toEpoch(ext.updatedAt),
    tenantId: null,
  };
}

/** Identité de l'admin appelant (id pour comparer self, label pour l'audit). */
function adminActor(user: unknown): { id: string | null; label: string } {
  if (user && typeof user === "object") {
    const u = user as {
      id?: unknown;
      identifier?: unknown;
      username?: unknown;
    };
    const id = typeof u.id === "string" ? u.id : null;
    const label =
      (typeof u.username === "string" && u.username) ||
      (typeof u.identifier === "string" && u.identifier) ||
      "admin";
    return { id, label };
  }
  return { id: null, label: "admin" };
}

/** Premier param d'une clé de query (peut être `string | string[]`). */
function one(
  query: Readonly<Record<string, string | string[]>>,
  key: string,
): string | undefined {
  const value = query[key];
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value[0] : value;
}

/** Vue minimale du journal d'audit security — résolu par nom au runtime. */
interface IAuditSinkLike {
  record(event: {
    category: string;
    action: string;
    outcome: "success" | "failure" | "denied";
    actor: string | null;
    resource?: string | null;
    reason?: string;
    metadata?: Record<string, unknown>;
  }): void;
}

/** Émet un événement d'audit si `@nodefony/security` est monté — no-op sinon. */
function audit(
  container: Container,
  action: string,
  actor: string | null,
  resource: string,
  metadata?: Record<string, unknown>,
): void {
  (container.get("auditService") as IAuditSinkLike | undefined)?.record({
    category: "authz",
    action,
    outcome: "success",
    actor,
    resource,
    metadata: { ...metadata, viaAdmin: true },
  });
}

/**
 * Identité fonctionnelle (identifier) de l'appelant, lue depuis l'objet user de
 * l'ALS serveur (posé au login par le firewall) — **JAMAIS** un paramètre client.
 * C'est le socle anti-IDOR du self-service : le périmètre d'une action « moi » est
 * fermé par cette valeur, pas par un id reçu dans l'URL ou le corps. `null` si non
 * authentifié (ne devrait pas arriver sous une zone firewall fermée → 401 défensif).
 */
function currentIdentifier(user: unknown): string | null {
  if (user && typeof user === "object") {
    const u = user as { identifier?: unknown };
    if (typeof u.identifier === "string" && u.identifier.length > 0) {
      return u.identifier;
    }
  }
  return null;
}

/**
 * Émet un événement d'audit d'AUTHENTIFICATION self-service (le propriétaire agit
 * sur son propre compte) — `viaAdmin: false` (distinct des mutations admin), avec
 * un `outcome` paramétrable car **succès ET échec** sont audités (un échec de
 * re-auth est un signal de sécurité). No-op si `@nodefony/security` n'est pas monté.
 */
function auditSelf(
  container: Container,
  action: string,
  outcome: "success" | "failure",
  actor: string | null,
  resource: string,
  reason?: string,
): void {
  (container.get("auditService") as IAuditSinkLike | undefined)?.record({
    category: "authn",
    action,
    outcome,
    actor,
    resource,
    reason,
    metadata: { viaAdmin: false },
  });
}

/**
 * Nom de l'événement kernel émis quand l'accès d'un utilisateur doit être révoqué
 * partout (suppression / désactivation / verrouillage). **Point d'extension** : un
 * module qui possède des artefacts liés à un user (sessions, tokens, webhooks…)
 * s'y abonne et nettoie LES SIENS — zéro couplage avec `@nodefony/user`.
 */
export const USER_REVOKED_EVENT = "onUserRevoked";

/**
 * Charge utile de {@link USER_REVOKED_EVENT}. `identifier` = clé de jointure des
 * artefacts (session `user`, PAT `subjectId`). `tenantId` = slot multi-tenant
 * (toujours `null` en mono-tenant — réserve coût-0 pour une cascade scopée).
 */
export interface IUserRevokedEvent {
  id: string;
  identifier: string;
  tenantId: string | null;
  reason: "deleted" | "disabled" | "locked";
}

interface KernelEmitterLike {
  fire(event: string, ...args: unknown[]): unknown;
}

/**
 * Émet {@link USER_REVOKED_EVENT} sur le bus kernel (no-op si pas de kernel).
 * Déclenche la cascade de révocation chez tous les abonnés (sessions, tokens,
 * webhooks futurs). L'accès était DÉJÀ neutralisé par le re-fetch des
 * authenticators ; ceci force le nettoyage immédiat (défense en profondeur).
 */
function emitUserRevoked(
  container: Container,
  user: { id: string; identifier: string },
  reason: IUserRevokedEvent["reason"],
): void {
  const kernel = container.get("kernel") as KernelEmitterLike | undefined;
  const event: IUserRevokedEvent = {
    id: user.id,
    identifier: user.identifier,
    tenantId: null,
    reason,
  };
  kernel?.fire(USER_REVOKED_EVENT, event);
}

/** Tableau de strings non vides depuis une valeur inconnue, ou `undefined`. */
function readRoles(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const roles: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || entry.trim().length === 0) continue;
    const role = entry.trim();
    if (!roles.includes(role)) roles.push(role);
  }
  return roles;
}

/**
 * Statut du sous-système utilisateur — miroir consommé par la console Studio
 * (« où on écrit »). `store` = **backend** de persistance (`memory`/`drizzle`/
 * `mongoose`, `null` si indéterminable) — aligné sur le vocabulaire config 0.8
 * (données = `store`) et l'écran Studio « Stores ». `repository` = nom de la
 * classe réelle du dépôt. Aucun secret/hash : seulement la topologie.
 */
export interface IUsersStatus {
  enabled: boolean;
  /** Backend de persistance (`memory`/`drizzle`/`mongoose`), ou `null` si indéterminable. */
  store: "memory" | "drizzle" | "mongoose" | null;
  /**
   * Backends de persistance DISPONIBLES (`listUserStores()` : memory builtin +
   * adapters ORM chargés) — le résolu `store` en fait toujours partie. Aligne la
   * brique « user » sur les 7 autres de l'écran Studio « Stores » (résolu parmi
   * disponibles), au lieu du trompeur `[store]`.
   */
  available: string[];
  /** Nom de classe du repository réel (ex. `DrizzleUserRepository`), `"none"` si absent. */
  repository: string;
  /** Nombre d'utilisateurs si dénombrable (lecture défensive), sinon `null`. */
  count: number | null;
  /** Réserve multi-tenant (toujours `null` en mono-tenant — slot coût-0). */
  tenantId: string | null;
}

/**
 * Déduit le **backend** (store) de persistance du nom de classe du repository —
 * convention de nommage des adapters (`InMemoryUserRepository`/
 * `DrizzleUserRepository`/`MongooseUserRepository`). `null` si le nom ne matche
 * aucun adapter connu (jamais throw — un repo custom reste affichable via `repository`).
 */
function deduceUserStore(
  repositoryName: string,
): "memory" | "drizzle" | "mongoose" | null {
  const n = repositoryName.toLowerCase();
  if (n.includes("inmemory") || n.includes("memory")) return "memory";
  if (n.includes("drizzle")) return "drizzle";
  if (n.includes("mongoose") || n.includes("mongo")) return "mongoose";
  return null;
}

/**
 * Producteur `IAdminApi` du domaine **utilisateur** — exposé sous
 * `/nodefony/user/api/users`. Défini DANS `@nodefony/user` (propriétaire du
 * `UserService`/`IUser`) mais **enregistré par un module bootable**
 * (`@nodefony/security`, via {@link registerUserAdminApi}) car `@nodefony/user`
 * est une lib pure non-bootable — exactement le cas prévu par le core : un
 * module qui ne dépend que de `nodefony` produit sa donnée d'admin.
 *
 * RBAC `ROLE_NODEFONY_ADMIN` (défaut broker, 403 sinon). Mutations = HTTP
 * (pipeline CSRF), auditées (catégorie `authz`). Garde-fous **anti-lockout** :
 * pas d'auto-déchéance, pas de suppression/désactivation du dernier admin actif.
 *
 * @param container - container du kernel (résolution lazy du service `users`).
 */
export function createUserAdminApi(container: Container): IAdminApi {
  const resolveUsers = (): UserService | undefined =>
    container.get("users") as UserService | undefined;

  const endpoints: IAdminEndpoint[] = [
    {
      path: "users",
      method: "GET",
      summary:
        "Utilisateurs (DTO redacté, jamais le hash). Filtres : " +
        "?role&enabled&q (identifier) ; pagination ?limit&offset.",
      handler: async (
        request: IAdminRequest,
      ): Promise<
        | {
            items: IUserSummary[];
            total: number;
            limit: number;
            offset: number;
          }
        | IAdminResponse<{ error: string }>
      > => {
        const users = resolveUsers();
        if (!users) {
          return { status: 503, body: { error: "user service unavailable" } };
        }
        const role = one(request.query, "role");
        const enabled = one(request.query, "enabled");
        const q = one(request.query, "q");
        // UN SEUL traducteur pour toute la requête de page : limit, offset ET
        // tri. En appeler un second sans l'allowlist (ce que faisait `pageParams`)
        // fait refuser en 400 un `order` que le premier venait d'accepter — vécu.
        const pageQuery = parsePageQuery(request.query, {
          sortable: users.sortableUserFields(),
        });
        const limit = pageQuery.limit;
        const offset = pageQuery.offset ?? 0;
        // Pagination NATIVE au store — JAMAIS un `find()` complet matérialisé en
        // RAM (règle perf/mémoire) : les filtres role/enabled/q descendent dans
        // le backend, qui ne renvoie qu'une page.
        const page = await users.listPage({
          limit,
          offset,
          ...(pageQuery.order ? { order: pageQuery.order } : {}),
          ...(role !== undefined ? { role } : {}),
          ...(enabled !== undefined ? { enabled: enabled === "true" } : {}),
          ...(q !== undefined && q.length > 0 ? { q } : {}),
        });
        return {
          items: page.items.map(toUserSummary),
          total: page.total ?? page.items.length,
          limit,
          offset,
        };
      },
    },
    {
      // Statut « où on écrit » : driver de persistance du service `users`.
      // Déclaré AVANT `users/{id}` (segment littéral `status` ≠ param `{id}`),
      // lecture 100 % défensive (jamais throw, jamais de hash).
      path: "users/status",
      method: "GET",
      summary:
        "Statut du sous-système utilisateur (store/driver/count) — jamais de hash.",
      handler: async (): Promise<IUsersStatus> => {
        const users = resolveUsers();
        if (!users) {
          return {
            enabled: false,
            store: null,
            available: listUserStores(),
            repository: "none",
            count: null,
            tenantId: null,
          };
        }
        // `repository` est protégé : lecture défensive du nom de classe (le
        // service expose son CRUD, pas son dépôt → duck-typing prudent).
        const repo = (users as unknown as { repository?: unknown }).repository;
        const repository =
          (repo as { constructor?: { name?: string } } | undefined)?.constructor
            ?.name ?? "none";
        const store = deduceUserStore(repository);
        // Backends disponibles + garantie « résolu ∈ disponibles » : un dépôt
        // custom résolu mais non enregistré reste cohérent à l'affichage.
        const available = listUserStores();
        if (store && !available.includes(store)) {
          available.push(store);
        }
        // `count()` peut throw selon le backend (réseau, schéma) → on n'expose
        // jamais d'erreur : un compte indénombrable reste `null`.
        let count: number | null = null;
        try {
          count = await users.count();
        } catch {
          count = null;
        }
        return {
          enabled: true,
          store,
          available,
          repository,
          count,
          tenantId: null,
        };
      },
    },
    {
      path: "users/{id}",
      method: "GET",
      summary: "Détail d'un utilisateur (DTO redacté). 404 si introuvable.",
      handler: async (
        request: IAdminRequest,
      ): Promise<IUserSummary | IAdminResponse<{ error: string }>> => {
        const users = resolveUsers();
        if (!users) {
          return { status: 503, body: { error: "user service unavailable" } };
        }
        const user = (await users.findById(request.params.id)) as IUser | null;
        if (!user) return { status: 404, body: { error: "not found" } };
        return toUserSummary(user);
      },
    },
    {
      path: "users",
      method: "POST",
      summary:
        "Crée un utilisateur (identifier requis ; plainPassword/roles optionnels). " +
        "Audité. 409 si l'identifiant existe déjà.",
      handler: async (
        request: IAdminRequest,
      ): Promise<IAdminResponse<IUserSummary | { error: string }>> => {
        const users = resolveUsers();
        if (!users) {
          return { status: 503, body: { error: "user service unavailable" } };
        }
        const body = (request.body ?? {}) as Record<string, unknown>;
        const identifier =
          typeof body.identifier === "string" ? body.identifier.trim() : "";
        if (identifier.length === 0) {
          return { status: 400, body: { error: "identifier required" } };
        }
        if (await users.findByIdentifier(identifier)) {
          return { status: 409, body: { error: "identifier already exists" } };
        }
        const plainPassword =
          typeof body.plainPassword === "string" ? body.plainPassword : null;
        const created = (await users.createUser({
          identifier,
          plainPassword,
          roles: readRoles(body.roles) ?? [],
        })) as IUser;
        audit(
          container,
          "user.created",
          adminActor(request.user).label,
          created.id,
          {
            identifier,
          },
        );
        return { status: 201, body: toUserSummary(created) };
      },
    },
    {
      path: "users/{id}",
      method: "PATCH",
      summary:
        "Modifie roles/enabled/locked/profile. Audité. Garde-fous anti-lockout " +
        "(pas d'auto-déchéance ADMIN, pas de déchéance du dernier admin).",
      handler: async (
        request: IAdminRequest,
      ): Promise<IUserSummary | IAdminResponse<{ error: string }>> => {
        const users = resolveUsers();
        if (!users) {
          return { status: 503, body: { error: "user service unavailable" } };
        }
        const target = (await users.findById(
          request.params.id,
        )) as IUser | null;
        if (!target) return { status: 404, body: { error: "not found" } };

        const actor = adminActor(request.user);
        const isSelf = actor.id !== null && actor.id === target.id;
        const body = (request.body ?? {}) as Record<string, unknown>;
        const patch: {
          roles?: string[];
          enabled?: boolean;
          locked?: boolean;
          metadata?: Record<string, unknown>;
        } = {};

        const roles = readRoles(body.roles);
        if (roles !== undefined) {
          const losesAdmin =
            target.roles.includes(ADMIN_ROLE) && !roles.includes(ADMIN_ROLE);
          if (losesAdmin && isSelf) {
            return {
              status: 409,
              body: { error: "cannot remove your own admin role" },
            };
          }
          if (losesAdmin) {
            // Garde-fou au store (COUNT natif), pas un `find()` complet en RAM.
            if ((await users.countActiveAdmins(ADMIN_ROLE)) <= 1) {
              return {
                status: 409,
                body: { error: "cannot demote the last active admin" },
              };
            }
          }
          patch.roles = roles;
        }

        if (typeof body.enabled === "boolean") {
          if (body.enabled === false) {
            if (isSelf) {
              return {
                status: 409,
                body: { error: "cannot disable your own account" },
              };
            }
            if (target.isActive() && target.roles.includes(ADMIN_ROLE)) {
              if ((await users.countActiveAdmins(ADMIN_ROLE)) <= 1) {
                return {
                  status: 409,
                  body: { error: "cannot disable the last active admin" },
                };
              }
            }
          }
          patch.enabled = body.enabled;
        }
        if (typeof body.locked === "boolean") {
          if (body.locked === true && isSelf) {
            return {
              status: 409,
              body: { error: "cannot lock your own account" },
            };
          }
          patch.locked = body.locked;
        }

        // Profil d'affichage (claims OIDC) → fusionné dans `metadata.profile` en
        // préservant les autres clés. Pas de garde-fou anti-lockout (un champ
        // d'affichage ne neutralise aucun accès) ; audité via les `fields`.
        if (body.profile !== undefined) {
          const parsed = validateProfilePatch(body.profile);
          if (!parsed.ok) {
            return { status: 400, body: { error: parsed.error } };
          }
          if (Object.keys(parsed.value).length > 0) {
            patch.metadata = mergeProfileIntoMetadata(
              (target as { metadata?: unknown }).metadata,
              parsed.value,
            );
          }
        }

        // Aucun champ exploitable (corps vide / mal typé) → 400, JAMAIS un
        // UPDATE vide (drizzle `.set({})` jette « No values to set » = 500).
        if (Object.keys(patch).length === 0) {
          return {
            status: 400,
            body: {
              error: "no modifiable fields (roles/enabled/locked/profile)",
            },
          };
        }
        const updated = (await users.updateOne(
          { id: target.id } as never,
          patch as never,
        )) as IUser | null;
        if (!updated) return { status: 404, body: { error: "not found" } };
        audit(container, "user.updated", actor.label, target.id, {
          fields: Object.keys(patch),
        });
        // Désactivation/verrouillage = révocation d'accès → cascade immédiate
        // (le re-fetch suffisait déjà ; ceci éjecte sessions/tokens sans attendre).
        if (patch.enabled === false) {
          emitUserRevoked(container, target, "disabled");
        } else if (patch.locked === true) {
          emitUserRevoked(container, target, "locked");
        }
        return toUserSummary(updated);
      },
    },
    {
      path: "users/{id}/password",
      method: "POST",
      summary:
        "Change le mot de passe d'un utilisateur (plainPassword requis). " +
        "Audité (jamais la valeur). 404 si introuvable.",
      handler: async (
        request: IAdminRequest,
      ): Promise<{ ok: true } | IAdminResponse<{ error: string }>> => {
        const users = resolveUsers();
        if (!users) {
          return { status: 503, body: { error: "user service unavailable" } };
        }
        const body = (request.body ?? {}) as Record<string, unknown>;
        const plainPassword =
          typeof body.plainPassword === "string" ? body.plainPassword : "";
        if (plainPassword.length === 0) {
          return { status: 400, body: { error: "plainPassword required" } };
        }
        const updated = await users.changePassword(
          request.params.id,
          plainPassword,
        );
        if (!updated) return { status: 404, body: { error: "not found" } };
        audit(
          container,
          "user.password_changed",
          adminActor(request.user).label,
          request.params.id,
        );
        return { ok: true };
      },
    },
    {
      // ── Self-service : MON profil (identité + rôles + comptes externes liés).
      // Même garde que `me/password` : `public: true` sous la zone firewall
      // `nodefony-admin` → anonyme 401. Périmètre = identité ALS serveur
      // (`currentIdentifier`), jamais un param client (anti-IDOR). DTO redacté
      // (`toUserSummary` : jamais le hash, jamais `metadata`, social SANS jeton).
      path: "me",
      method: "GET",
      public: true,
      summary:
        "MON profil (self-service) — identifiant, rôles, rôle actif, comptes " +
        "externes liés. DTO redacté (jamais le hash ni de jeton).",
      handler: async (
        request: IAdminRequest,
      ): Promise<IUserSummary | IAdminResponse<{ error: string }>> => {
        const users = resolveUsers();
        if (!users) {
          return { status: 503, body: { error: "user service unavailable" } };
        }
        const principal = currentIdentifier(request.user);
        if (!principal) {
          return { status: 401, body: { error: "unauthenticated" } };
        }
        const me = (await users.findByIdentifier(principal)) as IUser | null;
        if (!me) return { status: 404, body: { error: "not found" } };
        return toUserSummary(me);
      },
    },
    {
      // ── Self-service : changer MON mot de passe — tout utilisateur AUTHENTIFIÉ
      // (pas seulement un admin). `public: true` = le broker n'impose AUCUN rôle ;
      // l'AUTHENTIFICATION reste garantie EN AMONT par la zone firewall
      // `nodefony-admin` (`^/nodefony/[^/]+/api(/|$)`, authenticators `["session"]`
      // SANS `anonymous`) → un anonyme est rejeté 401 avant ce handler.
      //
      // Anti-IDOR PAR CONSTRUCTION : la cible n'est JAMAIS un paramètre client.
      // L'identité vient de l'ALS serveur (`currentIdentifier`) et l'`id` interne
      // modifié est celui RENVOYÉ par le re-auth — impossible de viser autrui.
      //
      // Re-auth OBLIGATOIRE (OWASP Authentication Cheat Sheet) : exige le mot de
      // passe ACTUEL → défense contre une session volée (un attaquant qui détient
      // la session ne peut pas verrouiller le compte sans connaître le mot de passe).
      // `authenticate()` ne déclenche aucun lockout (Nodefony = backoff NIST côté
      // authenticator de login, jamais de verrouillage dur) → un échec de re-auth
      // ne peut pas enfermer dehors le propriétaire légitime.
      path: "me/password",
      method: "POST",
      public: true,
      summary:
        "Change MON mot de passe (self-service). Body { currentPassword, " +
        "newPassword }. Re-auth du mot de passe actuel (403 sinon). Audité.",
      handler: async (
        request: IAdminRequest,
      ): Promise<{ ok: true } | IAdminResponse<{ error: string }>> => {
        const users = resolveUsers();
        if (!users) {
          return { status: 503, body: { error: "user service unavailable" } };
        }
        const principal = currentIdentifier(request.user);
        if (!principal) {
          return { status: 401, body: { error: "unauthenticated" } };
        }
        const body = (request.body ?? {}) as Record<string, unknown>;
        const currentPassword =
          typeof body.currentPassword === "string" ? body.currentPassword : "";
        const newPassword =
          typeof body.newPassword === "string" ? body.newPassword : "";
        if (currentPassword.length === 0) {
          return { status: 400, body: { error: "currentPassword required" } };
        }
        if (newPassword.length < MIN_PASSWORD_LENGTH) {
          return {
            status: 400,
            body: {
              error: `newPassword must be at least ${MIN_PASSWORD_LENGTH} characters`,
            },
          };
        }
        if (newPassword === currentPassword) {
          return {
            status: 400,
            body: {
              error: "newPassword must differ from the current password",
            },
          };
        }
        // Re-auth : valide le mot de passe ACTUEL ET récupère l'utilisateur frais
        // (son `id` interne) en UN seul appel. Échec = mauvais mdp (ou compte
        // verrouillé/désactivé entre-temps). Pas de fuite d'info : c'est SON
        // compte, aucune énumération possible.
        const authed = await users.authenticate(principal, currentPassword);
        if (!authed) {
          auditSelf(
            container,
            "user.password_change_self",
            "failure",
            principal,
            principal,
            "bad_current_password",
          );
          return {
            status: 403,
            body: { error: "current password is incorrect" },
          };
        }
        // Cible = l'`id` issu du re-auth (jamais un param client) → anti-IDOR.
        try {
          await users.changePassword(authed.id, newPassword);
        } catch (err) {
          // Blocklist NIST opt-in (mot de passe connu-compromis) → 400, pas 500.
          if (err instanceof WeakPasswordError) {
            return {
              status: 400,
              body: { error: "password rejected (too weak)" },
            };
          }
          throw err;
        }
        auditSelf(
          container,
          "user.password_change_self",
          "success",
          principal,
          authed.id,
        );
        return { ok: true };
      },
    },
    {
      // ── Self-service : modifier MON profil (nom/prénom/avatar…). `public: true`
      // → la zone firewall garantit l'authentification (anonyme 401). Anti-IDOR
      // PAR CONSTRUCTION : la cible = l'identité ALS (`currentIdentifier`), jamais
      // un param client → impossible d'éditer le profil d'autrui. Self ne touche
      // QUE son profil (jamais rôles/enabled/locked, réservés à l'admin). Donnée
      // d'affichage bénigne (pas un secret/credential) → non auditée.
      path: "me/profile",
      method: "POST",
      public: true,
      summary:
        "Modifie MON profil (givenName/familyName/displayName/email/locale/" +
        "picture). Self-service (identité ALS, anti-IDOR). DTO redacté en retour.",
      handler: async (
        request: IAdminRequest,
      ): Promise<IUserSummary | IAdminResponse<{ error: string }>> => {
        const users = resolveUsers();
        if (!users) {
          return { status: 503, body: { error: "user service unavailable" } };
        }
        const principal = currentIdentifier(request.user);
        if (!principal) {
          return { status: 401, body: { error: "unauthenticated" } };
        }
        const me = (await users.findByIdentifier(principal)) as IUser | null;
        if (!me) return { status: 404, body: { error: "not found" } };
        const parsed = validateProfilePatch(request.body ?? {});
        if (!parsed.ok) {
          return { status: 400, body: { error: parsed.error } };
        }
        const metadata = mergeProfileIntoMetadata(
          (me as { metadata?: unknown }).metadata,
          parsed.value,
        );
        const updated = (await users.updateOne(
          { id: me.id } as never,
          { metadata } as never,
        )) as IUser | null;
        if (!updated) return { status: 404, body: { error: "not found" } };
        return toUserSummary(updated);
      },
    },
    {
      path: "users/{id}",
      method: "DELETE",
      summary:
        "Supprime un utilisateur. Audité. Garde-fous : pas d'auto-suppression, " +
        "pas de suppression du dernier admin actif.",
      handler: async (
        request: IAdminRequest,
      ): Promise<{ ok: true } | IAdminResponse<{ error: string }>> => {
        const users = resolveUsers();
        if (!users) {
          return { status: 503, body: { error: "user service unavailable" } };
        }
        const target = (await users.findById(
          request.params.id,
        )) as IUser | null;
        if (!target) return { status: 404, body: { error: "not found" } };
        const actor = adminActor(request.user);
        if (actor.id !== null && actor.id === target.id) {
          return {
            status: 409,
            body: { error: "cannot delete your own account" },
          };
        }
        if (target.isActive() && target.roles.includes(ADMIN_ROLE)) {
          if ((await users.countActiveAdmins(ADMIN_ROLE)) <= 1) {
            return {
              status: 409,
              body: { error: "cannot delete the last active admin" },
            };
          }
        }
        await users.delete({ id: target.id } as never);
        audit(container, "user.deleted", actor.label, target.id, {
          identifier: target.identifier,
        });
        // Cascade : éjecte sessions + tokens (PAT) orphelins (le GC les aurait
        // ramassés à expiration ; ici on nettoie tout de suite).
        emitUserRevoked(container, target, "deleted");
        return { ok: true };
      },
    },
  ];

  const descriptor: IAdminDescriptor = {
    label: "Utilisateurs",
    icon: "users",
    order: 16,
    role: ADMIN_ROLE,
  };

  return {
    adminNamespace: "user",
    adminDescriptor: () => descriptor,
    adminEndpoints: () => endpoints,
  };
}

/**
 * Enregistre le producteur admin utilisateur sur le broker — **idempotent**.
 * À appeler au `onKernelBoot` d'un module **bootable** qui dépend de
 * `@nodefony/user` (typiquement `@nodefony/security`), `@nodefony/user` n'étant
 * pas lui-même un module.
 *
 * @param registry - broker admin (`container.get("adminBroker")`).
 * @param container - container du kernel (capturé par les handlers lazy).
 */
export function registerUserAdminApi(
  registry: IAdminRegistry,
  container: Container,
): void {
  if (registry.has("user")) return;
  registry.register(createUserAdminApi(container));
}
