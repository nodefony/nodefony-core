import type { Container } from "nodefony";
import type {
  IAdminApi,
  IAdminDescriptor,
  IAdminEndpoint,
  IAdminRegistry,
  IAdminRequest,
  IAdminResponse,
} from "nodefony";
import type { AuditCategory, AuditOutcome } from "../../contracts/IAuditEvent";
import type {
  IAuditQuery,
  IAuditQueryResult,
} from "../../contracts/IAuditStore";
import type { IFirewall } from "../../contracts/IFirewall";
import type {
  IFirewallDescription,
  IRoleHierarchyDescription,
} from "../../contracts/IFirewallDescription";
import type { IApiKeyView } from "../../contracts/IApiKey";
import type { IWebAuthnCredential } from "../../contracts/IWebAuthnCredential";
import { adminActor, auditAdmin } from "./adminAudit";
import { webhookAdminEndpoints } from "./WebhookAdminApi";

/**
 * Vue MINIMALE du service `auditService` consommée par le data plane — seule la
 * LECTURE (`query`) + l'état (`isEnabled`) sont nécessaires. Couplage structurel
 * (par nom de service), jamais d'import de la classe concrète.
 */
interface IAuditReader {
  isEnabled(): boolean;
  query(filter?: IAuditQuery): Promise<IAuditQueryResult>;
}

/**
 * Statut « où on écrit » du sous-système clés API (PAT) — miroir front
 * `apiKeysModel.ts`. Expose le **backend du token store** (la table qui porte les
 * clés) : nom de classe réel + driver déduit. Aucun secret, jamais d'id de clé.
 */
interface IApiKeysStatus {
  /** Clés API activées en config (`apiKeys.enabled`). */
  enabled: boolean;
  /** Classe réelle du `ITokenStore` posé au container (ex. `MemoryTokenStore`). */
  store: string;
  /** Driver déduit du store (`memory`/`orm`/`redis`), ou `null` si indéterminable. */
  driver: "memory" | "orm" | "redis" | null;
}

/**
 * Forme minimale d'un `ITokenStore` lue défensivement pour l'introspection — on
 * ne veut QUE le nom de classe réel (jamais les méthodes/données). Couplage
 * structurel : `SecurityAdminApi` ne charge aucune classe concrète de store.
 */
interface TokenStoreLike {
  constructor?: { name?: string };
}

/**
 * Déduit le **driver** logique d'un store à partir de son nom de classe — le
 * `tokenService` connaît le driver config (`tokenStore.store`) mais ne l'expose
 * pas au container ; on le re-dérive du store réel posé (miroir du pattern
 * `HttpAdminApi.sessions` qui lit `storage.constructor.name`). Mapping fermé sur
 * les implémentations connues ({@link ITokenStore}) ; `null` pour un store tiers
 * inconnu (honnête — on n'invente pas un driver).
 *
 * @param className - `store.constructor.name` (ex. `DrizzleTokenStore`).
 * @returns driver logique, ou `null` si la classe n'est pas reconnue.
 */
function tokenStoreDriver(
  className: string | undefined,
): IApiKeysStatus["driver"] {
  switch (className) {
    case "MemoryTokenStore":
      return "memory";
    case "FileTokenStore":
      // Store fichier (builtin) — persistance locale, hors SGBD/cache.
      return "memory";
    case "DrizzleTokenStore":
    case "MongooseTokenStore":
      return "orm";
    case "RedisTokenStore":
      return "redis";
    default:
      return null;
  }
}

/**
 * Vue MINIMALE du service `apiKeys` consommée par l'ADMIN — lecture cross-porteur
 * + révocation par id (gouvernance). Couplage structurel (par nom de service).
 */
interface IApiKeyAdmin {
  isEnabled(): boolean;
  listAllPat(): Promise<IApiKeyView[]>;
  revokeAnyPat(id: string, actorId: string): Promise<IApiKeyView | null>;
}

const CATEGORIES: ReadonlySet<string> = new Set<AuditCategory>([
  "auth",
  "authz",
  "token",
  "session",
  "oauth",
  "webauthn",
  "csrf",
  "cors",
  "ws",
  "webhook",
]);
const OUTCOMES: ReadonlySet<string> = new Set<AuditOutcome>([
  "success",
  "failure",
  "denied",
]);

/** Premier param d'une clé (la query admin peut être `string | string[]`). */
function one(
  query: Readonly<Record<string, string | string[]>>,
  key: string,
): string | undefined {
  const value = query[key];
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value[0] : value;
}

