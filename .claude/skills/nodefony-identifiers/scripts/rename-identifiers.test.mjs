/**
 * Auto-contrôle de `rename-identifiers.mjs`.
 *
 * Les deux cas couverts ici ont chacun produit une régression SILENCIEUSE dans
 * du code de production, sous un typecheck vert : un membre privé rendu public,
 * et un raccourci d'objet relié à la mauvaise déclaration. Le troisième cas
 * garde la garde honnête — trop large, elle refuserait des renommages sûrs.
 *
 * Lancer : `node --test .claude/skills/nodefony-identifiers/scripts/rename-identifiers.test.mjs`
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const tool = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "rename-identifiers.mjs",
);

/**
 * Monte un décor jetable, y joue un plan, et rend le fichier obtenu.
 *
 * @param source - contenu de `src/a.ts`.
 * @param plan - table `{ ancien: nouveau }` visant ce fichier.
 * @returns le texte après renommage et la sortie de l'outil.
 */
const run = (source, plan) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nf-rename-"));
  fs.mkdirSync(path.join(dir, "src"));
  fs.writeFileSync(path.join(dir, "src", "a.ts"), source);
  fs.writeFileSync(
    path.join(dir, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        target: "ES2024",
        module: "ESNext",
        moduleResolution: "Bundler",
        strict: true,
        noEmit: true,
      },
      include: ["src/**/*.ts"],
    }),
  );
  fs.writeFileSync(
    path.join(dir, "plan.json"),
    JSON.stringify({ "src/a.ts": plan }),
  );
  let output = "";
  try {
    output = execFileSync(
      process.execPath,
      [tool, "--project", "tsconfig.json", "--plan", "plan.json"],
      { cwd: dir, encoding: "utf8" },
    );
  } catch (e) {
    output = `${e.stdout ?? ""}${e.stderr ?? ""}`;
  }
  return {
    text: fs.readFileSync(path.join(dir, "src", "a.ts"), "utf8"),
    output,
  };
};

test("un membre privé se renomme EN RESTANT privé", () => {
  const { text } = run(
    `export class C {\n  #prendreVerrou(): number {\n    return 1;\n  }\n  go(): number {\n    return this.#prendreVerrou();\n  }\n}\n`,
    { "#prendreVerrou": "takeLock" },
  );
  assert.match(
    text,
    /#takeLock\(\): number/,
    "la déclaration garde le croisillon",
  );
  assert.match(text, /this\.#takeLock\(\)/, "l'usage garde le croisillon");
  assert.doesNotMatch(
    text,
    /(?<!#)\btakeLock\b/,
    "aucun site ne perd le croisillon — un membre privé devenu public compile sans un mot",
  );
});

test("une cible DÉJÀ déclarée dans le fichier est refusée", () => {
  const source = `export function f(): { a: number } {\n  const cible = 1;\n  const target = { a: cible };\n  return target;\n}\n`;
  const { text, output } = run(source, { cible: "target" });
  assert.match(output, /REFUSÉ/, "l'outil dit pourquoi il n'a rien fait");
  assert.equal(text, source, "le fichier reste intact");
});

test("une PROPRIÉTÉ de type homonyme ne bloque pas un renommage sûr", () => {
  const { text, output } = run(
    `interface IRow {\n  columns?: string[];\n}\nexport function f(r: IRow): number {\n  const colonnes = r.columns ?? [];\n  return colonnes.length;\n}\n`,
    { colonnes: "columns" },
  );
  assert.doesNotMatch(
    output,
    /REFUSÉ/,
    "une propriété de type ne lie aucun nom",
  );
  assert.match(text, /const columns = r\.columns/);
});
