import { describe, it, expect } from "vitest";
import os from "node:os";
import path from "node:path";
import { writeFile, rm } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { chargerModule, fonctionDe } from "./browser-outils";

/** Rend unique le nom du module jetable, même si le test est rejoué en parallèle. */
let counterFichier = 0;

/**
 * Ce que ces tests prouvent : les calculs WCAG des sondes navigateur rendent
 * les valeurs de la norme — et leur source reste INJECTABLE telle quelle dans
 * une page.
 *
 * Le second point est le piège réel : ces fonctions voyagent vers le
 * navigateur par leur code source (`String(fn)`), où une fermeture sur le
 * module ne survivrait pas. Le test « injection » évalue la source dans une
 * portée isolée et compare aux appels directs : le jour où quelqu'un y
 * introduit une dépendance de module, c'est ICI que ça casse — pas dans le
 * navigateur, où personne ne lit.
 */
const wcag = await chargerModule(
  "../skills/nodefony-browser/scripts/lib/wcag.mjs",
);
const srgbLuminance = fonctionDe<(c: string) => number>(wcag, "srgbLuminance");
const contrastRatio = fonctionDe<(a: string, b: string) => number>(
  wcag,
  "contrastRatio",
);
const isLargeText = fonctionDe<(px: number, gras: boolean) => boolean>(
  wcag,
  "isLargeText",
);
const verdictWcag = fonctionDe<
  (ratio: number, px: number, gras: boolean) => string
>(wcag, "verdictWcag");
const sourceWcag = fonctionDe<() => string>(wcag, "sourceWcag");

const parseColor = fonctionDe<
  (c: string) => { r: number; g: number; b: number; a: number }
>(wcag, "parseColor");

/**
 * L'HEXADÉCIMAL — la notation que tout auteur de CSS écrit, et que ces
 * fonctions recevaient en rendant du NOIR.
 *
 * `getComputedStyle` ne rend jamais d'hexadécimal, ce qui a laissé le trou
 * invisible côté sondes. Mais ce module est PUBLIÉ dans le devkit : quiconque
 * veut vérifier une palette avant de l'écrire appelle `contrastRatio` avec ses
 * propres couleurs, donc en `#rrggbb`. Il obtenait alors 1.24 au lieu de 4.68,
 * sans un mot — un verdict faux, qui est pire qu'une absence de verdict.
 */
describe("wcag — l'hexadécimal, notation de l'auteur", () => {
  it("lit #rrggbb", () => {
    expect(parseColor("#149eca")).toEqual({ r: 20, g: 158, b: 202, a: 1 });
  });

  it("lit la forme courte #rgb en doublant chaque quartet", () => {
    expect(parseColor("#0af")).toEqual({ r: 0, g: 170, b: 255, a: 1 });
  });

  it("lit l'alpha des formes #rrggbbaa et #rgba", () => {
    expect(parseColor("#00000080").a).toBeCloseTo(0.502, 3);
    expect(parseColor("#0008").a).toBeCloseTo(0.533, 3);
  });

  it("ignore la casse", () => {
    expect(parseColor("#FFFFFF")).toEqual(parseColor("#ffffff"));
  });

  it("rend le MÊME contraste qu'en notation rgb() — sinon un verdict est faux", () => {
    expect(contrastRatio("#ffffff", "#000000")).toBe(21);
    expect(contrastRatio("#149eca", "#0e1f23")).toBe(
      contrastRatio("rgb(20, 158, 202)", "rgb(14, 31, 35)"),
    );
  });

  it("REFUSE une notation illisible au lieu de rendre du noir", () => {
    // Rendre `{0,0,0}` sur une entrée incomprise fabrique un contraste
    // plausible et faux. Une mesure qu'on ne peut pas faire se DIT.
    expect(() => parseColor("papayawhip")).toThrow(/papayawhip/u);
    expect(() => parseColor("")).toThrow();
    expect(() => contrastRatio("#149eca", "chartreuse")).toThrow();
  });
});

describe("wcag — luminance et contraste", () => {
  it("noir sur blanc rend 21, la borne haute de la norme", () => {
    expect(contrastRatio("rgb(255, 255, 255)", "rgb(0, 0, 0)")).toBe(21);
  });

  it("deux couleurs identiques rendent 1, la borne basse", () => {
    expect(contrastRatio("rgb(120, 30, 200)", "rgb(120, 30, 200)")).toBe(1);
  });

  it("l'ordre des couleurs est indifférent", () => {
    expect(contrastRatio("rgb(0, 87, 156)", "rgb(255, 255, 255)")).toBe(
      contrastRatio("rgb(255, 255, 255)", "rgb(0, 87, 156)"),
    );
  });

  it("le gris #767676 sur blanc rend ~4,54 — la frontière AA du web", () => {
    // Valeur de référence connue des audits : c'est le gris « juste conforme ».
    const ratio = contrastRatio("rgb(118, 118, 118)", "rgb(255, 255, 255)");
    expect(ratio).toBeGreaterThan(4.5);
    expect(ratio).toBeLessThan(4.6);
  });

  // `transparent` n'est pas une notation ILLISIBLE : c'est une valeur CSS
  // définie (`rgba(0, 0, 0, 0)`), et un fond non peint est un cas courant. Elle
  // se lit donc, et sa luminance vaut 0 — l'alpha étant ignoré à ce stade, par
  // construction : une couche translucide doit avoir été composée AVANT.
  it("`transparent` se lit comme du noir à alpha nul, et ne rend jamais NaN", () => {
    expect(parseColor("transparent")).toEqual({ r: 0, g: 0, b: 0, a: 0 });
    expect(srgbLuminance("transparent")).toBe(0);
    expect(Number.isNaN(contrastRatio("transparent", "rgb(0,0,0)"))).toBe(
      false,
    );
  });
});

