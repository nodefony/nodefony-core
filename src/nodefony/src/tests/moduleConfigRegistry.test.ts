/**
 * **Le registre de config d'un module ne vaut que s'il ENTRE dans le programme.**
 *
 * Chaque module publie une augmentation `declare module "nodefony"` qui
 * enregistre sa config dans `NodefonyModuleConfig`. C'est elle qui fait refuser
 * `use("@nodefony/http", { trustProxi: true })` à la compilation. Mais une
 * augmentation n'agit QUE si le fichier qui la porte entre dans le programme
 * TypeScript — et rien ne l'y met : un `nodefony.config.ts` n'importe aucun
 * module, il les NOMME. Le registre retombe alors sur `Record<string, unknown>`,
 * la clé fautive compile, et Zod la retire **en silence** au boot.
 *
 * Le trou ne se voit pas : tout est vert, la complétion propose seulement moins
 * de choses. Mesuré à l'ouverture de ce contrôle — six modules sur dix du
 * manifeste racine acceptaient n'importe quelle clé.
 *
 * La parade est un ré-export en tête du manifeste :
 *
 * ```ts
 * export type { IRealtimeConfigInput } from "@nodefony/realtime";
 * ```
 *
 * Un ré-export plutôt qu'un `import type` : il compte comme une UTILISATION du
 * type, donc il traverse `noUnusedLocals` (TS6133), là où l'import seul échoue.
 *
 * Ce contrôle est TEXTUEL à dessein : il lit qui est monté et qui est ré-exporté.
 * Un typecheck, lui, ne dirait rien — l'absence d'augmentation ne produit aucune
 * erreur, c'est tout le problème.
 */
import { describe, it } from "vitest";
import { assert } from "chai";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";

/** Racine du dépôt — ce fichier vit dans `src/nodefony/src/tests/`. */
const REPO_ROOT = path.resolve(import.meta.dirname, "../../../..");

/** Un module du dépôt qui enregistre sa config dans le registre. */
interface RegistryEntry {
  /** Nom npm, tel qu'il s'écrit dans `use()`. */
  packageName: string;
  /** Nom du type d'entrée enregistré (`IRealtimeConfigInput`). */
  inputType: string;
}

/**
 * Relève les modules qui augmentent `NodefonyModuleConfig`, en lisant leur
 * `index.ts`.
 *
 * Marche du disque plutôt qu'une liste écrite ici : une liste se périme au
 * module suivant, et c'est le module suivant qu'on veut couvrir.
 *
 * @param roots - dossiers contenant des paquets (`src/packages/@nodefony`…).
 * @returns une entrée par module qui enregistre sa config.
 */
function collectRegistryEntries(roots: string[]): RegistryEntry[] {
  const entries: RegistryEntry[] = [];
  for (const root of roots) {
    let dirs: string[];
    try {
      dirs = readdirSync(root);
    } catch {
      continue;
    }
    for (const dir of dirs) {
      const index = path.join(root, dir, "index.ts");
      if (!existsSync(index)) {
        continue;
      }
      const source = readFileSync(index, "utf8");
      // `"<nom>": <Type>;` DANS le bloc d'augmentation — la regex porte sur la
      // paire, pas sur le bloc, pour ne pas dépendre du formatage de prettier.
      const match =
        /declare module "nodefony"[\s\S]*?interface NodefonyModuleConfig\s*\{\s*"([^"]+)"\s*:\s*(\w+)\s*;/u.exec(
          source,
        );
      if (match) {
        entries.push({ packageName: match[1], inputType: match[2] });
      }
    }
  }
  return entries;
}

/**
 * Retire les commentaires d'une source avant toute extraction.
 *
 * Sans ça, l'exemple `// use("@nodefony/mongoose", { … })` que le manifeste
 * garde en commentaire compte comme un module MONTÉ, et le contrôle réclame un
 * ré-export pour un module que personne ne charge. Un contrôle qui accuse à
 * tort se fait désarmer, pas corriger.
 *
 * @param source - contenu d'un fichier TypeScript.
 * @returns la même source, commentaires blanchis.
 */
