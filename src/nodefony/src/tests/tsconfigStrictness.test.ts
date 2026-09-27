/*
 *   Tout tsconfig du dépôt — et tout gabarit qui en engendre un — porte la
 *   MÊME rigueur de compilation, à `REPO_ONLY` près.
 *
 *   Les tsconfig du dépôt ne partagent aucune base (`extends`) : chaque paquet
 *   porte ses options en propre, et une option recopiée à la main finit par
 *   manquer quelque part. Vécu : le cœur désactivait `useUnknownInCatchVariables`
 *   — un trou dans `strict` que personne ne voyait, puisque rien ne comparait.
 *
 *   Ce test lit chaque tsconfig RACINE (sans `extends` local) et exige les
 *   options ci-dessous ; il refuse aussi qu'un tsconfig qui en étend un autre
 *   les coupe. Une seule différence entre le dépôt et ses gabarits :
 *   `REPO_ONLY`, exigé du framework et laissé au choix de l'application. Les
 *   options REFUSÉES vivent ici aussi (`REFUSED`), avec leur motif : ce fichier
 *   est le registre des décisions de rigueur du compilateur. Les gabarits
 *   (`.tpl`) sont lus en texte : leurs balises de modèle ne sont pas du JSON.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

const REPO = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);

/** Options exigées à `true` dans chaque tsconfig racine. */
const REQUIRED = [
  "strict",
  "noImplicitReturns",
  "noImplicitOverride",
  "noFallthroughCasesInSwitch",
] as const;

/**
 * Options exigées dans chaque tsconfig racine DU DÉPÔT, avec leur valeur, mais
 * pas dans les gabarits (`.tpl`) d'application ou de module. Le code du
 * framework tourne chez tout le monde : un accès indexé non vérifié, une clé
 * optionnelle qui reçoit `undefined`, y deviennent un défaut chez
 * l'utilisateur. Le code métier d'une application, lui, n'a pas à payer cette
 * friction par défaut — `strict` y suffit, et chaque option s'y active en une
 * ligne.
 *
 * - `isolatedModules` : le bundler transpile FICHIER PAR FICHIER ; ce qu'il ne
 *   peut pas compiler seul (enum `const` ambiant, ré-export de type) plante à
 *   l'exécution, pas au build.
 * - `noUncheckedSideEffectImports` : un `import "./x"` dont la cible n'existe
 *   pas passait en silence.
 * - `allowUnreachableCode`/`allowUnusedLabels` à `false` : l'éditeur les
 *   signalait en grisé, rien ne les refusait.
 */
const REPO_ONLY = {
  noUncheckedIndexedAccess: "true",
  exactOptionalPropertyTypes: "true",
  isolatedModules: "true",
  noUncheckedSideEffectImports: "true",
  allowUnreachableCode: "false",
  allowUnusedLabels: "false",
} as const satisfies Record<string, "true" | "false">;

/** Tsconfig dispensés d'une option `REPO_ONLY`, avec leur motif. */
const REPO_ONLY_EXEMPT: Record<string, Record<string, string>> = {
  "src/packages/@nodefony/studio/frontend/tsconfig.json": {
    // En React, une prop `undefined` et une prop ABSENTE sont une seule et
    // même chose : l'option n'y attrape aucun défaut. Et les types de Mantine,
    // React Flow et TanStack ne déclarent pas `| undefined` : 59 props
    // (`c={cond ? "dimmed" : undefined}`) à réécrire en étalements
    // conditionnels, pour zéro défaut attrapé. Le code non-JSX du front qu'un
    // test compile (services, utilitaires) reste vérifié sous l'option par
    // `studio/tsconfig.tests.json`.
    exactOptionalPropertyTypes: "props JSX : undefined ≡ absent en React",
  },
};

/**
 * Options strictes du compilateur REFUSÉES, avec leur mesure et leur motif
 * (#498). Ne pas les reproposer sans fait nouveau.
 */
const REFUSED: Record<string, string> = {
  // 9 807 sites. Impose `obj["clé"]` sur une signature d'index : pur style,
  // puisque `noUncheckedIndexedAccess` type déjà l'accès en `T | undefined`.
  noPropertyAccessFromIndexSignature: "redondant avec noUncheckedIndexedAccess",
  // 3 567 sites de `import type` à réécrire. Le risque réel (un import de type
  // conservé par un transpileur fichier par fichier) est couvert par
  // `isolatedModules` et la règle de lint `consistent-type-exports`.
  verbatimModuleSyntax: "couvert par isolatedModules + consistent-type-exports",
  // 912 sites. Interdit décorateurs à métadonnées, enums et propriétés de
  // paramètre, sur lesquels reposent l'injection et l'ORM ; le code est
  // bundlé, jamais exécuté par le retrait de types de Node.
  erasableSyntaxOnly: "incompatible avec les décorateurs de l'injection",
  // 73 + 54 sites. Doublent `no-unused-vars` d'oxlint (`--deny-warnings`) ;
  // les exiger du compilateur casserait le build au milieu d'une édition.
  noUnusedLocals: "couvert par le lint no-unused-vars",
  noUnusedParameters: "couvert par le lint no-unused-vars",
  // Outillage `.mjs` (`scripts/`, `.claude/`) : 9 078 erreurs sur 467 fichiers,
  // dont 5 322 paramètres implicitement `any` — du JavaScript exécuté sans
  // build, relu par le lint typé et éprouvé par ses propres tests. Un script
  // qui MÉRITE des types passe en `.ts`, que Node exécute nativement.
  checkJs: "outillage JS : un script qui mérite des types passe en .ts",
};

