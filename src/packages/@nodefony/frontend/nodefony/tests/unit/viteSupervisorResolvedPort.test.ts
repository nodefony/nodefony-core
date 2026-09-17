/// <reference types="node" />
/**
 * Unit — `status().port` rend le port RÉSOLU, jamais le port DEMANDÉ.
 *
 * Le contrat l'annonce depuis toujours (`IViteSupervisorStatus.port: number |
 * null`), l'implémentation le contredisait : elle retombait sur `devPort` dès
 * qu'aucun spawn n'avait résolu de port. Un port qu'on ESPÈRE était donc servi
 * pour un port qui SERT, et rien ne distinguait les deux à la lecture.
 *
 * La conséquence n'est pas théorique, c'est le symptôme entier du défaut :
 * lancer une SECONDE application sur un poste où la première tient déjà le port
 * faisait annoncer à la seconde le port de la première — donc un `<script src>`
 * pointé chez la voisine, un navigateur qui reçoit le mauvais bundle ou rien,
 * et une panne qu'on cherche ailleurs.
 *
 * Le mensonge avait déjà forcé un consommateur à s'en défendre
 * (`FrontendService.cspPorts` contrôlait l'état parce que le port n'était pas
 * fiable) : un contournement chez le lecteur est le signe qu'une règle est
 * fausse chez l'auteur.
 *
 * Aucun spawn ici : c'est précisément l'état « rien n'a encore été résolu »
 * qu'on verrouille, et il n'existe qu'avant tout démarrage.
 */
import { describe, it } from "vitest";
import { expect } from "chai";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ViteProcessSupervisor } from "../../service/ViteProcessSupervisor";

const FIXTURE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../fixtures/minimal-frontend",
);

/** Un superviseur construit, jamais démarré — donc sans port résolu. */
function supervisorNeuf(devPort: number) {
  return new ViteProcessSupervisor({
    devHost: "127.0.0.1",
    devPort,
    startupTimeoutMs: 1_000,
    pipeLogs: false,
    cwd: FIXTURE_ROOT,
    logger: { info: () => {}, error: () => {}, debug: () => {} },
    healthCheckIntervalMs: 0,
    autoRestart: false,
  });
}

describe("ViteProcessSupervisor — port annoncé", () => {
  it("rend `null` tant qu'aucun spawn n'a résolu de port", () => {
    const devPort = 51730;
    const status = supervisorNeuf(devPort).status();

    expect(
      status.port,
      "un port non résolu doit se DIRE absent : le rendre égal au port demandé " +
        "fait annoncer à la 2ᵉ application le port de la 1ʳᵉ",
    ).to.equal(null);
    expect(status.port).to.not.equal(devPort);
  });

  it("n'annonce pas d'origine non plus — les deux se tiennent", () => {
    // `origin` porte déjà la bonne sémantique (`null` avant résolution) ; les
    // laisser diverger donnerait une origine absente et un port présent, soit
    // deux réponses à la même question.
    expect(supervisorNeuf(51731).status().origin).to.equal(null);
  });

  it("l'état ne prétend rien non plus : `idle`, pas `ready`", () => {
    // Garde-fou de l'invariant dont dépendent les lecteurs protégés par l'état
    // (`TemplateHelper.renderDevTags`, `FrontendService.cspPorts`) : un port
    // absent ne doit jamais coexister avec un état qui se dit prêt.
    expect(supervisorNeuf(51732).status().state).to.equal("idle");
  });
});
