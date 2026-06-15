/// <reference types="node" />
import { expect } from "chai";
import http from "node:http";

/**
 * En-têtes de sécurité (P6 J5) — banc d'INTÉGRATION RÉEL (port 5151). Prouve la
 * SÉPARATION transport/applicatif sur une vraie réponse :
 *  - socle TRANSPORT (@nodefony/http, posé à l'entrée brute) : nosniff, frame-options ;
 *  - APPLICATIF (@nodefony/security, pipeline) : CSP, Referrer-Policy, COOP/CORP,
 *    Permissions-Policy (avancés activés côté module test).
 * Le socle transport couvre AUSSI les erreurs (404) ; l'applicatif est sur le pipeline.
 */

const BASE = { hostname: "localhost", port: 5151 };

function head(
  path: string,
): Promise<Record<string, string | string[] | undefined>> {
  return new Promise((resolve, reject) => {
    const r = http.request({ ...BASE, method: "GET", path }, (res) => {
      res.on("data", () => {});
      res.on("end", () => resolve(res.headers));
    });
    r.on("error", reject);
    r.end();
  });
}

describe("Security headers — socle transport (http) + applicatif (security)", () => {
  it("TRANSPORT : X-Content-Type-Options + X-Frame-Options sur une réponse normale", async () => {
    const h = await head("/nodefony/test/index");
    expect(h["x-content-type-options"]).to.equal("nosniff");
    expect(h["x-frame-options"]).to.be.a("string");
  });

  it("TRANSPORT : présent AUSSI sur une erreur 404 (hors pipeline applicatif)", async () => {
    const h = await head("/nodefony/test/__does_not_exist__");
    expect(h["x-content-type-options"]).to.equal("nosniff");
  });

  it("APPLICATIF : Content-Security-Policy posé par security", async () => {
    const h = await head("/nodefony/test/index");
    expect(h["content-security-policy"]).to.be.a("string");
  });

  it("APPLICATIF : Referrer-Policy posé par security", async () => {
    const h = await head("/nodefony/test/index");
    expect(h["referrer-policy"]).to.equal("no-referrer");
  });

  it("APPLICATIF : COOP / CORP (avancés opt-in activés côté test)", async () => {
    const h = await head("/nodefony/test/index");
    expect(h["cross-origin-opener-policy"]).to.equal("same-origin");
    expect(h["cross-origin-resource-policy"]).to.equal("same-origin");
  });

  it("APPLICATIF : Permissions-Policy posé", async () => {
    const h = await head("/nodefony/test/index");
    expect(h["permissions-policy"]).to.contain("camera=()");
  });

  it("PAS de COEP (require-corp non activé → assets tiers non cassés)", async () => {
    const h = await head("/nodefony/test/index");
    expect(h["cross-origin-embedder-policy"]).to.equal(undefined);
  });
});
