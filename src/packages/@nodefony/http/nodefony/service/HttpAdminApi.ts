import type { Module, IPage } from "nodefony";
import type {
  IAdminApi,
  IAdminEndpoint,
  IAdminDescriptor,
  IAdminRequest,
  IAdminResponse,
} from "nodefony";
import type {
  ISessionSummary,
  ISessionListQuery,
} from "../interfaces/ISession";
import type {
  IRateLimitEntry,
  IRateLimitStore,
} from "../src/rateLimit/IRateLimitStore";

/** Nom du service HttpKernel dans le container (source unique). */
const HTTP_KERNEL_SERVICE = "HttpKernel";

/**
 * Forme minimale lue sur le service `HttpKernel` — on ne veut QUE la surface de
 * lecture du rate-limit, jamais le pipeline (couplage structurel volontaire,
 * comme pour `sessions`).
 */
interface HttpKernelLike {
  rateLimitStore?: IRateLimitStore | null;
}

/** Forme minimale lue sur le service `sessions` (lecture défensive). */
interface SessionsLike {
  sessionStrategy?: string;
  defaultSessionName?: string;
  options?: {
    savePath?: string;
    idleTimeoutS?: number;
    absoluteTimeoutS?: number;
    store?: string;
  };
  // Le storage actif est décoré par `RevocationGuardStorage` (garde-fou de
  // révocation) → `.inner` porte le store RÉEL (drizzle/files/redis/mongo).
  storage?: {
    constructor?: { name?: string };
    inner?: { constructor?: { name?: string } } | null;
  } | null;
}

/**
 * Surface d'ADMINISTRATION du service `sessions` (couplage structurel par nom —
 * `HttpAdminApi` ne charge pas la classe `SessionsService`). Énumération +
 * révocation, toutes gardées `ROLE_NODEFONY_ADMIN` côté broker.
 */
