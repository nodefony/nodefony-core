/// <reference types="node" />
import { expect } from "chai";
import https from "node:https";

/**
 * P6 J1 — zone protégée `test-secure` (firewall + UserPasswordAuthenticator).
 *
 * Banc : module test `nodefony/secure/` (routes `/nodefony/test/secure/*`,
 * comptes admin/secret + user/secret en annuaire in-memory). Gates :
 * - Zero Trust : aucune preuve → 401 + `WWW-Authenticate` (RFC 7235) ;
 * - credential invalide → 401 au message UNIFORME (anti-énumération) ;
 * - credential valide → 200, identité propagée dans l'ALS (`/whoami`) ;
 * - hors zone : le reste du module test reste public.
 */

const BASE = { hostname: "localhost", port: 5152, rejectUnauthorized: false };

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
          try {
            resolve({
              status: res.statusCode!,
              headers: res.headers as Record<string, unknown>,
              body: JSON.parse(raw),
            });
          } catch {
            resolve({
              status: res.statusCode!,
              headers: res.headers as Record<string, unknown>,
              body: raw,
            });
          }
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

const basic = (identifier: string, password: string) => ({
  authorization: `Basic ${Buffer.from(`${identifier}:${password}`, "utf8").toString("base64")}`,
});

describe("Firewall — zone protégée test-secure (requires server)", () => {
  it("Zero Trust : aucune preuve → 401 + WWW-Authenticate Basic (RFC 7235)", async () => {
    const { status, headers } = await get("/nodefony/test/secure/ping");
    expect(status).to.equal(401);
    expect(headers["www-authenticate"]).to.be.a("string");
    expect(headers["www-authenticate"]).to.match(/^Basic /);
  });

  it("mot de passe invalide → 401", async () => {
    const { status } = await get(
      "/nodefony/test/secure/ping",
      basic("admin", "wrong"),
    );
    expect(status).to.equal(401);
  });

  it("anti-énumération : identifiant inconnu et mauvais mot de passe = même réponse", async () => {
    const unknownUser = await get(
      "/nodefony/test/secure/ping",
      basic("ghost", "whatever"),
    );
    const badPassword = await get(
      "/nodefony/test/secure/ping",
      basic("admin", "wrong"),
    );
    expect(unknownUser.status).to.equal(401);
    expect(badPassword.status).to.equal(401);
    // Même message d'erreur côté client (la raison fine reste en audit serveur).
    const messageOf = (body: unknown) =>
      typeof body === "object" && body !== null
        ? (body as { message?: string }).message
        : body;
    expect(messageOf(unknownUser.body)).to.deep.equal(
      messageOf(badPassword.body),
    );
  });

  it("enveloppe Basic malformée → 401 (jamais 500)", async () => {
    const { status } = await get("/nodefony/test/secure/ping", {
      authorization: "Basic !!!not-base64!!!",
    });
    expect(status).to.equal(401);
  });

  it("credential valide → 200 (zone franchie)", async () => {
    const { status, body } = await get(
      "/nodefony/test/secure/ping",
      basic("admin", "secret"),
    );
    expect(status).to.equal(200);
    expect(body).to.deep.equal({ pong: true, secure: true });
  });

  it("identité propagée dans l'ALS : /whoami rend l'utilisateur du firewall", async () => {
    const { status, body } = await get(
      "/nodefony/test/secure/whoami",
      basic("admin", "secret"),
    );
    expect(status).to.equal(200);
    expect((body as { identifier: string }).identifier).to.equal("admin");
    expect((body as { roles: string[] }).roles).to.include("ROLE_ADMIN");
  });

  it("second compte du banc : user/secret → ROLE_USER", async () => {
    const { body } = await get(
      "/nodefony/test/secure/whoami",
      basic("user", "secret"),
    );
    expect((body as { identifier: string }).identifier).to.equal("user");
    expect((body as { roles: string[] }).roles).to.include("ROLE_USER");
  });

  it("hors zone : le reste du module test reste public (aucune régression)", async () => {
    const { status } = await get("/nodefony/test/index");
    expect(status).to.equal(200);
  });

  it("scheme case-insensitive (RFC 7235) : `basic` minuscule accepté", async () => {
    const header = basic("admin", "secret").authorization.replace(
      "Basic",
      "basic",
    );
    const { status } = await get("/nodefony/test/secure/ping", {
      authorization: header,
    });
    expect(status).to.equal(200);
  });
});
