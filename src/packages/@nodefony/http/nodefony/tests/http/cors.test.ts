/// <reference types="node" />
import { expect } from "chai";
import http from "node:http";

/**
 * CORS (P6 J5) — banc d'INTÉGRATION RÉEL contre le serveur live (port 5151).
 * Prouve le câblage `firewall.handleCors` dans `handleFrontController` : reflet
 * de l'origine whitelistée, court-circuit du preflight en 204, omission des
 * en-têtes pour une origine non autorisée.
 *
 * Origine de confiance configurée côté module test (`module-security.cors`) :
 * `https://trusted.example`. `credentials:false`.
 */

const BASE = { hostname: "localhost", port: 5151 };
const TRUSTED = "https://trusted.example";
const EVIL = "https://evil.com";

type Res = {
  status: number;
  headers: Record<string, string | string[] | undefined>;
};

function send(
  method: string,
  path: string,
  headers: Record<string, string> = {},
): Promise<Res> {
  return new Promise((resolve, reject) => {
    const r = http.request({ ...BASE, method, path, headers }, (res) => {
      res.on("data", () => {});
      res.on("end", () =>
        resolve({ status: res.statusCode!, headers: res.headers }),
      );
    });
    r.on("error", reject);
    r.end();
  });
}

const preflight = (origin: string) =>
  send("OPTIONS", "/nodefony/test/fw/post-only", {
    Origin: origin,
    "Access-Control-Request-Method": "POST",
  });

describe("CORS — preflight + reflet d'origine (intégration live)", () => {
  it("preflight origine de confiance → 204 + en-têtes Access-Control-*", async () => {
    const r = await preflight(TRUSTED);
    expect(r.status).to.equal(204);
    expect(r.headers["access-control-allow-origin"]).to.equal(TRUSTED);
    expect(r.headers["access-control-allow-methods"]).to.be.a("string");
    expect(r.headers["access-control-max-age"]).to.equal("600");
    expect(String(r.headers["vary"] ?? "")).to.contain("Origin");
  });

  it("preflight : credentials NON activé → pas de Allow-Credentials", async () => {
    const r = await preflight(TRUSTED);
    expect(r.headers["access-control-allow-credentials"]).to.equal(undefined);
  });

  it("preflight origine NON autorisée → 204 SANS Allow-Origin (navigateur bloque)", async () => {
    const r = await preflight(EVIL);
    expect(r.status).to.equal(204);
    expect(r.headers["access-control-allow-origin"]).to.equal(undefined);
  });

  it("requête réelle origine de confiance → 200 + Allow-Origin reflété + Vary", async () => {
    const r = await send("GET", "/nodefony/test/index", { Origin: TRUSTED });
    expect(r.status).to.equal(200);
    expect(r.headers["access-control-allow-origin"]).to.equal(TRUSTED);
    expect(String(r.headers["vary"] ?? "")).to.contain("Origin");
  });

  it("requête réelle origine NON autorisée → 200 SANS Allow-Origin", async () => {
    const r = await send("GET", "/nodefony/test/index", { Origin: EVIL });
    expect(r.status).to.equal(200);
    expect(r.headers["access-control-allow-origin"]).to.equal(undefined);
  });

  it("requête same-origin (sans Origin) → 200, aucun en-tête CORS", async () => {
    const r = await send("GET", "/nodefony/test/index");
    expect(r.status).to.equal(200);
    expect(r.headers["access-control-allow-origin"]).to.equal(undefined);
  });
});
