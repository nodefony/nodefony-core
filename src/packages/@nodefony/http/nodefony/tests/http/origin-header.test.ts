/// <reference types="node" />
/**
 * En-tête `Origin` hostile ou opaque — lot D (originUrl paresseux).
 *
 * AVANT le lot D, `HttpContext` construisait `new URL(request.origin || url)`
 * dans son CONSTRUCTEUR : `Origin: null` (sérialisation opaque de la RFC 6454
 * — iframe sandboxée, redirect cross-origin, file://) faisait THROW la
 * création du contexte → requête SANS AUCUNE réponse (socket pendu jusqu'au
 * timeout). Prouvé au curl : TypeError Invalid URL, input: 'null'.
 *
 * APRÈS : `originUrl` est un getter paresseux avec repli sur l'URL de la
 * requête (même pattern que le WS) — la requête répond 200, et l'origine
 * opaque n'est jamais un motif de crash.
 */
import { expect } from "chai";
import https from "node:https";

const BASE = { hostname: "127.0.0.1", port: 5152, rejectUnauthorized: false };

function get(
  path: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const r = https.request(
      { ...BASE, method: "GET", path, headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () =>
          resolve({
            status: res.statusCode!,
            body: Buffer.concat(chunks).toString("utf-8"),
          }),
        );
      },
    );
    // Le bug d'origine pendait la socket SANS réponse : borner le test, pas
    // attendre le timeout de la suite.
    r.setTimeout(5000, () => {
      r.destroy(new Error("aucune réponse en 5 s — contexte crashé au ctor ?"));
    });
    r.on("error", reject);
    r.end();
  });
}

describe("Origin opaque/malformé — le contexte répond toujours (lot D)", () => {
  it("Origin: null (RFC 6454) → 200, jamais une socket muette", async () => {
    const r = await get("/nodefony/test/index", { origin: "null" });
    expect(r.status).to.equal(200);
  });

  it("Origin malformé → 200 (repli URL de la requête, pas de throw)", async () => {
    const r = await get("/nodefony/test/index", { origin: "pas une url" });
    expect(r.status).to.equal(200);
  });

  it("Origin valide → 200 (chemin nominal intact)", async () => {
    const r = await get("/nodefony/test/index", {
      origin: "https://example.com",
    });
    expect(r.status).to.equal(200);
  });
});
