/// <reference types="node" />
import { expect } from "chai";
import { describe, it } from "vitest";
import http from "node:http";

/**
 * RED-TEAM du fast-path URL (F-B) — le pathname que lisent le **router** et le
 * **firewall** doit TOUJOURS être la forme normalisée WHATWG, que l'URL ait été
 * découpée (fast-path) ou parsée (bail-out).
 *
 * L'attaque conçue pour CETTE architecture : le firewall décide de la zone par
 * une regex sur le pathname (`^/nodefony/[^/]+/api(/|$)`), et le router matche
 * ensuite le sien. Si la découpe laissait passer une forme brute que WHATWG
 * aurait résolue, les deux liraient des chemins DIFFÉRENTS — la requête
 * atteindrait la route protégée tout en échappant à sa zone. C'est un bypass
 * d'autorisation complet, invisible à toute suite fonctionnelle (la route
 * répond normalement).
 *
 * Chaque vecteur porte donc son verdict attendu **et son contraire** : le
 * chemin non canonique doit se comporter EXACTEMENT comme sa forme normalisée
 * — 401 quand elle est protégée, 200 quand elle est publique. Un test qui
 * n'exigerait que « pas 200 » resterait vert sur un 404, qui n'est pas une
 * autorisation refusée.
 */

const BASE = { hostname: "localhost", port: 5151 };

type Res = { status: number };

function raw(path: string, headers: Record<string, string> = {}): Promise<Res> {
  return new Promise((resolve, reject) => {
    // `path` est envoyé TEL QUEL sur le fil (node ne le normalise pas) — c'est
    // la condition de l'attaque : le serveur reçoit la forme brute.
    const req = http.request(
      { ...BASE, path, method: "GET", headers },
      (res) => {
        res.resume();
        res.on("end", () => resolve({ status: res.statusCode! }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

// Route data plane sous la zone `nodefony-admin` (session requise → 401 sans
// cookie) et sonde publique portée par la zone `nodefony-liveness` (200).
const PROTECTED = "/nodefony/kernel/api/info";
const PUBLIC = "/nodefony/kernel/api/livez";

describe("RED-TEAM — fast-path URL : le firewall lit la forme NORMALISÉE", () => {
  it("contrôle positif : les formes canoniques se comportent comme attendu", async () => {
    expect((await raw(PROTECTED)).status, PROTECTED).to.equal(401);
    expect((await raw(PUBLIC)).status, PUBLIC).to.equal(200);
  });

  // Formes dont le pathname BRUT échappe à `^/nodefony/[^/]+/api(/|$)` mais
  // dont la forme normalisée retombe DANS la zone : le firewall doit refuser.
  const evade: Array<[string, string]> = [
    ["dot-segment (`..`)", "/nodefony/kernel/x/../api/info"],
    [
      "dot-segment percent-encodé (`%2e%2e`)",
      "/nodefony/kernel/x/%2e%2e/api/info",
    ],
    ["dot-segment encodé en majuscules", "/nodefony/kernel/x/%2E%2E/api/info"],
    ["segment courant (`.`)", "/nodefony/./kernel/api/info"],
    ["backslash (WHATWG → `/`)", "/nodefony/kernel\\x/..\\api/info"],
    ["`..` interne à la zone", "/nodefony/kernel/api/../api/info"],
    ["mixte encodé + brut", "/nodefony/kernel/%2e%2e/kernel/api/info"],
  ];
  for (const [label, path] of evade) {
    it(`zone appliquée malgré ${label}`, async () => {
      // 401 EXACT — pas « ≠ 200 » : un 404 signifierait que la route n'a pas
      // été atteinte, donc que le vecteur n'a rien prouvé sur l'autorisation.
      expect((await raw(path)).status, path).to.equal(401);
    });
  }

  // Réciproque — le sens que l'on oublie : une forme non canonique dont la
  // NORMALISÉE est publique doit rester publique. Si le firewall lisait le
  // brut, la zone liveness (pattern EXACT, `$`) ne matcherait plus et la zone
  // admin capturerait la sonde → 401 sur un endpoint que le kubelet appelle,
  // donc cascade de redémarrages. Une régression silencieuse dans l'autre sens.
  const stillPublic: Array<[string, string]> = [
    ["dot-segment", "/nodefony/kernel/api/x/../livez"],
    ["segment courant", "/nodefony/kernel/api/./livez"],
    ["dot-segment encodé", "/nodefony/kernel/api/x/%2e%2e/livez"],
  ];
  for (const [label, path] of stillPublic) {
    it(`sonde publique préservée malgré ${label}`, async () => {
      expect((await raw(path)).status, path).to.equal(200);
    });
  }

  it("autorité non canonique : la casse du Host ne change pas la zone", async () => {
    // `Host: LOCALHOST` déclenche le bail-out (WHATWG lowercase le host) — la
    // requête doit rester sous la zone, pas basculer hors vhost.
    expect((await raw(PROTECTED, { Host: "LOCALHOST:5151" })).status).to.equal(
      401,
    );
    expect((await raw(PUBLIC, { Host: "LOCALHOST:5151" })).status).to.equal(
      200,
    );
  });

  it("autorité IPv4-like (`127.1`) : normalisée, la zone tient", async () => {
    // WHATWG normalise `127.1` en `127.0.0.1` → bail-out obligatoire, sinon un
    // matcher de domaine lisant le host brut verrait un hôte inconnu.
    expect((await raw(PUBLIC, { Host: "127.1:5151" })).status).to.equal(200);
    expect((await raw(PROTECTED, { Host: "127.1:5151" })).status).to.equal(401);
  });

  it("traversal hors application : jamais servi", async () => {
    for (const path of [
      "/../../etc/passwd",
      "/static/../../../etc/passwd",
      "/%2e%2e/%2e%2e/etc/passwd",
    ]) {
      expect((await raw(path)).status, path).to.not.equal(200);
    }
  });
});
