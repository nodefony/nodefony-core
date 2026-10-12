/**
 * Integration — `@RequireAuthentication` de bout en bout, sur une vraie session.
 *
 * Ce que le banc unitaire ne voit pas : que la session RÉELLE porte bien
 * `authAt`/`amr` à l'ouverture, que le Resolver la lit dans la zone
 * `test-secure` (session en tête), et que l'en-tête `WWW-Authenticate` du 401
 * « step-up » (RFC 9470) SURVIT au rendu d'erreur jusqu'au client.
 *
 * Routes : `src/modules/test/nodefony/secure/SecureController.ts`
 * (`/step-up/recent` : `maxAge: 2, amr: ["pwd"]` ; `/step-up/otp` : `amr: ["otp"]`).
 *
 * Non couvert ICI, et pourquoi : le chemin POSITIF du second facteur (connexion
 * mot de passe + code). Il exige d'activer le TOTP sur un compte, et les comptes
 * du module test sont partagés par d'autres bancs qui se connectent au mot de
 * passe seul. Il est prouvé par le banc unitaire, et sur une application neuve
 * par la tâche 40 du banc de découvrabilité.
 *
 * Requires: server on 5152 (HTTPS) + user `user/secret-de-dev-42` (module test).
 */
import { expect } from "vitest";
import https from "node:https";
import type { IncomingHttpHeaders } from "node:http";
import { setTimeout as sleep } from "node:timers/promises";

const BASE = { hostname: "127.0.0.1", port: 5152, rejectUnauthorized: false };
const LOGIN = "/nodefony/security/api/auth/login";
const RECENT = "/nodefony/test/secure/step-up/recent";
const OTP = "/nodefony/test/secure/step-up/otp";

type Res = { status: number; headers: IncomingHttpHeaders; body: string };

function request(
  method: string,
  path: string,
  headers: Record<string, string> = {},
  body?: unknown,
): Promise<Res> {
  return new Promise((resolve, reject) => {
    const payload = body !== undefined ? JSON.stringify(body) : undefined;
    const h: Record<string, string> = {
      accept: "application/json",
      ...headers,
    };
    if (payload !== undefined) {
      h["content-type"] = "application/json";
      h["content-length"] = String(Buffer.byteLength(payload));
    }
    const req = https.request({ ...BASE, path, method, headers: h }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () =>
        resolve({
          status: res.statusCode!,
          headers: res.headers,
          body: Buffer.concat(chunks).toString(),
        }),
      );
    });
    req.on("error", reject);
    req.setTimeout(15_000, () => req.destroy(new Error("http timeout")));
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

async function loginCookie(): Promise<string> {
  const res = await request(
    "POST",
    LOGIN,
    {},
    {
      username: "user",
      password: "secret-de-dev-42",
    },
  );
  expect(res.status, `login user : ${res.body}`).to.equal(200);
  const setCookie = res.headers["set-cookie"];
  const first = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  expect(typeof first, "le login doit poser un cookie de session").to.equal(
    "string",
  );
  return String(first).split(";")[0]!;
}

describe("@RequireAuthentication — vraie session (zone test-secure)", () => {
  it("connexion au mot de passe toute fraîche → servie", async () => {
    const cookie = await loginCookie();
    const res = await request("GET", RECENT, { cookie });
    expect(res.status, res.body).to.equal(200);
  });

  it("🔴 la même session, plus vieille que maxAge → 401 step-up avec max_age", async () => {
    const cookie = await loginCookie();
    await sleep(2_500);
    const res = await request("GET", RECENT, { cookie });
    expect(res.status, res.body).to.equal(401);
    const challenge = res.headers["www-authenticate"] ?? "";
    expect(challenge).to.match(/error="insufficient_user_authentication"/u);
    expect(challenge).to.match(/max_age="2"/u);
  });

  it("🔴 session au mot de passe seul quand `otp` est exigé → 401 step-up", async () => {
    const cookie = await loginCookie();
    const res = await request("GET", OTP, { cookie });
    expect(res.status, res.body).to.equal(401);
    expect(res.headers["www-authenticate"] ?? "").to.match(
      /error="insufficient_user_authentication"/u,
    );
  });

  it("🔴 anonyme → refusé par la zone avant la garde (401)", async () => {
    const res = await request("GET", OTP);
    expect(res.status).to.equal(401);
  });
});
