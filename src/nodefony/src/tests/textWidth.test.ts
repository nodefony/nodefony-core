/**
 * Largeur visible en colonnes (`runtime/textWidth.ts`) : la règle unique de
 * la barre d'état, du repli à la largeur et du curseur de l'invite.
 */
import { describe, it, expect } from "vitest";
import {
  fitToWidth,
  graphemeWidth,
  visibleWidth,
  wrapToWidth,
} from "../runtime/textWidth";
import { fitStatus } from "../service/dev/statusLine";

describe("visibleWidth", () => {
  it("compte les colonnes : large à 2, combinant à 0, contrôle à 0", () => {
    // ⚠ (sans VS16) 1 · espace 1 · 漢字 4 · espace 1 · 👍🏽 2
    expect(visibleWidth("⚠ 漢字 👍🏽")).to.equal(9);
    expect(visibleWidth("⚠️")).to.equal(2);
    expect(visibleWidth("é")).to.equal(1);
    expect(visibleWidth("🇫🇷")).to.equal(2);
    expect(visibleWidth("👨‍👩‍👧")).to.equal(2);
    expect(visibleWidth("ｈｅｌｌｏ")).to.equal(10);
    expect(visibleWidth("")).to.equal(0);
  });

  it("exclut couleurs, hyperliens OSC 8 et échappements tronqués", () => {
    expect(visibleWidth("\x1b[1;31mrouge\x1b[0m")).to.equal(5);
    const link = "\x1b]8;;https://example.com\x1b\\lien\x1b]8;;\x1b\\";
    expect(visibleWidth(link)).to.equal(4);
    expect(visibleWidth("\x1b]8;;file:///x\x07ok\x1b]8;;\x07")).to.equal(2);
    expect(visibleWidth("a\x1b")).to.equal(1);
  });

  it("graphemeWidth rend 0, 1 ou 2", () => {
    expect(graphemeWidth("a")).to.equal(1);
    expect(graphemeWidth("́")).to.equal(0);
    expect(graphemeWidth("‍")).to.equal(0);
    expect(graphemeWidth("字")).to.equal(2);
    expect(graphemeWidth("🔥")).to.equal(2);
  });
});

describe("fitToWidth", () => {
  it("ne coupe jamais un caractère large en deux, et ne dépasse jamais", () => {
    const fitted = fitToWidth("漢字漢字漢字", 6);
    expect(visibleWidth(fitted)).to.be.at.most(6);
    expect(fitted.startsWith("漢字")).to.equal(true);
    expect(fitted).to.match(/…\x1b\[0m$/);
  });

  it("rend le texte tel quel quand il tient", () => {
    expect(fitToWidth("\x1b[32mok\x1b[0m", 2)).to.equal("\x1b[32mok\x1b[0m");
  });
});

describe("fitStatus — en colonnes, plus en unités de code", () => {
  it("une ligne d'idéogrammes tient dans columns - 1 colonnes", () => {
    // Un idéogramme = 1 unité de code, 2 colonnes : compter les unités
    // laisserait passer 38 idéogrammes, soit 76 colonnes sur 40.
    const fitted = fitStatus("漢字".repeat(40), 40);
    expect(visibleWidth(fitted)).to.be.at.most(39);
    expect(visibleWidth(fitted)).to.be.at.least(37);
  });

  it("une ligne d'émojis aussi", () => {
    const fitted = fitStatus("👍🏽".repeat(40), 40);
    expect(visibleWidth(fitted)).to.be.at.most(39);
  });
});

describe("wrapToWidth", () => {
  it("replie sans dépasser, sans couper un graphème", () => {
    const lines = wrapToWidth("ab漢字cd👍🏽e", 3);
    for (const l of lines) expect(visibleWidth(l)).to.be.at.most(3);
    expect(lines.join("").replace(/\x1b\[[0-9;]*m/g, "")).to.equal(
      "ab漢字cd👍🏽e",
    );
  });

  it("referme la couleur en fin de ligne et la rouvre en tête de la suivante", () => {
    const lines = wrapToWidth("\x1b[31mabcdef\x1b[0m", 3);
    expect(lines).to.deep.equal(["\x1b[31mabc\x1b[0m", "\x1b[31mdef\x1b[0m"]);
  });

  it("une ligne vide reste une ligne", () => {
    expect(wrapToWidth("", 10)).to.deep.equal([""]);
  });
});
