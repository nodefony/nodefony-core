/**
 * ApiClient — wrapper fetch avec gestion du token JWT.
 *
 * Centralise les appels REST vers le backend Nodefony.
 * Préfixe automatique `/nodefony/studio/api` (data plane admin du module Studio).
 *
 * **API souveraine (Ph.3)** : si une Socket Nodefony connectée est fournie
 * (`socket`), les GET passent par le pont JSON-RPC `api.request {path}` — la
 * MÊME action controller, le MÊME snapshot que le REST (prouvé backend,
 * `api-souverain-bridge.test.ts`). Transparent pour les pages : même URL, même
 * shape, mêmes erreurs (`ApiError`). La socket ne sert que les SUCCÈS :
 * fallback fetch automatique si elle est absente/déconnectée, si le pont
 * n'est pas exposé (`-32601`), si la route est sans transport WS pour cette
 * méthode (405 mémorisé, scopé à la méthode) et sur TOUTE erreur du pont (la
 * réponse d'erreur de référence vient du HTTP — cf `learnFromSocketError`).
 *
 * **Mutations par la socket (P6.8)** : les POST/PUT/PATCH/DELETE passent aussi
 * par le pont (`socket.mutate`), chacune avec une **clé d'idempotence** générée
 * ici. La MÊME clé est rejouée sur le fallback fetch (en-tête `Idempotency-Key`)
 * → un repli après échec socket ne double JAMAIS l'effet (le serveur dédoublonne).
 *
 * Sera enrichi en P6 (Security) : refresh token, redirect sur 401, etc.
 */

/**
 * Vue MINIMALE de la Socket Nodefony consommée par le pont (typage structurel —
 * `RealtimeClient` s'y conforme ; pas d'import runtime → 0 couplage, mockable).
 */
export interface ApiSocketLike {
  /** "connected" quand la socket est opérationnelle. */
  readonly state: string;
  /** Forme path de `RealtimeClient.request` — lecture GET via `api.request`. */
  request<T = unknown>(path: `/${string}`, timeoutMs?: number): Promise<T>;
  /** Forme mutation de `RealtimeClient.mutate` — POST/PUT/PATCH/DELETE + clé d'idempotence. */
  mutate<T = unknown>(
    path: `/${string}`,
    init: {
      method: "POST" | "PUT" | "PATCH" | "DELETE";
      body?: unknown;
      idempotencyKey: string;
      timeoutMs?: number;
    },
  ): Promise<T>;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Détail d'une erreur HTTP, fourni au centre de notifications. */
export interface ApiErrorInfo {
  method: string;
  status: number;
  message: string;
  body: unknown;
}

export interface ApiClientOptions {
  baseUrl?: string;
  onUnauthorized?: () => void;
  /** Notifié sur toute réponse non-2xx → branché au centre de notifications. */
  onError?: (info: ApiErrorInfo) => void;
  /** Socket Nodefony partagée — route les GET via le pont `api.request` quand connectée. */
  socket?: ApiSocketLike;
  /** Gate du pont (kill switch UI). Défaut : actif dès que `socket` est fournie. */
  socketEnabled?: () => boolean;
}

/** Extrait un message lisible d'un payload d'erreur Nodefony (`{error:{message}}` ou `{message}`). */
function extractMessage(payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object") {
    const p = payload as Record<string, unknown>;
    const e = (p.error ?? p) as Record<string, unknown>;
    if (typeof e.message === "string" && e.message) return e.message;
  }
  return fallback;
}

/**
 * Unwrap commun aux 2 transports : HttpKernel wrappe certaines réponses JSON en
 * `{ result: ... }` — et le pont renvoie le body REST tel quel (snapshot ≡).
 */
function unwrapResult<T>(payload: unknown): T {
  if (payload && typeof payload === "object" && "result" in payload) {
    return (payload as { result: T }).result;
  }
  return payload as T;
}

/** Forme structurelle d'un `RpcError` (core isomorphe) — duck-typing, pas d'import runtime. */
interface RpcErrorLike {
  name?: string;
  code?: number;
  message?: string;
  data?: { status?: number; body?: unknown };
}

/** Code JSON-RPC « méthode inconnue » → le serveur n'expose pas le pont `api.request`. */
const RPC_METHOD_NOT_FOUND = -32601;

/** Clé de route : le path SANS query (l'éligibilité au pont dépend de la ROUTE). */
function routeKey(url: string): string {
  const q = url.indexOf("?");
  return q === -1 ? url : url.slice(0, q);
}