interface SessionsAdmin {
  supportsEnumeration(): boolean;
  listSessionsPage(query: ISessionListQuery): Promise<IPage<ISessionSummary>>;
  destroyByRef(ref: string, actor?: string | null): Promise<boolean>;
  destroyByUser(identifier: string, actor?: string | null): Promise<number>;
  // Self-service (scopé à l'appelant — anti-IDOR).
  listOwnSessionsPage(
    identifier: string,
    query: ISessionListQuery,
  ): Promise<IPage<ISessionSummary>>;
  destroyOwnByRef(
    identifier: string,
    ref: string,
    actor?: string | null,
  ): Promise<boolean>;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/** Premier param d'une clé de query (peut être `string | string[]`). */
function one(
  query: Readonly<Record<string, string | string[]>>,
  key: string,
): string | undefined {
  const value = query[key];
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value[0] : value;
}

/** `?limit`/`?offset` bornés (défaut 50, cap dur 200 ; offset ≥ 0). */
function pageParams(query: Readonly<Record<string, string | string[]>>): {
  limit: number;
  offset: number;
} {
  const rawLimit = Number.parseInt(one(query, "limit") ?? "", 10);
  const rawOffset = Number.parseInt(one(query, "offset") ?? "", 10);
  const limit = Number.isNaN(rawLimit)
    ? DEFAULT_LIMIT
    : Math.min(Math.max(rawLimit, 1), MAX_LIMIT);
  const offset = Number.isNaN(rawOffset) || rawOffset < 0 ? 0 : rawOffset;
  return { limit, offset };
}

/**
 * Libellé d'identité de l'admin appelant (pour l'audit) — duck-typing prudent
 * sur l'`IUser` projeté dans `IAdminRequest.user`. Repli `"admin"`.
 */
function adminActor(user: unknown): string {
  if (user && typeof user === "object") {
    const u = user as { username?: unknown; identifier?: unknown };
    if (typeof u.username === "string" && u.username) return u.username;
    if (typeof u.identifier === "string" && u.identifier) return u.identifier;
  }
  return "admin";
}

/**
 * Identifiant de l'appelant authentifié pour le SCOPE self-service — lu sur l'IUser
 * projeté dans `IAdminRequest.user` (= `session.user`, posé au login). `null` si
 * absent/vide → le handler répond 401 (jamais de scope vide qui listerait les
 * sessions anonymes). **Jamais** dérivé d'un paramètre client (anti-IDOR).
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
 * Producteur `IAdminApi` du module **http** — exposé sous `/nodefony/http/api/*`.
 *
 * 2ᵉ producteur du data plane admin (le 1er étant le kernel). Démontre le
 * pattern multi-modules : `@nodefony/http` n'importe QUE le contrat core
 * (`IAdminApi`) — jamais `@nodefony/framework` (dépendance circulaire). Il
 * s'enregistre auprès du broker via `IAdminRegistry` récupéré du container.
 *
 * Endpoints :
 *  - `GET /nodefony/http/api/servers` → liste des serveurs réseau + leur état
 *  - `GET /nodefony/http/api/info`    → résumé (serveurs prêts, ports, schemes)
 *
 * @param module - le module http (accès aux services serveur du container).
 * @returns le contrat admin de http, prêt à `registry.register()`.
 */
export function createHttpAdminApi(module: Module): IAdminApi {
  /** Noms des services serveur enregistrés par le module http. */
  const serverServices = [
    "server-http",
    "server-https",
    "server-websocket",
    "server-websocket-secure",
    "server-static",
  ] as const;

  /** Forme minimale lue sur un service serveur (lecture défensive). */
  interface ServerLike {
    type?: string;
    scheme?: string;
    protocol?: string;
    address?: string;
    port?: number;
    family?: string | null;
    ready?: boolean;
  }

  const readServer = (
    name: string,
  ): (ServerLike & { service: string }) | null => {
    const svc = module.get(name) as ServerLike | undefined;
    if (!svc) return null;
    return {
      service: name,
      type: svc.type,
      scheme: svc.scheme,
      protocol: svc.protocol,
      address: svc.address,
      port: svc.port,
      family: svc.family ?? null,
      ready: svc.ready ?? false,
    };
  };

  const listServers = () =>
    serverServices
      .map((name) => readServer(name))
      .filter((s): s is ServerLike & { service: string } => s !== null);

  const descriptor: IAdminDescriptor = {
    label: "HTTP",
    icon: "network",
    order: 1,
  };

  const endpoints: IAdminEndpoint[] = [
    {
      path: "servers",
      summary:
        "Network servers (http/https/ws/wss/static) with listening state",
      handler: () => listServers(),
    },
    {
      path: "info",
      summary: "HTTP layer summary — ready servers, ports, schemes",
      handler: () => {
        const servers = listServers();
        const ready = servers.filter((s) => s.ready);
        return {
          serversTotal: servers.length,
          serversReady: ready.length,
          ports: [...new Set(ready.map((s) => s.port).filter(Boolean))],
          schemes: [...new Set(ready.map((s) => s.scheme).filter(Boolean))],
          protocols: [...new Set(ready.map((s) => s.protocol).filter(Boolean))],
        };
      },
    },
    {
      // Introspection du rate-limit par IP : « qui martèle, qui prend des 429 ».
      // Pagination SERVEUR (le store ne rend qu'une page) et tri par compteur
      // décroissant — la question d'exploitation, pas l'ordre d'insertion.
      // ADMIN-ONLY : une IP est une donnée personnelle. Seul l'ÉTAT du compteur
      // sort d'ici (jamais l'URL, l'en-tête ou le corps des requêtes).
      path: "rate-limit/list",
      method: "GET",
      role: "ROLE_NODEFONY_ADMIN",
      summary:
        "Clés (IP) suivies par le rate-limit général, les plus bruyantes " +
        "d'abord. Paginé serveur : ?limited&q&limit&offset. `enabled:false` " +
        "= rate-limit désarmé en config (liste vide, pas une erreur).",
      handler: async (
        request: IAdminRequest,
      ): Promise<{
        enabled: boolean;
        trackedCount: number;
        rejectedTotal: number;
        items: IRateLimitEntry[];
        total?: number;
        limit: number;
        offset: number;
      }> => {
        const { limit, offset } = pageParams(request.query);
        const store = (module.get(HTTP_KERNEL_SERVICE) as HttpKernelLike)
          ?.rateLimitStore;
        // Lecture DÉFENSIVE : rate-limit désactivé (défaut) → état honnête,
        // jamais un 503 (la console doit pouvoir afficher « désarmé »).
        if (!store) {
          return {
            enabled: false,
            trackedCount: 0,
            rejectedTotal: 0,
            items: [],
            total: 0,
            limit,
            offset,
          };
        }
        const limitedRaw = one(request.query, "limited");
        const q = one(request.query, "q");
        const page = await store.listPage({
          limit,
          offset,
          ...(limitedRaw === "true"
            ? { limited: true }
            : limitedRaw === "false"
              ? { limited: false }
              : {}),
          ...(q !== undefined ? { q } : {}),
        });
        return {
          enabled: true,
          trackedCount: store.trackedCount,
          rejectedTotal: store.rejectedTotal,
          items: page.items,
          total: page.total,
          limit,
          offset,
        };
      },
    },
    {
      // Sessions = base de l'authentification web BFF (cookie opaque, session
      // serveur). Défaut web depuis la révision 2026-06-06 (JWT réservé aux API
      // M2M, PAS au web). On expose son état réel + le nb de sessions actives
      // (storage fichier par défaut) pour le KPI Studio.
      path: "sessions",
      summary: "Session subsystem status + active count (web BFF auth)",
      handler: async () => {
        const svc = module.get("sessions") as SessionsLike | undefined;
        if (!svc) return { enabled: false, active: 0 };
        // « Où on écrit » : le store RÉEL est sous le garde-fou de révocation
        // (`storage.inner`). Le `store` config (drizzle/files/redis/mongo) est
        // le nom propre du backend ; on garde `storage` = classe du store réel.
        const inner = svc.storage?.inner ?? null;
        const storage =
          inner?.constructor?.name ?? svc.storage?.constructor?.name ?? "none";
        const driver = svc.options?.store ?? null;
        // Révocation effective garantie ssi le store est bien décoré (anti-
        // résurrection — bug 2026-06-21 ; couvre TOUT backend). Honnête : false
        // si un jour le garde-fou n'était pas posé.
        const revocationHardened = inner !== null;
        // `savePath`/`active` étaient propres au store fichier (1 fichier/session),
        // retiré : plus aucun backend session n'écrit de fichiers plats → toujours
        // `null` (DTO conservé pour la page Sessions ; les backends memory/drizzle/
        // redis/mongo comptent via leur propre introspection, pas un dossier).
        const savePath: string | null = null;
        const active: number | null = null;
        return {
          enabled: true,
          strategy: svc.sessionStrategy ?? null,
          // Activation pilotée par l'intent `@UseSession` / cookie (plus de
          // démarrage global) — l'aire est déclarée par route, pas globalement.
          activation: "intent",
          name: svc.defaultSessionName ?? null,
          driver,
          storage,
          revocationHardened,
          idleTimeoutS: svc.options?.idleTimeoutS ?? null,
          absoluteTimeoutS: svc.options?.absoluteTimeoutS ?? null,
          savePath,
          active,
        };
      },
    },
    {
      // Énumération des sessions persistées — DTO redacté (jamais l'id brut ni
      // Attributes ; un `ref` HMAC à la place). Pagination SERVEUR (le store ne
      // rend qu'une page). Si le backend ne sait pas s'énumérer (KV/edge) → 501
      // honnête, jamais une liste vide trompeuse.
      path: "sessions/list",
      method: "GET",
      role: "ROLE_NODEFONY_ADMIN",
      summary:
        "Sessions actives (ref/user/ip/ua/dates — jamais l'id de session). " +
        "Paginé côté serveur : ?user&limit&offset. `total` absent et " +
        "`nextCursor` présent sur un backend à curseur (Redis).",
      handler: async (
        request: IAdminRequest,
      ): Promise<
        | {
            items: ISessionSummary[];
            total?: number;
            limit: number;
            offset: number;
            nextCursor?: string | null;
          }
        | IAdminResponse<{ error: string }>
      > => {
        const svc = module.get("sessions") as SessionsAdmin | undefined;
        if (!svc) {
          return {
            status: 503,
            body: { error: "session service unavailable" },
          };
        }
        if (!svc.supportsEnumeration()) {
          return {
            status: 501,
            body: { error: "session enumeration not supported by storage" },
          };
        }
        const user = one(request.query, "user");
        const { limit, offset } = pageParams(request.query);
        // Pagination SERVEUR : le store ne rend qu'une page (LIMIT/OFFSET, SCAN).
        // Le coût de cet endpoint ne dépend plus du nombre de sessions.
        const page = await svc.listSessionsPage({
          limit,
          offset,
          ...(user !== undefined ? { user } : {}),
        });
        // `total` est REPORTÉ tel quel : absent sur un backend à curseur, où le
        // déduire de `items.length` mentirait sur le périmètre.
        return {
          items: page.items,
          total: page.total,
          limit,
          offset,
          ...(page.nextCursor !== undefined
            ? { nextCursor: page.nextCursor }
            : {}),
        };
      },
    },
    {
      // Révocation ciblée par référence publique (HMAC). Audité (acteur admin).
      path: "sessions/{ref}/revoke",
      method: "POST",
      role: "ROLE_NODEFONY_ADMIN",
      summary:
        "Révoque une session par sa référence publique (sess_…). Audité. " +
        "404 si la référence ne correspond à aucune session.",
      handler: async (
        request: IAdminRequest,
      ): Promise<{ ok: true } | IAdminResponse<{ error: string }>> => {
        const svc = module.get("sessions") as SessionsAdmin | undefined;
        if (!svc) {
          return {
            status: 503,
            body: { error: "session service unavailable" },
          };
        }
        if (!svc.supportsEnumeration()) {
          return {
            status: 501,
            body: { error: "session enumeration not supported by storage" },
          };
        }
        const ref = request.params.ref;
        if (typeof ref !== "string" || ref.length === 0) {
          return { status: 404, body: { error: "not found" } };
        }
        const ok = await svc.destroyByRef(ref, adminActor(request.user));
        if (!ok) {
          return { status: 404, body: { error: "not found" } };
        }
        return { ok: true };
      },
    },
    {
      // « Déconnexion partout » : détruit toutes les sessions d'un utilisateur.
      path: "sessions/revoke-user/{identifier}",
      method: "POST",
      role: "ROLE_NODEFONY_ADMIN",
      summary:
        "Déconnecte TOUTES les sessions d'un utilisateur (logout everywhere). " +
        "Audité. Renvoie le nombre de sessions détruites.",
      handler: async (
        request: IAdminRequest,
      ): Promise<
        { ok: true; count: number } | IAdminResponse<{ error: string }>
      > => {
        const svc = module.get("sessions") as SessionsAdmin | undefined;
        if (!svc) {
          return {
            status: 503,
            body: { error: "session service unavailable" },
          };
        }
        if (!svc.supportsEnumeration()) {
          return {
            status: 501,
            body: { error: "session enumeration not supported by storage" },
          };
        }
        const identifier = request.params.identifier;
        if (typeof identifier !== "string" || identifier.length === 0) {
          return { status: 400, body: { error: "identifier required" } };
        }
        const count = await svc.destroyByUser(
          identifier,
          adminActor(request.user),
        );
        return { ok: true, count };
      },
    },
    {
      // ── Self-service : « MES sessions » — tout utilisateur AUTHENTIFIÉ, pas
      // seulement un admin. `public: true` = le broker n'impose AUCUN rôle ;
      // l'AUTHENTIFICATION reste garantie EN AMONT par la zone firewall
      // `nodefony-admin` (`^/nodefony/[^/]+/api(/|$)`, authenticators `["session"]`
      // SANS `anonymous`) → un anonyme est rejeté 401 avant ce handler. Ce n'est
      // donc PAS une sonde publique : le périmètre est fermé par l'identité ALS
      // (`currentIdentifier`), jamais par un paramètre client (anti-IDOR).
      path: "sessions/mine",
      method: "GET",
      public: true,
      summary:
        "MES sessions (self-service) — ref/ip/ua/dates, scopées à l'appelant. " +
        "Paginé côté serveur : ?limit&offset.",
      handler: async (
        request: IAdminRequest,
      ): Promise<
        | {
            items: ISessionSummary[];
            total?: number;
            limit: number;
            offset: number;
            nextCursor?: string | null;
          }
        | IAdminResponse<{ error: string }>
      > => {
        const svc = module.get("sessions") as SessionsAdmin | undefined;
        if (!svc) {
          return {
            status: 503,
            body: { error: "session service unavailable" },
          };
        }
        if (!svc.supportsEnumeration()) {
          return {
            status: 501,
            body: { error: "session enumeration not supported by storage" },
          };
        }
        const identifier = currentIdentifier(request.user);
        if (!identifier) {
          return { status: 401, body: { error: "unauthenticated" } };
        }
        const { limit, offset } = pageParams(request.query);
        const page = await svc.listOwnSessionsPage(identifier, {
          limit,
          offset,
        });
        return {
          items: page.items,
          total: page.total,
          limit,
          offset,
          ...(page.nextCursor !== undefined
            ? { nextCursor: page.nextCursor }
            : {}),
        };
      },
    },
    {
      // ── Self-service : révoquer UNE de MES sessions (déconnexion d'un appareil).
      // Même garde firewall que `sessions/mine`. Le scope self ferme l'IDOR : le
      // service ne scanne QUE les sessions de l'appelant → un `ref` d'autrui est
      // introuvable (404). Mutation POST (CSRF par le pipeline ; socket GET-only).
      path: "sessions/mine/{ref}/revoke",
      method: "POST",
      public: true,
      summary:
        "Révoque UNE de MES sessions par sa référence (sess_…). 404 si la " +
        "référence n'est pas une de mes sessions. Audité.",
      handler: async (
        request: IAdminRequest,
      ): Promise<{ ok: true } | IAdminResponse<{ error: string }>> => {
        const svc = module.get("sessions") as SessionsAdmin | undefined;
        if (!svc) {
          return {
            status: 503,
            body: { error: "session service unavailable" },
          };
        }
        if (!svc.supportsEnumeration()) {
          return {
            status: 501,
            body: { error: "session enumeration not supported by storage" },
          };
        }
        const identifier = currentIdentifier(request.user);
        if (!identifier) {
          return { status: 401, body: { error: "unauthenticated" } };
        }
        const ref = request.params.ref;
        if (typeof ref !== "string" || ref.length === 0) {
          return { status: 404, body: { error: "not found" } };
        }
        // Acteur = le propriétaire lui-même (audit self).
        const ok = await svc.destroyOwnByRef(identifier, ref, identifier);
        if (!ok) {
          return { status: 404, body: { error: "not found" } };
        }
        return { ok: true };
      },
    },
  ];

  return {
    adminNamespace: "http",
    adminDescriptor: () => descriptor,
    adminEndpoints: () => endpoints,
  };
}
