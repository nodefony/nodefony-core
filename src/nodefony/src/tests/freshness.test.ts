import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { checkFreshness, requiredNodeMajor } from "../kernel/checks/freshness";

/**
 * Ce qui tourne n'est pas ce qui est écrit — le contrôle qui le dit AVANT.
 *
 * Le runtime charge `dist/`. Une source plus récente que le build est donc du
 * code qui ne s'exécute pas, et c'est la cause perdue la plus fréquente du
 * framework : la route existe, elle compile, elle répond 404. Le noyau la
 * devinait déjà — mais seulement APRÈS un échec de démarrage.
 */
describe("doctor — fraîcheur du build et plancher de Node", () => {
  const app = (): string => {
    const racine = mkdtempSync(path.join(os.tmpdir(), "nf-freshness-"));
    mkdirSync(path.join(racine, "nodefony"), { recursive: true });
    writeFileSync(path.join(racine, "package.json"), JSON.stringify({}));
    return racine;
  };

  /** Pose une date de modification EXPLICITE — sinon les deux se valent. */
  const dater = (fichier: string, secondes: number): void =>
    utimesSync(fichier, secondes, secondes);

  it("🔴 une source plus récente que le build est signalée, et le geste donné", () => {
    const racine = app();
    const dist = path.join(racine, "dist");
    mkdirSync(dist, { recursive: true });
    writeFileSync(path.join(dist, "index.js"), "//");
    dater(path.join(dist, "index.js"), 1_000);
    const source = path.join(racine, "nodefony", "Widget.ts");
    writeFileSync(source, "export const a = 1;");
    dater(source, 2_000);

    const r = checkFreshness(racine);
    assert.deepEqual(
      r.findings.map((f) => f.kind),
      ["dist-stale"],
    );
    assert.match(r.findings[0]!.message, /npm run build/);
    // Le message NOMME le fichier fautif : sur cinquante sources, il faut
    // savoir laquelle a bougé.
    assert.match(r.findings[0]!.message, /nodefony/);
  });

  it("un build plus récent que les sources ne dit RIEN", () => {
    // L'inverse n'est pas symétrique : un cache de build peut restaurer un
    // artefact au mtime neuf. On n'accuse que dans le sens qui reste vrai.
    const racine = app();
    const dist = path.join(racine, "dist");
    mkdirSync(dist, { recursive: true });
    const source = path.join(racine, "nodefony", "Widget.ts");
    writeFileSync(source, "export const a = 1;");
    dater(source, 1_000);
    writeFileSync(path.join(dist, "index.js"), "//");
    dater(path.join(dist, "index.js"), 2_000);

    assert.deepEqual(checkFreshness(racine).findings, []);
  });

  it("🔴 une application jamais construite est signalée", () => {
    const racine = app();
    writeFileSync(
      path.join(racine, "nodefony", "Widget.ts"),
      "export const a = 1;",
    );
    assert.deepEqual(
      checkFreshness(racine).findings.map((f) => f.kind),
      ["dist-missing"],
    );
  });

  it("un dossier SANS source ni build n'est pas comparable — et le DIT", () => {
    // Le silence d'un contrôle qui n'a rien pu regarder ne vaut pas quitus.
    const racine = mkdtempSync(path.join(os.tmpdir(), "nf-vide-"));
    const r = checkFreshness(racine);
    assert.deepEqual(r.findings, []);
    assert.equal(r.notComparable, true);
  });

  it("🔴 un Node en deçà du plancher déclaré est signalé", () => {
    const racine = app();
    writeFileSync(
      path.join(racine, "package.json"),
      JSON.stringify({ engines: { node: ">=24" } }),
    );
    const r = checkFreshness(racine, "v20.11.0");
    assert.ok(r.findings.some((f) => f.kind === "node-below-engines"));
  });

  it("un Node conforme ne dit rien", () => {
    const racine = app();
    writeFileSync(
      path.join(racine, "package.json"),
      JSON.stringify({ engines: { node: ">=24" } }),
    );
    assert.equal(
      checkFreshness(racine, "v26.0.0").findings.filter(
        (f) => f.kind === "node-below-engines",
      ).length,
      0,
    );
  });

  it("la version se lit sur la GRAMMAIRE, pas sur un format supposé", () => {
    // Le plancher s'écrit de plusieurs façons ; aucune ne doit faire taire
    // le contrôle en silence.
    assert.equal(requiredNodeMajor({ node: ">=24" }), 24);
    assert.equal(requiredNodeMajor({ node: "^24.1.0" }), 24);
    assert.equal(requiredNodeMajor({ node: "24.x" }), 24);
    assert.equal(requiredNodeMajor({ node: "récent" }), null);
    assert.equal(requiredNodeMajor(undefined), null);
    assert.equal(requiredNodeMajor(null), null);
  });
});