/**
 * Clé « HTTP-only » scopée à la MÉTHODE : `GET /x` et `POST /x` peuvent déclarer
 * des transports différents (l'un pontable WS, l'autre non) → un 405 sur l'un ne
 * doit pas basculer l'autre en HTTP. Sans le scope par méthode, le GET hériterait
 * du verdict du POST (régression).
 */
function httpOnlyKey(method: string, url: string): string {
  return `${method} ${routeKey(url)}`;
}

/** Clé d'idempotence unique par mutation (UUID v4 ; fallback hors secure-context dev). */
function makeIdempotencyKey(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `idem-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export class ApiClient {
  private readonly baseUrl: string;
  private readonly onUnauthorized?: () => void;
  private readonly onError?: (info: ApiErrorInfo) => void;
  private readonly socket?: ApiSocketLike;
  private readonly socketEnabled?: () => boolean;
  /** Pont absent côté serveur (`-32601` reçu) → ne plus tenter de la session. */
  private socketBridgeDown = false;
  /**
   * Couples `méthode + route` répondus 405 par le pont = pas de transport WS
   * déclaré pour CETTE méthode → définitivement HTTP pour la session (évite un
   * aller-retour socket perdu à chaque appel). Clé = `httpOnlyKey(method, path)`.
   */
  private readonly httpOnlyRoutes = new Set<string>();

  constructor(opts: ApiClientOptions = {}) {
    this.baseUrl = opts.baseUrl ?? "/nodefony/studio/api";
    this.onUnauthorized = opts.onUnauthorized;
    this.onError = opts.onError;
    this.socket = opts.socket;
    this.socketEnabled = opts.socketEnabled;
  }

  async get<T = unknown>(path: string, init?: RequestInit): Promise<T> {
    return this.request<T>("GET", path, undefined, init);
  }

  async post<T = unknown>(
    path: string,
    body?: unknown,
    init?: RequestInit,
  ): Promise<T> {
    return this.request<T>("POST", path, body, init);
  }

  async put<T = unknown>(
    path: string,
    body?: unknown,
    init?: RequestInit,
  ): Promise<T> {
    return this.request<T>("PUT", path, body, init);
  }

  async delete<T = unknown>(path: string, init?: RequestInit): Promise<T> {
    return this.request<T>("DELETE", path, undefined, init);
  }

  /**
   * GET sur un chemin ABSOLU (data plane `/nodefony/<module>/api/*`), hors
   * `baseUrl`. Le catalogue (`/nodefony/framework/api/admin`) renvoie des
   * chemins absolus → on les appelle tels quels, avec le même JWT/erreurs.
   */
  async getAbsolute<T = unknown>(
    absolutePath: string,
    init?: RequestInit,
  ): Promise<T> {
    return this.send<T>("GET", absolutePath, undefined, init);
  }

  /** POST sur un chemin ABSOLU (data plane), hors `baseUrl` (cf getAbsolute). */
  async postAbsolute<T = unknown>(
    absolutePath: string,
    body?: unknown,
    init?: RequestInit,
  ): Promise<T> {
    return this.send<T>("POST", absolutePath, body, init);
  }

  /** PATCH sur un chemin ABSOLU (data plane), hors `baseUrl` (cf getAbsolute). */
  async patchAbsolute<T = unknown>(
    absolutePath: string,
    body?: unknown,
    init?: RequestInit,
  ): Promise<T> {
    return this.send<T>("PATCH", absolutePath, body, init);
  }

  /** DELETE sur un chemin ABSOLU (data plane), hors `baseUrl` (cf getAbsolute). */
  async deleteAbsolute<T = unknown>(
    absolutePath: string,
    init?: RequestInit,
  ): Promise<T> {
    return this.send<T>("DELETE", absolutePath, undefined, init);
  }

  private async request<T>(
    method: string,
    path: string,
    body: unknown,
    init?: RequestInit,
  ): Promise<T> {
    const url = `${this.baseUrl}${path.startsWith("/") ? path : "/" + path}`;
    return this.send<T>(method, url, body, init);
  }

  /**
   * Le pont socket est-il utilisable pour CE call ? GET (lecture) ET mutations
   * (POST/PUT/PATCH/DELETE, sécurisées par la clé d'idempotence côté serveur),
   * socket connectée, pont non désactivé, et aucun besoin fetch-spécifique
   * (abort/headers custom → on respecte le chemin HTTP).
   */
  private canUseSocket(
    method: string,
    url: string,
    init?: RequestInit,
  ): boolean {
    const supported =
      method === "GET" ||
      method === "POST" ||
      method === "PUT" ||
      method === "PATCH" ||
      method === "DELETE";
    return (
      supported &&
      this.socket !== undefined &&
      !this.socketBridgeDown &&
      (this.socketEnabled?.() ?? true) &&
      this.socket.state === "connected" &&
      url.startsWith("/") &&
      !init?.signal &&
      !init?.headers &&
      !this.httpOnlyRoutes.has(httpOnlyKey(method, url))
    );
  }

  /**
   * Apprend d'un échec du pont, puis laisse TOUJOURS le fallback fetch jouer.
   *
   * Politique : la socket ne sert que les SUCCÈS ; toute erreur est rejouée en
   * HTTP, qui fournit la réponse de référence (mêmes `ApiError`/notifications
   * que sans pont). Pourquoi ne PAS propager les erreurs socket : un 405 du
   * pont = « route GET-only » (le REST aurait servi le GET — vécu : /stats,
   * /health, /auth/me cassés au 1ᵉʳ déploiement) ; un 404 « router » peut viser
   * une URL que le REST sert autrement (static fallback) — indiscernables côté
   * client. Les erreurs applicatives sont rares → la double requête est un
   * coût acceptable contre ZÉRO divergence avec le REST. Mémorisations pour ne
   * pas re-payer l'aller-retour : `-32601` → pont absent (session) ; 405 →
   * route HTTP-only (session).
   */
  private learnFromSocketError(method: string, url: string, e: unknown): void {
    const rpc = e as RpcErrorLike;
    if (!e || typeof e !== "object" || rpc.name !== "RpcError") return;
    if (rpc.code === RPC_METHOD_NOT_FOUND) {
      this.socketBridgeDown = true;
      return;
    }
    // 405 = pas de transport WS pour CETTE méthode → mémorisé scopé à la méthode.
    if (rpc.data?.status === 405) {
      this.httpOnlyRoutes.add(httpOnlyKey(method, url));
    }
  }

  private async send<T>(
    method: string,
    url: string,
    body: unknown,
    init?: RequestInit,
  ): Promise<T> {
    // Clé d'idempotence générée UNE fois par mutation (réutilisée socket → fetch) :
    // un fallback fetch après un échec socket ne DOIT pas doubler l'effet si la
    // tentative socket avait abouti côté serveur → la MÊME clé fait dédoublonner
    // (le serveur rejoue la réponse mémorisée au lieu de ré-exécuter).
    const isMutation = method !== "GET" && method !== "HEAD";
    const idemKey = isMutation ? makeIdempotencyKey() : undefined;

    // ── Pont « API souveraine » : même action controller, transport socket.
    // GET = lecture ; mutation = `mutate` + clé. Succès → servi tel quel ; TOUT
    // échec → on apprend (-32601/405) puis on retombe sur le fetch ci-dessous
    // (réponse de référence ; la clé garantit l'absence de double-effet).
    if (this.canUseSocket(method, url, init)) {
      try {
        const payload =
          method === "GET"
            ? await this.socket!.request<unknown>(url as `/${string}`)
            : await this.socket!.mutate<unknown>(url as `/${string}`, {
                method: method as "POST" | "PUT" | "PATCH" | "DELETE",
                body,
                idempotencyKey: idemKey!,
              });
        return unwrapResult<T>(payload);
      } catch (e) {
        this.learnFromSocketError(method, url, e);
      }
    }

    const headers = new Headers(init?.headers);
    headers.set("Accept", "application/json");
    if (body !== undefined) headers.set("Content-Type", "application/json");
    // Idempotency-Key aussi en HTTP : (a) le repli d'une mutation tentée par la
    // socket réutilise la MÊME clé (dédup cross-transport) ; (b) une mutation
    // HTTP directe devient idempotente (anti double-soumission). Optionnelle
    // côté serveur en HTTP → honorée si présente.
    if (idemKey) headers.set("Idempotency-Key", idemKey);
    // Auth = cookie de session BFF HttpOnly (envoyé via `credentials:same-origin`),
    // PAS de Bearer JS-exposé (P6 : plus de JWT en localStorage → anti-XSS).

    const res = await fetch(url, {
      ...init,
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: "same-origin",
    });

    if (res.status === 401) this.onUnauthorized?.();

    const contentType = res.headers.get("Content-Type") ?? "";
    const isJson = contentType.includes("application/json");
    const payload = isJson ? await res.json() : await res.text();

    if (!res.ok) {
      const message = extractMessage(payload, `HTTP ${res.status}`);
      this.onError?.({ method, status: res.status, message, body: payload });
      throw new ApiError(
        res.status,
        payload,
        `${method} ${url} → HTTP ${res.status}`,
      );
    }
    // Nodefony wraps JSON responses: `{ result: ... }` selon HttpKernel.
    if (isJson) return unwrapResult<T>(payload);
    return payload as T;
  }
}
