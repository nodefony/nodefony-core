/// <reference types="node" />
import { expect } from "chai";
import http from "node:http";
import https from "node:https";

// Probes de santé cloud-native /livez + /readyz (Phase 0.7).
// Court-circuit TOTAL du pipeline : pas de session (0 Set-Cookie), pas de
// contexte, réponses minimales. Servies par HTTP (5151) ET HTTPS (5152).
// La bascule readiness→503 au SIGTERM est prouvée par le banc e2e
// `run.sh graceful` (elle arrête le serveur — pas testable ici).

type Res = { status: number; headers: Record<string, unknown>; body: unknown };

function get(path: string, secure = false): Promise<Res> {
  return new Promise((resolve, reject) => {
    const mod = secure ? https : http;
    const r = mod.request(
      {
        hostname: "localhost",
        port: secure ? 5152 : 5151,
        method: "GET",
        path,
        rejectUnauthorized: false,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString();
          let body: unknown = raw;
          try {
            body = JSON.parse(raw);
          } catch {
            // raw non-JSON : gardé tel quel
          }
          resolve({
            status: res.statusCode!,
            headers: res.headers as Record<string, unknown>,
            body,
          });
        });
      },
    );
    r.on("error", reject);
    r.end();
  });
}

describe("Health probes /livez + /readyz (cloud-native 0.7)", () => {
  it("GET /livez → 200 {status:ok} JSON no-store", async () => {
    const res = await get("/livez");
    expect(res.status).to.equal(200);
    expect(res.body).to.deep.equal({ status: "ok" });
    expect(res.headers["content-type"]).to.equal("application/json");
    expect(res.headers["cache-control"]).to.equal("no-store");
  });

  it("GET /readyz → 200 {status:ok} (serveur booté)", async () => {
    const res = await get("/readyz");
    expect(res.status).to.equal(200);
    expect(res.body).to.deep.equal({ status: "ok" });
  });

  it("probes servies aussi en HTTPS (kubelet scheme: HTTPS)", async () => {
    const livez = await get("/livez", true);
    const readyz = await get("/readyz", true);
    expect(livez.status).to.equal(200);
    expect(readyz.status).to.equal(200);
  });

  it("ne crée JAMAIS de session (0 Set-Cookie — sondées toutes les 2-10 s)", async () => {
    const res = await get("/livez");
    expect(res.headers["set-cookie"]).to.equal(undefined);
    const res2 = await get("/readyz");
    expect(res2.headers["set-cookie"]).to.equal(undefined);
  });

  it("match STRICT du path : /livez?x=1 tombe dans le pipeline normal (404)", async () => {
    const res = await get("/livez?x=1");
    expect(res.status).to.equal(404);
  });
});

/**
 * Registre de DISPONIBILITÉ (S5-R) — un composant qui a un état d'amorçage peut
 * retenir la mise en service. C'est le prérequis cloud-native des migrations de
 * schéma : un pod dont la base est en retard ne doit pas recevoir de trafic.
 *
 * Ce banc pilote un contributeur factice par les routes du module de test
 * (`/nodefony/test/readiness/*` → `kernel.setReadiness`), et regarde ce que le
 * kubelet verrait : `/readyz` bascule à **503**, `/livez` reste à **200** — un
 * schéma en retard est un état EXTERNE, redémarrer le processus ne le répare
 * pas, et un `livez` qui tomberait provoquerait une cascade de redémarrages
 * inutiles.
 *
 * Le retour à 200 est prouvé dans le même souffle : sans lui, le pod resterait
 * hors service après que la cause a été levée — la propriété qui fait tout
 * l'intérêt du mécanisme (le pod redevient disponible SEUL, sans redéploiement).
 */
