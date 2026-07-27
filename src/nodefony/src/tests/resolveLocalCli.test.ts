/*
 *   Tests du lanceur `bin/nodefony` — décision « quel CLI doit s'exécuter ».
 *
 *   Règle figée ici : dans un projet, c'est le nodefony de l'APPLICATION qui fait
 *   autorité (ses modules, ses scaffolds, sa version) ; le binaire global n'est que
 *   la porte d'entrée du framework (`create app`). Tests PURS : arborescences en
 *   tmp, aucune exécution de binaire.
 */

import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveLocalCli, DELEGATED_ENV } from "../bin/resolveLocalCli";

/** Écrit un `package.json` (crée l'arborescence au passage). */
function writeJson(dir: string, data: unknown): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify(data));
}

/** Pose un projet Nodefony minimal (l'ancre = `nodefony.config.ts` + `package.json`). */
function makeProject(dir: string, name: string): string {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "nodefony.config.ts"), "export default {};");
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name }));
  return dir;
}

/** Pose un paquet `nodefony` complet (package.json + binaire présent). */
function makeCliPackage(dir: string, version: string): string {
  writeJson(dir, {
    name: "nodefony",
    version,
    bin: { nodefony: "bin/nodefony" },
  });
  fs.mkdirSync(path.join(dir, "bin"), { recursive: true });
  fs.writeFileSync(path.join(dir, "bin", "nodefony"), "// cli");
  return path.join(dir, "bin", "nodefony");
}

describe("bin — resolveLocalCli (le CLI de l'app prime sur le global)", () => {
  let root: string;
  let globalPkg: string;
  let app: string;
  let appBin: string;

  beforeAll(() => {
    // `realpathSync` : sur macOS `/var` est un lien vers `/private/var` — sans ça,
    // le test « même paquet » comparerait un chemin résolu à un chemin non résolu.
    root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "nf-cli-"));

    globalPkg = path.join(root, "global", "nodefony");
    makeCliPackage(globalPkg, "10.0.0");

    app = makeProject(path.join(root, "app"), "app");
    appBin = makeCliPackage(
      path.join(app, "node_modules", "nodefony"),
      "9.4.2",
    );
  });

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("hors projet (`create app`) : le global s'exécute lui-même", () => {
    const d = resolveLocalCli({ cwd: root, selfDir: globalPkg });
    assert.strictEqual(d.delegate, null);
    assert.strictEqual(d.reason, "no-project");
  });

  it("dans une app de version divergente : délègue au binaire de l'app", () => {
    const d = resolveLocalCli({ cwd: app, selfDir: globalPkg });
    assert.strictEqual(d.delegate, appBin);
    assert.strictEqual(d.reason, "local-cli");
    if (d.reason !== "local-cli") return;
    assert.strictEqual(d.selfVersion, "10.0.0");
    assert.strictEqual(d.localVersion, "9.4.2");
    assert.strictEqual(d.projectRoot, app);
  });

  it("depuis un sous-dossier : remonte au projet, délègue quand même", () => {
    const deep = path.join(app, "src", "controllers");
    fs.mkdirSync(deep, { recursive: true });
    const d = resolveLocalCli({ cwd: deep, selfDir: globalPkg });
    assert.strictEqual(d.delegate, appBin);
  });

  it("garde anti-boucle : le CLI délégué ne redélègue pas", () => {
    const d = resolveLocalCli({
      cwd: app,
      selfDir: globalPkg,
      env: { [DELEGATED_ENV]: "1" },
    });
    assert.strictEqual(d.delegate, null);
    assert.strictEqual(d.reason, "already-delegated");
  });

  it("même paquet (monorepo, `npm link`, `create app --link`) : aucun aller-retour", () => {
    const linked = makeProject(path.join(root, "linked"), "linked");
    fs.mkdirSync(path.join(linked, "node_modules"), { recursive: true });
    fs.symlinkSync(globalPkg, path.join(linked, "node_modules", "nodefony"));

    const d = resolveLocalCli({ cwd: linked, selfDir: globalPkg });
    assert.strictEqual(d.delegate, null);
    assert.strictEqual(d.reason, "same-package");
  });

  it("projet aux dépendances non installées : le global rend service", () => {
    const bare = makeProject(path.join(root, "bare"), "bare");
    const d = resolveLocalCli({ cwd: bare, selfDir: globalPkg });
    assert.strictEqual(d.delegate, null);
    assert.strictEqual(d.reason, "no-local-cli");
  });

  it("CLI du projet déclaré mais absent (paquet non construit) : échec BRUYANT", () => {
    const broken = makeProject(path.join(root, "broken"), "broken");
    writeJson(path.join(broken, "node_modules", "nodefony"), {
      name: "nodefony",
      version: "9.9.9",
      bin: { nodefony: "bin/nodefony" },
    });

    const d = resolveLocalCli({ cwd: broken, selfDir: globalPkg });
    assert.strictEqual(d.delegate, null);
    assert.strictEqual(d.reason, "local-cli-broken");
    if (d.reason !== "local-cli-broken") return;
    // Le message NOMME un chemin résolu sur le disque : il porte les séparateurs
    // du système, et c'est ce qu'on veut — un développeur doit pouvoir le coller
    // dans son terminal.
    assert.ok(d.detail.includes(path.join("bin", "nodefony")));
  });

  it("champ `bin` en forme string (paquet non standard) : accepté", () => {
    const proj = makeProject(path.join(root, "strbin"), "strbin");
    const pkgDir = path.join(proj, "node_modules", "nodefony");
    writeJson(pkgDir, { name: "nodefony", version: "9.0.0", bin: "cli.js" });
    fs.writeFileSync(path.join(pkgDir, "cli.js"), "// cli");

    const d = resolveLocalCli({ cwd: proj, selfDir: globalPkg });
    assert.strictEqual(d.delegate, path.join(pkgDir, "cli.js"));
  });
});
