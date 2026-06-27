import fs from "node:fs/promises";
import path from "node:path";
import type { Module } from "nodefony";
import type {
  IAdminApi,
  IAdminEndpoint,
  IAdminDescriptor,
  IAdminRequest,
  IAdminResponse,
} from "nodefony";
import type { ISessionSummary } from "../interfaces/ISession";

/** Forme minimale lue sur le service `sessions` (lecture défensive). */
interface SessionsLike {
  sessionStrategy?: string;
  defaultSessionName?: string;
  options?: {
    savePath?: string;
    idleTimeoutS?: number;
    absoluteTimeoutS?: number;
    handler?: string;
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
  listAllSessions(filter?: { user?: string }): Promise<ISessionSummary[]>;
  destroyByRef(ref: string, actor?: string | null): Promise<boolean>;
  destroyByUser(identifier: string, actor?: string | null): Promise<number>;
  // Self-service (scopé à l'appelant — anti-IDOR).
  listOwnSessions(identifier: string): Promise<ISessionSummary[]>;
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

/** Compte récursivement les fichiers de session sous `dir` (0 si absent). */
async function countSessionFiles(dir: string): Promise<number> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    let n = 0;
    for (const e of entries) {
      if (e.isDirectory()) n += await countSessionFiles(path.join(dir, e.name));
      else n++;
    }
    return n;
  } catch {
    return 0; // dossier inexistant = aucune session
  }
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
        // (`storage.inner`). Le `handler` config (drizzle/files/redis/mongo) est
        // le nom propre du driver ; on garde `storage` = classe du store réel.
        const inner = svc.storage?.inner ?? null;
        const storage =
          inner?.constructor?.name ?? svc.storage?.constructor?.name ?? "none";
        const driver = svc.options?.handler ?? null;
        // Révocation effective garantie ssi le store est bien décoré (anti-
        // résurrection — bug 2026-06-21 ; couvre TOUT backend). Honnête : false
        // si un jour le garde-fou n'était pas posé.
        const revocationHardened = inner !== null;
        // savePath/active n'ont de sens que pour un store FICHIER : le `driver`
        // config est la source fiable (drizzle/redis/mongo n'écrivent PAS de
        // fichiers, même si un `savePath` traîne dans la config par défaut → on
        // ne l'exposerait pas, sinon le badge mentirait « drizzle · tmp/… »).
        const isFileStore = driver === "files";
        const save = isFileStore ? svc.options?.savePath : undefined;
        // Nb de fichiers de session (store fichier). 0 si dossier absent.
        const active = save
          ? await countSessionFiles(path.resolve(process.cwd(), save))
          : null;
        // Chemin RELATIF au cwd (jamais l'absolu — info-leak FS).
        const savePath = save
          ? path.relative(process.cwd(), path.resolve(process.cwd(), save))
          : null;
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
      // Attributes ; un `ref` HMAC à la place). Paginé. Si le backend ne sait
      // pas s'énumérer (KV/edge) → 501 honnête, jamais une liste vide trompeuse.
      path: "sessions/list",
      method: "GET",
      role: "ROLE_NODEFONY_ADMIN",
      summary:
        "Sessions actives (ref/user/ip/ua/dates — jamais l'id de session). " +
        "Paginé : ?user&limit&offset.",
      handler: async (
        request: IAdminRequest,
      ): Promise<
        | {
            items: ISessionSummary[];
            total: number;
            limit: number;
            offset: number;
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
        const all = await svc.listAllSessions(
          user !== undefined ? { user } : undefined,
        );
        const { limit, offset } = pageParams(request.query);
        return {
          items: all.slice(offset, offset + limit),
          total: all.length,
          limit,
          offset,
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
        "Paginé : ?limit&offset.",
      handler: async (
        request: IAdminRequest,
      ): Promise<
        | {
            items: ISessionSummary[];
            total: number;
            limit: number;
            offset: number;
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
        const all = await svc.listOwnSessions(identifier);
        const { limit, offset } = pageParams(request.query);
        return {
          items: all.slice(offset, offset + limit),
          total: all.length,
          limit,
          offset,
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
