import { describe, it } from "vitest";
import { expect } from "chai";
import { diagnoseEmptyManifest } from "../kernel/bootConfigDiagnosis";

/**
 * SPEC — « un manifeste vide recouvre trois causes, le diagnostic doit les
 * séparer ».
 *
 * Vécu le 2026-09-13 : six démarrages consécutifs d'une application saine ont
 * rendu « la configuration LUE ne déclare aucun module ⇒ vérifier
 * `nodefony.config` et l'exécutable employé ». La configuration déclarait ses
 * sept modules depuis le début et l'exécutable était le bon : deux personnes ont
 * cherché deux heures dans les deux seules choses qui étaient justes. La cause
 * réelle — un `dist/nodefony.config.js` vide ou en cours de construction — n'a
 * jamais été nommée, parce qu'un fichier JavaScript vide est VALIDE : rien ne
 * lève, `default` vaut `undefined`, et le Kernel replie sur `defaultAppConfig`
 * dont `modules` est `[]`.
 */
describe("diagnoseEmptyManifest — nommer la cause, pas accuser au hasard", () => {
  it("config ABSENTE sous profil serveur → nomme le dist ET l'export vide", () => {
    const dit = diagnoseEmptyManifest({
      serversExpected: true,
      manifestEntries: 0,
      origin: "empty",
    });
    expect(dit).to.be.a("string");
    // Ce que l'ancien message ne disait JAMAIS, et qui est la première chose à
    // vérifier : le `dist/` chargé ne correspond pas aux sources.
    expect(dit).to.match(/dist/i);
    expect(dit).to.match(/vide|absent/i);
    // Et il dit que RIEN n'a levé — sinon on cherche une erreur qui n'existe pas.
    expect(dit).to.match(/sans qu'une erreur soit levée/i);
  });

  it("objet sans la marque defineConfig → dit que le défaut legacy est vide", () => {
    const dit = diagnoseEmptyManifest({
      serversExpected: true,
      manifestEntries: 0,
      origin: "legacy-object",
    });
    expect(dit).to.match(/defineConfig/);
    expect(dit).to.match(/VIDE|vide/);
  });

  it("descripteur dont modules est vide → renvoie à la déclaration des modules", () => {
    const dit = diagnoseEmptyManifest({
      serversExpected: true,
      manifestEntries: 0,
      origin: "descriptor",
    });
    expect(dit).to.match(/@nodefony\/http/);
  });

  it("HORS profil serveur → se TAIT (console, test, build : cas nominal)", () => {
    for (const origin of ["empty", "legacy-object", "descriptor"] as const) {
      expect(
        diagnoseEmptyManifest({
          serversExpected: false,
          manifestEntries: 0,
          origin,
        }),
        `origin=${origin}`,
      ).to.equal(null);
    }
  });

  it("manifeste NON vide → se tait, quelle que soit la provenance", () => {
    expect(
      diagnoseEmptyManifest({
        serversExpected: true,
        manifestEntries: 7,
        origin: "descriptor",
      }),
    ).to.equal(null);
  });

  it("les trois causes rendent trois messages DISTINCTS", () => {
    const messages = (["empty", "legacy-object", "descriptor"] as const).map(
      (origin) =>
        diagnoseEmptyManifest({
          serversExpected: true,
          manifestEntries: 0,
          origin,
        }),
    );
    expect(new Set(messages).size).to.equal(3);
  });
});
