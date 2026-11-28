/**
 * Chaque question de la spec de `create` est ATTEIGNABLE par la ligne de
 * commande : son drapeau (`flagFor`) est reconnu par le parseur.
 *
 * L'aide se rend depuis la spec, le parseur s'écrit à la main : une question
 * ajoutée à la spec s'affiche donc dans `--help` et répond « option inconnue »
 * quand on la tape. Vécu sur `create command --read-state` — vu par le banc
 * de vérité du générateur, jamais par les tests du dépôt, qui appellent le
 * moteur sans passer par la ligne de commande.
 */
import { describe, it } from "vitest";
import { assert } from "vitest";
import { parseCreateArgv } from "../cli/create";
import { flagFor, getScaffoldSpec } from "../cli/scaffold/spec";

describe("create — chaque question de la spec a un drapeau que le parseur reconnaît", () => {
  const specs = getScaffoldSpec();

  it("le catalogue est peuplé (sinon la boucle ne prouve rien)", () => {
    assert.isAtLeast(specs.length, 6);
    assert.ok(specs.some((s) => s.type === "command"));
  });

  for (const spec of specs) {
    it(`create ${spec.type}`, () => {
      const unknown: string[] = [];
      for (const question of spec.questions) {
        // `name` est le POSITIONNEL : il n'a pas de drapeau à reconnaître.
        if (question.key === "name") continue;
        const flag = flagFor(question);
        const value =
          question.type === "boolean"
            ? []
            : question.type === "choice"
              ? [question.choices?.[0]?.value ?? "x"]
              : ["x"];
        const parsed = parseCreateArgv([
          "create",
          spec.type,
          "temoin",
          flag,
          ...value,
        ]);
        if ("error" in parsed && parsed.error.includes("option inconnue")) {
          unknown.push(`${question.key} (${flag})`);
        }
      }
      assert.deepEqual(unknown, [], "questions de la spec inatteignables");
    });
  }
});
