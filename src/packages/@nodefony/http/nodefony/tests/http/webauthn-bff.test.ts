/// <reference types="node" />
import { expect } from "chai";
import https from "node:https";

/**
 * P6 J9 — cérémonies WebAuthn / passkeys (CÂBLAGE, hors crypto).
 *
 * Banc : endpoints `/nodefony/security/api/webauthn/*` (montés par framework si
 * le service `webauthn` existe). La vérification cryptographique des assertions
 * est couverte en amont par `@simplewebauthn` ; ICI on prouve le CÂBLAGE :
 *  - **Zero Trust** : enregistrer exige une session → register anonyme = 401 ;
 *  - `options` renvoie un challenge + le RP (rpId, `authenticatorAttachment:
 *    "platform"` — biométrie, pas de QR) ;
 *  - le **CHALLENGE PERSISTE** entre `options` et `verify`, MÊME déconnecté : une
 *    session anonyme est démarrée (`ensureSession`) et le challenge sauvé en
 *    storage → `verify` d'un payload bidon = **401** (échec crypto), PAS **400**
 *    (No challenge — le bug corrigé ce jour) ;
 *  - `verify` sans aucune session = **400** (No challenge).
 *
 * Requires: server on 5152 (HTTPS) + users `admin/secret` (module test).
 * Start: /start-server
 */

const BASE = { hostname: "localhost", port: 5152, rejectUnauthorized: false };
const WA = "/nodefony/security/api/webauthn";
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

const post = (
  path: string,
  payload?: unknown,
  headers: Record<string, string> = {},
) => request(path, "POST", headers, payload);

/** Extrait `name=value` du PREMIER Set-Cookie de la réponse (cookie de session). */
function sessionCookieOf(res: Res): string | null {
  const setCookie = res.headers["set-cookie"];
  const first = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  if (typeof first !== "string") return null;
  return first.split(";")[0] ?? null;
}

// Assertion structurellement valide mais cryptographiquement fausse : passe le
// parsing, échoue la vérification de signature (→ 401, jamais 400).
const FAKE_ASSERTION = {
  response: {
    id: "AAAA",
    rawId: "AAAA",
    type: "public-key",
    response: {},
    clientExtensionResults: {},
  },
};

describe("P6 J9 — WebAuthn ceremonies (câblage)", () => {
  it("register/options SANS session → 401 (Zero Trust : enregistrer exige d'être connecté)", async () => {
    const res = await post(`${WA}/register/options`, {});
    expect(res.status).to.equal(401);
  });

  it("login → register/options renvoie challenge + RP + attachment 'platform' (pas de QR)", async () => {
    const login = await post(`${AUTH}/login`, {
      username: "admin",
      password: "secret",
    });
    expect(login.status).to.equal(200);
    const cookie = sessionCookieOf(login);
    expect(cookie, "cookie de session").to.be.a("string");

    const res = await post(`${WA}/register/options`, {}, { cookie: cookie! });
    expect(res.status).to.equal(200);
    const b = res.body as {
      challenge?: unknown;
      rp?: { id?: unknown };
      authenticatorSelection?: { authenticatorAttachment?: unknown };
    };
    expect(b.challenge).to.be.a("string");
    expect(b.rp?.id).to.be.a("string");
    expect(b.authenticatorSelection?.authenticatorAttachment).to.equal(
      "platform",
    );
  });

  it("login/options ANONYME → 200 + pose un cookie de session (porte le challenge)", async () => {
    const res = await post(`${WA}/login/options`, {});
    expect(res.status).to.equal(200);
    expect((res.body as { challenge?: unknown }).challenge).to.be.a("string");
    // ensureSession a démarré une session anonyme → cookie posé (sinon « No challenge »).
    expect(sessionCookieOf(res), "cookie anonyme").to.be.a("string");
  });

  it("CHALLENGE PERSISTE déconnecté : options → verify(bidon) = 401, PAS 400 (régression du jour)", async () => {
    const opt = await post(`${WA}/login/options`, {});
    const cookie = sessionCookieOf(opt);
    expect(cookie).to.be.a("string");
    const res = await post(`${WA}/login/verify`, FAKE_ASSERTION, {
      cookie: cookie!,
    });
    // 401 = challenge TROUVÉ puis échec crypto ; 400 = challenge perdu (le bug).
    expect(res.status).to.equal(401);
  });

  it("login/verify SANS session → 400 (No challenge)", async () => {
    const res = await post(`${WA}/login/verify`, FAKE_ASSERTION);
    expect(res.status).to.equal(400);
  });
});
