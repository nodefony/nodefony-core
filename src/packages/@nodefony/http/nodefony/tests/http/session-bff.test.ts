/// <reference types="node" />
import { expect } from "chai";
import https from "node:https";

/**
 * P6 J3 — session BFF (login/logout/me + SessionAuthenticator).
 *
 * Banc : endpoints `/nodefony/security/api/auth/*` (montés par framework si le
 * service `authFlow` existe) + zone `test-secure` (`authenticators:
 * ["session", "userpassword"]`, mode first). Gates :
 * - login JSON → cookie de session opaque HttpOnly, credential jamais rejoué ;
 * - anti-fixation (OWASP) : l'ID de session CHANGE au login ;
 * - le cookie seul franchit la zone (SessionAuthenticator, re-fetch provider) ;
 * - logout → session détruite, le cookie ne donne plus rien ;
 * - throttling NIST PARTAGÉ entre la porte JSON et la porte Basic (même
 *   compteur — pas de contournement en changeant de porte).
 */

const BASE = { hostname: "localhost", port: 5152, rejectUnauthorized: false };
const AUTH = "/nodefony/security/api/auth";

type Res = { status: number; headers: Record<string, unknown>; body: unknown };

function request(
  path: string,
  method: string,
  headers: Record<string, string> = {},
  payload: unknown = undefined,
): Promise<Res> {
  return new Promise((resolve, reject) => {
    const data =
      payload === undefined ? null : Buffer.from(JSON.stringify(payload));
    const req = https.request(
      {
        ...BASE,
        path,
        method,
        headers: {
          ...headers,
          ...(data
            ? {
                "content-type": "application/json",
                "content-length": String(data.length),
              }
            : {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString();
          let body: unknown = raw;
          try {
            body = JSON.parse(raw);
          } catch {
            /* texte brut */
          }
          resolve({
            status: res.statusCode!,
            headers: res.headers as Record<string, unknown>,
            body,
          });
        });
      },
    );
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

const get = (path: string, headers: Record<string, string> = {}) =>
  request(path, "GET", headers);
const post = (
  path: string,
  payload?: unknown,
  headers: Record<string, string> = {},
) => request(path, "POST", headers, payload);

const basic = (identifier: string, password: string) => ({
  authorization: `Basic ${Buffer.from(`${identifier}:${password}`, "utf8").toString("base64")}`,
});

/** Extrait `name=value` du PREMIER Set-Cookie de la réponse (cookie de session). */
function sessionCookieOf(res: Res): string | null {
  const setCookie = res.headers["set-cookie"];
  const first = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  if (typeof first !== "string") return null;
  return first.split(";")[0] ?? null;
}

async function login(identifier: string, password: string): Promise<Res> {
  return post(`${AUTH}/login`, { username: identifier, password });
}

describe("P6 J3 — session BFF login/logout/me (requires server)", () => {
  it("login : body invalide ou credential faux → 401 au message uniforme", async () => {
    const empty = await post(`${AUTH}/login`, {});
    expect(empty.status).to.equal(401);
    const bad = await login("admin", "wrong");
    expect(bad.status).to.equal(401);
    expect((bad.body as { error: string }).error).to.equal(
      (empty.body as { error: string }).error,
    );
  });

  it("login valide → 200 {user} (jamais de hash) + cookie de session HttpOnly", async () => {
    const res = await login("admin", "secret");
    expect(res.status).to.equal(200);
    const user = (res.body as { user: { username: string; roles: string[] } })
      .user;
    expect(user.username).to.equal("admin");
    expect(user.roles).to.include("ROLE_ADMIN");
    expect(JSON.stringify(res.body)).to.not.match(/\$argon2|\$2[aby]\$/);
    const setCookie = res.headers["set-cookie"];
    const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    expect(raw, "Set-Cookie attendu au login").to.be.a("string");
    expect(String(raw).toLowerCase()).to.include("httponly");
  });

  it("me : la session re-résout l'identité (rôles frais) ; sans cookie → 401", async () => {
    const logged = await login("user", "secret");
    const cookie = sessionCookieOf(logged);
    expect(cookie).to.be.a("string");
    const me = await get(`${AUTH}/me`, { cookie: cookie! });
    expect(me.status).to.equal(200);
    expect((me.body as { user: { username: string } }).user.username).to.equal(
      "user",
    );
    const anonymous = await get(`${AUTH}/me`);
    expect(anonymous.status).to.equal(401);
  });

  it("anti-fixation (OWASP) : l'ID de session CHANGE au login", async () => {
    // Session AVANT login (route à session du module test) — un attaquant
    // aurait pu forcer ce cookie dans le navigateur de la victime.
    const preLogin = await get("/nodefony/test/rest/session");
    const fixated = sessionCookieOf(preLogin);
    expect(fixated).to.be.a("string");
    // Login en PRÉSENTANT le cookie pré-posé : l'ID doit être régénéré.
    const logged = await post(
      `${AUTH}/login`,
      { username: "admin", password: "secret" },
      { cookie: fixated! },
    );
    expect(logged.status).to.equal(200);
    const regenerated = sessionCookieOf(logged);
    expect(regenerated, "Set-Cookie attendu au login (ID régénéré)").to.be.a(
      "string",
    );
    expect(regenerated).to.not.equal(fixated);
  });

  it("le cookie de session SEUL franchit la zone protégée (SessionAuthenticator)", async () => {
    const logged = await login("admin", "secret");
    const cookie = sessionCookieOf(logged)!;
    const ping = await get("/nodefony/test/secure/ping", { cookie });
    expect(ping.status).to.equal(200);
    expect(ping.body).to.deep.equal({ pong: true, secure: true });
    // Identité propagée dans l'ALS, comme avec Basic (co-citoyenneté des portes).
    const whoami = await get("/nodefony/test/secure/whoami", { cookie });
    expect(whoami.status).to.equal(200);
    expect((whoami.body as { identifier: string }).identifier).to.equal(
      "admin",
    );
  });

  it("logout : session détruite — le cookie ne donne plus rien (idempotent)", async () => {
    const logged = await login("admin", "secret");
    const cookie = sessionCookieOf(logged)!;
    const out = await post(`${AUTH}/logout`, undefined, { cookie });
    expect(out.status).to.equal(200);
    expect((out.body as { ok: boolean }).ok).to.equal(true);
    const me = await get(`${AUTH}/me`, { cookie });
    expect(me.status).to.equal(401);
    const zone = await get("/nodefony/test/secure/ping", { cookie });
    expect(zone.status).to.equal(401);
    // Rejouer le logout sans session active : toujours 200 (idempotent).
    const replay = await post(`${AUTH}/logout`, undefined, { cookie });
    expect(replay.status).to.equal(200);
  });

  it("throttling NIST PARTAGÉ : les échecs JSON arment le backoff de la porte Basic", async () => {
    // Identifiant unique par run (compteur serveur par identifiant SAISI).
    const target = `bff-bruteforce-${Date.now()}`;
    // freeAttempts=3 : 3 échecs libres + le 4e arme le délai — TOUS via la
    // porte JSON.
    for (let i = 0; i < 4; i++) {
      const { status } = await login(target, "bad");
      expect(status).to.equal(401);
    }
    // 5e tentative via la porte BASIC : même compteur → 429 + Retry-After.
    const blocked = await get(
      "/nodefony/test/secure/ping",
      basic(target, "bad"),
    );
    expect(blocked.status).to.equal(429);
    expect(Number(blocked.headers["retry-after"])).to.be.greaterThan(0);
    // Et symétriquement la porte JSON est bloquée aussi.
    const blockedJson = await login(target, "bad");
    expect(blockedJson.status).to.equal(429);
    expect(Number(blockedJson.headers["retry-after"])).to.be.greaterThan(0);
  });
});
