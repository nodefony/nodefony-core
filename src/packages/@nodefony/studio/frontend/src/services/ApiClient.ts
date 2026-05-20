/**
 * ApiClient — wrapper fetch avec gestion du token JWT.
 *
 * Centralise les appels REST vers le backend Nodefony.
 * Préfixe automatique `/nodefony/studio/api` (data plane admin du module Studio).
 *
 * Sera enrichi en P6 (Security) : refresh token, redirect sur 401, etc.
 */

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

export interface ApiClientOptions {
  baseUrl?: string;
  getToken?: () => string | null;
  onUnauthorized?: () => void;
}

export class ApiClient {
  private readonly baseUrl: string;
  private readonly getToken: () => string | null;
  private readonly onUnauthorized?: () => void;

  constructor(opts: ApiClientOptions = {}) {
    this.baseUrl = opts.baseUrl ?? "/nodefony/studio/api";
    this.getToken = opts.getToken ?? (() => null);
    this.onUnauthorized = opts.onUnauthorized;
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

  private async request<T>(
    method: string,
    path: string,
    body: unknown,
    init?: RequestInit,
  ): Promise<T> {
    const url = `${this.baseUrl}${path.startsWith("/") ? path : "/" + path}`;
    return this.send<T>(method, url, body, init);
  }

  private async send<T>(
    method: string,
    url: string,
    body: unknown,
    init?: RequestInit,
  ): Promise<T> {
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
      throw new ApiError(
        res.status,
        payload,
        `${method} ${url} → HTTP ${res.status}`,
      );
    }
    // Nodefony wraps JSON responses: `{ result: ... }` selon HttpKernel.
    if (
      isJson &&
      payload &&
      typeof payload === "object" &&
      "result" in payload
    ) {
      return (payload as { result: T }).result;
    }
    return payload as T;
  }
}
