/**
 * Suite du compte rendu de fermeture.
 *
 * Ce que ces cas protègent : un compte rendu est cru sans être relu, comme le
 * ticket lui-même. Deux façons de le rendre nuisible plutôt qu'inutile — lui
 * attribuer le travail d'un AUTRE ticket (`#9` qui ramène `#95`), et rendre un
 * gabarit dont les trous ne se voient pas, donc qu'on colle tel quel.
 */
import { describe, expect, it } from "vitest";
import { composer, fichiersDeTest } from "./ticket-close.mjs";

describe("les fichiers de test d'un diff", () => {
  it("retient les suites, quelle que soit leur forme", () => {
    expect(
      fichiersDeTest([
        "src/nodefony/src/kernel/Kernel.ts",
        "src/nodefony/src/tests/readinessRegistry.test.ts",
        "src/packages/@nodefony/http/nodefony/tests/http/health.test.ts",
        ".claude/skills/nodefony-ticket/scripts/ticket-close.test.mjs",
      ]),
    ).to.deep.equal([
      "src/nodefony/src/tests/readinessRegistry.test.ts",
      "src/packages/@nodefony/http/nodefony/tests/http/health.test.ts",
      ".claude/skills/nodefony-ticket/scripts/ticket-close.test.mjs",
    ]);
  });

  it("ne rend jamais deux fois le même fichier", () => {
    const f = "src/tests/a.test.ts";
    expect(fichiersDeTest([f, f, f])).to.deep.equal([f]);
  });

  it("ignore le code de production", () => {
    expect(
      fichiersDeTest(["src/nodefony/src/kernel/readinessRegistry.ts"]),
    ).to.deep.equal([]);
  });
});

describe("le brouillon rendu à l'auteur", () => {
  const commits = [
    { sha: "abc1234", sujet: "feat(http): retenir la mise en service" },
  ];

  it("porte les commits et les preuves trouvés", () => {
    const t = composer(95, commits, ["src/tests/a.test.ts"]);
    expect(t).to.include("`abc1234` feat(http): retenir la mise en service");
    expect(t).to.include("`src/tests/a.test.ts`");
  });

  // PIÈGE : un gabarit dont les trous sont muets se rend tel quel. Les deux blocs
  // que le script NE PEUT PAS deviner doivent se voir — ce sont les seuls qui
  // portent ce que seul l'auteur sait.
  it("EXIGE en toutes lettres les deux blocs qu'aucun automate ne connaît", () => {
    const t = composer(95, commits, ["src/tests/a.test.ts"]);
    expect(t).to.include("**Au-delà du ticket**");
    expect(t).to.include("**Non fait**");
    expect(t, "la garde vue mordre est une preuve, pas une option").to.include(
      "Garde vue mordre",
    );
  });

  // PIÈGE : sans commit citant le ticket, la timeline GitHub reste vide et le
  // travail devient introuvable. Se taire ici reviendrait à valider l'oubli.
  it("DIT que rien ne cite le ticket, au lieu de rendre un bloc vide", () => {
    const t = composer(95, [], []);
    expect(t).to.include("aucun commit ne cite #95");
    expect(t).to.include("aucun fichier de test touché");
  });
});
