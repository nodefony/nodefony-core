/// <reference types="node" />
/**
 * P6 J9 — red-team OAuth2 social login (CÂBLAGE adverse, fournisseur de TEST).
 *
 * Complète `oauth2-flow.test.ts` (flux nominal + state invalide/sans session/
 * provider inconnu) par les vecteurs ADVERSES dérivés de la MENACE (RFC 9700
 * Security BCP, OWASP CSRF/Mix-up), pas de l'implémentation :
 *
 *   S5 — state à USAGE UNIQUE (anti-replay) : le `state` est lu PUIS invalidé en
 *        session au callback. Un callback réussi consomme le state → rejouer le
 *        MÊME (cookie, state) une 2ᵉ fois échoue (302 failureRedirect).
 *   S6 — anti mix-up de fournisseur (RFC 9700 §4.4) : un `state` émis pour le
 *        provider A n'est pas accepté sur le callback d'un AUTRE provider — le
 *        contrôleur exige `expectedProvider === provider` avant tout échange.
 *
 * Le fournisseur `test-oidc` est déterministe (zéro réseau). Requires: server on
 * 5152 (HTTPS). Start: /start-server
 */
import { expect } from "chai";
import https from "node:https";

const BASE = { hostname: "127.0.0.1", port: 5152, rejectUnauthorized: false };
const OAUTH = "/nodefony/security/api/oauth2/test-oidc";
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
            headers: res.headers as Record<string, unknown>,
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

function stateFromLocation(location: string): string | null {
  try {
    return new URL(location).searchParams.get("state");
  } catch {
    return null;
  }
}

async function startLogin(): Promise<{ cookie: string; state: string }> {
  const res = await get(`${OAUTH}/authorize`);
  expect(res.status, "authorize 302").to.equal(302);
  const cookie = sessionCookieOf(res);
  const state = stateFromLocation(locationOf(res));
  expect(cookie, "cookie de transit").to.be.a("string");
  expect(state, "state émis").to.be.a("string");
  return { cookie: cookie!, state: state! };
}

describe("OAuth2 social login — red-team (P6 J9)", () => {
  // S5 — le state ne sert qu'UNE fois : un callback réussi le consomme.
  it("S5 — replay du state : 1er callback réussit (302 success), REJOUE → 302 failure", async () => {
    const { cookie, state } = await startLogin();

    const first = await get(`${OAUTH}/callback?code=fake-code&state=${state}`, {
      cookie,
    });
    expect(first.status).to.equal(302);
    expect(locationOf(first), "1er callback → succès").to.equal(
      "/oauth-success",
    );

    // Rejoue le MÊME cookie de transit + le MÊME state : le state est consommé
    // (et la session de transit a été régénérée à la promotion) → échec.
    const replay = await get(
      `${OAUTH}/callback?code=fake-code&state=${state}`,
      {
        cookie,
      },
    );
    expect(replay.status).to.equal(302);
    expect(locationOf(replay), "replay du state refusé").to.equal(
      "/oauth-failure",
    );
  });

  // S6 — un state émis pour test-oidc n'est pas accepté sur un autre provider.
  it("S6 — mix-up provider : state de test-oidc rejoué sur un autre callback → 302 failure", async () => {
    const { cookie, state } = await startLogin();
    // Le state est valide MAIS le callback vise un provider différent → le
    // contrôleur exige expectedProvider === provider (RFC 9700 §4.4) → échec.
    const crossed = await get(
      `/nodefony/security/api/oauth2/test-oidc-other/callback?code=fake-code&state=${state}`,
      { cookie },
    );
    expect(
      crossed.status,
      "pas d'échange : rejet avant le fournisseur",
    ).to.equal(302);
    expect(locationOf(crossed)).to.equal("/oauth-failure");
  });
});
