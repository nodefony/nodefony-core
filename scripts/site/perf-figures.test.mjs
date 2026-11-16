// Le registre des figures du dossier de performance : chaque nombre dessiné doit
// se retrouver dans le jeu publié, et une figure appelée sans données doit faire
// échouer la page au lieu d'y laisser un trou.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  figureSpecs,
  insertFigures,
  renderFigures,
  shareWithRange,
} from "../../.claude/skills/nodefony-load-test/scripts/perf-figures.mjs";
import { REPO_ROOT } from "../lib/repo-root.mjs";

const serie = (med) => ({ med, dispersionPct: 1 });
const camp = (a, b) => ({ med: (a + b) / 2, series: [serie(a), serie(b)] });

/** Un jeu minimal, aux nombres choisis pour se reconnaître dans les figures. */
const decor = () => ({
  comparison: {
    frameworks: {
      "express-fair": camp(20000, 20200),
      nodefony: camp(19000, 19400),
    },
    pairs: [
      {
        paire: "express-fair ↔ nodefony",
        rapportPct: 104.5,
        separation: "nette",
      },
      { paire: "nodefony ↔ nodefony", rapportPct: 99.1, role: "test nul" },
    ],
  },
  applicative: {
    rapportPct: 105,
    frameworks: {
      "express-fair-sqlite": camp(1000, 1010),
      "nodefony-orm": camp(1050, 1060),
    },
  },
  stages: {
    witness: "nest-fair-node",
    witnessUs: 36,
    rounds: 3,
    indicative: false,
    stages: [
      { stage: "entry", cumulUs: 23.6, stepUs: null },
      { stage: "context", cumulUs: 30.2, stepUs: 6.97 },
      { stage: "complet", cumulUs: 45.9, stepUs: 7.93 },
    ],
  },
  binary: {
    decor: { runs: 7 },
    results: [
      { camp: "grpc", bytes: 16, usPerMsg: 8.07, spreadPct: 2 },
      { camp: "grpc", bytes: 1024, usPerMsg: 13.07, spreadPct: 2 },
    ],
  },
});

describe("perf-figures — registre", () => {
  it("la part face à un témoin vaut l'inverse du rapport de la paire, bornée par les séries", () => {
    const fw = decor().comparison.frameworks;
    const r = shareWithRange(fw["express-fair"], fw.nodefony, 104.5);
    expect(r.med).toBe(95.7);
    // pire : plus lente série de Nodefony / plus rapide du témoin
    expect(r.min).toBe(Math.round((19000 / 20200) * 1000) / 10);
    expect(r.max).toBe(Math.round((19400 / 20000) * 1000) / 10);
  });

  it("la figure des parts reprend chaque paire face à Nodefony, sans le test nul", () => {
    const parts = figureSpecs(decor()).get("parts");
    const labels = parts.options.data.map((d) => d.label);
    expect(labels).toEqual([
      "Express équipé — route triviale",
      "Express équipé + Drizzle — lecture + écriture",
    ]);
    // Le cas ORM publie Nodefony / témoin : 105 % reste 105 %.
    expect(parts.options.data[1].med).toBe(105);
  });

  it("la cascade part du premier étage puis empile l'écart entre cumuls", () => {
    const c = figureSpecs(decor()).get("budget-etages");
    expect(c.options.postes.map((p) => p.delta)).toEqual([23.6, 6.6, 15.7]);
    expect(c.desc).toContain("total 45,9 µs, contre 36 µs");
  });

  it("le binaire trace un point par taille, à la valeur publiée", () => {
    const b = figureSpecs(decor()).get("binaire");
    expect(b.options.series[0].points).toEqual([
      ["16", 8.07],
      ["1024", 13.07],
    ]);
  });

  it("une pièce absente du jeu n'a pas de figure — et l'appeler fait échouer la page", () => {
    const figs = renderFigures(decor());
    expect(figs.has("ecart-node")).toBe(false);
    expect(() =>
      insertFigures("<p>a</p><!-- figure: ecart-node -->", figs, "analyses.md"),
    ).toThrow(/analyses\.md : figure « ecart-node »/);
  });

  it("une directive connue est remplacée par la figure dessinée, clair ET sombre", () => {
    const html = insertFigures(
      "<!-- figure: budget-etages -->",
      renderFigures(decor()),
    );
    expect(html).toContain('<figure class="graphe">');
    expect(html).toContain("g-clair");
    expect(html).toContain("g-sombre");
  });
});

