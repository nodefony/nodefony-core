import assert from "node:assert/strict";
import { runAllStatements, statementTarget } from "./schema-contract";

/**
 * Le contrat de schéma nomme-t-il CHAQUE instruction refusée de la migration,
 * et la table qu'elle visait ? Sur un corpus de centaines de tables, s'arrêter
 * au premier refus en cachait les suivants : une table par passe du banc.
 */
describe("contrat de schéma — chaque refus de la migration est nommé", () => {
  it("la table visée se lit dans les trois dialectes", () => {
    assert.equal(statementTarget('CREATE TABLE "pg_t" (\n"id" text)'), "pg_t");
    assert.equal(
      statementTarget("CREATE TABLE `my_t` (\n`id` int) ON DELETE cascade"),
      "my_t",
    );
    assert.equal(
      statementTarget("ALTER TABLE `my_t` ADD CONSTRAINT `fk` FOREIGN KEY"),
      "my_t",
    );
    assert.equal(
      statementTarget('CREATE UNIQUE INDEX "t_idx_on" ON "pg_t" ("id")'),
      "pg_t",
    );
  });

  it("toutes les instructions passent, et TOUS les refus reviennent", async () => {
    const ran: string[] = [];
    const refused = await runAllStatements(
      [
        "CREATE TABLE `a` (`id` int)",
        "CREATE TABLE `b` (`id` int)",
        "CREATE TABLE `c` (`id` int)",
      ],
      async (statement) => {
        ran.push(statementTarget(statement));
        if (!statement.includes("`b`")) {
          throw new Error(`refus ${statementTarget(statement)}`);
        }
      },
    );
    assert.deepEqual(ran, ["a", "b", "c"]);
    assert.deepEqual(refused, ["a : refus a", "c : refus c"]);
  });
});
