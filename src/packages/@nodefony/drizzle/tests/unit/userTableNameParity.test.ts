import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "vitest";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import { getTableConfig as getPgTableConfig } from "drizzle-orm/pg-core";
import type { PgTable } from "drizzle-orm/pg-core";
import { getTableConfig as getMysqlTableConfig } from "drizzle-orm/mysql-core";
import type { MySqlTable } from "drizzle-orm/mysql-core";
import { USER_TABLE_NAME } from "@nodefony/user";
import { createUserTable } from "../../nodefony/entity/userTable";

/**
 * Le nom de la table des utilisateurs a UNE source, et trois lecteurs.
 *
 * Le contrat (`@nodefony/user`) le publie ; la table Drizzle le DÉRIVE ; le SQL
 * natif de `queryKit` le LIT aussi, par le même import — le paquet dépend déjà
 * du contrat. Ce banc ne compare donc pas deux copies : il empêche la copie de
 * revenir, en refusant tout nom de table écrit en clair dans les requêtes.
 *
 * **Pourquoi ce banc existe.** Une divergence de ce nom ne LÈVE PAS : la
 * requête de recherche par compte externe rend simplement zéro ligne, et le
 * provisionnement en conclut qu'aucun compte n'est lié — il en crée donc un
 * nouveau, à chaque connexion. Le symptôme apparaît des semaines plus tard, sous
 * la forme de comptes en double que rien n'explique.
 *
 * Le défaut a été RÉEL : le générateur d'entité appliquait la règle du pluriel
 * et écrivait `users` dans l'application, face à un SQL qui lit `User`. Le refus
 * qui interdisait `--table` était pourtant écrit, juste, et documenté — il
 * n'empêchait pas le DÉFAUT de produire la même divergence tout seul.
 */

const ICI = path.dirname(fileURLToPath(import.meta.url));
const QUERY_KIT = path.join(ICI, "..", "..", "nodefony", "src", "queryKit.ts");

describe("nom de la table des utilisateurs — une source, trois lecteurs", () => {
  it("la table Drizzle porte le nom du contrat, sur les trois dialectes", () => {
    assert.equal(
      getTableConfig(createUserTable("sqlite") as SQLiteTable).name,
      USER_TABLE_NAME,
    );
    assert.equal(
      getPgTableConfig(createUserTable("postgres") as PgTable).name,
      USER_TABLE_NAME,
    );
    assert.equal(
      getMysqlTableConfig(createUserTable("mysql") as MySqlTable).name,
      USER_TABLE_NAME,
    );
  });

  it("le SQL natif ne porte AUCUN nom de table écrit à la main", () => {
    const source = readFileSync(QUERY_KIT, "utf8");
    // La correction a consisté à faire LIRE le nom au lieu de le recopier ;
    // ce cas empêche la copie de revenir. Toute variante littérale — la bonne
    // comme la fautive — est refusée : c'est la SOURCE qui doit être unique,
    // pas seulement la valeur juste aujourd'hui.
    const litteraux = [
      ...source.matchAll(
        /ident\(\s*(?:dialect|"sqlite"|"postgres"|"mysql")\s*,\s*"([^"]+)"/gu,
      ),
    ].map((m) => m[1]);
    const fautifs = litteraux.filter(
      (nom) => nom.toLowerCase() === USER_TABLE_NAME.toLowerCase(),
    );
    assert.deepEqual(
      fautifs,
      [],
      `le SQL natif écrit la table des utilisateurs en clair (${fautifs.join(", ")}) ` +
        `au lieu de lire USER_TABLE_NAME : une divergence ne lèverait pas, elle ` +
        `rendrait zéro ligne — donc un compte externe de plus à chaque connexion`,
    );
    // …et il DOIT la citer : un SQL qui ne parlerait plus de cette table
    // rendrait ce banc vert pour la pire des raisons.
    assert.ok(
      source.includes("USER_TABLE_NAME"),
      "le SQL natif doit lire le nom depuis le contrat",
    );
  });

  it("aucune variante PLURIELLE ne subsiste — c'est elle que le générateur écrivait", () => {
    const source = readFileSync(QUERY_KIT, "utf8");
    assert.ok(
      !/["`]users["`]/iu.test(source),
      "le SQL natif ne doit jamais nommer « users » : c'est la table qu'un " +
        "générateur appliquant la règle du pluriel produirait, et elle est vide",
    );
  });
});
