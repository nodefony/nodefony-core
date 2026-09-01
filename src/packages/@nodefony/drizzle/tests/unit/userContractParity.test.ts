import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import { getTableConfig as getPgTableConfig } from "drizzle-orm/pg-core";
import type { PgTable } from "drizzle-orm/pg-core";
import { getTableConfig as getMysqlTableConfig } from "drizzle-orm/mysql-core";
import type { MySqlTable } from "drizzle-orm/mysql-core";
import { USER_COLUMNS } from "@nodefony/user";
import type { SqlDialect } from "../../nodefony/interfaces/IDrizzleConfig";
import { createUserTable } from "../../nodefony/entity/userTable";

/**
 * La table SQL `User` doit RENDRE le contrat de colonnes de `@nodefony/user`,
 * sur les trois dialectes.
 *
 * Ce banc existe parce que la table est désormais DÉRIVÉE du contrat : la
 * dérivation elle-même peut perdre une colonne (un cas de traduction oublié, un
 * filtre trop large) sans que rien ne le dise — la table se construirait, les
 * migrations passeraient, et l'absence n'apparaîtrait qu'à la première requête
 * du lecteur concerné, sur l'installation d'un tiers.
 *
 * Ce que le banc NE fait pas : comparer les types SQL entre dialectes — c'est
 * `s2-entities-parity.test.ts` qui porte cet invariant.
 */

interface ColView {
  notNull: boolean;
  isUnique: boolean;
  primary: boolean;
}

/** Vue commune des colonnes d'une table, quel que soit le dialecte. */
function columnsOf(dialect: SqlDialect): Map<string, ColView> {
  const table = createUserTable(dialect);
  const columns =
    dialect === "sqlite"
      ? getTableConfig(table as SQLiteTable).columns
      : dialect === "postgres"
        ? getPgTableConfig(table as PgTable).columns
        : getMysqlTableConfig(table as MySqlTable).columns;
  return new Map(
    columns.map((c) => [
      c.name,
      { notNull: c.notNull, isUnique: c.isUnique, primary: c.primary },
    ]),
  );
}

const DIALECTS: SqlDialect[] = ["sqlite", "postgres", "mysql"];

describe("contrat utilisateur — la table SQL le rend en entier", () => {
  for (const dialect of DIALECTS) {
    it(`${dialect} : aucune colonne du contrat ne manque, aucune n'est en trop`, () => {
      const produced = columnsOf(dialect);
      const expected = USER_COLUMNS.map((c) => c.name).sort();
      assert.deepEqual(
        [...produced.keys()].sort(),
        expected,
        `la table ${dialect} ne rend pas exactement les colonnes du contrat`,
      );
    });

    it(`${dialect} : les contraintes du contrat sont portées`, () => {
      const produced = columnsOf(dialect);
      for (const column of USER_COLUMNS) {
        const actual = produced.get(column.name);
        assert.ok(actual, `${column.name} absente de la table ${dialect}`);
        if (column.origin === "identity") {
          assert.equal(
            actual.primary,
            true,
            `${column.name} devrait être la clé primaire (${dialect})`,
          );
          continue;
        }
        assert.equal(
          actual.notNull,
          !column.nullable,
          `${column.name} : contrainte NOT NULL divergente (${dialect})`,
        );
        assert.equal(
          actual.isUnique,
          column.unique === true,
          `${column.name} : contrainte UNIQUE divergente (${dialect})`,
        );
      }
    });
  }

  it("les colonnes obligatoires du contrat ont de quoi se remplir", () => {
    // Le DDL dérivé n'émet pas de `DEFAULT` SQL (règle du colKit) : une colonne
    // NOT NULL sans défaut applicatif ne peut être remplie que par l'appelant.
    // Si le contrat en déclare une, c'est une décision — pas un oubli.
    const orphans = USER_COLUMNS.filter(
      (c) => c.origin === "column" && !c.nullable && !c.makeDefault,
    ).map((c) => c.name);
    assert.deepEqual(orphans, ["identifier"]);
  });
});
