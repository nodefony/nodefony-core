/**
 * #494 — calque de configuration par requête, sur le serveur réel.
 *
 * Le module `test` écoute `onRequestScope` : l'en-tête `x-nf-test-max-body`
 * y pose un calque `overlayConfig("@nodefony/http", { maxBodySize })` pour la
 * seule requête qui le porte. Ce banc prouve que le point d'accroche est DANS
 * la bulle ALS (sinon `overlayConfig` lèverait faute de scope) et AVANT la
 * lecture du corps (sinon le plafond serait déjà appliqué), et que le calque
 * ne déborde ni sur la requête voisine ni sur la configuration du module.
 *
 * Débrancher : retirer le `fireAsync("onRequestScope")` de `http-kernel.ts`,
 * ou refaire lire `maxBodySize` au constructeur de `Request` → le 2ᵉ bloc tombe.
 */
import { expect } from "chai";
import https from "node:https";

const BASE = { hostname: "127.0.0.1", port: 5152, rejectUnauthorized: false };
const PATH = "/nodefony/test/decorators/body";
// 1,5 Mo : au-dessus du plafond par défaut (1 MiB), sous le calque (2 MiB).
const BIG = JSON.stringify({ x: "a".repeat(1_500_000) });

function post(headers: Record<string, string> = {}): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        ...BASE,
        path: PATH,
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(BIG),
          ...headers,
        },
      },
      (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode ?? 0));
      },
    );
    req.on("error", reject);
    req.end(BIG);
  });
}

describe("#494 — calque de configuration par requête (serveur réel)", () => {
  it("sans calque : le plafond du module s'applique (413)", async () => {
    expect(await post()).to.equal(413);
  });

  it("avec calque : la requête qui le pose accepte le corps ; ses voisines non", async () => {
    const [withOverlay, neighbour] = await Promise.all([
      post({ "x-nf-test-max-body": "2097152" }),
      post(),
    ]);
    expect(withOverlay).to.equal(200);
    expect(neighbour).to.equal(413);
    // La configuration du module n'a pas bougé.
    expect(await post()).to.equal(413);
  });

  it("un calque invalide est refusé : la requête échoue, le plafond reste", async () => {
    // Le refus lève DANS le point d'accroche → 500 ; un 413 voudrait dire que
    // le calque n'a jamais été tenté (point d'accroche absent).
    const status = await post({ "x-nf-test-max-body": "-1" });
    expect(status).to.equal(500);
    expect(await post()).to.equal(413);
  });
});
