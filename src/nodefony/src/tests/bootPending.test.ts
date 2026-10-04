import { describe, it } from "vitest";
import { expect } from "vitest";
import { collectBootNotices } from "../kernel/bootReport";
import type { IReadinessContributor } from "../kernel/readinessRegistry";
import {
  buildStartupView,
  renderStartupHuman,
} from "../service/dev/startupScreen";
import type { IBootReport } from "../kernel/bootReport";

/**
 * SPEC — « le compte d'un journal n'est pas un diagnostic ».
 *
 * Une application dont une migration attend démarrait en annonçant « Prêt » et
 * « aucun warning » : l'écart n'apparaissait qu'à la première requête touchant
 * la colonne absente, loin du démarrage. Mesuré : un agent a lu « colonne
 * inconnue », en a déduit une base incohérente, et l'a SUPPRIMÉE — trois
 * comptes perdus, dont un que rien ne re-sème.
 *
 * Ces cas figent les trois règles qui referment le silence : ce qui n'est pas
 * prêt est NOMMÉ, le GESTE part avec la cause, et le cas normal reste muet.
 * Ils portent sur `collectBootNotices`, la SEULE implémentation de la règle :
 * l'écran, le rendu machine et `var/last-boot.json` lisent tous sa liste.
 */

/** Décor : un contributeur non prêt, tel que le registre le restitue. */
const enAttente = (
  extra: Partial<IReadinessContributor> = {},
): IReadinessContributor => ({
  name: "drizzle:schema:default",
  ready: false,
  reason: "Le connecteur « default » a 1 migration à appliquer : app/0001_x.",
  ...extra,
});

const points = (contributors: readonly IReadinessContributor[]) =>
  collectBootNotices([], undefined, contributors, []);

describe("collectBootNotices — ce qui n'est pas prêt se NOMME au démarrage", () => {
  it("nomme le composant ET sa cause", () => {
    const [point] = points([enAttente()]);
    expect(point?.code).to.equal("NOT_READY");
    expect(point?.message).to.contain("drizzle:schema:default");
    expect(point?.message).to.contain("1 migration à appliquer : app/0001_x.");
  });

  it("rend le GESTE, prêt à taper — jusqu'à l'écran", () => {
    // C'est la moitié qui manquait : une cause sans geste laisse chercher, et
    // c'est en cherchant qu'on supprime une base pour « repartir propre ».
    const notices = points([enAttente({ action: "nodefony orm:migrate" })]);
    expect(notices[0]?.fix).to.equal("nodefony orm:migrate");
    const report = {
      durationMs: 1000,
      modulesLoaded: [],
      manifestEntries: 0,
      modulesSkipped: [],
      modulesGated: [],
      warnings: 0,
      errors: 0,
      criticals: null,
      serversExpected: true,
      serversListening: [],
      healthy: true,
      open: [],
      notices,
    } satisfies IBootReport;
    const ecran = renderStartupHuman(
      buildStartupView(report, {
        version: "10.0.0",
        environment: "development",
        root: "/app",
        frontend: null,
        data: [],
        processes: null,
        firewall: null,
        supervised: true,
        inspector: null,
      }),
      { color: false, hyperlinks: false, columns: 80 },
    ).join("\n");
    expect(ecran).to.contain("→ nodefony orm:migrate");
  });

  it("dit si le trafic est RETENU ou s'il passe quand même — et en tire la gravité", () => {
    // Deux affirmations différentes : « ce composant va mal » n'est pas
    // « n'envoyez plus de trafic ». Les confondre a un coût des deux côtés.
    const [retenu] = points([enAttente()]);
    expect(retenu?.message).to.contain("trafic retenu (/readyz 503)");
    expect(retenu?.level).to.equal("error");
    const [passe] = points([enAttente({ blocking: false })]);
    expect(passe?.message).to.contain("le trafic passe quand même");
    expect(passe?.level).to.equal("warning");
  });

  it("un point par composant", () => {
    const deux = points([
      enAttente(),
      enAttente({ name: "cache", reason: "froid" }),
    ]);
    expect(deux.map((n) => n.message.split(" ")[0])).to.deep.equal([
      "drizzle:schema:default",
      "cache",
    ]);
  });

  it("reste MUET quand tout est prêt — le cas normal ne parle pas", () => {
    // Un bandeau qui crie sur le cas normal s'apprend à être ignoré, et c'est
    // le cas normal qui domine : une application à jour ne dit rien de plus.
    expect(points([{ name: "drizzle:schema:default", ready: true }])).to.be.an(
      "array",
    ).that.is.empty;
    expect(points([])).to.be.an("array").that.is.empty;
  });

  it("un contributeur sans geste n'invente pas de flèche", () => {
    // Tout état ne se répare pas depuis cette machine (un service tiers muet) :
    // proposer un geste faux coûte plus cher que n'en proposer aucun.
    const [point] = points([enAttente({ reason: "service tiers muet" })]);
    expect(point?.fix).to.equal(undefined);
  });
});
