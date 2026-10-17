/**
 * Suite du gate `import()` de chemin natif — écrite pour le faire ÉCHOUER.
 *
 * Le défaut qu'il garde ne se voit QUE sous Windows : un test vert ici sur
 * macOS ne prouve rien du produit, il prouve que le gate reconnaît la FORME
 * qui lève là-bas. Chaque cas est donc un motif réellement rencontré dans le
 * dépôt (les seize sites corrigés par #401), et chaque conversion légitime
 * doit passer — un gate qui accuse du code juste fait « corriger » ce qui
 * marchait.
 */
import { describe, expect, it } from "vitest";
import { findNativeImports } from "./check-import-specifiers.mjs";

const PATH = 'import path from "node:path";\n';

/** Les fautes trouvées dans un source `.mjs`. */
const faults = (code, file = "x.mjs") => findNativeImports(code, file);

describe("check-import-specifiers — il MORD sur un chemin natif", () => {
  it("`path.join` passé en direct (coverage-all, avant #401)", () => {
    const f = faults(`${PATH}await import(path.join(ROOT, "cible.ts"));`);
    expect(f).toHaveLength(1);
    expect(f[0].origin).toBe('path.join(ROOT, "cible.ts")');
    expect(f[0].line).toBe(2);
  });

  it("PIÈGE — le chemin passe par une constante (aimd-demo)", () => {
    const f = faults(
      `${PATH}const DIST = path.join(ROOT, "dist/x.js");\nawait import(DIST);`,
    );
    expect(f).toHaveLength(1);
    expect(f[0].argument).toBe("DIST");
  });

  it("PIÈGE — une seule branche d'un ternaire est un chemin (`--module`)", () => {
    const f = faults(
      `${PATH}const MODULE = cond ? "./x.mjs" : path.resolve(arg);\nawait import(MODULE);`,
    );
    expect(f).toHaveLength(1);
    expect(f[0].origin).toBe("path.resolve(arg)");
  });

  it("PIÈGE — variable de boucle déclarée dans un bloc (conformite)", () => {
    const f = faults(
      `${PATH}for (const nom of noms) {\n  const fichier = path.join(dir, nom);\n  await import(fichier);\n}`,
      "x.ts",
    );
    expect(f).toHaveLength(1);
  });

  it("PIÈGE — affectation tardive (`let x; try { x = … }`)", () => {
    const f = faults(
      `${PATH}let x;\ntry { x = path.join(a, b); } catch {}\nawait import(x);`,
    );
    expect(f).toHaveLength(1);
  });

  it("fonctions nommées de node:path, et alias d'import", () => {
    const f = faults(
      'import { join as j } from "node:path";\nawait import(j(a, "x.mjs"));',
    );
    expect(f).toHaveLength(1);
  });

  it("les autres fabricants de chemin natif", () => {
    for (const expr of [
      "fileURLToPath(u)",
      "process.cwd() + '/x.mjs'",
      "`${__dirname}/x.mjs`",
      "`${import.meta.dirname}/x.mjs`",
      "os.tmpdir()",
      "mkdtempSync(p)",
    ]) {
      expect(faults(`await import(${expr});`), expr).toHaveLength(1);
    }
  });
});

describe("check-import-specifiers — il se TAIT sur ce qui est juste", () => {
  it("la conversion unique, et l'URL de `pathToFileURL`", () => {
    expect(
      faults(`${PATH}await import(toImportSpecifier(path.join(a, b)));`),
    ).toEqual([]);
    expect(
      faults(`${PATH}await import(pathToFileURL(path.join(a, b)).href);`),
    ).toEqual([]);
    expect(
      faults(
        `${PATH}const M = c ? "./x.mjs" : pathToFileURL(path.resolve(a)).href;\nawait import(M);`,
      ),
    ).toEqual([]);
  });

  it("un spécificateur relatif ou un nom de paquet", () => {
    expect(faults('await import("./voisin/cible.ts");')).toEqual([]);
    expect(faults('await import("node:fs");')).toEqual([]);
    expect(faults("await import(`./${nom}.mjs`);")).toEqual([]);
  });

  it("une origine INCONNUE n'est pas accusée (paramètre, appel quelconque)", () => {
    expect(faults("async function f(p) { return import(p); }")).toEqual([]);
    expect(faults("await import(resolveEntry(nom));")).toEqual([]);
  });

  it("un paramètre homonyme masque la constante du fichier", () => {
    expect(
      faults(
        `${PATH}const p = path.join(a, b);\nasync function f(p) { return import(p); }`,
      ),
    ).toEqual([]);
  });

  it("`import(` dans un commentaire ou une chaîne n'est pas un appel", () => {
    expect(
      faults(
        `${PATH}// await import(path.join(a, b))\nconst s = "import(path.join(a))";`,
      ),
    ).toEqual([]);
  });

  it("`path.join` d'un AUTRE objet que node:path n'est pas accusé", () => {
    expect(faults("await import(segments.join('/'));")).toEqual([]);
  });
});
