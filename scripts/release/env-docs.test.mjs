import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

/**
 * Les pages qui disent à un DÉPLOYEUR quelles variables poser — la page de
 * l'image sur Docker Hub, le guide Docker, le guide Kubernetes — confrontées
 * aux catalogues qui font foi.
 *
 * 🔴 Pourquoi ce test existe. Une application en production refuse de démarrer
 * sans `NF_CSRF_SECRET` ni `NF_JWT_KEYSET` (ADR-0014, #478). La page Docker Hub
 * a continué de promettre un `docker run` sans rien, et le Secret du guide
 * Kubernetes de les omettre : l'image suivante ne démarrait plus, et un pod
 * déployé selon le guide non plus. Rien ne le voyait, parce qu'aucune page ne se
 * confrontait au catalogue. Ce test le fait, dans les deux sens :
 *
 * - une variable CITÉE qui n'existe dans aucun catalogue — faute de frappe, ou
 *   variable retirée — enverrait le lecteur poser un réglage que rien ne lit ;
 * - une variable REQUISE en production que les pages taisent ferait refuser le
 *   démarrage d'un déploiement qui les a suivies à la lettre.
 */

const RACINE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const lire = (rel) =>
  fs.readFileSync(path.join(RACINE, ...rel.split("/")), "utf8");

const PAGES = [
  "docker/hub-overview.md",
  "docs/guides/docker-cloud-native.md",
  "docs/guides/kubernetes.md",
];

/** Le catalogue d'une APPLICATION générée : ses entrées, et leur bloc d'options. */
function catalogueApplication() {
  const source = lire("src/nodefony/templates/app/base/env.ts.tpl");
  const entrees = new Map();
  const motif = /^ {2}([A-Z][A-Z0-9_]*): env\w+\(/gmu;
  const debuts = [...source.matchAll(motif)];
  debuts.forEach((m, i) => {
    const fin = debuts[i + 1]?.index ?? source.length;
    entrees.set(m[1], source.slice(m.index, fin));
  });
  return entrees;
}

/** Les variables que le CODE du framework lit — généré, `.ai/env.json`. */
function catalogueFramework() {
  const { variables } = JSON.parse(lire(".ai/env.json"));
  return new Set(variables.map((v) => v.name));
}

/** Les variables `NF_X` citées (les surcharges `NF__MODULE__…` sont un mécanisme, pas un nom). */
function citees(texte) {
  return new Set(
    [...texte.matchAll(/\bNF_[A-Z0-9][A-Z0-9_]*\b/gu)].map((m) => m[0]),
  );
}

describe("pages de déploiement — confrontées aux catalogues de variables", () => {
  const appli = catalogueApplication();
  const framework = catalogueFramework();

  it("le catalogue de l'application se lit (garde du lecteur lui-même)", () => {
    // Sans ce contrôle, un gabarit réécrit autrement rendrait un catalogue VIDE
    // — et les deux tests suivants passeraient sans rien comparer.
    expect(appli.size).toBeGreaterThan(10);
    expect(appli.has("NF_CSRF_SECRET")).toBe(true);
    expect(framework.size).toBeGreaterThan(50);
  });

  it.each(PAGES)("%s ne cite que des variables qui existent", (page) => {
    const inconnues = [...citees(lire(page))].filter(
      (v) => !appli.has(v) && !framework.has(v),
    );
    expect(
      inconnues,
      `${page} cite des variables qu'aucun catalogue ne déclare`,
    ).toEqual([]);
  });

  it.each(PAGES)("%s cite chaque variable REQUISE en production", (page) => {
    const requises = [...appli]
      .filter(
        ([, bloc]) =>
          /requiredIn:\s*\[[^\]]*"production"/u.test(bloc) ||
          /requiredWhen:[^,]*production/u.test(bloc),
      )
      .map(([nom]) => nom);
    // Le constat qui a fait naître ce test : sans ces deux-là, refus de démarrer.
    expect(requises).toEqual(
      expect.arrayContaining(["NF_CSRF_SECRET", "NF_JWT_KEYSET"]),
    );
    const texte = lire(page);
    const tues = requises.filter((v) => !texte.includes(v));
    expect(
      tues,
      `${page} tait des variables sans lesquelles la production refuse de démarrer`,
    ).toEqual([]);
  });
});
