/*
 *   Une application générée naît avec la MÊME rigueur de typage que le dépôt.
 *
 *   Le lint typé (`typeAware`, préréglage `strict-type-checked`, règles qui
 *   attrapent des défauts : promesse flottante, callback async là où l'on
 *   attend du synchrone, `return` sans `await` dans un `try`…) vit dans deux
 *   fichiers : `.oxlintrc.json` du dépôt, et le gabarit `oxlintrc.json.tpl`
 *   que reçoit chaque application. La duplication est imposée par la
 *   frontière — le dépôt porte des surcharges qui ne concernent que lui —, et
 *   deux copies divergent en silence : le gabarit n'avait ni `typeAware`, ni
 *   aucune règle typée, pendant que le dépôt passait à la norme entière.
 *
 *   Ce test compare les deux : toute règle `typescript/*` réglée par le dépôt
 *   doit l'être À L'IDENTIQUE par le gabarit, surcharges des tests et du
 *   JavaScript comprises. Durcir le dépôt sans le gabarit le fait tomber.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

const CORE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const REPO = path.resolve(CORE, "../..");

interface ILintConfig {
  options?: { typeAware?: boolean };
  categories?: Record<string, string>;
  rules?: Record<string, unknown>;
  overrides?: Array<{ files: string[]; rules?: Record<string, unknown> }>;
}

/** Lit un JSONC : commentaires retirés HORS des chaînes, virgules finales tolérées. */
function readJsonc(file: string): ILintConfig {
  const text = readFileSync(file, "utf8");
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      const start = i;
      for (i++; i < text.length && text[i] !== '"'; i++) {
        if (text[i] === "\\") i++;
      }
      out += text.slice(start, i + 1);
    } else if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
    } else if (c === "/" && text[i + 1] === "*") {
      i = text.indexOf("*/", i + 2) + 1;
    } else {
      out += c;
    }
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1")) as ILintConfig;
}

const typed = (rules: Record<string, unknown> = {}): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(rules).filter(([k]) => k.startsWith("typescript/")),
  );

/** La surcharge dont les motifs `files` contiennent `pattern`. */
const overrideFor = (cfg: ILintConfig, pattern: string) =>
  cfg.overrides?.find((o) => o.files.includes(pattern));

const repo = readJsonc(path.join(REPO, ".oxlintrc.json"));
const template = readJsonc(
  path.join(CORE, "templates/app/base/oxlintrc.json.tpl"),
);

describe("gabarit d'application — même rigueur de typage que le dépôt", () => {
  it("active le lint typé", () => {
    expect(repo.options?.typeAware).toBe(true);
    expect(template.options?.typeAware).toBe(true);
  });

  it("règle chaque règle typée du dépôt à l'identique", () => {
    expect(typed(template.rules)).toEqual(typed(repo.rules));
  });

  it("assouplit les tests exactement comme le dépôt", () => {
    const repoTests = overrideFor(repo, "**/*.test.ts");
    const tplTests = overrideFor(template, "**/*.test.ts");
    expect(repoTests).toBeDefined();
    expect(typed(tplTests?.rules)).toEqual(typed(repoTests?.rules));
  });

  it("n'applique pas au JavaScript les règles de propagation d'`any`", () => {
    const repoJs = overrideFor(repo, "**/*.mjs");
    const tplJs = overrideFor(template, "**/*.mjs");
    expect(repoJs).toBeDefined();
    expect(typed(tplJs?.rules)).toEqual(typed(repoJs?.rules));
  });
});

interface IRuleInfo {
  scope: string;
  value: string;
  category: string;
  type_aware: boolean;
}

describe("règles typées — aucune sans décision", () => {
  it("règle explicitement chaque règle typée hors des catégories actives", () => {
    // Le catalogue vient de l'oxlint INSTALLÉ : une montée de version qui
    // apporte une règle typée fait tomber ce test tant qu'elle n'est pas
    // tranchée (allumée, ou coupée avec son motif) dans `.oxlintrc.json`.
    const bin = path.join(
      path.dirname(
        createRequire(path.join(REPO, "package.json")).resolve(
          "oxlint/package.json",
        ),
      ),
      "bin/oxlint",
    );
    const catalog = JSON.parse(
      execFileSync(process.execPath, [bin, "--rules", "--format=json"], {
        cwd: REPO,
        encoding: "utf8",
      }),
    ) as IRuleInfo[];
    const active = new Set(
      Object.entries(repo.categories ?? {})
        .filter(([, level]) => level !== "off")
        .map(([name]) => name),
    );
    const undecided = catalog
      .filter((r) => r.type_aware && !active.has(r.category))
      .map((r) => `${r.scope}/${r.value}`)
      .filter((key) => !(key in (repo.rules ?? {})));
    expect(catalog.some((r) => r.type_aware)).toBe(true);
    expect(undecided).toEqual([]);
  });
});
