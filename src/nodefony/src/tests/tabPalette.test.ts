/**
 * Les teintes de la ligne d'onglets (`service/dev/tabPalette.ts`, #538) :
 * la réponse OSC 11 du terminal lue, et le voile calculé sur ce fond — en
 * 24 bits, en 256 couleurs, ou pas du tout.
 */
import { describe, expect, it } from "vitest";
import {
  BACKGROUND_QUERY,
  parseBackgroundReply,
  tabPalette,
} from "../service/dev/tabPalette";

describe("parseBackgroundReply — la réponse OSC 11", () => {
  it("rgb:RRRR/GGGG/BBBB, terminée par BEL ou par ST", () => {
    expect(
      parseBackgroundReply("\x1b]11;rgb:1e1e/1e1e/1e1e\x07"),
    ).to.deep.equal([30, 30, 30]);
    expect(
      parseBackgroundReply("\x1b]11;rgb:ffff/ffff/ffff\x1b\\"),
    ).to.deep.equal([255, 255, 255]);
  });

  it("une à quatre chiffres par composante, et #rrggbb", () => {
    expect(parseBackgroundReply("\x1b]11;rgb:1e/1e/1e\x07")).to.deep.equal([
      30, 30, 30,
    ]);
    expect(parseBackgroundReply("\x1b]11;rgb:f/0/8\x07")).to.deep.equal([
      255, 0, 136,
    ]);
    expect(parseBackgroundReply("\x1b]11;#1e2a3b\x07")).to.deep.equal([
      30, 42, 59,
    ]);
  });

  it("autre chose qu'une réponse de fond : null", () => {
    expect(parseBackgroundReply("\x1b]10;rgb:ffff/ffff/ffff\x07")).to.equal(
      null,
    );
    expect(parseBackgroundReply("\x1b]11;rgb:zz/00/00\x07")).to.equal(null);
    expect(parseBackgroundReply("\x1b]11;rgb:1e1e/1e1e/1e1e")).to.equal(null);
    expect(BACKGROUND_QUERY).to.equal("\x1b]11;?\x07");
  });
});

describe("tabPalette — le voile sur le fond réel", () => {
  it("fond sombre, 24 bits : la barre un rien plus claire, l'actif en bleu de sélection", () => {
    expect(tabPalette([30, 30, 30], 24)).to.deep.equal({
      bar: "48;2;48;48;48",
      active: "48;2;32;57;84",
    });
  });

  it("fond clair, 24 bits : la barre un rien plus foncée, le bleu plus léger", () => {
    expect(tabPalette([255, 255, 255], 24)).to.deep.equal({
      bar: "48;2;240;240;240",
      active: "48;2;211;227;244",
    });
  });

  it("256 couleurs : la barre au gris le plus proche, l'actif au BLEU le plus proche — jamais un gris", () => {
    expect(tabPalette([30, 30, 30], 8)).to.deep.equal({
      bar: "48;5;236",
      active: "48;5;17",
    });
    expect(tabPalette([255, 255, 255], 8)).to.deep.equal({
      bar: "48;5;255",
      active: "48;5;189",
    });
  });

  it("fond inconnu ou 16 couleurs : aucun voile deviné", () => {
    expect(tabPalette(null, 24)).to.equal(null);
    expect(tabPalette([30, 30, 30], 4)).to.equal(null);
  });
});
