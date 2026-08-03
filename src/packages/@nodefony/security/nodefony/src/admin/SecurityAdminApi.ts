import { parsePageQuery, parseFilters } from "nodefony";
import type { Container, IPage } from "nodefony";
import type {
  IAdminApi,
  IAdminDescriptor,
  IAdminEndpoint,
  IAdminRegistry,
  IAdminRequest,
  IAdminResponse,
} from "nodefony";
import type { ITokenListQuery } from "../../contracts/ITokenStore";
import {
  TOKEN_FILTERS,
  TOKEN_STATS_FILTERS,
  type ITokenCounts,
} from "../token/tokenFilters";
import { AUDIT_FILTERS } from "../audit/auditFilters";
import type {
  ITotpEnrollmentSummary,
  ITotpListQuery,
} from "../../contracts/ITotpSecretStore";
import type { IAuditEvent } from "../../contracts/IAuditEvent";
import type { IAuditListQuery } from "../../contracts/IAuditStore";
import type { IFirewall } from "../../contracts/IFirewall";
import type {
  IFirewallDescription,
  IRoleHierarchyDescription,
} from "../../contracts/IFirewallDescription";
import type { IApiKeyView } from "../../contracts/IApiKey";
import type { IWebAuthnCredential } from "../../contracts/IWebAuthnCredential";
import type {
  IWebAuthnCredentialSummary,
  IWebAuthnListQuery,
} from "../../contracts/IWebAuthnCredentialStore";
import { adminActor, auditAdmin } from "./adminAudit";
import { webhookAdminEndpoints } from "./WebhookAdminApi";

/**
 * Vue MINIMALE du service `auditService` consommée par le data plane — seule la
 * LECTURE (`listPage`) + l'état (`isEnabled`) sont nécessaires. Couplage
 * structurel (par nom de service), jamais d'import de la classe concrète.
 */
interface IAuditReader {
  isEnabled(): boolean;
  listPage(query: IAuditListQuery): Promise<IPage<IAuditEvent>>;
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
  sortableFields(): readonly string[];
  listPagePat(query: ITokenListQuery): Promise<IPage<IApiKeyView>>;
  /** Compteurs de tête, posés sur la collection entière (pas sur une page). */
  countKeyFacets(query?: Partial<ITokenListQuery>): Promise<ITokenCounts>;
  revokeAnyPat(id: string, actorId: string): Promise<IApiKeyView | null>;
}

/** Défaut/cap de taille de page du listing admin des clés API. */
const KEYS_DEFAULT_LIMIT = 50;
const KEYS_MAX_LIMIT = 200;

/**
 * Traduit la query string admin en {@link ITokenListQuery} bornée (`limit` par
 * défaut 50, cap 200 ; pagination, tri et filtres de {@link TOKEN_FILTERS}).
 *
 * **UN SEUL traducteur par dimension, jamais deux.** Pour la page et le tri,
 * `parsePageQuery` ; pour les filtres, `parseFilters`. En appeler un second sans
 * son allowlist ferait refuser en 400 ce que le premier venait d'accepter, et
 * aucun test unitaire ne le verrait (chaque appel est correct isolément).
 *
 * Un filtre inconnu ou mal formé est désormais **refusé** (400) au lieu d'être
 * ignoré : `?status=revoqué` rendait la liste ENTIÈRE, que la console affichait
 * comme le résultat du filtre demandé.
 *
 * @param query - `request.query` du broker admin.
 * @param sortable - champs que le backend branché sait trier ; un `?order=`
 *   portant autre chose est refusé en 400 par le traducteur. Liste vide (store à
 *   curseur, store absent) ⇒ tout tri est refusé, ce qui est la vérité du backend.
 */
export function parseTokenListQuery(
  query: Readonly<Record<string, string | string[]>>,
  sortable: readonly string[],
): ITokenListQuery {
  const page = parsePageQuery(query, {
    defaultLimit: KEYS_DEFAULT_LIMIT,
    maxLimit: KEYS_MAX_LIMIT,
    sortable,
  });
  const filters = parseFilters(query, TOKEN_FILTERS);
  const out: ITokenListQuery = { limit: page.limit, ...filters };
  if (page.offset !== undefined) out.offset = page.offset;
  if (page.cursor !== undefined) out.cursor = page.cursor;
  if (page.order !== undefined) out.order = page.order;
  return out;
}

/** Premier param d'une clé (la query admin peut être `string | string[]`). */
function one(
  query: Readonly<Record<string, string | string[]>>,
  key: string,
): string | undefined {
  const value = query[key];
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value[0] : value;
}

/** Taille de page du journal d'audit quand l'appelant n'en demande pas. */
const AUDIT_DEFAULT_LIMIT = 100;