describe("Registre de disponibilité — /readyz retenu puis libéré (S5-R)", () => {
  const CONTRIBUTORS = [
    "banc:schema",
    "banc:cache",
    "banc:upstream",
    "banc:tiers",
  ];

  const setReady = (name: string, ready: boolean) =>
    get(`/nodefony/test/readiness/set/${name}/${ready ? "ready" : "blocked"}`);
  const clear = (name: string) => get(`/nodefony/test/readiness/clear/${name}`);

  // Le serveur est PARTAGÉ par toute la suite d'intégration : un contributeur
  // oublié laisserait tous les bancs suivants devant un pod hors service.
  afterEach(async () => {
    for (const name of CONTRIBUTORS) {
      await clear(name);
    }
    const res = await get("/readyz");
    expect(res.status, "état rendu propre après le cas").to.equal(200);
  });

  it("un seul contributeur retenu fait basculer /readyz à 503 — et /livez reste 200", async () => {
    expect((await get("/readyz")).status).to.equal(200);

    await setReady("banc:schema", false);
    const readyz = await get("/readyz");
    expect(readyz.status).to.equal(503);
    expect(readyz.body).to.deep.equal({ status: "unready" });

    // La distinction qui évite la cascade de redémarrages.
    const livez = await get("/livez");
    expect(livez.status).to.equal(200);
    expect(livez.body).to.deep.equal({ status: "ok" });

    // …puis le retour, sans redéploiement : le contributeur repose son verdict.
    await setReady("banc:schema", true);
    expect((await get("/readyz")).status).to.equal(200);
  });

  it("trois contributeurs : un seul suffit à retenir, tous doivent libérer", async () => {
    await setReady("banc:schema", false);
    await setReady("banc:cache", false);
    await setReady("banc:upstream", false);
    expect((await get("/readyz")).status).to.equal(503);

    await setReady("banc:cache", true);
    await setReady("banc:upstream", true);
    expect(
      (await get("/readyz")).status,
      "deux prêts sur trois ne libèrent rien",
    ).to.equal(503);

    await setReady("banc:schema", true);
    expect((await get("/readyz")).status).to.equal(200);
  });

  it("le même nom réenregistré ne compte qu'UNE voix (un seul geste libère)", async () => {
    // Un contributeur ÉTRANGER, et PRÊT. C'est l'état d'un pod de PRODUCTION :
    // le module de base y inscrit sa propre voix en permanence dès que
    // `migrations.check` vaut `fail` — le défaut hors développement. Sans ce
    // tiers, le cas affirmait un ABSOLU (« il n'y a qu'un contributeur au
    // monde »), vrai sur un serveur de développement et faux partout ailleurs :
    // il tombait en production sans rien apprendre sur ce qu'il prétend prouver.
    await setReady("banc:tiers", true);

    await setReady("banc:schema", false);
    await setReady("banc:schema", false);
    await setReady("banc:schema", false);

    const report = (await get("/nodefony/test/readiness/report")).body as {
      blocked: number;
      contributors: { name: string; ready: boolean }[];
    };
    expect(report.blocked, "un tiers PRÊT ne retient rien").to.equal(1);
    expect(
      report.contributors.filter((c) => c.name === "banc:schema"),
      "trois inscriptions du même nom ne font qu'UNE voix",
    ).to.have.length(1);
    expect((await get("/readyz")).status).to.equal(503);

    // Un SEUL geste libère — s'il avait compté trois voix, le pod serait resté
    // hors service pour toujours.
    await setReady("banc:schema", true);
    expect((await get("/readyz")).status).to.equal(200);
  });

  it("retirer un contributeur retenu libère la mise en service", async () => {
    await setReady("banc:schema", false);
    expect((await get("/readyz")).status).to.equal(503);
    await clear("banc:schema");
    expect((await get("/readyz")).status).to.equal(200);
  });

  it("le verdict est STABLE entre deux sondes — la sonde ne recalcule rien", async () => {
    await setReady("banc:schema", false);
    // Le kubelet sonde toutes les 2 à 10 s : vingt passages doivent rendre
    // exactement le même verdict, posé une fois par le contributeur.
    for (let i = 0; i < 20; i++) {
      const res = await get("/readyz");
      expect(res.status).to.equal(503);
      expect(res.body).to.deep.equal({ status: "unready" });
    }
    await setReady("banc:schema", true);
  });

  it("le rapport nomme ce qui retient, avec sa raison (le corps de la sonde, lui, reste constant)", async () => {
    await setReady("banc:cache", false);
    const report = (await get("/nodefony/test/readiness/report")).body as {
      blocked: number;
      contributors: { name: string; ready: boolean; reason?: string }[];
    };
    expect(report.blocked).to.equal(1);
    const blocking = report.contributors.find((c) => !c.ready);
    expect(blocking?.name).to.equal("banc:cache");
    expect(blocking?.reason).to.be.a("string").that.is.not.empty;
    // Le corps de la sonde, lui, ne nomme personne : c'est une constante
    // pré-allouée, et le journal du pod porte le détail.
    const readyz = await get("/readyz");
    expect(readyz.status).to.equal(503);
    expect(readyz.body).to.deep.equal({ status: "unready" });
  });
});
