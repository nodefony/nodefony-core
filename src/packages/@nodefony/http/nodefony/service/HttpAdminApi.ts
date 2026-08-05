import { parsePageQuery, parseFilters } from "nodefony";
import {
  SESSION_FILTERS,
  SESSION_STATS_FILTERS,
  SESSION_FACETS,
} from "../src/session/storage/sessionFilters";
import type { ISessionCounts } from "../src/session/storage/sessionFilters";
import { RATE_LIMIT_FILTERS } from "../src/rateLimit/rateLimitFilters";
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
  /** Capacité de tri du backend configuré — vide = ce store ne trie pas. */
  sortableFields(): readonly string[];
  listSessionsPage(query: ISessionListQuery): Promise<IPage<ISessionSummary>>;
  /** Compteurs de tête, posés sur la collection entière (pas sur une page). */
  countSessionFacets(
    query?: Partial<ISessionListQuery>,
  ): Promise<ISessionCounts>;
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

/**
 * `limit`/`offset` du contrat de page, avec l'`offset` **matérialisé** : ces
 * endpoints le renvoient dans leur réponse, où l'absence n'a pas de sens (le
 * client lit « page 1 », pas « pas de décalage »). Le traducteur, lui, laisse
 * `offset` absent quand le client n'en demande pas — c'est le contrat.
 */
