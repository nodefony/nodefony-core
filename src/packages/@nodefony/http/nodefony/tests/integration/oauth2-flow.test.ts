/// <reference types="node" />
/**
 * Integration — P6 J9 : social login OAuth2 (flux BFF), bout-en-bout.
 * Requires: server running on 5152 (wss/https). Start: /start-server
 *
 * Preuve END-TO-END du flux Authorization Code BFF à travers TOUTES les briques,
 * avec un fournisseur de TEST déterministe (zéro réseau, `secure/oauthTestProvider.ts`) :
 *   GET authorize  (framework OAuth2Controller, bypassFirewall)
 *     → session anonyme (http) porte state + code_verifier (security OAuth2Service)
 *     → 302 vers le fournisseur (state dans l'URL)
 *   GET callback ?code&state  (state renvoyé par le fournisseur)
 *     → state comparé à la session (anti-CSRF, RFC 9700)
 *     → échange + profil + provisioning Shadow User JIT (UserService)
 *     → establishSessionFor (session BFF, anti-fixation) → 302 successRedirect
 *   GET /auth/me (cookie BFF) → identité provisionnée (rôle par défaut)
 *
 * Gates :
 *  1. authorize → 302 + Set-Cookie + Location porte `state` ;
 *  2. callback (state OK) → 302 successRedirect + session BFF ouverte (me = user OAuth) ;
 *  3. 2ᵉ login → MÊME identité (find-or-create : pas de doublon) ;
 *  4. state invalide → 302 failureRedirect (anti-CSRF prouvé sur le wire) ;
 *  5. callback sans session → 302 failureRedirect ;
 *  6. provider inconnu → 404.
 *
 * https://5152 : le cookie de session BFF (`__Host-`) exige un contexte sécurisé.
 */
import { expect } from "vitest";
import https from "node:https";

const BASE = { hostname: "127.0.0.1", port: 5152, rejectUnauthorized: false };
const OAUTH = "/nodefony/security/api/oauth2/test-oidc";
const ME = "/nodefony/security/api/auth/me";
const TIMEOUT = 10_000;

type Res = { status: number; headers: Record<string, unknown>; body: unknown };

function get(path: string, headers: Record<string, string> = {}): Promise<Res> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      { ...BASE, path, method: "GET", headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString();
          let body: unknown = raw;
          try {
            body = JSON.parse(raw);
          } catch {
            /* texte brut / vide */
          }
          resolve({
            status: res.statusCode!,
            headers: res.headers,
            body,
          });
        });
      },
    );
    req.on("error", reject);
    req.setTimeout(TIMEOUT, () => req.destroy(new Error("http timeout")));
    req.end();
  });
}

/** `name=value` du PREMIER Set-Cookie (cookie de session opaque). */
function sessionCookieOf(res: Res): string | null {
  const setCookie = res.headers["set-cookie"];
  const first = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  if (typeof first !== "string") return null;
  return first.split(";")[0] ?? null;
}

function locationOf(res: Res): string {
  const loc = res.headers["location"];
  return typeof loc === "string" ? loc : "";
}

/** Extrait le `state` que le fournisseur recevrait (présent dans l'URL d'autorisation). */
function stateFromLocation(location: string): string | null {
  try {
    return new URL(location).searchParams.get("state");
  } catch {
    return null;
  }
}

/**
 * Étape 1 : démarre le flux, renvoie le cookie de transit + le state émis.
 *
 * @param query - requête de `/authorize` (`?from=…&back=…`), vide par défaut
 */
async function startLogin(
  query = "",
): Promise<{ cookie: string; state: string }> {
  const res = await get(`${OAUTH}/authorize${query}`);
  expect(res.status, "authorize doit rediriger (302)").to.equal(302);
  const cookie = sessionCookieOf(res);
  const state = stateFromLocation(locationOf(res));
  expect(cookie, "authorize doit poser un cookie de session").to.be.a("string");
  expect(state, "l'URL d'autorisation doit porter un state").to.be.a("string");
  return { cookie: cookie!, state: state! };
}