/** Entier positif d'un param, ou `undefined` si absent/non numérique. */
function intParam(
  query: Readonly<Record<string, string | string[]>>,
  key: string,
): number | undefined {
  const raw = one(query, key);
  if (raw === undefined) return undefined;
  const n = Number.parseInt(raw, 10);
  return Number.isNaN(n) ? undefined : n;
}

/**
 * Traduit la query string admin en {@link IAuditQuery} typée. Un filtre
 * `category`/`outcome` **inconnu est ignoré** (permissif — l'endpoint est déjà
 * gardé `ROLE_NODEFONY_ADMIN`, renvoyer plus large à un admin est sûr) plutôt
 * que de renvoyer une 400 (robustesse de la console).
 *
 * @param query - `request.query` du broker admin.
 * @returns filtre prêt pour `auditStore.query`.
 */
export function parseAuditQuery(
  query: Readonly<Record<string, string | string[]>>,
): IAuditQuery {
  const filter: IAuditQuery = {};
  const category = one(query, "category");
  if (category !== undefined && CATEGORIES.has(category)) {
    filter.category = category as AuditCategory;
  }
  const outcome = one(query, "outcome");
  if (outcome !== undefined && OUTCOMES.has(outcome)) {
    filter.outcome = outcome as AuditOutcome;
  }
  const actor = one(query, "actor");
  if (actor !== undefined) filter.actor = actor;
  const action = one(query, "action");
  if (action !== undefined) filter.action = action;
  const requestId = one(query, "requestId");
  if (requestId !== undefined) filter.requestId = requestId;
  const since = intParam(query, "since");
  if (since !== undefined) filter.since = since;
  const until = intParam(query, "until");
  if (until !== undefined) filter.until = until;
  const limit = intParam(query, "limit");
  if (limit !== undefined) filter.limit = limit;
  const before = one(query, "before");
  if (before !== undefined) filter.before = before;
  return filter;
}

/**
 * Vue MINIMALE du service `webauthn` consommée par l'ADMIN — lecture des passkeys
 * d'un utilisateur + révocation **owner-scopée** (reset d'un facteur fort).
 * Couplage structurel (par nom de service) ; `removeUserCredential` renvoie
 * `false` si la passkey est inconnue OU n'appartient pas à l'utilisateur visé
 * (anti-IDOR interne — 404 indiscernable côté endpoint).
 */
interface IWebAuthnAdmin {
  listUserCredentials(userId: string): Promise<IWebAuthnCredential[]>;
  removeUserCredential(userId: string, credentialId: string): Promise<boolean>;
}

/**
 * État du 2FA TOTP d'un utilisateur — miroir structurel de `ITotpStatus` (sans
 * coupler `SecurityAdminApi` au sous-dossier `src/totp`).
 */
interface ITotpStatusView {
  /** Le 2ᵉ facteur est armé et exigé au login. */
  enabled: boolean;
  /** Enrôlement commencé mais pas confirmé (secret généré, jamais validé). */
  pending: boolean;
  /** Codes de récupération à usage unique encore disponibles. */
  recoveryCodesRemaining: number;
}

/**
 * Vue MINIMALE du service `totp` consommée par l'ADMIN — lecture d'état +
 * **désactivation** (reset d'un facteur fort : appareil perdu). PAS d'enrôlement
 * cross-user : impossible par construction (le secret se scanne sur l'appareil
 * de l'utilisateur), et illégitime (un admin n'arme pas le 2FA d'autrui).
 */
interface ITotpAdmin {
  status(userId: string): Promise<ITotpStatusView>;
  disable(userId: string): Promise<void>;
}

/**
 * Résolution d'un utilisateur par id — sert UNIQUEMENT à distinguer « utilisateur
 * inconnu » (404) de « utilisateur sans passkey / sans 2FA » (liste vide / état
 * désactivé). Vue minimale (présence de l'id), jamais l'entité complète.
 */
interface IUserLookup {
  findById(id: string): Promise<{ id: string } | null>;
}

/**
 * Vue admin d'une passkey — **redaction par construction** : la clé publique
 * COSE et le `userId` (déjà dans le path) sont OMIS. Aucun secret n'existe côté
 * serveur (la clé privée ne quitte jamais l'authenticator), on n'expose que
 * l'utile à la console.
 */
interface IAdminCredentialView {
  id: string;
  nickname: string | null;
  transports: readonly string[];
  backupEligible: boolean;
  backupState: boolean;
  uvInitialized: boolean;
  createdAt: number;
  lastUsedAt: number | null;
}