function pageParams(query: Readonly<Record<string, string | string[]>>): {
  limit: number;
  offset: number;
  q?: string;
} {
  // `searchable` : le seul appelant de ce helper est `rate-limit/list`, qui
  // filtre lui-même ses clés sur `q` (collection en mémoire). Un endpoint qui
  // ne relaierait pas `q` doit au contraire l'omettre, pour que la recherche
  // soit refusée en 400 plutôt qu'acceptée puis jetée.
  const parsed = parsePageQuery(query, { searchable: true });
  // `q` vient d'ICI et de nulle part ailleurs : le handler le relisait à la main
  // juste après, ce qui faisait deux lecteurs du même paramètre — le motif exact
  // qui a déjà produit un 400 sur un tri accepté par le premier appel.
  return {
    limit: parsed.limit,
    offset: parsed.offset ?? 0,
    ...(parsed.q !== undefined ? { q: parsed.q } : {}),
  };
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
        const { limit, offset, q } = pageParams(request.query);
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
        const page = await store.listPage({
          limit,
          offset,
          ...parseFilters(request.query, RATE_LIMIT_FILTERS),
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
      // Publiée dans le catalogue admin. C'est la ressource où l'écart entre
      // backends est le plus franc : le store Redis énumère par `SCAN` et ne
      // trie RIEN, là où mémoire, SQL et Mongo trient sur `updatedAt`/`id`. Une
      // console qui coderait le tri en dur afficherait des en-têtes cliquables
      // qui répondraient 400 — ici elle n'affiche que ce que le store annonce.
      page: {
        sortable: () => {
          const svc = module.get("sessions") as SessionsAdmin | undefined;
          return svc?.supportsEnumeration() ? svc.sortableFields() : [];
        },
        filters: SESSION_FILTERS,
      },
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
        // Le tri traverse jusqu'au store, avec l'allowlist DÉCLARÉE par le
        // backend configuré : sur un store qui ne trie pas (Redis SCAN), elle
        // est vide et `parsePageQuery` refuse tout `order` en 400 plutôt que de
        // rendre une page non triée.
        const pageQuery = parsePageQuery(request.query, {
          sortable: svc.sortableFields(),
        });
        const { limit } = pageQuery;
        const offset = pageQuery.offset ?? 0;
        // Pagination SERVEUR : le store ne rend qu'une page (LIMIT/OFFSET, SCAN).
        // Le coût de cet endpoint ne dépend plus du nombre de sessions.
        const page = await svc.listSessionsPage({
          limit,
          offset,
          // Backend à curseur (SCAN Redis) : sans le `cursor` entrant, le store
          // repart du début à CHAQUE appel et renvoie indéfiniment la même page
          // avec le même `nextCursor` — la pagination boucle sans jamais avancer.
          ...(pageQuery.cursor ? { cursor: pageQuery.cursor } : {}),
          ...parseFilters(request.query, SESSION_FILTERS),
          ...(pageQuery.order ? { order: pageQuery.order } : {}),
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
      // Compteurs de tête de la page Sessions. Endpoint SÉPARÉ de `sessions/list`
      // à dessein : ces nombres ne dépendent ni de la fenêtre ni de l'ordre, donc
      // les recalculer à chaque tour de page coûterait trois `COUNT` pour un
      // résultat identique. Déclaré AVANT `sessions/{ref}/revoke` (segment
      // littéral `stats` ≠ paramètre `{ref}`).
      path: "sessions/stats",
      method: "GET",
      role: "ROLE_NODEFONY_ADMIN",
      summary:
        "Compteurs des sessions sur la collection ENTIÈRE (total, authentifiées, " +
        "anonymes, utilisateurs distincts) — mêmes filtres que sessions/list. " +
        "Un compteur `null` = le backend ne sait pas le calculer (Redis).",
      // Mêmes filtres que la liste, et c'est le but : la console envoie ici le
      // query string qu'elle envoie à `sessions/list`, et obtient les compteurs
      // DE CE FILTRE. Les clés de fenêtre (`limit`, `offset`, `order`) sont
      // admises par le contrat de page et sans effet — un décompte n'a pas de
      // fenêtre, et ce que le client demande ici, c'est « combien en tout ».
      // `users` (utilisateurs distincts) n'est PAS une facette : c'est une
      // agrégation, pas un COUNT filtré — sa carte n'est donc pas cliquable,
      // faute de filtre qui la sélectionne.
      page: { filters: SESSION_STATS_FILTERS, facets: SESSION_FACETS },
      handler: async (
        request: IAdminRequest,
      ): Promise<ISessionCounts | IAdminResponse<{ error: string }>> => {
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
        // Un décompte n'a ni fenêtre ni ordre : ce que le contrat de page
        // porte encore doit être REFUSÉ, pas admis puis ignoré. `order` ne
        // changerait rien au nombre rendu, mais `q` SI — l'accepter sans
        // l'honorer ferait annoncer aux cartes une population que le tableau
        // filtré ne montre pas. Sans `sortable` ni `searchable`, le
        // traducteur refuse les deux (défaut REFUS).
        parsePageQuery(request.query, {});
        return svc.countSessionFacets(
          parseFilters(request.query, SESSION_STATS_FILTERS),
        );
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
      // Le tri est publié comme sur l'énumération admin — c'est le même store, et
      // la console sert les deux portées avec la MÊME table. **Aucun filtre** en
      // revanche, et c'est le fond du self-service : le périmètre est décidé par
      // le serveur à partir de l'identité de l'appelant. Un `?user=` accepté ici
      // serait un IDOR ; publier une spec vide dit au client qu'il n'a rien à
      // choisir, au lieu de le laisser essayer.
      page: {
        sortable: () => {
          const svc = module.get("sessions") as SessionsAdmin | undefined;
          return svc?.supportsEnumeration() ? svc.sortableFields() : [];
        },
        filters: {},
      },
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
        const ownQuery = parsePageQuery(request.query, {
          sortable: svc.sortableFields(),
        });
        // Spec VIDE, et l'appel n'est pas décoratif : `?user=alice` était accepté
        // puis jeté, et le self-service rendait MES sessions sous l'étiquette
        // « sessions d'alice ». Le scope serveur (anti-IDOR) n'a jamais faibli —
        // c'est la réponse qui mentait sur ce qu'elle montrait. Le refus (400)
        // dit ce que la publication annonce : ici, rien ne se filtre.
        parseFilters(request.query, {});
        const { limit } = ownQuery;
        const offset = ownQuery.offset ?? 0;
        const page = await svc.listOwnSessionsPage(identifier, {
          limit,
          offset,
          ...(ownQuery.order ? { order: ownQuery.order } : {}),
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