describe("OAuth2 social login — flux BFF (P6 J9)", () => {
  it("1. authorize → 302 vers le fournisseur + cookie + state", async () => {
    const res = await get(`${OAUTH}/authorize`);
    expect(res.status).to.equal(302);
    expect(locationOf(res)).to.contain("test-idp.local");
    expect(sessionCookieOf(res)).to.be.a("string");
    expect(stateFromLocation(locationOf(res))).to.be.a("string");
  });

  it("2. callback (state OK) → session BFF ouverte, identité provisionnée (JIT)", async () => {
    const { cookie, state } = await startLogin();
    const cb = await get(`${OAUTH}/callback?code=fake-code&state=${state}`, {
      cookie,
    });
    expect(cb.status, "callback réussi redirige (302)").to.equal(302);
    expect(locationOf(cb), "vers successRedirect").to.equal("/oauth-success");

    // La session BFF est ouverte → /me renvoie l'utilisateur provisionné.
    const sessionCookie = sessionCookieOf(cb) ?? cookie;
    const me = await get(ME, { cookie: sessionCookie });
    expect(me.status, "me authentifié").to.equal(200);
    // /me enveloppe la projection publique : { user: { id, identifier, roles } }.
    const u = (me.body as { user?: { identifier?: string; roles?: string[] } })
      .user;
    expect(u?.identifier).to.equal("oauth-user@test.local");
    expect(u?.roles, "rôle par défaut OAuth").to.deep.equal(["ROLE_USER"]);
  });

  it("3. 2ᵉ login → MÊME identité (find-or-create, pas de doublon)", async () => {
    const a = await startLogin();
    const cbA = await get(`${OAUTH}/callback?code=c1&state=${a.state}`, {
      cookie: a.cookie,
    });
    const meA = await get(ME, { cookie: sessionCookieOf(cbA) ?? a.cookie });

    const b = await startLogin();
    const cbB = await get(`${OAUTH}/callback?code=c2&state=${b.state}`, {
      cookie: b.cookie,
    });
    const meB = await get(ME, { cookie: sessionCookieOf(cbB) ?? b.cookie });

    expect(meA.status).to.equal(200);
    expect(meB.status).to.equal(200);
    const userA = (meA.body as { user?: { identifier?: string } }).user;
    const userB = (meB.body as { user?: { identifier?: string } }).user;
    // Même identifiant → le 2ᵉ login a RETROUVÉ le compte créé au 1ᵉʳ (le lien
    // social est bien persisté ; pas de nouveau provisioning, pas de doublon).
    expect(userA?.identifier).to.equal("oauth-user@test.local");
    expect(userB?.identifier).to.equal(userA?.identifier);
  });

  it("4. state invalide → 302 failureRedirect (anti-CSRF)", async () => {
    const { cookie } = await startLogin();
    const cb = await get(`${OAUTH}/callback?code=fake&state=FORGED`, {
      cookie,
    });
    expect(cb.status).to.equal(302);
    expect(locationOf(cb)).to.equal("/oauth-failure?reason=failed");
  });

  it("5. callback sans session (pas de cookie) → 302 failureRedirect", async () => {
    const cb = await get(`${OAUTH}/callback?code=fake&state=whatever`);
    expect(cb.status).to.equal(302);
    expect(locationOf(cb)).to.equal("/oauth-failure?reason=failed");
  });

  it("7. `from` voyage : le callback réussi mène à la page d'origine", async () => {
    const { cookie, state } = await startLogin(
      `?from=${encodeURIComponent("/admin/users?tab=2")}`,
    );
    const cb = await get(`${OAUTH}/callback?code=c-from&state=${state}`, {
      cookie,
    });
    expect(cb.status).to.equal(302);
    expect(locationOf(cb)).to.equal("/admin/users?tab=2");
  });

  it("8. 🔴 `from` hors de l'origine ignoré (CWE-601) → successRedirect", async () => {
    for (const forged of [
      "//evil.example",
      "https://evil.example/x",
      "/\\evil.example",
    ]) {
      const { cookie, state } = await startLogin(
        `?from=${encodeURIComponent(forged)}&back=${encodeURIComponent(forged)}`,
      );
      const cb = await get(`${OAUTH}/callback?code=c-evil&state=${state}`, {
        cookie,
      });
      expect(locationOf(cb), forged).to.equal("/oauth-success");
    }
  });

  it("9. `back` : l'annulation ramène sur l'écran qui a lancé le flux, `from` gardé", async () => {
    const { cookie, state } = await startLogin(
      `?from=%2Fadmin&back=${encodeURIComponent("/nodefony/login?reason=failed")}`,
    );
    const cb = await get(
      `${OAUTH}/callback?error=access_denied&state=${state}`,
      { cookie },
    );
    expect(cb.status).to.equal(302);
    expect(locationOf(cb)).to.equal(
      "/nodefony/login?reason=access_denied&from=%2Fadmin",
    );
  });

  it("10. une tentative relancée sans retours n'hérite pas de ceux de la précédente", async () => {
    const first = await startLogin(`?from=%2Fadmin&back=%2Fnodefony%2Flogin`);
    // Seconde tentative SUR LA MÊME session, sans retours : elle repart nue.
    const again = await get(`${OAUTH}/authorize`, { cookie: first.cookie });
    const state = stateFromLocation(locationOf(again));
    const cookie = sessionCookieOf(again) ?? first.cookie;
    const cb = await get(`${OAUTH}/callback?code=c-again&state=${state}`, {
      cookie,
    });
    expect(locationOf(cb)).to.equal("/oauth-success");
  });

  it("6. provider inconnu → 404", async () => {
    const res = await get(
      "/nodefony/security/api/oauth2/inconnu-xyz/authorize",
    );
    expect(res.status).to.equal(404);
  });
});
