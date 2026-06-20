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

/**
 * Vue MINIMALE du service `auditService` consommée par le data plane — seule la
 * LECTURE (`query`) + l'état (`isEnabled`) sont nécessaires. Couplage structurel
 * (par nom de service), jamais d'import de la classe concrète.
 */
interface IAuditReader {
  isEnabled(): boolean;
  query(filter?: IAuditQuery): Promise<IAuditQueryResult>;
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
 * Producteur admin (`IAdminApi`) du module sécurité — data plane consommé par
 * Studio (section Sécurité, P6.15) :
 *
 *  - `GET /nodefony/security/api/audit/events` — page filtrée du journal d'audit
 *    (P6.14 Lot 3 ; `?category&outcome&actor&action&requestId&since&until&limit&before`),
 *    du plus récent au plus ancien, pagination par curseur (`before` / `nextBefore`).
 *  - `GET /nodefony/security/api/firewall` — introspection du firewall (zones,
 *    authenticators montés, défenses) — état RUNTIME, secrets exclus.
 *  - `GET /nodefony/security/api/roleHierarchy` — hiérarchie de rôles + résolution.
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
        | IRoleHierarchyDescription
        | IAdminResponse<{ error: string }> => {
        const firewall = container.get("firewall") as IFirewall | undefined;
        if (!firewall) {
          return { status: 503, body: { error: "firewall unavailable" } };
        }
        return firewall.describeRoleHierarchy();
      },
    },
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
