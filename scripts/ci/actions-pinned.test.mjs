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
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");
const EPINGLE = /^[\w.-]+\/[\w./-]+@[0-9a-f]{40} # v\d+(\.\d+){0,2}$/;

/** Fichiers YAML (et gabarits YAML) sous `dir`, récursivement. */
function yamlSous(dir) {
  return readdirSync(path.join(ROOT, dir), {
    recursive: true,
    withFileTypes: true,
  })
    .filter((e) => e.isFile() && /\.ya?ml(\.tpl)?$/.test(e.name))
    .map((e) => path.join(e.parentPath, e.name));
}

/** Chaque référence `uses:` d'un fichier, avec sa ligne. */
function references(fichier) {
  const out = [];
  readFileSync(fichier, "utf8")
    .split("\n")
    .forEach((ligne, i) => {
      const m = /^\s*-?\s*uses:\s*(.+?)\s*$/.exec(ligne);
      if (m)
        out.push({ ou: `${path.relative(ROOT, fichier)}:${i + 1}`, ref: m[1] });
    });
  return out;
}

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

  it("aucune action tierce n'est référencée par un tag mobile", () => {
    const fautes = fichiers
      .flatMap(references)
      .filter((r) => !horsGate(r.ref) && !EPINGLE.test(r.ref))
      .map((r) => `${r.ou} → ${r.ref}`);
    expect(fautes).toEqual([]);
  });

  it("les actions des gestionnaires de paquets (rendues dans l'app) aussi", () => {
    const source = readFileSync(
      path.join(ROOT, "src/nodefony/src/cli/packageManager.ts"),
      "utf8",
    );
    const uses = [...source.matchAll(/uses:\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(uses.length).toBeGreaterThanOrEqual(2);
    expect(uses.filter((u) => !EPINGLE.test(u))).toEqual([]);
  });

  it("les gabarits suivent le SHA du dépôt (Dependabot ne voit pas les .tpl)", () => {
    // Dependabot monte les workflows de la forge ; les gabarits et
    // `packageManager.ts` lui échappent. Sans cette parité, les applications
    // générées resteraient sur l'ancien SHA en silence.
    const shaDe = (ref) => {
      const [action, reste] = ref.split("@");
      return [action.split("/").slice(0, 2).join("/"), reste.slice(0, 40)];
    };
    const forge = new Map(
      [...yamlSous(".github/workflows"), ...yamlSous(".github/actions")]
        .flatMap(references)
        .filter((r) => EPINGLE.test(r.ref))
        .map((r) => shaDe(r.ref)),
    );
    const source = readFileSync(
      path.join(ROOT, "src/nodefony/src/cli/packageManager.ts"),
      "utf8",
    );
    const livrees = [
      ...yamlSous("src/nodefony/templates")
        .flatMap(references)
        .filter((r) => EPINGLE.test(r.ref)),
      ...[...source.matchAll(/uses:\s*"([^"]+)"/g)].map((m) => ({
        ou: "packageManager.ts",
        ref: m[1],
      })),
    ];
    const ecarts = [];
    for (const { ou, ref } of livrees) {
      const [a, sha] = shaDe(ref);
      if (forge.has(a) && forge.get(a) !== sha)
        ecarts.push(`${ou} → ${a} (forge : ${forge.get(a)})`);
    }
    expect(ecarts).toEqual([]);
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
