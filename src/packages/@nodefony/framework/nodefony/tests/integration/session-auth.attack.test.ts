/// <reference types="node" />
/**
 * RED-TEAM — routes de session BFF (`/nodefony/security/api/auth/*`).
 * Requires: server running on 5152 (https). Start: /start-server
 *
 * Une réponse qui porte une identité ne doit JAMAIS être stockée par un cache
 * partagé (RFC 9111 §3 : un cookie dans la requête n'empêche pas le stockage ;
 * OWASP Session Management) : un proxy ou un CDN la resservirait à un autre
 * visiteur. Le refus, lui, ne doit pas l'être non plus — sinon le cache sert
 * « non connecté » à quelqu'un qui vient de se connecter.
 */
import { expect } from "vitest";
import https from "node:https";

const BASE = { hostname: "localhost", port: 5152, rejectUnauthorized: false };
const AUTH = "/nodefony/security/api/auth";
const ORIGIN = "https://localhost:5152";

type Res = { status: number; headers: Record<string, unknown>; body: string };

function call(
  method: string,
  path: string,
  headers: Record<string, string> = {},
  body?: unknown,
): Promise<Res> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const h: Record<string, string> = { origin: ORIGIN, ...headers };
    if (payload !== undefined) {
      h["content-type"] = "application/json";
      h["content-length"] = String(Buffer.byteLength(payload));
    }
    const req = https.request({ ...BASE, path, method, headers: h }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        resolve({
          status: res.statusCode ?? 0,
          headers: res.headers,
          body: Buffer.concat(chunks).toString(),
        });
      });
    });
    req.on("error", reject);
    req.end(payload);
  });
}

async function session(): Promise<string> {
  const res = await call(
    "POST",
    `${AUTH}/login`,
    {},
    {
      username: "user",
      password: "secret-de-dev-42",
    },
  );
  const cookie = (res.headers["set-cookie"] as string[] | undefined)?.[0];
  if (cookie === undefined) throw new Error(`login : ${res.status}`);
  return cookie.split(";")[0] ?? "";
}

describe("routes de session — aucune réponse en cache partagé", () => {
  it("🔴 `me` avec session : l'identité part en `no-store`", async () => {
    const res = await call("GET", `${AUTH}/me`, { cookie: await session() });
    expect(res.status).toBe(200);
    expect(res.body).toContain('"username":"user"');
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("🔴 `me` sans session : le refus part en `no-store`", async () => {
    const res = await call("GET", `${AUTH}/me`);
    expect(res.status).toBe(401);
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("🔴 `login` : la réponse qui porte l'identité part en `no-store`", async () => {
    const ok = await call(
      "POST",
      `${AUTH}/login`,
      {},
      {
        username: "user",
        password: "secret-de-dev-42",
      },
    );
    expect(ok.status).toBe(200);
    expect(ok.headers["cache-control"]).toBe("no-store");
    const ko = await call(
      "POST",
      `${AUTH}/login`,
      {},
      {
        username: "red-team-absent",
        password: "faux",
      },
    );
    expect(ko.status).toBe(401);
    expect(ko.headers["cache-control"]).toBe("no-store");
  });

  it("🔴 jeton, clés API, TOTP, fournisseurs : `no-store` partout (RFC 6749 §5.1)", async () => {
    const cookie = await session();
    const token = await call(
      "POST",
      "/nodefony/security/api/token",
      {},
      {
        username: "red-team-absent",
        password: "faux",
      },
    );
    const responses: [string, Res][] = [
      ["token (refus)", token],
      ["keys", await call("GET", "/nodefony/security/api/keys", { cookie })],
      [
        "totp/status",
        await call("GET", "/nodefony/security/api/totp/status", { cookie }),
      ],
      [
        "oauth2/providers",
        await call("GET", "/nodefony/security/api/oauth2/providers"),
      ],
    ];
    for (const [name, res] of responses) {
      expect(res.status, name).toBeLessThan(500);
      expect(res.headers["cache-control"], name).toBe("no-store");
    }
  });
});
