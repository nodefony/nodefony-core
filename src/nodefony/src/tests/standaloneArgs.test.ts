import { describe, it } from "vitest";
import assert from "node:assert";
import { parseStandaloneArgs } from "../service/dev/devStatusReport";

const argv = (...words: string[]): string[] => ["node", "nodefony", ...words];

describe("parseStandaloneArgs — status/stop refusent ce qu'ils ne déclarent pas", () => {
  it("🔴 `status -y` est REFUSÉ, plus absorbé en silence", () => {
    // Vécu : `-y` tombait dans le vide et `status` répondait normalement,
    // apprenant à son auteur que l'option avait un sens ici.
    assert.deepStrictEqual(
      parseStandaloneArgs("status", argv("status", "-y")),
      {
        error: "option inconnue : -y",
      },
    );
  });

  it("`status` n'accepte aucun argument positionnel", () => {
    assert.deepStrictEqual(
      parseStandaloneArgs("status", argv("status", "mon-app")),
      { error: "argument inattendu : mon-app" },
    );
  });

  it("`stop` : une cible, `--all`, et rien de plus", () => {
    assert.deepStrictEqual(
      parseStandaloneArgs("stop", argv("stop", "mon-app", "--all")),
      { help: false, all: true, target: "mon-app" },
    );
    assert.deepStrictEqual(
      parseStandaloneArgs("stop", argv("stop", "a", "b")),
      { error: "argument inattendu : b" },
    );
    assert.deepStrictEqual(
      parseStandaloneArgs("stop", argv("stop", "--force")),
      {
        error: "option inconnue : --force",
      },
    );
  });

  it("`--all` n'appartient qu'à `stop`", () => {
    assert.deepStrictEqual(
      parseStandaloneArgs("status", argv("status", "--all")),
      { error: "option inconnue : --all" },
    );
  });

  it("l'aide et les options GLOBALES du CLI restent acceptées", () => {
    assert.deepStrictEqual(
      parseStandaloneArgs("status", argv("status", "-d", "--help")),
      { help: true, all: false },
    );
    assert.deepStrictEqual(parseStandaloneArgs("stop", argv("stop", "-i")), {
      help: false,
      all: false,
    });
  });
});
