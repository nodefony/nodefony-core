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
 * shape, mêmes erreurs (`ApiError`). Fallback fetch automatique si la socket
 * est absente/déconnectée, si le pont n'est pas exposé (`-32601`) ou sur
 * erreur de transport (timeout). Les mutations (POST/PUT/DELETE) restent
 * HTTP-only (limitation Ph.3 assumée, doc `docs/api/README.md` §11.2).
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
  /** Forme path de `RealtimeClient.request` — méthode RPC `api.request` cachée. */
  request<T = unknown>(path: `/${string}`, timeoutMs?: number): Promise<T>;
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
  getToken?: () => string | null;
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

export class ApiClient {
  private readonly baseUrl: string;
  private readonly getToken: () => string | null;
  private readonly onUnauthorized?: () => void;
  private readonly onError?: (info: ApiErrorInfo) => void;
  private readonly socket?: ApiSocketLike;
  private readonly socketEnabled?: () => boolean;
  /** Pont absent côté serveur (`-32601` reçu) → ne plus tenter de la session. */
  private socketBridgeDown = false;

  constructor(opts: ApiClientOptions = {}) {
    this.baseUrl = opts.baseUrl ?? "/nodefony/studio/api";
    this.getToken = opts.getToken ?? (() => null);
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
   * Le pont socket est-il utilisable pour CE call ? GET seulement (mutations =
   * HTTP-only en Ph.3), socket connectée, pont non désactivé, et aucun besoin
   * fetch-spécifique (abort/headers custom → on respecte le chemin HTTP).
   */
  private canUseSocket(
    method: string,
    url: string,
    init?: RequestInit,
  ): boolean {
    return (
      method === "GET" &&
      this.socket !== undefined &&
      !this.socketBridgeDown &&
      (this.socketEnabled?.() ?? true) &&
      this.socket.state === "connected" &&
      url.startsWith("/") &&
      !init?.signal &&
      !init?.headers
    );
  }

  /**
   * Mappe un échec du pont. Renvoie un `ApiError` si c'est une vraie réponse
   * applicative (`RpcError.data.status` fetch-like : 404, 403…) → à PROPAGER,
   * surtout pas re-tenter en HTTP (la réponse EST arrivée). Renvoie `null` si
   * l'échec est protocolaire/transport (pont absent `-32601`, timeout, socket
   * fermée en vol) → fallback fetch transparent.
   */
  private mapSocketError(
    method: string,
    url: string,
    e: unknown,
  ): ApiError | null {
    const rpc = e as RpcErrorLike;
    if (!e || typeof e !== "object" || rpc.name !== "RpcError") return null;
    if (rpc.code === RPC_METHOD_NOT_FOUND) {
      this.socketBridgeDown = true;
      return null;
    }
    const status = rpc.data?.status;
    if (typeof status !== "number") return null; // -32603 & co → fallback HTTP
    if (status === 401) this.onUnauthorized?.();
    const payload = rpc.data?.body;
    const message = extractMessage(payload, `HTTP ${status}`);
    this.onError?.({ method, status, message, body: payload });
    return new ApiError(status, payload, `${method} ${url} → HTTP ${status}`);
  }

  private async send<T>(
    method: string,
    url: string,
    body: unknown,
    init?: RequestInit,
  ): Promise<T> {
    // ── Pont « API souveraine » : même action controller, transport socket. ──
    if (this.canUseSocket(method, url, init)) {
      try {
        const payload = await this.socket!.request<unknown>(
          url as `/${string}`,
        );
        return unwrapResult<T>(payload);
      } catch (e) {
        const applicative = this.mapSocketError(method, url, e);
        if (applicative) throw applicative;
        // Échec transport/protocole → on retombe sur fetch ci-dessous.
      }
    }

    const headers = new Headers(init?.headers);
    headers.set("Accept", "application/json");
    if (body !== undefined) headers.set("Content-Type", "application/json");
    const token = this.getToken();
    if (token) headers.set("Authorization", `Bearer ${token}`);

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
