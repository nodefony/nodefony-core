/// <reference types="node" />
import { expect } from "chai";
import https from "node:https";

/**
 * ORDRE du pipeline — le hook `initialize()` d'un controller ne doit pas
 * s'exécuter pour une requête que le pipeline va refuser.
 *
 * `initialize()` est le constructeur asynchrone d'un controller : c'est là que
 * du code utilisateur ouvre une ressource, pose un cookie, charge un contexte
 * métier. Tant que l'instanciation précède le firewall, ce code tourne **sans
 * identité, sans CSRF validé**, pour n'importe quel appelant — et un 401 rendu
 * ensuite ne rattrape rien de ce qui a déjà été fait.
 *
 * Deux rejets, deux gardes distinctes :
 *  - **401** — le firewall (`Firewall.handleSecurity`), authentification ;
 *  - **403** — la garde déclarative `@IsGranted("ROLE_ADMIN")`, autorisation,
 *    dont le code dit qu'elle « court-circuite l'instanciation DI +
 *    initialize() (Zero Trust) » (`Resolver.executeAction`).
 *
 * Le mouchard vit dans le module test (`nodefony/secure/initializeProbe.ts`),
 * écrit par `SecureController.initialize()` et lu par une route publique — la
 * seule lisible depuis un banc anonyme.
 *
 * Requiert : serveur 5152 + comptes `admin/secret` (ROLE_ADMIN) et
 * `user/secret` (ROLE_USER) du module test. Start : /start-server
 */

const BASE = { hostname: "localhost", port: 5152, rejectUnauthorized: false };
const PROBE = "/nodefony/test/pipeline-order/probe";

type Res = { status: number; body: unknown };
type Probe = { runs: number; identity: string | null; session: boolean };

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
            resolve({ status: res.statusCode!, body: JSON.parse(raw) });
          } catch {
            resolve({ status: res.statusCode!, body: raw });
          }
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

const basic = (identifier: string, password: string) => ({
  Authorization: `Basic ${Buffer.from(`${identifier}:${password}`).toString("base64")}`,
});

async function resetProbe(): Promise<void> {
  const res = await get(`${PROBE}/reset`);
  expect(res.status, "la route de remise à zéro doit être publique").to.equal(
    200,
  );
}

async function readProbe(): Promise<Probe> {
  const res = await get(PROBE);
  expect(res.status, "la route de lecture doit être publique").to.equal(200);
  return res.body as Probe;
}

describe("Pipeline — `initialize()` ne tourne pas pour une requête rejetée", () => {
  it("le mouchard est bien câblé (contrôle positif : une requête ACCEPTÉE l'incrémente)", async () => {
    await resetProbe();
    const ok = await get(
      "/nodefony/test/secure/ping",
      basic("admin", "secret"),
    );
    expect(ok.status, "credential valide → 200").to.equal(200);

    const probe = await readProbe();
    // Sans ce contrôle, les deux tests suivants pourraient passer parce que le
    // mouchard ne marche pas — et non parce que le pipeline s'est amélioré.
    expect(
      probe.runs,
      "initialize() a bien tourné pour la requête servie",
    ).to.equal(1);
    expect(
      probe.identity,
      "et il voit l'identité, une fois le firewall passé",
    ).to.equal("admin");
  });

  it("401 (firewall) — aucun code de controller ne s'exécute", async () => {
    await resetProbe();
    const denied = await get("/nodefony/test/secure/ping");
    expect(denied.status, "aucune preuve → 401").to.equal(401);

    const probe = await readProbe();
    expect(
      probe.runs,
      "un anonyme rejeté ne doit déclencher ni la résolution DI ni initialize()",
    ).to.equal(0);
  });

  it("403 (@IsGranted) — la garde court-circuite bien l'instanciation", async () => {
    await resetProbe();
    const denied = await get(
      "/nodefony/test/secure/admin-only",
      basic("user", "secret"),
    );
    expect(denied.status, "authentifié mais sans le rôle → 403").to.equal(403);

    const probe = await readProbe();
    expect(
      probe.runs,
      "la garde d'autorisation s'évalue AVANT newController (Zero Trust)",
    ).to.equal(0);
  });
});
