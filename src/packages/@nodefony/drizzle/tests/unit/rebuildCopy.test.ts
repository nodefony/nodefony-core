import { describe, it } from "vitest";
import assert from "node:assert";
import { repairRebuildCopy } from "../../nodefony/src/migrator/rebuildCopy";

/*
 *   SPEC — « une recopie ne peut pas lire une colonne qui n'existe pas encore ».
 *
 *   SQLite ne sait pas modifier une colonne : l'outil de génération recrée la
 *   table et recopie les lignes. Sa recopie liste les colonnes de la table
 *   d'ARRIVÉE — la colonne qu'on vient d'ajouter comprise — et va donc la LIRE
 *   dans la table de départ, où elle n'est pas. Mesuré : la migration meurt sur
 *   `no such column`, pose un marqueur, et les trois commandes suivantes
 *   refusent — l'utilisateur détruit alors sa base pour s'en sortir.
 */

/** La ronde telle que l'outil l'écrit, avec une colonne neuve dans la recopie. */
const ronde = [
  "CREATE TABLE `__new_User` (`id` text PRIMARY KEY NOT NULL, `zone` integer, `site` text);",
  "--> statement-breakpoint",
  'INSERT INTO `__new_User`("id", "zone", "site") SELECT "id", "zone", "site" FROM `User`;',
  "--> statement-breakpoint",
  "DROP TABLE `User`;",
].join("\n");

/** La table de départ : elle porte `id` et `zone`, jamais `site`. */
const avant = (table: string): readonly string[] | null =>
  table === "User" ? ["id", "zone"] : null;

describe("repairRebuildCopy — la recopie ne lit que ce que la table de départ porte", () => {
  it("retire des DEUX listes la colonne que la source n'a pas", () => {
    const { sql, dropped } = repairRebuildCopy(ronde, avant);
    assert.match(
      sql,
      /INSERT INTO `__new_User`\("id", "zone"\) SELECT "id", "zone" FROM `User`/u,
    );
    assert.doesNotMatch(
      sql,
      /SELECT[^;]*"site"/u,
      "lire « site » dans la table de départ fait échouer la migration",
    );
    assert.deepStrictEqual(dropped, ["User.site"]);
  });

  it("laisse INTACT le reste du fichier — on ne réécrit que la recopie", () => {
    const { sql } = repairRebuildCopy(ronde, avant);
    assert.match(sql, /CREATE TABLE `__new_User`.*`site` text/su);
    assert.match(sql, /DROP TABLE `User`;/u);
  });

  it("ne touche à rien quand toutes les colonnes existent déjà", () => {
    const complet = (): readonly string[] => ["id", "zone", "site"];
    const { sql, dropped } = repairRebuildCopy(ronde, complet);
    assert.strictEqual(sql, ronde);
    assert.deepStrictEqual(dropped, []);
  });

  it("ne touche à rien quand la table de départ est INCONNUE", () => {
    // On ne réécrit jamais sur une supposition : sans les colonnes d'avant, le
    // silence est le seul comportement sûr.
    const { sql, dropped } = repairRebuildCopy(ronde, () => null);
    assert.strictEqual(sql, ronde);
    assert.deepStrictEqual(dropped, []);
  });

  it("ne touche à rien quand la recopie contient autre chose qu'une colonne", () => {
    // Une expression, un alias, un appel de fonction : on n'a pas compris, donc
    // on ne réécrit pas.
    const exotique =
      'INSERT INTO `__new_User`("id", "vu") SELECT "id", coalesce("vu", 0) FROM `User`;';
    const { sql, dropped } = repairRebuildCopy(exotique, () => ["id"]);
    assert.strictEqual(sql, exotique);
    assert.deepStrictEqual(dropped, []);
  });

  it("ne touche pas à un ALTER ordinaire — il n'y a pas de recopie", () => {
    const alter = "ALTER TABLE `User` ADD `site` text;";
    assert.strictEqual(repairRebuildCopy(alter, avant).sql, alter);
  });
});