describe("wcag — le seuil dépend de la POLICE", () => {
  it("24 px est large, 23,9 px ne l'est pas", () => {
    expect(isLargeText(24, false)).toBe(true);
    expect(isLargeText(23.9, false)).toBe(false);
  });

  it("18,66 px n'est large QU'EN gras", () => {
    expect(isLargeText(18.66, true)).toBe(true);
    expect(isLargeText(18.66, false)).toBe(false);
    expect(isLargeText(18.5, true)).toBe(false);
  });
});

describe("wcag — verdict aux frontières exactes", () => {
  it("texte normal : 7 = AAA, 6,99 = AA, 4,5 = AA, 4,49 = ÉCHEC", () => {
    expect(verdictWcag(7, 16, false)).toBe("AAA");
    expect(verdictWcag(6.99, 16, false)).toBe("AA");
    expect(verdictWcag(4.5, 16, false)).toBe("AA");
    expect(verdictWcag(4.49, 16, false)).toBe("ÉCHEC");
  });

  it("texte large : 4,5 = AAA, 3 = AA, 2,99 = ÉCHEC", () => {
    expect(verdictWcag(4.5, 24, false)).toBe("AAA");
    expect(verdictWcag(3, 24, false)).toBe("AA");
    expect(verdictWcag(2.99, 24, false)).toBe("ÉCHEC");
  });

  it("sens négatif : un contraste nul ÉCHOUE quelle que soit la police", () => {
    expect(verdictWcag(1, 16, false)).toBe("ÉCHEC");
    expect(verdictWcag(1, 48, true)).toBe("ÉCHEC");
  });
});

describe("wcag — la source injectée est AUTOSUFFISANTE", () => {
  it("évaluée dans une portée isolée, elle rend les mêmes valeurs", async () => {
    // Reconstitue ce que fait la sonde : évaluer la source dans une portée qui
    // n'a PAS accès au module d'origine. Une fermeture introduite un jour dans
    // wcag.mjs casserait ce test — au lieu de casser en silence dans la page.
    //
    // Le passage par un fichier module plutôt que par une évaluation de chaîne
    // n'est pas qu'une concession au linter : c'est une isolation PLUS FIDÈLE.
    // Un module a sa propre portée de niveau supérieur, exactement comme le
    // contexte de la page — là où une chaîne évaluée hérite encore de ce qui
    // l'entoure, et laisserait passer une dépendance que la page refuserait.
    const fichier = path.join(
      os.tmpdir(),
      `nf-wcag-${process.pid}-${counterFichier++}.mjs`,
    );
    await writeFile(
      fichier,
      `${sourceWcag()}\nexport { srgbLuminance, contrastRatio, isLargeText, verdictWcag };\n`,
      "utf8",
    );
    let injecte: Record<string, unknown>;
    try {
      // `pathToFileURL` et non le chemin nu : sous Windows, `D:\…` ferait lire
      // `d:` comme un protocole et l'import échouerait.
      injecte = (await import(pathToFileURL(fichier).href)) as Record<
        string,
        unknown
      >;
    } finally {
      await rm(fichier, { force: true });
    }
    const contrasteInjecte = fonctionDe<(a: string, b: string) => number>(
      injecte,
      "contrastRatio",
    );
    const verdictInjecte = fonctionDe<
      (ratio: number, px: number, gras: boolean) => string
    >(injecte, "verdictWcag");
    expect(contrasteInjecte("rgb(255, 255, 255)", "rgb(0, 0, 0)")).toBe(
      contrastRatio("rgb(255, 255, 255)", "rgb(0, 0, 0)"),
    );
    expect(contrasteInjecte("rgb(118, 118, 118)", "rgb(255, 255, 255)")).toBe(
      contrastRatio("rgb(118, 118, 118)", "rgb(255, 255, 255)"),
    );
    expect(verdictInjecte(4.49, 16, false)).toBe("ÉCHEC");
    expect(verdictInjecte(4.5, 24, false)).toBe("AAA");
  });
});