/** Options que `strict` allume et qu'aucun tsconfig ne doit éteindre. */
const NEVER_OFF = [
  ...REQUIRED,
  "noUncheckedIndexedAccess",
  "exactOptionalPropertyTypes",
  "isolatedModules",
  "noUncheckedSideEffectImports",
  "useUnknownInCatchVariables",
] as const;

/** Options exigées à `false`, qu'aucun tsconfig ne doit rallumer. */
const NEVER_ON = ["allowUnreachableCode", "allowUnusedLabels"] as const;

/**
 * Hors périmètre, avec leur motif : aucun n'est lu par un contrôle de types.
 * Le banc mocha et `tests/tsconfig.test.json` ne sont compilés par aucun
 * script ; `tsconfig.bin.json` ne sert qu'à la TRANSPILATION du binaire par
 * rolldown, qui ne vérifie pas les types.
 */
const EXEMPT = [
  "src/nodefony/src/tests/mocha-ts/",
  "src/nodefony/src/tests/tsconfig.test.json",
  "src/nodefony/src/config/tsconfig.bin.json",
];

const tsconfigs = execFileSync("git", ["ls-files"], {
  cwd: REPO,
  encoding: "utf8",
})
  .split("\n")
  .filter((f) => /(^|\/)tsconfig[^/]*\.json(\.tpl)?$/.test(f))
  .filter((f) => !EXEMPT.some((e) => f.startsWith(e)));

/** Le texte sans ses lignes commentées (`//"extends": …` n'étend rien). */
const read = (file: string): string =>
  readFileSync(path.join(REPO, file), "utf8").replace(/^\s*\/\/.*$/gm, "");

const optionValue = (text: string, name: string): string | undefined =>
  new RegExp(`"${name}"\\s*:\\s*(true|false)`).exec(text)?.[1];

describe("tsconfig — même rigueur de compilation partout", () => {
  it("trouve les tsconfig du dépôt", () => {
    expect(tsconfigs.length).toBeGreaterThan(20);
  });

  it("chaque tsconfig racine porte les options strictes", () => {
    const missing: string[] = [];
    for (const file of tsconfigs) {
      const text = read(file);
      if (text.includes('"extends"')) continue;
      for (const name of REQUIRED) {
        if (optionValue(text, name) !== "true")
          missing.push(`${file} → ${name}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("chaque tsconfig racine du dépôt porte les options du framework", () => {
    const missing: string[] = [];
    for (const file of tsconfigs) {
      if (file.endsWith(".tpl")) continue;
      const text = read(file);
      if (text.includes('"extends"')) continue;
      for (const [name, value] of Object.entries(REPO_ONLY)) {
        if (REPO_ONLY_EXEMPT[file]?.[name] !== undefined) continue;
        if (optionValue(text, name) !== value)
          missing.push(`${file} → ${name}: ${value}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("une dispense vise un tsconfig et une option qui existent", () => {
    const stale: string[] = [];
    for (const [file, options] of Object.entries(REPO_ONLY_EXEMPT)) {
      if (!tsconfigs.includes(file)) stale.push(`${file} (introuvable)`);
      for (const name of Object.keys(options))
        if (!(name in REPO_ONLY)) stale.push(`${file} → ${name}`);
    }
    expect(stale).toEqual([]);
  });

  it("une option refusée n'est exigée nulle part", () => {
    const both = Object.keys(REFUSED).filter(
      (name) =>
        name in REPO_ONLY || (REQUIRED as readonly string[]).includes(name),
    );
    expect(both).toEqual([]);
  });

  it("aucun tsconfig n'éteint une option stricte", () => {
    const disabled: string[] = [];
    for (const file of tsconfigs) {
      const text = read(file);
      for (const name of NEVER_OFF) {
        if (optionValue(text, name) === "false")
          disabled.push(`${file} → ${name}`);
      }
      for (const name of NEVER_ON) {
        if (optionValue(text, name) === "true")
          disabled.push(`${file} → ${name}: true`);
      }
    }
    expect(disabled).toEqual([]);
  });
});
