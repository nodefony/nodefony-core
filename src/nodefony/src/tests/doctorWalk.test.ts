/**
 * 🔴 UNE règle d'exclusion, pour les quatre contrôles qui parcourent le projet.
 *
 * Elle était écrite quatre fois, et avait déjà divergé : ce que la surface
 * sautait depuis toujours, la fraîcheur du build le comptait — écrire un test
 * réclamait un `npm run build`. Aucun test ne comparait les quatre listes, et
 * rien n'aurait signalé la divergence suivante.
 *
 * Ce que ces cas protègent : le même décor piégé, présenté aux quatre
 * contrôles, doit donner le même verdict d'inventaire.
 */
import { describe, it, beforeEach, afterEach } from "vitest";
import { assert } from "chai";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  collectSources,
  isSkippedDir,
  isTestFile,
  SKIPPED_DIRS,
} from "../kernel/checks/walk";
import { checkSurface } from "../kernel/checks/surface";
import { checkWiring } from "../kernel/checks/wiring";
import { checkPackageDeps } from "../kernel/checks/packageDeps";
import { checkFreshness } from "../kernel/checks/freshness";

let racine = "";

/**
 * Une classe que TROIS contrôles reconnaissent : `@injectable` la rend visible
 * du câblage, sa présence dans un fichier de source la rend visible de la
 * surface, et son import fait travailler le contrôle des dépendances. Le même
 * contenu partout, pour que seul le CHEMIN décide.
 */
const CLASSE = (nom: string): string =>
  `import { injectable } from "nodefony";\n@injectable()\nexport class ${nom} {}\n`;

/** Écrit un fichier, dossiers parents compris, et rend son chemin absolu. */
const poser = (relatif: string, contenu = "export const a = 1;"): string => {
  const cible = path.join(racine, ...relatif.split("/"));
  mkdirSync(path.dirname(cible), { recursive: true });
  writeFileSync(cible, contenu, "utf8");
  return cible;
};

/**
 * Un projet dont UNE SEULE source compte — tout le reste est un piège, posé
 * dans un dossier ou sous un nom que chaque contrôle prétendait déjà sauter.
 */
const projetPiege = (): void => {
  poser(
    "package.json",
    '{"name":"piege","version":"1.0.0","dependencies":{"nodefony":"*"}}',
  );
  // `checkWiring` n'entre que dans une CIBLE — un dossier qui porte
  // `nodefony/service` (ou entity/controllers). Sans quoi il passe son chemin,
  // et le décor mesurerait son abstention plutôt que son parcours.
  poser(
    "nodefony/service/Widget.ts",
    `${CLASSE("Widget")}// @services([Widget])`,
  );
  for (const piege of [
    "nodefony/service/Widget.test.ts",
    "nodefony/service/Widget.spec.ts",
    "nodefony/service/tests/Helper.ts",
    "nodefony/service/__tests__/Autre.ts",
    "nodefony/tmp/Brouillon.ts",
    "src/var/Cache.ts",
    "dist/Built.ts",
    "coverage/Rapport.ts",
    ".turbo/Trace.ts",
    "node_modules/paquet/Index.ts",
  ]) {
    poser(piege, CLASSE("Piege"));
  }
};

beforeEach(() => {
  racine = mkdtempSync(path.join(tmpdir(), "nf-walk-"));
});

afterEach(() => {
  rmSync(racine, { recursive: true, force: true });
});

