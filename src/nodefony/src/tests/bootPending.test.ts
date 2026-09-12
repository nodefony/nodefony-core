import { describe, it } from "vitest";
import { expect } from "chai";
import { renderPendingLines } from "../service/dev/BootReporter";
import type { IReadinessContributor } from "../kernel/readinessRegistry";

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

/** Le bloc rendu, sans les échappements de couleur — on juge le TEXTE. */
const texte = (contributors: readonly IReadinessContributor[]): string =>
  renderPendingLines(contributors)
    .join("")
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\[[0-9;]*m/gu, "");

describe("renderPendingLines — ce qui n'est pas prêt se NOMME au démarrage", () => {
  it("nomme le composant ET sa cause", () => {
    const rendu = texte([enAttente()]);
    expect(rendu).to.contain("drizzle:schema:default");
    expect(rendu).to.contain("1 migration à appliquer : app/0001_x.");
  });

  it("rend le GESTE, prêt à taper", () => {
    // C'est la moitié qui manquait : une cause sans geste laisse chercher, et
    // c'est en cherchant qu'on supprime une base pour « repartir propre ».
    const rendu = texte([enAttente({ action: "nodefony orm:migrate" })]);
    expect(rendu).to.contain("→ nodefony orm:migrate");
  });

  it("dit si le trafic est RETENU ou s'il passe quand même", () => {
    // Deux affirmations différentes : « ce composant va mal » n'est pas
    // « n'envoyez plus de trafic ». Les confondre a un coût des deux côtés.
    expect(texte([enAttente()])).to.contain("trafic retenu (/readyz 503)");
    expect(texte([enAttente({ blocking: false })])).to.contain(
      "le trafic passe quand même",
    );
  });

  it("accorde le pluriel sur le nombre de composants", () => {
    const deux = texte([
      enAttente(),
      enAttente({ name: "cache", reason: "froid" }),
    ]);
    expect(deux).to.contain("2 composants pas prêts");
    expect(texte([enAttente()])).to.contain("1 composant pas prêt");
  });

  it("reste MUET quand tout est prêt — le cas normal ne parle pas", () => {
    // Un bandeau qui crie sur le cas normal s'apprend à être ignoré, et c'est
    // le cas normal qui domine : une application à jour ne dit rien de plus.
    expect(
      renderPendingLines([{ name: "drizzle:schema:default", ready: true }]),
    ).to.be.an("array").that.is.empty;
    expect(renderPendingLines([])).to.be.an("array").that.is.empty;
  });

  it("un contributeur sans geste n'invente pas de flèche", () => {
    // Tout état ne se répare pas depuis cette machine (un service tiers muet) :
    // proposer un geste faux coûte plus cher que n'en proposer aucun.
    expect(texte([enAttente({ reason: "service tiers muet" })])).to.not.contain(
      "→",
    );
  });
});
