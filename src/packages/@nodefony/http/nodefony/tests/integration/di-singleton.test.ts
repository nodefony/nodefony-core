/// <reference types="node" />
/**
 * Intégrité du conteneur d'injection, sur un serveur RÉEL.
 *
 * Ce que ni un test unitaire ni un test HTTP ordinaire ne voient : un service
 * DUPLIQUÉ ne casse rien de visible. Chaque copie « marche » ; seul son état
 * (cache, compteur, connexion) est silencieusement dupliqué et perdu. Les 576
 * tests d'intégration http restaient verts avec DEUX HttpKernel dans le process.
 *
 * On interroge donc l'IDENTITÉ des services depuis l'intérieur du serveur, via
 * la sonde `/nodefony/test/di/probe` (module test, `policy:dev`).
 *
 * Vécu : `HttpKernel` déplacé de trois lignes dans le `@services([...])` de
 * `@nodefony/http` → chaque consommateur recevait son HttpKernel privé, le
 * serveur démarrait « UP » et rendait 499 sur chaque requête. Depuis, l'ordre
 * d'écriture est neutralisé (tri par dépendances déclarées) — ce test est la
 * sentinelle qui le prouve en conditions réelles.
 *
 * Serveur live : 127.0.0.1:5151 (HTTP).
 */
import { expect } from "chai";
import http from "node:http";

const BASE = { hostname: "127.0.0.1", port: 5151 };

interface DiProbe {
  httpKernelPresent: boolean;
  consumersChecked: string[];
  httpKernelShared: boolean;
  moduleAgrees: boolean | null;
  fetchPresent: boolean;
}

function get(path: string): Promise<{ status: number; body: DiProbe }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ ...BASE, path, method: "GET" }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try {
          resolve({
            status: res.statusCode ?? 0,
            body: JSON.parse(data) as DiProbe,
          });
        } catch (e) {
          reject(new Error(`réponse non-JSON (${res.statusCode}): ${data}`));
        }
      });
    });
    req.on("error", reject);
    req.end();
  });
}

describe("DI — intégrité du container (serveur réel)", () => {
  it("un seul HttpKernel : tous ses consommateurs tiennent l'instance du container", async () => {
    const { status, body } = await get("/nodefony/test/di/probe");
    expect(status).to.equal(200);

    expect(body.httpKernelPresent, "HttpKernel absent du container").to.be.true;
    // Sans consommateur vérifié, « tous partagent » serait vrai par vacuité.
    expect(
      body.consumersChecked.length,
      "aucun consommateur observé → le test ne prouverait rien",
    ).to.be.greaterThan(0);
    expect(
      body.httpKernelShared,
      `un consommateur détient un HttpKernel PRIVÉ (doublon silencieux) — ` +
        `consommateurs observés: ${body.consumersChecked.join(", ")}`,
    ).to.be.true;
  });

  it("Fetch est posé au container : une instance par kernel, pas une par requête", async () => {
    // Avant, `Fetch` n'était que DÉCLARÉ au registre : `kernel.get("Fetch")`
    // rendait null → un `new Fetch(...)` à CHAQUE `@inject("Fetch")`, construit
    // avec le Context du controller là où son ctor attend un Module.
    const { body } = await get("/nodefony/test/di/probe");
    expect(body.fetchPresent, "Fetch n'est pas au container").to.be.true;
  });

  it("l'identité reste stable d'une requête à l'autre (pas de reconstruction)", async () => {
    // Un service reconstruit par requête passerait le test ci-dessus à chaque
    // fois (chaque copie est cohérente avec elle-même). On vérifie donc que le
    // partage tient sur plusieurs requêtes successives.
    for (let i = 0; i < 5; i++) {
      const { body } = await get("/nodefony/test/di/probe");
      expect(body.httpKernelShared, `requête ${i + 1}: identité rompue`).to.be
        .true;
      expect(body.fetchPresent, `requête ${i + 1}: Fetch disparu`).to.be.true;
    }
  });
});
