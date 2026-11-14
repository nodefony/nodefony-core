import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { CONTROLLER_KIND_CHOICES } from "../cli/scaffold/spec";

/**
 * Le guide d'agent posé dans chaque application (`AGENTS.md`) liste les sortes
 * de contrôleur que `create controller --kind` accepte. Cette liste est une
 * COPIE de `CONTROLLER_KIND_CHOICES` — imposée par la frontière : le gabarit
 * est du texte, il ne peut pas importer la constante. Une copie diverge en
 * silence (vécu : `mcp` ajouté au générateur, absent du guide — un agent ne
 * pouvait pas apprendre qu'il existait). D'où ce test, qui compare les deux.
 */

const TEMPLATE = path.join(
  import.meta.dirname,
  "..",
  "..",
  "templates",
  "app",
  "agent-instructions",
  "AGENTS.md.tpl",
);

/** Chaque liste `--kind a\|b\|c` du gabarit, en sortes. */
function kindListsOf(text: string): string[][] {
  return [...text.matchAll(/--kind ((?:[a-z]+\\\|)+[a-z]+)/g)].map((m) =>
    (m[1] ?? "").split("\\|"),
  );
}

describe("guide d'agent livré — les sortes de contrôleur sont celles du générateur", () => {
  const lists = kindListsOf(readFileSync(TEMPLATE, "utf8"));

  it("le gabarit énumère les sortes (sinon le test ne prouverait rien)", () => {
    expect(lists.length).toBeGreaterThan(0);
  });

  it("chaque énumération est exactement CONTROLLER_KIND_CHOICES", () => {
    for (const kinds of lists) {
      expect([...kinds].sort()).toEqual([...CONTROLLER_KIND_CHOICES].sort());
    }
  });
});