/**
 * Traduit la query string admin en {@link IAuditListQuery} typée — pagination
 * par curseur, plus les filtres de {@link AUDIT_FILTERS}.
 *
 * Un filtre inconnu ou mal formé est **refusé** (400). Il était auparavant
 * ignoré, au nom de la robustesse de la console : mais un journal d'audit rendu
 * ENTIER à qui demandait `?outcome=deneid` n'est pas robuste — c'est la pire
 * réponse possible à un auditeur, qui lit l'absence de refus comme l'absence
 * d'incident. Le typage suit la même source : les valeurs viennent de la spec,
 * il n'y a plus de `as AuditCategory` à écrire ici.
 *
 * Le `limit` est **toujours posé** (défaut {@link AUDIT_DEFAULT_LIMIT}, cap du
 * traducteur) : le contrat de page n'admet pas « tout » ; le store applique en
 * plus son propre plafond, l'appelant ne peut donc pas s'en servir pour tirer un
 * journal entier.
 *
 * @param query - `request.query` du broker admin.
 * @returns filtre prêt pour `auditService.listPage`.
 * @throws `PageQueryError` (400) sur un filtre inconnu ou mal formé.
 */
export function parseAuditQuery(
  query: Readonly<Record<string, string | string[]>>,
): IAuditListQuery {
  // Le journal d'audit pagine par CURSEUR : on ne retient du contrat de page que
  // `limit` et `cursor` — pas d'`offset` (il ferait sauter des lignes sous
  // insertion concurrente), pas de `q` (aucun store d'audit ne le sait, et un
  // filtre accepté puis ignoré ment au client).
  const page = parsePageQuery(query, { defaultLimit: AUDIT_DEFAULT_LIMIT });
  const filter: IAuditListQuery = {
    limit: page.limit,
    ...parseFilters(query, AUDIT_FILTERS),
  };
  if (page.cursor !== undefined) filter.cursor = page.cursor;
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
  listCredentialsPage(
    query: IWebAuthnListQuery,
  ): Promise<IPage<IWebAuthnCredentialSummary>>;
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
  listPage(query: ITotpListQuery): Promise<IPage<ITotpEnrollmentSummary>>;
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
 *    (P6.14 Lot 3 ; `?category&outcome&actor&action&requestId&since&until&limit&cursor`),
 *    du plus récent au plus ancien, pagination par curseur (`cursor` / `nextCursor`).
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
        "?category&outcome&actor&action&since&until&limit&cursor (curseur).",
      handler: async (
        request: IAdminRequest,
      ): Promise<IPage<IAuditEvent> | IAdminResponse<{ error: string }>> => {
        const audit = container.get("auditService") as IAuditReader | undefined;
        if (!audit || !audit.isEnabled()) {
          return { status: 503, body: { error: "audit journal unavailable" } };
        }
        return audit.listPage(parseAuditQuery(request.query));
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
        "Clés API (PAT) du système — gouvernance cross-porteur, pagination NATIVE " +
        "au store (?subjectId&revoked&limit&offset|cursor&order=champ:ASC). Tri " +
        "limité aux champs que le backend branché déclare savoir trier. Vue " +
        "publique, sans secret.",
      // Publiée dans le catalogue admin : le store Redis de jetons ne déclare
      // aucun tri, une base SQL en déclare quatre. La console lit ce que le
      // backend RÉPOND, au lieu de coder en dur une liste qui serait juste
      // pour un déploiement et fausse pour le suivant.
      page: {
        sortable: () => {
          const svc = container.get("apiKeys") as IApiKeyAdmin | undefined;
          return svc?.isEnabled() ? svc.sortableFields() : [];
        },
        filters: TOKEN_FILTERS,
      },
      handler: async (
        request: IAdminRequest,
      ): Promise<
        | {
            keys: IApiKeyView[];
            total?: number;
            limit: number;
            offset?: number;
            nextCursor?: string | null;
          }
        | IAdminResponse<{ error: string }>
      > => {
        const svc = container.get("apiKeys") as IApiKeyAdmin | undefined;
        if (!svc || !svc.isEnabled()) {
          return { status: 503, body: { error: "api keys unavailable" } };
        }
        // Pagination serveur (jamais un listAll matérialisé). `keys` = LA page
        // (rétro-compat front) ; `total`/`offset`/`nextCursor` = métadonnées pour
        // la bascule DataGrid mode="server".
        const page = await svc.listPagePat(
          parseTokenListQuery(request.query, svc.sortableFields()),
        );
        return {
          keys: page.items,
          total: page.total,
          limit: page.limit,
          offset: page.offset,
          nextCursor: page.nextCursor,
        };
      },
    },
    {
      // Compteurs de tête. Endpoint SÉPARÉ de la liste : ces nombres ne
      // dépendent ni de la fenêtre ni de l'ordre — les rejouer à chaque tour de
      // page coûterait quatre COUNT pour un résultat identique.
      path: "apikeys/stats",
      method: "GET",
      role: "ROLE_NODEFONY_ADMIN",
      summary:
        "Compteurs des clés d'API sur la collection ENTIÈRE (total, actives, " +
        "expirées, révoquées) — mêmes filtres que la liste. `null` = le backend " +
        "ne sait pas compter (store Redis en curseur).",
      page: { filters: TOKEN_STATS_FILTERS },
      handler: async (
        request: IAdminRequest,
      ): Promise<ITokenCounts | IAdminResponse<{ error: string }>> => {
        const svc = container.get("apiKeys") as IApiKeyAdmin | undefined;
        if (!svc || !svc.isEnabled()) {
          return { status: 503, body: { error: "api keys unavailable" } };
        }
        return svc.countKeyFacets(
          parseFilters(request.query, TOKEN_STATS_FILTERS),
        );
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
      // Vue TRANSVERSE des passkeys : « quels appareils portent des passkeys,
      // lesquelles meurent avec leur appareil » — invisible depuis la fiche d'un
      // seul utilisateur. Pagination SERVEUR ; la vue ne porte pas la clé
      // publique (garantie du contrat de store, pas une redaction d'ici).
      // ⚠️ Ce chemin ne remplace JAMAIS `users/{id}/passkeys` : celui-ci sert la
      // fiche d'un porteur et reste non paginé (borné par `passkeys.maxPerUser`).
      path: "webauthn/list",
      method: "GET",
      role: "ROLE_NODEFONY_ADMIN",
      summary:
        "Passkeys de la plateforme (id, porteur, transports, sauvegarde, " +
        "compteur anti-clone, dates — jamais la clé publique). Paginé serveur : " +
        "?userId&backedUp&q&limit&offset. `enabled:false` = passkeys désactivés " +
        "en config. `total:-1` = backend sans comptage (Redis).",
      handler: async (
        request: IAdminRequest,
      ): Promise<{
        enabled: boolean;
        items: IWebAuthnCredentialSummary[];
        total?: number;
        limit: number;
        offset: number;
      }> => {
        const svc = container.get("webauthn") as IWebAuthnAdmin | undefined;
        const pageQuery = parsePageQuery(request.query, {
          defaultLimit: KEYS_DEFAULT_LIMIT,
          maxLimit: KEYS_MAX_LIMIT,
          // Le store des passkeys filtre bien sur `q` (il le reçoit plus bas) :
          // la capacité se déclare, et `q` se lit UNE fois — ici. Le handler le
          // relisait à la main juste après, ce qui en faisait le second lecteur
          // du même paramètre, le motif qui a déjà produit un 400 sur une valeur
          // que le premier appel venait d'accepter.
          searchable: true,
        });
        const limit = pageQuery.limit;
        const offset = pageQuery.offset ?? 0;
        // Lecture DÉFENSIVE : passkeys désactivés → état honnête, jamais un 503
        // (la console doit afficher « passkeys désactivés », pas une erreur).
        if (!svc) {
          return { enabled: false, items: [], total: 0, limit, offset };
        }
        const userId = one(request.query, "userId");
        const backedUp = one(request.query, "backedUp");
        const q = pageQuery.q;
        const page = await svc.listCredentialsPage({
          limit,
          offset,
          ...(userId !== undefined ? { userId } : {}),
          ...(backedUp === "true"
            ? { backedUp: true }
            : backedUp === "false"
              ? { backedUp: false }
              : {}),
          ...(q !== undefined ? { q } : {}),
        });
        return {
          enabled: true,
          items: page.items,
          total: page.total,
          limit,
          offset,
        };
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
      // Vue TRANSVERSE du 2FA : « quelle est la couverture, qui est resté en
      // attente de confirmation » — un secret jamais confirmé ne protège
      // personne, et c'est invisible depuis la fiche d'un seul utilisateur.
      // Pagination SERVEUR ; la vue ne porte NI secret NI condensats de codes
      // (garantie du contrat de store, pas une redaction d'ici).
      path: "totp/list",
      method: "GET",
      role: "ROLE_NODEFONY_ADMIN",
      summary:
        "Enrôlements 2FA TOTP (userId, paramètres, confirmation, codes de " +
        "récupération RESTANTS — jamais le secret). Paginé serveur : " +
        "?confirmed&q&limit&offset. `enabled:false` = 2FA désactivé en config.",
      handler: async (
        request: IAdminRequest,
      ): Promise<{
        enabled: boolean;
        items: ITotpEnrollmentSummary[];
        total?: number;
        limit: number;
        offset: number;
      }> => {
        const svc = container.get("totp") as ITotpAdmin | undefined;
        const pageQuery = parsePageQuery(request.query, {
          defaultLimit: KEYS_DEFAULT_LIMIT,
          maxLimit: KEYS_MAX_LIMIT,
        });
        const limit = pageQuery.limit;
        const offset = pageQuery.offset ?? 0;
        // Lecture DÉFENSIVE : 2FA désactivé → état honnête, jamais un 503 (la
        // console doit pouvoir afficher « 2FA désactivé » plutôt qu'une erreur).
        if (!svc) {
          return { enabled: false, items: [], total: 0, limit, offset };
        }
        const confirmed = one(request.query, "confirmed");
        const q = one(request.query, "q");
        const page = await svc.listPage({
          limit,
          offset,
          ...(confirmed === "true"
            ? { confirmed: true }
            : confirmed === "false"
              ? { confirmed: false }
              : {}),
          ...(q !== undefined ? { q } : {}),
        });
        return {
          enabled: true,
          items: page.items,
          total: page.total,
          limit,
          offset,
        };
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
