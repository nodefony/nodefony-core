import { describe, it } from "vitest";
import assert from "node:assert";
import {
  rebuildLosses,
  repairRebuildCopy,
} from "../../nodefony/src/migrator/rebuildCopy";

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

/*
 *   SPEC — « une recréation qui ne recopie pas une colonne la PERD ».
 *
 *   Vu sur un schéma réel (une table de prélèvements qui perd sept colonnes
 *   d'une version à l'autre) : SQLite recrée la table, la recopie ne lit que
 *   les colonnes d'arrivée, et les sept autres disparaissent avec leurs valeurs
 *   — sans un `DROP COLUMN`, donc sans un refus.
 */
describe("rebuildLosses — ce que la recopie d'une recréation ne lit pas", () => {
  const recreation = [
    "CREATE TABLE `__new_User` (`id` text PRIMARY KEY NOT NULL, `zone` integer);",
    'INSERT INTO `__new_User`("id", "zone") SELECT "id", "zone" FROM `User`;',
    "DROP TABLE `User`;",
    "ALTER TABLE `__new_User` RENAME TO `User`;",
  ].join("\n--> statement-breakpoint\n");
  const recreee = new Set(["user"]);
  const pertes = (
    sql: string,
    rebuilt: ReadonlySet<string>,
    columnsOf: (t: string) => readonly string[] | null,
  ): string[] =>
    [
      ...rebuildLosses(
        sql.split("\n--> statement-breakpoint\n"),
        rebuilt,
        columnsOf,
      ).values(),
    ].flat();

  it("nomme chaque colonne de départ que la recopie ne lit pas", () => {
    assert.deepStrictEqual(
      pertes(recreation, recreee, () => ["id", "zone", "iban", "bic"]),
      ["User.iban", "User.bic"],
    );
  });

  it("rien quand toutes les colonnes de départ sont lues — même dans une expression", () => {
    const expression = recreation.replace(
      'SELECT "id", "zone"',
      'SELECT "id", coalesce("zone", 0)',
    );
    assert.deepStrictEqual(
      pertes(expression, recreee, () => ["id", "zone"]),
      [],
    );
  });

  it("rien quand la table de départ est INCONNUE — on ne conclut pas sur une supposition", () => {
    assert.deepStrictEqual(
      pertes(recreation, recreee, () => null),
      [],
    );
  });

  it("une recopie qui n'appartient à AUCUNE recréation est une migration de données", () => {
    assert.deepStrictEqual(
      pertes(
        'INSERT INTO `archive`("id") SELECT "id" FROM `User`;',
        new Set(),
        () => ["id", "zone"],
      ),
      [],
    );
  });

  it("🔴 un renommage ÉCRIT AVANT la recopie change ce que la table porte", () => {
    // Vu sur le corpus erp-lite : `RENAME COLUMN lastname TO last_name`, puis
    // une recréation qui lit `last_name` — l'instantané de départ, lui, porte
    // encore `lastname`. Sans suivre l'ordre, c'est un faux refus.
    const renomme = [
      "ALTER TABLE `User` RENAME COLUMN `zone` TO `region`;",
      recreation.replace(/"zone"/gu, '"region"'),
    ].join("\n--> statement-breakpoint\n");
    assert.deepStrictEqual(
      pertes(renomme, recreee, () => ["id", "zone"]),
      [],
    );
    const tableRenommee = [
      "ALTER TABLE `Person` RENAME TO `User`;",
      recreation,
    ].join("\n--> statement-breakpoint\n");
    assert.deepStrictEqual(
      pertes(tableRenommee, recreee, (t) =>
        t === "Person" ? ["id", "zone", "iban"] : null,
      ),
      ["User.iban"],
    );
  });

  it("`status` ne se croit pas lu dans `fk_status`", () => {
    const voisine = recreation.replace(
      'SELECT "id", "zone"',
      'SELECT "id", "fk_status"',
    );
    assert.deepStrictEqual(
      pertes(voisine, recreee, () => ["id", "fk_status", "status"]),
      ["User.status"],
    );
  });
});
