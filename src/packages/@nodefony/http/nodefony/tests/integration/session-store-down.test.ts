/// <reference types="node" />
/**
 * Le stockage de session en panne ne doit pas faire PENDRE une requête.
 *
 * Décor : serveur live 127.0.0.1:5152 (HTTPS).
 * Route : GET /nodefony/test/session-rt/broken-store — session ouverte, dont la
 * persistance échoue (« no such table: session »), injectée sur CE contexte.
 *
 * Le défaut couvert coûte cher parce qu'il ne se voit pas : avant le correctif,
 * la requête n'aboutissait jamais — ni 500, ni 503, ni page d'erreur. Le client
 * voyait un délai dépassé, l'exploitant cherchait du côté du réseau, et le banc
 * de tenue dans la durée est resté rouge dix jours sans que personne sache
 * pourquoi. C'est le mode de défaillance d'une application mise en ligne sans
 * ses migrations, ce qui est un oubli banal.
 *
 * VU ROUGE : retirer le `try/catch` autour de `saveSession()` dans
 * `HttpContext.#doSend` fait expirer le premier cas — la socket reste ouverte.
 */
import { expect } from "chai";
import { describe, it } from "vitest";
import https from "node:https";

const BASE = { hostname: "127.0.0.1", port: 5152, rejectUnauthorized: false };

/** Le seuil du ticket : une réponse en moins d'une seconde. */
const DELAI_MAX_MS = 1000;

function get(
  path: string,
  timeoutMs: number,
): Promise<{ status: number; body: string; ms: number }> {
  return new Promise((resolve, reject) => {
    const debut = Date.now();
    const r = https.request({ ...BASE, method: "GET", path }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () =>
        resolve({
          status: res.statusCode ?? 0,
          body: Buffer.concat(chunks).toString("utf-8"),
          ms: Date.now() - debut,
        }),
      );
    });
    // Le défaut se manifeste par une ABSENCE : sans ce délai, le test
    // n'échouerait pas, il pendrait — et un banc qui pend ne dit rien.
    r.setTimeout(timeoutMs, () => {
      r.destroy(
        new Error(
          `aucune réponse en ${timeoutMs} ms — la requête PEND, c'est le défaut`,
        ),
      );
    });
    r.on("error", reject);
    r.end();
  });
}

describe("stockage de session en panne (intégration)", () => {
  it("répond — au lieu de laisser le client attendre son propre délai", async () => {
    const vu = await get("/nodefony/test/session-rt/broken-store", 5000);
    expect(vu.status, "le serveur doit répondre").to.be.above(0);
  });

  it("répond en moins d'une seconde", async () => {
    const vu = await get("/nodefony/test/session-rt/broken-store", 5000);
    expect(vu.ms).to.be.below(DELAI_MAX_MS);
  });

  it("sert 500 — la session n'a pas été retenue, et ça se dit", async () => {
    const vu = await get("/nodefony/test/session-rt/broken-store", 5000);
    expect(vu.status).to.equal(500);
  });

  it("ne divulgue pas le moteur au client", async () => {
    const vu = await get("/nodefony/test/session-rt/broken-store", 5000);
    expect(vu.body).to.not.match(/SQLITE|no such table/);
  });

  it("laisse intacte la route voisine, qui persiste normalement", async () => {
    // La panne est portée par UN contexte : une requête voisine ne doit rien
    // en voir. Sans ce cas, on ne saurait pas si le décor a sali le serveur.
    const vu = await get("/nodefony/test/session-rt/use", 5000);
    expect(vu.status).to.equal(200);
    expect(vu.body).to.match(/"hasSession":true/);
  });
});
