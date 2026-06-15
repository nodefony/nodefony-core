/// <reference types="node" />
import { expect } from "chai";
import http from "node:http";

/**
 * CSRF (P6 J5) — banc d'INTÉGRATION RÉEL contre le serveur live (port 5151).
 * Prouve le câblage de bout en bout (`firewall.enforceCsrf` dans le pipeline
 * http-kernel), pas seulement la logique pure (couverte par security/csrf.test).
 *
 * Route cible : `POST /nodefony/test/fw/post-only` — publique (hors zone firewall)
 * → isole la défense CSRF de l'authentification. Host effectif = `localhost:5151`.
 */

const BASE = { hostname: "localhost", port: 5151 };
const PATH = "/nodefony/test/fw/post-only";
const SELF = "http://localhost:5151"; // origine same-host (Host posé par node:http)

function status(
  method: string,
  path: string,
  headers: Record<string, string> = {},
): Promise<number> {
  return new Promise((resolve, reject) => {
    const r = http.request({ ...BASE, method, path, headers }, (res) => {
      res.on("data", () => {});
      res.on("end", () => resolve(res.statusCode!));
    });
    r.on("error", reject);
    r.end();
  });
}

describe("CSRF — défense Fetch Metadata + repli Origin (intégration live)", () => {
  it("POST sans en-tête (client non-navigateur) → autorisé", async () => {
    expect(await status("POST", PATH)).to.not.equal(403);
  });

  it("POST Sec-Fetch-Site: cross-site → 403 (mutation tierce bloquée)", async () => {
    expect(
      await status("POST", PATH, { "Sec-Fetch-Site": "cross-site" }),
    ).to.equal(403);
  });

  it("POST Sec-Fetch-Site: same-origin → autorisé", async () => {
    expect(
      await status("POST", PATH, { "Sec-Fetch-Site": "same-origin" }),
    ).to.not.equal(403);
  });

  it("POST Sec-Fetch-Site: same-site → autorisé (tolérant par défaut)", async () => {
    expect(
      await status("POST", PATH, { "Sec-Fetch-Site": "same-site" }),
    ).to.not.equal(403);
  });

  it("POST Origin étranger sans Sec-Fetch (repli) → 403", async () => {
    expect(await status("POST", PATH, { Origin: "https://evil.com" })).to.equal(
      403,
    );
  });

  it("POST Origin same-host (repli) → autorisé", async () => {
    expect(await status("POST", PATH, { Origin: SELF })).to.not.equal(403);
  });

  it("POST Referer étranger (repli, Origin absent) → 403", async () => {
    expect(
      await status("POST", PATH, { Referer: "https://evil.com/attack" }),
    ).to.equal(403);
  });

  it("POST Referer same-host (repli) → autorisé", async () => {
    expect(
      await status("POST", PATH, { Referer: `${SELF}/form` }),
    ).to.not.equal(403);
  });

  it("PUT cross-site → 403 (méthode mutante, route /html/upload)", async () => {
    expect(
      await status("PUT", "/nodefony/test/html/upload", {
        "Sec-Fetch-Site": "cross-site",
      }),
    ).to.equal(403);
  });

  it("DELETE cross-site → 403 (méthode mutante, route /fw/delete-only)", async () => {
    expect(
      await status("DELETE", "/nodefony/test/fw/delete-only", {
        "Sec-Fetch-Site": "cross-site",
      }),
    ).to.equal(403);
  });

  it("GET cross-site → JAMAIS 403 (méthode sûre, RFC 9110)", async () => {
    expect(
      await status("GET", "/nodefony/test/index", {
        "Sec-Fetch-Site": "cross-site",
      }),
    ).to.not.equal(403);
  });
});