/** Projette un credential serveur vers sa vue admin (sans `publicKey`/`userId`). */
function toCredentialView(c: IWebAuthnCredential): IAdminCredentialView {
  return {
    id: c.id,
    nickname: c.nickname ?? null,
    transports: c.transports,
    backupEligible: c.backupEligible,
    backupState: c.backupState,
    uvInitialized: c.uvInitialized,
    createdAt: c.createdAt,
    lastUsedAt: c.lastUsedAt,
  };
}

/**
 * Producteur admin (`IAdminApi`) du module sécurité — data plane consommé par
 * Studio (section Sécurité, P6.15) :
 *
 *  - `GET /nodefony/security/api/audit/events` — page filtrée du journal d'audit
 *    (P6.14 Lot 3 ; `?category&outcome&actor&action&requestId&since&until&limit&before`),
 *    du plus récent au plus ancien, pagination par curseur (`before` / `nextBefore`).
 *  - `GET /nodefony/security/api/firewall` — introspection du firewall (zones,
 *    authenticators montés, défenses) — état RUNTIME, secrets exclus.
 *  - `GET /nodefony/security/api/roleHierarchy` — hiérarchie de rôles + résolution.
 *  - `GET /nodefony/security/api/apikeys` — toutes les clés API (gouvernance),
 *    `GET …/apikeys/status` — backend du token store (« où on écrit »),
 *    `POST …/apikeys/{id}/revoke` — révocation par id (réponse à incident).
 *  - `GET …/users/{id}/passkeys` + `DELETE …/users/{id}/passkeys/{credentialId}`
 *    — passkeys d'un utilisateur (vue admin sans clé publique) + révocation
 *    owner-scopée (reset facteur fort, audité).
 *  - `GET …/users/{id}/totp` + `POST …/users/{id}/totp/disable` — état du 2FA
 *    TOTP + désactivation (reset facteur fort, audité). Pas d'enrôlement
 *    cross-user (le secret se scanne sur l'appareil de l'utilisateur).
 *
 * **RBAC `ROLE_NODEFONY_ADMIN`** (appliqué par le broker, 403 sinon) — la console
 * sécurité ne se consulte qu'en administrateur. Handlers **lazy** : ils résolvent
 * `auditService`/`firewall` à la requête (service désactivable → 503), jamais au
 * montage. Le namespace `"security"` est distinct des routes classiques
 * `/nodefony/security/api/keys` (P6.12) — paths disjoints, zéro collision.
 *
 * @param container - container du kernel (résolution lazy des services).
 */
