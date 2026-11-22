/**
 * Unit — feuille d'un schéma mermaid séparée de son SVG
 * (`frontend/src/components/ui/mermaidStyles.ts`).
 *
 * Sous `style-src 'nonce-…'`, le `<style>` que mermaid embarque dans son SVG est
 * bloqué et le schéma s'affiche en pavés noirs. Le SVG posé dans la page ne doit
 * donc plus porter AUCUNE balise `<style>`, et sa feuille doit revenir intacte
 * pour être adoptée par `adoptStyles`.
 */
import { describe, it, expect } from "vitest";
import { splitSvgStyles } from "../../../frontend/src/components/ui/mermaidStyles";

/** Forme d'un rendu mermaid : feuille préfixée par l'id du schéma, puis le dessin. */
const RENDU =
  '<svg id="mermaid-r1-1" width="100%" xmlns="http://www.w3.org/2000/svg">' +
  "<style>#mermaid-r1-1{font-family:inherit;fill:#333;}#mermaid-r1-1 .node rect{fill:#ECECFF;stroke:#9370DB;}</style>" +
  '<g><g class="node"><rect width="70" height="70"></rect></g></g></svg>';

describe("splitSvgStyles", () => {
  it("retire la balise <style> du SVG posé dans la page", () => {
    const { svg } = splitSvgStyles(RENDU);
    expect(svg).not.toMatch(/<style/i);
    expect(svg).toBe(
      '<svg id="mermaid-r1-1" width="100%" xmlns="http://www.w3.org/2000/svg">' +
        '<g><g class="node"><rect width="70" height="70"></rect></g></g></svg>',
    );
  });

  it("rend la feuille intacte, préfixée par l'id du schéma", () => {
    const { css } = splitSvgStyles(RENDU);
    expect(css).toBe(
      "#mermaid-r1-1{font-family:inherit;fill:#333;}#mermaid-r1-1 .node rect{fill:#ECECFF;stroke:#9370DB;}",
    );
  });

  it("concatène plusieurs feuilles et accepte des attributs sur la balise", () => {
    const { svg, css } = splitSvgStyles(
      '<svg><style type="text/css">a{}</style><g/><STYLE>b{}</STYLE></svg>',
    );
    expect(svg).toBe("<svg><g/></svg>");
    expect(css).toBe("a{}b{}");
  });

  it("SVG sans feuille → inchangé, feuille vide", () => {
    const { svg, css } = splitSvgStyles("<svg><g/></svg>");
    expect(svg).toBe("<svg><g/></svg>");
    expect(css).toBe("");
  });
});
