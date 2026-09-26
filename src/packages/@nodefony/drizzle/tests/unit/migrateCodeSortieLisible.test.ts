import assert from "node:assert/strict";
import {
  EXIT,
  renderStatus,
  styleFor,
  type IMigrationReport,
} from "../../nodefony/src/migrator/explain";

/**
 * **Le code de sortie doit se lire à l'écran, pas dans le source.**
 *
 * La grille des codes est délibérée et figée — `0` à jour, `1` une action est
 * REQUISE, `2` la commande n'a pas pu travailler. Elle ne bougera pas : des
 * passes de déploiement s'arrêtent dessus (`orm:migrate:status --json || exit 1`).
 *
 * Mais « 1 » se lit « échec » partout ailleurs, et la grille ne vivait que dans
 * un TSDoc — qui traverse vers les `.d.ts` et le graphe symbolique, et n'atteint
 * jamais celui qui TAPE la commande.
 *
 * Vécu, et c'est ce que ce banc verrouille : après une réparation réussie,
 * `orm:migrate:repair` affiche « ✓ historique réparé » puis rend `1`, puisqu'il
 * reste à appliquer. Un agent a lu ce `1` comme un échec, relancé `migrate`,
 * re-réparé — cinq fois de suite, sans issue possible. Le geste suivant était
 * pourtant déjà à l'écran : c'est le CODE qui mentait à la lecture.
 */
describe("@nodefony/drizzle — le code de sortie se lit à l'écran", () => {
  const style = styleFor(false);

  /** Un rapport minimal, dont seul le code de sortie varie. */
  const rapport = (exitCode: 0 | 1 | 2): IMigrationReport => ({
    formatVersion: 1,
    connector: "default",
    verdict: exitCode === 0 ? "up-to-date" : "pending",
    exitCode,
    summary: "peu importe ici",
    nextActions: [],
    sources: [],
    driver: {
      kind: "sql",
      dialect: "sqlite",
      ddl: "auto",
      historyTable: "nodefony_migrations",
    },
  });

  it("dit qu'un code 1 est une action requise, PAS un échec", () => {
    const out = renderStatus(rapport(EXIT.actionRequired), style);
    assert.match(
      out,
      /code de sortie 1/u,
      "le code n'est pas nommé : qui lit la sortie ne peut pas savoir ce que 1 veut dire",
    );
    assert.match(
      out,
      /n'est pas un échec/u,
      "dire « action requise » sans démentir « échec » laisse l'ambiguïté qui a produit la boucle",
    );
  });

  it("dit qu'un code 2 est une commande qui n'a pas pu travailler", () => {
    const out = renderStatus(rapport(EXIT.error), style);
    assert.match(out, /code de sortie 2/u);
  });

  it("ne dit RIEN quand tout va bien — un succès n'a pas à se justifier", () => {
    const out = renderStatus(rapport(EXIT.ok), style);
    assert.doesNotMatch(
      out,
      /code de sortie/u,
      "ajouter une ligne sur un verdict vert est du bruit à chaque passage",
    );
  });
});
