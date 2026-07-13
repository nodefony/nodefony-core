import { describe, it, beforeAll, afterAll } from "vitest";
import { expect } from "chai";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolveModuleEntry } from "../kernel/resolveModuleEntry";

/**
 * SPEC — « c'est l'APP qui décide où sont ses modules ».
 *
 * Le Kernel charge les modules du manifeste par leur NOM. Si cette résolution
 * part du paquet `nodefony` (le comportement d'un `import(name)` écrit dans le
 * core), alors tout module LOCAL de l'app devient introuvable dès que le core
 * n'habite pas l'arbre `node_modules` de l'app : mode `--link`, monorepo, pnpm.
 * Ces tests figent le contrat inverse — la résolution part de `kernel.path`.
 *
 * La fixture reproduit EXACTEMENT la topologie qui cassait : une app hors du
 * checkout, avec son module en workspace npm (symlink `node_modules/@app/blog`
 * → `modules/blog`), et un core qui vit ailleurs.
 */
describe("resolveModuleEntry — résolution des modules depuis l'app", () => {
  let appRoot: string;
  let elsewhere: string;

  beforeAll(() => {
    appRoot = mkdtempSync(path.join(os.tmpdir(), "nf-app-"));
    elsewhere = mkdtempSync(path.join(os.tmpdir(), "nf-core-"));
    writeFileSync(
      path.join(appRoot, "package.json"),
      JSON.stringify({ name: "app", workspaces: ["modules/*"] }),
    );

    // Le module local, tel que `nodefony create module` le pose.
    const moduleDir = path.join(appRoot, "modules", "blog");
    mkdirSync(path.join(moduleDir, "dist"), { recursive: true });
    writeFileSync(
      path.join(moduleDir, "package.json"),
      JSON.stringify({ name: "@app/blog", main: "dist/index.js" }),
    );
    writeFileSync(
      path.join(moduleDir, "dist", "index.js"),
      "export default {};",
    );

    // Le symlink que npm pose pour un workspace — le cœur du sujet.
    const scopeDir = path.join(appRoot, "node_modules", "@app");
    mkdirSync(scopeDir, { recursive: true });
    symlinkSync(moduleDir, path.join(scopeDir, "blog"), "dir");

    // Un paquet qui n'expose QUE la condition `import` : `require.resolve` le
    // refuse → le repli doit s'appliquer (au lieu de faire échouer le boot).
    const esmOnly = path.join(appRoot, "node_modules", "esm-only");
    mkdirSync(esmOnly, { recursive: true });
    writeFileSync(
      path.join(esmOnly, "package.json"),
      JSON.stringify({
        name: "esm-only",
        exports: { ".": { import: "./index.js" } },
      }),
    );
    writeFileSync(path.join(esmOnly, "index.js"), "export default {};");
  });

  afterAll(() => {
    rmSync(appRoot, { recursive: true, force: true });
    rmSync(elsewhere, { recursive: true, force: true });
  });

  it("résout un module local de l'app (workspace npm) en URL file:// absolue", () => {
    const entry = resolveModuleEntry(appRoot, "@app/blog");
    expect(entry).to.match(/^file:\/\//u);
    const file = fileURLToPath(entry);
    expect(file.endsWith(path.join("dist", "index.js"))).to.be.true;
    // Le point d'entrée pointe bien dans le module de l'APP, pas ailleurs.
    expect(file).to.include(path.join("modules", "blog"));
  });

  it("RÉGRESSION — résout même quand le core vit HORS de l'arbre node_modules de l'app", () => {
    // Le bug historique : la résolution partait du core. Reproduit ici en
    // résolvant depuis un dossier étranger → introuvable, donc repli au nom nu.
    // C'est précisément ce que le Kernel faisait avant, et qui cassait le boot.
    expect(resolveModuleEntry(elsewhere, "@app/blog")).to.equal("@app/blog");
    // Depuis l'app : trouvé. La différence EST la correction.
    expect(resolveModuleEntry(appRoot, "@app/blog")).to.match(/^file:\/\//u);
  });

  it("rend une URL importable telle quelle par import()", async () => {
    const entry = resolveModuleEntry(appRoot, "@app/blog");
    const mod = (await import(entry)) as { default: unknown };
    expect(mod.default).to.be.an("object");
  });

  it("replie sur le spécificateur nu quand le paquet est introuvable", () => {
    expect(resolveModuleEntry(appRoot, "@app/inexistant")).to.equal(
      "@app/inexistant",
    );
  });

  it("replie sur le spécificateur nu pour un paquet exports import-only", () => {
    // Pas de condition `require` → `require.resolve` refuse. Le repli laisse
    // `import()` faire son travail (il sait, lui, lire la condition `import`).
    expect(resolveModuleEntry(appRoot, "esm-only")).to.equal("esm-only");
  });

  it("ne casse pas la résolution d'un paquet installé normalement", () => {
    // Un paquet réel du monorepo, résolu depuis la racine du core lui-même.
    const coreRoot = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "..",
      "..",
    );
    const entry = resolveModuleEntry(coreRoot, "eta");
    expect(entry).to.match(/^file:\/\//u);
    expect(entry.startsWith(pathToFileURL(coreRoot).href.slice(0, 8))).to.be
      .true;
  });
});
