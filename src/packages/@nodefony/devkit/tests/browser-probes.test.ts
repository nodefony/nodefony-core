import { describe, it, expect } from "vitest";
import { chargerModule, fonctionDe } from "./browser-outils";

/**
 * Ce que ces tests prouvent : la grammaire de la ligne de commande des sondes
 * REFUSE ce qui doit l'être — une famille inconnue, une sonde malformée, une
 * largeur absurde — au lieu de l'avaler.
 *
 * Le cas « toString » n'est pas un caprice : une allowlist interrogée par `in`
 * accepte toute propriété héritée du prototype, et une « famille » toString
 * passerait sans exister. Le test tient l'implémentation à `Object.hasOwn`.
 */
const probes = await chargerModule(
  "../skills/nodefony-browser/scripts/lib/probes.mjs",
);

interface IParseFamilies {
  retenues: string[];
  inconnues: string[];
}
interface IParseProbes {
  sondes: { label: string; sel: string }[];
  rejetees: string[];
}
interface IParseWidths {
  largeurs: number[];
  invalides: string[];
}

const FAMILLES = probes["FAMILLES"] as Record<string, string>;
const parseFamilies = fonctionDe<
  (brut: string | undefined, defaut?: string[]) => IParseFamilies
>(probes, "parseFamilies");
const parseProbes = fonctionDe<(brut: string | undefined) => IParseProbes>(
  probes,
  "parseProbes",
);
const parseWidths = fonctionDe<(brut: string | undefined) => IParseWidths>(
  probes,
  "parseWidths",
);
const verdictGlobal = fonctionDe<(verdicts: string[]) => string>(
  probes,
  "verdictGlobal",
);
const mediane = fonctionDe<(valeurs: number[]) => number | null>(
  probes,
  "mediane",
);

describe("parseFamilies — l'allowlist", () => {
  it("retient les familles connues, dans l'ordre demandé", () => {
    expect(parseFamilies("a11y, perf")).toEqual({
      retenues: ["a11y", "perf"],
      inconnues: [],
    });
  });

  it("« toutes » déplie l'allowlist entière", () => {
    expect(parseFamilies("toutes").retenues).toEqual(Object.keys(FAMILLES));
  });

  it("vide rend le défaut, sans invention", () => {
    expect(parseFamilies(undefined, ["rendu"]).retenues).toEqual(["rendu"]);
    expect(parseFamilies("", []).retenues).toEqual([]);
  });

  it("sens négatif : une famille inconnue est RENDUE, jamais avalée", () => {
    const r = parseFamilies("a11y,inexistante");
    expect(r.retenues).toEqual(["a11y"]);
    expect(r.inconnues).toEqual(["inexistante"]);
  });

  it("sens négatif : « toString » n'est PAS une famille (piège du prototype)", () => {
    expect(parseFamilies("toString").inconnues).toEqual(["toString"]);
  });

  it("dédoublonne", () => {
    expect(parseFamilies("perf,perf").retenues).toEqual(["perf"]);
  });
});

describe("parseProbes — libellé=sélecteur", () => {
  it("découpe les entrées bien formées", () => {
    expect(parseProbes("titre=h1, bouton=button[type=submit]")).toEqual({
      sondes: [
        { label: "titre", sel: "h1" },
        { label: "bouton", sel: "button[type=submit]" },
      ],
      rejetees: [],
    });
  });

  it("sens négatif : une entrée malformée est RENDUE, jamais avalée", () => {
    const r = parseProbes("sansEgal,=h1,ok=body");
    expect(r.sondes).toEqual([{ label: "ok", sel: "body" }]);
    expect(r.rejetees).toEqual(["sansEgal", "=h1"]);
  });

  it("vide rend vide", () => {
    expect(parseProbes(undefined)).toEqual({ sondes: [], rejetees: [] });
  });
});

describe("parseWidths — largeurs d'écran", () => {
  it("retient des entiers plausibles, dédoublonnés", () => {
    expect(parseWidths("360,768,360")).toEqual({
      largeurs: [360, 768],
      invalides: [],
    });
  });

  it("sens négatif : zéro, négatif, texte et hors bornes sont RENDUS invalides", () => {
    const r = parseWidths("0,-5,abc,10000,240,4000");
    expect(r.largeurs).toEqual([240, 4000]);
    expect(r.invalides).toEqual(["0", "-5", "abc", "10000"]);
  });
});

describe("verdictGlobal — l'agrégat n'efface jamais une alerte", () => {
  it("OK seulement si tout est OK", () => {
    expect(verdictGlobal(["OK", "OK"])).toBe("OK");
  });

  it("sens négatif : une seule ALERTE suffit à basculer", () => {
    expect(verdictGlobal(["OK", "ALERTE", "OK"])).toBe("ALERTE");
  });

  it("un verdict non-OK inconnu bascule aussi — le doute n'est pas un OK", () => {
    expect(verdictGlobal(["OK", "REFUSÉ"])).toBe("ALERTE");
  });
});

describe("mediane — la statistique d'un RTT", () => {
  it("série vide rend null, jamais un zéro inventé", () => {
    expect(mediane([])).toBeNull();
  });

  it("impaire : l'élément central ; paire : la moyenne des deux centraux", () => {
    expect(mediane([3, 1, 2])).toBe(2);
    expect(mediane([4, 1, 3, 2])).toBe(2.5);
  });

  it("sens négatif : un aberrant ne déplace PAS la médiane (c'est son intérêt)", () => {
    expect(mediane([2, 3, 2, 3, 5000])).toBe(3);
  });

  it("ne mute pas la série d'entrée", () => {
    const serie = [3, 1, 2];
    mediane(serie);
    expect(serie).toEqual([3, 1, 2]);
  });
});
