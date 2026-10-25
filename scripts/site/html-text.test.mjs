import { describe, expect, it } from "vitest";
import { anchorHeadings, headingText } from "./lib/html-text.mjs";

describe("anchorHeadings", () => {
  it("ancre tous les niveaux qu'accepte anchor-inpage, h4 compris", () => {
    const html = anchorHeadings("<h4>Faut-il l’activer ?</h4><h6>Fin</h6>");
    expect(html).toBe(
      '<h4 id="faut-il-lactiver-">Faut-il l’activer ?</h4><h6 id="fin">Fin</h6>',
    );
  });

  it("ne met au sommaire que les h2 et h3", () => {
    const toc = [];
    anchorHeadings("<h2>Un</h2><h3>Deux</h3><h4>Trois</h4>", { toc });
    expect(toc.map((t) => t.text)).toEqual(["Un", "Deux"]);
  });

  it("n'ajoute le lien « # » que sur demande", () => {
    expect(anchorHeadings("<h2>Un</h2>")).not.toContain("h-anchor");
    expect(anchorHeadings("<h2>Un</h2>", { selfLink: true })).toContain(
      'href="#un"',
    );
  });

  it("tire le slug du texte décodé, pas des entités", () => {
    expect(headingText("<code>mode: &quot;first&quot;</code>")).toBe(
      'mode: "first"',
    );
  });
});
