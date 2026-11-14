import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { asShown, flatImports, lf } from "../helpers/exampleSource";

/**
 * Les skills LIVRÉS qui enseignent le temps réel (`@nodefony/devkit/skills/`)
 * ne montrent que du code EXÉCUTÉ : chaque bloc `ts` porte un marqueur
 * `<!-- excerpt: <source> -->`, et doit être une suite CONTIGUË de lignes de
 * cette source — un cas d'usage de ce paquet (`tests/fixtures/use-cases/`,
 * `tests/unit/use-cases/`) ou un gabarit de la démo (`demo/…`, sous
 * `src/nodefony/templates/`). Un extrait court reste lisible ; il ne peut plus
 * mentir. Le test vit ICI, chez le propriétaire des cas : corriger un cas fait
 * rougir sa propre suite, pas celle d'un autre paquet.
 *
 * L'indentation n'est pas comparée (un extrait de méthode se montre désindenté
 * ou non) ; l'ordre et le contenu des lignes, si.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const skillsDir = path.resolve(here, "../../../../devkit/skills");
const templatesDir = path.resolve(here, "../../../../../../nodefony/templates");
const caseDirs = [
  path.join(here, "..", "fixtures", "use-cases"),
  path.join(here, "use-cases"),
];

/** Les skills qui s'engagent à ne montrer que des extraits exécutés. */
const SKILLS = [
  "nodefony-add-realtime-channel",
  "nodefony-add-realtime-presence",
  "nodefony-add-realtime-binary",
];

/** Les pages d'un skill : son `SKILL.md` et ses `references/*.md`. */
function pagesOf(skill: string): string[] {
  const dir = path.join(skillsDir, skill);
  const refs = path.join(dir, "references");
  return [
    path.join(dir, "SKILL.md"),
    ...(existsSync(refs)
      ? readdirSync(refs)
          .filter((f) => f.endsWith(".md"))
          .map((f) => path.join(refs, f))
      : []),
  ];
}

interface IBlock {
  page: string;
  source: string | null;
  body: string;
}

/** Les blocs `ts` d'une page, avec le marqueur qui les précède (ou `null`). */
function blocksOf(page: string): IBlock[] {
  const text = lf(readFileSync(page, "utf8"));
  const blocks: IBlock[] = [];
  for (const m of text.matchAll(/```ts\n([\s\S]*?)```/g)) {
    const before = text.slice(0, m.index).trimEnd();
    const marker = /<!-- excerpt: (\S+) -->$/.exec(before);
    blocks.push({
      page: path.relative(skillsDir, page),
      source: marker?.[1] ?? null,
      body: m[1] ?? "",
    });
  }
  return blocks;
}

/** Le chemin de la source d'un extrait, ou `null` si elle n'existe pas. */
function resolveSource(name: string): string | null {
  if (name.startsWith("demo/")) {
    const file = path.join(templatesDir, ...name.split("/"));
    return existsSync(file) ? file : null;
  }
  for (const dir of caseDirs) {
    const file = path.join(dir, name);
    if (existsSync(file)) return file;
  }
  return null;
}

/** Les lignes comparées : imports aplatis, indentation et fin de bloc retirées. */
function linesOf(text: string): string[] {
  const lines = flatImports(text)
    .split("\n")
    .map((l) => l.trim());
  while (lines.length > 0 && lines.at(-1) === "") lines.pop();
  return lines;
}

/** `needle` figure-t-il, d'un seul tenant, dans `haystack` ? */
function containsRun(haystack: string[], needle: string[]): boolean {
  if (needle.length === 0) return false;
  for (let i = 0; i + needle.length <= haystack.length; i++) {
    let j = 0;
    while (j < needle.length && haystack[i + j] === needle[j]) j++;
    if (j === needle.length) return true;
  }
  return false;
}

const blocks = SKILLS.flatMap((skill) => pagesOf(skill).flatMap(blocksOf));

describe("skills temps réel livrés — chaque bloc de code est un extrait exécuté", () => {
  it("les skills existent et montrent du code", () => {
    for (const skill of SKILLS) {
      expect(
        blocks.some((b) => b.page.startsWith(skill)),
        `${skill} : aucun bloc ts`,
      ).toBe(true);
    }
  });

  it("chaque bloc ts porte un marqueur excerpt qui désigne une source existante", () => {
    const orphans = blocks
      .filter((b) => b.source === null || resolveSource(b.source) === null)
      .map((b) => `${b.page} : ${b.source ?? "sans marqueur"}`);
    expect(orphans).toEqual([]);
  });

  it.each(blocks.filter((b) => b.source !== null))(
    "$page ($source) : le bloc est une suite contiguë de sa source",
    (block) => {
      const file = resolveSource(block.source ?? "");
      if (file === null) return; // signalé par le test précédent
      const source = linesOf(asShown(lf(readFileSync(file, "utf8"))));
      const shown = linesOf(lf(block.body));
      expect(
        containsRun(source, shown),
        `${block.page} : l'extrait de ${block.source} n'en est pas une suite contiguë — corrige le BLOC d'après la source (la source fait foi), ou change de source.\n${shown.join("\n")}`,
      ).toBe(true);
    },
  );
});
