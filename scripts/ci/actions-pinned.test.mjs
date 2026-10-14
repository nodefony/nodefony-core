/**
 * Gate — toute action GitHub tierce est épinglée par SHA de commit.
 *
 * Un tag (`@v7`) se DÉPLACE : qui contrôle le dépôt de l'action — ou qui l'a
 * détourné — republie sous le même tag, et le job suivant exécute son code avec
 * nos jetons. Vécu dans l'écosystème (tj-actions/changed-files, mars 2025 ;
 * vagues « Shai-Hulud » sur npm) : le détournement d'un tag publie même avec une
 * provenance Sigstore VALIDE. Un SHA ne bouge pas.
 *
 * Le gate couvre ce que le DÉPÔT exécute (`.github/`) et ce que chaque
 * APPLICATION GÉNÉRÉE exécutera (gabarits de workflow + actions d'installation
 * des gestionnaires de paquets) — la seconde surface voyage chez les
 * utilisateurs, c'est la plus importante.
 *
 * Forme exigée : `owner/repo[/chemin]@<sha 40> # vX.Y.Z` — le commentaire est ce
 * que Dependabot relit pour proposer la montée ; sans lui, l'épinglage gèle.
 */
import { describe, expect, it } from "vitest";
import {
  deliveredDrifts,
  forgePins,
  packageManagerReferences,
  PIN as EPINGLE,
  references,
  yamlUnder as yamlSous,
} from "./action-pins.mjs";

/** Une référence locale ou rendue par le gabarit n'est pas une action tierce. */
const horsGate = (ref) => ref.startsWith("./") || ref.startsWith("<%=");

describe("actions GitHub épinglées par SHA", () => {
  const fichiers = [
    ...yamlSous(".github/workflows"),
    ...yamlSous(".github/actions"),
    ...yamlSous("src/nodefony/templates"),
  ];

  it("le gate voit bien des workflows (sinon il est vert pour rien)", () => {
    const n = fichiers.flatMap(references).filter((r) => !horsGate(r.ref));
    expect(n.length).toBeGreaterThan(20);
  });

  it("une balise de gabarit en tête de ligne ne cache pas l'action", () => {
    // `<% } %>      - uses: actions/setup-node@…` : seule forme de setup-node
    // dans les gabarits — le gate l'a longtemps sautée sans le dire.
    const rendues = yamlSous("src/nodefony/templates")
      .flatMap(references)
      .map((r) => r.ref);
    expect(rendues.some((r) => r.startsWith("actions/setup-node@"))).toBe(true);
  });

  it("aucune action tierce n'est référencée par un tag mobile", () => {
    const fautes = fichiers
      .flatMap(references)
      .filter((r) => !horsGate(r.ref) && !EPINGLE.test(r.ref))
      .map((r) => `${r.at} → ${r.ref}`);
    expect(fautes).toEqual([]);
  });

  it("les actions des gestionnaires de paquets (rendues dans l'app) aussi", () => {
    const uses = packageManagerReferences().map((r) => r.ref);
    expect(uses.length).toBeGreaterThanOrEqual(2);
    expect(uses.filter((u) => !EPINGLE.test(u))).toEqual([]);
  });

  it("les gabarits suivent le SHA du dépôt (Dependabot ne voit pas les .tpl)", () => {
    // Dependabot monte les workflows de la forge ; les gabarits et
    // `packageManager.ts` lui échappent. Sans cette parité, les applications
    // générées resteraient sur l'ancien SHA en silence.
    const { pins, conflicts } = forgePins();
    expect(conflicts).toEqual([]);
    const ecarts = deliveredDrifts(pins).map(
      (d) =>
        `${d.at} → ${d.pin.action} ${d.pin.version} (forge : ${d.forge.version})`,
    );
    expect(
      ecarts,
      "recopier la forge : node scripts/ci/action-pins.mjs --write",
    ).toEqual([]);
  });

  it("la forme refuse un tag, un SHA court et l'absence de version", () => {
    for (const r of [
      "actions/checkout@v7",
      "actions/checkout@3d3c42e",
      "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
    ])
      expect(EPINGLE.test(r), r).toBe(false);
    expect(
      EPINGLE.test(
        "github/codeql-action/init@2892aa5e19bbd11bc0cff5427e3b750a04d9e3c2 # v4.38.2",
      ),
    ).toBe(true);
  });
});