describe("perf-figures — jeu publié", () => {
  const data = JSON.parse(
    readFileSync(
      path.join(REPO_ROOT, "docs/performance/data/10.0.0.json"),
      "utf8",
    ),
  );

  it("chaque part dessinée se retrouve dans une paire ou un cas publié", () => {
    const parts = figureSpecs(data).get("parts");
    if (!parts) return;
    const publies = [
      ...data.comparison.pairs.map((p) => Math.round(1e5 / p.rapportPct) / 10),
      data.applicative?.rapportPct,
      ...(data.applicative?.cases ?? []).map((c) => c.rapportPct),
      ...(data.applicativeNest?.cases ?? []).map((c) => c.rapportPct),
    ].map((v) => Math.round(v * 10) / 10);
    for (const d of parts.options.data) expect(publies).toContain(d.med);
  });

  it("la cascade des étages retombe sur le cumul publié du dernier étage", () => {
    const c = figureSpecs(data).get("budget-etages");
    if (!c) return;
    const somme = c.options.postes.reduce((s, p) => s + p.delta, 0);
    expect(somme).toBeCloseTo(data.stages.stages.at(-1).cumulUs, 1);
  });
});

describe("perf — chiffres écrits dans la prose", () => {
  const data = JSON.parse(
    readFileSync(
      path.join(REPO_ROOT, "docs/performance/data/10.0.0.json"),
      "utf8",
    ),
  );
  /** Les rapports publiés, au format où la prose les écrit (« 96,2 »). */
  const publies = new Set(
    [
      ...data.comparison.pairs.map((p) =>
        p.paire.endsWith("↔ nodefony") && !p.role
          ? 10000 / p.rapportPct
          : p.rapportPct,
      ),
      data.applicative?.rapportPct,
      data.applicative?.nul?.rapportPct,
      ...(data.applicative?.cases ?? []).map((c) => c.rapportPct),
      ...(data.applicativeNest?.cases ?? []).map((c) => c.rapportPct),
    ]
      .filter((v) => typeof v === "number")
      .map((v) => v.toFixed(1).replace(".", ",")),
  );
  /**
   * Les pourcentages des tableaux de RÉSULTATS d'une page — reconnus à leur
   * en-tête (« témoin », « Résultat »). Un tableau d'histoire (gains des lots
   * passés) porte des A/B que le jeu courant ne contient pas, et n'en relève pas.
   */
  const pourcentsDesTableaux = (page) => {
    const lignes = readFileSync(
      path.join(REPO_ROOT, "docs/performance", page),
      "utf8",
    ).split("\n");
    const blocs = [];
    for (const l of lignes) {
      if (!l.startsWith("|")) blocs.push([]);
      else (blocs.at(-1) ?? blocs[blocs.push([]) - 1]).push(l);
    }
    return blocs
      .filter((b) => b.length && /témoin|Résultat/i.test(b[0]))
      .flat()
      .flatMap((l) => [...l.matchAll(/(\d+,\d) %/g)].map((m) => m[1]));
  };

  for (const page of ["index.md", "analyses.md"])
    it(`${page} : chaque rapport d'un tableau se retrouve dans le jeu publié`, () => {
      const vus = pourcentsDesTableaux(page);
      expect(vus.length).toBeGreaterThan(0);
      for (const v of vus) expect(publies, `${page} : ${v} %`).toContain(v);
    });
});