function stripComments(source: string): string {
  return (
    source
      // ⚠️ Les DEUX motifs sont ancrés en début de ligne, et ce n'est pas un
      // détail de style. Un `/\*[\s\S]*?\*\//` libre mord sur le `/*` d'un
      // GLOB écrit dans une chaîne (`"modules/*"`, `"docs/**/*.md"`) et avale
      // le code jusqu'au prochain `*/` : mesuré ici, il effaçait 93 % du
      // manifeste, et le contrôle rendait alors un verdict sur presque rien.
      .replace(/^[ \t]*\/\*[\s\S]*?\*\//gmu, "")
      .replace(/^[ \t]*\/\/.*$/gmu, "")
  );
}

/**
 * Relève les modules NOMMÉS par un manifeste d'application.
 *
 * Les trois formes du manifeste sont acceptées — `use("x", …)`, la chaîne nue
 * `"x",` et `{ name: "x" }` — parce que les trois s'écrivent dans ce dépôt et
 * qu'un module monté sous la forme qu'on aurait oubliée passerait au travers.
 *
 * @param source - contenu d'un `nodefony.config.ts` (ou de son gabarit).
 * @returns les noms npm montés.
 */
function collectMountedModules(source: string): Set<string> {
  const mounted = new Set<string>();
  const code = stripComments(source);
  const manifest = /modules\s*:\s*\[([\s\S]*)\]/u.exec(code);
  const scope = manifest ? manifest[1] : code;
  for (const m of scope.matchAll(/"(@[\w.-]+\/[\w.-]+)"/gu)) {
    mounted.add(m[1]);
  }
  return mounted;
}

/**
 * Relève les types ré-exportés depuis un paquet donné.
 *
 * @param source - contenu d'un `nodefony.config.ts`.
 * @returns les noms npm dont un type est ré-exporté.
 */
function collectReExportedPackages(source: string): Set<string> {
  const found = new Set<string>();
  // Pas d'ancre `^` : dans un gabarit, la ligne est précédée de sa balise EJS
  // (`<% if (it.complete) { %>export type { … }`) et l'ancre ne mordrait pas.
  for (const m of stripComments(source).matchAll(
    /export type \{[^}]*\} from "([^"]+)";/gu,
  )) {
    found.add(m[1]);
  }
  return found;
}

describe("registre de config des modules — l'augmentation doit ENTRER dans le programme", () => {
  const registry = collectRegistryEntries([
    path.join(REPO_ROOT, "src", "packages", "@nodefony"),
    path.join(REPO_ROOT, "src", "modules"),
  ]);

  // 🔴 Sans matière, « 0 constat » ne se distingue pas d'un dépôt conforme.
  it("le balayage TROUVE les modules qui enregistrent leur config", () => {
    assert.isAtLeast(
      registry.length,
      8,
      "plus de huit modules du dépôt augmentent NodefonyModuleConfig ; le balayage est aveugle",
    );
  });

  it("le manifeste du dépôt ré-exporte le type de CHAQUE module monté qui en publie un", () => {
    const configPath = path.join(REPO_ROOT, "nodefony.config.ts");
    const source = readFileSync(configPath, "utf8");
    const mounted = collectMountedModules(source);
    const reExported = collectReExportedPackages(source);
    const missing = registry
      .filter(
        (e) => mounted.has(e.packageName) && !reExported.has(e.packageName),
      )
      .map((e) => `export type { ${e.inputType} } from "${e.packageName}";`);
    assert.deepEqual(
      missing,
      [],
      "Ces modules sont montés et enregistrent leur config, mais leur augmentation " +
        "n'entre pas dans le programme : `use()` y accepte n'importe quelle clé, que " +
        "Zod retire ensuite en silence. Ajouter ces lignes en tête de nodefony.config.ts",
    );
  });

  it("le gabarit d'application ré-exporte le type de chaque module qu'il monte", () => {
    const tplPath = path.join(
      REPO_ROOT,
      "src",
      "nodefony",
      "templates",
      "app",
      "base",
      "nodefony.config.ts.tpl",
    );
    const source = readFileSync(tplPath, "utf8");
    const mounted = collectMountedModules(source);
    const reExported = collectReExportedPackages(source);
    const missing = registry
      .filter(
        (e) => mounted.has(e.packageName) && !reExported.has(e.packageName),
      )
      .map((e) => e.packageName);
    assert.deepEqual(
      missing,
      [],
      "Le gabarit monte ces modules sans faire entrer leur registre : c'est " +
        "l'UTILISATEUR qui subit le trou, pas ce dépôt. Le gabarit est le produit",
    );
  });

  it("le gabarit de module RÉ-EXPORTE son type d'entrée, sinon une app ne peut pas le nommer", () => {
    const tplPath = path.join(
      REPO_ROOT,
      "src",
      "nodefony",
      "templates",
      "module",
      "base",
      "index.ts.tpl",
    );
    const source = readFileSync(tplPath, "utf8");
    assert.include(
      source,
      'export type { I<%= it.pascal %>ConfigInput } from "./nodefony/config/config";',
      "un module généré enregistre sa config mais ne publie pas son type d'entrée : " +
        "le `nodefony.config.ts` de l'app ne peut pas le ré-exporter",
    );
  });
});
