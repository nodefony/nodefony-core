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
 *   `REPO_ONLY`, exigé du framework et laissé au choix de l'application. Les gabarits (`.tpl`) sont lus en texte : leurs balises de
 *   modèle ne sont pas du JSON.
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
 * Options exigées dans chaque tsconfig racine DU DÉPÔT, mais pas dans les
 * gabarits (`.tpl`) d'application ou de module. Le code du framework tourne
 * chez tout le monde : un accès indexé non vérifié y devient un `undefined`
 * chez l'utilisateur. Le code métier d'une application, lui, n'a pas à payer
 * cette friction par défaut — `strict` y suffit, et l'option s'y active en
 * une ligne.
 */
const REPO_ONLY = ["noUncheckedIndexedAccess"] as const;

/** Options que `strict` allume et qu'aucun tsconfig ne doit éteindre. */
const NEVER_OFF = [
  ...REQUIRED,
  ...REPO_ONLY,
  "useUnknownInCatchVariables",
] as const;

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
      for (const name of REPO_ONLY) {
        if (optionValue(text, name) !== "true")
          missing.push(`${file} → ${name}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("aucun tsconfig n'éteint une option stricte", () => {
    const disabled: string[] = [];
    for (const file of tsconfigs) {
      const text = read(file);
      for (const name of NEVER_OFF) {
        if (optionValue(text, name) === "false")
          disabled.push(`${file} → ${name}`);
      }
    }
    expect(disabled).toEqual([]);
  });
});