export function createSecurityAdminApi(container: Container): IAdminApi {
  const endpoints: IAdminEndpoint[] = [
    {
      path: "audit/events",
      method: "GET",
      role: "ROLE_NODEFONY_ADMIN",
      summary:
        "Journal d'audit de sécurité (login/refus/jetons). Filtres : " +
        "?category&outcome&actor&action&since&until&limit&before (curseur).",
      handler: async (
        request: IAdminRequest,
      ): Promise<IAuditQueryResult | IAdminResponse<{ error: string }>> => {
        const audit = container.get("auditService") as IAuditReader | undefined;
        if (!audit || !audit.isEnabled()) {
          return { status: 503, body: { error: "audit journal unavailable" } };
        }
        return audit.query(parseAuditQuery(request.query));
      },
    },
    {
      path: "firewall",
      method: "GET",
      role: "ROLE_NODEFONY_ADMIN",
      summary:
        "Introspection du firewall : zones (URL/host/authenticators), " +
        "authenticators montés, défenses (CSRF/CORS/en-têtes/throttle). " +
        "Secrets exclus (présence, jamais valeur).",
      handler: (): IFirewallDescription | IAdminResponse<{ error: string }> => {
        const firewall = container.get("firewall") as IFirewall | undefined;
        if (!firewall) {
          return { status: 503, body: { error: "firewall unavailable" } };
        }
        return firewall.describe();
      },
    },
    {
      path: "roleHierarchy",
      method: "GET",
      role: "ROLE_NODEFONY_ADMIN",
      summary:
        "Hiérarchie de rôles déclarée + résolution transitive " +
        "(RoleHierarchyWalker, niveau A de l'autorisation).",
      handler: ():
        IRoleHierarchyDescription | IAdminResponse<{ error: string }> => {
        const firewall = container.get("firewall") as IFirewall | undefined;
        if (!firewall) {
          return { status: 503, body: { error: "firewall unavailable" } };
        }
        return firewall.describeRoleHierarchy();
      },
    },
    {
      path: "apikeys",
      method: "GET",
      role: "ROLE_NODEFONY_ADMIN",
      summary:
        "Toutes les clés API (PAT) du système — gouvernance cross-porteur " +
        "(vue publique, sans secret : id/préfixe/porteur/scopes/dates).",
      handler: async (): Promise<
        { keys: IApiKeyView[] } | IAdminResponse<{ error: string }>
      > => {
        const svc = container.get("apiKeys") as IApiKeyAdmin | undefined;
        if (!svc || !svc.isEnabled()) {
          return { status: 503, body: { error: "api keys unavailable" } };
        }
        return { keys: await svc.listAllPat() };
      },
    },
    {
      path: "apikeys/status",
      method: "GET",
      role: "ROLE_NODEFONY_ADMIN",
      summary:
        "Statut du sous-système clés API : « où on écrit » = backend du token " +
        "store (classe réelle + driver memory/orm/redis). Sans secret.",
      handler: (): IApiKeysStatus => {
        // Lecture DÉFENSIVE : jamais de throw (la console doit toujours afficher
        // un badge honnête). Service absent / désactivé → enabled:false.
        const svc = container.get("apiKeys") as IApiKeyAdmin | undefined;
        const enabled = svc?.isEnabled() ?? false;
        // « Où on écrit » : le store RÉEL posé au container par le TokenService
        // (`tokenStore`). On lit SON nom de classe (jamais ses données) et on
        // re-dérive le driver — le driver config n'est pas exposé au container.
        const store = container.get("tokenStore") as TokenStoreLike | undefined;
        const className = store?.constructor?.name;
        return {
          enabled,
          store: className ?? "none",
          driver: className ? tokenStoreDriver(className) : null,
        };
      },
    },
    {
      path: "apikeys/{id}/revoke",
      method: "POST",
      role: "ROLE_NODEFONY_ADMIN",
      summary:
        "Révoque une clé API par id (réponse à incident : clé compromise) — " +
        "audité (acteur admin + porteur cible). 404 si introuvable.",
      handler: async (
        request: IAdminRequest,
      ): Promise<
        { ok: true; key: IApiKeyView } | IAdminResponse<{ error: string }>
      > => {
        const svc = container.get("apiKeys") as IApiKeyAdmin | undefined;
        if (!svc || !svc.isEnabled()) {
          return { status: 503, body: { error: "api keys unavailable" } };
        }
        const id = request.params.id;
        if (typeof id !== "string" || id.length === 0) {
          return { status: 404, body: { error: "not found" } };
        }
        const key = await svc.revokeAnyPat(id, adminActor(request.user));
        if (!key) {
          return { status: 404, body: { error: "not found" } };
        }
        return { ok: true, key };
      },
    },
    {
      path: "users/{id}/passkeys",
      method: "GET",
      role: "ROLE_NODEFONY_ADMIN",
      summary:
        "Passkeys (WebAuthn) d'un utilisateur — vue admin SANS clé publique " +
        "(id/surnom/transports/sauvegarde/UV/dates). 404 si utilisateur inconnu.",
      handler: async (
        request: IAdminRequest,
      ): Promise<
        | { credentials: IAdminCredentialView[] }
        | IAdminResponse<{ error: string }>
      > => {
        const svc = container.get("webauthn") as IWebAuthnAdmin | undefined;
        if (!svc) {
          return { status: 503, body: { error: "webauthn unavailable" } };
        }
        const id = request.params.id;
        if (typeof id !== "string" || id.length === 0) {
          return { status: 404, body: { error: "not found" } };
        }
        // Distingue « utilisateur inconnu » (404) de « pas de passkey » (liste
        // vide). Lookup best-effort : si le service `users` est absent, on rend
        // quand même la liste (le firewall a déjà authentifié l'admin).
        const users = container.get("users") as IUserLookup | undefined;
        if (users && !(await users.findById(id))) {
          return { status: 404, body: { error: "not found" } };
        }
        const creds = await svc.listUserCredentials(id);
        return { credentials: creds.map(toCredentialView) };
      },
    },
    {
      path: "users/{id}/passkeys/{credentialId}",
      method: "DELETE",
      role: "ROLE_NODEFONY_ADMIN",
      summary:
        "Révoque une passkey d'un utilisateur (reset admin) — audité. 404 si la " +
        "passkey n'existe pas ou n'appartient pas à l'utilisateur (anti-IDOR).",
      handler: async (
        request: IAdminRequest,
      ): Promise<{ ok: true } | IAdminResponse<{ error: string }>> => {
        const svc = container.get("webauthn") as IWebAuthnAdmin | undefined;
        if (!svc) {
          return { status: 503, body: { error: "webauthn unavailable" } };
        }
        const id = request.params.id;
        const credentialId = request.params.credentialId;
        if (
          typeof id !== "string" ||
          id.length === 0 ||
          typeof credentialId !== "string" ||
          credentialId.length === 0
        ) {
          return { status: 404, body: { error: "not found" } };
        }
        // `removeUserCredential` est owner-scopé : `false` = passkey inconnue OU
        // pas le propriétaire → 404 indiscernable (anti-énumération, même admin).
        const removed = await svc.removeUserCredential(id, credentialId);
        if (!removed) {
          return { status: 404, body: { error: "not found" } };
        }
        auditAdmin(container, {
          category: "webauthn",
          action: "user.passkey_revoked",
          outcome: "success",
          actor: adminActor(request.user),
          resource: id,
          metadata: { credentialId, viaAdmin: true },
        });
        return { ok: true };
      },
    },
    {
      path: "users/{id}/totp",
      method: "GET",
      role: "ROLE_NODEFONY_ADMIN",
      summary:
        "État du 2FA TOTP d'un utilisateur (activé / en attente / codes de " +
        "récupération restants). 404 si utilisateur inconnu.",
      handler: async (
        request: IAdminRequest,
      ): Promise<ITotpStatusView | IAdminResponse<{ error: string }>> => {
        const svc = container.get("totp") as ITotpAdmin | undefined;
        if (!svc) {
          return { status: 503, body: { error: "totp unavailable" } };
        }
        const id = request.params.id;
        if (typeof id !== "string" || id.length === 0) {
          return { status: 404, body: { error: "not found" } };
        }
        const users = container.get("users") as IUserLookup | undefined;
        if (users && !(await users.findById(id))) {
          return { status: 404, body: { error: "not found" } };
        }
        return svc.status(id);
      },
    },
    {
      path: "users/{id}/totp/disable",
      method: "POST",
      role: "ROLE_NODEFONY_ADMIN",
      summary:
        "Désactive le 2FA TOTP d'un utilisateur (reset admin : appareil perdu) " +
        "— audité. Idempotent (no-op si déjà désactivé).",
      handler: async (
        request: IAdminRequest,
      ): Promise<{ ok: true } | IAdminResponse<{ error: string }>> => {
        const svc = container.get("totp") as ITotpAdmin | undefined;
        if (!svc) {
          return { status: 503, body: { error: "totp unavailable" } };
        }
        const id = request.params.id;
        if (typeof id !== "string" || id.length === 0) {
          return { status: 404, body: { error: "not found" } };
        }
        const users = container.get("users") as IUserLookup | undefined;
        if (users && !(await users.findById(id))) {
          return { status: 404, body: { error: "not found" } };
        }
        await svc.disable(id);
        auditAdmin(container, {
          category: "auth",
          action: "user.totp_disabled",
          outcome: "success",
          actor: adminActor(request.user),
          resource: id,
          metadata: { viaAdmin: true },
        });
        return { ok: true };
      },
    },
    // ── Webhooks sortants (P6.13 Slice C) — endpoints dans un fichier dédié
    // (WebhookAdminApi.ts, greppable) composés ici pour hériter du RBAC
    // ROLE_NODEFONY_ADMIN + audit + duplex HTTP/WS du broker, sans dupliquer la
    // garde de rôle fail-closed dans un controller framework séparé.
    ...webhookAdminEndpoints(container),
  ];

  const descriptor: IAdminDescriptor = {
    label: "Sécurité",
    icon: "shield-lock",
    order: 15,
    role: "ROLE_NODEFONY_ADMIN",
  };

  return {
    adminNamespace: "security",
    adminDescriptor: () => descriptor,
    adminEndpoints: () => endpoints,
  };
}

/**
 * Enregistre le producteur admin sécurité sur le broker — **idempotent** (no-op
 * si déjà monté). À appeler au `onKernelBoot` du module (avant le montage des
 * routes par framework à `onKernelReady`). Calque `registerOrmAdminApi`.
 *
 * @param registry - broker admin (`container.get("adminBroker")`).
 * @param container - container du kernel (capturé par le handler lazy).
 */
export function registerSecurityAdminApi(
  registry: IAdminRegistry,
  container: Container,
): void {
  if (registry.has("security")) return;
  registry.register(createSecurityAdminApi(container));
}
