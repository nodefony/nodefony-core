import { describe, it, expect, afterAll } from "vitest";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Ce que ces tests prouvent : un script de skill lancé depuis un SOUS-DOSSIER de
 * l'application (`frontend/`, `modules/blog/`) travaille sur la RACINE de
 * l'application, pas sur le dossier où l'on a tapé.
 *
 * Avant, chacun prenait `process.cwd()` pour racine : la sonde du navigateur
 * semait des `tmp/browser/` dans chaque sous-dossier, et la recherche de doc,
 * l'extraction des journaux et la relecture de sécurité cherchaient
 * `node_modules`, `logs/` ou la configuration au mauvais endroit. Une seule
 * définition de « où commence l'app » : `findProjectRoot` du cœur.
 */
const SKILLS = path.join(import.meta.dirname, "..", "skills");

const app = realpathSync(mkdtempSync(path.join(os.tmpdir(), "nf-skill-root-")));
writeFileSync(path.join(app, "nodefony.config.ts"), "export default {};\n");
writeFileSync(path.join(app, "package.json"), "{}\n");
const subdir = path.join(app, "frontend", "src");
mkdirSync(subdir, { recursive: true });

afterAll(() => {
  rmSync(app, { recursive: true, force: true });
});

interface IParseArgs {
  parseArgs(argv: string[], cwd?: string): { root: string };
}

const SCRIPTS = [
  ["nodefony-dev", "docs.mjs"],
  ["nodefony-troubleshoot", "log-errors.mjs"],
  ["nodefony-security-review", "review-diff.mjs"],
] as const;

describe("scripts de skills — la racine est celle de l'APPLICATION", () => {
  for (const [skill, file] of SCRIPTS) {
    it(`${skill}/${file} lancé depuis un sous-dossier vise la racine`, async () => {
      const mod = (await import(
        pathToFileURL(path.join(SKILLS, skill, "scripts", file)).href
      )) as IParseArgs;
      expect(mod.parseArgs([], subdir).root).toBe(app);
    });

    it(`${skill}/${file} hors application garde le dossier courant`, async () => {
      const mod = (await import(
        pathToFileURL(path.join(SKILLS, skill, "scripts", file)).href
      )) as IParseArgs;
      const outside = realpathSync(os.tmpdir());
      expect(mod.parseArgs([], outside).root).toBe(outside);
    });
  }

  it("nodefony-browser dépose ses captures sous <racine>/tmp/browser", async () => {
    const probes = (await import(
      pathToFileURL(
        path.join(SKILLS, "nodefony-browser", "scripts", "lib", "probes.mjs"),
      ).href
    )) as {
      environmentDefaults(stage: {
        inContainer: boolean;
        root?: string | null;
      }): { out: string };
    };
    expect(
      probes.environmentDefaults({ inContainer: false, root: app }).out,
    ).toBe(path.join(app, "tmp", "browser"));
    // En conteneur, le volume monté gagne : la racine du poste n'y existe pas.
    expect(
      probes.environmentDefaults({ inContainer: true, root: app }).out,
    ).toBe("/output");
  });
});

describe("l'aide partagée app-root.mjs — une COPIE confrontée au cœur", () => {
  it("rend la même racine que findProjectRoot, cas pièges compris", async () => {
    const { findProjectRoot } = await import("nodefony");
    const { findAppRoot } = (await import(
      pathToFileURL(
        path.join(SKILLS, "nodefony-dev", "scripts", "lib", "app-root.mjs"),
      ).href
    )) as { findAppRoot(from: string): string | null };
    // Un dossier qui porte la config SANS package.json n'est pas une racine :
    // la remontée doit le traverser jusqu'à l'application.
    const leurre = path.join(app, "modules", "leurre");
    mkdirSync(leurre, { recursive: true });
    writeFileSync(
      path.join(leurre, "nodefony.config.ts"),
      "export default {};\n",
    );
    const cas = [app, subdir, leurre, realpathSync(os.tmpdir())];
    for (const from of cas) {
      expect(findAppRoot(from), from).toBe(findProjectRoot(from));
    }
    expect(findAppRoot(leurre)).toBe(app);
  });
});
