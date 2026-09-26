/**
 * **Aucun `as any` dans le code de production.**
 *
 * Le lint porte déjà `typescript/no-explicit-any`, mais une ligne
 * `eslint-disable-next-line` le fait taire sans que personne le voie : les trois
 * derniers `as any` du dépôt étaient tous précédés d'une telle désactivation, et
 * l'un d'eux (`httpError.ts`) masquait un cycle de types entre `http` et
 * `framework`. Un cast vers `any` éteint le typecheck en AVAL du site, pas
 * seulement sur la ligne : tout ce qu'on lit ensuite passe sans contrôle.
 *
 * Ce contrôle relit les sources et refuse le motif, désactivation ou non. Le
 * remède n'est jamais d'ajouter une exception ici : `unknown` puis un
 * rétrécissement, un type structurel minimal (`{ constructor?: unknown }`), ou
 * un contrat défini par le lecteur quand le type vit dans un paquet d'au-dessus.
 *
 * Hors périmètre : les tests (`tests/`, `*.test.ts`), où le lint est déjà
 * désarmé — un double de test n'est pas publié.
 */
import { describe, it } from "vitest";
import { assert } from "chai";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/** Racine du dépôt — ce fichier vit dans `src/nodefony/src/tests/`. */
const REPO_ROOT = path.resolve(import.meta.dirname, "../../../..");

/** Dossiers dont le contenu n'est jamais du code de production de ce dépôt. */
const PRUNED = new Set([
  "node_modules",
  "dist",
  ".git",
  ".turbo",
  "coverage",
  "tests",
]);

/** Un `as any` écrit dans du code, pas dans un commentaire. */
const AS_ANY = /\bas\s+any\b/;

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    if (PRUNED.has(name)) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name)) {
      out.push(full);
    }
  }
}

function offenders(): string[] {
  const files: string[] = [];
  walk(path.join(REPO_ROOT, "src"), files);
  const found: string[] = [];
  for (const file of files) {
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, index) => {
      const code = line.trimStart();
      if (
        code.startsWith("//") ||
        code.startsWith("*") ||
        code.startsWith("/*")
      ) {
        return;
      }
      if (AS_ANY.test(line)) {
        const relative = path
          .relative(REPO_ROOT, file)
          .split(path.sep)
          .join("/");
        found.push(`${relative}:${index + 1}`);
      }
    });
  }
  return found;
}

describe("Gate — aucun `as any` dans le code de production", () => {
  it("le périmètre contient bien du code (sinon le gate ne prouve rien)", () => {
    const files: string[] = [];
    walk(path.join(REPO_ROOT, "src"), files);
    assert.isAbove(files.length, 500);
  });

  it("aucun site `as any` hors tests", () => {
    assert.deepEqual(offenders(), []);
  });
});
