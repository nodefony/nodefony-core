/// <reference types="node" />
import { expect } from "chai";
import https from "node:https";

/**
 * P6 J9 — red-team WebAuthn / passkeys (CÂBLAGE adverse, hors crypto).
 *
 * Complète `webauthn-bff.test.ts` (câblage nominal) par la matrice d'ATTAQUE
 * dérivée de la MENACE (W3C WebAuthn L3 + OWASP), pas de l'implémentation. La
 * vérification cryptographique des assertions est déléguée à `@simplewebauthn`
 * (lib auditée) ; ici on PROUVE les invariants que Nodefony impose AUTOUR :
 *
 *   E1 — Challenge à USAGE UNIQUE (anti-replay) : le challenge est invalidé en
 *        session DÈS sa lecture (`#takeChallenge`), AVANT la vérif crypto. Donc
 *        un 1ᵉʳ verify (échec crypto = 401) consomme le challenge → un 2ᵉ verify
 *        rejouant le MÊME cookie = 400 (No challenge). Vaut pour login ET register.
 *   E2 — Confusion de cérémonie : le challenge d'enregistrement (REG) et celui
 *        d'authentification (AUTH) sont des clés de session DISJOINTES. Un défi
 *        de register ne déverrouille jamais un login (et inversement) → 400.
 *   E3 — Anti-énumération : `login/options` pour un utilisateur INEXISTANT renvoie
 *        quand même 200 + challenge (usernameless WebAuthn) → ne révèle pas si le
 *        compte existe.
 *   E4 — Message UNIFORME : tout échec de `verify` répond le même libellé
 *        ("WebAuthn verification failed"), jamais la cause crypto fine.
 *
 * Requires: server on 5152 (HTTPS) + users `admin/secret` (module test) + passkeys
 * activés (sinon 503). Start: /start-server
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

/** Extrait `name=value` du PREMIER Set-Cookie (cookie de session). */
function sessionCookieOf(res: Res): string | null {
  const setCookie = res.headers["set-cookie"];
  const first = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  if (typeof first !== "string") return null;
  return first.split(";")[0] ?? null;
}

async function loginAdmin(): Promise<string> {
  const login = await post(`${AUTH}/login`, {
    username: "admin",
    password: "secret",
  });
  expect(login.status, "login admin").to.equal(200);
  const cookie = sessionCookieOf(login);
  expect(cookie, "cookie de session admin").to.be.a("string");
  return cookie!;
}

// Assertion structurellement valide mais cryptographiquement fausse : passe le
// parsing, échoue la vérification de signature (→ 401, jamais 400).
const FAKE = {
  response: {
    id: "AAAA",
    rawId: "AAAA",
    type: "public-key",
    response: {},
    clientExtensionResults: {},
  },
};

describe("P6 J9 — WebAuthn red-team (attaques de câblage)", () => {
  // E1 — login : un challenge ne sert qu'UNE fois, même si la crypto échoue.
  it("E1 — replay LOGIN : verify échoue (401) puis REJOUE le cookie → 400 (challenge consommé)", async () => {
    const opt = await post(`${WA}/login/options`, {});
    expect(opt.status).to.equal(200);
    const cookie = sessionCookieOf(opt);
    expect(cookie, "cookie anonyme porteur du challenge").to.be.a("string");

    const first = await post(`${WA}/login/verify`, FAKE, { cookie: cookie! });
    expect(
      first.status,
      "1er verify : challenge trouvé puis échec crypto",
    ).to.equal(401);

    const replay = await post(`${WA}/login/verify`, FAKE, { cookie: cookie! });
    expect(replay.status, "2e verify même challenge → consommé").to.equal(400);
    expect((replay.body as { error?: string }).error).to.match(/No challenge/i);
  });

  // E1bis — register : même invariant d'usage unique sur la cérémonie d'enrôlement.
  it("E1bis — replay REGISTER : verify échoue (401) puis REJOUE → 400 (challenge consommé)", async () => {
    const cookie = await loginAdmin();
    const opt = await post(`${WA}/register/options`, {}, { cookie });
    expect(opt.status).to.equal(200);

    const first = await post(`${WA}/register/verify`, FAKE, { cookie });
    expect(first.status, "1er register/verify : échec crypto").to.equal(401);

    const replay = await post(`${WA}/register/verify`, FAKE, { cookie });
    expect(replay.status, "2e register/verify → challenge consommé").to.equal(
      400,
    );
  });

  // E2 — un défi de register ne déverrouille pas un login (clés de session disjointes).
  it("E2 — confusion de cérémonie : register/options puis login/verify → 400 (REG ≠ AUTH)", async () => {
    const cookie = await loginAdmin();
    // Pose UNIQUEMENT le challenge d'enregistrement (REG_CHALLENGE).
    const reg = await post(`${WA}/register/options`, {}, { cookie });
    expect(reg.status).to.equal(200);
    // login/verify lit AUTH_CHALLENGE — jamais posé → 400, le défi de register
    // n'est pas réutilisable pour ouvrir une session.
    const login = await post(`${WA}/login/verify`, FAKE, { cookie });
    expect(
      login.status,
      "challenge de register inutilisable au login",
    ).to.equal(400);
  });

  // E3 — anti-énumération : un utilisateur inexistant ne se distingue pas.
  it("E3 — anti-énum : login/options(user inexistant) → 200 + challenge (ne révèle pas l'absence)", async () => {
    const ghost = await post(`${WA}/login/options`, {
      username: "ghost-user-does-not-exist-xyz",
    });
    expect(ghost.status, "compte inexistant → 200 quand même").to.equal(200);
    expect((ghost.body as { challenge?: unknown }).challenge).to.be.a("string");

    // Un compte EXISTANT répond à l'identique (même forme, même statut).
    const real = await post(`${WA}/login/options`, { username: "admin" });
    expect(real.status).to.equal(200);
    expect((real.body as { challenge?: unknown }).challenge).to.be.a("string");
  });

  // E4 — message d'échec uniforme (anti-énumération de la cause crypto).
  it("E4 — message uniforme : verify échoué → 'WebAuthn verification failed' (cause masquée)", async () => {
    const opt = await post(`${WA}/login/options`, {});
    const cookie = sessionCookieOf(opt);
    const res = await post(`${WA}/login/verify`, FAKE, { cookie: cookie! });
    expect(res.status).to.equal(401);
    expect((res.body as { error?: string }).error).to.equal(
      "WebAuthn verification failed",
    );
  });
});
