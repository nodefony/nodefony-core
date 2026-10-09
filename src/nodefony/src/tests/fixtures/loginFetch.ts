/**
 * Serveur de connexion simulé pour les bancs des liaisons de vue : un compte
 * avec second facteur — `POST login` rend `202 mfaRequired`, `POST login/totp`
 * ouvre la session sur le code `123456`. Les règles du déroulé sont éprouvées
 * dans `clientNodefonyLogin.test.ts` ; ce décor ne sert qu'à faire BOUGER l'état.
 */
import {
  AUTH_LOGIN_PATH,
  AUTH_LOGIN_TOTP_PATH,
} from "../../runtime/authRoutes";

export interface ILoginFetchBench {
  readonly fetch: typeof globalThis.fetch;
  /** Chemins appelés, dans l'ordre. */
  readonly calls: string[];
}

export function loginFetchBench(): ILoginFetchBench {
  const calls: string[] = [];
  const fetch = ((input: RequestInfo | URL, init: RequestInit = {}) => {
    const path =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    calls.push(path);
    const json = (status: number, body: unknown) =>
      Promise.resolve(
        new Response(JSON.stringify(body), {
          status,
          headers: { "content-type": "application/json" },
        }),
      );
    if (path === AUTH_LOGIN_PATH) {
      return json(202, { mfaRequired: true, methods: ["totp"] });
    }
    if (path === AUTH_LOGIN_TOTP_PATH) {
      const body = typeof init.body === "string" ? init.body : "{}";
      const code = (JSON.parse(body) as { code?: string }).code;
      return code === "123456"
        ? json(200, { user: { id: 1, username: "admin", roles: [] } })
        : json(401, { error: "Invalid credentials" });
    }
    return json(404, { error: "Not Found" });
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}
