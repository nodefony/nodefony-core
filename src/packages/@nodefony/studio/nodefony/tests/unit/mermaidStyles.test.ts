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
import type { MantineColorsTuple } from "@mantine/core";
import {
  diagramThemeVariables,
  fromStyleTemplate,
  splitSvgStyles,
  toStyleTemplate,
} from "../../../frontend/src/components/ui/mermaidStyles";

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

  it("une balise reconstituée par le retrait est retirée à son tour (CodeQL #273)", () => {
    const { svg, css } = splitSvgStyles(
      "<svg><sty<style>.a{}</style>le>.b{}</style><g/></svg>",
    );
    expect(svg).toBe("<svg><g/></svg>");
    expect(svg).not.toMatch(/<style/i);
    expect(css).toBe(".a{}.b{}");
  });
});

describe("patron de feuille par thème", () => {
  it("la feuille d'un schéma se rejoue pour un autre id, et pour lui seul", () => {
    const { css } = splitSvgStyles(RENDU);
    const patron = toStyleTemplate(css, "mermaid-r1-1");
    expect(patron).not.toContain("mermaid-r1-1");
    const suivant = fromStyleTemplate(patron, "mermaid-r9-42");
    expect(suivant).toBe(css.replaceAll("mermaid-r1-1", "mermaid-r9-42"));
    expect(suivant).not.toContain("mermaid-r1-1");
  });
});

describe("diagramThemeVariables — couleurs de la console, jamais celles de mermaid", () => {
  /** Dix teintes distinctes par nuancier : chaque couleur rendue doit en venir. */
  const t = (p: string, i: number): string => `#${p}${i}${i}${i}${i}`;
  const teintes = (p: string): MantineColorsTuple => [
    t(p, 0),
    t(p, 1),
    t(p, 2),
    t(p, 3),
    t(p, 4),
    t(p, 5),
    t(p, 6),
    t(p, 7),
    t(p, 8),
    t(p, 9),
  ];
  const palette = {
    brand: teintes("a"),
    gray: teintes("b"),
    dark: teintes("c"),
    black: "#000001",
    white: "#fffffe",
    fontFamily: "Inter, sans-serif",
  };
  const permises = new Set([
    ...palette.brand,
    ...palette.gray,
    ...palette.dark,
    palette.black,
    palette.white,
  ]);

  for (const scheme of ["light", "dark"] as const) {
    it(`${scheme} : toute couleur vient de la palette Studio`, () => {
      const vars = diagramThemeVariables(scheme, palette);
      const couleurs = Object.entries(vars).filter(
        ([, v]) => typeof v === "string" && v.startsWith("#"),
      );
      expect(couleurs.length).toBeGreaterThan(10);
      for (const [cle, v] of couleurs) expect(permises, cle).toContain(v);
      expect(vars.darkMode).toBe(scheme === "dark");
      expect(vars.dropShadow).toBe("none");
      expect(vars.fontFamily).toBe(palette.fontFamily);
    });
  }
});