describe("la règle d'exclusion, nommée une fois", () => {
  it("écarte l'INSTALLÉ, le PRODUIT, et ce qui n'est ni servi ni publié", () => {
    for (const nom of [
      "node_modules",
      "dist",
      "coverage",
      ".turbo",
      "tmp",
      "var",
      "tests",
      "__tests__",
    ]) {
      assert.isTrue(isSkippedDir(nom), nom);
    }
    // 🔴 `test` au SINGULIER est un nom de module légitime — ce dépôt en a un.
    // L'exclure faisait disparaître les entités de `src/modules/test`.
    assert.isFalse(isSkippedDir("test"), "un module peut s'appeler `test`");
    assert.isTrue(isSkippedDir(".git"), "tout dossier caché est écarté");
    assert.isFalse(isSkippedDir("nodefony"));
    assert.isFalse(isSkippedDir("src"));
  });

  it("reconnaît un test sous ses deux formes, dans toutes les extensions", () => {
    for (const nom of ["a.test.ts", "a.spec.ts", "a.test.tsx", "a.spec.mts"]) {
      assert.isTrue(isTestFile(nom), nom);
    }
    assert.isFalse(isTestFile("attestation.ts"), "le mot n'est pas le suffixe");
    assert.isFalse(isTestFile("Widget.ts"));
  });

  it("le marcheur ne rend que la source qui compte", () => {
    projetPiege();
    const trouves = collectSources(racine, { extensions: [".ts"] });
    assert.deepStrictEqual(
      trouves.map((f) => path.relative(racine, f)),
      [path.join("nodefony", "service", "Widget.ts")],
    );
  });

  it("`SKIPPED_DIRS` est la SOURCE, pas une copie — l'y ajouter suffit", () => {
    poser("nodefony/service/Widget.ts");
    poser("attic/Vieux.ts");
    assert.lengthOf(collectSources(racine, { extensions: [".ts"] }), 2);
    assert.isFalse(SKIPPED_DIRS.has("attic"));
  });
});

describe("⭐ les quatre contrôles s'accordent sur le MÊME décor piégé", () => {
  it("surface, câblage et dépendances ne voient qu'une source", () => {
    projetPiege();
    const surface = checkSurface({
      roots: [racine],
      cwd: racine,
      projectRoot: racine,
      env: {},
    });
    const wiring = checkWiring({
      roots: [racine],
      cwd: racine,
      projectRoot: racine,
    });
    const deps = checkPackageDeps({ roots: [racine], cwd: racine });
    assert.equal(surface.scanned, 1, "surface ouverte");
    assert.equal(
      wiring.scanned,
      1,
      "câblage — les dix classes piégées portent pourtant @injectable",
    );
    // `checkPackageDeps` compte les paquets ; ce qui s'observe ici est qu'il
    // n'accuse aucun import venu d'un fichier piégé.
    assert.deepStrictEqual(
      deps.findings.map((f) => f.message),
      [],
      "dépendances",
    );
  });

  it("la fraîcheur ne se laisse pas non plus tromper par les pièges", () => {
    projetPiege();
    // Le build est plus vieux que TOUT — seule une source bâtie doit crier.
    poser("dist/index.js", "//");
    utimesSync(path.join(racine, "dist", "index.js"), 1_000, 1_000);
    for (const rel of [
      "nodefony/service/Widget.test.ts",
      "nodefony/service/tests/Helper.ts",
      "src/var/Cache.ts",
      "nodefony/tmp/Brouillon.ts",
    ]) {
      utimesSync(path.join(racine, ...rel.split("/")), 3_000, 3_000);
    }
    utimesSync(
      path.join(racine, "nodefony", "service", "Widget.ts"),
      2_000,
      2_000,
    );

    const r = checkFreshness(racine);
    assert.deepStrictEqual(
      r.findings.map((f) => f.file),
      [path.join("nodefony", "service", "Widget.ts").split(path.sep).join("/")],
      "le fichier désigné est la seule source BÂTIE, pas le piège le plus récent",
    );
  });

  it("un dossier ajouté à la règle disparaît des QUATRE inventaires", () => {
    projetPiege();
    poser("attic/Oublie.ts", CLASSE("Oublie"));
    const avant = checkSurface({
      roots: [racine],
      cwd: racine,
      projectRoot: racine,
      env: {},
    }).scanned;
    const avantCablage = checkWiring({
      roots: [racine],
      cwd: racine,
      projectRoot: racine,
    }).scanned;
    // `attic` n'est pas exclu : les deux contrôles le voient, donc ils
    // partagent bien le parcours qu'on prétend unique.
    assert.equal(avant, 2);
    assert.equal(
      avantCablage,
      1,
      "le câblage ne regarde que `nodefony` et `src`",
    );
    assert.isTrue(
      collectSources(racine, { extensions: [".ts"] }).some((f) =>
        f.includes("attic"),
      ),
    );
  });
});
